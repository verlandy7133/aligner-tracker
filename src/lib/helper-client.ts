// 與本機 folder-helper service 對話的 client。
// helper 跑在 http://127.0.0.1:8765 (見 scripts/folder-helper.mjs)
//
// readOnly mode（Stage B、iPad 唯讀 web）：
//   - 沒 helper service（iPad 上沒辦法跑 Node 後台）
//   - 用 same-origin /api/* (見 server/index.js)
//   - 大多數 mutation endpoint 不會被 UI 觸發、但 getImageUrl / listFolderFiles 等讀取功能要 redirect

import { READ_ONLY } from './read-only';

export type HelperEndpoint = 'open-folder' | 'open-file';

export type HelperResult =
  | { state: 'opened' }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

const HELPER_BASE = 'http://127.0.0.1:8765';

export async function callHelper(endpoint: HelperEndpoint, path: string): Promise<HelperResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/${endpoint}?path=${encodeURIComponent(path)}`);
    if (resp.ok) return { state: 'opened' };
    const message = await resp.text();
    return { state: 'error', message };
  } catch {
    return { state: 'helper-down' };
  }
}

// 在資料夾裡找符合 pattern 的 PDF 並開（用途：指示單 / 轉介單 等動態文件）
export async function findAndOpenPdf(folder: string, pattern: string): Promise<HelperResult> {
  try {
    const url = `${HELPER_BASE}/find-and-open?folder=${encodeURIComponent(folder)}&pattern=${encodeURIComponent(pattern)}`;
    const resp = await fetch(url);
    if (resp.ok) return { state: 'opened' };
    const message = await resp.text();
    return { state: 'error', message };
  } catch {
    return { state: 'helper-down' };
  }
}

// 列指定資料夾底下所有子資料夾名（為了 App 做 name match）
export async function listFolderNames(folder: string): Promise<{ names: string[]; folder: string } | { error: string }> {
  try {
    const resp = await fetch(`${HELPER_BASE}/list-folder-names?folder=${encodeURIComponent(folder)}`);
    if (resp.ok) {
      const data = (await resp.json()) as { folder: string; count: number; names: string[] };
      return { names: data.names, folder: data.folder };
    }
    return { error: await resp.text() };
  } catch {
    return { error: 'helper-down' };
  }
}

// 列指定資料夾底下所有圖片檔（給病患照片 slot 選擇器用）
// readOnly mode redirect 到 /api/files（server 端 path-traversal-safe、本機 helper 不可用）
export async function listFolderFiles(
  folder: string,
  types: string[] = ['jpg', 'jpeg', 'png', 'heic'],
): Promise<{ names: string[]; folder: string } | { error: string }> {
  const typesParam = types.join(',');
  if (READ_ONLY) {
    try {
      const resp = await fetch(
        `/api/files?folder=${encodeURIComponent(folder)}&types=${encodeURIComponent(typesParam)}`,
      );
      if (resp.ok) {
        const data = (await resp.json()) as { folder: string; count: number; files: string[] };
        // server 端 filter image 副檔名（其實也回傳所有 files、前端再 filter）
        const lcTypes = types.map((t) => t.toLowerCase());
        const filtered = data.files.filter((n) => {
          const dot = n.lastIndexOf('.');
          if (dot < 0) return false;
          return lcTypes.includes(n.slice(dot + 1).toLowerCase());
        });
        return { names: filtered, folder: data.folder };
      }
      return { error: await resp.text() };
    } catch {
      return { error: 'server-down' };
    }
  }
  try {
    const resp = await fetch(
      `${HELPER_BASE}/list-folder-files?folder=${encodeURIComponent(folder)}&types=${encodeURIComponent(typesParam)}`,
    );
    if (resp.ok) {
      const data = (await resp.json()) as { folder: string; count: number; names: string[] };
      return { names: data.names, folder: data.folder };
    }
    return { error: await resp.text() };
  } catch {
    return { error: 'helper-down' };
  }
}

// 產出 <img src="..."> 用的 URL
// readOnly mode：用 /api/image（same-origin、走 Stage B server）
// master mode：用 helper /serve-image（localhost:8765）
export function getImageUrl(absolutePath: string): string {
  if (READ_ONLY) {
    return `/api/image?path=${encodeURIComponent(absolutePath)}`;
  }
  return `${HELPER_BASE}/serve-image?path=${encodeURIComponent(absolutePath)}`;
}

// 建立資料夾（master 才能；follower 會回 403）
export type CreateFolderResult =
  | { state: 'created'; path: string }
  | { state: 'already-existed'; path: string }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function createFolder(path: string): Promise<CreateFolderResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/create-folder?path=${encodeURIComponent(path)}`);
    if (resp.ok) {
      const data = (await resp.json()) as { created?: boolean; alreadyExisted?: boolean; path: string };
      if (data.alreadyExisted) return { state: 'already-existed', path: data.path };
      return { state: 'created', path: data.path };
    }
    const message = await resp.text();
    return { state: 'error', message };
  } catch {
    return { state: 'helper-down' };
  }
}

// 檢查 App 有沒有更新（git fetch + 比 HEAD vs origin/main）
export type CheckUpdateResult =
  | { state: 'ok'; behind: number; current: string; latest: string }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function checkUpdate(): Promise<CheckUpdateResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/check-update`);
    if (resp.ok) {
      const data = (await resp.json()) as { behind: number; current: string; latest: string };
      return { state: 'ok', ...data };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// 掃 Excel 資料夾、跑 python 兩支 import 出 JSON（更新 dev-data/excel-*.json）
// 之後 user 還要按「重新套用 Excel 匯入」才會把 JSON 內容套到 IndexedDB
export type ScanExcelResult =
  | {
      state: 'ok';
      success: boolean;
      excelFolder: string;
      log: Array<{ script: string; exitCode: number; stdout?: string; stderr?: string; error?: string }>;
    }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function scanExcel(): Promise<ScanExcelResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/scan-excel`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        success: boolean;
        excelFolder: string;
        log: Array<{ script: string; exitCode: number; stdout?: string; stderr?: string }>;
      };
      return { state: 'ok', ...data };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// 跑 update.ps1 -Silent，等 1-3 分鐘
// ref 可選：帶 = 切到指定 tag/branch；不帶 = 升 latest origin/main
export type RunUpdateResult =
  | { state: 'ok'; exitCode: number; stdout: string; stderr: string }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function runUpdate(ref?: string): Promise<RunUpdateResult> {
  try {
    const url = ref
      ? `${HELPER_BASE}/run-update?ref=${encodeURIComponent(ref)}`
      : `${HELPER_BASE}/run-update`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = (await resp.json()) as {
        success: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      return { state: 'ok', exitCode: data.exitCode, stdout: data.stdout, stderr: data.stderr };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// 列所有 git tag + 當前 HEAD + origin/main hash
export type ListTagsResult =
  | {
      state: 'ok';
      tags: string[];
      currentHash: string;
      currentTag: string | null;
      latestMain: string;
    }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function listTags(): Promise<ListTagsResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/list-tags`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        tags: string[];
        currentHash: string;
        currentTag: string | null;
        latestMain: string;
      };
      return { state: 'ok', ...data };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// 寫 backup 到 dataRoot/app-backups/<name>（master only）
export type WriteBackupResult =
  | { state: 'ok'; path: string; size: number }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function writeBackup(name: string, jsonContent: string): Promise<WriteBackupResult> {
  try {
    const resp = await fetch(
      `${HELPER_BASE}/write-backup?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonContent,
      },
    );
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; path: string; size: number };
      return { state: 'ok', path: data.path, size: data.size };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// ─── 路徑設定（NAS 路徑等）─────────────────────────
export type ClinicPaths = {
  dataRoot: string;
  syncFile: string;
};

export type GetPathsResult =
  | { state: 'ok'; paths: ClinicPaths; pathsFile: string; pathsFileExists: boolean }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function getPaths(): Promise<GetPathsResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/paths`);
    if (resp.ok) {
      const data = (await resp.json()) as ClinicPaths & { pathsFile: string; pathsFileExists: boolean };
      return { state: 'ok', paths: { dataRoot: data.dataRoot, syncFile: data.syncFile }, pathsFile: data.pathsFile, pathsFileExists: data.pathsFileExists };
    }
    return { state: 'error', message: await resp.text() };
  } catch {
    return { state: 'helper-down' };
  }
}

export type SavePathsResult =
  | { state: 'ok'; paths: ClinicPaths; hint: string }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function savePaths(paths: ClinicPaths): Promise<SavePathsResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/paths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paths),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; paths: ClinicPaths; hint: string };
      return { state: 'ok', paths: data.paths, hint: data.hint };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// ─── 跨機同步：sync.json 在 NAS / Dropbox 上 ─────────
export type SyncStat = {
  configured: boolean;
  exists: boolean;
  syncFile: string;
  mtime: string; // ISO
  size: number;
};

export type SyncStatResult =
  | { state: 'ok'; stat: SyncStat }
  | { state: 'not-configured' }
  | { state: 'not-exists'; syncFile: string }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function syncStat(): Promise<SyncStatResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/sync-stat`);
    if (resp.ok) {
      const data = (await resp.json()) as SyncStat;
      return { state: 'ok', stat: data };
    }
    if (resp.status === 400) {
      return { state: 'not-configured' };
    }
    if (resp.status === 404) {
      const data = (await resp.json().catch(() => ({}))) as { syncFile?: string };
      return { state: 'not-exists', syncFile: data.syncFile ?? '' };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

export type SyncReadResult =
  | { state: 'ok'; content: string; mtime: string; size: number }
  | { state: 'not-configured' }
  | { state: 'not-exists' }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function syncRead(): Promise<SyncReadResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/sync-read`);
    if (resp.ok) {
      const content = await resp.text();
      const mtime = resp.headers.get('X-Sync-Mtime') ?? '';
      const size = parseInt(resp.headers.get('X-Sync-Size') ?? '0', 10);
      return { state: 'ok', content, mtime, size };
    }
    if (resp.status === 400) return { state: 'not-configured' };
    if (resp.status === 404) return { state: 'not-exists' };
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

export type SyncWriteResult =
  | { state: 'ok'; mtime: string; size: number; syncFile: string }
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | { state: 'helper-down' };

export async function syncWrite(jsonContent: string): Promise<SyncWriteResult> {
  try {
    const resp = await fetch(`${HELPER_BASE}/sync-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonContent,
    });
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; mtime: string; size: number; syncFile: string };
      return { state: 'ok', mtime: data.mtime, size: data.size, syncFile: data.syncFile };
    }
    if (resp.status === 400) {
      const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
      if (data.error?.includes('syncFile')) return { state: 'not-configured' };
      return { state: 'error', message: data.error };
    }
    const data = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error: string };
    return { state: 'error', message: data.error };
  } catch {
    return { state: 'helper-down' };
  }
}

// 顯示給 user 看的訊息（toast 或 alert 用）
export function describeHelperFailure(result: HelperResult): string | null {
  if (result.state === 'opened') return null;
  if (result.state === 'helper-down') {
    return '本機 helper service 沒回應，無法開檔。請重啟 App（雙擊桌面捷徑）。';
  }
  return `開檔失敗：${result.message}`;
}
