// Audit middleware — 把寫操作記到 audit_log
//
// 工作機制：
//   - 攔截 res.json()、寫成功後 INSERT audit_log
//   - GET / OPTIONS 跳過
//   - 失敗（HTTP >= 400）不記
//
// 記什麼：
//   - ts / user_id / action (create/update/delete/bulk-import)
//   - entity / entity_id / after_json
//   - client_id（debug 用）
//
// before_json：UPDATE 時可帶（route handler 在改之前 SELECT 一份 attach 到 req.beforeRow）

import { getDb } from '../db/db.js';

export function audit(entity) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return next();

    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const action =
          req.method === 'POST'
            ? req.path.endsWith('/bulk')
              ? 'bulk-import'
              : 'create'
            : req.method === 'DELETE'
              ? 'delete'
              : 'update';
        try {
          const db = getDb();
          db.prepare(`
            INSERT INTO audit_log (ts, user_id, action, entity, entity_id, before_json, after_json, client_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            new Date().toISOString(),
            req.user?.id || 'system',
            action,
            entity,
            req.params.id || body?.data?.id || null,
            req.beforeRow ? JSON.stringify(req.beforeRow) : null,
            body?.data ? JSON.stringify(body.data) : null,
            req.clientId || null,
          );
        } catch (e) {
          // audit 失敗不該擋業務、log 就好
          console.error('[audit] insert failed:', e.message);
        }
      }
      return origJson(body);
    };
    next();
  };
}
