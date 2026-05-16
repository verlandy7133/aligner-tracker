// /api/patients CRUD route
//
// Endpoints:
//   GET    /api/patients              — 全部（?since=<iso-ts> 增量）
//   GET    /api/patients/:id          — 單筆
//   POST   /api/patients              — 新增
//   PUT    /api/patients/:id          — 全量更新（樂觀鎖）
//   PATCH  /api/patients/:id          — 部分更新（樂觀鎖）
//   DELETE /api/patients/:id          — 刪除（樂觀鎖）
//   POST   /api/patients/bulk         — 批次 upsert
//
// 樂觀鎖：PUT/PATCH/DELETE 需帶 version。
//        server 端 UPDATE 時 version + 1。
// SSE 廣播：寫成功後呼叫 sse.broadcast()（Sprint 2 寫好後接上）

import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import { patientRowToObj, patientObjToRow } from '../lib/json-fields.js';
import { checkVersion } from '../middleware/optimistic-lock.js';
import { audit } from '../middleware/audit.js';
import { sse } from '../events/sse.js';

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

function findById(id) {
  const row = getDb().prepare('SELECT * FROM patients WHERE id = ?').get(id);
  return row ? patientRowToObj(row) : null;
}

// ─── GET /api/patients ────────────────────────────────────
router.get('/', (req, res) => {
  const since = req.query.since ? String(req.query.since) : null;
  let stmt;
  let rows;
  if (since) {
    stmt = getDb().prepare(`SELECT * FROM patients WHERE updated_at > ? ORDER BY updated_at ASC`);
    rows = stmt.all(since);
  } else {
    stmt = getDb().prepare('SELECT * FROM patients ORDER BY chart_no ASC');
    rows = stmt.all();
  }
  res.json({
    data: rows.map(patientRowToObj),
    meta: { count: rows.length, since, serverTime: nowIso() },
  });
});

// ─── GET /api/patients/:id ────────────────────────────────
router.get('/:id', (req, res) => {
  const p = findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found', id: req.params.id });
  res.json({ data: p, meta: { version: p._version, updatedAt: p.updatedAt } });
});

// ─── POST /api/patients ──────────────────────────────────
// Body: 完整 Patient 物件（id 可選、不給就 server 生）
router.post('/', audit('patient'), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'validation_error', message: 'body required' });
  }
  const id = body.id || crypto.randomUUID();
  const now = nowIso();
  const patient = {
    ...body,
    id,
    createdAt: body.createdAt || now,
    updatedAt: now,
  };
  const row = patientObjToRow(patient);
  try {
    getDb()
      .prepare(`
        INSERT INTO patients (
          id, chart_no, name, birthday, product_line, status, track, refinement_level,
          order_date, start_date,
          total_aligners_upper, current_aligner_upper, total_aligners_lower, current_aligner_lower,
          cycle_days, last_visit, next_visit, has_consent, consent_pdf_path, scan_info,
          doctor, auu_id, flags, notes, source_folder, all_source_folders, markdown_note, photos,
          created_at, updated_at, created_by, updated_by, version
        ) VALUES (
          @id, @chart_no, @name, @birthday, @product_line, @status, @track, @refinement_level,
          @order_date, @start_date,
          @total_aligners_upper, @current_aligner_upper, @total_aligners_lower, @current_aligner_lower,
          @cycle_days, @last_visit, @next_visit, @has_consent, @consent_pdf_path, @scan_info,
          @doctor, @auu_id, @flags, @notes, @source_folder, @all_source_folders, @markdown_note, @photos,
          @created_at, @updated_at, @created_by, @updated_by, @version
        )
      `)
      .run({
        ...row,
        created_by: req.user?.id || 'system',
        updated_by: req.user?.id || 'system',
        version: 1,
      });
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'already_exists', id });
    }
    console.error('[patients POST] insert failed:', e);
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
  const created = findById(id);
  sse.broadcast(
    'patient.created',
    { id: created.id, version: created._version, ts: nowIso() },
    req.clientId,
  );
  res.status(201).json({ data: created, meta: { version: created._version } });
});

// SQL 給 UPDATE 用 — 不含 created_at（node:sqlite 嚴格驗 named params、多餘的會炸）
const UPDATE_SQL = `
  UPDATE patients SET
    chart_no=@chart_no, name=@name, birthday=@birthday,
    product_line=@product_line, status=@status, track=@track, refinement_level=@refinement_level,
    order_date=@order_date, start_date=@start_date,
    total_aligners_upper=@total_aligners_upper, current_aligner_upper=@current_aligner_upper,
    total_aligners_lower=@total_aligners_lower, current_aligner_lower=@current_aligner_lower,
    cycle_days=@cycle_days, last_visit=@last_visit, next_visit=@next_visit,
    has_consent=@has_consent, consent_pdf_path=@consent_pdf_path, scan_info=@scan_info,
    doctor=@doctor, auu_id=@auu_id, flags=@flags, notes=@notes,
    source_folder=@source_folder, all_source_folders=@all_source_folders,
    markdown_note=@markdown_note, photos=@photos,
    updated_at=@updated_at, updated_by=@updated_by, version=version+1
  WHERE id=@id
`;

// 把 row 過濾成 UPDATE_SQL 需要的欄位（drop created_at + created_by + version）
function toUpdateParams(row, userId) {
  const { created_at, created_by, version, ...rest } = row;
  return { ...rest, updated_by: userId };
}

// ─── PUT /api/patients/:id ───────────────────────────────
// 全量替換（client 帶完整 patient + version）
router.put('/:id', checkVersion('patients'), audit('patient'), (req, res) => {
  const id = req.params.id;
  req.beforeRow = findById(id); // 給 audit 用
  const body = req.body;
  const patient = { ...body, id, updatedAt: nowIso() };
  if (!patient.createdAt) patient.createdAt = req.beforeRow?.createdAt || patient.updatedAt;
  const row = patientObjToRow(patient);
  getDb()
    .prepare(UPDATE_SQL)
    .run(toUpdateParams(row, req.user?.id || 'system'));

  const updated = findById(id);
  sse.broadcast(
    'patient.updated',
    { id: updated.id, version: updated._version, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: updated, meta: { version: updated._version } });
});

// ─── PATCH /api/patients/:id ─────────────────────────────
// 部分更新（merge）
router.patch('/:id', checkVersion('patients'), audit('patient'), (req, res) => {
  const id = req.params.id;
  const before = findById(id);
  req.beforeRow = before;
  if (!before) return res.status(404).json({ error: 'not_found', id });
  const merged = { ...before, ...req.body, id, updatedAt: nowIso() };
  delete merged._version;
  delete merged._createdBy;
  delete merged._updatedBy;
  const row = patientObjToRow(merged);
  getDb()
    .prepare(UPDATE_SQL)
    .run(toUpdateParams(row, req.user?.id || 'system'));

  const updated = findById(id);
  sse.broadcast(
    'patient.updated',
    { id: updated.id, version: updated._version, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: updated, meta: { version: updated._version } });
});

// ─── DELETE /api/patients/:id ────────────────────────────
router.delete('/:id', checkVersion('patients'), audit('patient'), (req, res) => {
  const id = req.params.id;
  req.beforeRow = findById(id);
  const r = getDb().prepare('DELETE FROM patients WHERE id = ?').run(id);
  if (r.changes === 0) {
    return res.status(404).json({ error: 'not_found', id });
  }
  sse.broadcast('patient.deleted', { id, ts: nowIso() }, req.clientId);
  res.json({ data: { id }, meta: { deleted: true } });
});

// ─── POST /api/patients/bulk ─────────────────────────────
// Body: { patients: Patient[] }
// 行為：INSERT OR REPLACE 每筆；不檢查 version（bulk 視為 admin override）
router.post('/bulk', audit('patient'), (req, res) => {
  const patients = req.body?.patients ?? [];
  if (!Array.isArray(patients)) {
    return res.status(400).json({ error: 'validation_error', message: 'patients array required' });
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO patients (
      id, chart_no, name, birthday, product_line, status, track, refinement_level,
      order_date, start_date,
      total_aligners_upper, current_aligner_upper, total_aligners_lower, current_aligner_lower,
      cycle_days, last_visit, next_visit, has_consent, consent_pdf_path, scan_info,
      doctor, auu_id, flags, notes, source_folder, all_source_folders, markdown_note, photos,
      created_at, updated_at, created_by, updated_by, version
    ) VALUES (
      @id, @chart_no, @name, @birthday, @product_line, @status, @track, @refinement_level,
      @order_date, @start_date,
      @total_aligners_upper, @current_aligner_upper, @total_aligners_lower, @current_aligner_lower,
      @cycle_days, @last_visit, @next_visit, @has_consent, @consent_pdf_path, @scan_info,
      @doctor, @auu_id, @flags, @notes, @source_folder, @all_source_folders, @markdown_note, @photos,
      @created_at, @updated_at, @created_by, @updated_by, @version
    )
  `);
  const now = nowIso();
  const userId = req.user?.id || 'system';
  db.exec('BEGIN');
  try {
    for (const p of patients) {
      const row = patientObjToRow({ ...p, updatedAt: p.updatedAt || now, createdAt: p.createdAt || now });
      stmt.run({ ...row, created_by: userId, updated_by: userId, version: 1 });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
  sse.broadcast(
    'bulk.imported',
    { entity: 'patient', count: patients.length, ts: nowIso() },
    req.clientId,
  );
  res.json({ data: { count: patients.length }, meta: {} });
});

export default router;
