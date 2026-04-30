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
// 自動偵測安裝碟：優先 D 槽（vrlndy 主機慣例），否則用系統碟（C: 通常）
const DRIVE = fs.existsSync('D:\\') ? 'D:' : (process.env.SystemDrive || 'C:');
const ALLOWED_ROOTS = [`${DRIVE}\\矯正`, `${DRIVE}\\dev\\矯正追蹤-app`];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCAN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'scan-aligner-folders.mjs');
const PATIENTS_JSON = path.join(PROJECT_ROOT, 'dev-data', 'patients-import.json');
const ROLE_FILE = path.join(PROJECT_ROOT, 'dev-data', 'clinic-role.txt');

// 讀本機角色：master = 持有真實 矯正/ 資料夾、可掃描；follower = 開發機，只能透過 backup 還原。
// dev-data/clinic-role.txt 不存在或內容不是 "master" → 預設 follower（保守、防誤動）
function readRole() {
  try {
    return fs.readFileSync(ROLE_FILE, 'utf8').trim().toLowerCase() === 'master'
      ? 'master'
      : 'follower';
  } catch {
    return 'follower';
  }
}

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

  if (url.pathname === '/role') {
    const role = readRole();
    const dataRoot = `${DRIVE}\\矯正`;
    const scanFolder = `${DRIVE}\\矯正\\病患資料夾`;
    const scanFolderExists = fs.existsSync(scanFolder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ role, drive: DRIVE, dataRoot, scanFolder, scanFolderExists }));
    return;
  }

  if (url.pathname === '/rescan-folders') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error:
            '此機角色為 follower，禁止掃描資料夾。新增病患請在筆電 (master) 操作後匯出備份還原。',
        }),
      );
      return;
    }
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
    // 跨機部署 path remap：v0.1.0 之前的資料寫死 D:\，本機若沒 D 槽（部署在 C 槽機器）
    // 自動把開頭碟符 D: 改寫為當前 DRIVE，避免要回去修 IndexedDB 內 800+ 寫死路徑
    let remapped = target;
    if (DRIVE !== 'D:' && /^D:\\/.test(target)) {
      remapped = DRIVE + target.slice(2);
      console.log(`[folder-helper] path remap: ${target} → ${remapped}`);
    }
    if (!ALLOWED_ROOTS.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`path not in allowlist (must start with one of: ${ALLOWED_ROOTS.join(', ')})`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`not found: ${remapped}`);
      return;
    }
    const safe = remapped.replace(/["`]/g, '');
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
  console.log(`[folder-helper] role: ${readRole()} (drive: ${DRIVE})`);
  console.log(`[folder-helper] allowlist: ${ALLOWED_ROOTS.join(', ')}`);
});
