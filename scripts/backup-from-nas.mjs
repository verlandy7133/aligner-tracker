#!/usr/bin/env node
// aligner-tracker 自動備份 — fetch NAS server 全部資料、存 JSON
//
// 流程：
//   0. 讀帳密 → POST /api/auth/login 拿 JWT（v0.6.1 起 /api/patients 需權限）
//   1. GET /api/patients, /api/orders, /api/settings（帶 Authorization: Bearer）
//   2. 包成 BackupFile JSON（沿用 sync.json v2 格式）
//   3. 存到本機（+ 選配非雲端異地路徑）；空備份 / 失敗會叫、不覆蓋舊備份
//   4. 保留最近 30 天、超過自動清
//
// 排程：D 機 Windows Task Scheduler、每天 23:30
//
// 環境變數：
//   NAS_API          (default 'http://100.115.111.45:8080' Tailscale IP)
//   NAS_LAN_FALLBACK (default 'http://192.168.0.220:8080' 診所內 LAN、Tailscale 連不上時備援)
//   BACKUP_USER      (必填) 備份專用最小權限帳號（patient.view + order.view）
//   BACKUP_PASS      (必填) 該帳號密碼
//   BACKUP_LOCAL     (default 'D:\\dev\\矯正追蹤-app\\backups') 本機備份
//   BACKUP_OFFSITE   (選配) 第二份異地備份路徑；**不可指向 Dropbox / 雲端同步夾**（含 PII、鐵律禁止）
//                    未設 → 只寫本機、log 標「無異地備份」；指到含 Dropbox 字樣 → 直接 exit(1) 拒絕
//   RETENTION_DAYS   (default 30)
//
// 帳密來源：環境變數（Task Scheduler action），或 scripts/.backup-env（KEY=VALUE、已 gitignore、不進 Dropbox）
// 注意：v0.6.8 起「移除明文個資寫 Dropbox」— 矯正病患資料一律不進 Dropbox。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 極簡 dotenv：載入 scripts/.backup-env（若存在、且該 env 尚未設）──
// 格式：每行 KEY=VALUE；# 開頭為註解。此檔含帳密、必須 gitignore、不進 Dropbox。
(function loadBackupEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const envFile = path.join(here, '.backup-env');
    if (!fs.existsSync(envFile)) return;
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const k = s.slice(0, eq).trim();
      const v = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* 讀不到就算了、後面缺帳密會 exit(1) */ }
})();

const NAS_API = process.env.NAS_API || 'http://100.115.111.45:8080';
const NAS_LAN = process.env.NAS_LAN_FALLBACK || 'http://192.168.0.220:8080';
const BACKUP_USER = process.env.BACKUP_USER || '';
const BACKUP_PASS = process.env.BACKUP_PASS || '';
const BACKUP_LOCAL = process.env.BACKUP_LOCAL || 'D:\\dev\\矯正追蹤-app\\backups';
const BACKUP_OFFSITE = process.env.BACKUP_OFFSITE || '';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 30;
const LOG_DIR = process.env.BACKUP_LOG_DIR || 'D:\\dev\\矯正追蹤-app\\logs';

// login 後填入、給 fetchWithFallback 帶 Authorization 用
let TOKEN = '';

// 同時把 stdout 寫到 log 檔（給 Task Scheduler 排程跑時看）
const dateStr = new Date().toISOString().slice(0, 10);
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `backup-${dateStr}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalWrite(chunk, ...args);
};
const originalErrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalErrWrite(chunk, ...args);
};

// 清舊 log（30 天前）
try {
  for (const f of fs.readdirSync(LOG_DIR)) {
    if (!/^backup-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
    const stat = fs.statSync(path.join(LOG_DIR, f));
    if (Date.now() - stat.mtimeMs > 30 * 24 * 60 * 60 * 1000) {
      fs.unlinkSync(path.join(LOG_DIR, f));
    }
  }
} catch {}

function color(c, s) {
  const codes = { cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${codes[c] || ''}${s}${codes.reset}`;
}

function authHeaders() {
  return TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};
}

async function fetchWithFallback(p) {
  // GET + 帶 JWT（v0.6.1 起 /api/patients 等需權限）。先試 Tailscale、再 LAN fallback。
  try {
    const r = await fetch(NAS_API + p, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (r.ok) return await r.json();
    throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.log(color('gray', `  (Tailscale ${NAS_API} 不通: ${e.message}、試 LAN fallback)`));
    const r = await fetch(NAS_LAN + p, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`兩條路都不通：LAN ${NAS_LAN}${p} → HTTP ${r.status}`);
    return await r.json();
  }
}

// login 也走 Tailscale → LAN fallback。成功回 token 字串。
async function loginWithFallback(username, password) {
  const body = JSON.stringify({ username, password });
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  };
  const tryOne = async (base) => {
    const r = await fetch(base + '/api/auth/login', opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}${j?.message ? ' ' + j.message : ''}`);
    const token = j?.data?.token;
    if (!token) throw new Error('login 回應無 token');
    return token;
  };
  try {
    return await tryOne(NAS_API);
  } catch (e) {
    console.log(color('gray', `  (Tailscale login 不通: ${e.message}、試 LAN fallback)`));
    return await tryOne(NAS_LAN);
  }
}

// 失敗旗標：無論被 .bat 或直接 node 呼叫、只要失敗就留痕（vault 監控可掃）、不再靜默 60 天。
function writeFailFlag(reason) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const d = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(LOG_DIR, `backup-FAILED-${d}.flag`),
      `${new Date().toISOString()}  aligner 備份失敗：${reason}\n`,
      'utf8',
    );
  } catch { /* 連 flag 都寫不出就只能靠 stderr */ }
}

function failExit(reason) {
  console.error(color('red', `❌ ${reason}`));
  writeFailFlag(reason);
  process.exit(1);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeBackup(dir, filename, payload) {
  ensureDir(dir);
  const full = path.join(dir, filename);
  fs.writeFileSync(full, JSON.stringify(payload, null, 2), 'utf8');
  const sizeKb = (fs.statSync(full).size / 1024).toFixed(0);
  console.log(color('green', `  ✓ ${full} (${sizeKb} KB)`));
  return full;
}

function cleanOld(dir, retentionDays) {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(dir)
    .filter((f) => /^aligner-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter(({ mtime }) => mtime < cutoff);
  for (const { f } of entries) {
    fs.unlinkSync(path.join(dir, f));
    console.log(color('gray', `  清舊：${f}`));
  }
}

async function main() {
  const startedAt = new Date();
  console.log('');
  console.log(color('cyan', '╔══════════════════════════════════════════╗'));
  console.log(color('cyan', '║  aligner-tracker NAS 自動備份             ║'));
  console.log(color('cyan', '╚══════════════════════════════════════════╝'));
  console.log(color('gray', `  ${startedAt.toISOString()}`));
  console.log('');

  // ─── [0/4] login 拿 JWT ─────────────────────────────
  if (!BACKUP_USER || !BACKUP_PASS) {
    failExit('缺 BACKUP_USER / BACKUP_PASS（設環境變數或 scripts/.backup-env）。備份帳號需 patient.view + order.view 最小權限。');
  }
  // 異地路徑防呆：矯正個資鐵律禁止進 Dropbox / 雲端同步夾
  if (BACKUP_OFFSITE && /dropbox/i.test(BACKUP_OFFSITE)) {
    failExit(`BACKUP_OFFSITE 指向含「Dropbox」字樣的路徑（${BACKUP_OFFSITE}）— 矯正病患資料禁止進 Dropbox。請改用本地/外接非同步路徑，或先加密再落地（金鑰另存）。`);
  }
  console.log(color('yellow', '[0/4] login 取得 token...'));
  try {
    TOKEN = await loginWithFallback(BACKUP_USER, BACKUP_PASS);
    console.log(color('gray', `  ✓ login 成功（帳號 ${BACKUP_USER}）`));
  } catch (e) {
    failExit(`login 失敗：${e.message}（檢查帳號 ${BACKUP_USER} 是否存在、密碼是否正確、帳號是否啟用）`);
  }
  console.log('');

  console.log(color('yellow', '[1/4] fetch NAS server 全部資料...'));
  const [health, patientsRsp, ordersRsp, settingsRsp] = await Promise.all([
    fetchWithFallback('/api/health'),
    fetchWithFallback('/api/patients'),
    fetchWithFallback('/api/orders'),
    fetchWithFallback('/api/settings'),
  ]);
  const patients = patientsRsp.data || [];
  const orders = ordersRsp.data || [];
  const settings = settingsRsp.data || [];
  console.log(color('gray', `  patients: ${patients.length}, orders: ${orders.length}, settings: ${settings.length}`));
  console.log(color('gray', `  server version: ${health.version}`));
  console.log('');

  // 空備份守門：0 筆病患視為失敗、不覆蓋舊備份（防靜默寫出空「成功」檔）
  if (patients.length === 0) {
    failExit('抓到 0 筆病患 — 視為失敗、不寫出空備份（避免覆蓋掉最後一份可用備份）。');
  }

  console.log(color('yellow', '[2/4] 包 BackupFile JSON...'));
  // 沿用 src/lib/backup.ts 的 BackupFile v2 格式
  // sourceFolder / consentPdfPath 是 absolute path（從 server denormalize 後拿到）
  // 還原時可走相反流程（dataLayer.bulkPutPatients 會 normalize 回 relative）
  const backup = {
    version: 2,
    exportedAt: startedAt.toISOString(),
    appVersion: health.version || '0.6.0-dev',
    source: 'nas-auto-backup',
    counts: {
      patients: patients.length,
      orders: orders.length,
      settings: settings.length,
    },
    patients,
    orders,
    settings,
  };
  console.log('');

  console.log(color('yellow', '[3/4] 寫到本機' + (BACKUP_OFFSITE ? ' + 異地' : '（無異地備份）') + '...'));
  const dateStr = startedAt.toISOString().slice(0, 10);
  const filename = `aligner-tracker-backup-${dateStr}.json`;
  const written = [];
  try {
    written.push(writeBackup(BACKUP_LOCAL, filename, backup));
  } catch (e) {
    console.error(color('red', `  ✗ 本機寫入失敗：${e.message}`));
  }
  if (BACKUP_OFFSITE) {
    try {
      written.push(writeBackup(BACKUP_OFFSITE, filename, backup));
    } catch (e) {
      console.error(color('red', `  ✗ 異地寫入失敗：${e.message}`));
    }
  } else {
    console.log(color('gray', '  （未設 BACKUP_OFFSITE、只寫本機一份、無異地備援）'));
  }
  if (written.length === 0) {
    failExit('所有備份位置都寫入失敗、abort。');
  }
  console.log('');

  console.log(color('yellow', `[4/4] 清超過 ${RETENTION_DAYS} 天的舊備份...`));
  cleanOld(BACKUP_LOCAL, RETENTION_DAYS);
  if (BACKUP_OFFSITE) cleanOld(BACKUP_OFFSITE, RETENTION_DAYS);
  console.log('');

  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(color('green', '╔══════════════════════════════════════════╗'));
  console.log(color('green', `║  ✓ 備份完成 (${elapsed}s)                    ║`));
  console.log(color('green', '╚══════════════════════════════════════════╝'));
}

main().catch((e) => {
  console.error('');
  console.error(color('red', '❌ 備份失敗：'), e.message);
  console.error(e.stack);
  writeFailFlag(e.message);
  process.exit(1);
});
