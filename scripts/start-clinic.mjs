// 診所電腦啟動腳本：同時跑 vite preview (服務 dist/) + folder-helper，
// 然後自動開 Chrome --app 視窗到 localhost:5174。
//
// 用 .mjs 而非 .cmd 避免中文路徑編碼問題。
//
// 啟動方式 (Windows)：
//   - 用 npm script: npm run start
//   - 或直接命令列: node scripts/start-clinic.mjs
//   - 或建桌面捷徑指向 .vbs wrapper (見 SOP)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';

const NODE = process.execPath;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const URL = 'http://localhost:5174';
const HELPER_HEALTH = 'http://127.0.0.1:8765/health';

// 1. 檢查 dist/ 是否存在 (要先 npm run build 過)
if (!fs.existsSync(path.join(ROOT, 'dist'))) {
  console.error('❌ 找不到 dist/ 目錄。請先執行：npm run build');
  process.exit(1);
}

function start(name, args, color) {
  const child = spawn(NODE, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  child.stdout.on('data', (d) =>
    process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')),
  );
  child.stderr.on('data', (d) =>
    process.stderr.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')),
  );
  child.on('exit', (code) => {
    console.log(`${tag} exited (code=${code})`);
  });
  return child;
}

console.log('=== 隱形矯正追蹤 — 啟動中 ===');
console.log('Node:', process.version);
console.log('Root:', ROOT);
console.log('');

// 2. 啟 vite preview 服務 dist/
const vite = start(
  'vite',
  [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', '5174', '--host'],
  '36',
);

// 3. 啟 folder-helper
const helper = start('helper', [path.join(ROOT, 'scripts/folder-helper.mjs')], '33');

// 4. 等 server 起來再開 Chrome
async function waitFor(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((res) => {
      http
        .get(url, (resp) => {
          res(resp.statusCode != null && resp.statusCode < 500);
          resp.resume();
        })
        .on('error', () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  const viteReady = await waitFor(URL);
  if (!viteReady) {
    console.error('⚠️ vite 在 15 秒內沒回應，跳過開 Chrome');
    return;
  }
  // helper 沒起來不致命，繼續開 Chrome
  await waitFor(HELPER_HEALTH, 5000).catch(() => {});

  // 開 Chrome --app 模式 (像 native app，無網址列)
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const chromePath = chromePaths.find((p) => fs.existsSync(p));
  if (!chromePath) {
    console.warn('⚠️ 找不到 Chrome，請手動開啟 ' + URL);
    return;
  }
  spawn(chromePath, [`--app=${URL}`], { detached: true, stdio: 'ignore' }).unref();
  console.log(`✓ 已開啟 Chrome (${URL})`);
})();

// 5. cleanup
const cleanup = () => {
  vite.kill();
  helper.kill();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
