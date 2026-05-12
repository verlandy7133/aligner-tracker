// 資料備份 / 還原
//
// 設計原則：
//   - JSON 格式，user 看得懂、未來可改
//   - version 欄位 → 之後改 schema 可寫 migration
//   - exportedAt / appVersion / counts 進 metadata，方便認檔案來源
//   - 包含 patients / orders / settings 三大 collection
//   - 還原 = 全清 + bulkPut；不做合併（合併太複雜，先簡單）
//
// v2 (v0.3.3 新增)：
//   - sourceFolder / consentPdfPath 在 sync.json 內存 relative path
//   - push 前 strip dataRoot prefix、pull 後 prepend 本機 dataRoot
//   - 跨機 dataRoot 不同也能 work（D 機 D:\、筆電 W:\）

import { db } from '../db';
import type { Order, Patient } from '../types/Patient';
import type { Setting } from '../db';
import { normalizePatient, denormalizePatient } from './path-normalize';

const BACKUP_VERSION = 2; // bumped to 2 — 支援 relative path
const APP_VERSION = '0.3.3';

export type BackupFile = {
  version: number;
  exportedAt: string;
  appVersion: string;
  // v2+ 紀錄 sender 的 dataRoot（debug / metadata 用、import 端用本機 dataRoot 不依賴此欄）
  dataRoot?: string;
  counts: {
    patients: number;
    orders: number;
    settings: number;
  };
  patients: Patient[];
  orders: Order[];
  settings: Setting[];
  metadata?: Record<string, unknown>;
};

// dataRoot 參數：
//   - 有給 → patients 內 path 自動 normalize 成 relative（跨機 sync 用）
//   - 不給 → patients 保留 absolute path（本機備份檔下載用、之後 import 不會 denormalize）
export async function exportBackup(dataRoot?: string): Promise<BackupFile> {
  const [patients, orders, settings] = await Promise.all([
    db.patients.toArray(),
    db.orders.toArray(),
    db.settings.toArray(),
  ]);
  const normalized = dataRoot
    ? patients.map((p) => normalizePatient(p, dataRoot))
    : patients;
  return {
    version: dataRoot ? BACKUP_VERSION : 1, // 有 normalize 才升版本
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    dataRoot,
    counts: {
      patients: patients.length,
      orders: orders.length,
      settings: settings.length,
    },
    patients: normalized,
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

// dataRoot 參數：
//   - 有給 + file.version >= 2 → patients 內 relative path 自動 denormalize 成本機 absolute
//   - 不給 / file.version < 2 → 視為 absolute path、原樣 bulkPut（舊備份檔、跨機 path 可能不通）
export async function importBackup(file: BackupFile, dataRoot?: string): Promise<void> {
  const patients =
    dataRoot && file.version >= 2
      ? file.patients.map((p) => denormalizePatient(p, dataRoot))
      : file.patients;
  // 整個 transaction 內：清空現有 + bulkPut 從 backup
  await db.transaction('rw', db.patients, db.orders, db.settings, async () => {
    await db.patients.clear();
    await db.orders.clear();
    await db.settings.clear();
    if (patients.length) await db.patients.bulkPut(patients);
    if (file.orders.length) await db.orders.bulkPut(file.orders);
    if (file.settings.length) await db.settings.bulkPut(file.settings);
  });
}
