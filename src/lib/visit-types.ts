// 回診類型動態管理（跟 doctors.ts 同樣模式，存 settings table key='visit-types'）
//
// settings 沒值時 fallback 到 DEFAULT_VISIT_TYPES（主上拍板 7 種）。

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { getDataLayer } from './data-layer';
import { DEFAULT_VISIT_TYPES } from '../types/Patient';

const SETTINGS_KEY = 'visit-types';

export async function loadVisitTypes(): Promise<string[]> {
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    if (Array.isArray(row?.value)) return row.value as string[];
  } catch {
    // 忽略
  }
  return DEFAULT_VISIT_TYPES;
}

export async function saveVisitTypes(types: string[]): Promise<void> {
  await getDataLayer().putSetting(SETTINGS_KEY, types);
}

export async function ensureDefaultVisitTypesSeeded(): Promise<void> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) {
    await saveVisitTypes(DEFAULT_VISIT_TYPES);
  }
}

export function useVisitTypes(): string[] {
  const v = useLiveQuery(async () => loadVisitTypes(), [], DEFAULT_VISIT_TYPES);
  return v ?? DEFAULT_VISIT_TYPES;
}

export { DEFAULT_VISIT_TYPES };
