// v0.6.0 注意：seed.ts 首次安裝才會跑（Dexie 空時），用 db.* 直接寫不走 dataLayer
//   - 跑時可能 DualDataLayer.start() 還沒連上 server、走 dataLayer 會 OfflineError
//   - dual 模式 production 部署時、server 已從 sync.json migrate 完、Dexie initial sync 後 count>0
//     → seed 永遠 skip、不會雙寫衝突
//   - 若真的 seed 跑了（罕見 edge case）、user 需手動「推到 NAS」一次同步上 server

import { db } from './db';
import { ensureDefaultLabsSeeded } from './lib/labs';
import { ensureDefaultDoctorsSeeded } from './lib/doctors';
import { deriveCurrentFromOrders } from './lib/reapply-excel';
import type { Order, Patient } from './types/Patient';

export type SeedResult =
  | { seeded: true; patientCount: number; orderCount: number; updates: number; newPatients: number }
  | { seeded: false; reason: 'already-has-data' | 'no-seed-file' | 'error'; count?: number; error?: string };

let inflight: Promise<SeedResult> | null = null;

export function seedIfEmpty(): Promise<SeedResult> {
  if (!inflight) inflight = doSeed();
  return inflight;
}

async function doSeed(): Promise<SeedResult> {
  // 永遠確保預設技工所/醫師存在 (即使 patients 已有資料)
  await ensureDefaultLabsSeeded();
  await ensureDefaultDoctorsSeeded();

  // 之前有 `if (!import.meta.env.DEV) return` 限制只在 dev 模式 seed
  // 但 vite preview (production) 下 DEV=false → 清空 DB 後不會自動 seed
  // 既然 dev-data JSON 在 build 時被 bundle 進 dist，就讓 prod 也能 seed
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

    // 4. 最終 chartNo 重編：按 earliest orderDate ASC（最早下單 = 0001）
    //    沒下單的病患（new + Excel 沒抓到的）排在後面，按生日再 fallback 姓名
    //    同時更新 orders 的 patientChartNo 維持一致
    const earliestByPatient = new Map<string, string>();
    for (const order of excelOrders) {
      const current = earliestByPatient.get(order.patientId);
      if (order.date && (!current || order.date < current)) {
        earliestByPatient.set(order.patientId, order.date);
      }
    }
    merged.sort((a, b) => {
      const da = earliestByPatient.get(a.id) ?? '9999-99-99';
      const db_ = earliestByPatient.get(b.id) ?? '9999-99-99';
      if (da !== db_) return da.localeCompare(db_);
      const ba = a.birthday ?? '9999-99-99';
      const bb = b.birthday ?? '9999-99-99';
      if (ba !== bb) return ba.localeCompare(bb);
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
    const chartNoMap = new Map<string, string>();
    merged.forEach((p, i) => {
      const newChartNo = String(i + 1).padStart(4, '0');
      chartNoMap.set(p.id, newChartNo);
      p.chartNo = newChartNo;
      // 同時把 patient.orderDate 填上 earliest order（讓列表排序 work）
      const earliest = earliestByPatient.get(p.id);
      if (earliest) p.orderDate = earliest;
    });
    for (const order of excelOrders) {
      const newChartNo = chartNoMap.get(order.patientId);
      if (newChartNo) order.patientChartNo = newChartNo;
    }

    // 5. 從 orders 推 currentAligner + track + refinementLevel
    //    track（流派）：第一筆 order 的 batchType 決定
    //      新設計/新設計1 → new-design / 舊設計/舊 → old-design / 新/(空) → null
    //    refinementLevel（精調次數）：第二筆+ 又出現「新設計/新設計1」的次數，cap 3
    //    status：保持 'active' / 'paused' / 'completed' / 'transferred-out' 不動（精調不再放這裡）
    if (excelOrders.length > 0) {
      const ordersByPatient = new Map<string, Order[]>();
      for (const o of excelOrders) {
        if (!ordersByPatient.has(o.patientId)) ordersByPatient.set(o.patientId, []);
        ordersByPatient.get(o.patientId)!.push(o);
      }
      for (const p of merged) {
        const os = ordersByPatient.get(p.id);
        if (!os || os.length === 0) continue;

        const derived = deriveCurrentFromOrders(os);
        if (derived.upper != null) p.currentAlignerUpper = derived.upper;
        if (derived.lower != null) p.currentAlignerLower = derived.lower;

        // 按日期排序找第一筆
        const sorted = [...os].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
        const firstBatch = sorted[0]?.batchType ?? '';
        if (firstBatch === '新設計' || firstBatch === '新設計1') p.track = 'new-design';
        else if (firstBatch === '舊設計' || firstBatch === '舊') p.track = 'old-design';
        else p.track = null;

        // 精調次數：從第二筆開始算「新設計/新設計1」出現幾次
        const refinementCount = sorted
          .slice(1)
          .filter((o) => o.batchType === '新設計' || o.batchType === '新設計1').length;
        p.refinementLevel = Math.min(refinementCount, 3) as 0 | 1 | 2 | 3;
      }
    }

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
