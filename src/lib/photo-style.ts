// 病歷照片框線樣式 — 全域設定（粗細 + 顏色）
// 寫到 :root CSS variable、各 photo cell + 外框透過 var() 套用
// 存 localStorage（不走 IndexedDB sync — 是 user 視覺偏好、每台機獨立）

import { useEffect, useState } from 'react';

export type PhotoStyle = {
  borderWidth: number; // 1 ~ 6 px
  borderColor: string; // hex e.g. '#71717a'
};

export const DEFAULT_PHOTO_STYLE: PhotoStyle = {
  borderWidth: 2,
  borderColor: '#71717a', // zinc-500
};

const STORAGE_KEY = 'aligner-photo-style';

export const MIN_BORDER_WIDTH = 1;
export const MAX_BORDER_WIDTH = 6;

// preset 顏色（常用幾組、user 想自訂就 color picker）
export const PHOTO_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: '灰', value: '#71717a' }, // zinc-500
  { label: '深灰', value: '#52525b' }, // zinc-600
  { label: '白', value: '#e4e4e7' }, // zinc-200
  { label: '天藍', value: '#38bdf8' }, // sky-400
  { label: '綠', value: '#34d399' }, // emerald-400
  { label: '紫', value: '#a78bfa' }, // violet-400
  { label: '黃', value: '#fbbf24' }, // amber-400
  { label: '粉', value: '#f472b6' }, // pink-400
];

export function loadPhotoStyle(): PhotoStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PhotoStyle>;
      return {
        borderWidth: clampWidth(parsed.borderWidth ?? DEFAULT_PHOTO_STYLE.borderWidth),
        borderColor: typeof parsed.borderColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(parsed.borderColor)
          ? parsed.borderColor
          : DEFAULT_PHOTO_STYLE.borderColor,
      };
    }
  } catch {
    // fallthrough
  }
  return DEFAULT_PHOTO_STYLE;
}

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PHOTO_STYLE.borderWidth;
  return Math.max(MIN_BORDER_WIDTH, Math.min(MAX_BORDER_WIDTH, Math.round(n)));
}

export function savePhotoStyle(style: PhotoStyle) {
  const safe: PhotoStyle = {
    borderWidth: clampWidth(style.borderWidth),
    borderColor: /^#[0-9a-fA-F]{3,8}$/.test(style.borderColor) ? style.borderColor : DEFAULT_PHOTO_STYLE.borderColor,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  applyPhotoStyle(safe);
  // notify same-tab listeners（不同 tab/window 用 storage event）
  window.dispatchEvent(new CustomEvent('aligner-photo-style-change', { detail: safe }));
}

export function applyPhotoStyle(style: PhotoStyle) {
  document.documentElement.style.setProperty('--photo-border-width', `${style.borderWidth}px`);
  document.documentElement.style.setProperty('--photo-border-color', style.borderColor);
}

export function initPhotoStyle() {
  applyPhotoStyle(loadPhotoStyle());
}

// React hook — 自動讀 + 監聽 change event
export function usePhotoStyle(): PhotoStyle {
  const [style, setStyle] = useState<PhotoStyle>(loadPhotoStyle);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<PhotoStyle>).detail;
      if (detail) setStyle(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setStyle(loadPhotoStyle());
    };
    window.addEventListener('aligner-photo-style-change', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('aligner-photo-style-change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return style;
}

// 給 component 用的 style object（套到外框 / cell border）
export const PHOTO_BORDER_STYLE = {
  borderStyle: 'solid' as const,
  borderWidth: 'var(--photo-border-width)',
  borderColor: 'var(--photo-border-color)',
};
