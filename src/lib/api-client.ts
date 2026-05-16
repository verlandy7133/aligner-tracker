// HTTP client for NAS API server.
//
// 用途：所有跟 server 的通訊都走這層、處理：
//   - base URL config（dev → localhost / prod → NAS IP）
//   - clientId 自動塞進 X-Client-Id header
//   - userId 之後 Phase 2 接 auth 時統一加 X-User-Id / Authorization
//   - JSON 序列化 / 反序列化
//   - 統一錯誤格式
//   - 樂觀鎖 409 衝突回傳 typed exception
//
// 不負責：快取、SSE、業務邏輯（那些在 DataLayer 層）

// ─── 設定 ────────────────────────────────────────────
const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8080'
    : `http://${window.location.hostname}:8080`);

// clientId 一台機一份、存 localStorage、SSE 廣播時 server 用來 exclude 自己
const CLIENT_ID_KEY = 'aligner-tracker.client-id';
function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

const CLIENT_NAME_KEY = 'aligner-tracker.client-name';
export function getClientName(): string {
  return localStorage.getItem(CLIENT_NAME_KEY) || '';
}
export function setClientName(name: string): void {
  localStorage.setItem(CLIENT_NAME_KEY, name);
}

export const clientId = getOrCreateClientId();
export const apiBase = API_BASE;

// ─── Error types ─────────────────────────────────────
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class VersionConflictError extends ApiError {
  currentVersion: number;
  yourVersion: number;
  current: unknown;
  constructor(currentVersion: number, yourVersion: number, current: unknown) {
    super(409, 'version_conflict', `version conflict: server=${currentVersion}, you=${yourVersion}`, {
      currentVersion,
      yourVersion,
      current,
    });
    this.currentVersion = currentVersion;
    this.yourVersion = yourVersion;
    this.current = current;
  }
}

export class NetworkError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

// ─── 核心 fetch wrapper ────────────────────────────────
type ApiOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  userId?: string; // Phase 2+ 才用
};

export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'X-Client-Id': clientId,
  };
  if (opts.userId) headers['X-User-Id'] = opts.userId;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    throw new NetworkError(`fetch failed: ${(e as Error).message}`, e);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.ok) return payload as T;

  // Typed error responses
  if (res.status === 409 && payload?.error === 'version_conflict') {
    throw new VersionConflictError(payload.currentVersion, payload.yourVersion, payload.current);
  }
  throw new ApiError(
    res.status,
    payload?.error || 'unknown_error',
    payload?.message || `${res.status} ${res.statusText}`,
    payload?.details,
  );
}

// ─── Quick helpers ────────────────────────────────────
export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiDelete = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', body });
