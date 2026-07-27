#!/usr/bin/env node
// auto-import-excel.mjs — 把 app 設定頁「掃描並套用 Excel」按鈕 headless 化
//
// 取代主上每天人工去 app 按按鈕這一步。上游是 sync-google-sheet.mjs（每天 11:30
// 下載助理共用的 Google 試算表 → 下單Excel\）；本腳本每天 12:00 接手匯入 NAS DB。
//
// 流程（跟 app 按鈕同一條路、解析規則完全重用既有 python）：
//   1. spawn python scripts/import-clinic-takeover.py 解析 xlsx → JSON
//      （在隔離工作目錄跑、不覆寫 app 自己的 dev-data/excel-*.json）
//   2. login NAS API 拿 JWT（scripts/.sync-env 的 SYNC_USER / SYNC_PASS）
//   3. GET /api/patients + /api/orders 全量
//   4. 照 src/lib/reapply-excel.ts 的「補空原則」逐筆比對 → PATCH / POST
//
// 補空原則（❗永遠不覆蓋 DB 已有的非空值）：
//   - doctor / scanInfo            → DB 空字串或 null 才填
//   - totalAlignersUpper / Lower   → DB null 才填
//   - currentAlignerUpper / Lower  → DB null 才填（從 orders 推算）
//   - track                        → DB null 才填
//   - refinementLevel              → DB null 或 0 才填
//   - hasConsent                   → 只做 false → true 單向升級
//   - 新病患                        → DB 沒這人才建
//   - 新下單                        → DB 沒這筆才建
//
// 用法：
//   node scripts/auto-import-excel.mjs --dry-run   （只印會做什麼、不寫入）
//   node scripts/auto-import-excel.mjs             （真的寫入）
//
// 排程：Task Scheduler「AlignerExcelImport」每天 12:00（見 scripts/auto-import-excel.bat）
//
// 失敗行為：exit(1) + logs/excel-import-FAILED-<date>.flag（照 backup-from-nas 慣例、可被監控掃）
// 個資：log 只印統計數與 chartNo，不印病患全名清單。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── 極簡 dotenv：載入 scripts/.sync-env（照 .backup-env 慣例）───────────
// 格式：每行 KEY=VALUE；# 開頭註解。此檔含帳密、已 gitignore、不進 Dropbox。
(function loadSyncEnv() {
  try {
    const envFile = path.join(__dirname, '.sync-env');
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
  } catch {
    /* 讀不到就算了、後面缺帳密會處理 */
  }
})();

const NAS_API = process.env.NAS_API || 'http://100.115.111.45:8080';
const NAS_LAN = process.env.NAS_LAN_FALLBACK || 'http://192.168.0.220:8080';
const SYNC_USER = process.env.SYNC_USER || '';
const SYNC_PASS = process.env.SYNC_PASS || '';

const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'excel-import.log');
const PATHS_FILE = path.join(ROOT, 'dev-data', 'clinic-paths.json');
const PATIENTS_JSON = path.join(ROOT, 'dev-data', 'patients-import.json');
// 隔離工作目錄：python 的輸出路徑是相對 cwd 的 dev-data/，用獨立 cwd 就不會蓋掉
// app 自己那份 dev-data/excel-*.json（手動按鈕的狀態要保持不變）
const WORK_DIR = path.join(ROOT, 'dev-data', '.auto-import-work');
const TAKEOVER_PY = path.join(ROOT, 'scripts', 'import-clinic-takeover.py');

let TOKEN = '';

// ─── log ────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

let logStream = null;
function openLog() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
}

function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function writeFailFlag(reason) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const d = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(LOG_DIR, `excel-import-FAILED-${d}.flag`),
      `${new Date().toISOString()}  Excel 自動匯入失敗：${reason}\n`,
      'utf8',
    );
  } catch {
    /* 連 flag 都寫不出就只能靠 stderr */
  }
}

function fail(reason) {
  const line = `[${ts()}] ❌ ${reason}`;
  console.error(line);
  if (logStream) logStream.write(line + '\n');
  writeFailFlag(reason);
  process.exit(1);
}

// ─── NAS API ────────────────────────────────────────────────────────────
async function loginWithFallback(username, password) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  };
  const tryOne = async (base) => {
    const r = await fetch(base + '/api/auth/login', opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}${j?.message ? ' ' + j.message : ''}`);
    const token = j?.data?.token;
    if (!token) throw new Error('login 回應無 token');
    return { token, permissions: j?.data?.user?.permissions ?? [] };
  };
  try {
    return await tryOne(NAS_API);
  } catch (e) {
    log(`  (Tailscale login 不通：${e.message}、試 LAN fallback)`);
    return await tryOne(NAS_LAN);
  }
}

// 帶 JWT 的 request，Tailscale → LAN fallback。回 { ok, status, json }
async function api(method, pathPart, body) {
  const opts = {
    method,
    headers: {
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  };
  let r;
  try {
    r = await fetch(NAS_API + pathPart, opts);
  } catch (e) {
    r = await fetch(NAS_LAN + pathPart, { ...opts, signal: AbortSignal.timeout(20000) });
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

// ─── 從資料夾名解析姓名 / 生日（移植 src/lib/parse-folder-name.ts）─────
const STATUS_PREFIXES = ['[結束]', '[中斷]', '[隱適美]', '[綻雅]', '[維持器]', '[待確認]'];

function rocBirthdayToISO(rocStr) {
  if (!/^\d{6,7}$/.test(rocStr)) return null;
  let year, month, day;
  if (rocStr.length === 6) {
    year = parseInt(rocStr.slice(0, 2), 10) + 1911;
    month = parseInt(rocStr.slice(2, 4), 10);
    day = parseInt(rocStr.slice(4, 6), 10);
  } else {
    year = parseInt(rocStr.slice(0, 3), 10) + 1911;
    month = parseInt(rocStr.slice(3, 5), 10);
    day = parseInt(rocStr.slice(5, 7), 10);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseFolderName(folderName) {
  let inner = folderName.trim();
  for (const prefix of STATUS_PREFIXES) {
    if (inner.startsWith(prefix + ' ')) {
      inner = inner.slice(prefix.length + 1);
      break;
    } else if (inner.startsWith(prefix)) {
      inner = inner.slice(prefix.length).trim();
      break;
    }
  }
  let rocBirth = null;
  let name = null;
  let m = inner.match(/^(\d{7})\s*(.+)$/) || inner.match(/^(\d{6})\s*(.+)$/);
  if (m) {
    rocBirth = m[1];
    const rest = m[2].trim();
    const nameMatch = rest.match(/^([一-龥]+)/);
    if (nameMatch) name = nameMatch[1].length > 4 ? nameMatch[1].slice(0, 4) : nameMatch[1];
  } else {
    m = inner.match(/^([一-龥]+)(\d{7})/) || inner.match(/^([一-龥]+)(\d{6})/);
    if (m) {
      name = m[1].length > 4 ? m[1].slice(0, 4) : m[1];
      rocBirth = m[2];
    }
  }
  return { name: name ?? '', birthday: rocBirth ? rocBirthdayToISO(rocBirth) : null };
}

// ─── alignerRange 解析（移植 src/lib/reapply-excel.ts）──────────────────
function parseAlignerRangeMax(range) {
  if (!range) return { upper: null, lower: null };
  let upper = null;
  let lower = null;
  for (const seg of range.split('+')) {
    const m = seg.match(/^(UL|U|L)(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const prefix = m[1];
    const max = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
    if (prefix === 'UL') {
      if (upper == null || max > upper) upper = max;
      if (lower == null || max > lower) lower = max;
    } else if (prefix === 'U') {
      if (upper == null || max > upper) upper = max;
    } else if (prefix === 'L') {
      if (lower == null || max > lower) lower = max;
    }
  }
  return { upper, lower };
}

function deriveCurrentFromOrders(orders) {
  if (!orders.length) return { upper: null, lower: null };
  const completed = orders.filter(
    (o) => o.progress === '已完成' || o.progress === '診所已收到牙套',
  );
  const pool = completed.length > 0 ? completed : orders;
  let upper = null;
  let lower = null;
  for (const o of pool) {
    const m = parseAlignerRangeMax(o.alignerRange ?? '');
    if (m.upper != null && (upper == null || m.upper > upper)) upper = m.upper;
    if (m.lower != null && (lower == null || m.lower > lower)) lower = m.lower;
  }
  return { upper, lower };
}

// ─── 1. 跑 python 解析 xlsx ─────────────────────────────────────────────
function resolveExcelFolder() {
  if (process.env.ALIGNER_EXCEL_FOLDER) return process.env.ALIGNER_EXCEL_FOLDER;
  try {
    const cfg = JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8'));
    if (cfg.dataRoot) return path.join(cfg.dataRoot, '下單Excel');
  } catch {
    /* 沒設定檔就 fallback */
  }
  return 'D:\\診所nas 矯正追蹤\\SynologyDrive\\下單Excel';
}

function resolveDataRoot() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8'));
    if (cfg.dataRoot) return cfg.dataRoot;
  } catch {
    /* ignore */
  }
  return 'D:\\診所nas 矯正追蹤\\SynologyDrive';
}

async function runParser(excelFolder) {
  // 隔離工作目錄：python 讀 dev-data/patients-import.json、寫 dev-data/excel-*.json（皆相對 cwd）
  const workData = path.join(WORK_DIR, 'dev-data');
  await fsp.mkdir(workData, { recursive: true });
  if (!fs.existsSync(PATIENTS_JSON)) {
    fail(`缺 ${PATIENTS_JSON}（python 匹配病患要用；請先在 app 跑一次「重新掃描資料夾」）`);
  }
  await fsp.copyFile(PATIENTS_JSON, path.join(workData, 'patients-import.json'));

  const exitCode = await new Promise((resolve) => {
    const p = spawn('python', [TAKEOVER_PY], {
      cwd: WORK_DIR,
      env: { ...process.env, ALIGNER_EXCEL_FOLDER: excelFolder, PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      // python 的統計輸出是數字為主、沒有病患全名清單 → 可安全進 log
      for (const line of out.split(/\r?\n/)) if (line.trim()) log('  py| ' + line.trim());
      if (err.trim()) for (const line of err.split(/\r?\n/)) if (line.trim()) log('  py!| ' + line.trim());
      resolve(code);
    });
    p.on('error', (e) => {
      log(`  py 啟動失敗：${e.message}`);
      resolve(-1);
    });
  });
  if (exitCode !== 0) fail(`python 解析失敗（exit ${exitCode}）— 不動 DB`);

  const orders = JSON.parse(await fsp.readFile(path.join(workData, 'excel-orders.json'), 'utf8'));
  const updates = JSON.parse(
    await fsp.readFile(path.join(workData, 'excel-patient-updates.json'), 'utf8'),
  );
  return { excelOrders: orders.orders ?? [], updateData: updates };
}

// ─── main ───────────────────────────────────────────────────────────────
async function main() {
  openLog();
  log('════════ Excel 自動匯入' + (DRY_RUN ? '（--dry-run、不寫入）' : '') + ' ════════');

  // ── [1/5] 解析 xlsx ──
  const excelFolder = resolveExcelFolder();
  log(`[1/5] python 解析 xlsx（資料夾 ${excelFolder}）…`);
  if (!fs.existsSync(excelFolder)) fail(`Excel 資料夾不存在：${excelFolder}`);
  const { excelOrders, updateData } = await runParser(excelFolder);
  const excelUpdates = updateData.updates ?? [];
  const excelNewPatients = updateData.newPatients ?? [];

  // 空資料守門：解析不出病患視為異常、不動 DB
  const parsedPatients = excelUpdates.length + excelNewPatients.length;
  if (parsedPatients === 0) {
    fail(`xlsx 解析出 0 位病患 — 視為異常（Excel 壞檔 / 分頁改名？）、不動 DB`);
  }
  if (excelOrders.length === 0) {
    fail(`xlsx 解析出 0 筆下單 — 視為異常、不動 DB`);
  }
  log(
    `  ✓ 解析完成：病患 ${parsedPatients} 位（既有 ${excelUpdates.length} + Excel 新增 ${excelNewPatients.length}）、下單 ${excelOrders.length} 筆`,
  );

  // ── [2/5] 掃病患資料夾（給 Excel 新病患補生日 / sourceFolder）──
  const folderMap = new Map();
  try {
    const folderRoot = path.join(resolveDataRoot(), '病患資料夾');
    if (fs.existsSync(folderRoot)) {
      for (const entry of await fsp.readdir(folderRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const parsed = parseFolderName(entry.name);
        if (!parsed.name) continue;
        if (!folderMap.has(parsed.name)) folderMap.set(parsed.name, []);
        folderMap.get(parsed.name).push({
          birthday: parsed.birthday,
          folderPath: path.join(folderRoot, entry.name),
        });
      }
    }
  } catch {
    /* folderMap 留空、不擋主邏輯 */
  }
  log(`[2/5] 病患資料夾索引：${folderMap.size} 個唯一姓名`);

  // 用 folderMap 幫 Excel 新病患補生日 + sourceFolder（唯一 match 才補、同名不動）
  for (const np of excelNewPatients) {
    if (!np.name) continue;
    if (np.birthday && np.sourceFolder) continue;
    const matches = folderMap.get(np.name) ?? [];
    if (matches.length !== 1) continue;
    if (!np.birthday && matches[0].birthday) np.birthday = matches[0].birthday;
    if (!np.sourceFolder && matches[0].folderPath) np.sourceFolder = matches[0].folderPath;
  }

  // ── [3/5] login ──
  // 離線快照試算（--dry-run + AUTO_IMPORT_DB_SNAPSHOT）不需要帳號、直接跳過 login
  const OFFLINE_SNAPSHOT = DRY_RUN && !!process.env.AUTO_IMPORT_DB_SNAPSHOT;
  if (OFFLINE_SNAPSHOT) {
    log('[3/5] 離線快照模式、跳過 login');
  } else if (!SYNC_USER || !SYNC_PASS) {
    if (DRY_RUN) {
      log('[3/5] ⚠️ 無帳號（scripts/.sync-env 不存在或缺 SYNC_USER / SYNC_PASS）、僅解析');
      log('');
      log('──── dry-run 統計（無帳號、僅解析階段）────');
      log(`  Excel 解析病患：${parsedPatients} 位`);
      log(`    ├ 對得到既有病患（會逐欄補空）：${excelUpdates.length} 位`);
      log(`    └ Excel 獨有、DB 可能沒有：${excelNewPatients.length} 位`);
      const withBday = excelNewPatients.filter((p) => p.birthday).length;
      log(`        ├ 補到生日（可安全比對、不會重複建）：${withBday} 位`);
      log(`        └ 無生日（只能靠姓名比對）：${excelNewPatients.length - withBday} 位`);
      log(`  Excel 解析下單：${excelOrders.length} 筆`);
      const byProgress = {};
      for (const o of excelOrders) byProgress[o.progress] = (byProgress[o.progress] ?? 0) + 1;
      for (const [k, v] of Object.entries(byProgress).sort((a, b) => b[1] - a[1])) {
        log(`    · ${k}：${v} 筆`);
      }
      const fieldStats = { doctor: 0, scanInfo: 0, totalAligners: 0, hasConsent: 0 };
      for (const u of excelUpdates) {
        if (u.doctor) fieldStats.doctor++;
        if (u.scanInfo) fieldStats.scanInfo++;
        if (u.totalAlignersUpper != null || u.totalAlignersLower != null) fieldStats.totalAligners++;
        if (u.hasConsent === true) fieldStats.hasConsent++;
      }
      log(`  Excel 帶有值的欄位（實際會不會寫要看 DB 是否已有值）：`);
      log(`    · 醫師 ${fieldStats.doctor} 位 · 口掃 ${fieldStats.scanInfo} 位`);
      log(`    · 總副數 ${fieldStats.totalAligners} 位 · 授權書=有 ${fieldStats.hasConsent} 位`);
      log('');
      log('  ⚠️ 未登入 NAS、未比對 DB → 以上是「Excel 端」數字、不是「會寫入」數字。');
      log('     要看真正的寫入計畫：建好 sync 帳號 + scripts/.sync-env 後再跑一次 --dry-run。');
      log('════════ dry-run 結束（無寫入）════════');
      return;
    }
    fail('缺 SYNC_USER / SYNC_PASS（設環境變數或 scripts/.sync-env）。用 scripts/create-sync-account.mjs 建帳號。');
  }

  if (!OFFLINE_SNAPSHOT) {
    log(`[3/5] login NAS API（帳號 ${SYNC_USER}）…`);
    let perms = [];
    try {
      const r = await loginWithFallback(SYNC_USER, SYNC_PASS);
      TOKEN = r.token;
      perms = r.permissions;
    } catch (e) {
      fail(`login 失敗：${e.message}（檢查帳號 ${SYNC_USER} 是否存在 / 密碼 / 是否啟用）`);
    }
    const NEED = ['patient.view', 'patient.create', 'patient.edit', 'order.view', 'order.create'];
    const missing = NEED.filter((p) => !perms.includes(p));
    if (missing.length) fail(`帳號 ${SYNC_USER} 缺權限：${missing.join(', ')}`);
    log(`  ✓ login 成功（權限 ${perms.length} 項）`);
  }

  // ── [4/5] 抓 DB 全量 + 算計畫 ──
  const { dbPatients, dbOrders } = await loadDbSnapshot();
  if (dbPatients.length === 0) {
    fail('DB 回 0 位病患 — 視為異常（server 剛起來 / DB 沒掛上？）、不動 DB');
  }

  // 索引
  const dbById = new Map(dbPatients.map((p) => [p.id, p]));
  const dbByNameBirthday = new Map();
  const dbByName = new Map();
  for (const p of dbPatients) {
    if (p.name && p.birthday) dbByNameBirthday.set(`${p.name}|${p.birthday}`, p);
    if (p.name) {
      if (!dbByName.has(p.name)) dbByName.set(p.name, []);
      dbByName.get(p.name).push(p);
    }
  }
  // patients-import.json：update.id → name/birthday（scan 重產 UUID 時的 fallback）
  const importById = new Map();
  try {
    const pi = JSON.parse(await fsp.readFile(PATIENTS_JSON, 'utf8'));
    for (const p of pi.patients ?? []) importById.set(p.id, p);
  } catch {
    /* 沒有就只靠 refName/refBirthday */
  }
  // python 這次跑出來的新病患：id → 物件（order.patientId 對映要用）
  const newPatientById = new Map(excelNewPatients.map((p) => [p.id, p]));

  // 把 JSON 裡的 patientId 對映到 DB 實際 patient（對不到回 null）
  //   ① id 直接命中 → ② name+birthday → ③ 無生日時退回「姓名唯一」比對
  //
  // ❗Excel 新病患（newPatientById）必須跟「4b 新病患建立守則」用同一套判準，否則會
  //   出現「人被當新的建了、單卻掛到另一個同名舊病患」→ 隔天再跑就重複建單。
  //   規則：有生日 → 只認 name+birthday（對不到就是真新人、單掛到新建的那位）；
  //         無生日 → 才退回姓名唯一比對（跟建立守則的「同名就不敢建」一致）。
  function resolveDbPatient(jsonPid) {
    if (dbById.has(jsonPid)) return dbById.get(jsonPid);
    const fromNew = newPatientById.get(jsonPid);
    const ref = importById.get(jsonPid) ?? fromNew;
    if (!ref?.name) return null;
    if (ref.birthday) {
      const hit = dbByNameBirthday.get(`${ref.name}|${ref.birthday}`);
      if (hit) return hit;
      if (fromNew) return null; // 有生日卻對不到 → 這是真新人、交給 4b 建立
    }
    const sameName = dbByName.get(ref.name) ?? [];
    if (sameName.length === 1) return sameName[0];
    return null; // 0 筆 = 真新病患；2+ 筆同名 = 模糊、交給 ambiguous 處理
  }

  const plan = {
    patch: [], // { patient, fields, reasons }
    newPatients: [], // patient object
    newOrders: [], // order object
    skipped: {
      patientAllSet: 0,
      patientNotFound: 0,
      newPatientExisted: 0,
      newPatientAmbiguous: 0,
      orderExisted: 0,
      orderNoPatient: 0,
    },
    fieldCounts: {
      doctor: 0,
      scanInfo: 0,
      totalAligners: 0,
      hasConsent: 0,
      currentAligner: 0,
      track: 0,
      refinementLevel: 0,
    },
  };

  // 累積每位 DB 病患的待寫欄位（updates 階段 + derive 階段合併成一次 PATCH）
  const patchByPatientId = new Map();
  function stagePatch(patient, fields) {
    if (!patchByPatientId.has(patient.id)) {
      patchByPatientId.set(patient.id, { patient, fields: {} });
    }
    Object.assign(patchByPatientId.get(patient.id).fields, fields);
  }

  // ── 4a. updates → 補空 ──
  const isBlank = (v) => v == null || String(v).trim() === '';
  for (const u of excelUpdates) {
    let existing = dbById.get(u.id);
    if (!existing) {
      const refName = u.refName ?? importById.get(u.id)?.name ?? newPatientById.get(u.id)?.name;
      const refBirthday =
        u.refBirthday ?? importById.get(u.id)?.birthday ?? newPatientById.get(u.id)?.birthday;
      if (refName && refBirthday) existing = dbByNameBirthday.get(`${refName}|${refBirthday}`);
      if (!existing && refName) {
        const sameName = dbByName.get(refName) ?? [];
        if (sameName.length === 1) existing = sameName[0];
      }
    }
    if (!existing) {
      plan.skipped.patientNotFound++;
      continue;
    }
    const fields = {};
    // doctor / scanInfo：DB 空才填
    if (u.doctor && isBlank(existing.doctor)) {
      fields.doctor = u.doctor;
      plan.fieldCounts.doctor++;
    }
    if (u.scanInfo && isBlank(existing.scanInfo)) {
      fields.scanInfo = u.scanInfo;
      plan.fieldCounts.scanInfo++;
    }
    // totalAligners：DB null 才填（❗不覆蓋既有值 — 見檔頭補空原則）
    let totalTouched = false;
    if (u.totalAlignersUpper != null && existing.totalAlignersUpper == null) {
      fields.totalAlignersUpper = u.totalAlignersUpper;
      totalTouched = true;
    }
    if (u.totalAlignersLower != null && existing.totalAlignersLower == null) {
      fields.totalAlignersLower = u.totalAlignersLower;
      totalTouched = true;
    }
    if (totalTouched) plan.fieldCounts.totalAligners++;
    // hasConsent：只 false → true 單向升級
    if (u.hasConsent === true && existing.hasConsent === false) {
      fields.hasConsent = true;
      plan.fieldCounts.hasConsent++;
    }
    if (Object.keys(fields).length === 0) {
      plan.skipped.patientAllSet++;
      continue;
    }
    stagePatch(existing, fields);
  }

  // ── 4b. 新病患 ──
  // chartNo 由 DB 目前最大值往上長（python 是照 patients-import.json 算的、會跟 DB 撞號）
  let maxChart = 0;
  for (const p of dbPatients) {
    const n = parseInt(p.chartNo, 10);
    if (Number.isFinite(n) && n > maxChart) maxChart = n;
  }
  // 這一輪已排定要建的人（防同一次跑內重複建同名同生日）
  const stagedNew = new Map();
  for (const np of excelNewPatients) {
    if (dbById.has(np.id)) {
      plan.skipped.newPatientExisted++;
      continue;
    }
    if (np.name && np.birthday && dbByNameBirthday.has(`${np.name}|${np.birthday}`)) {
      plan.skipped.newPatientExisted++;
      continue;
    }
    // ❗無生日時的防重複建：DB 有同名的人就不建（寧可漏、不可每天重複長出同一人）
    if (np.name && !np.birthday) {
      const sameName = dbByName.get(np.name) ?? [];
      if (sameName.length > 0) {
        plan.skipped.newPatientAmbiguous++;
        continue;
      }
    }
    const key = `${np.name}|${np.birthday ?? ''}`;
    if (stagedNew.has(key)) {
      plan.skipped.newPatientExisted++;
      continue;
    }
    maxChart++;
    const enriched = {
      ...np,
      chartNo: String(maxChart).padStart(4, '0'),
      markdownNote: np.markdownNote ?? '',
      photos: np.photos ?? {},
    };
    stagedNew.set(key, enriched);
    plan.newPatients.push(enriched);
  }

  // ── 4c. 新下單 ──
  // 既有 order 索引：① id ② 自然鍵 patientId|alignerRange|date
  // 自然鍵是必要的：python 每次跑會給 Excel 新病患重生 uuid4、order id 內嵌該 uuid，
  // 只靠 id 比對會每天長出重複下單。自然鍵比 id 更嚴、只會少建不會多建。
  const dbOrderIds = new Set(dbOrders.map((o) => o.id));
  const dbOrderNatural = new Set(
    dbOrders.map((o) => `${o.patientId}|${o.alignerRange ?? ''}|${o.date ?? ''}`),
  );
  const stagedOrderNatural = new Set();
  for (const o of excelOrders) {
    let targetPatient = resolveDbPatient(o.patientId);
    let targetId = targetPatient?.id ?? null;
    let targetChartNo = targetPatient?.chartNo ?? null;
    if (!targetId) {
      // 可能對到這輪要新建的人
      const np = newPatientById.get(o.patientId);
      const staged = np ? stagedNew.get(`${np.name}|${np.birthday ?? ''}`) : null;
      if (staged) {
        targetId = staged.id;
        targetChartNo = staged.chartNo;
      }
    }
    if (!targetId) {
      plan.skipped.orderNoPatient++;
      continue;
    }
    const natural = `${targetId}|${o.alignerRange ?? ''}|${o.date ?? ''}`;
    if (dbOrderIds.has(o.id) || dbOrderNatural.has(natural) || stagedOrderNatural.has(natural)) {
      plan.skipped.orderExisted++;
      continue;
    }
    stagedOrderNatural.add(natural);
    plan.newOrders.push({
      ...o,
      id: `excel-${o.id.split('-')[1] ?? '0000'}-${targetId}`,
      patientId: targetId,
      patientChartNo: targetChartNo ?? o.patientChartNo,
    });
  }

  // ── 4d. 從 orders 推算 current / track / refinementLevel（一律只補空）──
  const ordersByPid = new Map();
  for (const o of [...dbOrders, ...plan.newOrders]) {
    if (!ordersByPid.has(o.patientId)) ordersByPid.set(o.patientId, []);
    ordersByPid.get(o.patientId).push(o);
  }
  for (const p of dbPatients) {
    const os = ordersByPid.get(p.id) ?? [];
    if (!os.length) continue;
    const derived = deriveCurrentFromOrders(os);
    const fields = {};
    if (derived.upper != null && p.currentAlignerUpper == null) fields.currentAlignerUpper = derived.upper;
    if (derived.lower != null && p.currentAlignerLower == null) fields.currentAlignerLower = derived.lower;
    if (fields.currentAlignerUpper != null || fields.currentAlignerLower != null) {
      plan.fieldCounts.currentAligner++;
    }
    const sorted = [...os].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const firstBatch = sorted[0]?.batchType ?? '';
    let newTrack = null;
    if (firstBatch === '新設計' || firstBatch === '新設計1') newTrack = 'new-design';
    else if (firstBatch === '舊設計' || firstBatch === '舊') newTrack = 'old-design';
    // ❗只補空：derived 為 null、或 DB 已有值 → 不動（避免每天把人工設好的流派洗掉）
    if (newTrack != null && p.track == null) {
      fields.track = newTrack;
      plan.fieldCounts.track++;
    }
    const refinementCount = sorted
      .slice(1)
      .filter((o) => o.batchType === '新設計' || o.batchType === '新設計1').length;
    const newLevel = Math.min(refinementCount, 3);
    if (newLevel > 0 && (p.refinementLevel == null || p.refinementLevel === 0)) {
      fields.refinementLevel = newLevel;
      plan.fieldCounts.refinementLevel++;
    }
    if (Object.keys(fields).length > 0) stagePatch(p, fields);
  }

  plan.patch = [...patchByPatientId.values()];

  // ── 印計畫 ──
  log('');
  log('──── 寫入計畫 ────');
  log(`  病患補空 PATCH：${plan.patch.length} 位`);
  log(
    `    · 醫師 +${plan.fieldCounts.doctor} · 口掃 +${plan.fieldCounts.scanInfo} · 總副數 +${plan.fieldCounts.totalAligners} · 授權書升級 +${plan.fieldCounts.hasConsent}`,
  );
  log(
    `    · 目前副數 +${plan.fieldCounts.currentAligner} · 流派 +${plan.fieldCounts.track} · 精調次數 +${plan.fieldCounts.refinementLevel}`,
  );
  log(`  新增病患：${plan.newPatients.length} 位`);
  log(`  新增下單：${plan.newOrders.length} 筆`);
  log(
    `  略過：全已設過 ${plan.skipped.patientAllSet} · 對不到病患 ${plan.skipped.patientNotFound} · 病患已存在 ${plan.skipped.newPatientExisted} · 同名無生日不敢建 ${plan.skipped.newPatientAmbiguous} · 下單已存在 ${plan.skipped.orderExisted} · 下單無對應病患 ${plan.skipped.orderNoPatient}`,
  );

  if (DRY_RUN) {
    // 選配：把計畫 dump 成 JSON 供人工稽核 / 冪等性驗證（含個資、只寫本機 gitignore 區）
    if (process.env.AUTO_IMPORT_PLAN_OUT) {
      const out = {
        generatedAt: new Date().toISOString(),
        patch: plan.patch.map(({ patient, fields }) => ({
          id: patient.id,
          chartNo: patient.chartNo,
          fields,
        })),
        newPatients: plan.newPatients,
        newOrders: plan.newOrders,
        skipped: plan.skipped,
      };
      await fsp.writeFile(process.env.AUTO_IMPORT_PLAN_OUT, JSON.stringify(out, null, 2), 'utf8');
      log(`  （計畫已 dump：${process.env.AUTO_IMPORT_PLAN_OUT}）`);
    }
    log('');
    log('════════ dry-run 結束（無任何寫入）════════');
    return;
  }

  // ── [5/5] 執行寫入 ──
  log('');
  log('[5/5] 寫入 NAS DB…');
  let patched = 0;
  let patchFailed = 0;
  for (const { patient, fields } of plan.patch) {
    const ok = await patchPatientWithRetry(patient, fields);
    if (ok) patched++;
    else patchFailed++;
  }
  log(`  ✓ 病患 PATCH：成功 ${patched} · 失敗 ${patchFailed}`);

  let created = 0;
  let createdExisted = 0;
  let createFailed = 0;
  const createdChartNos = [];
  for (const np of plan.newPatients) {
    const r = await api('POST', '/api/patients', np);
    if (r.ok) {
      created++;
      createdChartNos.push(np.chartNo);
    } else if (r.status === 409) {
      createdExisted++;
    } else {
      createFailed++;
      log(`  ✗ 建病患失敗 chartNo=${np.chartNo} HTTP ${r.status} ${r.json?.message ?? ''}`);
    }
  }
  log(
    `  ✓ 新增病患：成功 ${created} · 已存在 ${createdExisted} · 失敗 ${createFailed}` +
      (createdChartNos.length ? `（病歷號 ${createdChartNos.join(', ')}）` : ''),
  );

  let ordersCreated = 0;
  let ordersExisted = 0;
  let ordersFailed = 0;
  for (const o of plan.newOrders) {
    const r = await api('POST', '/api/orders', o);
    if (r.ok) ordersCreated++;
    else if (r.status === 409) ordersExisted++;
    else {
      ordersFailed++;
      if (ordersFailed <= 5) {
        log(`  ✗ 建下單失敗 chartNo=${o.patientChartNo} HTTP ${r.status} ${r.json?.message ?? ''}`);
      }
    }
  }
  log(`  ✓ 新增下單：成功 ${ordersCreated} · 已存在 ${ordersExisted} · 失敗 ${ordersFailed}`);

  const totalFailed = patchFailed + createFailed + ordersFailed;
  if (totalFailed > 0) {
    fail(`有 ${totalFailed} 筆寫入失敗（PATCH ${patchFailed} / 建病患 ${createFailed} / 建下單 ${ordersFailed}）`);
  }
  log('════════ 匯入完成 ════════');
}

// 抓 DB 現況。正常走 NAS API；--dry-run 時可用本機備份 JSON 當快照離線試算
// （AUTO_IMPORT_DB_SNAPSHOT=<backups/aligner-tracker-backup-*.json>）。
// ⚠️ 快照模式只讀本機檔、且強制 dry-run，永遠不會拿快照去寫 DB。
async function loadDbSnapshot() {
  const snap = process.env.AUTO_IMPORT_DB_SNAPSHOT;
  if (snap) {
    if (!DRY_RUN) fail('AUTO_IMPORT_DB_SNAPSHOT 只能配 --dry-run 使用（快照不是 DB 現況、不可據以寫入）');
    log(`[4/5] 讀本機快照（離線試算）：${snap}`);
    const j = JSON.parse(await fsp.readFile(snap, 'utf8'));
    const dbPatients = j.patients ?? [];
    const dbOrders = j.orders ?? [];
    if (dbPatients.length === 0) fail('快照內 0 位病患、無法試算');
    log(`  ✓ 快照：病患 ${dbPatients.length} 位、下單 ${dbOrders.length} 筆（匯出於 ${j.exportedAt ?? '未知'}）`);
    return { dbPatients, dbOrders };
  }
  log('[4/5] GET /api/patients + /api/orders…');
  const pr = await api('GET', '/api/patients');
  if (!pr.ok) fail(`GET /api/patients 失敗 HTTP ${pr.status}`);
  const or = await api('GET', '/api/orders');
  if (!or.ok) fail(`GET /api/orders 失敗 HTTP ${or.status}`);
  const dbPatients = pr.json.data ?? [];
  const dbOrders = or.json.data ?? [];
  log(`  ✓ DB：病患 ${dbPatients.length} 位、下單 ${dbOrders.length} 筆`);
  return { dbPatients, dbOrders };
}

// PATCH 病患（帶 version 樂觀鎖；409 → re-fetch 重算補空後重試一次）
async function patchPatientWithRetry(patient, fields) {
  const send = async (p, f) => {
    const q = `/api/patients/${encodeURIComponent(p.id)}?version=${p._version ?? 1}`;
    return await api('PATCH', q, { ...f, updatedAt: new Date().toISOString() });
  };
  let r = await send(patient, fields);
  if (r.ok) return true;
  if (r.status !== 409) {
    log(`  ✗ PATCH 失敗 chartNo=${patient.chartNo} HTTP ${r.status} ${r.json?.message ?? ''}`);
    return false;
  }
  // 409：抓最新版本、對最新值重新套補空原則（別人剛填過的欄位就不再蓋）
  const fresh = await api('GET', `/api/patients/${encodeURIComponent(patient.id)}`);
  if (!fresh.ok) {
    log(`  ✗ 409 後 re-fetch 失敗 chartNo=${patient.chartNo} HTTP ${fresh.status}`);
    return false;
  }
  const cur = fresh.json.data;
  const refiltered = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'hasConsent') {
      if (cur.hasConsent === false && v === true) refiltered[k] = v;
    } else if (k === 'doctor' || k === 'scanInfo') {
      if (cur[k] == null || String(cur[k]).trim() === '') refiltered[k] = v;
    } else if (k === 'refinementLevel') {
      if (cur[k] == null || cur[k] === 0) refiltered[k] = v;
    } else if (cur[k] == null) {
      // totalAligners* / currentAligner* / track：仍只補空
      refiltered[k] = v;
    }
  }
  if (Object.keys(refiltered).length === 0) return true; // 別人已經填好了、視為完成
  r = await send({ ...patient, _version: cur._version }, refiltered);
  if (r.ok) return true;
  log(`  ✗ PATCH 重試仍失敗 chartNo=${patient.chartNo} HTTP ${r.status} ${r.json?.message ?? ''}`);
  return false;
}

main().catch((e) => fail(e?.stack || String(e)));
