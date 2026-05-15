// Stage B iPad 唯讀 web server
//
// 用途：
//   - serve 唯讀 SPA（從 dist/）給 iPad Safari 看
//   - 提供 5 個 API endpoints 給 SPA 取資料
//     · GET /api/health         健康檢查
//     · GET /api/snapshot       sync.json 內容（patients/orders/settings/users）
//     · GET /api/files          列病患資料夾內檔案
//     · GET /api/image          串照片 binary
//     · GET /api/file           串通用檔案（PDF / ZIP 等）
//
// 設計：
//   - LAN-only（NAS 不對外開 port 8080）
//   - 無 auth（信任邊界 = 診所 wifi）
//   - sync.json 每次 GET 即時讀檔（master 機 push 後幾秒內 iPad reload 就看到新版）
//   - path traversal 嚴格守門（所有 path 必須在 DATA_PATH 底下）
//
// 環境變數：
//   PORT          (default 8080)
//   DATA_PATH     (default ../dev-data/test-data — 開發測試用本機資料；NAS 上會 mount /n歐耐恩n/矯正追蹤)
//   SYNC_FILE     (default ${DATA_PATH}/sync.json)
//
// 跑：
//   node index.js
//   # 或本地用 dev backup JSON 測試
//   $env:DATA_PATH='D:\矯正'
//   $env:SYNC_FILE='D:\矯正\aligner-tracker-backup-2026-04-26-live.json'
//   node index.js

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getDb } from './db/db.js';
import { authStub } from './middleware/auth.js';
import patientsRouter from './routes/patients.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8080;
const DATA_PATH = path.resolve(
  process.env.DATA_PATH || path.join(PROJECT_ROOT, 'dev-data', 'stage-b-test-data'),
);
const SYNC_FILE = process.env.SYNC_FILE || path.join(DATA_PATH, 'sync.json');
const DB_PATH = process.env.DB_PATH || path.join(DATA_PATH, 'db.sqlite');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist');

// ─── DB 初始化 ────────────────────────────────────────────
// 若 DB 檔不存在會自動建立並 apply schema.sql。第一次部署前要先跑 migration。
let dbReady = false;
try {
  openDb(DB_PATH);
  dbReady = true;
} catch (e) {
  console.error(`[startup] DB 開不起來 (${DB_PATH}):`, e.message);
  console.error('[startup] 新 API endpoints (/api/patients 等) 會 503，既有 endpoints 仍可用');
}

// ─── Path validation ──────────────────────────────────
// 所有 user-supplied path 必須在 DATA_PATH 底下、不能 traversal 出去
function safePath(rel) {
  if (typeof rel !== 'string') throw new Error('path must be string');
  // 把 user 提供的 relative path resolve 到 absolute、檢查是否仍在 DATA_PATH 底下
  // 支援 Windows-style backslash (master 機寫進 sync.json 的 path 可能含 \)
  const normalized = rel.replace(/\\/g, '/');
  const full = path.resolve(DATA_PATH, normalized);
  const safe = path.resolve(DATA_PATH);
  if (!full.startsWith(safe + path.sep) && full !== safe) {
    throw new Error(`path traversal blocked: ${rel} → ${full} (not under ${safe})`);
  }
  return full;
}

// Mime type lookup
const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

function mimeFor(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// ─── Express app ──────────────────────────────────────
const app = express();

// CORS — LAN 內 iPad / Windows / Mac 都可能不同 origin（雖然主要直接訪問 server）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-Client-Id, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Sync-Mtime, X-Sync-Size');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Request log（簡易、看 Docker logs 用）
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// JSON body parser（給新 API 用、限制 10MB）
app.use(express.json({ limit: '10mb' }));

// Auth stub（Phase 1 全部視為 system / admin、塞 req.user / req.clientId）
app.use(authStub);

// 503 guard：DB 沒開起來時、新 API 直接拒絕（既有 read-only endpoints 不受影響）
function requireDb(req, res, next) {
  if (!dbReady) {
    return res.status(503).json({
      error: 'db_unavailable',
      message: `SQLite DB 沒開起來。檢查 DB_PATH=${DB_PATH}`,
    });
  }
  next();
}

// ─── 新 API routes ────────────────────────────────────────
app.use('/api/patients', requireDb, patientsRouter);

// ─── /api/health ──────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const syncExists = fs.existsSync(SYNC_FILE);
  let syncStat = null;
  if (syncExists) {
    try {
      const s = fs.statSync(SYNC_FILE);
      syncStat = { mtime: s.mtime.toISOString(), size: s.size };
    } catch {
      // ignore
    }
  }

  // DB 狀態
  let dbInfo = { ready: dbReady, path: DB_PATH };
  if (dbReady) {
    try {
      const db = getDb();
      const patientCount = db.prepare('SELECT COUNT(*) AS c FROM patients').get().c;
      const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
      const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      const migrations = db.prepare('SELECT version, applied_at FROM migrations ORDER BY version').all();
      dbInfo = { ...dbInfo, patientCount, orderCount, userCount, migrations };
    } catch (e) {
      dbInfo.error = e.message;
    }
  }

  res.json({
    ok: true,
    service: 'aligner-viewer-server',
    version: '0.6.0-dev',
    dataPath: DATA_PATH,
    syncFile: SYNC_FILE,
    syncExists,
    syncStat,
    distExists: fs.existsSync(DIST_PATH),
    db: dbInfo,
  });
});

// ─── /api/snapshot — 回 sync.json 全部 ────────────────
app.get('/api/snapshot', (_req, res) => {
  if (!fs.existsSync(SYNC_FILE)) {
    res.status(404).json({
      error: 'sync.json not found',
      path: SYNC_FILE,
      hint: '診所端 master 機按「📤 推到 NAS」推一次後才會出現',
    });
    return;
  }
  try {
    const content = fs.readFileSync(SYNC_FILE, 'utf8');
    const stat = fs.statSync(SYNC_FILE);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=10');
    res.setHeader('X-Sync-Mtime', stat.mtime.toISOString());
    res.setHeader('X-Sync-Size', String(stat.size));
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/files — 列指定病患資料夾內檔案 ──────────────
// query: folder=<relative-path-or-absolute-master-path>
//   - master 機寫進 sync.json 的 sourceFolder 可能是 absolute (例 W:\矯正追蹤\病患資料夾\821102嚴家彬)
//   - 我們從 sourceFolder 抽出「相對於 DATA_PATH」的部分
//   - 但實際上 master sync.json 內 sourceFolder 是 W:\... 路徑、不是 server 視角
//   - 解決：server 端做 path rewrite — 把 W:\矯正追蹤\ 開頭的部分 strip 掉、剩下的視為 DATA_PATH 內 relative path
app.get('/api/files', (req, res) => {
  const folder = String(req.query.folder ?? '');
  if (!folder) {
    res.status(400).json({ error: 'missing folder query' });
    return;
  }
  try {
    const rel = stripMasterPrefix(folder);
    const target = safePath(rel);
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: 'folder not found', resolved: target });
      return;
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    res.json({
      folder,
      resolved: target,
      relative: rel,
      count: files.length,
      files,
      folders,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── /api/image — 串照片 binary ───────────────────────
// query: path=<relative-or-master-absolute>
app.get('/api/image', (req, res) => {
  const reqPath = String(req.query.path ?? '');
  if (!reqPath) {
    res.status(400).json({ error: 'missing path query' });
    return;
  }
  try {
    const rel = stripMasterPrefix(reqPath);
    const target = safePath(rel);
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: 'file not found', resolved: target });
      return;
    }
    const stat = fs.statSync(target);
    res.setHeader('Content-Type', mimeFor(target));
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    const stream = fs.createReadStream(target);
    stream.pipe(res);
    stream.on('error', (e) => {
      console.error('[image stream error]', e);
      if (!res.headersSent) res.status(500);
      res.end();
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── /api/file — 串通用檔案（PDF / ZIP 等）────────────
app.get('/api/file', (req, res) => {
  const reqPath = String(req.query.path ?? '');
  if (!reqPath) {
    res.status(400).json({ error: 'missing path query' });
    return;
  }
  try {
    const rel = stripMasterPrefix(reqPath);
    const target = safePath(rel);
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: 'file not found', resolved: target });
      return;
    }
    const stat = fs.statSync(target);
    res.setHeader('Content-Type', mimeFor(target));
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── helper: strip Windows-style master-side prefix ───
// master 機把 sourceFolder 存成 W:\矯正追蹤\病患資料夾\xxx
// server 端要把 W:\矯正追蹤\ 那段 strip 掉、剩下 病患資料夾\xxx 視為 DATA_PATH 內 relative
//
// 支援的 master-side prefix（依優先序）：
//   W:\矯正追蹤\  ← 診所機慣例
//   D:\矯正\      ← 開發機 fallback
//   /n歐耐恩n/矯正追蹤/  ← NAS 內 Linux 視角
function stripMasterPrefix(p) {
  if (!p) return '';
  const PREFIXES = [
    /^W:\\矯正追蹤\\/i,
    /^W:\\0矯正追蹤\\/i,
    /^W:\\/i,
    /^D:\\矯正\\/i,
    /^D:\\/i,
    /^\/n歐耐恩n\/矯正追蹤\//,
    /^\/n歐耐恩n\/0矯正追蹤\//,
    /^\/data\//,
  ];
  for (const re of PREFIXES) {
    if (re.test(p)) {
      return p.replace(re, '').replace(/\\/g, '/');
    }
  }
  // 沒匹配 → 直接視為 relative
  return p.replace(/\\/g, '/');
}

// ─── SPA static + fallback ────────────────────────────
if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
  // SPA fallback — client-side routing (React Router)
  // Express 5 + path-to-regexp 不再支援 '*' 字串、改用 regex catch-all
  // 但不能吃 /api/* — 那些不存在就 404
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
      <h1>Aligner Viewer Server (v0.3.0-alpha)</h1>
      <p>dist/ not built yet. Run <code>npm run build</code> at project root.</p>
      <ul>
        <li><a href="/api/health">/api/health</a></li>
        <li><a href="/api/snapshot">/api/snapshot</a></li>
      </ul>
    `);
  });
}

// ─── Global error handler — 任何 throw 都包成 JSON、不要回 HTML ──
// （Express 5 error middleware：4 個參數）
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message, err.stack);
  if (res.headersSent) return;
  res.status(500).json({
    error: 'internal_error',
    message: err.message,
  });
});

// 404 JSON for /api/* paths that didn't match any route
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'unknown API endpoint' });
});

// Unhandled errors — log 但不 crash server
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// ─── start ────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[aligner-viewer] listening on http://0.0.0.0:${PORT}`);
  console.log(`[aligner-viewer] DATA_PATH = ${DATA_PATH}`);
  console.log(`[aligner-viewer] SYNC_FILE = ${SYNC_FILE}`);
  console.log(`[aligner-viewer] DIST_PATH = ${DIST_PATH} (${fs.existsSync(DIST_PATH) ? 'exists' : 'missing'})`);
});
