// /api/audit-log — 列 audit_log 紀錄（誰改了什麼）
//
// 需 settings.audit 權限（admin / 自訂角色）
//
// Query params:
//   ?userId=<id>          只看特定 user 的動作
//   ?entity=patient|order|setting|user
//   ?entityId=<id>        只看特定 record 的歷史
//   ?action=create|update|delete|bulk-import
//   ?since=<iso-ts>       只看某時間後
//   ?limit=200 (max 1000) 預設 200 筆
//   ?offset=0
//
// Response:
//   { data: [...], meta: { total, limit, offset, hasMore } }

import express from 'express';
import { getDb } from '../db/db.js';
import { requirePermission } from '../middleware/auth.js';

const router = express.Router();

router.use(requirePermission('settings.audit'));

router.get('/', (req, res) => {
  const db = getDb();

  const userId = req.query.userId ? String(req.query.userId) : null;
  const entity = req.query.entity ? String(req.query.entity) : null;
  const entityId = req.query.entityId ? String(req.query.entityId) : null;
  const action = req.query.action ? String(req.query.action) : null;
  const since = req.query.since ? String(req.query.since) : null;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  // 動態組 WHERE
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (entity) { where.push('entity = ?'); params.push(entity); }
  if (entityId) { where.push('entity_id = ?'); params.push(entityId); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (since) { where.push('ts > ?'); params.push(since); }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // 總數
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`).get(...params);
  const total = totalRow.c;

  // 主 query — 新到舊
  const rows = db.prepare(`
    SELECT id, ts, user_id, action, entity, entity_id, before_json, after_json, client_id
    FROM audit_log
    ${whereSql}
    ORDER BY id DESC
    LIMIT ${limit} OFFSET ${offset}
  `).all(...params);

  // user_id → 同時把 user display_name 帶進來方便顯示
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((u) => u && u !== 'system'))];
  const userMap = {};
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',');
    const users = db.prepare(`SELECT id, username, display_name FROM users WHERE id IN (${placeholders})`).all(...userIds);
    for (const u of users) userMap[u.id] = { username: u.username, displayName: u.display_name };
  }

  const data = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    userId: r.user_id,
    user: userMap[r.user_id] || (r.user_id === 'system' ? { username: 'system', displayName: 'system' } : null),
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    beforeJson: r.before_json,
    afterJson: r.after_json,
    clientId: r.client_id,
  }));

  res.json({
    data,
    meta: { total, limit, offset, hasMore: offset + rows.length < total },
  });
});

export default router;
