// SQLite row <-> Patient/Order 物件 互轉
//
// SQLite 不支援 array / object 欄位 → JSON.stringify 存 TEXT
// boolean 欄位 → INTEGER 0/1
// camelCase ↔ snake_case 由 client/server 介面負責對齊

// ─── Patient 轉換 ────────────────────────────────────────
export function patientRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    chartNo: row.chart_no,
    name: row.name,
    birthday: row.birthday,
    productLine: row.product_line,
    status: row.status,
    track: row.track,
    refinementLevel: row.refinement_level,
    orderDate: row.order_date,
    startDate: row.start_date,
    totalAlignersUpper: row.total_aligners_upper,
    currentAlignerUpper: row.current_aligner_upper,
    totalAlignersLower: row.total_aligners_lower,
    currentAlignerLower: row.current_aligner_lower,
    cycleDays: row.cycle_days,
    lastVisit: row.last_visit,
    nextVisit: row.next_visit,
    hasConsent: row.has_consent === 1,
    consentPdfPath: row.consent_pdf_path,
    scanInfo: row.scan_info,
    doctor: row.doctor,
    auuId: row.auu_id || undefined,
    flags: parseJsonField(row.flags, []),
    notes: row.notes ?? '',
    sourceFolder: row.source_folder ?? '',
    allSourceFolders: parseJsonField(row.all_source_folders, []),
    markdownNote: row.markdown_note ?? '',
    photos: parseJsonField(row.photos, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // meta (Phase 1 不暴露給 client 業務邏輯、只給 server / DataLayer 用)
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    _version: row.version,
  };
}

export function patientObjToRow(p) {
  return {
    id: p.id,
    chart_no: p.chartNo,
    name: p.name,
    birthday: p.birthday ?? null,
    product_line: p.productLine,
    status: p.status,
    track: p.track ?? null,
    refinement_level: p.refinementLevel ?? 0,
    order_date: p.orderDate ?? null,
    start_date: p.startDate ?? null,
    total_aligners_upper: p.totalAlignersUpper ?? null,
    current_aligner_upper: p.currentAlignerUpper ?? null,
    total_aligners_lower: p.totalAlignersLower ?? null,
    current_aligner_lower: p.currentAlignerLower ?? null,
    cycle_days: p.cycleDays ?? 14,
    last_visit: p.lastVisit ?? null,
    next_visit: p.nextVisit ?? null,
    has_consent: p.hasConsent ? 1 : 0,
    consent_pdf_path: p.consentPdfPath ?? null,
    scan_info: p.scanInfo ?? null,
    doctor: p.doctor ?? null,
    auu_id: p.auuId ?? null,
    flags: JSON.stringify(p.flags ?? []),
    notes: p.notes ?? '',
    source_folder: p.sourceFolder ?? '',
    all_source_folders: JSON.stringify(p.allSourceFolders ?? []),
    markdown_note: p.markdownNote ?? '',
    photos: JSON.stringify(p.photos ?? {}),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ─── Order 轉換 ──────────────────────────────────────────
export function orderRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientChartNo: row.patient_chart_no,
    patientName: row.patient_name,
    date: row.date,
    doctor: row.doctor ?? '',
    batchType: row.batch_type ?? '',
    alignerRange: row.aligner_range ?? '',
    progress: row.progress,
    expectedDate: row.expected_date,
    actualDate: row.actual_date,
    nextStep: row.next_step ?? '',
    notes: row.notes ?? '',
    lab: row.lab ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    _version: row.version,
  };
}

export function orderObjToRow(o) {
  return {
    id: o.id,
    patient_id: o.patientId,
    patient_chart_no: o.patientChartNo,
    patient_name: o.patientName,
    date: o.date,
    doctor: o.doctor ?? '',
    batch_type: o.batchType ?? '',
    aligner_range: o.alignerRange ?? '',
    progress: o.progress,
    expected_date: o.expectedDate ?? null,
    actual_date: o.actualDate ?? null,
    next_step: o.nextStep ?? '',
    notes: o.notes ?? '',
    lab: o.lab ?? '',
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

// ─── Visit 轉換 (v0.7.0 回診登記)─────────────────────────
export function visitRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    date: row.date,
    visitType: row.visit_type,
    alignerUpper: row.aligner_upper,
    alignerLower: row.aligner_lower,
    nextVisit: row.next_visit,
    note: row.note ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    _version: row.version,
  };
}

export function visitObjToRow(v) {
  return {
    id: v.id,
    patient_id: v.patientId,
    date: v.date,
    visit_type: v.visitType ?? '定期調整',
    aligner_upper: v.alignerUpper ?? null,
    aligner_lower: v.alignerLower ?? null,
    next_visit: v.nextVisit ?? null,
    note: v.note ?? '',
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  };
}

// ─── 通用 helper ──────────────────────────────────────────
function parseJsonField(s, fallback) {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
