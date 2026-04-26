// Folder Helper — 本地 HTTP service，讓 web app 可以呼叫系統 explorer.exe 開資料夾。
// 由於瀏覽器擋掉 file:// 連結 (從 http://localhost 觸發)，
// 我們在 localhost:8765 跑一個小 service 接收請求，由它呼叫 OS。
//
// 安全：
//   - 只 listen 127.0.0.1 (不對外開放)
//   - 只允許開啟 ALLOWED_ROOTS 底下的路徑 (避免被惡意網頁打)
//   - 嚴格清掉路徑中的 quote 字元，再交給 explorer.exe
//
// 啟動：node scripts/folder-helper.mjs (或跟 vite 一起由 dev-launcher 啟動)

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8765;
const ALLOWED_ROOTS = ['D:\\矯正', 'D:\\dev\\矯正追蹤-app'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCAN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'scan-aligner-folders.mjs');
const PATIENTS_JSON = path.join(PROJECT_ROOT, 'dev-data', 'patients-import.json');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'aligner-folder-helper' }));
    return;
  }

  if (url.pathname === '/rescan-folders') {
    // 跑 scan script (用當前 node)，產生最新 patients-import.json，回傳給前端
    const child = spawn(process.execPath, [SCAN_SCRIPT], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: stderr || `scan exited ${code}`, stdout }));
        return;
      }
      try {
        const json = fs.readFileSync(PATIENTS_JSON, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.end(json);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    child.on('error', (err) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (url.pathname === '/open-folder' || url.pathname === '/open-file') {
    const target = url.searchParams.get('path');
    if (!target) {
      res.statusCode = 400;
      res.end('missing path');
      return;
    }
    if (!ALLOWED_ROOTS.some((root) => target.startsWith(root))) {
      res.statusCode = 403;
      res.end(`path not in allowlist (must start with one of: ${ALLOWED_ROOTS.join(', ')})`);
      return;
    }
    if (!fs.existsSync(target)) {
      res.statusCode = 404;
      res.end(`not found: ${target}`);
      return;
    }
    const safe = target.replace(/["`]/g, '');
    // open-folder → explorer.exe；open-file → 用系統預設程式 (start "")
    if (url.pathname === '/open-folder') {
      const child = spawn('explorer.exe', [safe], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => console.error('[folder-helper] spawn error:', err));
      child.unref();
    } else {
      // 用 cmd 的 start 命令以系統預設程式開檔（PDF → Acrobat / Edge / 等）
      const child = spawn('cmd.exe', ['/c', 'start', '""', safe], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => console.error('[folder-helper] spawn error:', err));
      child.unref();
    }
    res.statusCode = 200;
    res.end('opened');
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[folder-helper] listening on http://127.0.0.1:${PORT}`);
  console.log(`[folder-helper] allowlist: ${ALLOWED_ROOTS.join(', ')}`);
});
