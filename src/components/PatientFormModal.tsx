import { useEffect, useMemo, useState } from 'react';
import { db } from '../db';
import {
  DEFAULT_CYCLE_DAYS,
  type Patient,
  type PatientFlag,
  type PatientStatus,
  type ProductLine,
} from '../types/Patient';
import { useDoctors } from '../lib/doctors';
import {
  STATUS_LABEL,
  PRODUCT_LINE_LABEL,
  FLAG_LABEL,
} from '../labels';

type Mode = 'new' | 'edit';

export type PatientFormModalProps = {
  /** null = closed; 'new' = open empty; Patient = open with that patient */
  target: Patient | 'new' | null;
  /** 'new' 模式下預先填入姓名（從 OrderForm 找不到 match 時帶入）*/
  prefillName?: string;
  onClose: () => void;
};

type FormState = {
  chartNo: string;
  name: string;
  birthday: string;
  doctor: string;
  scanInfo: string;
  productLine: ProductLine;
  status: PatientStatus;
  hasConsent: boolean;
  orderDate: string;
  startDate: string;
  totalAlignersUpper: string;
  currentAlignerUpper: string;
  totalAlignersLower: string;
  currentAlignerLower: string;
  cycleDays: string;
  lastVisit: string;
  nextVisit: string;
  flags: PatientFlag[];
  notes: string;
};

const EMPTY_FORM: FormState = {
  chartNo: '',
  name: '',
  birthday: '',
  doctor: '',
  scanInfo: '',
  productLine: 'riyue',
  status: 'active',
  hasConsent: true,
  orderDate: '',
  startDate: '',
  totalAlignersUpper: '',
  currentAlignerUpper: '',
  totalAlignersLower: '',
  currentAlignerLower: '',
  cycleDays: String(DEFAULT_CYCLE_DAYS),
  lastVisit: '',
  nextVisit: '',
  flags: [],
  notes: '',
};

// 表單可手動勾選的 flags（brand-switched-to-invisalign 由系統設置，不開放手選）
const EDITABLE_FLAGS: PatientFlag[] = ['needs-payment', 'needs-followup'];

function patientToForm(p: Patient): FormState {
  return {
    chartNo: p.chartNo,
    name: p.name,
    birthday: p.birthday ?? '',
    doctor: p.doctor ?? '',
    scanInfo: p.scanInfo ?? '',
    productLine: p.productLine,
    status: p.status,
    hasConsent: p.hasConsent,
    orderDate: p.orderDate ?? '',
    startDate: p.startDate ?? '',
    totalAlignersUpper: p.totalAlignersUpper?.toString() ?? '',
    currentAlignerUpper: p.currentAlignerUpper?.toString() ?? '',
    totalAlignersLower: p.totalAlignersLower?.toString() ?? '',
    currentAlignerLower: p.currentAlignerLower?.toString() ?? '',
    cycleDays: String(p.cycleDays ?? DEFAULT_CYCLE_DAYS),
    lastVisit: p.lastVisit ?? '',
    nextVisit: p.nextVisit ?? '',
    flags: p.flags,
    notes: p.notes,
  };
}

export default function PatientFormModal({ target, prefillName, onClose }: PatientFormModalProps) {
  const open = target !== null;
  const mode: Mode = target === 'new' ? 'new' : 'edit';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const doctors = useDoctors();
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened' | 'helper-down' | 'error'>('idle');
  const [openError, setOpenError] = useState('');

  const sourceFolder =
    target && target !== 'new' ? target.sourceFolder : '';
  const consentPdfPath =
    target && target !== 'new' ? target.consentPdfPath : null;

  async function callHelper(endpoint: 'open-folder' | 'open-file', p: string) {
    setOpenState('opening');
    setOpenError('');
    try {
      const resp = await fetch(
        `http://127.0.0.1:8765/${endpoint}?path=${encodeURIComponent(p)}`,
      );
      if (resp.ok) {
        setOpenState('opened');
        setTimeout(() => setOpenState('idle'), 1500);
      } else {
        const text = await resp.text();
        setOpenState('error');
        setOpenError(text);
        setTimeout(() => setOpenState('idle'), 4000);
      }
    } catch {
      setOpenState('helper-down');
      setTimeout(() => setOpenState('idle'), 4000);
    }
  }

  function openFolder() {
    if (sourceFolder) callHelper('open-folder', sourceFolder);
  }
  function openConsentPdf() {
    if (consentPdfPath) callHelper('open-file', consentPdfPath);
  }

  async function copyFolderPath() {
    if (!sourceFolder) return;
    try {
      await navigator.clipboard.writeText(sourceFolder);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      // 退路：用 textarea select+exec (舊瀏覽器)
      const ta = document.createElement('textarea');
      ta.value = sourceFolder;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyState('copied');
        setTimeout(() => setCopyState('idle'), 1500);
      } catch {
        setCopyState('failed');
        setTimeout(() => setCopyState('idle'), 2500);
      }
      document.body.removeChild(ta);
    }
  }


  // 開啟時填入資料
  useEffect(() => {
    if (target === 'new') {
      setForm({ ...EMPTY_FORM, name: prefillName ?? '' });
      setError(null);
      // 自動建議下一個 chartNo
      db.patients.toArray().then((all) => {
        const max = all.reduce(
          (m, p) => Math.max(m, parseInt(p.chartNo, 10) || 0),
          0,
        );
        setForm((f) => ({ ...f, chartNo: String(max + 1).padStart(4, '0') }));
      });
    } else if (target) {
      setForm(patientToForm(target));
      setError(null);
    }
  }, [target, prefillName]);

  // ESC 關閉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 即時年齡計算
  const ageHint = useMemo(() => {
    if (!form.birthday) return '';
    const m = form.birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const today = new Date();
    let age = today.getFullYear() - parseInt(m[1], 10);
    if (
      today.getMonth() + 1 < parseInt(m[2], 10) ||
      (today.getMonth() + 1 === parseInt(m[2], 10) && today.getDate() < parseInt(m[3], 10))
    ) {
      age--;
    }
    const roc = parseInt(m[1], 10) - 1911;
    return `民國 ${roc > 0 ? roc : '?'} 年 / ${age} 歲`;
  }, [form.birthday]);

  if (!open) return null;

  function validate(): string | null {
    if (!form.chartNo.trim()) return '病歷號為必填';
    if (!/^\d{1,6}$/.test(form.chartNo.trim())) return '病歷號只能是數字';
    if (!form.name.trim()) return '姓名為必填';

    function checkPair(total: string, cur: string, label: string): string | null {
      const t = total.trim() === '' ? null : Number(total);
      const c = cur.trim() === '' ? null : Number(cur);
      if (t !== null && (!Number.isInteger(t) || t < 0)) return `${label}總副數必須為非負整數`;
      if (c !== null && (!Number.isInteger(c) || c < 0)) return `${label}目前副數必須為非負整數`;
      if (t !== null && c !== null && c > t) return `${label}目前副數不能大於總副數`;
      return null;
    }
    const upperErr = checkPair(form.totalAlignersUpper, form.currentAlignerUpper, '上顎');
    if (upperErr) return upperErr;
    const lowerErr = checkPair(form.totalAlignersLower, form.currentAlignerLower, '下顎');
    if (lowerErr) return lowerErr;

    const cycle = Number(form.cycleDays);
    if (!Number.isInteger(cycle) || cycle <= 0) return '換套週期必須為正整數';
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
    const chartNoStr = form.chartNo.trim().padStart(4, '0');

    // chartNo 唯一性檢查（除了自己）
    const existingChartNo = await db.patients.where('chartNo').equals(chartNoStr).first();
    const existingId = mode === 'edit' && target !== 'new' && target !== null ? target.id : null;
    if (existingChartNo && existingChartNo.id !== existingId) {
      setError(`病歷號 ${chartNoStr} 已被「${existingChartNo.name}」使用`);
      setSaving(false);
      return;
    }

    const payload: Patient = {
      id: existingId ?? crypto.randomUUID(),
      chartNo: chartNoStr,
      name: form.name.trim(),
      birthday: form.birthday || null,
      doctor: form.doctor.trim() || null,
      scanInfo: form.scanInfo.trim() || null,
      productLine: form.productLine,
      status: form.status,
      // track / refinementLevel 是 derived 欄位（從 orders 推），form 不編輯
      // edit 模式保留既有值；new 模式預設 null / 0，下次跑 reapply-excel 會補
      track:
        mode === 'edit' && target !== 'new' && target !== null ? target.track ?? null : null,
      refinementLevel:
        mode === 'edit' && target !== 'new' && target !== null
          ? target.refinementLevel ?? 0
          : 0,
      hasConsent: form.hasConsent,
      orderDate: form.orderDate || null,
      startDate: form.startDate || null,
      totalAlignersUpper:
        form.totalAlignersUpper.trim() === '' ? null : Number(form.totalAlignersUpper),
      currentAlignerUpper:
        form.currentAlignerUpper.trim() === '' ? null : Number(form.currentAlignerUpper),
      totalAlignersLower:
        form.totalAlignersLower.trim() === '' ? null : Number(form.totalAlignersLower),
      currentAlignerLower:
        form.currentAlignerLower.trim() === '' ? null : Number(form.currentAlignerLower),
      cycleDays: Number(form.cycleDays),
      lastVisit: form.lastVisit || null,
      nextVisit: form.nextVisit || null,
      consentPdfPath:
        mode === 'edit' && target !== 'new' && target !== null ? target.consentPdfPath : null,
      flags: form.flags,
      notes: form.notes.trim(),
      sourceFolder:
        mode === 'edit' && target !== 'new' && target !== null ? target.sourceFolder : '',
      // v0.1.9 加 markdownNote + photos：edit 模式保留、new 模式空字串 + 空 object
      markdownNote:
        mode === 'edit' && target !== 'new' && target !== null ? target.markdownNote ?? '' : '',
      photos:
        mode === 'edit' && target !== 'new' && target !== null ? target.photos ?? {} : {},
      createdAt:
        mode === 'edit' && target !== 'new' && target !== null ? target.createdAt : now,
      updatedAt: now,
    };

    try {
      await db.patients.put(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (mode !== 'edit' || target === 'new' || target === null) return;
    if (
      !confirm(`確定刪除病患「${target.name}」(${target.chartNo})？此動作無法復原。`)
    )
      return;
    setSaving(true);
    try {
      await db.patients.delete(target.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleFlag(f: PatientFlag) {
    setForm((s) => ({
      ...s,
      flags: s.flags.includes(f) ? s.flags.filter((x) => x !== f) : [...s.flags, f],
    }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl my-8">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            {mode === 'new' ? '新增病患' : `編輯病患 · ${(target as Patient).name}`}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
            aria-label="關閉"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5 space-y-6">
          <Section title="基本資料">
            <Field label="病歷號" required>
              <input
                value={form.chartNo}
                onChange={(e) => setForm({ ...form, chartNo: e.target.value })}
                className={inputCls}
                placeholder="0001"
                autoFocus={mode === 'new'}
              />
            </Field>
            <Field label="姓名" required>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
                placeholder="王小明"
              />
            </Field>
            <Field label="出生年月日" hint={ageHint}>
              <input
                type="date"
                value={form.birthday}
                onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="主治醫師">
              <select
                value={form.doctor}
                onChange={(e) => setForm({ ...form, doctor: e.target.value })}
                className={inputCls}
              >
                <option value="">未指定</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="口掃資訊">
              <input
                value={form.scanInfo}
                onChange={(e) => setForm({ ...form, scanInfo: e.target.value })}
                className={inputCls}
                placeholder="例：1/28 5000"
              />
            </Field>
          </Section>

          <Section title="治療資訊">
            <Field label="品牌">
              <select
                value={form.productLine}
                onChange={(e) =>
                  setForm({ ...form, productLine: e.target.value as ProductLine })
                }
                className={inputCls}
              >
                {(['riyue', 'invisalign', 'zenyum', 'retainer'] as ProductLine[]).map((pl) => (
                  <option key={pl} value={pl}>
                    {PRODUCT_LINE_LABEL[pl]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="狀態">
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as PatientStatus })
                }
                className={inputCls}
              >
                {(['active', 'paused', 'completed', 'transferred-out'] as PatientStatus[]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="授權書">
              <label className="flex items-center gap-2 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.hasConsent}
                  onChange={(e) => setForm({ ...form, hasConsent: e.target.checked })}
                  className="accent-sky-500"
                />
                <span>{form.hasConsent ? '已有授權書' : '尚無授權書'}</span>
              </label>
            </Field>
          </Section>

          <Section title="副數進度" cols={1}>
            <JawRow
              label="上顎"
              total={form.totalAlignersUpper}
              current={form.currentAlignerUpper}
              onTotal={(v) => setForm({ ...form, totalAlignersUpper: v })}
              onCurrent={(v) => setForm({ ...form, currentAlignerUpper: v })}
            />
            <JawRow
              label="下顎"
              total={form.totalAlignersLower}
              current={form.currentAlignerLower}
              onTotal={(v) => setForm({ ...form, totalAlignersLower: v })}
              onCurrent={(v) => setForm({ ...form, currentAlignerLower: v })}
            />
            <div className="grid grid-cols-2 gap-4 pt-1">
              <Field label="換套週期 (天)">
                <input
                  type="number"
                  min={1}
                  value={form.cycleDays}
                  onChange={(e) => setForm({ ...form, cycleDays: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="開始戴第一副">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section title="回診">
            <Field label="下單日">
              <input
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="上次回診">
              <input
                type="date"
                value={form.lastVisit}
                onChange={(e) => setForm({ ...form, lastVisit: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="下次回診">
              <input
                type="date"
                value={form.nextVisit}
                onChange={(e) => setForm({ ...form, nextVisit: e.target.value })}
                className={inputCls}
              />
            </Field>
          </Section>

          {mode === 'edit' && (
            <Section title="病患資料夾 (照片 / 口掃檔)" cols={1}>
              {sourceFolder ? (
                <div className="space-y-2">
                  <div className="font-mono text-xs text-zinc-400 break-all bg-zinc-900/40 border border-zinc-800 rounded-md px-3 py-2 select-all">
                    {sourceFolder}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={copyFolderPath}
                      className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition"
                    >
                      📋 複製路徑
                    </button>
                    <button
                      type="button"
                      onClick={openFolder}
                      disabled={openState === 'opening'}
                      className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-60"
                    >
                      🗂️ 開啟資料夾
                    </button>
                    {consentPdfPath && (
                      <button
                        type="button"
                        onClick={openConsentPdf}
                        disabled={openState === 'opening'}
                        className="px-3 py-1.5 rounded-md text-xs border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-60"
                      >
                        📄 開啟授權書
                      </button>
                    )}
                    {copyState === 'copied' && (
                      <span className="text-xs text-emerald-400">✓ 已複製</span>
                    )}
                    {copyState === 'failed' && (
                      <span className="text-xs text-rose-400">✗ 複製失敗</span>
                    )}
                    {openState === 'opened' && (
                      <span className="text-xs text-emerald-400">✓ 已開啟</span>
                    )}
                    {openState === 'helper-down' && (
                      <span className="text-xs text-amber-400">
                        ⚠️ folder helper 沒在跑 (請重啟 dev server)
                      </span>
                    )}
                    {openState === 'error' && (
                      <span className="text-xs text-rose-400">✗ {openError}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    「開啟資料夾」會透過本地 helper service 呼叫 explorer.exe。若失敗請改用「複製路徑」。
                  </p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  此病患無關聯資料夾（手動新增或無原始 scan 資料）。
                </p>
              )}
            </Section>
          )}

          <Section title="備註與旗標" cols={1}>
            <div className="flex flex-wrap gap-2">
              {EDITABLE_FLAGS.map((f) => (
                <label
                  key={f}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border cursor-pointer transition ${
                    form.flags.includes(f)
                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.flags.includes(f)}
                    onChange={() => toggleFlag(f)}
                    className="accent-sky-500"
                  />
                  {FLAG_LABEL[f]}
                </label>
              ))}
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${inputCls} min-h-[80px] resize-y`}
              placeholder="臨床備註（如：精調進度、注意事項）"
            />
          </Section>
        </div>

        {error && (
          <div className="px-6 pb-2">
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between gap-3">
          <div>
            {mode === 'edit' && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-2 rounded-md text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition disabled:opacity-50"
              >
                刪除病患
              </button>
            )}
          </div>
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

function Section({
  title,
  children,
  cols = 3,
}: {
  title: string;
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  const grid = cols === 1 ? '' : cols === 2 ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-3 gap-4';
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</h3>
      <div className={cols === 1 ? 'space-y-3' : grid}>{children}</div>
    </div>
  );
}

function JawRow({
  label,
  total,
  current,
  onTotal,
  onCurrent,
}: {
  label: string;
  total: string;
  current: string;
  onTotal: (v: string) => void;
  onCurrent: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[60px_1fr_1fr] gap-3 items-end">
      <div className="text-sm text-zinc-300 pb-2">{label}</div>
      <Field label="總副數">
        <input
          type="number"
          min={0}
          value={total}
          onChange={(e) => onTotal(e.target.value)}
          className={inputCls}
          placeholder="例：30"
        />
      </Field>
      <Field label="目前副數">
        <input
          type="number"
          min={0}
          value={current}
          onChange={(e) => onCurrent(e.target.value)}
          className={inputCls}
          placeholder="例：5"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          {label}
          {required && <span className="text-rose-400 ml-1">*</span>}
        </span>
        {hint && <span className="text-zinc-600 text-[10px]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
