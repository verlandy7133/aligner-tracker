// 病患矯正進度推算 (純函式)
//
// 給定 patient + today，算出：
//   - expectedAlignerUpper / Lower：依 startDate + cycleDays 應該到第幾副
//   - actualAlignerUpper / Lower：currentAligner (患者實際進度)
//   - lagUpper / lagLower：落後幾副 (expected - actual)
//   - progressPercent：currentAligner / totalAligners
//   - estimatedEndDateUpper / Lower：startDate + cycleDays * total
//   - daysToEnd：距離預計完成日的天數
//
// 設計原則：
//   - 純函式 (沒副作用)
//   - missing data → null (不假設)
//   - 不耦合 React (用在 list / modal / detail 都行)

import type { Patient } from '../types/Patient';

export type JawProgress = {
  total: number | null;
  current: number | null;
  expected: number | null;
  lag: number | null; // expected - current (正數 = 落後)
  progressPercent: number | null;
  estimatedEndDate: string | null;
  daysToEnd: number | null;
};

export type PatientProgress = {
  upper: JawProgress;
  lower: JawProgress;
  hasAnyData: boolean;
  /** lag 任一顎 > N 副就標 lagging */
  isLagging: boolean;
  worstLag: number; // 取上下顎較大那個
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function diffDays(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / MS_PER_DAY);
}

function addDays(from: string, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jawProgress(
  total: number | null,
  current: number | null,
  startDate: string | null,
  cycleDays: number,
  todayISO: string,
): JawProgress {
  const expected =
    startDate && cycleDays > 0 ? Math.max(0, Math.floor(diffDays(startDate, todayISO) / cycleDays) + 1) : null;
  // expected 不能超過 total
  const expectedClamped = expected != null && total != null ? Math.min(expected, total) : expected;
  const lag = expectedClamped != null && current != null ? expectedClamped - current : null;
  const progressPercent =
    current != null && total != null && total > 0 ? Math.round((current / total) * 100) : null;
  const estimatedEndDate =
    startDate && total != null && cycleDays > 0 ? addDays(startDate, cycleDays * total) : null;
  const daysToEnd = estimatedEndDate ? diffDays(todayISO, estimatedEndDate) : null;

  return {
    total,
    current,
    expected: expectedClamped,
    lag,
    progressPercent,
    estimatedEndDate,
    daysToEnd,
  };
}

export function deriveProgress(patient: Patient, todayISO: string): PatientProgress {
  const cycleDays = patient.cycleDays > 0 ? patient.cycleDays : 10;
  const upper = jawProgress(
    patient.totalAlignersUpper,
    patient.currentAlignerUpper,
    patient.startDate,
    cycleDays,
    todayISO,
  );
  const lower = jawProgress(
    patient.totalAlignersLower,
    patient.currentAlignerLower,
    patient.startDate,
    cycleDays,
    todayISO,
  );
  const hasAnyData = upper.total != null || lower.total != null;
  const lagU = upper.lag ?? 0;
  const lagL = lower.lag ?? 0;
  const worstLag = Math.max(lagU, lagL);
  const isLagging = worstLag >= 2; // 落後 2 副以上才算
  return { upper, lower, hasAnyData, isLagging, worstLag };
}
