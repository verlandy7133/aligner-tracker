import { db } from './db';
import { ensureDefaultLabsSeeded } from './lib/labs';
import { ensureDefaultDoctorsSeeded } from './lib/doctors';
import type { Order, Patient } from './types/Patient';

export type SeedResult =
  | { seeded: true; patientCount: number; orderCount: number; updates: number; newPatients: number }
  | { seeded: false; reason: 'not-dev' | 'already-has-data' | 'no-seed-file' | 'error'; count?: number; error?: string };

let inflight: Promise<SeedResult> | null = null;

export function seedIfEmpty(): Promise<SeedResult> {
  if (!inflight) inflight = doSeed();
  return inflight;
}

async function doSeed(): Promise<SeedResult> {
  // 永遠確保預設技工所/醫師存在 (即使 patients 已有資料)
  await ensureDefaultLabsSeeded();
  await ensureDefaultDoctorsSeeded();

  if (!import.meta.env.DEV) return { seeded: false, reason: 'not-dev' };

  const existing = await db.patients.count();
  if (existing > 0) return { seeded: false, reason: 'already-has-data', count: existing };

  try {
    // 1. 載入 patients-import.json (從資料夾 scan 出的 patients)
    const patientsMod = await import('../dev-data/patients-import.json');
    const patientsData = (patientsMod as unknown as { default: { patients: Patient[] } }).default;
    if (!patientsData?.patients?.length) {
      return { seeded: false, reason: 'no-seed-file' };
    }

    // 2. 嘗試載入 Excel 匯入產生的 updates / new patients / orders（可能不存在）
    let excelUpdates: Array<Patient & { id: string }> = [];
    let excelNewPatients: Patient[] = [];
    let excelOrders: Order[] = [];
    try {
      const updMod = await import('../dev-data/excel-patient-updates.json');
      const updData = (updMod as unknown as {
        default: { updates: Array<Patient & { id: string }>; newPatients: Patient[] };
      }).default;
      excelUpdates = updData.updates ?? [];
      excelNewPatients = updData.newPatients ?? [];
    } catch {
      // 沒有 excel 匯入也 OK
    }
    try {
      const orderMod = await import('../dev-data/excel-orders.json');
      const orderData = (orderMod as unknown as { default: { orders: Order[] } }).default;
      excelOrders = orderData.orders ?? [];
    } catch {
      // 沒有 orders 也 OK
    }

    // 3. 套用 Excel updates 到 patients
    const updateMap = new Map(excelUpdates.map((u) => [u.id, u]));
    const merged = patientsData.patients.map((p) => {
      const upd = updateMap.get(p.id);
      if (!upd) return p;
      return { ...p, ...upd };
    });
    // 加上自動補建的新 patients
    merged.push(...excelNewPatients);

    await db.patients.bulkPut(merged);

    if (excelOrders.length > 0) {
      await db.orders.bulkPut(excelOrders);
    }

    return {
      seeded: true,
      patientCount: merged.length,
      orderCount: excelOrders.length,
      updates: excelUpdates.length,
      newPatients: excelNewPatients.length,
    };
  } catch (e) {
    return { seeded: false, reason: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
