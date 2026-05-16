-- v0.6.1：users 加 permissions 欄
--
-- 既有 NAS db.sqlite (v0.6.0 部署的)users 表為空、可安全 DROP + 重建。
-- 對 fresh install（schema.sql 已有新 users）也安全（DROP + CREATE 一次）。
--
-- SQLite ALTER TABLE ADD COLUMN 不支援 IF NOT EXISTS、若改成 ALTER 在 fresh install 會 error。
-- DROP + CREATE 兩邊都 work、idempotent。

DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer',
  permissions     TEXT NOT NULL DEFAULT '[]',
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);
