import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  PROGRESS_OPTIONS,
  type Order,
  type Patient,
  type ProgressStatus,
} from '../types/Patient';
import OrderFormModal from '../components/OrderFormModal';
import PatientFormModal from '../components/PatientFormModal';
import AlertSettingsModal from '../components/AlertSettingsModal';
import { PROGRESS_BADGE, TRACK_LABEL, TRACK_BADGE, REFINEMENT_LABEL, REFINEMENT_BADGE } from '../labels';
import { labBadgeStyle, useLabs } from '../lib/labs';
import { doctorBadgeStyle, useDoctors } from '../lib/doctors';
import {
  deriveOrderAlerts,
  ORDER_ALERT_BADGE,
  ORDER_ALERT_LABEL,
  useThresholds,
  type OrderAlert,
} from '../config/alerts';

type ViewMode = 'group' | 'date';

export default function OrderTracking() {
  const orders = useLiveQuery(() => db.orders.toArray()) ?? [];
  const patients = useLiveQuery(() => db.patients.toArray()) ?? [];
  const patientsById = useMemo(() => {
    const m = new Map<string, Patient>();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);
  const labs = useLabs();
  const [modalTarget, setModalTarget] = useState<Order | 'new' | null>(null);
  const [patientModalTarget, setPatientModalTarget] = useState<Patient | 'new' | null>(null);
  const [patientPrefillName, setPatientPrefillName] = useState('');
  const [orderPrefillPatientId, setOrderPrefillPatientId] = useState('');
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [alertOnlyFilter, setAlertOnlyFilter] = useState(false);
  const thresholds = useThresholds();
  const todayISO = new Date().toISOString().slice(0, 10);

  // 預先計算每筆 order 的 alerts (key by order.id)
  const alertsByOrder = useMemo(() => {
    const map = new Map<string, OrderAlert[]>();
    for (const o of orders) {
      const a = deriveOrderAlerts(o, todayISO, thresholds);
      if (a.length) map.set(o.id, a);
    }
    return map;
  }, [orders, todayISO, thresholds]);

  const alertCount = alertsByOrder.size;
  const [view, setView] = useState<ViewMode>('group');
  const [search, setSearch] = useState('');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [progressFilter, setProgressFilter] = useState<ProgressStatus | 'all'>('all');
  const [monthFilter, setMonthFilter] = useState<string | 'all'>('all');

  const allDoctors = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) if (o.doctor) set.add(o.doctor);
    return [...set].sort();
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (labFilter !== 'all' && o.lab !== labFilter) return false;
      if (doctorFilter !== 'all' && o.doctor !== doctorFilter) return false;
      if (progressFilter !== 'all' && o.progress !== progressFilter) return false;
      if (monthFilter !== 'all' && (!o.date || !o.date.startsWith(monthFilter))) return false;
      if (alertOnlyFilter && !alertsByOrder.has(o.id)) return false;
      if (q) {
        const hay = (o.patientName + ' ' + o.patientChartNo + ' ' + o.alignerRange).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, search, labFilter, doctorFilter, progressFilter, monthFilter, alertOnlyFilter, alertsByOrder]);

  // 月份 × 進度 統計 (整體 orders，不受 filter 影響)
  const monthlyStats = useMemo(() => {
    const map = new Map<string, Record<ProgressStatus, number>>();
    const totals: Record<ProgressStatus, number> = {
      尚未開始: 0,
      已下單牙套: 0,
      診所已收到牙套: 0,
      已完成: 0,
    };
    for (const o of orders) {
      if (!o.date) continue;
      const m = o.date.slice(0, 7);
      if (!map.has(m)) {
        map.set(m, { 尚未開始: 0, 已下單牙套: 0, 診所已收到牙套: 0, 已完成: 0 });
      }
      map.get(m)![o.progress]++;
      totals[o.progress]++;
    }
    const months = [...map.keys()].sort().reverse();
    const grandTotal = orders.length;
    return { months, map, totals, grandTotal };
  }, [orders]);

  // Group view: by patient (chartNo asc), inside group by date desc
  const grouped = useMemo(() => {
    if (view !== 'group') return null;
    const map = new Map<string, Order[]>();
    for (const o of filtered) {
      const k = `${o.patientChartNo}|${o.patientName}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    const arr = [...map.entries()].map(([key, list]) => {
      list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      return { key, list };
    });
    arr.sort((a, b) => a.list[0].patientChartNo.localeCompare(b.list[0].patientChartNo));
    return arr;
  }, [filtered, view]);

  // Date view: flat list sorted by date desc
  const dateSorted = useMemo(() => {
    if (view !== 'date') return null;
    return [...filtered].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [filtered, view]);

  function exportCsv() {
    const rows = [
      ['日期', '病歷號', '姓名', '醫師', '技工所', '批次', '副數區間', '進度', '預計收件', '實際收件', '下一步', '備註'],
      ...filtered.map((o) => [
        o.date,
        o.patientChartNo,
        o.patientName,
        o.doctor,
        o.lab,
        o.batchType,
        o.alignerRange,
        o.progress,
        o.expectedDate ?? '',
        o.actualDate ?? '',
        o.nextStep,
        o.notes,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `下單記錄_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">下單追蹤</h1>
          <p className="text-xs text-zinc-500 mt-1">
            共 {orders.length} 筆 · 顯示 {filtered.length} 筆
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋姓名 / 病歷號 / 副數區間"
            className="w-64 px-3 py-2 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50"
          />
          <ViewToggle view={view} onChange={setView} />
          <button
            onClick={() => setAlertSettingsOpen(true)}
            className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
            title="警示閾值設定"
          >
            ⚙ 警示
            {alertCount > 0 && (
              <span className="ml-1 inline-flex items-center px-1.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px]">
                {alertCount}
              </span>
            )}
          </button>
          <button
            onClick={exportCsv}
            className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            ⬇ CSV
          </button>
          <a
            href={`/orders/report?month=${new Date().toISOString().slice(0, 7)}`}
            className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            🖨 月報
          </a>
          <button
            onClick={() => setPatientModalTarget('new')}
            className="px-3 py-2 rounded-md text-sm border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition"
          >
            + 新增病患
          </button>
          <button
            onClick={() => setModalTarget('new')}
            className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
          >
            + 新增下單
          </button>
        </div>
      </header>

      {/* 月份 × 進度 統計表 */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-zinc-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left font-medium px-3 py-2">月份</th>
              {PROGRESS_OPTIONS.map((p) => (
                <th key={p} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  {p}
                </th>
              ))}
              <th className="text-right font-medium px-3 py-2 border-l border-zinc-800">小計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {monthlyStats.months.map((m) => {
              const row = monthlyStats.map.get(m)!;
              const subtotal = PROGRESS_OPTIONS.reduce((s, p) => s + row[p], 0);
              const isSelected = monthFilter === m;
              return (
                <tr
                  key={m}
                  className={`cursor-pointer transition ${
                    isSelected ? 'bg-sky-500/10' : 'hover:bg-zinc-800/30'
                  }`}
                  onClick={() => setMonthFilter(isSelected ? 'all' : m)}
                >
                  <td className="px-3 py-2 tabular text-zinc-200 font-medium">{m}</td>
                  {PROGRESS_OPTIONS.map((p) => (
                    <td
                      key={p}
                      className="px-3 py-2 tabular text-right whitespace-nowrap"
                    >
                      {row[p] > 0 ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${PROGRESS_BADGE[p]}`}
                        >
                          {row[p]}
                        </span>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 tabular text-right text-zinc-200 font-semibold border-l border-zinc-800">
                    {subtotal}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-zinc-900/60 text-zinc-200 text-sm font-medium border-t border-zinc-800">
            <tr
              className={`cursor-pointer transition ${
                monthFilter === 'all' ? 'bg-sky-500/10' : 'hover:bg-zinc-800/30'
              }`}
              onClick={() => setMonthFilter('all')}
            >
              <td className="px-3 py-2.5">總計</td>
              {PROGRESS_OPTIONS.map((p) => {
                const isSelected = progressFilter === p;
                return (
                  <td key={p} className="px-3 py-2.5 tabular text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProgressFilter(isSelected ? 'all' : p);
                      }}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border transition ${
                        isSelected
                          ? PROGRESS_BADGE[p]
                          : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {monthlyStats.totals[p]}
                    </button>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 tabular text-right text-sky-300 border-l border-zinc-800">
                {monthlyStats.grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* 篩選 */}
      <section className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500">篩選：</span>
        <button
          onClick={() => setAlertOnlyFilter(!alertOnlyFilter)}
          className={`px-3 py-1.5 rounded-full text-xs border transition ${
            alertOnlyFilter
              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              : 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
          }`}
          disabled={alertCount === 0}
        >
          ⚠ 只看警示 ({alertCount})
        </button>
        <SelectChip
          value={labFilter}
          onChange={setLabFilter}
          options={[
            { value: 'all', label: '全部技工所' },
            ...labs.map((l) => ({ value: l.name, label: l.name })),
          ]}
        />
        <SelectChip
          value={doctorFilter}
          onChange={setDoctorFilter}
          options={[
            { value: 'all', label: '全部醫師' },
            ...allDoctors.map((d) => ({ value: d, label: d })),
          ]}
        />
        {progressFilter !== 'all' && (
          <button
            onClick={() => setProgressFilter('all')}
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            清除進度篩選 ({progressFilter})
          </button>
        )}
      </section>

      {/* 列表 */}
      {view === 'group' && grouped && (
        <GroupView
          groups={grouped}
          alertsByOrder={alertsByOrder}
          patientsById={patientsById}
          onClick={(o) => setModalTarget(o)}
          onAddForPatient={(patientId) => {
            setOrderPrefillPatientId(patientId);
            setModalTarget('new');
          }}
        />
      )}
      {view === 'date' && dateSorted && (
        <DateView orders={dateSorted} alertsByOrder={alertsByOrder} onClick={(o) => setModalTarget(o)} />
      )}

      <OrderFormModal
        target={modalTarget}
        prefillPatientId={orderPrefillPatientId}
        onClose={() => {
          setModalTarget(null);
          setOrderPrefillPatientId('');
        }}
        onCreatePatient={(prefillName) => {
          setModalTarget(null);
          setOrderPrefillPatientId('');
          setPatientPrefillName(prefillName);
          setPatientModalTarget('new');
        }}
      />
      <PatientFormModal
        target={patientModalTarget}
        prefillName={patientPrefillName}
        onClose={() => {
          setPatientModalTarget(null);
          setPatientPrefillName('');
        }}
      />

      <AlertSettingsModal open={alertSettingsOpen} onClose={() => setAlertSettingsOpen(false)} />
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden">
      {(['group', 'date'] as ViewMode[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-2 text-xs transition ${
            view === v ? 'bg-sky-500/15 text-sky-300' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          {v === 'group' ? '依病患' : '依日期'}
        </button>
      ))}
    </div>
  );
}

function GroupView({
  groups,
  alertsByOrder,
  patientsById,
  onClick,
  onAddForPatient,
}: {
  groups: { key: string; list: Order[] }[];
  alertsByOrder: Map<string, OrderAlert[]>;
  patientsById: Map<string, Patient>;
  onClick: (o: Order) => void;
  onAddForPatient: (patientId: string) => void;
}) {
  if (groups.length === 0)
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center text-zinc-500">
        沒有符合條件的下單
      </div>
    );
  return (
    <div className="space-y-3">
      {groups.map(({ key, list }) => {
        const head = list[0];
        const patient = patientsById.get(head.patientId);
        return (
          <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
            <div className="px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-zinc-500 tabular">{head.patientChartNo}</span>
                <span className="text-zinc-100 font-medium">{head.patientName}</span>
                {head.doctor && <DoctorBadge name={head.doctor} />}
                {patient?.track && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${TRACK_BADGE[patient.track]}`}>
                    {TRACK_LABEL[patient.track]}
                  </span>
                )}
                {patient && patient.refinementLevel >= 1 && patient.refinementLevel <= 3 && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${REFINEMENT_BADGE[patient.refinementLevel as 1 | 2 | 3]}`}>
                    {REFINEMENT_LABEL[patient.refinementLevel as 1 | 2 | 3]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAddForPatient(head.patientId)}
                  className="px-2 py-1 rounded-md text-xs border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition"
                  title={`新增 ${head.patientName} 的下單`}
                >
                  + 新增
                </button>
                <span className="text-xs text-zinc-500">{list.length} 筆下單</span>
              </div>
            </div>
            <div className="divide-y divide-zinc-800/60 text-sm">
              {list.map((o) => (
                <BatchRow
                  key={o.id}
                  o={o}
                  alerts={alertsByOrder.get(o.id) ?? []}
                  onClick={() => onClick(o)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 統一的 grid 欄寬，所有病患群組共用，確保跨群組對齊
// 欄位順序：日期 / 技工所 / 批次 / 副數區間 / 進度 / 警示 / 備註
const BATCH_GRID =
  'grid grid-cols-[100px_72px_64px_130px_110px_150px_1fr] gap-3 items-center px-4 py-2';

function DateView({
  orders,
  alertsByOrder,
  onClick,
}: {
  orders: Order[];
  alertsByOrder: Map<string, OrderAlert[]>;
  onClick: (o: Order) => void;
}) {
  if (orders.length === 0)
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center text-zinc-500">
        沒有符合條件的下單
      </div>
    );
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[110px]" /> {/* 日期 */}
            <col className="w-[80px]" /> {/* 病歷號 */}
            <col className="w-[90px]" /> {/* 姓名 */}
            <col className="w-[100px]" /> {/* 醫師 */}
            <col className="w-[80px]" /> {/* 技工所 */}
            <col className="w-[180px]" /> {/* 副數區間 */}
            <col className="w-[140px]" /> {/* 進度 */}
            <col className="w-[160px]" /> {/* 警示 */}
            <col /> {/* 備註 — 剩餘空間 */}
          </colgroup>
          <thead className="bg-zinc-900/60 text-zinc-500 text-xs uppercase tracking-wider">
            <tr>
              <Th>日期</Th>
              <Th>病歷號</Th>
              <Th>姓名</Th>
              <Th>醫師</Th>
              <Th>技工所</Th>
              <Th>副數區間</Th>
              <Th>進度</Th>
              <Th>警示</Th>
              <Th>備註</Th>
            </tr>
          </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {orders.map((o) => {
            const alerts = alertsByOrder.get(o.id) ?? [];
            const hasAlert = alerts.length > 0;
            return (
              <tr
                key={o.id}
                className={`hover:bg-zinc-800/30 cursor-pointer ${
                  hasAlert ? 'border-l-2 border-l-rose-500/60' : ''
                }`}
                onClick={() => onClick(o)}
              >
                <td className="px-3 py-2 tabular text-zinc-300 whitespace-nowrap">{o.date}</td>
                <td className="px-3 py-2 tabular text-zinc-400">{o.patientChartNo}</td>
                <td className="px-3 py-2 text-zinc-100 whitespace-nowrap">{o.patientName}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {o.doctor && <DoctorBadge name={o.doctor} />}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <LabBadge lab={o.lab} />
                </td>
                <td className="px-3 py-2 text-zinc-200 whitespace-nowrap font-mono text-xs">
                  {o.alignerRange}
                  {o.batchType && (
                    <span className="ml-2 text-zinc-500">{o.batchType}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <ProgressBadge p={o.progress} />
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {alerts.map((a) => (
                    <AlertBadge key={a.type} alert={a} />
                  ))}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500 max-w-[280px] truncate" title={o.notes}>
                  {o.notes || '—'}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchRow({
  o,
  alerts,
  onClick,
}: {
  o: Order;
  alerts: OrderAlert[];
  onClick: () => void;
}) {
  const hasAlert = alerts.length > 0;
  return (
    <div
      className={`${BATCH_GRID} hover:bg-zinc-800/30 cursor-pointer transition ${
        hasAlert ? 'border-l-2 border-l-rose-500/60 pl-3.5' : ''
      }`}
      onClick={onClick}
    >
      <span className="tabular text-zinc-300 text-xs whitespace-nowrap">{o.date}</span>
      <span className="whitespace-nowrap">
        <LabBadge lab={o.lab} />
      </span>
      <span className="text-xs text-zinc-500 whitespace-nowrap">{o.batchType}</span>
      <span className="text-zinc-100 font-mono text-xs whitespace-nowrap truncate" title={o.alignerRange}>
        {o.alignerRange || '—'}
      </span>
      <span className="whitespace-nowrap">
        <ProgressBadge p={o.progress} />
      </span>
      <span className="whitespace-nowrap flex flex-wrap items-center gap-1">
        {alerts.map((a) => (
          <AlertBadge key={a.type} alert={a} />
        ))}
      </span>
      <span className="text-xs text-zinc-500 truncate" title={o.notes}>
        {o.notes || '—'}
      </span>
    </div>
  );
}

function AlertBadge({ alert }: { alert: OrderAlert }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${ORDER_ALERT_BADGE[alert.type]}`}
      title={alert.message}
    >
      ⚠ {ORDER_ALERT_LABEL[alert.type]} +{alert.daysOverdue}天
    </span>
  );
}

function ProgressBadge({ p }: { p: ProgressStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${PROGRESS_BADGE[p]}`}>
      {p}
    </span>
  );
}

function DoctorBadge({ name }: { name: string }) {
  const doctors = useDoctors();
  const found = doctors.find((d) => d.name === name);
  if (found) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border"
        style={doctorBadgeStyle(found)}
      >
        {name}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-zinc-700/30 text-zinc-300 border-zinc-700">
      {name}
    </span>
  );
}

function LabBadge({ lab }: { lab: string }) {
  const labs = useLabs();
  const found = labs.find((l) => l.name === lab);
  if (found) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border"
        style={labBadgeStyle(found)}
      >
        {lab}
      </span>
    );
  }
  // 未知 lab (可能舊 order 用了已刪除的 lab) → 灰色 fallback
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-zinc-700/30 text-zinc-300 border-zinc-700">
      {lab}
    </span>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-medium px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</th>;
}

function SelectChip({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-full text-xs bg-zinc-900/60 border border-zinc-800 text-zinc-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
