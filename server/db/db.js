// SQLite connection + migration runner
//
// 用 Node 內建 node:sqlite (v22.5+)、不需 native build。
//
// 用法：
//   import { openDb, getDb } from './db/db.js';
//   const db = openDb('/data/db.sqlite');
//   db.prepare('SELECT ...').get();
//
// Migration 機制：
//   db/migrations/001_xxx.sql, 002_yyy.sql, ...
//   server 啟動時讀 migrations table，跑沒執行過的檔案
//
// 注意：node:sqlite 在 Node v22.5-23 需要 --experimental-sqlite flag
//       v24+ 已穩定。Dockerfile base 用 node:24-alpine 最簡單。

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db = null;

export function openDb(dbPath) {
  if (_db) return _db;

  // 確保父資料夾存在
  const parent = path.dirname(dbPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  _db = new DatabaseSync(dbPath);
  console.log(`[db] opened ${dbPath}`);

  // 跑 schema.sql（含 PRAGMA、CREATE TABLE IF NOT EXISTS — 冪等）
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  _db.exec(schemaSql);
  console.log('[db] schema applied');

  // 跑 migrations
  runMigrations(_db);

  return _db;
}

export function getDb() {
  if (!_db) throw new Error('db not opened — call openDb() first');
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ─── Migration runner ────────────────────────────────────
function runMigrations(db) {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[db] no migrations dir, skip');
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('[db] no migrations');
    return;
  }

  const applied = new Set(
    db.prepare('SELECT version FROM migrations').all().map((r) => r.version),
  );

  for (const f of files) {
    const m = f.match(/^(\d+)_(.+)\.sql$/);
    if (!m) continue;
    const version = Number(m[1]);
    const notes = m[2];
    if (applied.has(version)) continue;

    console.log(`[db] applying migration ${f}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO migrations (version, applied_at, notes) VALUES (?, ?, ?)',
      ).run(version, new Date().toISOString(), notes);
      db.exec('COMMIT');
      console.log(`[db] ✓ migration ${version} applied`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`[db] ✗ migration ${version} failed:`, e.message);
      throw e;
    }
  }
}
