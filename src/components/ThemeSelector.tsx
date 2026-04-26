import { useState } from 'react';
import { THEME_DESCRIPTION, THEME_LABEL, THEMES, saveTheme, useTheme, type Theme } from '../themes';
import CustomThemeEditor from './CustomThemeEditor';

export default function ThemeSelector() {
  const current = useTheme();
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  async function pick(t: Theme) {
    setOpen(false);
    if (t === 'custom') {
      // 點 custom → 同時套用 + 開編輯器（即便已是 custom 也再開一次方便調整）
      if (current !== 'custom') await saveTheme('custom');
      // 等 dropdown 動畫關掉再開 modal，避免感覺擠
      setTimeout(() => setEditorOpen(true), 50);
    } else {
      await saveTheme(t);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2.5 py-1.5 rounded-md text-xs border border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-800 transition flex items-center gap-1.5"
        title="切換主題"
      >
        🎨 <span className="hidden sm:inline">{THEME_LABEL[current]}</span>
        <span className="text-zinc-500">▾</span>
      </button>
      {open && (
        <>
          {/* backdrop 點外面關閉 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
            {THEMES.map((t) => {
              const active = current === t;
              return (
                <div key={t} className="flex items-stretch">
                  <button
                    onClick={() => pick(t)}
                    className={`flex-1 text-left px-3 py-2 text-sm transition ${
                      active
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{THEME_LABEL[t]}</span>
                      {active && <span className="text-xs">✓</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {THEME_DESCRIPTION[t]}
                    </div>
                  </button>
                  {t === 'custom' && active && (
                    <button
                      onClick={() => {
                        setEditorOpen(true);
                        setOpen(false);
                      }}
                      className="px-3 text-xs text-sky-300 hover:bg-sky-500/15 border-l border-zinc-800 transition"
                      title="編輯自定義主題"
                    >
                      ✎
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <CustomThemeEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
