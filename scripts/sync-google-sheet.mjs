// sync-google-sheet.mjs — 自動下載助理共用的 Google 試算表 → 下單Excel\ 資料夾
//
// 取代「主上手動下載 xlsx」這一步。下載後的匯入流程完全不變：
//   app 設定頁 →「掃描並套用 Excel」（既有按鈕、既有防護：不覆蓋手動編輯值）
//
// 認證：重用診所業績-app 的 Google OAuth 憑證（drive.readonly scope）
//   .secrets/oauth-client.json — OAuth client（Desktop App）
//   .secrets/oauth-token.json  — refresh token（已授權過、headless 可用）
//   兩檔已 gitignore、絕不 commit（repo 有 GitHub remote）
//
// 零依賴：純 REST（refresh token 換 access token + Drive files.export）、不裝 googleapis
//
// 用法：node scripts/sync-google-sheet.mjs
// 排程：Task Scheduler 每天 21:30（見 scripts/sync-google-sheet.bat）
//
// 失敗行為：exit(1) + logs/sheet-sync-FAILED-<date>.flag（照 backup-from-nas 的慣例、可被監控掃）

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 設定 ────────────────────────────────────────────────
// 試算表：「2026/01/28~診所接手生產列印名單」（助理共用編輯）
const SPREADSHEET_ID = '14lyzt_oNrK79-RsA1KqnRBC-RknLKewZPB1TW-A9QjI';
// 落地位置 = app Excel 匯入掃描的資料夾、檔名跟手動下載一致（匯入邏輯認得）
const OUT_DIR = 'D:\\診所nas 矯正追蹤\\SynologyDrive\\下單Excel';
const OUT_FILE = path.join(OUT_DIR, '2026_01_28~診所接手生產列印名單.xlsx');

const CLIENT_FILE = path.join(ROOT, '.secrets', 'oauth-client.json');
const TOKEN_FILE = path.join(ROOT, '.secrets', 'oauth-token.json');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LOG_DIR = path.join(ROOT, 'logs');

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function fail(msg) {
  console.error(`[${ts()}] ❌ ${msg}`);
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await fsp.writeFile(
      path.join(LOG_DIR, `sheet-sync-FAILED-${day}.flag`),
      `${ts()} ${msg}\n`,
      { flag: 'a' },
    );
  } catch {
    /* flag 寫不進去也要 exit(1) */
  }
  process.exit(1);
}

async function getAccessToken() {
  if (!fs.existsSync(CLIENT_FILE)) await fail(`缺 ${CLIENT_FILE}（從診所業績-app/.secrets/ 複製）`);
  if (!fs.existsSync(TOKEN_FILE)) await fail(`缺 ${TOKEN_FILE}（從診所業績-app/.secrets/ 複製）`);

  const rawClient = JSON.parse(await fsp.readFile(CLIENT_FILE, 'utf8'));
  const client = rawClient.installed || rawClient.web || rawClient;
  const token = JSON.parse(await fsp.readFile(TOKEN_FILE, 'utf8'));
  if (!token.refresh_token) await fail('oauth-token.json 缺 refresh_token');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    await fail(`refresh token 換 access token 失敗 HTTP ${resp.status}：${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.access_token;
}

async function main() {
  console.log(`[${ts()}] [1/3] 換 access token…`);
  const accessToken = await getAccessToken();

  console.log(`[${ts()}] [2/3] 匯出試算表 → xlsx…`);
  const url = `https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    await fail(`Drive export 失敗 HTTP ${resp.status}：${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());

  // 守門：空檔 / 太小（正常 ~320KB）不落地、不蓋掉舊檔
  if (buf.length < 50 * 1024) {
    await fail(`下載內容異常小（${buf.length} bytes、正常 ~320KB）、不覆蓋舊檔`);
  }
  // xlsx magic bytes：PK\x03\x04
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    await fail('下載內容不是 xlsx（magic bytes 不符）、不覆蓋舊檔');
  }

  console.log(`[${ts()}] [3/3] 寫檔（先 tmp 再 rename、避免 Drive sync 抓到半寫檔）…`);
  if (!fs.existsSync(OUT_DIR)) await fail(`落地資料夾不存在：${OUT_DIR}（Drive sync 沒跑？）`);
  const tmp = OUT_FILE + '.tmp';
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, OUT_FILE);

  console.log(`[${ts()}] ✓ 完成：${OUT_FILE}（${(buf.length / 1024).toFixed(0)} KB）`);
  console.log('  下一步：app 設定頁 →「掃描並套用 Excel」即可匯入最新資料');
}

main().catch((e) => fail(e?.stack || String(e)));
