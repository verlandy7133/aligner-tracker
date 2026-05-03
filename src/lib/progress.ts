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

function addDays(from: string, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jawProgress(
  total: number | null,
  current: number | null,
  cycleDays: number,
  todayISO: string,
): JawProgress {
  // 進度百分比：current / total
  const progressPercent =
    current != null && total != null && total > 0 ? Math.round((current / total) * 100) : null;

  // 預計完成日 = 今天 + (剩餘副數 × 一副天數)
  // 不再從 startDate 推算（接續療程的 startDate 不可信，用實際剩餘進度才準）
  const remainingAligners =
    total != null && current != null ? Math.max(0, total - current) : null;
  const remainingDays =
    remainingAligners != null && cycleDays > 0 ? remainingAligners * cycleDays : null;
  const estimatedEndDate =
    remainingDays != null ? addDays(todayISO, remainingDays) : null;
  const daysToEnd = remainingDays;

  return {
    total,
    current,
    expected: null, // 不再算「預計到第 N 副」
    lag: null, // 不再算「超前/落後」
    progressPercent,
    estimatedEndDate,
    daysToEnd,
  };
}

export function deriveProgress(patient: Patient, todayISO: string): PatientProgress {
  const cycleDays = patient.cycleDays > 0 ? patient.cycleDays : 14;
  const upper = jawProgress(patient.totalAlignersUpper, patient.currentAlignerUpper, cycleDays, todayISO);
  const lower = jawProgress(patient.totalAlignersLower, patient.currentAlignerLower, cycleDays, todayISO);
  const hasAnyData = upper.total != null || lower.total != null;

  // 月份計算（用「實際進度」而不是日期）：
  //   已進行 = max(current 上下顎) × cycleDays / 30
  //   剩餘   = (max(total 上下顎) - max(current)) × cycleDays / 30
  //   總療程 = max(total 上下顎) × cycleDays / 30
  // 為什麼不用 startDate / orderDate：接續療程（refinement / 中途轉介）的人
  //   下單日近、但 current 已經很高 — 用日期算會以為才剛開始。用實際 current 才準。
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const maxCurrent = Math.max(upper.current ?? 0, lower.current ?? 0);
  const maxTotal = Math.max(upper.total ?? 0, lower.total ?? 0);
  const hasCurrent = upper.current != null || lower.current != null;
  const hasTotal = upper.total != null || lower.total != null;

  const monthsElapsed =
    hasCurrent && cycleDays > 0 ? round1((maxCurrent * cycleDays) / 30) : null;
  const monthsRemaining =
    hasTotal && cycleDays > 0
      ? Math.max(0, round1((Math.max(0, maxTotal - maxCurrent) * cycleDays) / 30))
      : null;
  const totalMonths =
    hasTotal && cycleDays > 0 ? round1((maxTotal * cycleDays) / 30) : null;

  return {
    upper,
    lower,
    hasAnyData,
    isLagging: false, // 不再有落後概念（接續療程會誤判）
    worstLag: 0,
    cycleDays,
    effectiveStartDate: patient.startDate || patient.orderDate, // 仍保留給其他地方參考
    monthsElapsed,
    monthsRemaining,
    totalMonths,
  };
}
