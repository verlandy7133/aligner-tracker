import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Patient } from '../types/Patient';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  PRODUCT_LINE_LABEL,
  PRODUCT_LINE_BADGE,
  FLAG_LABEL,
  FLAG_BADGE,
  calcAge,
  toROCDate,
} from '../labels';
import { deriveProgress } from '../lib/progress';
import PatientFormModal from '../components/PatientFormModal';

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editingTarget, setEditingTarget] = useState<Patient | 'new' | null>(null);

  const patient = useLiveQuery(async () => (id ? await db.patients.get(id) : undefined), [id]);
  const orders =
    useLiveQuery(
      async () => (id ? await db.orders.where('patientId').equals(id).toArray() : []),
      [id],
    ) ?? [];

  if (patient === undefined && id) {
    return <div className="p-6 text-zinc-400">載入中…</div>;
  }
  if (!patient) {
    return (
      <div className="p-6 space-y-3 text-center">
        <p className="text-zinc-400">找不到該病患</p>
        <Link to="/" className="text-sky-400 hover:text-sky-300">回病患列表</Link>
      </div>
    );
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const progress = deriveProgress(patient, todayISO);
  const age = calcAge(patient.birthday);
  const sortedOrders = [...orders].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-200">← 病患列表</Link>
          <h1 className="text-3xl font-semibold text-zinc-100 mt-1 flex items-center gap-3">
            <span className="text-zinc-500 tabular text-2xl">{patient.chartNo}</span>
            <span>{patient.name}</span>
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge className={PRODUCT_LINE_BADGE[patient.productLine]}>
              {PRODUCT_LINE_LABEL[patient.productLine]}
            </Badge>
            <Badge className={STATUS_BADGE[patient.status]}>{STATUS_LABEL[patient.status]}</Badge>
            {patient.doctor && (
              <Badge className="bg-zinc-700/30 text-zinc-300 border-zinc-700">
                醫師：{patient.doctor}
              </Badge>
            )}
            {patient.hasConsent ? (
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                ✓ 有授權書
              </Badge>
            ) : (
              <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">
                ✗ 無授權書
              </Badge>
            )}
            {patient.flags.map((f) => (
              <Badge key={f} className={FLAG_BADGE[f]}>
                {FLAG_LABEL[f]}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditingTarget(patient)}
            className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
          >
            ✎ 編輯
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 基本資料 */}
        <Card title="基本資料">
          <KV k="病歷號" v={patient.chartNo} />
          <KV k="姓名" v={patient.name} />
          <KV
            k="出生年月日"
            v={
              patient.birthday
                ? `${toROCDate(patient.birthday)} (西元 ${patient.birthday})`
                : '—'
            }
          />
          <KV k="年齡" v={age != null ? `${age} 歲` : '—'} />
          <KV k="主治醫師" v={patient.doctor ?? '—'} />
          <KV k="口掃資訊" v={patient.scanInfo ?? '—'} />
        </Card>

        {/* 治療資訊 */}
        <Card title="治療資訊">
          <KV k="品牌" v={PRODUCT_LINE_LABEL[patient.productLine]} />
          <KV k="狀態" v={STATUS_LABEL[patient.status]} />
          <KV k="授權書" v={patient.hasConsent ? '✓ 有' : '✗ 無'} />
          <KV k="下單日" v={patient.orderDate ?? '—'} />
          <KV k="開始戴第一副" v={patient.startDate ?? '—'} />
          <KV k="換套週期" v={`${patient.cycleDays} 天`} />
        </Card>

        {/* 副數進度 (含推算) */}
        <Card title="副數進度" className="md:col-span-2">
          <div className="grid grid-cols-2 gap-6">
            <JawProgressBlock label="上顎" jaw={progress.upper} />
            <JawProgressBlock label="下顎" jaw={progress.lower} />
          </div>
          {progress.isLagging && (
            <div className="mt-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠ 進度落後 — 預計到第 {progress.upper.expected ?? progress.lower.expected} 副，
              落後 {progress.worstLag} 副
            </div>
          )}
          {!progress.hasAnyData && (
            <p className="text-xs text-zinc-500 mt-3">尚未填總副數，無法推算進度</p>
          )}
        </Card>

        {/* 回診 */}
        <Card title="回診">
          <KV k="上次回診" v={patient.lastVisit ?? '—'} />
          <KV k="下次回診" v={patient.nextVisit ?? '—'} />
        </Card>

        {/* 備註 */}
        <Card title="備註">
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">
            {patient.notes || '（無）'}
          </p>
        </Card>
      </div>

      {/* 下單紀錄 */}
      <section>
        <h2 className="text-lg font-semibold text-zinc-100 mb-3">下單紀錄 ({orders.length})</h2>
        {orders.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900/30">
            無下單紀錄
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-zinc-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-3 py-2">日期</th>
                  <th className="text-left font-medium px-3 py-2">技工所</th>
                  <th className="text-left font-medium px-3 py-2">批次</th>
                  <th className="text-left font-medium px-3 py-2">副數區間</th>
                  <th className="text-left font-medium px-3 py-2">進度</th>
                  <th className="text-left font-medium px-3 py-2">收件日</th>
                  <th className="text-left font-medium px-3 py-2">備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {sortedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-zinc-800/30">
                    <td className="px-3 py-2 tabular text-zinc-300">{o.date}</td>
                    <td className="px-3 py-2 text-zinc-300">{o.lab}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{o.batchType || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-200">
                      {o.alignerRange || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-300">{o.progress}</td>
                    <td className="px-3 py-2 tabular text-zinc-400">
                      {o.actualDate ?? <span className="text-amber-400">未收</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 max-w-[280px] truncate" title={o.notes}>
                      {o.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 來源資料夾 */}
      {patient.sourceFolder && (
        <section className="text-xs text-zinc-500">
          <strong>來源資料夾：</strong>
          <code className="ml-2 font-mono break-all">{patient.sourceFolder}</code>
        </section>
      )}

      <PatientFormModal
        target={editingTarget}
        onClose={() => {
          setEditingTarget(null);
          // 編輯儲存後重新拉一次資料 (useLiveQuery 自動)
        }}
      />

      {/* 刪除後 navigate 回列表 */}
      {editingTarget === null && !patient && navigate('/')}
    </div>
  );
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 ${className}`}>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-zinc-500 text-xs">{k}</span>
      <span className="text-zinc-200 tabular">{v}</span>
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

function JawProgressBlock({ label, jaw }: { label: string; jaw: import('../lib/progress').JawProgress }) {
  if (jaw.total == null && jaw.current == null) {
    return (
      <div>
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="text-zinc-700 mt-1">—</div>
      </div>
    );
  }
  const pct = jaw.progressPercent ?? 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span>{jaw.progressPercent != null ? `${jaw.progressPercent}%` : ''}</span>
      </div>
      <div className="text-2xl font-semibold tabular text-zinc-100 mt-1">
        {jaw.current ?? '—'}
        <span className="text-zinc-500 text-base"> / {jaw.total ?? '—'}</span>
      </div>
      {jaw.total != null && jaw.current != null && (
        <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-sky-500 rounded-full transition-all"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      <div className="mt-2 text-xs space-y-0.5">
        {jaw.expected != null && (
          <div className="text-zinc-400">
            預計到第 <span className="text-zinc-200 tabular">{jaw.expected}</span> 副
            {jaw.lag != null && jaw.lag >= 2 && (
              <span className="text-rose-400 ml-2">↘ 落後 {jaw.lag} 副</span>
            )}
            {jaw.lag != null && jaw.lag <= -1 && (
              <span className="text-emerald-400 ml-2">↗ 超前 {Math.abs(jaw.lag)} 副</span>
            )}
          </div>
        )}
        {jaw.estimatedEndDate && (
          <div className="text-zinc-500">
            預計完成 {jaw.estimatedEndDate}
            {jaw.daysToEnd != null && (
              <span className="ml-1">
                ({jaw.daysToEnd > 0 ? `還有 ${jaw.daysToEnd} 天` : `已過 ${-jaw.daysToEnd} 天`})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
