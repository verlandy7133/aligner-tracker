// 把 dev-data 裡的 Excel 匯入結果（醫師 / scanInfo / 副數總數 / 補建 patient / orders）
// 套用到「已有資料的 IndexedDB」。
//
// 這跟 seed 不同：seed 只在 DB 空時跑；這個是給已 seed 過、後來才修補的 dev-data 用。
// 為了不蓋掉 user 手動編輯，採「補空原則」：
//   - patient.doctor / scanInfo：只有當前 DB 是空才填
//   - totalAlignersUpper / currentAlignerUpper：只有當前 DB 是 null 才填
//   - hasConsent：只把 false 升級成 true (Excel 說有 PDF / 證明 → 採信；若 DB 已 true 不動)
//   - newPatients：DB 沒這個 id 才新增
//   - orders：DB 沒這個 order id 才新增

import { db } from '../db';
import type { Order, Patient } from '../types/Patient';

// 從 alignerRange 字串解出「這批下單包含的副數」上下顎最大值。
// 支援格式：
//   'UL12-13'        → upper=13, lower=13 (UL = 同時上下)
//   'UL15'           → upper=15, lower=15
//   'U3-15+L3-4'     → upper=15, lower=4
//   'U18-23'         → upper=23, lower=null
//   'L1-2'           → upper=null, lower=2
function parseAlignerRangeMax(range: string): { upper: number | null; lower: number | null } {
  if (!range) return { upper: null, lower: null };
  let upper: number | null = null;
  let lower: number | null = null;
  // 切 + 段
  for (const seg of range.split('+')) {
    // 抓 prefix(U|L|UL) + 數字-數字 或 單一數字
    const m = seg.match(/^(UL|U|L)(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const prefix = m[1];
    const max = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
    if (prefix === 'UL') {
      if (upper == null || max > upper) upper = max;
      if (lower == null || max > lower) lower = max;
    } else if (prefix === 'U') {
      if (upper == null || max > upper) upper = max;
    } else if (prefix === 'L') {
      if (lower == null || max > lower) lower = max;
    }
  }
  return { upper, lower };
}

// 從某 patient 的所有 orders 推算「目前戴到第幾副」
// 規則：取 progress = '已完成' 或 '診所已收到牙套' 的 order 中，alignerRange 最大值
//      找不到完成的就取最新一筆 order 的最大值（保守估計）
export function deriveCurrentFromOrders(orders: Order[]): { upper: number | null; lower: number | null } {
  if (!orders.length) return { upper: null, lower: null };
  const completed = orders.filter(
    (o) => o.progress === '已完成' || o.progress === '診所已收到牙套',
  );
  const pool = completed.length > 0 ? completed : orders;
  let upper: number | null = null;
  let lower: number | null = null;
  for (const o of pool) {
    const m = parseAlignerRangeMax(o.alignerRange ?? '');
    if (m.upper != null && (upper == null || m.upper > upper)) upper = m.upper;
    if (m.lower != null && (lower == null || m.lower > lower)) lower = m.lower;
  }
  return { upper, lower };
}

export type ReapplyResult = {
  updates: {
    candidates: number;
    patientsPatched: number;
    fieldsPatched: { doctor: number; scanInfo: number; totalAligners: number; hasConsent: number };
    skippedNotFound: number;
    skippedAllSet: number;
  };
  newPatients: { added: number; skippedExisted: number };
  orders: { added: number; skippedExisted: number };
  derivedCurrent: { patientsUpdated: number };
};

type ExcelUpdate = Partial<Patient> & {
  id: string;
  // import 寫入時帶上的姓名 / 生日，給 fallback 比對用 (id 對不上時靠這個)
  refName?: string | null;
  refBirthday?: string | null;
};

export async function reapplyExcelUpdates(): Promise<ReapplyResult> {
  const updMod = await import('../../dev-data/excel-patient-updates.json');
  const updData = (updMod as unknown as {
    default: { updates?: ExcelUpdate[]; newPatients?: Patient[] };
  }).default;
  const updates: ExcelUpdate[] = updData.updates ?? [];
  const newPatients: Patient[] = updData.newPatients ?? [];

  let excelOrders: Order[] = [];
  try {
    const orderMod = await import('../../dev-data/excel-orders.json');
    const orderData = (orderMod as unknown as { default: { orders?: Order[] } }).default;
    excelOrders = orderData.orders ?? [];
  } catch {
    // optional
  }

  const result: ReapplyResult = {
    updates: {
      candidates: updates.length,
      patientsPatched: 0,
      fieldsPatched: { doctor: 0, scanInfo: 0, totalAligners: 0, hasConsent: 0 },
      skippedNotFound: 0,
      skippedAllSet: 0,
    },
    newPatients: { added: 0, skippedExisted: 0 },
    orders: { added: 0, skippedExisted: 0 },
    derivedCurrent: { patientsUpdated: 0 },
  };

  const nowIso = new Date().toISOString();

  // 為了應對 scan-aligner-folders.mjs 每次重產 UUID，建一個 name+birthday → DB patient 的反向索引
  // updates.id 找不到時走這個 fallback
  const allDbPatients = await db.patients.toArray();
  const byNameBirthday = new Map<string, Patient>();
  for (const p of allDbPatients) {
    if (p.name && p.birthday) byNameBirthday.set(`${p.name}|${p.birthday}`, p);
  }

  // 為了 fallback 比對，需要 patients-import.json 提供 update.id → name/birthday 的映射
  // (excel-patient-updates 自己只有 id 跟 fields，沒姓名)
  const patientsMod = await import('../../dev-data/patients-import.json');
  const patientsData = (patientsMod as unknown as { default: { patients: Patient[] } }).default;
  const idToImport = new Map<string, Patient>();
  for (const p of patientsData.patients ?? []) idToImport.set(p.id, p);

  // 1. 套 updates 到既有 patient
  for (const u of updates) {
    let existing = await db.patients.get(u.id);
    if (!existing) {
      // fallback：先用 update 自帶的 refName/refBirthday，再 fallback 到 patients-import.json 查
      let refName: string | null | undefined = u.refName;
      let refBirthday: string | null | undefined = u.refBirthday;
      if (!refName || !refBirthday) {
        const ref = idToImport.get(u.id);
        refName = ref?.name;
        refBirthday = ref?.birthday;
      }
      if (refName && refBirthday) {
        const fb = byNameBirthday.get(`${refName}|${refBirthday}`);
        if (fb) existing = fb;
      }
    }
    if (!existing) {
      result.updates.skippedNotFound++;
      continue;
    }
    const patch: Partial<Patient> = {};

    if (u.doctor && (!existing.doctor || !existing.doctor.trim())) {
      patch.doctor = u.doctor;
      result.updates.fieldsPatched.doctor++;
    }
    if (u.scanInfo && (!existing.scanInfo || !existing.scanInfo.trim())) {
      patch.scanInfo = u.scanInfo;
      result.updates.fieldsPatched.scanInfo++;
    }
    // totalAlignersUpper / Lower：強制覆寫（早期 import 把上/下寫成 cur/total，
    // DB 裡的值不可信，import 既然帶新值就以 Excel 為準）
    let totalChanged = false;
    if (u.totalAlignersUpper != null && u.totalAlignersUpper !== existing.totalAlignersUpper) {
      patch.totalAlignersUpper = u.totalAlignersUpper;
      totalChanged = true;
    }
    if (u.totalAlignersLower != null && u.totalAlignersLower !== existing.totalAlignersLower) {
      patch.totalAlignersLower = u.totalAlignersLower;
      totalChanged = true;
    }
    // 若改了 total，就把舊的 currentAligner（之前被誤填成 Excel 左半邊）清掉
    // 之後 deriveCurrent 階段會從 orders 重新推
    if (totalChanged) {
      if (existing.currentAlignerUpper != null) patch.currentAlignerUpper = null;
      if (existing.currentAlignerLower != null) patch.currentAlignerLower = null;
      result.updates.fieldsPatched.totalAligners++;
    }
    if (u.hasConsent === true && existing.hasConsent === false) {
      patch.hasConsent = true;
      result.updates.fieldsPatched.hasConsent++;
    }

    if (Object.keys(patch).length === 0) {
      result.updates.skippedAllSet++;
      continue;
    }
    // 用 existing.id（可能是 fallback 找到的、跟 u.id 不同）
    await db.patients.update(existing.id, { ...patch, updatedAt: nowIso });
    result.updates.patientsPatched++;
  }

  // 2. 補建 newPatients (id 比不到時用 name+birthday 防重複)
  for (const np of newPatients) {
    const byId = await db.patients.get(np.id);
    if (byId) {
      result.newPatients.skippedExisted++;
      continue;
    }
    if (np.name && np.birthday && byNameBirthday.has(`${np.name}|${np.birthday}`)) {
      result.newPatients.skippedExisted++;
      continue;
    }
    // v0.1.9：JSON 可能沒帶 markdownNote/photos（Python script 不寫這兩欄）→ 補預設
    const enriched: Patient = {
      ...np,
      markdownNote: np.markdownNote ?? '',
      photos: np.photos ?? {},
    };
    await db.patients.put(enriched);
    result.newPatients.added++;
  }

  // 3. 補 orders
  // 因為 scan 可能改過 patient.id，要把 order.patientId 也對映到 DB 實際 id
  function resolveDbPatientId(jsonPatientId: string): string | null {
    if (idToImport.has(jsonPatientId)) {
      const ref = idToImport.get(jsonPatientId)!;
      if (ref.name && ref.birthday) {
        const fb = byNameBirthday.get(`${ref.name}|${ref.birthday}`);
        if (fb) return fb.id;
      }
    }
    // newPatients：自己帶 id，沒在 patients-import.json 裡
    return jsonPatientId;
  }

  for (const o of excelOrders) {
    const existing = await db.orders.get(o.id);
    if (existing) {
      result.orders.skippedExisted++;
      continue;
    }
    const remappedPid = resolveDbPatientId(o.patientId);
    await db.orders.put({ ...o, patientId: remappedPid ?? o.patientId });
    result.orders.added++;
  }

  // 4. 從 orders 推算 currentAlignerUpper / Lower
  //    每位 patient：取已收/已完成的 order 中 alignerRange 最大值；沒有的話用最新 order 推
  const refreshedPatients = await db.patients.toArray();
  const allOrders = await db.orders.toArray();
  const ordersByPid = new Map<string, Order[]>();
  for (const o of allOrders) {
    if (!ordersByPid.has(o.patientId)) ordersByPid.set(o.patientId, []);
    ordersByPid.get(o.patientId)!.push(o);
  }
  for (const p of refreshedPatients) {
    const os = ordersByPid.get(p.id) ?? [];
    if (!os.length) continue;

    const derived = deriveCurrentFromOrders(os);
    const fields: Partial<Patient> = {};
    if (derived.upper != null && derived.upper !== p.currentAlignerUpper) {
      fields.currentAlignerUpper = derived.upper;
    }
    if (derived.lower != null && derived.lower !== p.currentAlignerLower) {
      fields.currentAlignerLower = derived.lower;
    }

    // track（流派）：第一筆 order batchType 決定
    const sorted = [...os].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const firstBatch = sorted[0]?.batchType ?? '';
    let newTrack: Patient['track'];
    if (firstBatch === '新設計' || firstBatch === '新設計1') newTrack = 'new-design';
    else if (firstBatch === '舊設計' || firstBatch === '舊') newTrack = 'old-design';
    else newTrack = null;
    if (newTrack !== p.track) fields.track = newTrack;

    // 精調次數：從第二筆開始算「新設計/新設計1」出現幾次
    const refinementCount = sorted
      .slice(1)
      .filter((o) => o.batchType === '新設計' || o.batchType === '新設計1').length;
    const newLevel = Math.min(refinementCount, 3) as 0 | 1 | 2 | 3;
    if (newLevel !== p.refinementLevel) fields.refinementLevel = newLevel;

    if (Object.keys(fields).length > 0) {
      await db.patients.update(p.id, { ...fields, updatedAt: nowIso });
      result.derivedCurrent.patientsUpdated++;
    }
  }

  return result;
}
