import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import type { Patient, PatientStatus, PatientTrack, ProductLine } from '../types/Patient';
import PatientFormModal from '../components/PatientFormModal';
import { derivePatientAlert } from '../config/alerts';
import { deriveProgress } from '../lib/progress';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  PRODUCT_LINE_LABEL,
  PRODUCT_LINE_BADGE,
  TRACK_LABEL,
  TRACK_BADGE,
  REFINEMENT_LABEL,
  REFINEMENT_BADGE,
  FLAG_LABEL,
  FLAG_BADGE,
  calcAge,
  toROCDate,
} from '../labels';

type SortField = 'chartNo' | 'name' | 'age' | 'orderDate' | 'nextVisit';
type SortDir = 'asc' | 'desc';

const DEFAULT_SORT: { field: SortField; dir: SortDir } = { field: 'orderDate', dir: 'desc' };

export default function PatientList() {
  const [search, setSearch] = useState('');
  // 多選 filter：空 set = 全部
  const [statusFilter, setStatusFilter] = useState<Set<PatientStatus>>(new Set());
  const [trackFilter, setTrackFilter] = useState<Set<NonNullable<PatientTrack>>>(new Set());
  const [refinementFilter, setRefinementFilter] = useState<Set<1 | 2 | 3>>(new Set());
  const [plFilter, setPlFilter] = useState<ProductLine | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT.field);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT.dir);
  const [modalTarget, setModalTarget] = useState<Patient | 'new' | null>(null);

  const navigate = useNavigate();
  const patients = useLiveQuery(() => db.patients.toArray()) ?? [];
  const orders = useLiveQuery(() => db.orders.toArray()) ?? [];
  const [missingOrderOnly, setMissingOrderOnly] = useState(false);
  const [missingDoctorOnly, setMissingDoctorOnly] = useState(false);

  // 計算每位病患的「漏單」警示 (C: active 但 0 orders)
  const missingOrderIds = useMemo(() => {
    const ordersByPatient = new Map<string, number>();
    for (const o of orders) {
      ordersByPatient.set(o.patientId, (ordersByPatient.get(o.patientId) || 0) + 1);
    }
    const set = new Set<string>();
    for (const p of patients) {
      const list: never[] = [];
      void list;
      const count = ordersByPatient.get(p.id) || 0;
      const alert = derivePatientAlert(p, count > 0 ? [{} as never] : []);
      if (alert) set.add(p.id);
    }
    return set;
  }, [patients, orders]);
  const missingOrderCount = missingOrderIds.size;

  // 「未登記醫師」: doctor 欄為空 (還沒在 Excel 登錄、或 import 時對不到)
  // 已結案 (completed / transferred-out) 的病患不算，避免噪音
  const missingDoctorIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of patients) {
      if (p.status === 'completed' || p.status === 'transferred-out') continue;
      if (!p.doctor || !p.doctor.trim()) set.add(p.id);
    }
    return set;
  }, [patients]);
  const missingDoctorCount = missingDoctorIds.size;

  const counts = useMemo(() => {
    const status: Record<string, number> = { all: patients.length };
    const pl: Record<string, number> = { all: patients.length };
    const track: Record<string, number> = { 'new-design': 0, 'old-design': 0, none: 0 };
    const refinement: Record<string, number> = { 1: 0, 2: 0, 3: 0 };
    for (const p of patients) {
      status[p.status] = (status[p.status] || 0) + 1;
      pl[p.productLine] = (pl[p.productLine] || 0) + 1;
      if (p.track === 'new-design') track['new-design']++;
      else if (p.track === 'old-design') track['old-design']++;
      else track.none++;
      if (p.refinementLevel >= 1 && p.refinementLevel <= 3) refinement[p.refinementLevel]++;
    }
    return { status, pl, track, refinement };
  }, [patients]);

  const isFiltered =
    statusFilter.size > 0 ||
    trackFilter.size > 0 ||
    refinementFilter.size > 0 ||
    plFilter !== 'all' ||
    search.trim() !== '';

  function resetFilters() {
    setSearch('');
    setStatusFilter(new Set());
    setTrackFilter(new Set());
    setRefinementFilter(new Set());
    setPlFilter('all');
  }

  function toggleSetFilter<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // 第一次點某欄：日期類預設 desc（新→舊），其他 asc
      setSortDir(field === 'orderDate' || field === 'nextVisit' ? 'desc' : 'asc');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = patients.filter((p) => {
      if (statusFilter.size > 0 && !statusFilter.has(p.status)) return false;
      if (trackFilter.size > 0) {
        if (p.track === null || !trackFilter.has(p.track)) return false;
      }
      if (refinementFilter.size > 0) {
        if (p.refinementLevel === 0 || !refinementFilter.has(p.refinementLevel as 1 | 2 | 3)) return false;
      }
      if (plFilter !== 'all' && p.productLine !== plFilter) return false;
      if (missingOrderOnly && !missingOrderIds.has(p.id)) return false;
      if (missingDoctorOnly && !missingDoctorIds.has(p.id)) return false;
      if (q) {
        const hay = (p.name + ' ' + p.chartNo).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    r = [...r].sort((a, b) => {
      switch (sortField) {
        case 'chartNo':
          return a.chartNo.localeCompare(b.chartNo) * dir;
        case 'name':
          return a.name.localeCompare(b.name, 'zh-Hant') * dir;
        case 'age': {
          const aa = calcAge(a.birthday) ?? -1;
          const bb = calcAge(b.birthday) ?? -1;
          return (aa - bb) * dir;
        }
        case 'orderDate':
          return (a.orderDate ?? '').localeCompare(b.orderDate ?? '') * dir;
        case 'nextVisit': {
          // null 永遠排在最後（不論 asc/desc）
          const av = a.nextVisit ?? '';
          const bv = b.nextVisit ?? '';
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return av.localeCompare(bv) * dir;
        }
      }
    });
    return r;
  }, [patients, search, statusFilter, trackFilter, refinementFilter, plFilter, sortField, sortDir, missingOrderOnly, missingOrderIds, missingDoctorOnly, missingDoctorIds]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">病患列表</h1>
            <p className="text-xs text-zinc-500 mt-1">
              共 {patients.length} 位 · 顯示 {filtered.length} 位
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋姓名 / 病歷號"
              className="w-64 px-3 py-2 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50"
            />
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="px-3 py-2 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition"
              >
                重置篩選
              </button>
            )}
            <button
              onClick={() => setModalTarget('new')}
              className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
            >
              + 新增病患
            </button>
          </div>
        </div>

        <FilterRow label="狀態">
          <Chip
            active={statusFilter.size === 0}
            onClick={() => setStatusFilter(new Set())}
            label="全部"
            count={counts.status.all}
          />
          {(['active', 'paused', 'completed', 'transferred-out'] as PatientStatus[]).map((s) => (
            <Chip
              key={s}
              active={statusFilter.has(s)}
              onClick={() => toggleSetFilter(setStatusFilter, s)}
              label={STATUS_LABEL[s]}
              count={counts.status[s] || 0}
              activeClass={STATUS_BADGE[s]}
            />
          ))}
        </FilterRow>

        <FilterRow label="設計">
          <Chip
            active={trackFilter.size === 0}
            onClick={() => setTrackFilter(new Set())}
            label="全部"
            count={patients.length}
          />
          {(['new-design', 'old-design'] as NonNullable<PatientTrack>[]).map((t) => (
            <Chip
              key={t}
              active={trackFilter.has(t)}
              onClick={() => toggleSetFilter(setTrackFilter, t)}
              label={TRACK_LABEL[t]}
              count={counts.track[t] || 0}
              activeClass={TRACK_BADGE[t]}
            />
          ))}
        </FilterRow>

        <FilterRow label="精調">
          <Chip
            active={refinementFilter.size === 0}
            onClick={() => setRefinementFilter(new Set())}
            label="全部"
            count={patients.length}
          />
          {([1, 2, 3] as const).map((n) => (
            <Chip
              key={n}
              active={refinementFilter.has(n)}
              onClick={() => toggleSetFilter(setRefinementFilter, n)}
              label={REFINEMENT_LABEL[n]}
              count={counts.refinement[n] || 0}
              activeClass={REFINEMENT_BADGE[n]}
            />
          ))}
        </FilterRow>

        <FilterRow label="品牌">
          <Chip
            active={plFilter === 'all'}
            onClick={() => setPlFilter('all')}
            label="全部"
            count={counts.pl.all}
          />
          {(['riyue', 'invisalign', 'zenyum', 'retainer'] as ProductLine[]).map((pl) => (
            <Chip
              key={pl}
              active={plFilter === pl}
              onClick={() => setPlFilter(pl)}
              label={PRODUCT_LINE_LABEL[pl]}
              count={counts.pl[pl] || 0}
              activeClass={PRODUCT_LINE_BADGE[pl]}
            />
          ))}
        </FilterRow>

        <FilterRow label="警示">
          <button
            type="button"
            onClick={() => setMissingOrderOnly(!missingOrderOnly)}
            disabled={missingOrderCount === 0}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${
              missingOrderOnly
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                : missingOrderCount === 0
                  ? 'bg-zinc-950/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <span>⚠ 漏單 (active 無下單)</span>
            <span className="tabular text-[10px] opacity-70">{missingOrderCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setMissingDoctorOnly(!missingDoctorOnly)}
            disabled={missingDoctorCount === 0}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${
              missingDoctorOnly
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : missingDoctorCount === 0
                  ? 'bg-zinc-950/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <span>⚠ 未登記醫師 (Excel 未匯入)</span>
            <span className="tabular text-[10px] opacity-70">{missingDoctorCount}</span>
          </button>
        </FilterRow>
      </header>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <SortableTh field="chartNo" current={sortField} dir={sortDir} onClick={toggleSort}>
                  病歷號
                </SortableTh>
                <SortableTh field="name" current={sortField} dir={sortDir} onClick={toggleSort}>
                  姓名
                </SortableTh>
                <Th>出生年月日</Th>
                <SortableTh
                  field="age"
                  current={sortField}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="center"
                >
                  年齡
                </SortableTh>
                <Th>品牌</Th>
                <Th>狀態</Th>
                <Th>醫師</Th>
                <Th align="center">授權書</Th>
                <Th align="center">進度</Th>
                <SortableTh
                  field="orderDate"
                  current={sortField}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  下單日
                </SortableTh>
                <SortableTh
                  field="nextVisit"
                  current={sortField}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="center"
                >
                  下次回診
                </SortableTh>
                <Th>備註 / 旗標</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-zinc-500">
                    沒有符合條件的病患
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <Row
                    key={p.id}
                    p={p}
                    isMissingOrder={missingOrderIds.has(p.id)}
                    onOpenDetail={() => navigate(`/patients/${p.id}`)}
                    onQuickEdit={() => setModalTarget(p)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PatientFormModal target={modalTarget} onClose={() => setModalTarget(null)} />
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`font-medium px-3 py-2.5 whitespace-nowrap ${alignClass}`}>{children}</th>
  );
}

function SortableTh({
  field,
  current,
  dir,
  onClick,
  children,
  align = 'left',
}: {
  field: SortField;
  current: SortField;
  dir: SortDir;
  onClick: (f: SortField) => void;
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  const active = current === field;
  const arrow = active ? (dir === 'asc' ? '↑' : '↓') : '';
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`font-medium px-3 py-2.5 whitespace-nowrap ${alignClass}`}
    >
      <button
        type="button"
        onClick={() => onClick(field)}
        className={`inline-flex items-center gap-1 hover:text-zinc-200 transition ${
          active ? 'text-sky-300' : 'text-zinc-500'
        }`}
      >
        <span>{children}</span>
        <span className="text-[10px] w-3">{arrow}</span>
      </button>
    </th>
  );
}

function Row({
  p,
  onOpenDetail,
  onQuickEdit,
  isMissingOrder,
}: {
  p: Patient;
  onOpenDetail: () => void;
  onQuickEdit: () => void;
  isMissingOrder: boolean;
}) {
  const age = calcAge(p.birthday);
  const todayISO = new Date().toISOString().slice(0, 10);
  const progress = deriveProgress(p, todayISO);
  const upper =
    p.totalAlignersUpper != null && p.currentAlignerUpper != null
      ? `${p.currentAlignerUpper}/${p.totalAlignersUpper}`
      : null;
  const lower =
    p.totalAlignersLower != null && p.currentAlignerLower != null
      ? `${p.currentAlignerLower}/${p.totalAlignersLower}`
      : null;
  const lagTooltip =
    progress.isLagging
      ? `預計到第 ${progress.upper.expected ?? progress.lower.expected} 副，落後 ${progress.worstLag} 副`
      : '';

  return (
    <tr
      className={`hover:bg-zinc-800/30 transition cursor-pointer ${
        isMissingOrder ? 'border-l-2 border-l-rose-500/60' : ''
      }`}
      onClick={onOpenDetail}
    >
      <td className="px-3 py-2 tabular text-zinc-400">{p.chartNo}</td>
      <td className="px-3 py-2 font-medium text-zinc-100 whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          <span>{p.name}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickEdit();
            }}
            className="text-zinc-600 hover:text-sky-300 text-xs"
            title="快速編輯 (彈窗)"
          >
            ✎
          </button>
        </div>
        {isMissingOrder && (
          <span
            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] border bg-rose-500/15 text-rose-300 border-rose-500/30"
            title="active 病患但 0 筆下單，可能漏單"
          >
            ⚠ 漏單
          </span>
        )}
      </td>
      <td
        className="px-3 py-2 tabular text-zinc-400 whitespace-nowrap"
        title={p.birthday ? `西元 ${p.birthday}` : ''}
      >
        {toROCDate(p.birthday) ?? '—'}
      </td>
      <td className="px-3 py-2 tabular text-center text-zinc-400 whitespace-nowrap">
        {age ?? '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Badge className={PRODUCT_LINE_BADGE[p.productLine]}>
          {PRODUCT_LINE_LABEL[p.productLine]}
        </Badge>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="inline-flex items-center gap-1 flex-wrap">
          <Badge className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          {p.track && (
            <Badge className={TRACK_BADGE[p.track]}>{TRACK_LABEL[p.track]}</Badge>
          )}
          {p.refinementLevel >= 1 && p.refinementLevel <= 3 && (
            <Badge className={REFINEMENT_BADGE[p.refinementLevel as 1 | 2 | 3]}>
              {REFINEMENT_LABEL[p.refinementLevel as 1 | 2 | 3]}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {p.doctor && p.doctor.trim() ? (
          <span className="text-zinc-300">{p.doctor}</span>
        ) : (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] border bg-amber-500/15 text-amber-300 border-amber-500/30"
            title="patient.doctor 為空 — 通常代表 Excel 還沒登錄這位病人，或 import 時對不到名字"
          >
            ⚠ 未登記
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap" title={p.hasConsent ? '已有授權書' : '無授權書'}>
        {p.hasConsent ? (
          <span className="text-emerald-400">✓</span>
        ) : (
          <span className="text-rose-400 font-semibold">✗</span>
        )}
      </td>
      <td
        className="px-3 py-2 tabular text-center text-zinc-400 whitespace-nowrap leading-tight"
        title={lagTooltip}
      >
        {upper || lower ? (
          <div className="text-xs space-y-0.5 inline-block text-left">
            <JawMiniBar label="上" text={upper} jaw={progress.upper} />
            <JawMiniBar label="下" text={lower} jaw={progress.lower} />
          </div>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 tabular text-zinc-400 whitespace-nowrap">{p.orderDate ?? '—'}</td>
      <td className="px-3 py-2 tabular text-center text-zinc-400 whitespace-nowrap">{p.nextVisit ?? '—'}</td>
      <td className="px-3 py-2 max-w-[320px]">
        <div className="flex flex-wrap items-center gap-1">
          {p.flags.map((f) => (
            <Badge key={f} className={FLAG_BADGE[f]}>
              {FLAG_LABEL[f]}
            </Badge>
          ))}
          {p.notes && (
            <span className="text-xs text-zinc-500 truncate" title={p.notes}>
              {p.notes}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function JawMiniBar({
  label,
  text,
  jaw,
}: {
  label: string;
  text: string | null;
  jaw: import('../lib/progress').JawProgress;
}) {
  const pct = jaw.progressPercent;
  const lag = jaw.lag;
  // 顏色：落後 ≥2 紅、超前 ≥1 綠、否則藍
  let fillClass = 'bg-sky-500';
  if (lag != null && lag >= 2) fillClass = 'bg-rose-500';
  else if (lag != null && lag <= -1) fillClass = 'bg-emerald-500';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-600 w-3">{label}</span>
      <span className="w-12 text-right">{text ?? '—'}</span>
      <div className="h-1 w-14 rounded-full bg-zinc-800 overflow-hidden">
        {pct != null && (
          <div
            className={`h-full ${fillClass} transition-all`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        )}
      </div>
      <span className="w-9 text-right text-zinc-500 tabular">
        {pct != null ? `${pct}%` : ''}
      </span>
      {lag != null && lag >= 2 && <span className="text-rose-400 w-6">↘{lag}</span>}
      {lag != null && lag <= -1 && <span className="text-emerald-400 w-6">↗{-lag}</span>}
      {(lag == null || (lag < 2 && lag > -1)) && <span className="w-6" />}
    </div>
  );
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-500 w-12">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  activeClass = 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  activeClass?: string;
}) {
  const empty = count === 0;
  const className = active
    ? activeClass
    : empty
      ? 'bg-zinc-950/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
      : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty && !active}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${className}`}
    >
      <span>{label}</span>
      <span className="tabular text-[10px] opacity-70">{count}</span>
    </button>
  );
}
