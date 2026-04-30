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

  // 治療時程（patient 級別，不分顎；取上下顎較長那個算）
  cycleDays: number;
  effectiveStartDate: string | null; // startDate || orderDate
  monthsElapsed: number | null; // 從 effectiveStartDate 到今天
  monthsRemaining: number | null; // 今天到較長一顎的 estimatedEndDate
  totalMonths: number | null; // effectiveStart 到較長一顎的 endDate
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
  const cycleDays = patient.cycleDays > 0 ? patient.cycleDays : 14;
  // startDate 多半沒填 → 退到 orderDate 至少有個基準算月份
  const effectiveStartDate = patient.startDate || patient.orderDate;

  const upper = jawProgress(
    patient.totalAlignersUpper,
    patient.currentAlignerUpper,
    effectiveStartDate,
    cycleDays,
    todayISO,
  );
  const lower = jawProgress(
    patient.totalAlignersLower,
    patient.currentAlignerLower,
    effectiveStartDate,
    cycleDays,
    todayISO,
  );
  const hasAnyData = upper.total != null || lower.total != null;
  const lagU = upper.lag ?? 0;
  const lagL = lower.lag ?? 0;
  const worstLag = Math.max(lagU, lagL);
  const isLagging = worstLag >= 2;

  // 月份計算（30 天/月）
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const monthsElapsed =
    effectiveStartDate ? round1(diffDays(effectiveStartDate, todayISO) / 30) : null;
  // 取上下顎較晚的 estimatedEndDate（較長那顎決定整體療程）
  const endU = upper.estimatedEndDate;
  const endL = lower.estimatedEndDate;
  const latestEnd =
    endU && endL ? (endU > endL ? endU : endL) : (endU ?? endL ?? null);
  const monthsRemaining =
    latestEnd ? Math.max(0, round1(diffDays(todayISO, latestEnd) / 30)) : null;
  const totalMonths =
    effectiveStartDate && latestEnd
      ? round1(diffDays(effectiveStartDate, latestEnd) / 30)
      : null;

  return {
    upper,
    lower,
    hasAnyData,
    isLagging,
    worstLag,
    cycleDays,
    effectiveStartDate,
    monthsElapsed,
    monthsRemaining,
    totalMonths,
  };
}
