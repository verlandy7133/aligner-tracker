// 資料備份 / 還原
//
// 設計原則：
//   - JSON 格式，user 看得懂、未來可改
//   - version 欄位 → 之後改 schema 可寫 migration
//   - exportedAt / appVersion / counts 進 metadata，方便認檔案來源
//   - 包含 patients / orders / settings 三大 collection
//   - 還原 = 全清 + bulkPut；不做合併（合併太複雜，先簡單）

import { db } from '../db';
import type { Order, Patient } from '../types/Patient';
import type { Setting } from '../db';

const BACKUP_VERSION = 1;
const APP_VERSION = '0.1.0';

export type BackupFile = {
  version: number;
  exportedAt: string;
  appVersion: string;
  counts: {
    patients: number;
    orders: number;
    settings: number;
  };
  patients: Patient[];
  orders: Order[];
  settings: Setting[];
  // 預留 metadata 區塊：未來想加 (筆數摘要、診所名稱、操作者...) 直接擴充
  metadata?: Record<string, unknown>;
};

export async function exportBackup(): Promise<BackupFile> {
  const [patients, orders, settings] = await Promise.all([
    db.patients.toArray(),
    db.orders.toArray(),
    db.settings.toArray(),
  ]);
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts: {
      patients: patients.length,
      orders: orders.length,
      settings: settings.length,
    },
    patients,
    orders,
    settings,
  };
}

export function downloadBackup(backup: BackupFile): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = backup.exportedAt.slice(0, 10);
  a.download = `aligner-tracker-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export type BackupValidation =
  | { ok: true; file: BackupFile }
  | { ok: false; error: string };

export function validateBackup(text: string): BackupValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'JSON 格式錯誤：' + (e instanceof Error ? e.message : String(e)) };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'JSON 結構不對 (應該是物件)' };
  }
  const f = parsed as Partial<BackupFile>;
  if (typeof f.version !== 'number') return { ok: false, error: '缺 version 欄位' };
  if (f.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `備份檔版本 (${f.version}) 比 App 還新 (${BACKUP_VERSION})，請更新 App 再匯入`,
    };
  }
  if (!Array.isArray(f.patients)) return { ok: false, error: '缺 patients 陣列' };
  if (!Array.isArray(f.orders)) return { ok: false, error: '缺 orders 陣列' };
  if (!Array.isArray(f.settings)) return { ok: false, error: '缺 settings 陣列' };
  return { ok: true, file: f as BackupFile };
}

export async function importBackup(file: BackupFile): Promise<void> {
  // 整個 transaction 內：清空現有 + bulkPut 從 backup
  await db.transaction('rw', db.patients, db.orders, db.settings, async () => {
    await db.patients.clear();
    await db.orders.clear();
    await db.settings.clear();
    if (file.patients.length) await db.patients.bulkPut(file.patients);
    if (file.orders.length) await db.orders.bulkPut(file.orders);
    if (file.settings.length) await db.settings.bulkPut(file.settings);
  });
}
