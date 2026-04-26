// 醫師動態管理 (跟 labs.ts 同樣模式，存 settings table key='doctors')

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export type Doctor = {
  id: string; // slug
  name: string;
  color: string; // hex
};

export const DEFAULT_DOCTORS: Doctor[] = [
  { id: 'chen-zhizhong', name: '陳執中', color: '#f59e0b' }, // amber
  { id: 'lin-yingchen', name: '林英辰', color: '#10b981' }, // emerald
  { id: 'zhang-qizhen', name: '張綺真', color: '#a855f7' }, // violet
];

const SETTINGS_KEY = 'doctors';

export async function loadDoctors(): Promise<Doctor[]> {
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    if (Array.isArray(row?.value)) return row.value as Doctor[];
  } catch {
    // 忽略
  }
  return DEFAULT_DOCTORS;
}

export async function saveDoctors(doctors: Doctor[]): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: doctors });
}

export async function ensureDefaultDoctorsSeeded(): Promise<void> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) {
    await saveDoctors(DEFAULT_DOCTORS);
  }
}

export function useDoctors(): Doctor[] {
  const v = useLiveQuery(async () => loadDoctors(), [], DEFAULT_DOCTORS);
  return v ?? DEFAULT_DOCTORS;
}

function hexAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function doctorBadgeStyle(doctor: Doctor | undefined): React.CSSProperties {
  if (!doctor) return {};
  return {
    backgroundColor: hexAlpha(doctor.color, 0.15),
    color: doctor.color,
    borderColor: hexAlpha(doctor.color, 0.3),
  };
}
