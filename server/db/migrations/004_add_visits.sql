-- v0.7.0：回診登記 visits 表
CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  date          TEXT NOT NULL,            -- 回診日 YYYY-MM-DD（可補登過去日期）
  visit_type    TEXT NOT NULL DEFAULT '定期調整',
  aligner_upper INTEGER,                  -- 當時戴到第幾副（選填、NULL=沒更新）
  aligner_lower INTEGER,
  next_visit    TEXT,                     -- 下次回診日（選填）
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'system',
  updated_by    TEXT NOT NULL DEFAULT 'system',
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_visits_patient    ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date       ON visits(date);
CREATE INDEX IF NOT EXISTS idx_visits_updated_at ON visits(updated_at);
