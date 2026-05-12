// Stage B readOnly mode flag + 初始化邏輯
//
// 設計：
//   - build-time：VITE_READ_ONLY=1 → bundle 進唯讀模式
//   - 唯讀模式下 IndexedDB 還是用，但是當作「server sync.json 的 cache」
//   - 啟動時從 /api/snapshot 拉 sync.json → importBackup 到 IndexedDB
//   - 之後 component 邏輯不用改、useLiveQuery() 照常 work
//
// 這樣最省事：
//   - 不用改每個 page / component 的 data source 邏輯
//   - 只需要隱藏「mutation UI」(按鈕 / Modal / Setting CRUD section)
//   - getImageUrl / listFolderFiles 等 helper 路徑 redirect 到 server API

import { db } from '../db';
import { validateBackup, importBackup } from './backup';

export const READ_ONLY =
  import.meta.env.VITE_READ_ONLY === '1' ||
  import.meta.env.VITE_READ_ONLY === 'true';

// 啟動時：從 server fetch sync.json + import 到 IndexedDB
// 已 import 過就跳過（用 settings table 內 last-snapshot-mtime 比對）
const LAST_SNAPSHOT_KEY = 'read-only-last-snapshot-mtime';

export async function initReadOnlyData(): Promise<{
  state: 'imported' | 'cached' | 'no-server' | 'error';
  message?: string;
  mtime?: string;
  counts?: { patients: number; orders: number; settings: number };
}> {
  if (!READ_ONLY) {
    return { state: 'no-server', message: 'not in read-only mode' };
  }

  try {
    // HEAD-ish call：先抓 mtime 比對、看要不要重 import
    const headResp = await fetch('/api/health');
    if (!headResp.ok) {
      return { state: 'no-server', message: `health check ${headResp.status}` };
    }
    const health = (await headResp.json()) as {
      syncExists: boolean;
      syncStat?: { mtime: string; size: number };
    };
    if (!health.syncExists) {
      return {
        state: 'no-server',
        message: 'server 上 sync.json 不存在（master 機還沒推過）',
      };
    }

    const serverMtime = health.syncStat?.mtime ?? '';
    const lastImported = await db.settings.get(LAST_SNAPSHOT_KEY);
    if (lastImported && lastImported.value === serverMtime) {
      // 已 import 過該版本、跳過
      return { state: 'cached', mtime: serverMtime };
    }

    // Fetch + import
    const resp = await fetch('/api/snapshot');
    if (!resp.ok) {
      return { state: 'error', message: `snapshot fetch ${resp.status}` };
    }
    const text = await resp.text();
    const v = validateBackup(text);
    if (!v.ok) {
      return { state: 'error', message: `validate backup: ${v.error}` };
    }
    await importBackup(v.file);
    await db.settings.put({ key: LAST_SNAPSHOT_KEY, value: serverMtime });
    return {
      state: 'imported',
      mtime: serverMtime,
      counts: v.file.counts,
    };
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 給 component 用的 hook（如果之後要 refresh / 顯示 sync 狀態）
export function useReadOnly() {
  return READ_ONLY;
}
