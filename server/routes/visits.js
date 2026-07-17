// /api/visits CRUD route（v0.7.0 回診登記）
//
// 照 orders.js 的既有慣例（樂觀鎖 / audit / SSE 廣播）。
// 差別：POST 帶 patient 回寫 side-effect（見下方 §POST），在同一個 transaction 內：
//   - INSERT visits
//   - UPDATE patients（last_visit 不倒退 / next_visit 帶了才動 / 副數帶非 null 才動）
//   - audit 兩筆（visit create + patient update）
//   - SSE 兩則（visit.created + patient.updated）
//
// PATCH 只修 visit 本身、不重放 side-effect（修 typo 用）。
// DELETE 只刪 visit、不回滾 patient 欄位（回滾易錯、audit_log 有 before/after 可手動修）。

import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import { visitRowToObj, visitObjToRow, patientRowToObj } from '../lib/json-fields.js';
import { checkVersion } from '../middleware/optimistic-lock.js';
import { audit } from '../middleware/audit.js';
import { requirePermission } from '../middleware/auth.js';
import { sse } from '../events/sse.js';

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function findById(id) {
  const row = getDb().prepare('SELECT * FROM visits WHERE id = ?').get(id);
  return row ? visitRowToObj(row) : null;
}

function findPatientObj(id) {
  const row = getDb().prepare('SELECT * FROM patients WHERE id = ?').get(id);
  return row ? patientRowToObj(row) : null;
}

// ─── GET /api/visits ──────────────────────────────────────
// Query: ?patientId=&date=&since=&limit=
//   - date=YYYY-MM-DD 精確過濾（工作台「今日已登記」用）
//   - since=<iso-ts> 增量（updated_at > since）
//   - ORDER BY date DESC, created_at DESC
router.get('/', requirePermission('patient.view'), (req, res) => {
  const patientId = req.query.patientId ? String(req.query.patientId) : null;
  const date = req.query.date ? String(req.query.date) : null;
  const since = req.query.since ? String(req.query.since) : null;
  const limitRaw = req.query.limit != null ? Number(req.query.limit) : null;
  const limit = limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;

  const where = [];
  const params = [];
  if (patientId) { where.push('patient_id = ?'); params.push(patientId); }
  if (date) { where.push('date = ?'); params.push(date); }
  if (since) { where.push('updated_at > ?'); params.push(since); }

  let sql = 'SELECT * FROM visits';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY date DESC, created_at DESC';
  if (limit) sql += ` LIMIT ${limit}`;

  const rows = getDb().prepare(sql).all(...params);
  res.json({
    data: rows.map(visitRowToObj),
    meta: { count: rows.length, patientId, date, since, limit, serverTime: nowIso() },
  });
});

// ─── GET /api/visits/:id ──────────────────────────────────
router.get('/:id', requirePermission('patient.view'), (req, res) => {
  const v = findById(req.params.id);
  if (!v) return res.status(404).json({ error: 'not_found', id: req.params.id });
  res.json({ data: v, meta: { version: v._version, updatedAt: v.updatedAt } });
});

// ─── POST /api/visits ─────────────────────────────────────
// 本功能核心：INSERT visit + patient 回寫 side-effect（同一 transaction）
const VISIT_INSERT_SQL = `
  INSERT INTO visits (
    id, patient_id, date, visit_type, aligner_upper, aligner_lower, next_visit, note,
    created_at, updated_at, created_by, updated_by, version
  ) VALUES (
    @id, @patient_id, @date, @visit_type, @aligner_upper, @aligner_lower, @next_visit, @note,
    @created_at, @updated_at, @created_by, @updated_by, @version
  )
`;

const PATIENT_SIDE_EFFECT_SQL = `
  UPDATE patients SET
    last_visit=@last_visit, next_visit=@next_visit,
    current_aligner_upper=@current_aligner_upper, current_aligner_lower=@current_aligner_lower,
    updated_at=@updated_at, updated_by=@updated_by, version=version+1
  WHERE id=@id
`;

router.post('/', requirePermission('patient.edit'), audit('visit'), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'validation_error', message: 'body required' });
  }
  const patientId = body.patientId;
  if (!patientId) {
    return res.status(400).json({ error: 'validation_error', message: 'patientId required' });
  }
  if (!body.date) {
    return res.status(400).json({ error: 'validation_error', message: 'date required' });
  }

  const db = getDb();
  const patientRow = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patientRow) {
    // patientId 不存在 → 404、不 INSERT
    return res.status(404).json({ error: 'not_found', message: `patient not found: ${patientId}`, id: patientId });
  }
  const patientBefore = patientRowToObj(patientRow);

  const id = body.id || crypto.randomUUID();
  const now = nowIso();
  const userId = req.user?.id || 'system';
  const visit = { ...body, id, createdAt: body.createdAt || now, updatedAt: now };
  const row = visitObjToRow(visit);

  // ── patient 回寫值計算（§2.2 釘死規則）──
  // last_visit：只在 visit.date >= 現有 last_visit（或現有 NULL）時更新——補登舊回診不倒退
  const newLastVisit =
    !patientRow.last_visit || visit.date >= patientRow.last_visit ? visit.date : patientRow.last_visit;
  // next_visit：僅當 body 有帶（含明確 null＝清空）；沒帶＝不動
  const hasNextVisit = Object.prototype.hasOwnProperty.call(body, 'nextVisit');
  const newNextVisit = hasNextVisit ? body.nextVisit ?? null : patientRow.next_visit;
  // current_aligner_*：僅當 body 有帶非 null；null/沒帶＝不動
  const newAlignerUpper = body.alignerUpper != null ? body.alignerUpper : patientRow.current_aligner_upper;
  const newAlignerLower = body.alignerLower != null ? body.alignerLower : patientRow.current_aligner_lower;

  db.exec('BEGIN');
  try {
    db.prepare(VISIT_INSERT_SQL).run({
      ...row,
      created_by: userId,
      updated_by: userId,
      version: 1,
    });
    db.prepare(PATIENT_SIDE_EFFECT_SQL).run({
      id: patientId,
      last_visit: newLastVisit,
      next_visit: newNextVisit,
      current_aligner_upper: newAlignerUpper,
      current_aligner_lower: newAlignerLower,
      updated_at: now,
      updated_by: userId,
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'already_exists', id });
    }
    console.error('[visits POST] insert failed:', e);
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }

  const created = findById(id);
  const patientAfter = findPatientObj(patientId);

  // audit 第二筆：patient update（visit create 由 audit('visit') middleware 記）
  try {
    db.prepare(`
      INSERT INTO audit_log (ts, user_id, action, entity, entity_id, before_json, after_json, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nowIso(),
      userId,
      'update',
      'patient',
      patientId,
      JSON.stringify(patientBefore),
      JSON.stringify(patientAfter),
      req.clientId || null,
    );
  } catch (e) {
    console.error('[visits POST] patient audit failed:', e.message);
  }

  // SSE 兩則：visit.created + patient.updated
  sse.broadcast(
    'visit.created',
    { id: created.id, patientId: created.patientId, version: created._version, ts: nowIso() },
    req.clientId,
  );
  sse.broadcast(
    'patient.updated',
    { id: patientId, version: patientAfter?._version, ts: nowIso() },
    req.clientId,
  );

  res.status(201).json({ data: created, meta: { version: created._version } });
});

// ─── PATCH /api/visits/:id ────────────────────────────────
// 樂觀鎖（body 帶 version）；只修 visit 本身、不觸發 patient 回寫（修 typo 用）
const VISIT_UPDATE_SQL = `
  UPDATE visits SET
    patient_id=@patient_id, date=@date, visit_type=@visit_type,
    aligner_upper=@aligner_upper, aligner_lower=@aligner_lower,
    next_visit=@next_visit, note=@note,
    updated_at=@updated_at, updated_by=@updated_by, version=version+1
  WHERE id=@id
`;

function toUpdateParams(row, userId) {
  const { created_at, created_by, version, ...rest } = row;
  return { ...rest, updated_by: userId };
}

router.patch('/:id', requirePermission('patient.edit'), checkVersion('visits'), audit('visit'), (req, res) => {
  const id = req.params.id;
  const before = findById(id);
  req.beforeRow = before;
  if (!before) return res.status(404).json({ error: 'not_found', id });
  const merged = { ...before, ...req.body, id, updatedAt: nowIso() };
  delete merged._version;
  delete merged._createdBy;
  delete merged._updatedBy;
  const row = visitObjToRow(merged);
  getDb().prepare(VISIT_UPDATE_SQL).run(toUpdateParams(row, req.user?.id || 'system'));
  const updated = findById(id);
  sse.broadcast(
    'visit.updated',
    { id: updated.id, patientId: updated.patientId, version: updated._version, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: updated, meta: { version: updated._version } });
});

// ─── DELETE /api/visits/:id ───────────────────────────────
// 刪 visit 記錄。裁決：不回滾 patient 欄位（audit_log 有 before/after 可手動修）
router.delete('/:id', requirePermission('patient.edit'), checkVersion('visits'), audit('visit'), (req, res) => {
  const id = req.params.id;
  req.beforeRow = findById(id);
  const r = getDb().prepare('DELETE FROM visits WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'not_found', id });
  sse.broadcast(
    'visit.deleted',
    { id, patientId: req.beforeRow?.patientId, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: { id }, meta: { deleted: true } });
});

export default router;
