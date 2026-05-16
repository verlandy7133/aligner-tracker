#!/usr/bin/env node
// aligner-tracker 自動備份 — fetch NAS server 全部資料、存 JSON
//
// 流程：
//   1. GET /api/patients, /api/orders, /api/settings
//   2. 包成 BackupFile JSON（沿用 sync.json v2 格式）
//   3. 存到本機 + Dropbox 兩份
//   4. 保留最近 30 天、超過自動清
//
// 排程：D 機 Windows Task Scheduler、每天 23:30
//
// 環境變數：
//   NAS_API          (default 'http://100.115.111.45:8080' Tailscale IP)
//   NAS_LAN_FALLBACK (default 'http://192.168.0.220:8080' 診所內 LAN、Tailscale 連不上時備援)
//   BACKUP_LOCAL     (default 'D:\\dev\\矯正追蹤-app\\backups')
//   BACKUP_DROPBOX   (default 'D:\\Dropbox\\Dropbox\\矯正追蹤備份')
//   RETENTION_DAYS   (default 30)

import fs from 'node:fs';
import path from 'node:path';

const NAS_API = process.env.NAS_API || 'http://100.115.111.45:8080';
const NAS_LAN = process.env.NAS_LAN_FALLBACK || 'http://192.168.0.220:8080';
const BACKUP_LOCAL = process.env.BACKUP_LOCAL || 'D:\\dev\\矯正追蹤-app\\backups';
const BACKUP_DROPBOX = process.env.BACKUP_DROPBOX || 'D:\\Dropbox\\Dropbox\\矯正追蹤備份';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 30;
const LOG_DIR = process.env.BACKUP_LOG_DIR || 'D:\\dev\\矯正追蹤-app\\logs';

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

async function fetchWithFallback(p) {
  // 先試 Tailscale
  try {
    const r = await fetch(NAS_API + p, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return await r.json();
    throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.log(color('gray', `  (Tailscale ${NAS_API} 不通: ${e.message}、試 LAN fallback)`));
    const r = await fetch(NAS_LAN + p, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`兩條路都不通：LAN ${NAS_LAN}${p} → HTTP ${r.status}`);
    return await r.json();
  }
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

  console.log(color('yellow', '[3/4] 寫到本機 + Dropbox...'));
  const dateStr = startedAt.toISOString().slice(0, 10);
  const filename = `aligner-tracker-backup-${dateStr}.json`;
  const written = [];
  try {
    written.push(writeBackup(BACKUP_LOCAL, filename, backup));
  } catch (e) {
    console.error(color('red', `  ✗ 本機寫入失敗：${e.message}`));
  }
  try {
    written.push(writeBackup(BACKUP_DROPBOX, filename, backup));
  } catch (e) {
    console.error(color('red', `  ✗ Dropbox 寫入失敗：${e.message}`));
  }
  if (written.length === 0) {
    console.error(color('red', '兩個位置都失敗、abort'));
    process.exit(1);
  }
  console.log('');

  console.log(color('yellow', `[4/4] 清超過 ${RETENTION_DAYS} 天的舊備份...`));
  cleanOld(BACKUP_LOCAL, RETENTION_DAYS);
  cleanOld(BACKUP_DROPBOX, RETENTION_DAYS);
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
  process.exit(1);
});
