import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_CUSTOM_CONFIG,
  FONT_FAMILY_LABEL,
  loadCustomConfig,
  saveCustomConfig,
  saveTheme,
  type CustomThemeConfig,
  type FontFamily,
} from '../themes';

export type CustomThemeEditorProps = {
  open: boolean;
  onClose: () => void;
};

const PRESET_BG = ['#0f172a', '#1e293b', '#18181b', '#1c1917', '#fafafa', '#e7e5e4', '#fef2f2', '#eef2ff'];
const PRESET_ACCENT = ['#0ea5e9', '#10b981', '#a855f7', '#ec4899', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16'];

export default function CustomThemeEditor({ open, onClose }: CustomThemeEditorProps) {
  const [c, setC] = useState<CustomThemeConfig>(DEFAULT_CUSTOM_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) loadCustomConfig().then(setC);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await saveCustomConfig(c);
      await saveTheme('custom'); // 自動切到 custom
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyLive() {
    // 即時套用但不關閉
    await saveCustomConfig(c);
    await saveTheme('custom');
  }

  function reset() {
    setC(DEFAULT_CUSTOM_CONFIG);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-zinc-100">✎ 自定義主題</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <Section label="背景色" hint="表面顏色會自動推算 (亮底→深字、暗底→亮字)">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={c.bodyBg}
                onChange={(e) => setC({ ...c, bodyBg: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={c.bodyBg}
                onChange={(e) => setC({ ...c, bodyBg: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono tabular focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESET_BG.map((p) => (
                <button
                  key={p}
                  onClick={() => setC({ ...c, bodyBg: p })}
                  className="w-7 h-7 rounded border border-zinc-700 hover:scale-110 transition"
                  style={{ background: p }}
                  title={p}
                />
              ))}
            </div>
          </Section>

          <Section label="強調色" hint="按鈕、focus、active chip 用的顏色">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={c.accent}
                onChange={(e) => setC({ ...c, accent: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={c.accent}
                onChange={(e) => setC({ ...c, accent: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono tabular focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESET_ACCENT.map((p) => (
                <button
                  key={p}
                  onClick={() => setC({ ...c, accent: p })}
                  className="w-7 h-7 rounded border border-zinc-700 hover:scale-110 transition"
                  style={{ background: p }}
                  title={p}
                />
              ))}
            </div>
          </Section>

          <Section label="字體">
            <div className="grid grid-cols-3 gap-2">
              {(['sans', 'mono', 'serif'] as FontFamily[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setC({ ...c, fontFamily: f })}
                  className={`px-3 py-2 rounded-md text-xs border transition ${
                    c.fontFamily === f
                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  {FONT_FAMILY_LABEL[f]}
                </button>
              ))}
            </div>
          </Section>

          <button
            onClick={handleApplyLive}
            className="w-full px-3 py-2 rounded-md text-sm border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition"
          >
            👁 即時預覽
          </button>
        </div>

        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between gap-3 flex-shrink-0">
          <button
            onClick={reset}
            className="text-xs text-zinc-500 hover:text-zinc-200 transition"
          >
            還原預設
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              {saving ? '儲存中…' : '儲存並套用'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
