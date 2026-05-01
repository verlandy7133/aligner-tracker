import type { PatientFlag, PatientStatus, PatientTrack, ProgressStatus } from './types/Patient';

// ─── 下單進度 ───────────────────────────────────────────────
export const PROGRESS_BADGE: Record<ProgressStatus, string> = {
  尚未開始: 'bg-zinc-700/30 text-zinc-300 border-zinc-700',
  已下單牙套: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  診所已收到牙套: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  已完成: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

// ─── 醫師 ───────────────────────────────────────────────
// 已搬到 src/lib/doctors.ts 變成動態（可在 SettingsPage 增刪改）
// 新代碼改用 useDoctors() hook

// ─── 技工所 (Lab) ───────────────────────────────────────────
// 已搬到 src/lib/labs.ts 變成動態（可在 SettingsPage 增刪改）
// 這裡留個空殼避免 import 錯誤，新代碼改用 useLabs() hook

export { PRODUCT_LINE_LABEL } from './types/Patient';

export const STATUS_LABEL: Record<PatientStatus, string> = {
  active: '治療中',
  paused: '中斷',
  completed: '完成',
  'transferred-out': '已轉出',
};

export const STATUS_BADGE: Record<PatientStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  'transferred-out': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

// ─── 流派（供應商倒閉事件後分類）────────────────────────
export const TRACK_LABEL: Record<NonNullable<PatientTrack>, string> = {
  'new-design': '新設計',
  'old-design': '舊設計',
};

export const TRACK_BADGE: Record<NonNullable<PatientTrack>, string> = {
  'new-design': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'old-design': 'bg-teal-500/15 text-teal-300 border-teal-500/30',
};

// ─── 精調級別 ────────────────────────────────────────
export const REFINEMENT_LABEL: Record<1 | 2 | 3, string> = {
  1: '精調 一',
  2: '精調 二',
  3: '精調 三+',
};

export const REFINEMENT_BADGE: Record<1 | 2 | 3, string> = {
  1: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  2: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  3: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
};

export const PRODUCT_LINE_BADGE = {
  invisalign: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  riyue: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  zenyum: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  retainer: 'bg-zinc-600/15 text-zinc-400 border-zinc-600/30',
} as const;

export const FLAG_LABEL: Record<PatientFlag, string> = {
  'needs-payment': '待繳費',
  'needs-followup': '待回診',
  'brand-switched-to-invisalign': '已轉隱適美',
};

export const FLAG_BADGE: Record<PatientFlag, string> = {
  'needs-payment': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  'needs-followup': 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  'brand-switched-to-invisalign': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

// ISO YYYY-MM-DD → 民國 YY/MM/DD（民國年無前置 0）
// 例：2000-10-25 → 89/10/25；2012-01-14 → 101/01/14
export function toROCDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10) - 1911;
  if (year < 1) return null;
  return `${year}/${m[2]}/${m[3]}`;
}

export function calcAge(birthday: string | null, today = new Date()): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}
