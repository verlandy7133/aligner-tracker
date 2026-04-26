import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { injectCustomThemeCSS, removeCustomThemeCSS } from './lib/custom-theme-css';

export const THEMES = ['current', 'fashion', 'plain', 'modern', 'custom'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Record<Theme, string> = {
  current: '現在版本',
  fashion: '時尚',
  plain: '樸實',
  modern: '現代',
  custom: '✎ 自定義',
};

export const THEME_DESCRIPTION: Record<Theme, string> = {
  current: '深色 + sky/violet 漸層',
  fashion: '暗黑 + magenta/cyan 霓虹',
  plain: '灰底 + mono 字體',
  modern: '簡潔幾何 + emerald 細線',
  custom: '自選背景色、強調色、字體',
};

export type FontFamily = 'sans' | 'mono' | 'serif';

export type CustomThemeConfig = {
  bodyBg: string; // 背景色 hex
  accent: string; // 強調色 hex (取代 sky-500)
  fontFamily: FontFamily;
};

export const DEFAULT_CUSTOM_CONFIG: CustomThemeConfig = {
  bodyBg: '#1e293b', // slate-800
  accent: '#10b981', // emerald-500
  fontFamily: 'sans',
};

export const FONT_FAMILY_LABEL: Record<FontFamily, string> = {
  sans: '無襯線 (Inter)',
  mono: '等寬 (JetBrains Mono)',
  serif: '襯線 (Georgia)',
};

export const FONT_FAMILY_CSS: Record<FontFamily, string> = {
  sans: "'Inter', system-ui, 'Segoe UI', 'Noto Sans TC', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  serif: "Georgia, 'Times New Roman', 'Noto Serif TC', serif",
};

const CUSTOM_KEY = 'theme-custom';

export async function loadCustomConfig(): Promise<CustomThemeConfig> {
  try {
    const row = await db.settings.get(CUSTOM_KEY);
    if (row?.value) {
      return { ...DEFAULT_CUSTOM_CONFIG, ...(row.value as Partial<CustomThemeConfig>) };
    }
  } catch {
    // 忽略
  }
  return DEFAULT_CUSTOM_CONFIG;
}

export async function saveCustomConfig(c: CustomThemeConfig): Promise<void> {
  await db.settings.put({ key: CUSTOM_KEY, value: c });
}

export function useCustomConfig(): CustomThemeConfig {
  const v = useLiveQuery(async () => loadCustomConfig(), [], DEFAULT_CUSTOM_CONFIG);
  return v ?? DEFAULT_CUSTOM_CONFIG;
}

const SETTINGS_KEY = 'theme';
const DEFAULT_THEME: Theme = 'current';

export async function loadTheme(): Promise<Theme> {
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    const v = row?.value as Theme | undefined;
    if (v && THEMES.includes(v)) return v;
  } catch {
    // settings table 不存在 (Dexie 還沒升 v5) → 用預設
  }
  return DEFAULT_THEME;
}

export async function saveTheme(theme: Theme): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: theme });
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): Theme {
  const v = useLiveQuery(async () => loadTheme(), [], DEFAULT_THEME);
  const theme = v ?? DEFAULT_THEME;
  const customCfg = useCustomConfig();

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'custom') {
      injectCustomThemeCSS(customCfg);
    } else {
      removeCustomThemeCSS();
    }
  }, [theme, customCfg]);
  return theme;
}
