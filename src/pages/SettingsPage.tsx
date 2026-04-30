import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { rescanAndImport, type RescanResult } from '../lib/folder-rescan';
import { reapplyExcelUpdates, type ReapplyResult } from '../lib/reapply-excel';
import {
  downloadBackup,
  exportBackup,
  importBackup,
  validateBackup,
  type BackupFile,
} from '../lib/backup';
import {
  DEFAULT_LABS,
  type Lab,
  loadLabs,
  saveLabs,
  useLabs,
} from '../lib/labs';
import {
  DEFAULT_DOCTORS,
  type Doctor,
  loadDoctors,
  saveDoctors,
  useDoctors,
} from '../lib/doctors';
import {
  type AlertThresholds,
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
} from '../config/alerts';
import { seedIfEmpty, type SeedResult } from '../seed';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">設定</h1>
        <p className="text-xs text-zinc-500 mt-1">
          技工所管理、警示閾值、資料夾掃描、資料庫
        </p>
      </header>

      <LabSection />
      <DoctorSection />
      <AlertSection />
      <BackupSection />
      <RescanSection />
      <ReapplyExcelSection />
      <DbSection />
    </div>
  );
}

/* ─── 技工所管理 ───────────────────────────────────────── */
function LabSection() {
  const labs = useLabs();
  const [editing, setEditing] = useState<Lab | 'new' | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">技工所管理</h2>
          <span className="text-xs text-zinc-500">({labs.length} 個)</span>
          {!expanded && (
            <span className="text-[11px] text-zinc-600">
              {labs.slice(0, 3).map((l) => l.name).join('、')}
              {labs.length > 3 && '…'}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing('new');
          }}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
        >
          + 新增
        </button>
      </header>
      {expanded && (
        <div className="p-3 space-y-2">
          {labs.length === 0 && (
            <p className="text-sm text-zinc-500 px-2 py-3">尚無技工所</p>
          )}
          {labs.map((lab) => (
            <div
              key={lab.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded border border-zinc-700" style={{ background: lab.color }} />
                <span className="text-sm text-zinc-100 font-medium">{lab.name}</span>
                <code className="text-[10px] text-zinc-500">{lab.id}</code>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(lab)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded">編輯</button>
                <button
                  onClick={async () => {
                    if (!confirm(`刪除技工所「${lab.name}」？已下單紀錄會保留 lab 名稱字串，但配色會變灰色 fallback。`)) return;
                    const next = labs.filter((l) => l.id !== lab.id);
                    await saveLabs(next);
                  }}
                  className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <LabEditor target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function LabEditor({ target, onClose }: { target: Lab | 'new' | null; onClose: () => void }) {
  const [form, setForm] = useState<Lab>({ id: '', name: '', color: '#6366f1' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (target === 'new') {
      setForm({ id: '', name: '', color: '#6366f1' });
      setError('');
    } else if (target) {
      setForm(target);
      setError('');
    }
  }, [target]);

  if (!target) return null;
  const isNew = target === 'new';

  async function handleSave() {
    if (!form.name.trim()) {
      setError('名稱必填');
      return;
    }
    if (!form.id.trim() || !/^[a-z0-9-]+$/.test(form.id.trim())) {
      setError('id 必填，只能英數和連字號');
      return;
    }
    const labs = await loadLabs();
    if (isNew && labs.some((l) => l.id === form.id.trim())) {
      setError(`id「${form.id}」已存在`);
      return;
    }
    if (isNew) {
      await saveLabs([...labs, { ...form, id: form.id.trim(), name: form.name.trim() }]);
    } else {
      await saveLabs(
        labs.map((l) => (l.id === (target as Lab).id ? { ...form, name: form.name.trim() } : l)),
      );
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isNew ? '新增技工所' : `編輯：${(target as Lab).name}`}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">×</button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">名稱（顯示用）</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：日進"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-sky-500/50"
              autoFocus
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">id（內部識別，英數+連字號）</div>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="例：rijin"
              disabled={!isNew}
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">配色</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">取消</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition">儲存</button>
        </footer>
      </div>
    </div>
  );
}

/* ─── 醫師管理 ─────────────────────────────────────────── */
function DoctorSection() {
  const doctors = useDoctors();
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">醫師管理</h2>
          <span className="text-xs text-zinc-500">({doctors.length} 位)</span>
          {!expanded && (
            <span className="text-[11px] text-zinc-600">
              {doctors.slice(0, 3).map((d) => d.name).join('、')}
              {doctors.length > 3 && '…'}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing('new');
          }}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
        >
          + 新增
        </button>
      </header>
      {expanded && (
        <div className="p-3 space-y-2">
          {doctors.length === 0 && (
            <p className="text-sm text-zinc-500 px-2 py-3">尚無醫師</p>
          )}
          {doctors.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded border border-zinc-700" style={{ background: d.color }} />
                <span className="text-sm text-zinc-100 font-medium">{d.name}</span>
                <code className="text-[10px] text-zinc-500">{d.id}</code>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(d)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded">編輯</button>
                <button
                  onClick={async () => {
                    if (!confirm(`刪除醫師「${d.name}」？已存在的病患/下單會保留醫師名字串，但 badge 配色會變灰色 fallback。`)) return;
                    const next = doctors.filter((x) => x.id !== d.id);
                    await saveDoctors(next);
                  }}
                  className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <DoctorEditor target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function DoctorEditor({ target, onClose }: { target: Doctor | 'new' | null; onClose: () => void }) {
  const [form, setForm] = useState<Doctor>({ id: '', name: '', color: '#6366f1' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (target === 'new') {
      setForm({ id: '', name: '', color: '#6366f1' });
      setError('');
    } else if (target) {
      setForm(target);
      setError('');
    }
  }, [target]);

  if (!target) return null;
  const isNew = target === 'new';

  async function handleSave() {
    if (!form.name.trim()) { setError('名稱必填'); return; }
    if (!form.id.trim() || !/^[a-z0-9-]+$/.test(form.id.trim())) {
      setError('id 必填，只能英數和連字號');
      return;
    }
    const doctors = await loadDoctors();
    if (isNew && doctors.some((d) => d.id === form.id.trim())) {
      setError(`id「${form.id}」已存在`);
      return;
    }
    if (isNew) {
      await saveDoctors([...doctors, { ...form, id: form.id.trim(), name: form.name.trim() }]);
    } else {
      await saveDoctors(
        doctors.map((d) => (d.id === (target as Doctor).id ? { ...form, name: form.name.trim() } : d)),
      );
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isNew ? '新增醫師' : `編輯：${(target as Doctor).name}`}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">×</button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">名稱（顯示用）</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：王大明"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-sky-500/50"
              autoFocus
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">id（內部識別，英數+連字號）</div>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="例：wang-daming"
              disabled={!isNew}
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">配色</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">取消</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition">儲存</button>
        </footer>
      </div>
    </div>
  );
}

/* ─── 警示閾值 ─────────────────────────────────────────── */
function AlertSection() {
  const [t, setT] = useState<AlertThresholds>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadThresholds().then(setT);
  }, []);

  async function save() {
    setSaving(true);
    await saveThresholds(t);
    setSaving(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">警示閾值</h2>
          {!expanded && (
            <span className="text-[11px] text-zinc-500">
              廠商遲交 {t.vendorDelayDays}天 · 病患未領 {t.pickupDelayDays}天 · 待下單 {t.pendingOrderDays}天
            </span>
          )}
        </div>
        {expanded && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {savedTick && <span className="text-xs text-emerald-400">✓ 已儲存</span>}
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              儲存
            </button>
          </div>
        )}
      </header>
      {expanded && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField label="A · 廠商遲交" hint="下單超過 N 天未收件" value={t.vendorDelayDays} onChange={(v) => setT({ ...t, vendorDelayDays: v })} />
          <NumberField label="B · 病患未領" hint="收件超過 N 天未完成" value={t.pickupDelayDays} onChange={(v) => setT({ ...t, pickupDelayDays: v })} />
          <NumberField label="D · 待下單逾時" hint="尚未開始 N 天" value={t.pendingOrderDays} onChange={(v) => setT({ ...t, pendingOrderDays: v })} />
        </div>
      )}
    </section>
  );
}

function NumberField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-xs text-zinc-300 mb-1">{label}</div>
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
      <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>
    </div>
  );
}

/* ─── 資料備份 / 還原 ─────────────────────────────────────── */
function BackupSection() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const backup = await exportBackup();
      downloadBackup(backup);
      setDoneMsg(`✓ 已下載備份 (${backup.counts.patients} 病患 / ${backup.counts.orders} 下單 / ${backup.counts.settings} 設定)`);
      setTimeout(() => setDoneMsg(''), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setDoneMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = validateBackup(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPending(result.file);
    };
    reader.onerror = () => setError('讀檔失敗');
    reader.readAsText(file);
    e.target.value = ''; // reset 讓同檔可重選
  }

  async function confirmImport() {
    if (!pending) return;
    if (
      !confirm(
        `⚠️ 確定要覆寫現有資料？\n\n將載入：\n  ${pending.counts.patients} 筆病患 (現有會清空)\n  ${pending.counts.orders} 筆下單\n  ${pending.counts.settings} 個設定\n\n備份時間：${pending.exportedAt.slice(0, 19).replace('T', ' ')}`,
      )
    )
      return;
    setImporting(true);
    setError('');
    try {
      await importBackup(pending);
      setDoneMsg(`✓ 還原完成。重整頁面套用…`);
      setPending(null);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">資料備份 / 還原</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {exporting ? '匯出中…' : '⬇ 匯出備份'}
          </button>
          <label
            className={`px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}
          >
            ⬆ 選擇備份檔
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFilePick}
              className="hidden"
            />
          </label>
        </div>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          匯出 = 把所有病患、下單、設定打包成 JSON 檔下載到本機（建議每月做一次）。
          匯入 = 從備份還原，**會完全覆寫現有資料**。
        </p>
        {doneMsg && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            {doneMsg}
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
        {pending && (
          <div className="px-3 py-3 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-200 space-y-2">
            <div className="text-sm">
              <strong>準備還原：</strong>
              {pending.counts.patients} 病患 · {pending.counts.orders} 下單 · {pending.counts.settings} 設定
            </div>
            <div className="text-xs text-amber-300/80">
              備份時間：{pending.exportedAt.slice(0, 19).replace('T', ' ')} ·
              App 版本 {pending.appVersion} · 格式 v{pending.version}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={confirmImport}
                disabled={importing}
                className="px-3 py-1.5 rounded-md text-xs bg-rose-500 text-zinc-50 hover:bg-rose-400 transition disabled:opacity-50"
              >
                {importing ? '還原中…' : '⚠ 確認覆寫'}
              </button>
              <button
                onClick={() => setPending(null)}
                disabled={importing}
                className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 掃描資料夾 ─────────────────────────────────────────── */
type RoleInfo = {
  role: 'master' | 'follower';
  drive: string;
  dataRoot: string;
  scanFolder: string;
  scanFolderExists: boolean;
};

function RescanSection() {
  const [state, setState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<RescanResult | null>(null);
  const [error, setError] = useState('');
  const [roleInfo, setRoleInfo] = useState<RoleInfo | null>(null);
  const [roleError, setRoleError] = useState('');

  useEffect(() => {
    fetch('http://127.0.0.1:8765/role')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`role endpoint ${r.status}`))))
      .then((data: RoleInfo) => setRoleInfo(data))
      .catch((e: unknown) =>
        setRoleError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  async function go() {
    setState('scanning');
    setError('');
    setResult(null);
    try {
      const r = await rescanAndImport();
      setResult(r);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  const isMaster = roleInfo?.role === 'master';
  const canScan = isMaster && roleInfo?.scanFolderExists === true;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">資料夾掃描</h2>
          {roleInfo && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                isMaster
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {roleInfo.role}
            </span>
          )}
        </div>
        <button
          onClick={go}
          disabled={state === 'scanning' || !canScan}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state === 'scanning' ? '🔄 掃描中…' : '🔄 立即掃描'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        {roleError && (
          <p className="text-xs text-amber-400/80">
            ⚠️ 無法取得本機角色（{roleError}）— helper service 沒跑？
          </p>
        )}
        {!roleInfo && !roleError && <p className="text-xs text-zinc-500">讀取本機角色中…</p>}
        {roleInfo && isMaster && (
          <p className="text-xs text-zinc-500">
            掃描 <code className="text-zinc-400">{roleInfo.scanFolder}</code> 找新病患資料夾，
            <strong className="text-zinc-300">只新增不存在的</strong>（用姓名+生日比對），不會動既有編輯。
            {!roleInfo.scanFolderExists && (
              <span className="block mt-1 text-amber-400/80">
                ⚠️ 上述路徑不存在，無法掃描。請先把 矯正/ 資料夾搬到該位置。
              </span>
            )}
          </p>
        )}
        {roleInfo && !isMaster && (
          <div className="px-3 py-2 rounded-md bg-zinc-800/50 border border-zinc-700 text-xs text-zinc-400 space-y-1">
            <p>
              <strong className="text-zinc-300">此機為開發機（follower）</strong>，停用資料夾掃描以免跟筆電 (master) 不同步。
            </p>
            <p>新增病患請：在筆電上掃描或手動新增 → 筆電匯出備份 JSON → 在本機「資料備份/還原」section 匯入。</p>
          </div>
        )}
        {state === 'done' && result && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            ✓ 新增 {result.added} 筆，已存在 {result.skipped} 筆 (共掃 {result.totalScanned})
            {result.added > 0 && result.added <= 10 && (
              <div className="text-xs text-emerald-400/80 mt-1">新增：{result.newNames.join('、')}</div>
            )}
          </div>
        )}
        {state === 'error' && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 重新套用 Excel 匯入結果 ─────────────────────────────── */
function ReapplyExcelSection() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ReapplyResult | null>(null);
  const [error, setError] = useState('');

  async function go() {
    setState('running');
    setError('');
    setResult(null);
    try {
      const r = await reapplyExcelUpdates();
      setResult(r);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">重新套用 Excel 匯入</h2>
        <button
          onClick={go}
          disabled={state === 'running'}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⟳ 套用中…' : '⟳ 立即套用'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          讀 <code className="text-zinc-400">dev-data/excel-patient-updates.json</code> 與{' '}
          <code className="text-zinc-400">excel-orders.json</code>，把醫師 / 口掃 / 副數總數等資訊
          <strong>補進空欄位</strong>，不會覆蓋你已手動編輯過的值。沒下單的病患會新增 order，新建病患會補上。
        </p>
        {state === 'done' && result && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-0.5">
            <div>
              ✓ 病患更新：{result.updates.patientsPatched} 位（候選 {result.updates.candidates}，全已設過 {result.updates.skippedAllSet}，找不到 {result.updates.skippedNotFound}）
            </div>
            <div className="text-emerald-400/80 pl-4">
              · 醫師：+{result.updates.fieldsPatched.doctor} ·
              口掃：+{result.updates.fieldsPatched.scanInfo} ·
              副數：+{result.updates.fieldsPatched.totalAligners} ·
              授權書升級：+{result.updates.fieldsPatched.hasConsent}
            </div>
            <div>
              ✓ 新建病患：+{result.newPatients.added}（已存在 {result.newPatients.skippedExisted}）
            </div>
            <div>
              ✓ 下單紀錄：+{result.orders.added}（已存在 {result.orders.skippedExisted}）
            </div>
            <div>
              ✓ 從下單推算副數：{result.derivedCurrent.patientsUpdated} 位
            </div>
          </div>
        )}
        {state === 'error' && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 資料庫管理 (原 偵錯 panel) ───────────────────────────── */
function DbSection() {
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  useEffect(() => {
    seedIfEmpty().then(setSeedResult);
  }, []);

  const stats = useLiveQuery(async () => {
    const all = await db.patients.toArray();
    const orders = await db.orders.toArray();
    const byStatus: Record<string, number> = {};
    const byProductLine: Record<string, number> = {};
    let withFlags = 0;
    for (const p of all) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byProductLine[p.productLine] = (byProductLine[p.productLine] || 0) + 1;
      if (p.flags?.length) withFlags++;
    }
    return { total: all.length, byStatus, byProductLine, withFlags, orderCount: orders.length };
  });

  async function reset() {
    if (!confirm('清空 IndexedDB？所有病患/下單/設定會被刪除，下次重整會重新匯入。')) return;
    await db.delete();
    location.reload();
  }

  async function resetLabsToDefaults() {
    if (!confirm('還原預設技工所 (美鉑/世宇/隱適美)？目前自定義的技工所會被覆寫。')) return;
    await saveLabs(DEFAULT_LABS);
  }
  async function resetDoctorsToDefaults() {
    if (!confirm('還原預設醫師 (陳執中/林英辰/張綺真)？目前自定義的醫師會被覆寫。')) return;
    await saveDoctors(DEFAULT_DOCTORS);
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">資料庫</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={resetLabsToDefaults} className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">還原預設技工所</button>
          <button onClick={resetDoctorsToDefaults} className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">還原預設醫師</button>
          <button onClick={reset} className="px-3 py-1.5 rounded-md text-xs border border-rose-700/50 text-rose-300 hover:bg-rose-500/10 transition">清空 DB</button>
        </div>
      </header>
      <div className="p-5 space-y-3 text-sm">
        {seedResult?.seeded && (
          <div className="text-xs text-zinc-500">
            seed: 病患 {seedResult.patientCount} ({seedResult.newPatients} 新增) · 下單 {seedResult.orderCount} · patient updates {seedResult.updates}
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="病患總數" value={stats.total} accent />
            <Stat label="下單筆數" value={stats.orderCount} />
            <Stat label="有 flag 病患" value={stats.withFlags} />
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <Dist title="按 status" map={stats.byStatus} />
            <Dist title="按 productLine" map={stats.byProductLine} />
          </div>
        )}
        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          DevTools → Application → IndexedDB → aligner-tracker 看實際資料
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold tabular ${accent ? 'text-sky-300' : 'text-zinc-200'}`}>{value}</div>
    </div>
  );
}

function Dist({ title, map }: { title: string; map: Record<string, number> }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3">
      <div className="text-xs text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1">
        {Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-zinc-400">{k}</span>
            <span className="text-zinc-200 tabular">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
