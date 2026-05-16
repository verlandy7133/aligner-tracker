import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { getDataLayer } from '../lib/data-layer';
import { VersionConflictError, ApiError, NetworkError } from '../lib/api-client';
import { OfflineError } from '../lib/data-layer-dual';
import {
  BATCH_TYPE_OPTIONS,
  PROGRESS_OPTIONS,
  type Order,
  type Patient,
  type ProgressStatus,
} from '../types/Patient';
import { useDoctors } from '../lib/doctors';
import { PRODUCT_LINE_LABEL } from '../labels';
import { defaultLabNameForProductLine, labBadgeStyle, useLabs } from '../lib/labs';

export type OrderFormModalProps = {
  target: Order | 'new' | null;
  /** 'new' 模式下預先選定的病患 id（從病患群組「+ 新增」按鈕觸發）*/
  prefillPatientId?: string;
  onClose: () => void;
  /** 病患搜尋找不到 match 時的「新增此病患」callback */
  onCreatePatient?: (prefillName: string) => void;
};

type FormState = {
  patientId: string;
  date: string;
  doctor: string;
  lab: string;
  batchType: string;
  alignerRange: string;
  progress: ProgressStatus;
  expectedDate: string;
  actualDate: string;
  nextStep: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM: FormState = {
  patientId: '',
  date: today(),
  doctor: '',
  lab: '鎂鉑',
  batchType: '新',
  alignerRange: '',
  progress: '尚未開始',
  expectedDate: '',
  actualDate: '',
  nextStep: '',
  notes: '',
};

export default function OrderFormModal({ target, prefillPatientId, onClose, onCreatePatient }: OrderFormModalProps) {
  const open = target !== null;
  const mode: 'new' | 'edit' = target === 'new' ? 'new' : 'edit';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');

  const patients = useLiveQuery(() => db.patients.toArray()) ?? [];
  const labs = useLabs();
  const doctors = useDoctors();

  useEffect(() => {
    if (target === 'new') {
      // 若有 prefillPatientId，從 patients 找到該病患並預選
      if (prefillPatientId) {
        const p = patients.find((x) => x.id === prefillPatientId);
        if (p) {
          setForm({
            ...EMPTY_FORM,
            patientId: p.id,
            lab: defaultLabNameForProductLine(p.productLine, labs),
            doctor: p.doctor ?? '',
          });
          setPatientSearch(`${p.chartNo} ${p.name}`);
        } else {
          setForm({ ...EMPTY_FORM, lab: labs[0]?.name ?? '' });
          setPatientSearch('');
        }
      } else {
        setForm({ ...EMPTY_FORM, lab: labs[0]?.name ?? '' });
        setPatientSearch('');
      }
      setError(null);
    } else if (target) {
      setForm({
        patientId: target.patientId,
        date: target.date,
        doctor: target.doctor,
        lab: target.lab,
        batchType: target.batchType,
        alignerRange: target.alignerRange,
        progress: target.progress,
        expectedDate: target.expectedDate ?? '',
        actualDate: target.actualDate ?? '',
        nextStep: target.nextStep,
        notes: target.notes,
      });
      setError(null);
      setPatientSearch(`${target.patientChartNo} ${target.patientName}`);
    }
  }, [target, prefillPatientId, patients, labs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const matchedPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q || form.patientId) return [];
    return patients
      .filter((p) => (p.name + ' ' + p.chartNo).toLowerCase().includes(q))
      .slice(0, 8);
  }, [patientSearch, patients, form.patientId]);

  const selectedPatient: Patient | undefined = patients.find((p) => p.id === form.patientId);

  function pickPatient(p: Patient) {
    setForm({
      ...form,
      patientId: p.id,
      lab: form.lab || defaultLabNameForProductLine(p.productLine, labs),
      doctor: form.doctor || p.doctor || '',
    });
    setPatientSearch(`${p.chartNo} ${p.name}`);
  }

  function clearPatient() {
    setForm({ ...form, patientId: '' });
    setPatientSearch('');
  }

  if (!open) return null;

  function validate(): string | null {
    if (!form.patientId) return '請選擇病患';
    if (!form.date) return '日期為必填';
    if (!form.alignerRange.trim()) return '副數區間為必填 (例：UL12-13)';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);

    const now = new Date().toISOString();
    const patient = patients.find((p) => p.id === form.patientId);
    if (!patient) {
      setError('找不到病患');
      setSaving(false);
      return;
    }

    // v0.6.0: id 編輯模式沿用、新增空字串由 DataLayer/server 生
    const payload: Order = {
      id: mode === 'edit' && target !== 'new' && target !== null ? target.id : '',
      patientId: form.patientId,
      patientChartNo: patient.chartNo,
      patientName: patient.name,
      date: form.date,
      doctor: form.doctor.trim(),
      lab: form.lab,
      batchType: form.batchType,
      alignerRange: form.alignerRange.trim(),
      progress: form.progress,
      expectedDate: form.expectedDate || null,
      actualDate: form.actualDate || null,
      nextStep: form.nextStep.trim(),
      notes: form.notes.trim(),
      createdAt:
        mode === 'edit' && target !== 'new' && target !== null ? target.createdAt : now,
      updatedAt: now,
    };

    try {
      const dl = getDataLayer();
      if (mode === 'edit' && target !== 'new' && target !== null) {
        const version = target._version ?? 1;
        await dl.putOrder(payload, version);
      } else {
        const { id: _drop, ...rest } = payload;
        void _drop;
        await dl.createOrder(rest as Order);
      }
      onClose();
    } catch (e) {
      if (e instanceof VersionConflictError) {
        setError(`下單紀錄已被其他人更新（server v${e.currentVersion}、你 v${e.yourVersion}）。請重開對話框再試。`);
      } else if (e instanceof OfflineError || e instanceof NetworkError) {
        setError(`離線中：${e.message}`);
      } else if (e instanceof ApiError) {
        setError(`Server 錯誤 (${e.code})：${e.message}`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (mode !== 'edit' || target === 'new' || target === null) return;
    if (!confirm(`確定刪除這筆下單紀錄？`)) return;
    setSaving(true);
    try {
      const version = target._version ?? 1;
      await getDataLayer().deleteOrder(target.id, version);
      onClose();
    } catch (e) {
      if (e instanceof VersionConflictError) {
        setError(`下單紀錄已被其他機器更新、刪除失敗。請重開頁面再試。`);
      } else if (e instanceof OfflineError || e instanceof NetworkError) {
        setError(`離線中、無法刪除`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl my-8">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            {mode === 'new' ? '新增下單' : '編輯下單'}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">×</button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <Field label="病患" required>
            {selectedPatient ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-zinc-900/60 border border-zinc-800">
                <span className="text-sm text-zinc-200">
                  {selectedPatient.chartNo} · {selectedPatient.name} ·{' '}
                  <span className="text-zinc-500">{PRODUCT_LINE_LABEL[selectedPatient.productLine]}</span>
                </span>
                <button type="button" onClick={clearPatient} className="text-xs text-zinc-500 hover:text-zinc-200">變更</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="輸入姓名 / 病歷號 搜尋"
                  className={inputCls}
                  autoFocus
                />
                {patientSearch.trim() && (
                  <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-md bg-zinc-900 border border-zinc-800 shadow-lg">
                    {matchedPatients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickPatient(p)}
                        className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition flex justify-between"
                      >
                        <span><span className="text-zinc-500 mr-2">{p.chartNo}</span>{p.name}</span>
                        <span className="text-xs text-zinc-500">{PRODUCT_LINE_LABEL[p.productLine]}</span>
                      </button>
                    ))}
                    {onCreatePatient && (
                      <button
                        type="button"
                        onClick={() => onCreatePatient(patientSearch.trim())}
                        className="w-full text-left px-3 py-2 text-sm border-t border-zinc-800 text-sky-300 hover:bg-sky-500/10 transition"
                      >
                        + 新增病患「{patientSearch.trim()}」
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="日期" required>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
            </Field>
            <Field label="醫師">
              <select value={form.doctor} onChange={(e) => setForm({ ...form, doctor: e.target.value })} className={inputCls}>
                <option value="">未指定</option>
                {doctors.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="技工所" required>
            <div className="flex gap-2 flex-wrap">
              {labs.map((lab) => {
                const active = form.lab === lab.name;
                return (
                  <button
                    key={lab.id}
                    type="button"
                    onClick={() => setForm({ ...form, lab: lab.name })}
                    className={`flex-1 min-w-[80px] h-9 rounded-md text-sm border transition ${
                      active ? '' : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                    style={active ? labBadgeStyle(lab) : undefined}
                  >{lab.name}</button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="副數區間" required>
              <input value={form.alignerRange} onChange={(e) => setForm({ ...form, alignerRange: e.target.value })} className={`${inputCls} font-mono`} placeholder="例：UL12-13" />
            </Field>
            <Field label="批次類型">
              <select value={form.batchType} onChange={(e) => setForm({ ...form, batchType: e.target.value })} className={inputCls}>
                <option value="">無</option>
                {BATCH_TYPE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          </div>

          <Field label="目前進度">
            <div className="grid grid-cols-4 gap-2">
              {PROGRESS_OPTIONS.map((p) => {
                const active = form.progress === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, progress: p })}
                    className={`h-9 rounded-md text-xs border transition ${
                      active ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >{p}</button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="預計收件日">
              <input type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} className={inputCls} />
            </Field>
            <Field label="實際收件日">
              <input type="date" value={form.actualDate} onChange={(e) => setForm({ ...form, actualDate: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <Field label="下一步">
            <input value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} className={inputCls} placeholder="例：4/22 下單 UL18-23" />
          </Field>

          <Field label="備註">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} min-h-[60px] resize-y`} placeholder="IPR / ATT / 骨釘 / 特殊指示..." />
          </Field>
        </div>

        {error && (
          <div className="px-6 pb-2">
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">⚠️ {error}</div>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between gap-3">
          <div>
            {mode === 'edit' && (
              <button onClick={handleDelete} disabled={saving} className="px-3 py-2 rounded-md text-sm text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-50">刪除</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50">取消</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50">
              {saving ? '儲存中…' : mode === 'new' ? '新增' : '儲存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  'w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs text-zinc-400">
        {label}
        {required && <span className="text-rose-400 ml-1">*</span>}
      </div>
      {children}
    </label>
  );
}
