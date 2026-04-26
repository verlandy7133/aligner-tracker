// 透過 helper service 呼叫 scan-aligner-folders.mjs，
// 抓最新的 patients JSON，跟 IndexedDB 比對 (姓名+生日)，只新增不存在的。

import { db } from '../db';
import type { Patient } from '../types/Patient';

export type RescanResult = {
  added: number;
  skipped: number;
  totalScanned: number;
  newNames: string[]; // 新增病患的姓名清單 (給 user 看)
};

const HELPER_URL = 'http://127.0.0.1:8765/rescan-folders';

function patientKey(p: Pick<Patient, 'name' | 'birthday'>): string {
  return `${p.name}|${p.birthday ?? ''}`;
}

export async function rescanAndImport(): Promise<RescanResult> {
  const resp = await fetch(HELPER_URL);
  if (!resp.ok) {
    let err = '';
    try {
      const j = await resp.json();
      err = (j as { error?: string }).error ?? resp.statusText;
    } catch {
      err = resp.statusText;
    }
    throw new Error(`helper: ${err}`);
  }
  const data = (await resp.json()) as { patients: Patient[] };
  const scanned = data.patients ?? [];

  const existing = await db.patients.toArray();
  const existingKeys = new Set(existing.map(patientKey));

  const newOnes: Patient[] = [];
  for (const p of scanned) {
    if (!existingKeys.has(patientKey(p))) {
      newOnes.push(p);
    }
  }

  if (newOnes.length > 0) {
    // chartNo 可能跟現有撞號 (scanner 從 0001 重編)，全部給新 chartNo
    const maxChart = existing.reduce(
      (m, p) => Math.max(m, parseInt(p.chartNo, 10) || 0),
      0,
    );
    let next = maxChart;
    const reChartNumbered = newOnes.map((p) => {
      next += 1;
      return { ...p, chartNo: String(next).padStart(4, '0') };
    });
    await db.patients.bulkPut(reChartNumbered);
  }

  return {
    added: newOnes.length,
    skipped: scanned.length - newOnes.length,
    totalScanned: scanned.length,
    newNames: newOnes.map((p) => p.name),
  };
}
