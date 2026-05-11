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
import { listFolderFiles, getImageUrl } from '../lib/helper-client';

export default function PatientNotesSection({ patient }: { patient: Patient }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-200">📋 病歷照片 / 筆記</h2>
      </header>
      <div className="p-5 space-y-6">
        {/* v0.1.10 順序對調：照片在上、筆記在下 */}
        <PhotoSlotGrid patient={patient} />
        <MarkdownNoteEditor patient={patient} />
      </div>
    </section>
  );
}

/* ─── 14-slot 病歷照片 grid（按 group 分區）──────── */
const PHOTO_SIZE_KEY = 'aligner-photo-size'; // localStorage key for zoom slider

function PhotoSlotGrid({ patient }: { patient: Patient }) {
  const [picker, setPicker] = useState<{ slot: PhotoSlot; label: string } | null>(null);
  const [editor, setEditor] = useState<{ slot: PhotoSlot; label: string; meta: PhotoMeta } | null>(null);
  // 整體尺寸 slider — 50%~100%，存 localStorage 跨 session 沿用
  const [photoSize, setPhotoSize] = useState<number>(() => {
    const stored = localStorage.getItem(PHOTO_SIZE_KEY);
    const n = stored ? parseInt(stored, 10) : NaN;
    return !isNaN(n) && n >= 50 && n <= 100 ? n : 100;
  });
  function savePhotoSize(n: number) {
    setPhotoSize(n);
    localStorage.setItem(PHOTO_SIZE_KEY, String(n));
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
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
          病歷照片
          <span className="ml-2 text-[10px] text-zinc-600 normal-case tracking-normal">
            來源：<code>{patient.sourceFolder}</code>
          </span>
        </h3>
        {/* 尺寸調整 slider */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">尺寸</span>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={photoSize}
            onChange={(e) => savePhotoSize(Number(e.target.value))}
            className="w-32 accent-sky-500"
            title="拖曳調整整體照片區尺寸"
          />
          <span className="text-[10px] text-zinc-400 tabular w-9 text-right">{photoSize}%</span>
          {photoSize !== 100 && (
            <button
              onClick={() => savePhotoSize(100)}
              className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
              title="重設"
            >
              ⟲
            </button>
          )}
        </div>
      </div>
      {/* 左半（人像、寬一點）| 右半（牙齒系列、窄一點 → 照片縮小）
          外層 maxWidth 跟 photoSize 連動、整體可縮放 */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-4"
        style={{ maxWidth: `${photoSize}%` }}
      >
        {/* Left: portrait 框框 — 加粗 border + 亮色 */}
        <div className="rounded-lg border-2 border-zinc-600 bg-zinc-950/40 p-4">
          <div className="text-xs text-zinc-200 mb-3 font-semibold flex items-center gap-2">
            <span className="text-base">🙂</span>
            <span>{PHOTO_GROUP_LABEL.portrait}</span>
            <span className="text-[10px] text-zinc-500 font-normal">（{byGroup.portrait.length}）</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
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

        {/* Right: 牙齒系列框框 */}
        <div className="rounded-lg border-2 border-zinc-600 bg-zinc-950/40 p-4 space-y-4">
          <div className="text-xs text-zinc-200 font-semibold flex items-center gap-2">
            <span className="text-base">🦷</span>
            <span>牙齒</span>
            <span className="text-[10px] text-zinc-500 font-normal">
              （{byGroup.xray.length + byGroup.extraoral.length + byGroup.intraoral.length}）
            </span>
          </div>
          {(['xray', 'extraoral', 'intraoral'] as PhotoSlotGroup[]).map((group) => (
            <div key={group}>
              <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">
                {PHOTO_GROUP_LABEL[group]}（{byGroup[group].length}）
              </div>
              <div className="grid grid-cols-2 gap-2">
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
  if (meta.rotate) parts.push(`rotate(${meta.rotate}deg)`);
  if (meta.flipH) parts.push('scaleX(-1)');
  if (meta.flipV) parts.push('scaleY(-1)');
  return parts.join(' ');
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
  // 旋轉 90/270 時、aspect 變橫長 → 圖會被 4:3 框裁掉、加 scale 補救
  const isQuarterRotate = meta?.rotate === 90 || meta?.rotate === 270;

  async function removePhoto() {
    if (!confirm(`移除 ${slotLabel} 的照片連結？\n（檔案不會刪除、只是 App 內取消綁定）`)) return;
    const nextPhotos = { ...(patient.photos || {}) };
    delete nextPhotos[slotKey];
    await db.patients.update(patient.id, {
      photos: nextPhotos,
      updatedAt: new Date().toISOString(),
    });
  }

  if (!imageUrl || !meta) {
    return (
      <button
        onClick={onPickClick}
        className="aspect-[4/3] rounded-md border-2 border-dashed border-zinc-800 bg-zinc-950/40 hover:border-sky-500/40 hover:bg-sky-500/5 transition flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-sky-400 group"
      >
        <span className="text-2xl opacity-50 group-hover:opacity-100">＋</span>
        <span className="text-[11px] text-center px-2">{slotLabel}</span>
      </button>
    );
  }

  return (
    <div className="relative aspect-[4/3] rounded-md overflow-hidden border border-zinc-800 bg-zinc-950 group">
      <img
        src={imageUrl}
        alt={slotLabel}
        className="w-full h-full object-cover transition-transform"
        style={{
          transform,
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
    meta.flipV !== initialMeta.flipV;

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
              style={{ transform }}
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
              disabled={!meta.rotate && !meta.flipH && !meta.flipV}
              className="px-3 py-2 rounded-md text-sm border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition disabled:opacity-40"
              title="清掉所有編輯"
            >
              ⟲ 還原
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mt-3">
            旋轉 / 翻轉只存「設定」、不動原始檔。其他機從 NAS 拉到 sync.json 也會套用同樣 transform。
            <br />
            目前狀態：旋轉 {meta.rotate ?? 0}° · 水平翻轉 {meta.flipH ? '是' : '否'} · 垂直翻轉 {meta.flipV ? '是' : '否'}
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
        placeholder={`矯正計畫、治療目標、注意事項…\n\n範例：\n# 治療目標\n1. 改善下顎門牙內傾\n2. 改善後牙咬合空間\n3. 上顎關縫\n4. 改善下巴前凸`}
        className="w-full min-h-[200px] px-3 py-2 rounded-md bg-zinc-950/60 border border-zinc-800 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-sky-500/50 resize-y"
        spellCheck={false}
      />
      <p className="text-[10px] text-zinc-600 mt-1">
        自動儲存（停止輸入 0.5 秒）· 支援 markdown 格式（# 標題、- 列表、**粗體**）
      </p>
    </div>
  );
}
