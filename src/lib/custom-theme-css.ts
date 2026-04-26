// 依使用者自訂的 CustomThemeConfig 動態產生 CSS string，
// 注入到 document head 的一個 <style id="aligner-custom-theme"> 元素。
// 配色策略：
//   - bodyBg = 主背景
//   - 自動推算 surface 色（依 luminance 決定要更亮 or 更暗）
//   - 自動推算 text 主色（亮底→深字、暗底→亮字）
//   - accent 取代所有 sky-500/300/400
//   - fontFamily 套用到 body

import { FONT_FAMILY_CSS, type CustomThemeConfig } from '../themes';

const STYLE_ID = 'aligner-custom-theme';

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function adjustLightness(hex: string, delta: number): string {
  const [r, g, b] = hexToRgb(hex);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + delta * 255)));
  return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function generateCustomThemeCSS(c: CustomThemeConfig): string {
  const isLight = relativeLuminance(c.bodyBg) > 0.5;
  // 亮底→表面更白；暗底→表面更暗（往對比方向）
  const surfaceTopColor = isLight ? '#ffffff' : adjustLightness(c.bodyBg, 0.1);
  const surfaceMidColor = isLight ? adjustLightness(c.bodyBg, 0.08) : adjustLightness(c.bodyBg, 0.05);
  const borderColor = isLight ? adjustLightness(c.bodyBg, -0.15) : adjustLightness(c.bodyBg, 0.15);
  const textPrimary = isLight ? '#0f172a' : '#f4f4f5';
  const textMuted = isLight ? '#475569' : '#a1a1aa';
  const textVeryMuted = isLight ? '#94a3b8' : '#71717a';
  const textDim = isLight ? '#cbd5e1' : '#52525b';
  const overlayBg = isLight ? 'rgba(15, 23, 42, 0.35)' : 'rgba(0, 0, 0, 0.6)';

  return `
html[data-theme="custom"] {
  color-scheme: ${isLight ? 'light' : 'dark'};
}
html[data-theme="custom"] body {
  background: ${c.bodyBg};
  color: ${textPrimary};
  font-family: ${FONT_FAMILY_CSS[c.fontFamily]};
}

/* 表面 */
html[data-theme="custom"] .bg-zinc-950 { background-color: ${surfaceTopColor} !important; }
html[data-theme="custom"] .bg-zinc-950\\/40 { background-color: ${rgba(surfaceTopColor.startsWith('#') ? surfaceTopColor : c.bodyBg, 0.6)} !important; }
html[data-theme="custom"] .bg-zinc-900 { background-color: ${surfaceMidColor} !important; }
html[data-theme="custom"] .bg-zinc-900\\/30 { background-color: ${rgba(c.bodyBg, isLight ? 0.5 : 0.5)} !important; }
html[data-theme="custom"] .bg-zinc-900\\/40 { background-color: ${rgba(c.bodyBg, isLight ? 0.6 : 0.6)} !important; }
html[data-theme="custom"] .bg-zinc-900\\/60 { background-color: ${surfaceMidColor} !important; }
html[data-theme="custom"] .bg-zinc-800 { background-color: ${adjustLightness(c.bodyBg, isLight ? -0.05 : 0.08)} !important; }
html[data-theme="custom"] .bg-zinc-800\\/30 { background-color: ${rgba(c.bodyBg, 0.4)} !important; }
html[data-theme="custom"] .bg-zinc-800\\/50 { background-color: ${rgba(c.bodyBg, 0.55)} !important; }
html[data-theme="custom"] .bg-zinc-800\\/60 { background-color: ${rgba(c.bodyBg, 0.7)} !important; }
html[data-theme="custom"] .bg-black\\/60 { background-color: ${overlayBg} !important; }

/* Text */
html[data-theme="custom"] .text-zinc-100 { color: ${textPrimary} !important; }
html[data-theme="custom"] .text-zinc-200 { color: ${textPrimary} !important; }
html[data-theme="custom"] .text-zinc-300 { color: ${textMuted} !important; }
html[data-theme="custom"] .text-zinc-400 { color: ${textMuted} !important; }
html[data-theme="custom"] .text-zinc-500 { color: ${textVeryMuted} !important; }
html[data-theme="custom"] .text-zinc-600 { color: ${textDim} !important; }

/* Borders */
html[data-theme="custom"] .border-zinc-700 { border-color: ${borderColor} !important; }
html[data-theme="custom"] .border-zinc-800 { border-color: ${borderColor} !important; }
html[data-theme="custom"] .border-zinc-900 { border-color: ${rgba(borderColor.startsWith('#') ? borderColor : c.bodyBg, 0.5)} !important; }
html[data-theme="custom"] .divide-zinc-800\\/60 > :not([hidden]) ~ :not([hidden]) {
  border-color: ${borderColor} !important;
}

/* Accent (取代 sky-500/400/300) */
html[data-theme="custom"] .bg-sky-500 { background-color: ${c.accent} !important; }
html[data-theme="custom"] .bg-sky-500\\/15 { background-color: ${rgba(c.accent, 0.15)} !important; }
html[data-theme="custom"] .bg-sky-500\\/10 { background-color: ${rgba(c.accent, 0.1)} !important; }
html[data-theme="custom"] .bg-sky-500\\/20 { background-color: ${rgba(c.accent, 0.2)} !important; }
html[data-theme="custom"] .text-sky-300 { color: ${c.accent} !important; }
html[data-theme="custom"] .text-sky-400 { color: ${c.accent} !important; }
html[data-theme="custom"] .border-sky-500\\/30 { border-color: ${rgba(c.accent, 0.4)} !important; }
html[data-theme="custom"] .border-sky-500\\/40 { border-color: ${rgba(c.accent, 0.5)} !important; }
html[data-theme="custom"] .border-sky-500\\/50 { border-color: ${rgba(c.accent, 0.6)} !important; }
html[data-theme="custom"] .focus\\:border-sky-500\\/50:focus { border-color: ${rgba(c.accent, 0.6)} !important; }
html[data-theme="custom"] .bg-sky-400 { background-color: ${c.accent} !important; }

/* hover */
html[data-theme="custom"] .hover\\:bg-zinc-800:hover { background-color: ${adjustLightness(c.bodyBg, isLight ? -0.08 : 0.1)} !important; }
html[data-theme="custom"] .hover\\:bg-zinc-800\\/30:hover { background-color: ${rgba(c.bodyBg, 0.4)} !important; }
html[data-theme="custom"] .hover\\:bg-sky-400:hover { background-color: ${adjustLightness(c.accent, 0.05)} !important; }

${isLight ? '' : `
/* 暗底時 badge text 還可用原色 — 不動 */
`}
${isLight ? `
/* 亮底時 badge text 加深 */
html[data-theme="custom"] .text-emerald-300 { color: #047857 !important; }
html[data-theme="custom"] .text-emerald-400 { color: #059669 !important; }
html[data-theme="custom"] .text-rose-300 { color: #be123c !important; }
html[data-theme="custom"] .text-rose-400 { color: #e11d48 !important; }
html[data-theme="custom"] .text-amber-300 { color: #b45309 !important; }
html[data-theme="custom"] .text-amber-400 { color: #d97706 !important; }
html[data-theme="custom"] .text-violet-300 { color: #6d28d9 !important; }
html[data-theme="custom"] .text-cyan-300 { color: #0e7490 !important; }
html[data-theme="custom"] .text-pink-300 { color: #be185d !important; }
html[data-theme="custom"] .text-teal-300 { color: #0d9488 !important; }
html[data-theme="custom"] .text-indigo-300 { color: #4338ca !important; }
html[data-theme="custom"] .text-orange-300 { color: #c2410c !important; }
html[data-theme="custom"] .text-yellow-300 { color: #a16207 !important; }
` : ''}
`;
}

export function injectCustomThemeCSS(c: CustomThemeConfig): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = generateCustomThemeCSS(c);
}

export function removeCustomThemeCSS(): void {
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
}
