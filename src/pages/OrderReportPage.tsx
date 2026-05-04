import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Order } from '../types/Patient';

// 列印友善月度報表頁
// URL: /orders/report?month=2026-04
// 點瀏覽器列印或按「列印」按鈕 → 可存成 PDF / 列印實體紙本

export default function OrderReportPage() {
  const [params] = useSearchParams();
  const month = params.get('month') ?? new Date().toISOString().slice(0, 7);

  const orders = useLiveQuery(() => db.orders.toArray()) ?? [];

  const monthOrders = useMemo(
    () => orders.filter((o) => o.date?.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)),
    [orders, month],
  );

  // 按技工所 group
  const byLab = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of monthOrders) {
      if (!map.has(o.lab)) map.set(o.lab, []);
      map.get(o.lab)!.push(o);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [monthOrders]);

  // 按進度 summary
  const progressSummary = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of monthOrders) m[o.progress] = (m[o.progress] || 0) + 1;
    return m;
  }, [monthOrders]);

  return (
    <div className="report space-y-6">
      <header className="flex items-end justify-between gap-4 print:hidden">
        <div>
          <Link to="/orders" className="text-xs text-zinc-500 hover:text-zinc-200">
            ← 下單追蹤
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-100 mt-1">下單月報 {month}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            列印 / 存 PDF：點下方「列印」按鈕，或 Ctrl+P
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              const v = e.target.value;
              if (v) window.location.search = `?month=${v}`;
            }}
            className="h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200"
          />
          <button
            onClick={() => window.print()}
            className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
          >
            🖨 列印 / 存 PDF
          </button>
        </div>
      </header>

      {/* 列印標題 (只列印時顯示) */}
      <header className="hidden print:block border-b-2 border-zinc-700 pb-3">
        <h1 className="text-2xl font-bold">隱形矯正追蹤 — 下單月報</h1>
        <div className="flex justify-between text-sm mt-2">
          <span>月份：{month}</span>
          <span>列印日期：{new Date().toLocaleDateString('zh-TW')}</span>
        </div>
      </header>

      {/* 月度摘要 */}
      <section className="report-block">
        <h2 className="text-sm font-medium text-zinc-300 mb-2 print:text-base print:font-bold">
          摘要
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 print:border-zinc-300 print:bg-transparent">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <Stat label="本月總筆數" value={monthOrders.length} accent />
            <Stat label="尚未開始" value={progressSummary['尚未開始'] || 0} />
            <Stat label="設計中" value={progressSummary['設計中'] || 0} />
            <Stat label="已下單牙套" value={progressSummary['已下單牙套'] || 0} />
            <Stat label="診所收到" value={progressSummary['診所已收到牙套'] || 0} />
            <Stat label="已完成" value={progressSummary['已完成'] || 0} />
          </div>
        </div>
      </section>

      {/* 各技工所明細 */}
      {byLab.map(([labName, list]) => (
        <section key={labName} className="report-block break-inside-avoid">
          <h2 className="text-sm font-medium text-zinc-300 mb-2 print:text-base print:font-bold">
            技工所 — {labName} ({list.length} 筆)
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden print:border-zinc-300 print:bg-transparent">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-zinc-500 text-xs print:bg-zinc-100 print:text-zinc-700">
                <tr>
                  <th className="text-left font-medium px-3 py-2">日期</th>
                  <th className="text-left font-medium px-3 py-2">病歷號</th>
                  <th className="text-left font-medium px-3 py-2">姓名</th>
                  <th className="text-left font-medium px-3 py-2">醫師</th>
                  <th className="text-left font-medium px-3 py-2">批次</th>
                  <th className="text-left font-medium px-3 py-2">副數區間</th>
                  <th className="text-left font-medium px-3 py-2">進度</th>
                  <th className="text-left font-medium px-3 py-2">收件日</th>
                  <th className="text-left font-medium px-3 py-2">備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 print:divide-zinc-300">
                {list.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 tabular text-zinc-300 print:text-black">{o.date}</td>
                    <td className="px-3 py-2 tabular text-zinc-400 print:text-black">{o.patientChartNo}</td>
                    <td className="px-3 py-2 text-zinc-100 print:text-black whitespace-nowrap">{o.patientName}</td>
                    <td className="px-3 py-2 text-zinc-300 print:text-black whitespace-nowrap">{o.doctor || '—'}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500 print:text-zinc-700">{o.batchType || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-200 print:text-black">{o.alignerRange || '—'}</td>
                    <td className="px-3 py-2 text-xs text-zinc-300 print:text-black">{o.progress}</td>
                    <td className="px-3 py-2 tabular text-zinc-400 print:text-black">{o.actualDate || '—'}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500 print:text-zinc-700 max-w-[260px] truncate" title={o.notes}>
                      {o.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* 簽核欄 (只列印顯示) */}
      <section className="hidden print:block break-inside-avoid mt-12">
        <div className="grid grid-cols-3 gap-12 text-sm">
          <div>
            <div className="border-t border-zinc-700 mt-12 pt-1 text-center text-zinc-700">診所簽核</div>
          </div>
          <div>
            <div className="border-t border-zinc-700 mt-12 pt-1 text-center text-zinc-700">技工所簽核</div>
          </div>
          <div>
            <div className="border-t border-zinc-700 mt-12 pt-1 text-center text-zinc-700">日期</div>
          </div>
        </div>
      </section>

      {monthOrders.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center text-zinc-500 print:border-zinc-300 print:bg-transparent">
          {month} 沒有下單紀錄
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 print:text-zinc-700">{label}</div>
      <div className={`text-2xl font-semibold tabular print:text-black ${accent ? 'text-sky-300' : 'text-zinc-200'}`}>
        {value}
      </div>
    </div>
  );
}
