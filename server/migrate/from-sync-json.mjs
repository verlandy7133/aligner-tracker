#!/usr/bin/env node
// 一次性遷移：sync.json → SQLite (db.sqlite)
//
// 用法：
//   node server/migrate/from-sync-json.mjs <sync.json> <db.sqlite>
//
// 範例（D 機本地測試）：
//   node server/migrate/from-sync-json.mjs \
//     "D:\診所nas 矯正追蹤\SynologyDrive\sync.json" \
//     "D:\dev\矯正追蹤-app\dev-data\db.sqlite"
//
// 冪等：可重跑（每筆 INSERT OR REPLACE）
// 安全：開 transaction、失敗 ROLLBACK
//
// sync.json 格式參考 src/lib/backup.ts BackupFile type。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb } from '../db/db.js';
import { patientObjToRow, orderObjToRow } from '../lib/json-fields.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function color(c, s) {
  const codes = {
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    reset: '\x1b[0m',
  };
  return `${codes[c] || ''}${s}${codes.reset}`;
}

function usage() {
  console.error('Usage: node from-sync-json.mjs <sync.json> <db.sqlite>');
  process.exit(2);
}

const [syncPath, dbPath] = process.argv.slice(2);
if (!syncPath || !dbPath) usage();
if (!fs.existsSync(syncPath)) {
  console.error(color('red', `❌ sync.json not found: ${syncPath}`));
  process.exit(1);
}

console.log('');
console.log(color('cyan', '╔══════════════════════════════════════════╗'));
console.log(color('cyan', '║  sync.json → SQLite 一次性遷移            ║'));
console.log(color('cyan', '╚══════════════════════════════════════════╝'));
console.log(`  source: ${syncPath}`);
console.log(`  target: ${dbPath}`);
console.log('');

// Load sync.json
console.log(color('yellow', '[1/4] 讀 sync.json...'));
const raw = fs.readFileSync(syncPath, 'utf8');
const data = JSON.parse(raw);
const syncVersion = data.version ?? 1;
const patients = data.patients ?? [];
const orders = data.orders ?? [];
const settings = data.settings ?? [];
console.log(
  color('gray', `  v${syncVersion}, ${patients.length} patients, ${orders.length} orders, ${settings.length} settings`),
);
console.log('');

// Open DB (auto-runs schema.sql + migrations)
console.log(color('yellow', '[2/4] 開 SQLite + apply schema...'));
const db = openDb(dbPath);
console.log('');

// Insert/replace
console.log(color('yellow', `[3/4] 灌資料 (INSERT OR REPLACE)...`));
// Migration 時暫時關 FK，避免 orphan order 卡死；migration 完後驗 orphan 數
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
try {
  // Patients
  const patientStmt = db.prepare(`
    INSERT OR REPLACE INTO patients (
      id, chart_no, name, birthday, product_line, status, track, refinement_level,
      order_date, start_date,
      total_aligners_upper, current_aligner_upper, total_aligners_lower, current_aligner_lower,
      cycle_days, last_visit, next_visit, has_consent, consent_pdf_path, scan_info,
      doctor, auu_id, flags, notes, source_folder, all_source_folders, markdown_note, photos,
      created_at, updated_at, created_by, updated_by, version
    ) VALUES (
      @id, @chart_no, @name, @birthday, @product_line, @status, @track, @refinement_level,
      @order_date, @start_date,
      @total_aligners_upper, @current_aligner_upper, @total_aligners_lower, @current_aligner_lower,
      @cycle_days, @last_visit, @next_visit, @has_consent, @consent_pdf_path, @scan_info,
      @doctor, @auu_id, @flags, @notes, @source_folder, @all_source_folders, @markdown_note, @photos,
      @created_at, @updated_at, @created_by, @updated_by, @version
    )
  `);
  let pCount = 0;
  for (const p of patients) {
    const row = patientObjToRow(p);
    patientStmt.run({
      ...row,
      created_by: 'system',
      updated_by: 'system',
      version: 1,
    });
    pCount++;
  }
  console.log(color('gray', `  ✓ patients: ${pCount} rows`));

  // Orders
  const orderStmt = db.prepare(`
    INSERT OR REPLACE INTO orders (
      id, patient_id, patient_chart_no, patient_name, date, doctor, batch_type, aligner_range,
      progress, expected_date, actual_date, next_step, notes, lab,
      created_at, updated_at, created_by, updated_by, version
    ) VALUES (
      @id, @patient_id, @patient_chart_no, @patient_name, @date, @doctor, @batch_type, @aligner_range,
      @progress, @expected_date, @actual_date, @next_step, @notes, @lab,
      @created_at, @updated_at, @created_by, @updated_by, @version
    )
  `);
  let oCount = 0;
  for (const o of orders) {
    const row = orderObjToRow(o);
    orderStmt.run({
      ...row,
      created_by: 'system',
      updated_by: 'system',
      version: 1,
    });
    oCount++;
  }
  console.log(color('gray', `  ✓ orders: ${oCount} rows`));

  // Settings
  const settingStmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  let sCount = 0;
  for (const s of settings) {
    settingStmt.run(s.key, JSON.stringify(s.value), nowIso, 'system');
    sCount++;
  }
  console.log(color('gray', `  ✓ settings: ${sCount} rows`));

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error(color('red', `\n❌ migration failed: ${e.message}`));
  console.error(e.stack);
  closeDb();
  process.exit(1);
}
console.log('');

// Verify counts
console.log(color('yellow', '[4/4] 驗證筆數...'));
const patientCount = db.prepare('SELECT COUNT(*) AS c FROM patients').get().c;
const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
const settingCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
console.log(color('gray', `  DB 內: ${patientCount} patients / ${orderCount} orders / ${settingCount} settings`));

// Orphan check（FK 暫時 OFF 期間沒擋、現在算一下）
const orphanOrders = db.prepare(`
  SELECT COUNT(*) AS c FROM orders WHERE patient_id NOT IN (SELECT id FROM patients)
`).get().c;
if (orphanOrders > 0) {
  console.log(color('yellow', `  ⚠ orphan orders (patient_id 找不到對應 patient): ${orphanOrders} 筆`));
  // List sample
  const samples = db.prepare(`
    SELECT id, patient_chart_no, patient_name, date
    FROM orders
    WHERE patient_id NOT IN (SELECT id FROM patients)
    LIMIT 5
  `).all();
  for (const s of samples) {
    console.log(color('gray', `    · ${s.patient_chart_no} ${s.patient_name} ${s.date} (orderId=${s.id})`));
  }
  console.log(color('gray', '    這些 orders 留著、但 client 端拉不到 parent patient'));
  console.log(color('gray', '    （可能是 chartNo 改過 / patient 被刪 / chartNo-only 匯入未對到 patient）'));
}
db.exec('PRAGMA foreign_keys = ON');

const match = patientCount === patients.length && orderCount === orders.length && settingCount === settings.length;
console.log('');

if (match) {
  console.log(color('green', '╔══════════════════════════════════════════╗'));
  console.log(color('green', '║  ✓ Migration 完成、筆數對得上              ║'));
  console.log(color('green', '╚══════════════════════════════════════════╝'));
} else {
  console.log(color('red', '╔══════════════════════════════════════════╗'));
  console.log(color('red', '║  ✗ 筆數對不上！檢查 source data            ║'));
  console.log(color('red', '╚══════════════════════════════════════════╝'));
  console.log(`  expected: ${patients.length} / ${orders.length} / ${settings.length}`);
  console.log(`  got:      ${patientCount} / ${orderCount} / ${settingCount}`);
  closeDb();
  process.exit(1);
}

closeDb();
