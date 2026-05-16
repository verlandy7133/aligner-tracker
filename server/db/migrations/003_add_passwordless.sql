-- v0.6.2：users 加 passwordless 欄
--
-- 設計用途：共用機帳號（iPad / 診間機 / 全院帳號）可以不用密碼登入。
-- 標記 passwordless = 1 的 user、只用 username 就能 login（password_hash 留空字串）。
-- 此功能是 server-side opt-in、admin 在新增/編輯帳號時勾選。
--
-- 安全意涵：LAN/VPN 內任何能連到 server 的人、知道 username 就能進此帳號。
-- 適合配 viewer / 受限權限的帳號、不適合 admin。
--
-- SQLite ALTER TABLE ADD COLUMN 沒 IF NOT EXISTS、用 PRAGMA + 條件判斷不方便。
-- 直接 ALTER、若已有此 column（fresh install schema.sql 已含）則此 migration 跳過 — 由
-- migrate-runner 的 try/catch 處理（不存在的話、看 runner 邏輯）。
--
-- 較安全做法：用 PRAGMA table_info 檢查（在 runner 端做、SQL 這邊保持簡單）。

ALTER TABLE users ADD COLUMN passwordless INTEGER NOT NULL DEFAULT 0;
