// VisitWorkbenchPage — 回診工作台（路由 /visits、v0.7.0）
//
// 三區（規格 §4.2、由上而下）：
//   1. 搜尋登記：大搜尋框（病歷號/姓名 contains、最多 8 筆）→ 點一筆開 VisitFormModal
//   2. 今日預約：nextVisit === today、每列尾端「✓ 報到登記」
//   3. 今日已登記：listVisits({date: today})、登記成功即時刷新
//
// 資料走 useLiveQuery(db.*)：createVisit 會寫本機 Dexie（dual 模式亦然）、SSE reconcile
// 也 bulkPut 進 db.visits、故清單自動即時刷新。

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Patient, Visit } from '../types/Patient';
import { STATUS_LABEL, STATUS_BADGE, PRODUCT_LINE_LABEL } from '../labels';
import { usePermission } from '../contexts/AuthContext';
import VisitFormModal from '../components/VisitFormModal';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function VisitWorkbenchPage() {
  const canEdit = usePermission('patient.edit');
  const today = todayISO();

  const patients = useLiveQuery(() => db.patients.toArray()) ?? [];
  const todayVisits =
    useLiveQuery(() => db.visits.where('date').equals(today).toArray(), [today]) ?? [];

  const [search, setSearch] = useState('');
  const [modalPatient, setModalPatient] = useState<Patient | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, Patient>();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter((p) => (p.name + ' ' + p.chartNo).toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, patients]);

  const todayBooked = useMemo(
    () => patients.filter((p) => p.nextVisit === today),
    [patients, today],
  );

  const sortedTodayVisits = useMemo(
    () => [...todayVisits].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [todayVisits],
  );

  function openRegister(p: Patient) {
    setModalPatient(p);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">回診工作台</h1>
        <p className="text-xs text-zinc-500 mt-1">
          櫃檯報到 → 搜尋病患 → 點類型 → 完成登記。今日 {today}
        </p>
      </header>

      {!canEdit && (
        <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
          你目前的權限只能檢視回診記錄、不能登記（需要 <code>patient.edit</code>）。
        </div>
      )}

      {/* ── 1. 搜尋登記 ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="text-sm font-medium text-zinc-200 mb-3">搜尋病患登記</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="輸入病歷號 / 姓名 搜尋…"
          className="w-full h-12 px-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50"
          autoFocus
        />
        {search.trim() && (
          <div className="mt-3 space-y-2">
            {matched.length === 0 ? (
              <p className="text-sm text-zinc-500 px-1 py-2">找不到符合的病患</p>
            ) : (
              matched.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => openRegister(p)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-sky-500/40 hover:bg-zinc-800/40 transition text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-zinc-800"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-zinc-500 tabular text-sm">{p.chartNo}</span>
                    <span className="text-zinc-100 font-medium">{p.name}</span>
                    <Badge className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    <span className="text-xs text-zinc-500">
                      {PRODUCT_LINE_LABEL[p.productLine]}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500 whitespace-nowrap">
                    上次回診 {p.lastVisit ?? '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 2. 今日預約 ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <header className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
            <h2 className="text-sm font-medium text-zinc-200">今日預約</h2>
            <span className="text-xs text-zinc-500">({todayBooked.length})</span>
          </header>
          <div className="p-3 space-y-2">
            {todayBooked.length === 0 ? (
              <p className="text-sm text-zinc-500 px-2 py-6 text-center">今日無預約回診</p>
            ) : (
              todayBooked.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-zinc-900/50 border border-zinc-800"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-zinc-500 tabular text-sm">{p.chartNo}</span>
                    <span className="text-zinc-100 font-medium">{p.name}</span>
                    <Badge className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => openRegister(p)}
                      className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition whitespace-nowrap"
                    >
                      ✓ 報到登記
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── 3. 今日已登記 ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <header className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
            <h2 className="text-sm font-medium text-zinc-200">今日已登記</h2>
            <span className="text-xs text-zinc-500">({sortedTodayVisits.length})</span>
          </header>
          <div className="p-3 space-y-2">
            {sortedTodayVisits.length === 0 ? (
              <p className="text-sm text-zinc-500 px-2 py-6 text-center">今天還沒有登記</p>
            ) : (
              sortedTodayVisits.map((v) => (
                <VisitRow key={v.id} visit={v} patient={patientById.get(v.patientId)} />
              ))
            )}
          </div>
        </section>
      </div>

      {modalPatient && (
        <VisitFormModal patient={modalPatient} onClose={() => setModalPatient(null)} />
      )}
    </div>
  );
}

function VisitRow({ visit, patient }: { visit: Visit; patient: Patient | undefined }) {
  const time = (() => {
    try {
      return new Date(visit.createdAt).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  })();
  const aligner =
    visit.alignerUpper == null && visit.alignerLower == null
      ? '—'
      : `U${visit.alignerUpper ?? '—'} / L${visit.alignerLower ?? '—'}`;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <span className="text-xs text-zinc-500 tabular">{time}</span>
        <span className="text-zinc-500 tabular text-sm">{patient?.chartNo ?? '—'}</span>
        <span className="text-zinc-100 font-medium truncate">{patient?.name ?? '(未知病患)'}</span>
        <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/30">{visit.visitType}</Badge>
        <span className="text-xs text-zinc-500 tabular">{aligner}</span>
      </div>
      {visit._createdBy && (
        <span className="text-[11px] text-zinc-600 whitespace-nowrap">{visit._createdBy}</span>
      )}
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
