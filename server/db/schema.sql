-- 矯正追蹤 NAS API Server — SQLite Schema
-- v0.6.0 initial
--
-- 對照當前 Dexie v9 (src/db.ts) 與 src/types/Patient.ts。
-- 設計原則：
--   - JSON 欄位（flags / photos / allSourceFolders）用 TEXT 存 JSON 字串
--   - boolean → INTEGER 0/1
--   - 每個 record 有 created_by / updated_by / version 三個共通欄位（auth + 樂觀鎖 預留）
--   - updated_at 全部上 index 給 SSE 增量同步用
--   - source_folder / consent_pdf_path 存 relative path（不含 dataRoot prefix）

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ─── patients ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id                       TEXT PRIMARY KEY,
  chart_no                 TEXT NOT NULL,
  name                     TEXT NOT NULL,
  birthday                 TEXT,
  product_line             TEXT NOT NULL,
  status                   TEXT NOT NULL,
  track                    TEXT,
  refinement_level         INTEGER NOT NULL DEFAULT 0,
  order_date               TEXT,
  start_date               TEXT,
  total_aligners_upper     INTEGER,
  current_aligner_upper    INTEGER,
  total_aligners_lower     INTEGER,
  current_aligner_lower    INTEGER,
  cycle_days               INTEGER NOT NULL DEFAULT 14,
  last_visit               TEXT,
  next_visit               TEXT,
  has_consent              INTEGER NOT NULL DEFAULT 0,
  consent_pdf_path         TEXT,
  scan_info                TEXT,
  doctor                   TEXT,
  auu_id                   TEXT,
  flags                    TEXT NOT NULL DEFAULT '[]',
  notes                    TEXT NOT NULL DEFAULT '',
  source_folder            TEXT NOT NULL DEFAULT '',
  all_source_folders       TEXT NOT NULL DEFAULT '[]',
  markdown_note            TEXT NOT NULL DEFAULT '',
  photos                   TEXT NOT NULL DEFAULT '{}',
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL DEFAULT 'system',
  updated_by               TEXT NOT NULL DEFAULT 'system',
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_patients_chart_no    ON patients(chart_no);
CREATE INDEX IF NOT EXISTS idx_patients_name        ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_status      ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_product     ON patients(product_line);
CREATE INDEX IF NOT EXISTS idx_patients_next_visit  ON patients(next_visit);
CREATE INDEX IF NOT EXISTS idx_patients_order_date  ON patients(order_date);
CREATE INDEX IF NOT EXISTS idx_patients_doctor      ON patients(doctor);
CREATE INDEX IF NOT EXISTS idx_patients_updated_at  ON patients(updated_at);

-- ─── orders ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                       TEXT PRIMARY KEY,
  patient_id               TEXT NOT NULL,
  patient_chart_no         TEXT NOT NULL,
  patient_name             TEXT NOT NULL,
  date                     TEXT NOT NULL,
  doctor                   TEXT NOT NULL DEFAULT '',
  batch_type               TEXT NOT NULL DEFAULT '',
  aligner_range            TEXT NOT NULL DEFAULT '',
  progress                 TEXT NOT NULL,
  expected_date            TEXT,
  actual_date              TEXT,
  next_step                TEXT NOT NULL DEFAULT '',
  notes                    TEXT NOT NULL DEFAULT '',
  lab                      TEXT NOT NULL DEFAULT '',
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL DEFAULT 'system',
  updated_by               TEXT NOT NULL DEFAULT 'system',
  version                  INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_orders_patient_id    ON orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_chart_no      ON orders(patient_chart_no);
CREATE INDEX IF NOT EXISTS idx_orders_date          ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_doctor        ON orders(doctor);
CREATE INDEX IF NOT EXISTS idx_orders_progress      ON orders(progress);
CREATE INDEX IF NOT EXISTS idx_orders_lab           ON orders(lab);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at    ON orders(updated_at);

-- ─── settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key                      TEXT PRIMARY KEY,
  value                    TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  updated_by               TEXT NOT NULL DEFAULT 'system'
);

-- ─── audit_log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  user_id      TEXT NOT NULL DEFAULT 'system',
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  before_json  TEXT,
  after_json   TEXT,
  client_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts        ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_entity    ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id);

-- ─── users (Phase 1 schema-only、無 row) ──────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer',
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);

-- ─── migrations 表 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  notes      TEXT
);
