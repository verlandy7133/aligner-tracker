// 樂觀鎖 middleware — PUT / PATCH / DELETE 時驗 version
//
// 規則：
//   - GET / POST → 跳過（不需驗）
//   - PUT / PATCH / DELETE → 必須帶 ?version=N 或 body.version=N
//   - server 端 version != client 版本 → 回 409，附 server 端最新 row
//
// 用法（在 route 定義時掛）：
//   router.put('/:id', checkVersion('patients'), (req, res) => {...})
//
// 注意：
//   - 這 middleware 只驗版本、不負責 bump、bump 在 route handler 內做
//   - 樂觀鎖 = 寫的時候 UPDATE ... WHERE id = ? AND version = ? 也 OK（race-free）
//     但本機 SQLite 單寫者、prepare + run 沒 race condition、用 middleware 足夠

import { getDb } from '../db/db.js';

export function checkVersion(table) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'POST' || req.method === 'OPTIONS') {
      return next();
    }
    const id = req.params.id;
    const incoming =
      req.body?.version ?? req.body?._version ?? Number(req.query.version);
    if (incoming == null || Number.isNaN(incoming)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'version required for PUT/PATCH/DELETE',
      });
    }
    const db = getDb();
    const row = db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: 'not_found', id });
    }
    if (row.version !== incoming) {
      const current = db
        .prepare(`SELECT * FROM ${table} WHERE id = ?`)
        .get(id);
      return res.status(409).json({
        error: 'version_conflict',
        currentVersion: row.version,
        yourVersion: incoming,
        current,
      });
    }
    next();
  };
}
