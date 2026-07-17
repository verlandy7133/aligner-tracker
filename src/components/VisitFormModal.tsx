// VisitFormModal — 共用回診登記表單（v0.7.0 回診登記）
//
// 用途：櫃檯助理 10 秒內登記一筆回診。
//   - 工作台搜尋 / 今日預約 → 開此 modal
//   - 病患詳細頁「✓ 今日回診」→ 開此 modal
//
// 欄位（規格 §4.1、由上而下）：
//   1. 日期：預填今天、可改（補登過去）
//   2. 回診類型：chips 單選（useVisitTypes）、預設第一個；chips 實心底深字（主上鐵律）
//   3. 戴到第幾副：上/下顎 stepper、預填 currentAligner、「跳過」toggle＝送 null＝不更新副數
//   4. 下次回診：quick chips +2/4/6/8 週（以 visit.date 為基準）＋自訂 date ＋「不排」（送 null）
//   5. 備註：textarea
//
// createVisit 契約（見 data-layer-dexie / -api）：
//   - nextVisit：帶 date=設定 / 帶 null=清空 / 不帶 key=不動
//   - alignerUpper/Lower：帶數字=更新 / null 或不帶=不更新
// 故 payload 用條件式組 key。

import { useEffect, useState } from 'react';
import { getDataLayer } from '../lib/data-layer';
import { VersionConflictError, ApiError, NetworkError } from '../lib/api-client';
import { OfflineError } from '../lib/data-layer-dual';
import type { Patient, Visit } from '../types/Patient';
import { useVisitTypes } from '../lib/visit-types';
import { usePermission } from '../contexts/AuthContext';

export type VisitFormModalProps = {
  patient: Patient;
  onClose: () => void;
  onSaved?: (visit: Visit) => void;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// tz-safe：用本機日期分量加週、不經 UTC 位移
function addWeeksISO(base: string, weeks: number): string {
  const [y, m, d] = base.split('-').map(Number);
  if (!y || !m || !d) return base;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + weeks * 7);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 下次回診三態：none=不動（不送 key）/ date=設定 / off=不排（送 null）
type NextMode = 'none' | 'date' | 'off';

export default function VisitFormModal({ patient, onClose, onSaved }: VisitFormModalProps) {
  const canEdit = usePermission('patient.edit');
  const visitTypes = useVisitTypes();

  const [date, setDate] = useState(todayISO());
  const [visitType, setVisitType] = useState<string>('');
  const [skipAligner, setSkipAligner] = useState(false);
  const [alignerUpper, setAlignerUpper] = useState<number>(0);
  const [alignerLower, setAlignerLower] = useState<number>(0);
  const [nextMode, setNextMode] = useState<NextMode>('none');
  const [nextDate, setNextDate] = useState<string>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 初始化（patient 換 / 開啟時）
  useEffect(() => {
    setDate(todayISO());
    setSkipAligner(false);
    setAlignerUpper(patient.currentAlignerUpper ?? 0);
    setAlignerLower(patient.currentAlignerLower ?? 0);
    setNextMode('none');
    setNextDate('');
    setNote('');
    setError(null);
  }, [patient.id]);

  // 回診類型預設第一個（visitTypes async 到齊後）
  useEffect(() => {
    if (!visitType && visitTypes.length > 0) setVisitType(visitTypes[0]);
  }, [visitTypes, visitType]);

  // ESC 關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pickWeeks(weeks: number) {
    setNextMode('date');
    setNextDate(addWeeksISO(date, weeks));
  }

  async function handleSave() {
    if (!date) {
      setError('日期為必填');
      return;
    }
    if (!visitType) {
      setError('請選擇回診類型');
      return;
    }
    if (nextMode === 'date' && !nextDate) {
      setError('已選「指定日期」但未填下次回診日');
      return;
    }
    setSaving(true);
    setError(null);

    // 條件式組 payload：善用 createVisit 契約的「不帶 = 不動」語意
    const payload: Partial<Visit> & Pick<Visit, 'patientId' | 'date' | 'visitType'> = {
      patientId: patient.id,
      date,
      visitType,
      note: note.trim(),
    };
    if (!skipAligner) {
      payload.alignerUpper = alignerUpper;
      payload.alignerLower = alignerLower;
    }
    if (nextMode === 'date') payload.nextVisit = nextDate;
    else if (nextMode === 'off') payload.nextVisit = null;
    // nextMode === 'none' → 不帶 key = 不動

    try {
      const visit = await getDataLayer().createVisit(payload);
      onSaved?.(visit);
      onClose();
    } catch (e) {
      if (e instanceof VersionConflictError) {
        setError(`病患資料已被其他人更新（server v${e.currentVersion}、你 v${e.yourVersion}）。請重開對話框再試。`);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl my-8">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">✓ 回診登記</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              <span className="tabular">{patient.chartNo}</span> · {patient.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5 space-y-5">
          {/* 1. 日期 */}
          <Field label="回診日期" required>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
            {date !== todayISO() && (
              <p className="text-[11px] text-amber-400 mt-1">補登過去 / 未來日期</p>
            )}
          </Field>

          {/* 2. 回診類型 chips（實心底深字） */}
          <Field label="回診類型" required>
            <div className="flex flex-wrap gap-2">
              {visitTypes.map((t) => {
                const active = visitType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setVisitType(t)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition ${
                      active
                        ? 'bg-sky-500 border-sky-500 text-zinc-950 font-medium'
                        : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* 3. 戴到第幾副 */}
          <Field label="戴到第幾副">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipAligner}
                  onChange={(e) => setSkipAligner(e.target.checked)}
                  className="accent-sky-500"
                />
                跳過（不更新副數）
              </label>
            </div>
            <div className={`grid grid-cols-2 gap-3 ${skipAligner ? 'opacity-40 pointer-events-none' : ''}`}>
              <Stepper
                label="上顎"
                value={alignerUpper}
                total={patient.totalAlignersUpper}
                onChange={setAlignerUpper}
              />
              <Stepper
                label="下顎"
                value={alignerLower}
                total={patient.totalAlignersLower}
                onChange={setAlignerLower}
              />
            </div>
          </Field>

          {/* 4. 下次回診 */}
          <Field label="下次回診">
            <div className="flex flex-wrap gap-2 mb-2">
              {[2, 4, 6, 8].map((w) => {
                const wDate = addWeeksISO(date, w);
                const active = nextMode === 'date' && nextDate === wDate;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => pickWeeks(w)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition ${
                      active
                        ? 'bg-sky-500 border-sky-500 text-zinc-950 font-medium'
                        : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    +{w}週
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setNextMode('off');
                  setNextDate('');
                }}
                className={`px-3 py-1.5 rounded-md text-sm border transition ${
                  nextMode === 'off'
                    ? 'bg-amber-500 border-amber-500 text-zinc-950 font-medium'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                不排
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={nextMode === 'date' ? nextDate : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    setNextMode('date');
                    setNextDate(v);
                  } else {
                    setNextMode('none');
                    setNextDate('');
                  }
                }}
                className={`${inputCls} flex-1`}
              />
              {nextMode !== 'none' && (
                <button
                  type="button"
                  onClick={() => {
                    setNextMode('none');
                    setNextDate('');
                  }}
                  className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
                  title="清除選擇（不動下次回診）"
                >
                  清除
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {nextMode === 'none' && '未選 = 不變更病患現有下次回診'}
              {nextMode === 'date' && `下次回診設為 ${nextDate}`}
              {nextMode === 'off' && '清空病患下次回診（不排）'}
            </p>
          </Field>

          {/* 5. 備註 */}
          <Field label="備註">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${inputCls} min-h-[60px] resize-y`}
              placeholder="本次回診處置 / 特殊狀況…"
            />
          </Field>
        </div>

        {error && (
          <div className="px-6 pb-2">
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {canEdit ? '取消' : '關閉'}
          </button>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              {saving ? '登記中…' : '✓ 完成登記'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  'w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-zinc-400">
        {label}
        {required && <span className="text-rose-400 ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}

function Stepper({
  label,
  value,
  total,
  onChange,
}: {
  label: string;
  value: number;
  total: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-md bg-zinc-900/40 border border-zinc-800 p-2">
      <div className="text-[11px] text-zinc-500 mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular">/ {total ?? '—'}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-8 h-8 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-lg leading-none flex items-center justify-center"
        >
          −
        </button>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isNaN(n) ? 0 : Math.max(0, n));
          }}
          className="flex-1 h-8 px-2 rounded-md bg-zinc-950/60 border border-zinc-800 text-center text-sm text-zinc-100 tabular focus:outline-none focus:border-sky-500/50"
        />
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-lg leading-none flex items-center justify-center"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
