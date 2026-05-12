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
  TRACK_LABEL,
  TRACK_BADGE,
  REFINEMENT_LABEL,
  REFINEMENT_BADGE,
  FLAG_LABEL,
  FLAG_BADGE,
  calcAge,
  toROCDate,
} from '../labels';
import { deriveProgress } from '../lib/progress';
import PatientFormModal from '../components/PatientFormModal';
import PatientNotesSection from '../components/PatientNotesSection';
import { callHelper, findAndOpenPdf, createFolder, describeHelperFailure } from '../lib/helper-client';
import { READ_ONLY } from '../lib/read-only';

// 把西元 birthday (YYYY-MM-DD) 轉成民國格式 (民國YYMMDD 或 民國YYYMMDD)
// 例：1993-11-02 → 821102；2015-12-07 → 1041207
function birthdayToROCFolder(birthday: string | null): string | null {
  if (!birthday) return null;
  const m = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const rocYear = parseInt(m[1], 10) - 1911;
  if (rocYear < 1) return null;
  return `${rocYear}${m[2]}${m[3]}`;
}

// 推算病患資料夾的 conventional path（無前綴的 active 命名）
// 路徑樣本：D:\矯正\病患資料夾\821102嚴家彬
function deriveConventionalSourceFolder(birthday: string | null, name: string): string | null {
  const roc = birthdayToROCFolder(birthday);
  if (!roc || !name) return null;
  return `D:\\矯正\\病患資料夾\\${roc}${name}`;
}

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
            {patient.track && (
              <Badge className={TRACK_BADGE[patient.track]}>{TRACK_LABEL[patient.track]}</Badge>
            )}
            {patient.refinementLevel >= 1 && patient.refinementLevel <= 3 && (
              <Badge className={REFINEMENT_BADGE[patient.refinementLevel as 1 | 2 | 3]}>
                {REFINEMENT_LABEL[patient.refinementLevel as 1 | 2 | 3]}
              </Badge>
            )}
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* readOnly mode：所有 mutation 按鈕 + 開檔按鈕都隱藏（iPad 上沒 file://、helper service 也不存在） */}
          {!READ_ONLY && (() => {
            // 優先用 patient.sourceFolder，沒有就 derive conventional path（需要生日）
            const derived = deriveConventionalSourceFolder(patient.birthday, patient.name);
            const effectiveFolder = patient.sourceFolder || derived;
            return (
              <button
                onClick={async () => {
                  // 沒生日 + 沒 sourceFolder → 無法 derive path
                  if (!effectiveFolder) {
                    alert('要先填生日才能建立資料夾。請點「✎ 編輯」補上生日後再試。');
                    return;
                  }
                  // 1. 先 try open
                  const r1 = await callHelper('open-folder', effectiveFolder);
                  if (r1.state === 'opened') return;
                  // 2. helper down → alert
                  if (r1.state === 'helper-down') {
                    alert(describeHelperFailure(r1));
                    return;
                  }
                  // 3. 不存在 → 詢問是否建立
                  const isNotFound = r1.message?.includes('not found');
                  if (!isNotFound) {
                    alert(describeHelperFailure(r1));
                    return;
                  }
                  if (!confirm(`資料夾不存在，要建立嗎？\n\n${effectiveFolder}`)) return;
                  // 4. 建立
                  const c = await createFolder(effectiveFolder);
                  if (c.state === 'helper-down' || c.state === 'error') {
                    alert(c.state === 'helper-down' ? '本機 helper 沒回應' : `建立失敗：${c.message}`);
                    return;
                  }
                  // 5. 持久化 sourceFolder 到 IndexedDB（下次點不用再問）
                  if (!patient.sourceFolder) {
                    await db.patients.update(patient.id, { sourceFolder: effectiveFolder });
                  }
                  // 6. 開新建好的資料夾
                  await callHelper('open-folder', effectiveFolder);
                }}
                className="px-3 py-2 rounded-md text-sm border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition"
                title={
                  patient.sourceFolder
                    ? effectiveFolder ?? ''
                    : effectiveFolder
                      ? `${effectiveFolder}（未建立、點下去建立）`
                      : '需要先填生日'
                }
              >
                📁 {patient.sourceFolder ? '開資料夾' : '建立 / 開資料夾'}
              </button>
            );
          })()}
          {patient.hasConsent && patient.consentPdfPath && (
            <button
              onClick={async () => {
                const r = await callHelper('open-file', patient.consentPdfPath!);
                const msg = describeHelperFailure(r);
                if (msg) alert(msg);
              }}
              className="px-3 py-2 rounded-md text-sm border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition"
              title={patient.consentPdfPath}
            >
              📄 開授權書
            </button>
          )}
          {patient.sourceFolder && (
            <button
              onClick={async () => {
                const r = await findAndOpenPdf(patient.sourceFolder, '指示單');
                const msg = describeHelperFailure(r);
                if (msg) alert(msg);
              }}
              className="px-3 py-2 rounded-md text-sm border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 transition"
              title={`在 ${patient.sourceFolder} 找含「指示單」的 PDF`}
            >
              📋 開指示單
            </button>
          )}
          {!READ_ONLY && (
            <button
              onClick={() => setEditingTarget(patient)}
              className="px-3 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
            >
              ✎ 編輯
            </button>
          )}
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
          {/* 療程時間摘要：一副週期 + 已進行 + 剩餘 + 預計總月份 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pb-3 border-b border-zinc-800/60">
            <Stat label="一副要帶" value={`${progress.cycleDays} 天`} />
            <Stat
              label="已進行"
              value={progress.monthsElapsed != null ? `${progress.monthsElapsed} 個月` : '—'}
              hint={progress.monthsElapsed == null ? '需現在副數' : undefined}
            />
            <Stat
              label="剩餘"
              value={progress.monthsRemaining != null ? `${progress.monthsRemaining} 個月` : '—'}
              hint={progress.monthsRemaining == null ? '需總副數' : undefined}
            />
            <Stat
              label="預計總療程"
              value={progress.totalMonths != null ? `${progress.totalMonths} 個月` : '—'}
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <JawProgressBlock label="上顎" jaw={progress.upper} />
            <JawProgressBlock label="下顎" jaw={progress.lower} />
          </div>
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

      {/* 病患筆記 + 8-slot 病歷照片
          readOnly mode (iPad)：在這顯示給看
          master mode：移到 ✎ 編輯 modal 內、避免兩處 entry 混亂 */}
      {READ_ONLY && <PatientNotesSection patient={patient} />}

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

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="text-base font-semibold tabular text-zinc-100 mt-0.5" title={hint}>
        {value}
      </span>
      {hint && <span className="text-[10px] text-zinc-600 mt-0.5">{hint}</span>}
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
