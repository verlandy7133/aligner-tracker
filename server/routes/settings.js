// /api/settings 簡單 key-value CRUD
//
// settings 表只有 key/value/updated_at/updated_by 4 個欄位、不用樂觀鎖
// （settings 衝突可接受 last-write-wins、量少 + 不常改）
// value 用 JSON 字串存。

import express from 'express';
import { getDb } from '../db/db.js';
import { audit } from '../middleware/audit.js';
import { authRequired } from '../middleware/auth.js';
import { sse } from '../events/sse.js';

// 依 key 對應 permission
// 讀全部 settings 都允許（只要 logged in）、寫的話分流
function permForKey(key) {
  if (key === 'doctors') return 'settings.doctors';
  if (key === 'labs') return 'settings.labs';
  // theme / theme-custom / ui-scale / alert-thresholds / 其他 → preferences
  return 'settings.preferences';
}

import { hasPermission } from '../lib/permissions.js';

function requirePermForKey(req, res, next) {
  const key = req.params.key;
  const perm = permForKey(key);
  if (!hasPermission(req.user?.permissions || [], perm)) {
    return res.status(403).json({
      error: 'forbidden',
      message: `沒有權限修改設定 "${key}"：需要 ${perm}`,
      required: perm,
    });
  }
  next();
}

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function parseValue(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function rowToObj(row) {
  return row
    ? { key: row.key, value: parseValue(row.value), updatedAt: row.updated_at, _updatedBy: row.updated_by }
    : null;
}

// 全部 endpoint 需登入（讀也要）
router.use(authRequired);

// ─── GET /api/settings ────────────────────────────────────
router.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM settings ORDER BY key').all();
  res.json({ data: rows.map(rowToObj), meta: { count: rows.length, serverTime: nowIso() } });
});

// ─── GET /api/settings/:key ──────────────────────────────
router.get('/:key', (req, res) => {
  const row = getDb().prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'not_found', key: req.params.key });
  res.json({ data: rowToObj(row) });
});

// ─── PUT /api/settings/:key ──────────────────────────────
// upsert，按 key 套對應 permission
router.put('/:key', requirePermForKey, audit('setting'), (req, res) => {
  const key = req.params.key;
  const value = req.body?.value !== undefined ? req.body.value : req.body;
  const now = nowIso();
  const userId = req.user?.id || 'system';
  req.beforeRow = getDb().prepare('SELECT * FROM settings WHERE key = ?').get(key);
  getDb()
    .prepare(`
      INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `)
    .run(key, JSON.stringify(value), now, userId);
  const row = getDb().prepare('SELECT * FROM settings WHERE key = ?').get(key);
  sse.broadcast('setting.updated', { key, ts: now }, req.clientId);
  res.json({ data: rowToObj(row) });
});

// ─── DELETE /api/settings/:key ───────────────────────────
router.delete('/:key', requirePermForKey, audit('setting'), (req, res) => {
  const key = req.params.key;
  req.beforeRow = getDb().prepare('SELECT * FROM settings WHERE key = ?').get(key);
  const r = getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
  if (r.changes === 0) return res.status(404).json({ error: 'not_found', key });
  sse.broadcast('setting.deleted', { key, ts: nowIso() }, req.clientId);
  res.json({ data: { key }, meta: { deleted: true } });
});

export default router;
