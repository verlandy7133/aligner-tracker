// 技工所動態管理
//
// 從寫死改成存在 settings table (key = 'labs')，可在 SettingsPage 增刪改。
// 預設提供 3 個 (美鉑 / 世宇 / 隱適美) 對應原本固定選項。
// 修改名稱不影響舊 orders（orders.lab 是字串，存的是當時的名字快照）。

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { ProductLine } from '../types/Patient';

export type Lab = {
  id: string; // slug，建議英數
  name: string; // 顯示名稱
  color: string; // hex
};

export const DEFAULT_LABS: Lab[] = [
  { id: 'meibo', name: '美鉑', color: '#a855f7' }, // violet
  { id: 'shiyu', name: '世宇', color: '#f59e0b' }, // amber
  { id: 'invisalign', name: '隱適美', color: '#0ea5e9' }, // sky
];

const SETTINGS_KEY = 'labs';

export async function loadLabs(): Promise<Lab[]> {
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    if (Array.isArray(row?.value)) return row.value as Lab[];
  } catch {
    // 忽略
  }
  return DEFAULT_LABS;
}

export async function saveLabs(labs: Lab[]): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: labs });
}

export async function ensureDefaultLabsSeeded(): Promise<void> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) {
    await saveLabs(DEFAULT_LABS);
  }
}

export function useLabs(): Lab[] {
  const v = useLiveQuery(async () => loadLabs(), [], DEFAULT_LABS);
  return v ?? DEFAULT_LABS;
}

export function defaultLabNameForProductLine(pl: ProductLine, labs: Lab[]): string {
  if (pl === 'invisalign') {
    return labs.find((l) => l.id === 'invisalign')?.name ?? labs[0]?.name ?? '';
  }
  return labs.find((l) => l.id === 'meibo')?.name ?? labs[0]?.name ?? '';
}

// 把 hex 轉成 Tailwind-like badge classNames (給已知 lab) — 給沒記在配色表的 fallback
export function labBadgeStyle(lab: Lab | undefined): React.CSSProperties {
  if (!lab) {
    return {};
  }
  return {
    backgroundColor: hexAlpha(lab.color, 0.15),
    color: lab.color,
    borderColor: hexAlpha(lab.color, 0.3),
  };
}

function hexAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
