import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { seedIfEmpty, type SeedResult } from '../seed';

export default function DebugPanel() {
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  useEffect(() => {
    seedIfEmpty().then(setSeedResult);
  }, []);

  const stats = useLiveQuery(async () => {
    const all = await db.patients.toArray();
    const byStatus: Record<string, number> = {};
    const byProductLine: Record<string, number> = {};
    let withFlags = 0;
    let withNotes = 0;
    for (const p of all) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byProductLine[p.productLine] = (byProductLine[p.productLine] || 0) + 1;
      if (p.flags?.length) withFlags++;
      if (p.notes) withNotes++;
    }
    return { total: all.length, byStatus, byProductLine, withFlags, withNotes };
  });

  async function handleClearDb() {
    if (!confirm('確定要清空 IndexedDB？（dev 用，下次重整會重新匯入）')) return;
    await db.patients.clear();
    setSeedResult(null);
    location.reload();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">偵錯面板</h1>
        <p className="text-xs text-zinc-500 mt-1">IndexedDB 狀態與 seed 結果</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-zinc-200 font-medium">IndexedDB 狀態</h2>
          <button
            onClick={handleClearDb}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            清空 DB
          </button>
        </div>

        {seedResult && (
          <div className="text-sm">
            {seedResult.seeded ? (
              <span className="text-emerald-400">
                ✓ 已匯入 {seedResult.patientCount} 筆病患 ({seedResult.newPatients} 新增) + {seedResult.orderCount} 筆下單 + {seedResult.updates} 筆 patient 更新
              </span>
            ) : (
              <span className="text-zinc-400">
                {seedResult.reason === 'already-has-data' &&
                  `DB 已有資料 (${seedResult.count} 筆)，跳過匯入`}
                {seedResult.reason === 'no-seed-file' && '⚠️ 找不到 import JSON'}
                {seedResult.reason === 'error' && `❌ ${seedResult.error}`}
              </span>
            )}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Stat label="總筆數" value={stats.total} accent />
            <Stat label="有 flag" value={stats.withFlags} />
            <DistBlock title="按 status" map={stats.byStatus} />
            <DistBlock title="按 productLine" map={stats.byProductLine} />
          </div>
        )}
      </section>

      <p className="text-center text-xs text-zinc-600">
        打開 Chrome DevTools → Application → IndexedDB → aligner-tracker → patients 看實際資料
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`text-2xl font-semibold tabular ${accent ? 'text-sky-300' : 'text-zinc-200'}`}
      >
        {value}
      </div>
    </div>
  );
}

function DistBlock({ title, map }: { title: string; map: Record<string, number> }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3 col-span-2">
      <div className="text-xs text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1">
        {Object.entries(map)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-zinc-400">{k}</span>
              <span className="text-zinc-200 tabular">{v}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
