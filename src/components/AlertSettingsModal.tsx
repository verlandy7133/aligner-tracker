import { useEffect, useState } from 'react';
import {
  type AlertThresholds,
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
} from '../config/alerts';

export type AlertSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function AlertSettingsModal({ open, onClose }: AlertSettingsModalProps) {
  const [t, setT] = useState<AlertThresholds>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) loadThresholds().then(setT);
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
      await saveThresholds(t);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setT(DEFAULT_THRESHOLDS);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl my-8">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">⚠️ 警示設定</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <Field
            label="A · 廠商遲交"
            hint="下單後超過 N 天還沒收件 → 標紅"
            value={t.vendorDelayDays}
            onChange={(v) => setT({ ...t, vendorDelayDays: v })}
          />
          <Field
            label="B · 病患未領"
            hint="收件後超過 N 天還沒完成 (病患沒來戴)"
            value={t.pickupDelayDays}
            onChange={(v) => setT({ ...t, pickupDelayDays: v })}
          />
          <Field
            label="D · 待下單逾時"
            hint="批次卡在「尚未開始」超過 N 天 (建檔了沒下單)"
            value={t.pendingOrderDays}
            onChange={(v) => setT({ ...t, pendingOrderDays: v })}
          />
          <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
            注：C「病患漏單」(active 病患無 order) 沒有閾值，自動判定。
          </p>
        </div>

        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between gap-3">
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
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="text-[11px] text-zinc-500">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-24 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 tabular focus:outline-none focus:border-sky-500/50"
        />
        <span className="text-sm text-zinc-500">天</span>
      </div>
    </div>
  );
}
