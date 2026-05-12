// 病歷照片 + 病患筆記 整合 section
//
// v0.1.10 變更：
//   - 順序：照片在上、筆記在下（v0.1.9 是反的）
//   - 12-slot：人像 (4) + X-ray (2) + 口外 (2) + 口內 (4)、按 group 分區
//   - 每張照片可編輯（rotate 90°/180°/270° + 水平/垂直翻轉、純前端 CSS transform 不動原檔）
//   - photos value 升級成 PhotoMeta object
//
// 照片來源：patient.sourceFolder 底下（透過 helper /list-folder-files 列出）
// 顯示：透過 helper /serve-image 串 image binary

import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import type { Patient, PhotoMeta, PhotoSlot, PhotoSlotGroup } from '../types/Patient';
import { PHOTO_SLOTS, PHOTO_GROUP_LABEL } from '../types/Patient';
import {
  listFolderFiles,
  getImageUrl,
  checkAnthropicKey,
  classifyPhotos,
  type PhotoClassification,
} from '../lib/helper-client';
import { PHOTO_BORDER_STYLE } from '../lib/photo-style';
import { READ_ONLY } from '../lib/read-only';

export default function PatientNotesSection({ patient }: { patient: Patient }) {
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    if (READ_ONLY) return;
    checkAnthropicKey().then((r) => setHasAnthropicKey(r.configured));
  }, []);

  const canAiFill = hasAnthropicKey && !READ_ONLY && !!patient.sourceFolder;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">📋 病歷照片 / 筆記</h2>
        {canAiFill && (
          <button
            onClick={() => setAiOpen(true)}
            className="px-3 py-1.5 rounded-md text-xs bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 transition"
            title="用 Claude vision 自動分析資料夾內所有照片、配對到 slot"
          >
            🤖 一鍵填入
          </button>
        )}
      </header>
      <div className="p-5 space-y-6">
        <PhotoSlotGrid patient={patient} />
        <MarkdownNoteEditor patient={patient} />
      </div>
      {aiOpen && (
        <PhotoAIPickerModal patient={patient} onClose={() => setAiOpen(false)} />
      )}
    </section>
  );
}

/* ─── AI 一鍵填入 modal（Claude vision 自動分類）────── */
function PhotoAIPickerModal({
  patient,
  onClose,
}: {
  patient: Patient;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'result' | 'applying' | 'done' | 'error'>('loading');
  const [mappings, setMappings] = useState<PhotoClassification[]>([]);
  const [picks, setPicks] = useState<Record<string, PhotoSlot | 'skip'>>({});
  const [usage, setUsage] = useState<{ input_tokens?: number; output_tokens?: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await classifyPhotos(patient.sourceFolder);
      if (cancelled) return;
      if (r.state === 'ok') {
        setMappings(r.mappings);
        setUsage(r.usage ?? null);
        setWarnings(r.warnings ?? []);
        // 預設 picks：confidence > 0.5 用 Claude 建議、否則 skip
        const initialPicks: Record<string, PhotoSlot | 'skip'> = {};
        const usedSlots = new Set<string>();
        for (const c of r.mappings) {
          if (c.slot !== 'unknown' && c.confidence > 0.5 && !usedSlots.has(c.slot)) {
            initialPicks[c.filename] = c.slot as PhotoSlot;
            usedSlots.add(c.slot);
          } else {
            initialPicks[c.filename] = 'skip';
          }
        }
        setPicks(initialPicks);
        setPhase('result');
      } else if (r.state === 'no-key') {
        setError('Anthropic API key 未設定 — ' + r.hint);
        setPhase('error');
      } else if (r.state === 'helper-down') {
        setError('helper 沒回應');
        setPhase('error');
      } else {
        setError(r.message + (r.detail ? '\n\n' + r.detail : ''));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patient.sourceFolder]);

  async function applyPicks() {
    setPhase('applying');
    const nextPhotos: Partial<Record<PhotoSlot, PhotoMeta>> = { ...(patient.photos || {}) };
    for (const [filename, slot] of Object.entries(picks)) {
      if (slot === 'skip') continue;
      // 保留既有 PhotoMeta 的 transform 設定（rotate/scale/brightness）、只改 filename
      const existing = nextPhotos[slot as PhotoSlot];
      nextPhotos[slot as PhotoSlot] = existing
        ? { ...existing, filename }
        : { filename };
    }
    await db.patients.update(patient.id, {
      photos: nextPhotos,
      updatedAt: new Date().toISOString(),
    });
    setPhase('done');
    setTimeout(onClose, 1200);
  }

  // 計算「會套用幾筆 / skip 幾筆」
  const stats = (() => {
    let assigned = 0;
    let skipped = 0;
    for (const v of Object.values(picks)) {
      if (v === 'skip') skipped++;
      else assigned++;
    }
    return { assigned, skipped };
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">🤖 AI 一鍵填入</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Claude Haiku 4.5 vision · 病患資料夾：<code className="font-mono">{patient.sourceFolder}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'applying'}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="text-violet-400 text-2xl animate-pulse">🤖</div>
              <p className="text-sm text-zinc-300">Claude 正在分析照片…（10-30 秒）</p>
              <p className="text-xs text-zinc-500">把照片丟給 Claude vision、判斷每張該配對到哪個 slot</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="px-3 py-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm whitespace-pre-wrap">
              ⚠️ {error}
            </div>
          )}

          {phase === 'done' && (
            <div className="px-3 py-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
              ✓ 套用完成、{stats.assigned} 個 slot 已填入。視窗即將關閉…
            </div>
          )}

          {(phase === 'result' || phase === 'applying') && (
            <div className="space-y-3">
              {warnings.length > 0 && (
                <div className="px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                  {warnings.map((w, i) => (
                    <div key={i}>⚠️ {w}</div>
                  ))}
                </div>
              )}
              <div className="text-xs text-zinc-400">
                Claude 分析了 {mappings.length} 張照片。會套用：
                <span className="text-emerald-400 ml-1">{stats.assigned} 個</span>
                · 跳過：<span className="text-zinc-500 ml-1">{stats.skipped}</span>
                {usage && (
                  <span className="text-zinc-600 ml-3">
                    （用了 {usage.input_tokens} input + {usage.output_tokens} output tokens、約 NT$
                    {(((usage.input_tokens ?? 0) * 0.8 + (usage.output_tokens ?? 0) * 4) / 1000000 * 30).toFixed(2)}）
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {mappings.map((m) => {
                  const fullPath = `${patient.sourceFolder}\\${m.filename}`;
                  const currentPick = picks[m.filename] ?? 'skip';
                  return (
                    <div key={m.filename} className="rounded-md border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                      <div className="aspect-[4/3] bg-zinc-950">
                        <img
                          src={getImageUrl(fullPath)}
                          alt={m.filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.3')}
                        />
                      </div>
                      <div className="p-2 space-y-1">
                        <div className="text-[10px] text-zinc-500 font-mono truncate" title={m.filename}>
                          {m.filename}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          建議：<strong className="text-violet-300">{m.slot}</strong>{' '}
                          <span className="text-zinc-600">({Math.round(m.confidence * 100)}%)</span>
                        </div>
                        <div className="text-[10px] text-zinc-600 line-clamp-2">{m.reason}</div>
                        <select
                          value={currentPick}
                          onChange={(e) =>
                            setPicks((p) => ({
                              ...p,
                              [m.filename]: e.target.value as PhotoSlot | 'skip',
                            }))
                          }
                          disabled={phase === 'applying'}
                          className="w-full h-7 px-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
                        >
                          <option value="skip">— 跳過 —</option>
                          {PHOTO_SLOTS.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-500">
            套用 = 覆寫對應 slot 的綁定（旋轉/縮放/亮度設定保留）。下拉選 「跳過」不套用。
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={phase === 'applying'}
              className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              {phase === 'done' ? '關閉' : '取消'}
            </button>
            {phase === 'result' && (
              <button
                onClick={applyPicks}
                disabled={stats.assigned === 0}
                className="px-3 py-1.5 rounded-md text-xs bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 transition disabled:opacity-50"
              >
                ⚡ 套用（{stats.assigned} 個）
              </button>
            )}
            {phase === 'applying' && (
              <button
                disabled
                className="px-3 py-1.5 rounded-md text-xs bg-violet-500/15 border border-violet-500/40 text-violet-300 disabled:opacity-70"
              >
                ⏳ 套用中…
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─── 14-slot 病歷照片 grid（按 group 分區）──────── */
const PORTRAIT_SIZE_KEY = 'aligner-portrait-size'; // localStorage key (人像區尺寸)
const TEETH_SIZE_KEY = 'aligner-teeth-size'; // localStorage key (牙齒區尺寸)

function loadSizeFromStorage(key: string): number {
  const stored = localStorage.getItem(key);
  const n = stored ? parseInt(stored, 10) : NaN;
  return !isNaN(n) && n >= 50 && n <= 100 ? n : 100;
}

function PhotoSlotGrid({ patient }: { patient: Patient }) {
  const [picker, setPicker] = useState<{ slot: PhotoSlot; label: string } | null>(null);
  const [editor, setEditor] = useState<{ slot: PhotoSlot; label: string; meta: PhotoMeta } | null>(null);
  // 左右獨立尺寸 slider — 各 50%~100%，存 localStorage 跨 session 沿用
  const [portraitSize, setPortraitSize] = useState<number>(() => loadSizeFromStorage(PORTRAIT_SIZE_KEY));
  const [teethSize, setTeethSize] = useState<number>(() => loadSizeFromStorage(TEETH_SIZE_KEY));
  function savePortraitSize(n: number) {
    setPortraitSize(n);
    localStorage.setItem(PORTRAIT_SIZE_KEY, String(n));
  }
  function saveTeethSize(n: number) {
    setTeethSize(n);
    localStorage.setItem(TEETH_SIZE_KEY, String(n));
  }

  // 按 group 分組
  const byGroup = useMemo(() => {
    const map: Record<PhotoSlotGroup, typeof PHOTO_SLOTS> = {
      portrait: [],
      xray: [],
      extraoral: [],
      intraoral: [],
    };
    for (const s of PHOTO_SLOTS) map[s.group].push(s);
    return map;
  }, []);

  if (!patient.sourceFolder) {
    return (
      <div>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-2">病歷照片</h3>
        <div className="px-4 py-6 text-center text-xs text-zinc-500 bg-zinc-950/40 border border-dashed border-zinc-800 rounded-md">
          ⚠️ 病患沒設定資料夾。點上方「📁 開資料夾」或「✎ 編輯」設定 sourceFolder 後才能放照片。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
          病歷照片
          <span className="ml-2 text-[10px] text-zinc-600 normal-case tracking-normal">
            來源：<code>{patient.sourceFolder}</code>
          </span>
          <span className="ml-2 text-[10px] text-zinc-600 normal-case tracking-normal">
            · 單張照片獨立縮放：點 ✎ 開編輯 modal
          </span>
        </h3>
      </div>
      {/* 左半（人像、寬一點）| 右半（牙齒系列、窄一點）— 各自帶獨立 size slider */}
      <div className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-4">
        {/* Left: portrait 框框 — 框線粗細/顏色 走 CSS variable (設定可改) */}
        <div className="rounded-lg bg-zinc-950/40 p-4" style={PHOTO_BORDER_STYLE}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs text-zinc-200 font-semibold flex items-center gap-2">
              <span className="text-base">🙂</span>
              <span>{PHOTO_GROUP_LABEL.portrait}</span>
              <span className="text-[10px] text-zinc-500 font-normal">（{byGroup.portrait.length}）</span>
            </div>
            <SizeSlider value={portraitSize} onChange={savePortraitSize} title="調整人像區尺寸" />
          </div>
          <div className="grid grid-cols-2 gap-3 items-start" style={{ maxWidth: `${portraitSize}%` }}>
            {byGroup.portrait.map((slot) => (
              <PhotoSlotCell
                key={slot.key}
                patient={patient}
                slotKey={slot.key}
                slotLabel={slot.label}
                meta={patient.photos?.[slot.key]}
                onPickClick={() => setPicker({ slot: slot.key, label: slot.label })}
                onEditClick={(meta) => setEditor({ slot: slot.key, label: slot.label, meta })}
              />
            ))}
          </div>
        </div>

        {/* Right: 牙齒系列框框 — 框線走 CSS variable */}
        <div className="rounded-lg bg-zinc-950/40 p-4 space-y-4" style={PHOTO_BORDER_STYLE}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-zinc-200 font-semibold flex items-center gap-2">
              <span className="text-base">🦷</span>
              <span>牙齒</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                （{byGroup.xray.length + byGroup.extraoral.length + byGroup.intraoral.length}）
              </span>
            </div>
            <SizeSlider value={teethSize} onChange={saveTeethSize} title="調整牙齒區尺寸" />
          </div>
          <div style={{ maxWidth: `${teethSize}%` }} className="space-y-4">
            {(['xray', 'extraoral', 'intraoral'] as PhotoSlotGroup[]).map((group) => (
              <div key={group}>
                <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">
                  {PHOTO_GROUP_LABEL[group]}（{byGroup[group].length}）
                </div>
                <div className="grid grid-cols-2 gap-2 items-start">
                  {byGroup[group].map((slot) => (
                    <PhotoSlotCell
                      key={slot.key}
                      patient={patient}
                      slotKey={slot.key}
                      slotLabel={slot.label}
                      meta={patient.photos?.[slot.key]}
                      onPickClick={() => setPicker({ slot: slot.key, label: slot.label })}
                      onEditClick={(meta) => setEditor({ slot: slot.key, label: slot.label, meta })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {picker && (
        <PhotoPickerModal
          patient={patient}
          slot={picker.slot}
          slotLabel={picker.label}
          onClose={() => setPicker(null)}
        />
      )}
      {editor && (
        <PhotoEditorModal
          patient={patient}
          slot={editor.slot}
          slotLabel={editor.label}
          initialMeta={editor.meta}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

/* ─── 計算 CSS transform 給 <img> 套用 ──────────────── */
function buildPhotoTransform(meta: PhotoMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];

  // 裁切（最後 apply、視為「對 transformed img 進行裁切」）
  // CSS transform 從右到左 apply、所以 crop 寫在最前面字串、最後 apply
  const cropTop = meta.cropTop ?? 0;
  const cropBottom = meta.cropBottom ?? 0;
  const cropLeft = meta.cropLeft ?? 0;
  const cropRight = meta.cropRight ?? 0;
  const visibleW = 1 - cropLeft - cropRight;
  const visibleH = 1 - cropTop - cropBottom;
  if (visibleW > 0.05 && visibleH > 0.05 && (cropTop || cropBottom || cropLeft || cropRight)) {
    // 1. 把 cell 內的視野 scale 起來、保留區域撐滿
    const cropScaleX = 1 / visibleW;
    const cropScaleY = 1 / visibleH;
    // 2. translate 把保留區域中心移到 cell 中心
    //    保留區域中心相對 img 中心的偏移（百分比、img own dimension）
    const cropOffsetXPct = ((cropRight - cropLeft) / 2) * 100;
    const cropOffsetYPct = ((cropBottom - cropTop) / 2) * 100;
    parts.push(`scale(${cropScaleX}, ${cropScaleY})`);
    parts.push(`translate(${cropOffsetXPct}%, ${cropOffsetYPct}%)`);
  }

  // 順序：rotate → flipH → flipV → displayScale (等比) → imageStretchX/Y (非等比)
  if (meta.rotate) parts.push(`rotate(${meta.rotate}deg)`);
  if (meta.flipH) parts.push('scaleX(-1)');
  if (meta.flipV) parts.push('scaleY(-1)');
  if (meta.displayScale && meta.displayScale !== 1) parts.push(`scale(${meta.displayScale})`);
  if (meta.imageStretchX && meta.imageStretchX !== 1) parts.push(`scaleX(${meta.imageStretchX})`);
  if (meta.imageStretchY && meta.imageStretchY !== 1) parts.push(`scaleY(${meta.imageStretchY})`);
  return parts.join(' ');
}

/* ─── 計算 CSS filter 給 <img> 套用（亮度等）──────── */
function buildPhotoFilter(meta: PhotoMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.brightness && meta.brightness !== 1) parts.push(`brightness(${meta.brightness})`);
  return parts.join(' ');
}

/* ─── 共用 size slider component ──────────────────── */
function SizeSlider({
  value,
  onChange,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-zinc-500">尺寸</span>
      <input
        type="range"
        min={50}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-sky-500"
        title={title}
      />
      <span className="text-[10px] text-zinc-400 tabular w-8 text-right">{value}%</span>
      {value !== 100 && (
        <button
          onClick={() => onChange(100)}
          className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1 py-0.5 rounded hover:bg-zinc-800 transition"
          title="重設 100%"
        >
          ⟲
        </button>
      )}
    </div>
  );
}

function PhotoSlotCell({
  patient,
  slotKey,
  slotLabel,
  meta,
  onPickClick,
  onEditClick,
}: {
  patient: Patient;
  slotKey: PhotoSlot;
  slotLabel: string;
  meta: PhotoMeta | undefined;
  onPickClick: () => void;
  onEditClick: (meta: PhotoMeta) => void;
}) {
  const fullPath = meta ? `${patient.sourceFolder}\\${meta.filename}` : null;
  const imageUrl = fullPath ? getImageUrl(fullPath) : null;
  const transform = buildPhotoTransform(meta);
  const filter = buildPhotoFilter(meta);
  // 旋轉 90/270 時、aspect 變橫長 → 圖會被 4:3 框裁掉、加 scale 補救
  const isQuarterRotate = meta?.rotate === 90 || meta?.rotate === 270;
  const [isDragOver, setIsDragOver] = useState(false);

  async function removePhoto() {
    if (!confirm(`移除 ${slotLabel} 的照片連結？\n（檔案不會刪除、只是 App 內取消綁定）`)) return;
    const nextPhotos = { ...(patient.photos || {}) };
    delete nextPhotos[slotKey];
    await db.patients.update(patient.id, {
      photos: nextPhotos,
      updatedAt: new Date().toISOString(),
    });
  }

  // ─── HTML5 drag and drop：拖一個 slot 的照片到另一個、互換 ──
  function handleDragStart(e: React.DragEvent) {
    if (READ_ONLY || !meta) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('aligner/slot', slotKey);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent) {
    if (READ_ONLY) return;
    if (!e.dataTransfer.types.includes('aligner/slot')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }
  function handleDragLeave() {
    setIsDragOver(false);
  }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const sourceSlot = e.dataTransfer.getData('aligner/slot') as PhotoSlot;
    if (!sourceSlot || sourceSlot === slotKey) return;
    // Swap source & target slot meta（含 rotate/scale/brightness 設定）
    const photos = patient.photos || {};
    const sourceMeta = photos[sourceSlot];
    const targetMeta = photos[slotKey];
    const next: Partial<Record<PhotoSlot, PhotoMeta>> = { ...photos };
    if (sourceMeta) next[slotKey] = sourceMeta;
    else delete next[slotKey];
    if (targetMeta) next[sourceSlot] = targetMeta;
    else delete next[sourceSlot];
    await db.patients.update(patient.id, {
      photos: next,
      updatedAt: new Date().toISOString(),
    });
  }

  const dragOverRing = isDragOver
    ? { boxShadow: '0 0 0 3px rgb(56 189 248 / 0.6), 0 0 16px rgb(56 189 248 / 0.4)' }
    : {};

  if (!imageUrl || !meta) {
    // readOnly mode：空 slot 顯示「—」、不能點選
    if (READ_ONLY) {
      return (
        <div
          style={{ ...PHOTO_BORDER_STYLE, borderStyle: 'dashed' }}
          className="aspect-[4/3] rounded-md bg-zinc-950/40 flex flex-col items-center justify-center gap-1 text-zinc-600"
        >
          <span className="text-[11px] text-center px-2">{slotLabel}</span>
          <span className="text-[10px]">—</span>
        </div>
      );
    }
    return (
      <button
        onClick={onPickClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ ...PHOTO_BORDER_STYLE, borderStyle: 'dashed', ...dragOverRing }}
        className={`aspect-[4/3] rounded-md bg-zinc-950/40 hover:bg-sky-500/5 transition flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-sky-400 group ${
          isDragOver ? 'bg-sky-500/10' : ''
        }`}
      >
        <span className="text-2xl opacity-50 group-hover:opacity-100">＋</span>
        <span className="text-[11px] text-center px-2">{slotLabel}</span>
      </button>
    );
  }

  return (
    <div
      className={`relative aspect-[4/3] rounded-md overflow-hidden bg-zinc-950 group ${
        !READ_ONLY ? 'cursor-move' : ''
      }`}
      style={{ ...PHOTO_BORDER_STYLE, ...dragOverRing }}
      draggable={!READ_ONLY}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <img
        src={imageUrl}
        alt={slotLabel}
        draggable={false}
        className="w-full h-full object-cover transition-transform pointer-events-none"
        style={{
          transform,
          filter,
          // 旋轉 90/270 時調 scale 避免邊緣裁切（簡化版：縮小一點點容下橫長圖）
          ...(isQuarterRotate ? { scale: '0.75' } : {}),
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 py-1 pointer-events-none">
        <div className="text-[10px] text-white font-medium">{slotLabel}</div>
        <div className="text-[9px] text-white/60 truncate font-mono">{meta.filename}</div>
      </div>
      {/* readOnly mode 隱藏 hover actions（編輯/換/移除）*/}
      {!READ_ONLY && (
        <div className="absolute inset-x-0 top-0 px-1 py-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={() => onEditClick(meta)}
            title="編輯（旋轉 / 翻轉）"
            className="px-1.5 py-0.5 text-[10px] rounded bg-violet-900/90 text-violet-200 hover:bg-violet-800 border border-violet-700"
          >
            ✎
          </button>
          <button
            onClick={onPickClick}
            title="換照片"
            className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-900/90 text-zinc-200 hover:bg-zinc-800 border border-zinc-700"
          >
            換
          </button>
          <button
            onClick={removePhoto}
            title="移除"
            className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/80 text-rose-200 hover:bg-rose-800 border border-rose-700"
          >
            ✗
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── 照片編輯 modal（rotate + flip）─────────────── */
function PhotoEditorModal({
  patient,
  slot,
  slotLabel,
  initialMeta,
  onClose,
}: {
  patient: Patient;
  slot: PhotoSlot;
  slotLabel: string;
  initialMeta: PhotoMeta;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<PhotoMeta>(initialMeta);
  const fullPath = `${patient.sourceFolder}\\${meta.filename}`;
  const transform = buildPhotoTransform(meta);
  const filter = buildPhotoFilter(meta);

  function rotate(delta: 90 | -90) {
    const cur = meta.rotate ?? 0;
    const next = (((cur + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    setMeta({ ...meta, rotate: next });
  }
  function toggleFlipH() {
    setMeta({ ...meta, flipH: !meta.flipH });
  }
  function toggleFlipV() {
    setMeta({ ...meta, flipV: !meta.flipV });
  }
  function setDisplayScale(scale: number) {
    setMeta({ ...meta, displayScale: scale });
  }
  function setBrightness(b: number) {
    setMeta({ ...meta, brightness: b });
  }
  function setImageStretchX(s: number) {
    setMeta({ ...meta, imageStretchX: s });
  }
  function setImageStretchY(s: number) {
    setMeta({ ...meta, imageStretchY: s });
  }
  function setCrop(side: 'cropTop' | 'cropBottom' | 'cropLeft' | 'cropRight', v: number) {
    setMeta({ ...meta, [side]: v });
  }
  function resetCrop() {
    setMeta({ ...meta, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 });
  }
  function reset() {
    setMeta({ filename: meta.filename }); // 清掉所有 transform
  }

  async function save() {
    await db.patients.update(patient.id, {
      photos: { ...(patient.photos || {}), [slot]: meta },
      updatedAt: new Date().toISOString(),
    });
    onClose();
  }

  const dirty =
    meta.rotate !== initialMeta.rotate ||
    meta.flipH !== initialMeta.flipH ||
    meta.flipV !== initialMeta.flipV ||
    (meta.displayScale ?? 1) !== (initialMeta.displayScale ?? 1) ||
    (meta.brightness ?? 1) !== (initialMeta.brightness ?? 1) ||
    (meta.imageStretchX ?? 1) !== (initialMeta.imageStretchX ?? 1) ||
    (meta.imageStretchY ?? 1) !== (initialMeta.imageStretchY ?? 1) ||
    (meta.cropTop ?? 0) !== (initialMeta.cropTop ?? 0) ||
    (meta.cropBottom ?? 0) !== (initialMeta.cropBottom ?? 0) ||
    (meta.cropLeft ?? 0) !== (initialMeta.cropLeft ?? 0) ||
    (meta.cropRight ?? 0) !== (initialMeta.cropRight ?? 0);

  const currentScale = meta.displayScale ?? 1;
  const currentBrightness = meta.brightness ?? 1;
  const currentStretchX = meta.imageStretchX ?? 1;
  const currentStretchY = meta.imageStretchY ?? 1;
  const cropTop = meta.cropTop ?? 0;
  const cropBottom = meta.cropBottom ?? 0;
  const cropLeft = meta.cropLeft ?? 0;
  const cropRight = meta.cropRight ?? 0;
  const hasCrop = cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">編輯 — {slotLabel}</h3>
            <p className="text-xs text-zinc-500 mt-1 font-mono">{meta.filename}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
          >
            ×
          </button>
        </header>
        <div className="p-6">
          {/* preview */}
          <div className="aspect-[4/3] bg-zinc-900 rounded-md overflow-hidden flex items-center justify-center mb-4 border border-zinc-800">
            <img
              src={getImageUrl(fullPath)}
              alt={slotLabel}
              className="max-w-full max-h-full object-contain transition-transform"
              style={{ transform, filter }}
            />
          </div>
          {/* toolbar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={() => rotate(-90)}
              className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition"
              title="逆時針 90°"
            >
              ↺ 90°
            </button>
            <button
              onClick={() => rotate(90)}
              className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition"
              title="順時針 90°"
            >
              ↻ 90°
            </button>
            <button
              onClick={toggleFlipH}
              className={`px-3 py-2 rounded-md text-sm border transition ${
                meta.flipH
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800'
              }`}
              title="水平翻轉"
            >
              ⇋ 水平
            </button>
            <button
              onClick={toggleFlipV}
              className={`px-3 py-2 rounded-md text-sm border transition ${
                meta.flipV
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800'
              }`}
              title="垂直翻轉"
            >
              ⇵ 垂直
            </button>
            <button
              onClick={reset}
              disabled={
                !meta.rotate &&
                !meta.flipH &&
                !meta.flipV &&
                currentScale === 1 &&
                currentBrightness === 1 &&
                currentStretchX === 1 &&
                currentStretchY === 1 &&
                !hasCrop
              }
              className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition disabled:opacity-40"
              title="清掉所有編輯"
            >
              ⟲ 還原
            </button>
          </div>
          {/* 縮放 slider — 0.5x ~ 2.0x */}
          <div className="mt-4 flex items-center gap-3 px-1">
            <span className="text-xs text-zinc-400 font-medium w-12">縮放</span>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={currentScale}
              onChange={(e) => setDisplayScale(Number(e.target.value))}
              className="flex-1 accent-sky-500"
              title="這張照片在 cell 內的視覺縮放（不動原檔）"
            />
            <span className="tabular text-xs text-zinc-300 w-12 text-right">{Math.round(currentScale * 100)}%</span>
            {currentScale !== 1 && (
              <button
                onClick={() => setDisplayScale(1)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                title="重設 100%"
              >
                ⟲
              </button>
            )}
          </div>
          {/* 照片寬度 slider — img scaleX（cell 不動、非等比）*/}
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-xs text-zinc-400 font-medium w-12">照片寬度</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.05}
              value={currentStretchX}
              onChange={(e) => setImageStretchX(Number(e.target.value))}
              className="flex-1 accent-cyan-500"
              title="img 水平 scaleX (X 軸非等比拉伸)"
            />
            <span className="tabular text-xs text-zinc-300 w-16 text-right">
              {Math.round(currentStretchX * 100)}%
            </span>
            {currentStretchX !== 1 && (
              <button
                onClick={() => setImageStretchX(1)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                title="重設 100%"
              >
                ⟲
              </button>
            )}
          </div>
          {/* 照片高度 slider — img scaleY（Y 軸非等比）*/}
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-xs text-zinc-400 font-medium w-12">照片高度</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.05}
              value={currentStretchY}
              onChange={(e) => setImageStretchY(Number(e.target.value))}
              className="flex-1 accent-cyan-500"
              title="img 垂直 scaleY (Y 軸非等比拉伸)"
            />
            <span className="tabular text-xs text-zinc-300 w-16 text-right">
              {Math.round(currentStretchY * 100)}%
            </span>
            {currentStretchY !== 1 && (
              <button
                onClick={() => setImageStretchY(1)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                title="重設 100%"
              >
                ⟲
              </button>
            )}
          </div>
          {/* 亮度 slider — 0.5 ~ 1.5（CSS filter brightness）*/}
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-xs text-zinc-400 font-medium w-12">亮度</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={currentBrightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="flex-1 accent-amber-500"
              title="CSS filter brightness — 1.0 是原圖、< 1 變暗、> 1 變亮"
            />
            <span className="tabular text-xs text-zinc-300 w-12 text-right">{Math.round(currentBrightness * 100)}%</span>
            {currentBrightness !== 1 && (
              <button
                onClick={() => setBrightness(1)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                title="重設 100%"
              >
                ⟲
              </button>
            )}
          </div>
          {/* 裁切 — 4 邊 slider（0-45%）+ 整組重設 */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-zinc-300 font-medium">✂ 裁切</span>
              {hasCrop && (
                <button
                  onClick={resetCrop}
                  className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                >
                  ⟲ 清除裁切
                </button>
              )}
            </div>
            {(['cropTop', 'cropBottom', 'cropLeft', 'cropRight'] as const).map((side) => {
              const label = { cropTop: '上', cropBottom: '下', cropLeft: '左', cropRight: '右' }[side];
              const value = meta[side] ?? 0;
              return (
                <div key={side} className="flex items-center gap-3 px-1 mt-1">
                  <span className="text-[11px] text-zinc-500 w-6">{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={0.7}
                    step={0.01}
                    value={value}
                    onChange={(e) => setCrop(side, Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="tabular text-[10px] text-zinc-400 w-10 text-right">
                    {Math.round(value * 100)}%
                  </span>
                </div>
              );
            })}
            <p className="text-[10px] text-zinc-600 mt-2 px-1">
              各邊 0~70%、裁掉的區域不顯示、剩下的撐滿 cell（縮放 + 平移）。對邊（上+下、左+右）加總不能超過 95%、否則 crop 不生效。
            </p>
          </div>
          <p className="text-[11px] text-zinc-500 mt-3">
            所有編輯只存「設定」、不動原始檔。其他機從 NAS 拉到 sync.json 也會套用同樣設定。
            <br />
            旋轉 {meta.rotate ?? 0}° · 水平翻轉 {meta.flipH ? '是' : '否'} · 垂直翻轉 {meta.flipV ? '是' : '否'} · 縮放 {Math.round(currentScale * 100)}% · 亮度 {Math.round(currentBrightness * 100)}%
          </p>
        </div>
        <footer className="px-6 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
          >
            儲存
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ─── 照片選擇器 modal ─────────────────────────────── */
function PhotoPickerModal({
  patient,
  slot,
  slotLabel,
  onClose,
}: {
  patient: Patient;
  slot: PhotoSlot;
  slotLabel: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listFolderFiles(patient.sourceFolder).then((r) => {
      if ('error' in r) {
        setError(`列檔失敗：${r.error}`);
        return;
      }
      setFiles(r.names);
    });
  }, [patient.sourceFolder]);

  async function pick(filename: string) {
    await db.patients.update(patient.id, {
      photos: { ...(patient.photos || {}), [slot]: { filename } },
      updatedAt: new Date().toISOString(),
    });
    onClose();
  }

  // 已被其他 slot 使用的檔名（提示用、不擋）
  const usedElsewhere = new Set(
    Object.entries(patient.photos || {})
      .filter(([k]) => k !== slot)
      .map(([, v]) => (v as PhotoMeta | undefined)?.filename)
      .filter(Boolean) as string[],
  );

  const currentFilename = patient.photos?.[slot]?.filename;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[85vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">選照片 — {slotLabel}</h3>
            <p className="text-xs text-zinc-500 mt-1">
              來源：<code className="font-mono">{patient.sourceFolder}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {!files && !error && (
            <p className="text-sm text-zinc-500 text-center py-10">讀取資料夾中…</p>
          )}
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
          {files && files.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-10">
              資料夾沒有圖片檔（jpg / jpeg / png / heic）。把照片放進去再回來。
            </p>
          )}
          {files && files.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {files.map((f) => {
                const fullPath = `${patient.sourceFolder}\\${f}`;
                const isUsed = usedElsewhere.has(f);
                const isCurrent = currentFilename === f;
                return (
                  <button
                    key={f}
                    onClick={() => pick(f)}
                    className={`relative aspect-[4/3] rounded-md overflow-hidden border-2 transition ${
                      isCurrent
                        ? 'border-sky-500 ring-2 ring-sky-500/40'
                        : isUsed
                        ? 'border-amber-500/40 opacity-70 hover:opacity-100'
                        : 'border-zinc-800 hover:border-sky-500/60'
                    }`}
                    title={f + (isUsed ? '（已用在其他 slot）' : '')}
                  >
                    <img
                      src={getImageUrl(fullPath)}
                      alt={f}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-0.5">
                      <div className="text-[9px] text-white truncate font-mono">{f}</div>
                    </div>
                    {isCurrent && (
                      <div className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] rounded bg-sky-500 text-zinc-950 font-medium">
                        當前
                      </div>
                    )}
                    {isUsed && !isCurrent && (
                      <div className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] rounded bg-amber-500/80 text-zinc-950 font-medium">
                        已用
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <footer className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
          <span>{files ? `共 ${files.length} 張圖片` : ''}</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ─── markdown 筆記編輯區 ──────────────────────────── */
function MarkdownNoteEditor({ patient }: { patient: Patient }) {
  const [value, setValue] = useState(patient.markdownNote || '');
  const [savedTick, setSavedTick] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPatientId = useRef(patient.id);

  // patient 切換時 reset value（避免上一個病患的筆記殘留）
  useEffect(() => {
    if (lastPatientId.current !== patient.id) {
      setValue(patient.markdownNote || '');
      lastPatientId.current = patient.id;
    }
  }, [patient.id, patient.markdownNote]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    // debounced auto-save 500ms
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      await db.patients.update(patient.id, {
        markdownNote: next,
        updatedAt: new Date().toISOString(),
      });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    }, 500);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">筆記</h3>
        {savedTick && <span className="text-[10px] text-emerald-400">✓ 已存</span>}
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        readOnly={READ_ONLY}
        placeholder={READ_ONLY ? '（無筆記）' : `矯正計畫、治療目標、注意事項…\n\n範例：\n# 治療目標\n1. 改善下顎門牙內傾\n2. 改善後牙咬合空間\n3. 上顎關縫\n4. 改善下巴前凸`}
        className={`w-full min-h-[200px] px-3 py-2 rounded-md bg-zinc-950/60 border border-zinc-800 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none resize-y ${
          READ_ONLY ? 'cursor-default' : 'focus:border-sky-500/50'
        }`}
        spellCheck={false}
      />
      {!READ_ONLY && (
        <p className="text-[10px] text-zinc-600 mt-1">
          自動儲存（停止輸入 0.5 秒）· 支援 markdown 格式（# 標題、- 列表、**粗體**）
        </p>
      )}
    </div>
  );
}
