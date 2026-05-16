// /api/orders CRUD route
//
// 同 patients route 結構、只是 schema 不同。
// 樂觀鎖 / audit / SSE 廣播都接齊。

import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import { orderRowToObj, orderObjToRow } from '../lib/json-fields.js';
import { checkVersion } from '../middleware/optimistic-lock.js';
import { audit } from '../middleware/audit.js';
import { sse } from '../events/sse.js';

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function findById(id) {
  const row = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return row ? orderRowToObj(row) : null;
}

// ─── GET /api/orders ──────────────────────────────────────
// Query: ?since=<iso-ts> | ?patientId=<id>
router.get('/', (req, res) => {
  const since = req.query.since ? String(req.query.since) : null;
  const patientId = req.query.patientId ? String(req.query.patientId) : null;
  const db = getDb();
  let rows;
  if (since && patientId) {
    rows = db.prepare(`
      SELECT * FROM orders WHERE patient_id = ? AND updated_at > ? ORDER BY date DESC
    `).all(patientId, since);
  } else if (since) {
    rows = db.prepare(`SELECT * FROM orders WHERE updated_at > ? ORDER BY updated_at ASC`).all(since);
  } else if (patientId) {
    rows = db.prepare(`SELECT * FROM orders WHERE patient_id = ? ORDER BY date DESC`).all(patientId);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY date DESC').all();
  }
  res.json({
    data: rows.map(orderRowToObj),
    meta: { count: rows.length, since, patientId, serverTime: nowIso() },
  });
});

// ─── GET /api/orders/:id ──────────────────────────────────
router.get('/:id', (req, res) => {
  const o = findById(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found', id: req.params.id });
  res.json({ data: o, meta: { version: o._version, updatedAt: o.updatedAt } });
});

// ─── POST /api/orders ────────────────────────────────────
router.post('/', audit('order'), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'validation_error', message: 'body required' });
  }
  const id = body.id || crypto.randomUUID();
  const now = nowIso();
  const order = {
    ...body,
    id,
    createdAt: body.createdAt || now,
    updatedAt: now,
  };
  const row = orderObjToRow(order);
  try {
    getDb().prepare(`
      INSERT INTO orders (
        id, patient_id, patient_chart_no, patient_name, date, doctor, batch_type, aligner_range,
        progress, expected_date, actual_date, next_step, notes, lab,
        created_at, updated_at, created_by, updated_by, version
      ) VALUES (
        @id, @patient_id, @patient_chart_no, @patient_name, @date, @doctor, @batch_type, @aligner_range,
        @progress, @expected_date, @actual_date, @next_step, @notes, @lab,
        @created_at, @updated_at, @created_by, @updated_by, @version
      )
    `).run({
      ...row,
      created_by: req.user?.id || 'system',
      updated_by: req.user?.id || 'system',
      version: 1,
    });
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'already_exists', id });
    }
    console.error('[orders POST] insert failed:', e);
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
  const created = findById(id);
  sse.broadcast(
    'order.created',
    { id: created.id, patientId: created.patientId, version: created._version, ts: nowIso() },
    req.clientId,
  );
  res.status(201).json({ data: created, meta: { version: created._version } });
});

// SQL for UPDATE — 不含 created_at / created_by / version
const UPDATE_SQL = `
  UPDATE orders SET
    patient_id=@patient_id, patient_chart_no=@patient_chart_no, patient_name=@patient_name,
    date=@date, doctor=@doctor, batch_type=@batch_type, aligner_range=@aligner_range,
    progress=@progress, expected_date=@expected_date, actual_date=@actual_date,
    next_step=@next_step, notes=@notes, lab=@lab,
    updated_at=@updated_at, updated_by=@updated_by, version=version+1
  WHERE id=@id
`;

function toUpdateParams(row, userId) {
  const { created_at, created_by, version, ...rest } = row;
  return { ...rest, updated_by: userId };
}

// ─── PUT /api/orders/:id ─────────────────────────────────
router.put('/:id', checkVersion('orders'), audit('order'), (req, res) => {
  const id = req.params.id;
  req.beforeRow = findById(id);
  const body = req.body;
  const order = { ...body, id, updatedAt: nowIso() };
  if (!order.createdAt) order.createdAt = req.beforeRow?.createdAt || order.updatedAt;
  const row = orderObjToRow(order);
  getDb().prepare(UPDATE_SQL).run(toUpdateParams(row, req.user?.id || 'system'));
  const updated = findById(id);
  sse.broadcast(
    'order.updated',
    { id: updated.id, patientId: updated.patientId, version: updated._version, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: updated, meta: { version: updated._version } });
});

// ─── PATCH /api/orders/:id ───────────────────────────────
router.patch('/:id', checkVersion('orders'), audit('order'), (req, res) => {
  const id = req.params.id;
  const before = findById(id);
  req.beforeRow = before;
  if (!before) return res.status(404).json({ error: 'not_found', id });
  const merged = { ...before, ...req.body, id, updatedAt: nowIso() };
  delete merged._version;
  delete merged._createdBy;
  delete merged._updatedBy;
  const row = orderObjToRow(merged);
  getDb().prepare(UPDATE_SQL).run(toUpdateParams(row, req.user?.id || 'system'));
  const updated = findById(id);
  sse.broadcast(
    'order.updated',
    { id: updated.id, patientId: updated.patientId, version: updated._version, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: updated, meta: { version: updated._version } });
});

// ─── DELETE /api/orders/:id ──────────────────────────────
router.delete('/:id', checkVersion('orders'), audit('order'), (req, res) => {
  const id = req.params.id;
  req.beforeRow = findById(id);
  const r = getDb().prepare('DELETE FROM orders WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'not_found', id });
  sse.broadcast(
    'order.deleted',
    { id, patientId: req.beforeRow?.patientId, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: { id }, meta: { deleted: true } });
});

// ─── POST /api/orders/bulk ───────────────────────────────
router.post('/bulk', audit('order'), (req, res) => {
  const orders = req.body?.orders ?? [];
  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: 'validation_error', message: 'orders array required' });
  }
  const db = getDb();
  const stmt = db.prepare(`
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
  const now = nowIso();
  const userId = req.user?.id || 'system';
  db.exec('BEGIN');
  try {
    for (const o of orders) {
      const row = orderObjToRow({ ...o, updatedAt: o.updatedAt || now, createdAt: o.createdAt || now });
      stmt.run({ ...row, created_by: userId, updated_by: userId, version: 1 });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
  sse.broadcast(
    'bulk.imported',
    { entity: 'order', count: orders.length, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: { count: orders.length }, meta: {} });
});

export default router;
