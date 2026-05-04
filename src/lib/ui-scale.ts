// UI 字級 scale —— 影響整個 App 的 root font-size、所有 rem 自動跟著放大
// 存在 settings table (key = 'ui-scale')、預設 1.0
// applyScale() 改 html element 的 fontSize、所有 Tailwind 預設用 rem 的 utility 都會一起 scale

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

const SETTINGS_KEY = 'ui-scale';
export const DEFAULT_SCALE = 1.0;
export const MIN_SCALE = 0.85;
export const MAX_SCALE = 1.5;

export async function loadScale(): Promise<number> {
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    if (typeof row?.value === 'number') return row.value;
  } catch {
    // 忽略
  }
  return DEFAULT_SCALE;
}

export async function saveScale(scale: number): Promise<void> {
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  await db.settings.put({ key: SETTINGS_KEY, value: clamped });
  applyScale(clamped);
}

export function applyScale(scale: number): void {
  // 16px 是瀏覽器預設 root font-size、Tailwind 所有 rem 都基於這個
  document.documentElement.style.fontSize = `${scale * 16}px`;
}

// 啟動時跑（App.tsx mount 時）— 從 IndexedDB 讀並套用
export async function initScale(): Promise<void> {
  const scale = await loadScale();
  applyScale(scale);
}

// 提供 hook 給 SettingsPage 用
export function useScale(): number {
  return useLiveQuery(loadScale, []) ?? DEFAULT_SCALE;
}
