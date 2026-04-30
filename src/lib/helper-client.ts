// 與本機 folder-helper service 對話的 client。
// helper 跑在 http://127.0.0.1:8765 (見 scripts/folder-helper.mjs)

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

// 顯示給 user 看的訊息（toast 或 alert 用）
export function describeHelperFailure(result: HelperResult): string | null {
  if (result.state === 'opened') return null;
  if (result.state === 'helper-down') {
    return '本機 helper service 沒回應，無法開檔。請重啟 App（雙擊桌面捷徑）。';
  }
  return `開檔失敗：${result.message}`;
}
