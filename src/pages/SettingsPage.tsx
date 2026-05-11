import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { rescanAndImport, type RescanResult } from '../lib/folder-rescan';
import { reapplyExcelUpdates, type ReapplyResult } from '../lib/reapply-excel';
import {
  downloadBackup,
  exportBackup,
  importBackup,
  validateBackup,
  type BackupFile,
} from '../lib/backup';
import {
  DEFAULT_LABS,
  type Lab,
  loadLabs,
  saveLabs,
  useLabs,
} from '../lib/labs';
import {
  DEFAULT_DOCTORS,
  type Doctor,
  loadDoctors,
  saveDoctors,
  useDoctors,
} from '../lib/doctors';
import {
  type AlertThresholds,
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
} from '../config/alerts';
import { seedIfEmpty, type SeedResult } from '../seed';
import {
  runUpdate,
  scanExcel,
  listFolderNames,
  listTags,
  writeBackup,
  getPaths,
  savePaths,
  syncStat,
  syncRead,
  syncWrite,
  type ClinicPaths,
} from '../lib/helper-client';
import { parseFolderName } from '../lib/parse-folder-name';
import { useScale, saveScale, MIN_SCALE, MAX_SCALE, DEFAULT_SCALE } from '../lib/ui-scale';
import {
  usePhotoStyle,
  savePhotoStyle,
  DEFAULT_PHOTO_STYLE,
  MIN_BORDER_WIDTH,
  MAX_BORDER_WIDTH,
  PHOTO_COLOR_PRESETS,
} from '../lib/photo-style';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">設定</h1>
        <p className="text-xs text-zinc-500 mt-1">
          技工所管理、警示閾值、資料夾掃描、資料庫
        </p>
      </header>

      <UiScaleSection />
      <PhotoStyleSection />
      <UpdateSection />
      <PathsSection />
      <SyncSection />
      <LabSection />
      <DoctorSection />
      <AlertSection />
      <BackupSection />
      <RescanSection />
      <ScanExcelSection />
      <ReapplyExcelSection />
      <BirthdayBackfillSection />
      <DbSection />
    </div>
  );
}

/* ─── UI 字級 ─────────────────────────────────────── */
const SCALE_PRESETS = [
  { label: '小', value: 0.9 },
  { label: '正常', value: 1.0 },
  { label: '大', value: 1.15 },
  { label: '特大', value: 1.3 },
  { label: '巨大', value: 1.5 },
];

function UiScaleSection() {
  const scale = useScale();
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">字級大小</h2>
          <span className="text-xs text-zinc-500">當前 {Math.round(scale * 100)}%</span>
        </div>
        <button
          onClick={() => saveScale(DEFAULT_SCALE)}
          disabled={scale === DEFAULT_SCALE}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition disabled:opacity-50"
        >
          重設
        </button>
      </header>
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {SCALE_PRESETS.map((p) => {
            const active = Math.abs(scale - p.value) < 0.01;
            return (
              <button
                key={p.value}
                onClick={() => saveScale(p.value)}
                className={`px-4 py-2 rounded-md border transition ${
                  active
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/60'
                }`}
                style={{ fontSize: `${p.value}rem` }}
              >
                {p.label} ({Math.round(p.value * 100)}%)
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 w-12">微調</span>
          <input
            type="range"
            min={MIN_SCALE * 100}
            max={MAX_SCALE * 100}
            step={5}
            value={Math.round(scale * 100)}
            onChange={(e) => saveScale(Number(e.target.value) / 100)}
            className="flex-1 accent-sky-500"
          />
          <span className="tabular text-xs text-zinc-400 w-12 text-right">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          影響整個 App 字級。改完即時生效、自動存。下次開 App 沿用上次設定。
        </p>
      </div>
    </section>
  );
}

/* ─── 病歷照片框線（粗細 + 顏色）──────────────────── */
function PhotoStyleSection() {
  const style = usePhotoStyle();
  const isDefault =
    style.borderWidth === DEFAULT_PHOTO_STYLE.borderWidth &&
    style.borderColor.toLowerCase() === DEFAULT_PHOTO_STYLE.borderColor.toLowerCase();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">框線樣式</h2>
          <span className="text-xs text-zinc-500">
            全 App · 粗細 {style.borderWidth}px · 顏色{' '}
            <span
              className="inline-block w-3 h-3 rounded border border-zinc-700 align-middle"
              style={{ background: style.borderColor }}
            />{' '}
            <code className="text-[10px]">{style.borderColor}</code>
          </span>
        </div>
        <button
          onClick={() => savePhotoStyle(DEFAULT_PHOTO_STYLE)}
          disabled={isDefault}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition disabled:opacity-50"
        >
          重設
        </button>
      </header>
      <div className="p-5 space-y-4">
        {/* 粗細 */}
        <div>
          <div className="text-xs text-zinc-300 mb-2 font-medium">框線粗細</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={MIN_BORDER_WIDTH}
              max={MAX_BORDER_WIDTH}
              step={1}
              value={style.borderWidth}
              onChange={(e) =>
                savePhotoStyle({ ...style, borderWidth: Number(e.target.value) })
              }
              className="flex-1 accent-sky-500"
            />
            <span className="tabular text-xs text-zinc-300 w-12 text-right">
              {style.borderWidth}px
            </span>
          </div>
          {/* preset 數字快選 */}
          <div className="flex gap-1.5 mt-2">
            {[1, 2, 3, 4, 5, 6].map((w) => (
              <button
                key={w}
                onClick={() => savePhotoStyle({ ...style, borderWidth: w })}
                className={`px-2 py-1 rounded text-xs border transition ${
                  style.borderWidth === w
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                    : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800/60'
                }`}
              >
                {w}px
              </button>
            ))}
          </div>
        </div>

        {/* 顏色 */}
        <div>
          <div className="text-xs text-zinc-300 mb-2 font-medium">框線顏色</div>
          <div className="flex flex-wrap items-center gap-2">
            {PHOTO_COLOR_PRESETS.map((p) => {
              const isActive =
                style.borderColor.toLowerCase() === p.value.toLowerCase();
              return (
                <button
                  key={p.value}
                  onClick={() => savePhotoStyle({ ...style, borderColor: p.value })}
                  title={`${p.label} (${p.value})`}
                  className={`w-9 h-9 rounded-md border-2 transition ${
                    isActive ? 'border-sky-400 ring-2 ring-sky-500/30' : 'border-zinc-700 hover:border-zinc-500'
                  }`}
                  style={{ background: p.value }}
                />
              );
            })}
            <div className="flex items-center gap-2 ml-2">
              <input
                type="color"
                value={style.borderColor}
                onChange={(e) =>
                  savePhotoStyle({ ...style, borderColor: e.target.value })
                }
                className="w-9 h-9 rounded-md border-2 border-zinc-700 cursor-pointer bg-transparent"
                title="自訂顏色"
              />
              <input
                value={style.borderColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,8}$/.test(v)) {
                    savePhotoStyle({ ...style, borderColor: v });
                  }
                }}
                className="h-9 px-3 w-28 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </div>
        </div>

        {/* preview */}
        <div>
          <div className="text-xs text-zinc-500 mb-2">預覽</div>
          <div className="flex gap-3">
            <div
              className="w-24 aspect-[4/3] rounded-md bg-zinc-900"
              style={{
                borderStyle: 'solid',
                borderWidth: `${style.borderWidth}px`,
                borderColor: style.borderColor,
              }}
            />
            <div
              className="w-24 aspect-[4/3] rounded-md bg-zinc-900"
              style={{
                borderStyle: 'dashed',
                borderWidth: `${style.borderWidth}px`,
                borderColor: style.borderColor,
              }}
            />
          </div>
        </div>

        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          影響全 App 所有框線：
          <br />
          · <strong>顏色</strong>套到所有 zinc 灰系框線（病歷照片、Card、設定 section、Modal、表格 等）
          <br />
          · <strong>粗細</strong>只套主要結構框（rounded-xl / lg / md + border），不影響 badge / pill / divider 等小元素
          <br />
          設定每台機獨立（不跟 NAS sync）。
        </p>
      </div>
    </section>
  );
}

/* ─── App 更新 / 切換版本 ─────────────────────────────── */
const LATEST_OPTION = '__latest__'; // dropdown 內代表「最新 main」的特殊值

function UpdateSection() {
  const [roleInfo, setRoleInfo] = useState<{ role: 'master' | 'follower' } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [currentHash, setCurrentHash] = useState('');
  const [currentTag, setCurrentTag] = useState<string | null>(null);
  const [latestMain, setLatestMain] = useState('');
  const [selectedRef, setSelectedRef] = useState<string>(LATEST_OPTION);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'backing-up' | 'updating' | 'done'>('idle');
  const [error, setError] = useState('');
  const [runOutput, setRunOutput] = useState('');
  const [backupPath, setBackupPath] = useState('');

  useEffect(() => {
    fetch('http://127.0.0.1:8765/role')
      .then((r) => r.json())
      .then((data: { role: 'master' | 'follower' }) => setRoleInfo(data))
      .catch(() => {});
  }, []);

  // role 確認後才能 listTags（master only）
  useEffect(() => {
    if (roleInfo?.role !== 'master') return;
    refreshTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleInfo]);

  async function refreshTags() {
    setPhase('loading');
    setError('');
    const r = await listTags();
    if (r.state === 'ok') {
      setTags(r.tags);
      setCurrentHash(r.currentHash);
      setCurrentTag(r.currentTag);
      setLatestMain(r.latestMain);
      // 預設 dropdown：如果當前不在 latest main，預選 latest；否則保持當前 tag
      if (r.currentHash !== r.latestMain) {
        setSelectedRef(LATEST_OPTION);
      } else {
        setSelectedRef(r.currentTag ?? LATEST_OPTION);
      }
      setPhase('idle');
    } else if (r.state === 'helper-down') {
      setError('helper 沒回應');
      setPhase('idle');
    } else {
      setError(`列 tag 失敗：${r.message}`);
      setPhase('idle');
    }
  }

  // 判斷當前選擇相對於當前 HEAD 是「升 / 切 / 退」
  function describeAction(): { label: string; disabled: boolean; rollback: boolean } {
    if (selectedRef === LATEST_OPTION) {
      // 升到 latest main
      if (currentHash && currentHash === latestMain) {
        return { label: '✓ 已是最新 main', disabled: true, rollback: false };
      }
      return { label: '⬆ 升到最新 main', disabled: false, rollback: false };
    }
    // 選了 tag
    if (currentTag === selectedRef) {
      return { label: `✓ 已是 ${selectedRef}`, disabled: true, rollback: false };
    }
    // 比較 selectedRef 跟 currentTag 哪個比較舊（用 tag list 順序：tags[0] 最新）
    const selIdx = tags.indexOf(selectedRef);
    const curIdx = currentTag ? tags.indexOf(currentTag) : -1;
    // selIdx 比 curIdx 大（更後面 = 更舊版本）= 退版
    const rollback = curIdx >= 0 && selIdx > curIdx;
    return {
      label: rollback ? `⬇ 退回 ${selectedRef}` : `⬆ 切到 ${selectedRef}`,
      disabled: false,
      rollback,
    };
  }

  async function doSwitch() {
    const action = describeAction();
    if (action.disabled) return;
    const refToUse = selectedRef === LATEST_OPTION ? '' : selectedRef; // 空字串 = 沒帶 ref → 升 latest
    const targetLabel = selectedRef === LATEST_OPTION ? '最新 main' : selectedRef;
    if (
      !confirm(
        `將切換到 ${targetLabel}（${action.rollback ? '退版' : '升版/切換'}）。\n\n` +
        `流程：\n` +
        `  1. 自動匯出 backup 到 dataRoot\\app-backups\\\n` +
        `  2. git fetch + git reset --hard ${targetLabel}\n` +
        `  3. npm install (依賴變動才跑)\n` +
        `  4. npm run build\n\n` +
        `預估 1-3 分鐘。完成後按 Ctrl+Shift+R 重整 App。\n\n` +
        (action.rollback
          ? `⚠️ 跨版本 IndexedDB schema 不一定相容。如果開不起來，去設定 → 資料備份 → 匯入剛才的 backup。\n\n`
          : '') +
        `確定？`,
      )
    )
      return;

    setError('');
    setRunOutput('');
    setBackupPath('');

    // 1. 匯出 backup 並寫到 dataRoot/app-backups/
    setPhase('backing-up');
    let savedBackupPath = '';
    try {
      const backup = await exportBackup();
      const json = JSON.stringify(backup, null, 2);
      const fromVer = currentTag || (currentHash ? currentHash.slice(0, 7) : 'unknown');
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `pre-switch-${fromVer}-to-${targetLabel.replace(/\W+/g, '_')}-${dateStr}.json`;
      const wb = await writeBackup(filename, json);
      if (wb.state !== 'ok') {
        setError(
          `自動 backup 失敗：${wb.state === 'helper-down' ? 'helper 沒回應' : wb.message}。\n建議手動到「資料備份」匯出後再切版。`,
        );
        setPhase('idle');
        return;
      }
      savedBackupPath = wb.path;
      setBackupPath(wb.path);
    } catch (e) {
      setError(`匯出 backup 失敗：${e instanceof Error ? e.message : String(e)}`);
      setPhase('idle');
      return;
    }

    // 2. 跑 update.ps1 with -Ref
    setPhase('updating');
    const r = await runUpdate(refToUse || undefined);
    if (r.state === 'ok') {
      setRunOutput(r.stdout + (r.stderr ? '\n\n[stderr]\n' + r.stderr : ''));
      if (r.exitCode === 0) {
        setPhase('done');
        // 重新查 tag 狀態
        refreshTags();
      } else {
        setError(`更新失敗 (exit ${r.exitCode})。Backup 已存：${savedBackupPath}`);
        setPhase('idle');
      }
    } else {
      setError(r.state === 'helper-down' ? '本機 helper 沒回應' : `更新失敗：${r.message}`);
      setPhase('idle');
    }
  }

  const isMaster = roleInfo?.role === 'master';
  const action = describeAction();
  const busy = phase === 'backing-up' || phase === 'updating' || phase === 'loading';

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">App 更新 / 切換版本</h2>
          <span className="text-xs text-zinc-500">
            當前 v{__APP_VERSION__}
            {currentTag && currentTag !== `v${__APP_VERSION__}` && (
              <span className="text-amber-400 ml-1">· tag: {currentTag}</span>
            )}
          </span>
        </div>
        {isMaster && (
          <div className="flex items-center gap-2">
            <select
              value={selectedRef}
              onChange={(e) => setSelectedRef(e.target.value)}
              disabled={busy || tags.length === 0}
              className="h-8 px-2 rounded-md bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
            >
              <option value={LATEST_OPTION}>
                最新 main {latestMain && `(${latestMain})`}
              </option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                  {t === currentTag && ' (當前)'}
                </option>
              ))}
            </select>
            <button
              onClick={refreshTags}
              disabled={busy}
              className="px-2 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
              title="重新拉 tag 列表（git fetch --tags）"
            >
              ⟳
            </button>
            <button
              onClick={doSwitch}
              disabled={busy || action.disabled}
              className={`px-3 py-1.5 rounded-md text-xs border transition disabled:opacity-50 ${
                action.rollback
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-sky-500/15 border-sky-500/40 text-sky-300 hover:bg-sky-500/25'
              }`}
            >
              {phase === 'backing-up'
                ? '⏳ 匯出備份…'
                : phase === 'updating'
                ? '⏳ 切換中…'
                : action.label}
            </button>
          </div>
        )}
      </header>
      <div className="p-5 space-y-2 text-sm">
        {!isMaster && roleInfo && (
          <p className="text-xs text-zinc-500">
            此機為 <strong className="text-zinc-300">{roleInfo.role}</strong>，不能切換版本。程式碼從這台 push、回 master（筆電）切版。
          </p>
        )}
        {!roleInfo && <p className="text-xs text-zinc-500">讀取本機角色中…</p>}
        {isMaster && phase === 'loading' && <p className="text-xs text-zinc-500">拉 tag 列表中…</p>}
        {isMaster && tags.length > 0 && (
          <p className="text-[11px] text-zinc-500">
            可選 tag {tags.length} 個 · HEAD <code className="text-zinc-400">{currentHash}</code>
            {currentTag && (
              <>
                {' '}· 當前 tag <code className="text-zinc-400">{currentTag}</code>
              </>
            )}
            {' · '}origin/main <code className="text-zinc-400">{latestMain}</code>
          </p>
        )}
        {phase === 'backing-up' && (
          <p className="text-xs text-sky-300">⏳ 切版前自動匯出 backup 到 dataRoot\app-backups\…</p>
        )}
        {phase === 'updating' && (
          <p className="text-xs text-sky-300">
            ⏳ git fetch → reset → npm install (如需) → npm run build... 1-3 分鐘，請勿關閉視窗。
          </p>
        )}
        {phase === 'done' && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            ✓ 切版完成。<strong>請按 Ctrl+Shift+R 重整 App 載入新版本。</strong>
            {backupPath && (
              <div className="text-emerald-400/80 mt-1">
                pre-switch backup: <code>{backupPath}</code>
              </div>
            )}
          </div>
        )}
        {backupPath && phase !== 'done' && (
          <div className="px-3 py-2 rounded-md bg-zinc-800/40 border border-zinc-700/40 text-zinc-300 text-xs">
            📦 backup 已存：<code className="text-zinc-400">{backupPath}</code>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs whitespace-pre-wrap">
            ⚠️ {error}
          </div>
        )}
        {runOutput && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">查看 update 輸出</summary>
            <pre className="mt-2 p-3 bg-zinc-950/60 rounded text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">{runOutput}</pre>
          </details>
        )}
        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          <strong>切版前自動 backup</strong> → 寫到 <code>{`{dataRoot}\\app-backups\\pre-switch-{from}-to-{target}-{時間}.json`}</code>。
          切版後 IndexedDB 開不起來時，去「資料備份 / 還原」匯入剛才的 backup 即可。
        </p>
      </div>
    </section>
  );
}

/* ─── 路徑設定（NAS / 本機路徑）──────────────────────────── */
function PathsSection() {
  const [paths, setPaths] = useState<ClinicPaths>({ dataRoot: '', syncFile: '' });
  const [originalPaths, setOriginalPaths] = useState<ClinicPaths>({ dataRoot: '', syncFile: '' });
  const [pathsFile, setPathsFile] = useState('');
  const [pathsFileExists, setPathsFileExists] = useState(false);
  const [roleInfo, setRoleInfo] = useState<{ role: 'master' | 'follower' } | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('http://127.0.0.1:8765/role')
      .then((r) => r.json())
      .then((data: { role: 'master' | 'follower' }) => setRoleInfo(data))
      .catch(() => {});
    getPaths().then((r) => {
      if (r.state === 'ok') {
        setPaths(r.paths);
        setOriginalPaths(r.paths);
        setPathsFile(r.pathsFile);
        setPathsFileExists(r.pathsFileExists);
      }
    });
  }, []);

  async function save() {
    setState('saving');
    setError('');
    setHint('');
    if (!paths.dataRoot.trim()) {
      setError('資料根目錄必填');
      setState('error');
      return;
    }
    const r = await savePaths({ dataRoot: paths.dataRoot.trim(), syncFile: paths.syncFile.trim() });
    if (r.state === 'ok') {
      setOriginalPaths(r.paths);
      setPathsFileExists(true);
      setHint(r.hint);
      setState('saved');
      setTimeout(() => setState('idle'), 3000);
    } else if (r.state === 'helper-down') {
      setError('helper 沒回應');
      setState('error');
    } else {
      setError(r.message);
      setState('error');
    }
  }

  const isMaster = roleInfo?.role === 'master';
  const dirty = paths.dataRoot !== originalPaths.dataRoot || paths.syncFile !== originalPaths.syncFile;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">路徑設定</h2>
          {!expanded && (
            <span className="text-[11px] text-zinc-500 truncate max-w-[480px]">
              資料根：<code className="text-zinc-400">{originalPaths.dataRoot || '(預設)'}</code>
              {originalPaths.syncFile && <> · 同步檔：<code className="text-zinc-400">{originalPaths.syncFile}</code></>}
            </span>
          )}
        </div>
        {expanded && isMaster && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {state === 'saved' && <span className="text-xs text-emerald-400">✓ 已儲存</span>}
            <button
              onClick={save}
              disabled={state === 'saving' || !dirty}
              className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              {state === 'saving' ? '儲存中…' : '儲存'}
            </button>
          </div>
        )}
      </header>
      {expanded && (
        <div className="p-5 space-y-4">
          {!isMaster && roleInfo && (
            <div className="px-3 py-2 rounded-md bg-zinc-800/40 border border-zinc-700/40 text-xs text-zinc-400">
              此機為 <strong className="text-zinc-300">{roleInfo.role}</strong>，不能改路徑（讀 dev-data/clinic-paths.json）。
            </div>
          )}
          <label className="block">
            <div className="text-xs text-zinc-300 mb-1 font-medium">資料根目錄（dataRoot）</div>
            <input
              value={paths.dataRoot}
              onChange={(e) => setPaths({ ...paths, dataRoot: e.target.value })}
              disabled={!isMaster}
              placeholder="例：Z:\矯正追蹤  或  D:\矯正"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
            <div className="text-[11px] text-zinc-500 mt-1">
              底下要有 <code>病患資料夾\</code> <code>病患授權書\</code> <code>下單Excel\</code>。NAS 接好後改成 <code>Z:\矯正追蹤</code> 之類。
            </div>
          </label>
          <label className="block">
            <div className="text-xs text-zinc-300 mb-1 font-medium">跨機同步檔位置（syncFile）</div>
            <input
              value={paths.syncFile}
              onChange={(e) => setPaths({ ...paths, syncFile: e.target.value })}
              disabled={!isMaster}
              placeholder="例：Z:\矯正追蹤\sync.json（留空 = 不啟用跨機同步）"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
            <div className="text-[11px] text-zinc-500 mt-1">
              兩台 Windows 機都指向同個 NAS 路徑。離開機器前點「📤 推到 NAS」、抵達另一台點「📥 從 NAS 拉」。
            </div>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              ⚠️ {error}
            </div>
          )}
          {hint && state === 'saved' && (
            <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
              ✓ {hint}
            </div>
          )}
          <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
            設定檔位置：<code className="text-zinc-400">{pathsFile}</code>
            {!pathsFileExists && <span className="text-zinc-600"> · 尚未建立（會用 fallback 預設）</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/* ─── 跨機同步（推 / 拉 NAS sync.json）─────────────────── */
const SYNC_LAST_PUSHED_KEY = 'aligner-sync-last-pushed';
const SYNC_LAST_PULLED_KEY = 'aligner-sync-last-pulled';

function SyncSection() {
  const [stat, setStat] = useState<{
    state: 'loading' | 'not-configured' | 'not-exists' | 'helper-down' | 'ok' | 'error';
    mtime?: string;
    size?: number;
    syncFile?: string;
    error?: string;
  }>({ state: 'loading' });
  const [busy, setBusy] = useState<'idle' | 'pushing' | 'pulling'>('idle');
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [pendingPull, setPendingPull] = useState<{
    mtime: string;
    counts: { patients: number; orders: number; settings: number };
  } | null>(null);

  const lastPushedAt = localStorage.getItem(SYNC_LAST_PUSHED_KEY);
  const lastPulledAt = localStorage.getItem(SYNC_LAST_PULLED_KEY);

  async function refreshStat() {
    setStat({ state: 'loading' });
    const r = await syncStat();
    if (r.state === 'ok') {
      setStat({
        state: 'ok',
        mtime: r.stat.mtime,
        size: r.stat.size,
        syncFile: r.stat.syncFile,
      });
    } else if (r.state === 'not-configured') {
      setStat({ state: 'not-configured' });
    } else if (r.state === 'not-exists') {
      setStat({ state: 'not-exists', syncFile: r.syncFile });
    } else if (r.state === 'helper-down') {
      setStat({ state: 'helper-down' });
    } else {
      setStat({ state: 'error', error: r.message });
    }
  }

  useEffect(() => {
    refreshStat();
  }, []);

  async function doPush() {
    setBusy('pushing');
    setMsg(null);
    try {
      const backup = await exportBackup();
      const json = JSON.stringify(backup, null, 2);
      const r = await syncWrite(json);
      if (r.state === 'ok') {
        localStorage.setItem(SYNC_LAST_PUSHED_KEY, new Date().toISOString());
        setMsg({ type: 'ok', text: `✓ 已推到 ${r.syncFile}（${formatSize(r.size)}）` });
        await refreshStat();
      } else if (r.state === 'not-configured') {
        setMsg({ type: 'error', text: '尚未設定 syncFile，請去上面「路徑設定」填' });
      } else if (r.state === 'helper-down') {
        setMsg({ type: 'error', text: 'helper 沒回應' });
      } else {
        setMsg({ type: 'error', text: r.message });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
    setBusy('idle');
  }

  async function doPullPreview() {
    setBusy('pulling');
    setMsg(null);
    setPendingPull(null);
    const r = await syncRead();
    if (r.state === 'ok') {
      const validation = validateBackup(r.content);
      if (!validation.ok) {
        setMsg({ type: 'error', text: `sync.json 格式錯誤：${validation.error}` });
        setBusy('idle');
        return;
      }
      setPendingPull({ mtime: r.mtime, counts: validation.file.counts });
    } else if (r.state === 'not-configured') {
      setMsg({ type: 'error', text: '尚未設定 syncFile' });
    } else if (r.state === 'not-exists') {
      setMsg({ type: 'error', text: 'NAS 上還沒有 sync.json — 在另一台先推一次' });
    } else if (r.state === 'helper-down') {
      setMsg({ type: 'error', text: 'helper 沒回應' });
    } else {
      setMsg({ type: 'error', text: r.message });
    }
    setBusy('idle');
  }

  async function doPullConfirm() {
    if (!pendingPull) return;
    if (
      !confirm(
        `⚠️ 從 NAS 拉資料會覆寫本機現有 IndexedDB。\n\n將載入：${pendingPull.counts.patients} 病患 / ${pendingPull.counts.orders} 下單 / ${pendingPull.counts.settings} 設定\n\nNAS 檔修改於 ${new Date(pendingPull.mtime).toLocaleString('zh-TW')}\n\n確定？`,
      )
    )
      return;
    setBusy('pulling');
    setMsg(null);
    try {
      const r = await syncRead();
      if (r.state !== 'ok') {
        setMsg({ type: 'error', text: 'sync-read 失敗（剛才驗證後又失敗了？）' });
        setBusy('idle');
        return;
      }
      const validation = validateBackup(r.content);
      if (!validation.ok) {
        setMsg({ type: 'error', text: validation.error });
        setBusy('idle');
        return;
      }
      await importBackup(validation.file);
      localStorage.setItem(SYNC_LAST_PULLED_KEY, new Date().toISOString());
      setMsg({ type: 'ok', text: '✓ 已從 NAS 拉並還原。重整頁面套用…' });
      setPendingPull(null);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) });
      setBusy('idle');
    }
  }

  // 計算「NAS 是否比本地新」— 用「上次推送」當基準（last pushed = 本地最後一次推上去的時間）
  // 如果 NAS mtime > lastPushed 而且 NAS mtime > lastPulled → 有別人推了新版（紅點）
  const nasNewer = (() => {
    if (stat.state !== 'ok' || !stat.mtime) return false;
    const nas = new Date(stat.mtime).getTime();
    const lp = lastPushedAt ? new Date(lastPushedAt).getTime() : 0;
    const lpu = lastPulledAt ? new Date(lastPulledAt).getTime() : 0;
    // NAS 比本地兩個基準時間都更新 = 有人在另一台推了
    return nas > Math.max(lp, lpu) + 5000; // +5s 緩衝避免自己剛推完誤判
  })();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">跨機同步</h2>
          {nasNewer && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
              ● NAS 有新版
            </span>
          )}
          {stat.state === 'ok' && !nasNewer && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              已同步
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshStat}
            disabled={busy !== 'idle'}
            className="px-2 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
            title="重新檢查 NAS 狀態"
          >
            ⟳
          </button>
          <button
            onClick={doPush}
            disabled={busy !== 'idle' || stat.state === 'not-configured' || stat.state === 'helper-down'}
            className="px-3 py-1.5 rounded-md text-xs bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 transition disabled:opacity-50"
          >
            {busy === 'pushing' ? '推送中…' : '📤 推到 NAS'}
          </button>
          <button
            onClick={doPullPreview}
            disabled={busy !== 'idle' || stat.state === 'not-configured' || stat.state === 'not-exists' || stat.state === 'helper-down'}
            className={`px-3 py-1.5 rounded-md text-xs border transition disabled:opacity-50 ${
              nasNewer
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {busy === 'pulling' ? '處理中…' : '📥 從 NAS 拉'}
          </button>
        </div>
      </header>
      <div className="p-5 space-y-2 text-sm">
        {stat.state === 'loading' && <p className="text-xs text-zinc-500">讀取 NAS 狀態中…</p>}
        {stat.state === 'not-configured' && (
          <p className="text-xs text-amber-300/80">
            ⚠️ 尚未設定同步檔位置。請先到上面「路徑設定」填 syncFile（例 <code>Z:\矯正追蹤\sync.json</code>）。
          </p>
        )}
        {stat.state === 'not-exists' && (
          <p className="text-xs text-zinc-500">
            NAS 上還沒有 sync.json (<code className="text-zinc-400">{stat.syncFile}</code>)。
            按「📤 推到 NAS」第一次推上去就會建立。
          </p>
        )}
        {stat.state === 'helper-down' && (
          <p className="text-xs text-rose-300">⚠️ helper service 沒回應</p>
        )}
        {stat.state === 'error' && (
          <p className="text-xs text-rose-300">⚠️ {stat.error}</p>
        )}
        {stat.state === 'ok' && (
          <div className="space-y-1 text-xs">
            <div className="text-zinc-500">
              NAS 同步檔：<code className="text-zinc-400">{stat.syncFile}</code>
            </div>
            <div className="text-zinc-500">
              NAS 修改於：<span className="text-zinc-300 tabular">{stat.mtime ? new Date(stat.mtime).toLocaleString('zh-TW') : '—'}</span>
              {' · '}大小：<span className="text-zinc-300 tabular">{stat.size ? formatSize(stat.size) : '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-zinc-800">
              <div className="text-zinc-500">
                本機上次推送：<span className="text-zinc-300 tabular">{lastPushedAt ? new Date(lastPushedAt).toLocaleString('zh-TW') : '從未'}</span>
              </div>
              <div className="text-zinc-500">
                本機上次拉取：<span className="text-zinc-300 tabular">{lastPulledAt ? new Date(lastPulledAt).toLocaleString('zh-TW') : '從未'}</span>
              </div>
            </div>
          </div>
        )}
        {msg && (
          <div
            className={`px-3 py-2 rounded-md border text-xs ${
              msg.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {msg.text}
          </div>
        )}
        {pendingPull && (
          <div className="px-3 py-3 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-200 space-y-2">
            <div className="text-sm">
              <strong>準備從 NAS 拉：</strong>
              {pendingPull.counts.patients} 病患 · {pendingPull.counts.orders} 下單 · {pendingPull.counts.settings} 設定
            </div>
            <div className="text-xs text-amber-300/80">
              NAS 修改於：{new Date(pendingPull.mtime).toLocaleString('zh-TW')}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={doPullConfirm}
                disabled={busy !== 'idle'}
                className="px-3 py-1.5 rounded-md text-xs bg-rose-500 text-zinc-50 hover:bg-rose-400 transition disabled:opacity-50"
              >
                ⚠ 確認覆寫本機
              </button>
              <button
                onClick={() => setPendingPull(null)}
                disabled={busy !== 'idle'}
                className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          SOP：離開機器前點「📤 推到 NAS」 → 換到另一台 → 看到紅點「● NAS 有新版」 → 點「📥 從 NAS 拉」 → 接著用。
        </p>
      </div>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ─── 技工所管理 ───────────────────────────────────────── */
function LabSection() {
  const labs = useLabs();
  const [editing, setEditing] = useState<Lab | 'new' | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">技工所管理</h2>
          <span className="text-xs text-zinc-500">({labs.length} 個)</span>
          {!expanded && (
            <span className="text-[11px] text-zinc-600">
              {labs.slice(0, 3).map((l) => l.name).join('、')}
              {labs.length > 3 && '…'}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing('new');
          }}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
        >
          + 新增
        </button>
      </header>
      {expanded && (
        <div className="p-3 space-y-2">
          {labs.length === 0 && (
            <p className="text-sm text-zinc-500 px-2 py-3">尚無技工所</p>
          )}
          {labs.map((lab) => (
            <div
              key={lab.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded border border-zinc-700" style={{ background: lab.color }} />
                <span className="text-sm text-zinc-100 font-medium">{lab.name}</span>
                <code className="text-[10px] text-zinc-500">{lab.id}</code>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(lab)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded">編輯</button>
                <button
                  onClick={async () => {
                    if (!confirm(`刪除技工所「${lab.name}」？已下單紀錄會保留 lab 名稱字串，但配色會變灰色 fallback。`)) return;
                    const next = labs.filter((l) => l.id !== lab.id);
                    await saveLabs(next);
                  }}
                  className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <LabEditor target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function LabEditor({ target, onClose }: { target: Lab | 'new' | null; onClose: () => void }) {
  const [form, setForm] = useState<Lab>({ id: '', name: '', color: '#6366f1' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (target === 'new') {
      setForm({ id: '', name: '', color: '#6366f1' });
      setError('');
    } else if (target) {
      setForm(target);
      setError('');
    }
  }, [target]);

  if (!target) return null;
  const isNew = target === 'new';

  async function handleSave() {
    if (!form.name.trim()) {
      setError('名稱必填');
      return;
    }
    if (!form.id.trim() || !/^[a-z0-9-]+$/.test(form.id.trim())) {
      setError('id 必填，只能英數和連字號');
      return;
    }
    const labs = await loadLabs();
    if (isNew && labs.some((l) => l.id === form.id.trim())) {
      setError(`id「${form.id}」已存在`);
      return;
    }
    if (isNew) {
      await saveLabs([...labs, { ...form, id: form.id.trim(), name: form.name.trim() }]);
    } else {
      await saveLabs(
        labs.map((l) => (l.id === (target as Lab).id ? { ...form, name: form.name.trim() } : l)),
      );
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isNew ? '新增技工所' : `編輯：${(target as Lab).name}`}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">×</button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">名稱（顯示用）</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：日進"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-sky-500/50"
              autoFocus
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">id（內部識別，英數+連字號）</div>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="例：rijin"
              disabled={!isNew}
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">配色</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">取消</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition">儲存</button>
        </footer>
      </div>
    </div>
  );
}

/* ─── 醫師管理 ─────────────────────────────────────────── */
function DoctorSection() {
  const doctors = useDoctors();
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">醫師管理</h2>
          <span className="text-xs text-zinc-500">({doctors.length} 位)</span>
          {!expanded && (
            <span className="text-[11px] text-zinc-600">
              {doctors.slice(0, 3).map((d) => d.name).join('、')}
              {doctors.length > 3 && '…'}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing('new');
          }}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
        >
          + 新增
        </button>
      </header>
      {expanded && (
        <div className="p-3 space-y-2">
          {doctors.length === 0 && (
            <p className="text-sm text-zinc-500 px-2 py-3">尚無醫師</p>
          )}
          {doctors.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded border border-zinc-700" style={{ background: d.color }} />
                <span className="text-sm text-zinc-100 font-medium">{d.name}</span>
                <code className="text-[10px] text-zinc-500">{d.id}</code>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(d)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded">編輯</button>
                <button
                  onClick={async () => {
                    if (!confirm(`刪除醫師「${d.name}」？已存在的病患/下單會保留醫師名字串，但 badge 配色會變灰色 fallback。`)) return;
                    const next = doctors.filter((x) => x.id !== d.id);
                    await saveDoctors(next);
                  }}
                  className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <DoctorEditor target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function DoctorEditor({ target, onClose }: { target: Doctor | 'new' | null; onClose: () => void }) {
  const [form, setForm] = useState<Doctor>({ id: '', name: '', color: '#6366f1' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (target === 'new') {
      setForm({ id: '', name: '', color: '#6366f1' });
      setError('');
    } else if (target) {
      setForm(target);
      setError('');
    }
  }, [target]);

  if (!target) return null;
  const isNew = target === 'new';

  async function handleSave() {
    if (!form.name.trim()) { setError('名稱必填'); return; }
    if (!form.id.trim() || !/^[a-z0-9-]+$/.test(form.id.trim())) {
      setError('id 必填，只能英數和連字號');
      return;
    }
    const doctors = await loadDoctors();
    if (isNew && doctors.some((d) => d.id === form.id.trim())) {
      setError(`id「${form.id}」已存在`);
      return;
    }
    if (isNew) {
      await saveDoctors([...doctors, { ...form, id: form.id.trim(), name: form.name.trim() }]);
    } else {
      await saveDoctors(
        doctors.map((d) => (d.id === (target as Doctor).id ? { ...form, name: form.name.trim() } : d)),
      );
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isNew ? '新增醫師' : `編輯：${(target as Doctor).name}`}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">×</button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">名稱（顯示用）</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：王大明"
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-sky-500/50"
              autoFocus
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">id（內部識別，英數+連字號）</div>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="例：wang-daming"
              disabled={!isNew}
              className="w-full h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400 mb-1">配色</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-12 h-9 rounded border border-zinc-800 cursor-pointer bg-transparent"
              />
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="flex-1 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">取消</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition">儲存</button>
        </footer>
      </div>
    </div>
  );
}

/* ─── 警示閾值 ─────────────────────────────────────────── */
function AlertSection() {
  const [t, setT] = useState<AlertThresholds>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadThresholds().then(setT);
  }, []);

  async function save() {
    setSaving(true);
    await saveThresholds(t);
    setSaving(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header
        onClick={() => setExpanded(!expanded)}
        className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <h2 className="text-sm font-medium text-zinc-200">警示閾值</h2>
          {!expanded && (
            <span className="text-[11px] text-zinc-500">
              廠商遲交 {t.vendorDelayDays}天 · 病患未領 {t.pickupDelayDays}天 · 待下單 {t.pendingOrderDays}天
            </span>
          )}
        </div>
        {expanded && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {savedTick && <span className="text-xs text-emerald-400">✓ 已儲存</span>}
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              儲存
            </button>
          </div>
        )}
      </header>
      {expanded && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField label="A · 廠商遲交" hint="下單超過 N 天未收件" value={t.vendorDelayDays} onChange={(v) => setT({ ...t, vendorDelayDays: v })} />
          <NumberField label="B · 病患未領" hint="收件超過 N 天未完成" value={t.pickupDelayDays} onChange={(v) => setT({ ...t, pickupDelayDays: v })} />
          <NumberField label="D · 待下單逾時" hint="尚未開始 N 天" value={t.pendingOrderDays} onChange={(v) => setT({ ...t, pendingOrderDays: v })} />
        </div>
      )}
    </section>
  );
}

function NumberField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-xs text-zinc-300 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-24 h-9 px-3 rounded-md bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-200 tabular focus:outline-none focus:border-sky-500/50"
        />
        <span className="text-sm text-zinc-500">天</span>
      </div>
      <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>
    </div>
  );
}

/* ─── 資料備份 / 還原 ─────────────────────────────────────── */
function BackupSection() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const backup = await exportBackup();
      downloadBackup(backup);
      setDoneMsg(`✓ 已下載備份 (${backup.counts.patients} 病患 / ${backup.counts.orders} 下單 / ${backup.counts.settings} 設定)`);
      setTimeout(() => setDoneMsg(''), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setDoneMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = validateBackup(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPending(result.file);
    };
    reader.onerror = () => setError('讀檔失敗');
    reader.readAsText(file);
    e.target.value = ''; // reset 讓同檔可重選
  }

  async function confirmImport() {
    if (!pending) return;
    if (
      !confirm(
        `⚠️ 確定要覆寫現有資料？\n\n將載入：\n  ${pending.counts.patients} 筆病患 (現有會清空)\n  ${pending.counts.orders} 筆下單\n  ${pending.counts.settings} 個設定\n\n備份時間：${pending.exportedAt.slice(0, 19).replace('T', ' ')}`,
      )
    )
      return;
    setImporting(true);
    setError('');
    try {
      await importBackup(pending);
      setDoneMsg(`✓ 還原完成。重整頁面套用…`);
      setPending(null);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">資料備份 / 還原</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {exporting ? '匯出中…' : '⬇ 匯出備份'}
          </button>
          <label
            className={`px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}
          >
            ⬆ 選擇備份檔
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFilePick}
              className="hidden"
            />
          </label>
        </div>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          匯出 = 把所有病患、下單、設定打包成 JSON 檔下載到本機（建議每月做一次）。
          匯入 = 從備份還原，**會完全覆寫現有資料**。
        </p>
        {doneMsg && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            {doneMsg}
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
        {pending && (
          <div className="px-3 py-3 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-200 space-y-2">
            <div className="text-sm">
              <strong>準備還原：</strong>
              {pending.counts.patients} 病患 · {pending.counts.orders} 下單 · {pending.counts.settings} 設定
            </div>
            <div className="text-xs text-amber-300/80">
              備份時間：{pending.exportedAt.slice(0, 19).replace('T', ' ')} ·
              App 版本 {pending.appVersion} · 格式 v{pending.version}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={confirmImport}
                disabled={importing}
                className="px-3 py-1.5 rounded-md text-xs bg-rose-500 text-zinc-50 hover:bg-rose-400 transition disabled:opacity-50"
              >
                {importing ? '還原中…' : '⚠ 確認覆寫'}
              </button>
              <button
                onClick={() => setPending(null)}
                disabled={importing}
                className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 掃描資料夾 ─────────────────────────────────────────── */
type RoleInfo = {
  role: 'master' | 'follower';
  drive: string;
  dataRoot: string;
  scanFolder: string;
  scanFolderExists: boolean;
};

function RescanSection() {
  const [state, setState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<RescanResult | null>(null);
  const [error, setError] = useState('');
  const [roleInfo, setRoleInfo] = useState<RoleInfo | null>(null);
  const [roleError, setRoleError] = useState('');

  useEffect(() => {
    fetch('http://127.0.0.1:8765/role')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`role endpoint ${r.status}`))))
      .then((data: RoleInfo) => setRoleInfo(data))
      .catch((e: unknown) =>
        setRoleError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  async function go() {
    setState('scanning');
    setError('');
    setResult(null);
    try {
      const r = await rescanAndImport();
      setResult(r);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  const isMaster = roleInfo?.role === 'master';
  // 不再限制 master only — 兩台機器都能掃自己本地的 病患資料夾
  const canScan = roleInfo?.scanFolderExists === true;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">資料夾掃描</h2>
          {roleInfo && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                isMaster
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {roleInfo.role}
            </span>
          )}
        </div>
        <button
          onClick={go}
          disabled={state === 'scanning' || !canScan}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state === 'scanning' ? '🔄 掃描中…' : '🔄 立即掃描'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        {roleError && (
          <p className="text-xs text-amber-400/80">
            ⚠️ 無法取得本機角色（{roleError}）— helper service 沒跑？
          </p>
        )}
        {!roleInfo && !roleError && <p className="text-xs text-zinc-500">讀取本機角色中…</p>}
        {roleInfo && (
          <p className="text-xs text-zinc-500">
            掃描 <code className="text-zinc-400">{roleInfo.scanFolder}</code> 找新病患資料夾，
            <strong className="text-zinc-300">只新增不存在的</strong>（用姓名+生日比對），不會動既有編輯。
            {!roleInfo.scanFolderExists && (
              <span className="block mt-1 text-amber-400/80">
                ⚠️ 上述路徑不存在，無法掃描。請先把 矯正/ 資料夾搬到該位置。
              </span>
            )}
            {!isMaster && (
              <span className="block mt-1 text-zinc-600">
                提醒：此機為 follower。掃描出來的資料只在本機 IndexedDB；要跟 master 同步，請各自匯出 backup JSON 對賬。
              </span>
            )}
          </p>
        )}
        {state === 'done' && result && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            ✓ 新增 {result.added} 筆，已存在 {result.skipped} 筆 (共掃 {result.totalScanned})
            {result.added > 0 && result.added <= 10 && (
              <div className="text-xs text-emerald-400/80 mt-1">新增：{result.newNames.join('、')}</div>
            )}
          </div>
        )}
        {state === 'error' && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 掃 Excel 資料夾、跑 python 出 JSON ─────────────────── */
function ScanExcelSection() {
  const [state, setState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [logText, setLogText] = useState('');
  const [folder, setFolder] = useState('');

  async function go() {
    if (!confirm('掃描 D:\\矯正\\下單Excel\\ 內的 Excel 檔，跑 python import 重新產出 dev-data JSON。\n\n完成後還要按「重新套用 Excel 匯入」才會把資料套到 IndexedDB。')) return;
    setState('scanning');
    setError('');
    setLogText('');
    const r = await scanExcel();
    if (r.state === 'helper-down') {
      setError('本機 helper 沒回應');
      setState('error');
      return;
    }
    if (r.state === 'error') {
      setError(r.message);
      setState('error');
      return;
    }
    setFolder(r.excelFolder);
    setLogText(
      r.log
        .map((l) => `=== ${l.script} (exit ${l.exitCode}) ===\n${l.stdout ?? ''}${l.stderr ? '\n[stderr]\n' + l.stderr : ''}${l.error ? '\n[error] ' + l.error : ''}`)
        .join('\n\n'),
    );
    setState(r.success ? 'done' : 'error');
    if (!r.success) setError('一支或兩支 python script 退出碼非 0，看下方 log。');
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">掃描 Excel 資料夾</h2>
        <button
          onClick={go}
          disabled={state === 'scanning'}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'scanning' ? '📂 掃描中…' : '📂 立即掃描 Excel'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          讀 <code className="text-zinc-400">D:\矯正\下單Excel\</code>（筆電是 C:\）的 <code className="text-zinc-400">下單紀錄.xlsx</code> 跟 <code className="text-zinc-400">補充下單紀錄.xlsx</code>，跑 python 兩支 import 重產 dev-data JSON。
          <strong className="text-zinc-300 block mt-1">不會直接動 IndexedDB</strong>，跑完還要按下方「重新套用 Excel 匯入」才生效。
        </p>
        {state === 'done' && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            ✓ 掃描完成。現在按「重新套用 Excel 匯入」把更新套到 IndexedDB。
            {folder && <div className="text-zinc-500 mt-1">資料夾：{folder}</div>}
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        {logText && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">查看 python 輸出</summary>
            <pre className="mt-2 p-3 bg-zinc-950/60 rounded text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">{logText}</pre>
          </details>
        )}
      </div>
    </section>
  );
}

/* ─── 重新套用 Excel 匯入結果 ─────────────────────────────── */
function ReapplyExcelSection() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ReapplyResult | null>(null);
  const [error, setError] = useState('');

  async function go() {
    setState('running');
    setError('');
    setResult(null);
    try {
      const r = await reapplyExcelUpdates();
      setResult(r);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">重新套用 Excel 匯入</h2>
        <button
          onClick={go}
          disabled={state === 'running'}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⟳ 套用中…' : '⟳ 立即套用'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          讀 <code className="text-zinc-400">dev-data/excel-patient-updates.json</code> 與{' '}
          <code className="text-zinc-400">excel-orders.json</code>，把醫師 / 口掃 / 副數總數等資訊
          <strong>補進空欄位</strong>，不會覆蓋你已手動編輯過的值。沒下單的病患會新增 order，新建病患會補上。
        </p>
        {state === 'done' && result && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-0.5">
            <div>
              ✓ 病患更新：{result.updates.patientsPatched} 位（候選 {result.updates.candidates}，全已設過 {result.updates.skippedAllSet}，找不到 {result.updates.skippedNotFound}）
            </div>
            <div className="text-emerald-400/80 pl-4">
              · 醫師：+{result.updates.fieldsPatched.doctor} ·
              口掃：+{result.updates.fieldsPatched.scanInfo} ·
              副數：+{result.updates.fieldsPatched.totalAligners} ·
              授權書升級：+{result.updates.fieldsPatched.hasConsent}
            </div>
            <div>
              ✓ 新建病患：+{result.newPatients.added}（已存在 {result.newPatients.skippedExisted}）
            </div>
            <div>
              ✓ 下單紀錄：+{result.orders.added}（已存在 {result.orders.skippedExisted}）
            </div>
            <div>
              ✓ 從下單推算副數：{result.derivedCurrent.patientsUpdated} 位
            </div>
          </div>
        )}
        {state === 'error' && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
            ⚠️ {error}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 補生日（從資料夾名 match 同名 patient）─────────────── */
function BirthdayBackfillSection() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    candidatesCount: number;
    matched: { name: string; birthday: string; folder: string }[];
    ambiguous: { name: string; folders: string[] }[];
    notFound: string[];
  } | null>(null);

  const noBirthdayPatients =
    useLiveQuery(async () => {
      const all = await db.patients.toArray();
      return all.filter((p) => !p.birthday);
    }) ?? [];

  async function go() {
    setState('running');
    setError('');
    setResult(null);

    // 1. 讀目前 birthday=null 的病患
    const targets = await db.patients.toArray();
    const noBirthday = targets.filter((p) => !p.birthday);
    if (noBirthday.length === 0) {
      setError('沒有缺生日的病患');
      setState('error');
      return;
    }

    // 2. helper 列病患資料夾所有 folder 名
    // 用 D:\ 路徑，helper 會自動 path remap 到 C:\（如果在筆電）
    const r = await listFolderNames('D:\\矯正\\病患資料夾');
    if ('error' in r) {
      setError(`列資料夾失敗：${r.error}`);
      setState('error');
      return;
    }

    // 3. 對 folder 名解析、建 name → [folders] map
    const nameToFolders = new Map<string, { name: string; birthday: string; raw: string }[]>();
    for (const folderName of r.names) {
      const parsed = parseFolderName(folderName);
      if (!parsed.name || !parsed.birthday) continue;
      if (!nameToFolders.has(parsed.name)) nameToFolders.set(parsed.name, []);
      nameToFolders.get(parsed.name)!.push({
        name: parsed.name,
        birthday: parsed.birthday,
        raw: folderName,
      });
    }

    // 4. match
    const matched: { name: string; birthday: string; folder: string }[] = [];
    const ambiguous: { name: string; folders: string[] }[] = [];
    const notFound: string[] = [];
    const updates: { id: string; birthday: string; sourceFolder: string }[] = [];

    for (const p of noBirthday) {
      const candidates = nameToFolders.get(p.name);
      if (!candidates || candidates.length === 0) {
        notFound.push(p.name);
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({ name: p.name, folders: candidates.map((c) => c.raw) });
        continue;
      }
      const c = candidates[0];
      matched.push({ name: p.name, birthday: c.birthday, folder: c.raw });
      updates.push({
        id: p.id,
        birthday: c.birthday,
        sourceFolder: `${r.folder}\\${c.raw}`,
      });
    }

    // 5. 寫入 IndexedDB
    const nowIso = new Date().toISOString();
    for (const u of updates) {
      await db.patients.update(u.id, {
        birthday: u.birthday,
        sourceFolder: u.sourceFolder,
        updatedAt: nowIso,
      });
    }

    setResult({
      candidatesCount: noBirthday.length,
      matched,
      ambiguous,
      notFound,
    });
    setState('done');
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">補生日（從資料夾名）</h2>
          <span className="text-xs text-zinc-500">
            缺生日 {noBirthdayPatients.length} 人
          </span>
        </div>
        <button
          onClick={go}
          disabled={state === 'running' || noBirthdayPatients.length === 0}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⏳ 處理中…' : '🎯 立即補上'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          掃 <code className="text-zinc-400">D:\矯正\病患資料夾\</code> 找跟病患同名的資料夾，從資料夾名前 6-7 位民國年抽生日填回去。
          同名多個 → 標 ambiguous 不動、由你手動處理。
        </p>
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        {result && (
          <div className="space-y-2 text-xs">
            <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              ✓ 補上 {result.matched.length} / {result.candidatesCount} 人
              {result.ambiguous.length > 0 && ` · 同名多個 ${result.ambiguous.length}`}
              {result.notFound.length > 0 && ` · 找不到 ${result.notFound.length}`}
            </div>
            {result.matched.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 補上清單 ({result.matched.length})
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.matched.slice(0, 50).map((m) => (
                    <div key={m.folder} className="text-zinc-400">
                      {m.name} → {m.birthday} · <span className="text-zinc-600">{m.folder}</span>
                    </div>
                  ))}
                  {result.matched.length > 50 && (
                    <div className="text-zinc-600">... 還有 {result.matched.length - 50} 個</div>
                  )}
                </div>
              </details>
            )}
            {result.ambiguous.length > 0 && (
              <details>
                <summary className="cursor-pointer text-amber-400 hover:text-amber-300">
                  ⚠ 同名多個 ({result.ambiguous.length}) — 需手動處理
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.ambiguous.map((a) => (
                    <div key={a.name} className="text-zinc-400">
                      <strong className="text-zinc-200">{a.name}</strong>:
                      <ul className="ml-2">
                        {a.folders.map((f) => (
                          <li key={f}>· {f}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.notFound.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 找不到 ({result.notFound.length})
                </summary>
                <div className="mt-2 text-zinc-500 pl-3">{result.notFound.join('、')}</div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 資料庫管理 (原 偵錯 panel) ───────────────────────────── */
function DbSection() {
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  useEffect(() => {
    seedIfEmpty().then(setSeedResult);
  }, []);

  const stats = useLiveQuery(async () => {
    const all = await db.patients.toArray();
    const orders = await db.orders.toArray();
    const byStatus: Record<string, number> = {};
    const byProductLine: Record<string, number> = {};
    let withFlags = 0;
    for (const p of all) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byProductLine[p.productLine] = (byProductLine[p.productLine] || 0) + 1;
      if (p.flags?.length) withFlags++;
    }
    return { total: all.length, byStatus, byProductLine, withFlags, orderCount: orders.length };
  });

  async function reset() {
    if (!confirm('清空 IndexedDB？所有病患/下單/設定會被刪除，下次重整會重新匯入。')) return;
    await db.delete();
    location.reload();
  }

  async function resetLabsToDefaults() {
    if (!confirm('還原預設技工所 (美鉑/世宇/隱適美)？目前自定義的技工所會被覆寫。')) return;
    await saveLabs(DEFAULT_LABS);
  }
  async function resetDoctorsToDefaults() {
    if (!confirm('還原預設醫師 (陳執中/林英辰/張綺真)？目前自定義的醫師會被覆寫。')) return;
    await saveDoctors(DEFAULT_DOCTORS);
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">資料庫</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={resetLabsToDefaults} className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">還原預設技工所</button>
          <button onClick={resetDoctorsToDefaults} className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition">還原預設醫師</button>
          <button onClick={reset} className="px-3 py-1.5 rounded-md text-xs border border-rose-700/50 text-rose-300 hover:bg-rose-500/10 transition">清空 DB</button>
        </div>
      </header>
      <div className="p-5 space-y-3 text-sm">
        {seedResult?.seeded && (
          <div className="text-xs text-zinc-500">
            seed: 病患 {seedResult.patientCount} ({seedResult.newPatients} 新增) · 下單 {seedResult.orderCount} · patient updates {seedResult.updates}
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="病患總數" value={stats.total} accent />
            <Stat label="下單筆數" value={stats.orderCount} />
            <Stat label="有 flag 病患" value={stats.withFlags} />
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <Dist title="按 status" map={stats.byStatus} />
            <Dist title="按 productLine" map={stats.byProductLine} />
          </div>
        )}
        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          DevTools → Application → IndexedDB → aligner-tracker 看實際資料
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold tabular ${accent ? 'text-sky-300' : 'text-zinc-200'}`}>{value}</div>
    </div>
  );
}

function Dist({ title, map }: { title: string; map: Record<string, number> }) {
  return (
    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-3">
      <div className="text-xs text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1">
        {Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-zinc-400">{k}</span>
            <span className="text-zinc-200 tabular">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
