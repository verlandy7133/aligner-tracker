import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { getDataLayer } from '../lib/data-layer';
import UserManagementSection from '../components/UserManagementSection';
import type { Patient } from '../types/Patient';
import { rescanAndImport, type RescanResult } from '../lib/folder-rescan';
import { reapplyExcelUpdates, type ReapplyResult } from '../lib/reapply-excel';
import { mergePatients } from '../lib/merge-patients';
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
  checkPaths,
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
import { READ_ONLY } from '../lib/read-only';
import {
  scanMigration,
  applyMigration,
  type MigrationScan,
  type MigrationCandidate,
} from '../lib/path-migration';

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
      {/* v0.6.1: 帳號管理（admin only、非 admin 自動隱藏內容） */}
      {!READ_ONLY && <UserManagementSection />}
      {/* 以下 mutation section 在 readOnly mode 全隱藏（iPad 端只留視覺偏好）*/}
      {!READ_ONLY && (
        <>
          <UpdateSection />
          <PathsSection />
          <PathMigrationSection />
          <SyncSection />
          <LabSection />
          <DoctorSection />
          <AlertSection />
          <BackupSection />
          <RescanSection />
          <ExcelImportSection />
          <BirthdayBackfillSection />
          <DoctorBackfillSection />
          <LabBackfillSection />
          <DuplicateNameSection />
          <SourceFolderHealthSection />
          <DbSection />
        </>
      )}
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
      // v0.3.3+：用 dataRoot normalize、之後跨機還原 OK
      const dataRoot = await fetchDataRoot();
      const backup = await exportBackup(dataRoot);
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

/* ─── 路徑遷移（dataRoot 改了之後、批次改寫 IndexedDB 內舊路徑）─── */
function PathMigrationSection() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'scanned' | 'applying' | 'done' | 'error'>('idle');
  const [scan, setScan] = useState<MigrationScan | null>(null);
  const [result, setResult] = useState<{ updatedPatients: number; fieldsUpdated: number } | null>(null);
  const [error, setError] = useState('');
  const [paths, setPaths] = useState<{ dataRoot: string } | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:8765/paths')
      .then((r) => r.json())
      .then((p: { dataRoot: string }) => setPaths(p))
      .catch(() => {});
  }, []);

  async function doScan() {
    if (!paths?.dataRoot) {
      setError('讀不到當前 dataRoot 設定');
      setPhase('error');
      return;
    }
    setPhase('scanning');
    setError('');
    setScan(null);
    setResult(null);
    try {
      const r = await scanMigration(paths.dataRoot);
      setScan(r);
      setPhase('scanned');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function doApply() {
    if (!scan || scan.candidates.length === 0) return;
    if (
      !confirm(
        `將遷移 ${scan.candidates.length} 個路徑欄位到新 dataRoot：\n${paths?.dataRoot}\n\n建議先去「跨機同步」推一次 sync.json 當 backup、再執行此操作。\n\n繼續？`,
      )
    )
      return;
    setPhase('applying');
    setError('');
    try {
      const r = await applyMigration(scan.candidates);
      setResult(r);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">路徑遷移</h2>
          <span className="text-xs text-zinc-500">
            把 IndexedDB 內舊 sourceFolder / consentPdfPath 改寫到當前 dataRoot
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={doScan}
            disabled={phase === 'scanning' || phase === 'applying'}
            className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {phase === 'scanning' ? '🔍 掃描中…' : '🔍 掃描'}
          </button>
          {scan && scan.candidates.length > 0 && (
            <button
              onClick={doApply}
              disabled={phase === 'applying'}
              className="px-3 py-1.5 rounded-md text-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
            >
              {phase === 'applying' ? '⏳ 套用中…' : `⚡ 執行遷移 (${scan.candidates.length})`}
            </button>
          )}
        </div>
      </header>
      <div className="p-5 space-y-2 text-sm">
        {paths && (
          <p className="text-xs text-zinc-500">
            目標 dataRoot：<code className="text-zinc-300">{paths.dataRoot}</code>
            <br />
            支援自動偵測的舊 prefix：<code>C:\矯正\</code>、<code>D:\矯正\</code>、<code>W:\矯正追蹤\</code> →
            改寫成 <code>{paths.dataRoot}\</code>
          </p>
        )}
        {phase === 'scanned' && scan && (
          <div className="space-y-2">
            <div className="px-3 py-2 rounded-md bg-zinc-800/40 border border-zinc-700/40 text-xs">
              <div>
                掃描 <strong className="text-zinc-200">{scan.total}</strong> 個病患：
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-zinc-400">
                <div>
                  ✅ 已是新路徑：
                  <span className="text-emerald-400 tabular ml-1">{scan.alreadyCorrect}</span>
                </div>
                <div>
                  🔄 待遷移：
                  <span className="text-amber-400 tabular ml-1">{scan.candidates.length}</span>
                </div>
                <div>
                  ❓ 未知 prefix：
                  <span className="text-zinc-500 tabular ml-1">{scan.unknown}</span>
                </div>
              </div>
            </div>
            {scan.candidates.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 預覽前 5 筆變更
                </summary>
                <div className="mt-2 space-y-1 pl-3 font-mono text-[10px]">
                  {scan.candidates.slice(0, 5).map((c: MigrationCandidate, i) => (
                    <div key={i} className="text-zinc-400">
                      <div className="text-zinc-300">{c.name} · {c.field}</div>
                      <div className="text-rose-400/70">- {c.oldPath}</div>
                      <div className="text-emerald-400/70">+ {c.newPath}</div>
                    </div>
                  ))}
                  {scan.candidates.length > 5 && (
                    <div className="text-zinc-600">… 還有 {scan.candidates.length - 5} 筆</div>
                  )}
                </div>
              </details>
            )}
            {scan.candidates.length === 0 && (
              <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                ✓ 沒有需要遷移的路徑（全部已是新路徑或無 sourceFolder）
              </div>
            )}
          </div>
        )}
        {phase === 'done' && result && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            ✓ 完成：{result.updatedPatients} 個病患、{result.fieldsUpdated} 個欄位
            <br />
            <strong>下一步：</strong>Ctrl+Shift+R 重整 → 試「📁 開資料夾」確認 → 去「跨機同步」推到 NAS
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          場景：搬遷 dataRoot 後（例 C:\矯正 → W:\0矯正追蹤）、舊資料的 sourceFolder / 授權書 path 還是 C:\、需要這個工具批次改寫。
          先「掃描」看候選清單、預覽後再「執行遷移」、不會誤改。
        </p>
      </div>
    </section>
  );
}

/* ─── 跨機同步（推 / 拉 NAS sync.json）─────────────────── */
const SYNC_LAST_PUSHED_KEY = 'aligner-sync-last-pushed';

// v0.3.3+: 抓本機 dataRoot 給 normalize path 用
async function fetchDataRoot(): Promise<string> {
  try {
    const resp = await fetch('http://127.0.0.1:8765/paths');
    if (!resp.ok) return '';
    const data = (await resp.json()) as { dataRoot: string };
    return data.dataRoot || '';
  } catch {
    return '';
  }
}
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
      // v0.3.3+：抓本機 dataRoot 傳給 exportBackup、normalize path 成 relative
      // 跨機 sync 就不會因為 dataRoot 不同（W:\ vs D:\）path 不通
      const dataRoot = await fetchDataRoot();
      const backup = await exportBackup(dataRoot);
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
      // v0.3.3+：傳本機 dataRoot 給 importBackup、把 sync.json 內 relative path
      // 還原成本機 absolute path（跨機 dataRoot 不同也能 work）
      const dataRoot = await fetchDataRoot();
      await importBackup(validation.file, dataRoot);
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
          {/* v0.5.0: 批次重命名 order.lab 工具 (rename lab 不會 cascade 到既有 order) */}
          <div className="px-3 py-2 rounded-md bg-zinc-950/40 border border-dashed border-zinc-700 text-[11px] text-zinc-500">
            <div className="flex items-center justify-between gap-2">
              <span>批次重命名既有 order.lab（rename lab name 不會自動同步舊 order）</span>
              <button
                onClick={async () => {
                  const oldName = prompt('要重命名的舊 lab 名稱（例：美鉑）');
                  if (!oldName?.trim()) return;
                  const newName = prompt(`改成新名稱`, '鎂鉑');
                  if (!newName?.trim()) return;
                  const all = await db.orders.toArray();
                  const targets = all.filter((o) => (o.lab ?? '').trim() === oldName.trim());
                  if (targets.length === 0) {
                    alert(`沒有 order.lab="${oldName.trim()}" 的紀錄、無動作`);
                    return;
                  }
                  if (!confirm(`把 ${targets.length} 筆 order 的 lab="${oldName.trim()}" 改成 "${newName.trim()}"？\n不可復原。`)) return;
                  const nowIso = new Date().toISOString();
                  const dl = getDataLayer();
                  for (const o of targets) {
                    await dl.updateOrder(
                      o.id,
                      { lab: newName.trim(), updatedAt: nowIso },
                      o._version ?? 1,
                    );
                  }
                  alert(`✓ 已重命名 ${targets.length} 筆 order`);
                }}
                className="px-2 py-1 rounded text-[11px] border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition flex-shrink-0"
              >
                🔧 重命名…
              </button>
            </div>
          </div>
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
    setDoneMsg('');
    try {
      // v0.3.21: 同時做兩件事 — 本機下載 + 寫一份到 <dataRoot>\app-backups\
      //   1. dataRoot 用於 normalize path（跨機還原 OK）
      //   2. 本機下載先做（瀏覽器原生行為、不會失敗）
      //   3. NAS 寫入是 best effort — 失敗不擋本機下載、只顯示提示
      const dataRoot = await fetchDataRoot().catch(() => '');
      const backup = await exportBackup(dataRoot || undefined);

      // 步驟 2: 本機下載
      downloadBackup(backup);

      const counts = `${backup.counts.patients} 病患 / ${backup.counts.orders} 下單 / ${backup.counts.settings} 設定`;
      let msg = `✓ 已下載到本機 (${counts})`;

      // 步驟 3: 寫到 NAS（best effort）
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `manual-${dateStr}.json`;
      const json = JSON.stringify(backup, null, 2);
      const wb = await writeBackup(filename, json);
      if (wb.state === 'ok') {
        msg += `\n✓ 已存到 NAS：${wb.path}`;
      } else if (wb.state === 'helper-down') {
        msg += `\n⚠ NAS 備份跳過：本機 helper 沒回應`;
      } else {
        msg += `\n⚠ NAS 備份失敗：${wb.message}`;
      }

      setDoneMsg(msg);
      setTimeout(() => setDoneMsg(''), 10000);
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
          匯出 = 打包所有病患/下單/設定成 JSON、<strong className="text-zinc-300">同時下載到本機 + 寫一份到 NAS</strong>{' '}
          <code className="text-zinc-400">&lt;資料根&gt;\app-backups\manual-(時間).json</code>（建議每月做一次）。
          匯入 = 從備份還原、<strong className="text-rose-300">會完全覆寫現有資料</strong>。
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

/* ─── Excel 匯入：一鍵掃描 + 套用（v0.3.15 合併原本兩個 section）──── */
//   主按鈕：跑 python 出 dev-data JSON → 接著套進 IndexedDB（兩步串接）
//   進階折疊：分開執行兩步，供 debug / 確認 JSON 後再套用
function ExcelImportSection() {
  type Phase = 'idle' | 'scanning' | 'applying' | 'done' | 'error';
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [scanLog, setScanLog] = useState('');
  const [scanFolder, setScanFolder] = useState('');
  const [reapplyResult, setReapplyResult] = useState<ReapplyResult | null>(null);

  // ── 共用：跑掃描 ──────────────────────────────────────
  async function doScan(): Promise<boolean> {
    setPhase('scanning');
    setErrorMsg('');
    setScanLog('');
    setScanFolder('');
    setReapplyResult(null);
    const r = await scanExcel();
    if (r.state === 'helper-down') {
      setErrorMsg('本機 helper 沒回應');
      setPhase('error');
      return false;
    }
    if (r.state === 'error') {
      setErrorMsg(r.message);
      setPhase('error');
      return false;
    }
    setScanFolder(r.excelFolder);
    setScanLog(
      r.log
        .map((l) => `=== ${l.script} (exit ${l.exitCode}) ===\n${l.stdout ?? ''}${l.stderr ? '\n[stderr]\n' + l.stderr : ''}${l.error ? '\n[error] ' + l.error : ''}`)
        .join('\n\n'),
    );
    if (!r.success) {
      setErrorMsg('python script 退出碼非 0、看下方 log。');
      setPhase('error');
      return false;
    }
    return true;
  }

  // ── 共用：跑套用 ──────────────────────────────────────
  async function doApply(): Promise<boolean> {
    setPhase('applying');
    setErrorMsg('');
    try {
      const result = await reapplyExcelUpdates();
      setReapplyResult(result);
      setPhase('done');
      return true;
    } catch (e) {
      setErrorMsg(`套用階段失敗：${e instanceof Error ? e.message : String(e)}`);
      setPhase('error');
      return false;
    }
  }

  // ── 一鍵：掃 → 套 ────────────────────────────────────
  async function runAll() {
    const ok = await doScan();
    if (!ok) return;
    await doApply();
  }

  // ── 進階：只掃 ────────────────────────────────────────
  async function runScanOnly() {
    const ok = await doScan();
    if (ok) setPhase('done'); // reapplyResult 仍 null → UI 自動顯示「掃描完成、待套用」提示
  }

  // ── 進階：只套用 ──────────────────────────────────────
  async function runApplyOnly() {
    setScanLog(''); // 清掉舊 log 避免混淆
    setScanFolder('');
    await doApply();
  }

  const isRunning = phase === 'scanning' || phase === 'applying';
  const mainLabel =
    phase === 'scanning' ? '⟳ (1/2) 掃描中…'
      : phase === 'applying' ? '⟳ (2/2) 套用中…'
      : '📥 掃描並套用 Excel';

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Excel 匯入</h2>
        <button
          onClick={runAll}
          disabled={isRunning}
          className="px-3 py-1.5 rounded-md text-xs border border-sky-700/60 bg-sky-600/10 text-sky-200 hover:bg-sky-600/20 transition disabled:opacity-50"
        >
          {mainLabel}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          一鍵：(1) 掃 <code className="text-zinc-400">{'<資料根>\\下單Excel\\'}</code> 內含「生產資料庫」+「牙套下單」兩個 sheet 的 .xlsx、跑 python 重產 dev-data JSON →
          (2) 把醫師 / 口掃 / 副數總數等資訊<strong className="text-zinc-300">補進空欄位</strong>（不覆蓋已手動編輯的值）、補新病患、補新下單。
        </p>

        {phase === 'done' && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-0.5">
            {reapplyResult ? (
              <>
                <div>
                  ✓ 病患更新：{reapplyResult.updates.patientsPatched} 位（候選 {reapplyResult.updates.candidates}，全已設過 {reapplyResult.updates.skippedAllSet}，找不到 {reapplyResult.updates.skippedNotFound}）
                </div>
                <div className="text-emerald-400/80 pl-4">
                  · 醫師：+{reapplyResult.updates.fieldsPatched.doctor} ·
                  口掃：+{reapplyResult.updates.fieldsPatched.scanInfo} ·
                  副數：+{reapplyResult.updates.fieldsPatched.totalAligners} ·
                  授權書升級：+{reapplyResult.updates.fieldsPatched.hasConsent}
                </div>
                <div>
                  ✓ 新建病患：+{reapplyResult.newPatients.added}（已存在 {reapplyResult.newPatients.skippedExisted}）
                  {reapplyResult.newPatients.matchedFromFolder > 0 && (
                    <span className="text-emerald-400/80 ml-1">
                      · 其中 {reapplyResult.newPatients.matchedFromFolder} 位 match 到資料夾自動補生日+路徑
                    </span>
                  )}
                </div>
                <div>
                  ✓ 下單紀錄：+{reapplyResult.orders.added}（已存在 {reapplyResult.orders.skippedExisted}）
                </div>
                <div>
                  ✓ 從下單推算副數：{reapplyResult.derivedCurrent.patientsUpdated} 位
                </div>
              </>
            ) : (
              <div>
                ✓ 掃描完成、dev-data JSON 已產出。要套到 IndexedDB 請按下方「⟳ 只套用」。
              </div>
            )}
            {scanFolder && <div className="text-zinc-500 mt-1">資料夾：{scanFolder}</div>}
          </div>
        )}

        {phase === 'error' && errorMsg && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {errorMsg}
          </div>
        )}

        {scanLog && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">查看 python 輸出</summary>
            <pre className="mt-2 p-3 bg-zinc-950/60 rounded text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">{scanLog}</pre>
          </details>
        )}

        <details className="text-xs pt-1">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">⚙ 進階：分開執行（debug 用）</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={runScanOnly}
              disabled={isRunning}
              className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              📂 只掃描（產 JSON、不動 IndexedDB）
            </button>
            <button
              onClick={runApplyOnly}
              disabled={isRunning}
              className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              ⟳ 只套用（讀現有 JSON 套進 IndexedDB）
            </button>
          </div>
          <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
            分開執行時機：想先看 python 輸出 / 確認 dev-data JSON 沒問題、再決定要不要套到 IndexedDB。
            一般使用按上面「掃描並套用」就好。
          </p>
        </details>
      </div>
    </section>
  );
}

/* ─── 補生日 + 資料夾（從資料夾名 match 同名 patient）───────────
 *   v0.4.3: 三項升級
 *     1. 路徑改 dynamic dataRoot (原寫死 D:\矯正\、筆電會 fail)
 *     2. 擴大掃描範圍：缺 birthday OR 缺 sourceFolder OR sourceFolder 包含舊 prefix
 *     3. 只補「缺的欄位」、不覆蓋既有有效值
 */
function BirthdayBackfillSection() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    candidatesCount: number;
    matched: {
      name: string;
      birthday: string | null;
      folder: string;
      patched: ('birthday' | 'sourceFolder')[];
    }[];
    ambiguous: { name: string; folders: string[] }[];
    notFound: string[];
  } | null>(null);

  // 候選 = 缺 birthday 或 缺 sourceFolder
  const candidatePatients =
    useLiveQuery(async () => {
      const all = await db.patients.toArray();
      return all.filter((p) => !p.birthday || !p.sourceFolder);
    }) ?? [];

  async function go() {
    setState('running');
    setError('');
    setResult(null);

    // 1. 拿當前 dataRoot
    const pathsResult = await getPaths();
    if (pathsResult.state !== 'ok' || !pathsResult.paths?.dataRoot) {
      setError(
        pathsResult.state === 'helper-down'
          ? '本機 helper 沒回應'
          : pathsResult.state === 'error'
            ? pathsResult.message
            : '找不到當前 dataRoot 設定',
      );
      setState('error');
      return;
    }
    const folderRoot = pathsResult.paths.dataRoot.replace(/\\+$/, '') + '\\病患資料夾';

    // 2. 讀候選病患（缺 birthday OR 缺 sourceFolder）
    const targets = await db.patients.toArray();
    const candidates = targets.filter((p) => !p.birthday || !p.sourceFolder);
    if (candidates.length === 0) {
      setError('沒有缺生日或缺資料夾的病患');
      setState('error');
      return;
    }

    // 3. helper 列資料夾
    const r = await listFolderNames(folderRoot);
    if ('error' in r) {
      setError(`列資料夾失敗：${r.error}（${folderRoot}）`);
      setState('error');
      return;
    }

    // 4. 對 folder 名解析、建 name → [folders] map
    //    這次保留「能 parse 出姓名但 birthday null」的、給「只缺 sourceFolder 不缺 birthday」case 用
    const nameToFolders = new Map<
      string,
      { name: string; birthday: string | null; raw: string }[]
    >();
    for (const folderName of r.names) {
      const parsed = parseFolderName(folderName);
      if (!parsed.name) continue;
      if (!nameToFolders.has(parsed.name)) nameToFolders.set(parsed.name, []);
      nameToFolders.get(parsed.name)!.push({
        name: parsed.name,
        birthday: parsed.birthday,
        raw: folderName,
      });
    }

    // 5. match + patch（只補空欄位、不蓋有效值）
    const matched: {
      name: string;
      birthday: string | null;
      folder: string;
      patched: ('birthday' | 'sourceFolder')[];
    }[] = [];
    const ambiguous: { name: string; folders: string[] }[] = [];
    const notFound: string[] = [];

    const nowIso = new Date().toISOString();
    for (const p of candidates) {
      const folders = nameToFolders.get(p.name);
      if (!folders || folders.length === 0) {
        notFound.push(`${p.chartNo} ${p.name}`);
        continue;
      }
      if (folders.length > 1) {
        ambiguous.push({ name: `${p.chartNo} ${p.name}`, folders: folders.map((c) => c.raw) });
        continue;
      }
      const c = folders[0];
      const patch: Partial<Patient> = { updatedAt: nowIso };
      const patched: ('birthday' | 'sourceFolder')[] = [];
      if (!p.birthday && c.birthday) {
        patch.birthday = c.birthday;
        patched.push('birthday');
      }
      if (!p.sourceFolder) {
        patch.sourceFolder = `${r.folder.replace(/\\+$/, '')}\\${c.raw}`;
        patched.push('sourceFolder');
      }
      if (patched.length === 0) {
        // 該 patient 雖在 candidates、但實際沒缺的欄位能補（理論上不會發生、保險）
        continue;
      }
      await getDataLayer().updatePatient(p.id, patch, p._version ?? 1);
      matched.push({
        name: `${p.chartNo} ${p.name}`,
        birthday: c.birthday,
        folder: c.raw,
        patched,
      });
    }

    setResult({
      candidatesCount: candidates.length,
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
          <h2 className="text-sm font-medium text-zinc-200">補生日 + 資料夾路徑（從資料夾名）</h2>
          <span className="text-xs text-zinc-500">
            候選 {candidatePatients.length} 人
          </span>
        </div>
        <button
          onClick={go}
          disabled={state === 'running' || candidatePatients.length === 0}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⏳ 處理中…' : '🎯 立即補上'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          掃 <code className="text-zinc-400">{'<資料根>\\病患資料夾\\'}</code> 找跟病患同姓名的資料夾、
          幫缺 birthday / 缺 sourceFolder 的病患<strong className="text-zinc-300">補上空欄位</strong>（不蓋既有有效值）。
          同名多筆 → 標 ambiguous 不動、由你手動處理。
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
                  {result.matched.slice(0, 50).map((m, i) => (
                    <div key={`${m.folder}-${i}`} className="text-zinc-400">
                      <span className="text-zinc-300">{m.name}</span>
                      <span className="text-zinc-600 mx-1">→</span>
                      <span className="text-emerald-400/80">補：{m.patched.join(' + ')}</span>
                      {m.birthday && <span className="text-zinc-600 ml-1">({m.birthday})</span>}
                      <span className="text-zinc-600 ml-1">· {m.folder}</span>
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

/* ─── 從下單記錄補醫師（v0.4.4 新增、v0.4.5 加 Excel fallback）───────
 *   候選 = patient.doctor 空、且 status 不是 completed / transferred-out
 *   兩階段查詢：
 *     A. IndexedDB orders：對每位看 orders 內 doctor 欄
 *     B. fallback 查 dev-data/excel-orders.json：如果 IndexedDB 沒 order 但 Excel 有
 *        （這 case 是 import 時 patientId 對不上、order 沒進 IndexedDB）
 *   分類：
 *     - matched (DB)：從 IndexedDB orders 找到唯一醫師、補進去
 *     - matched (Excel)：IndexedDB 無 order、fallback Excel 找到唯一醫師、補進去
 *     - ambiguous：多位不同醫師、不動
 *     - 真的沒救：兩邊都沒 order / 兩邊都缺 doctor
 *   不蓋既有有效值。
 */
function DoctorBackfillSection() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    candidatesCount: number;
    matched: {
      chartNo: string;
      name: string;
      doctor: string;
      source: 'db' | 'excel' | 'transferred';
      orderCount: number;
    }[];
    ambiguous: { chartNo: string; name: string; doctors: string[]; source: 'db' | 'excel' | 'transferred' }[];
    truelyNoData: { chartNo: string; name: string }[];
  } | null>(null);

  const candidatePatients =
    useLiveQuery(async () => {
      const all = await db.patients.toArray();
      return all.filter(
        (p) =>
          (!p.doctor || !p.doctor.trim()) &&
          p.status !== 'completed' &&
          p.status !== 'transferred-out',
      );
    }) ?? [];

  async function go() {
    setState('running');
    setError('');
    setResult(null);

    const allPatients = await db.patients.toArray();
    const candidates = allPatients.filter(
      (p) =>
        (!p.doctor || !p.doctor.trim()) &&
        p.status !== 'completed' &&
        p.status !== 'transferred-out',
    );
    if (candidates.length === 0) {
      setError('沒有缺醫師的病患（completed / transferred-out 不算）');
      setState('error');
      return;
    }

    // 階段 1: IndexedDB orders
    const allOrders = await db.orders.toArray();
    const ordersByPatient = new Map<string, typeof allOrders>();
    for (const o of allOrders) {
      if (!ordersByPatient.has(o.patientId)) ordersByPatient.set(o.patientId, []);
      ordersByPatient.get(o.patientId)!.push(o);
    }

    // 階段 2 (fallback): dev-data/excel-orders.json
    //   - 用 patientName trim 當 key (Excel 沒可靠 id 對映)
    //   - 若 IndexedDB 找不到、就查這份
    let excelOrdersByName = new Map<string, { doctor: string }[]>();
    try {
      const mod = await import('../../dev-data/excel-orders.json');
      const data = (mod as unknown as { default: { orders: { patientName: string; doctor: string }[] } }).default;
      for (const o of data?.orders ?? []) {
        const key = o.patientName?.trim();
        if (!key) continue;
        if (!excelOrdersByName.has(key)) excelOrdersByName.set(key, []);
        excelOrdersByName.get(key)!.push({ doctor: o.doctor });
      }
    } catch {
      // dev-data 缺 → fallback 留空、不擋主邏輯
      excelOrdersByName = new Map();
    }

    // 階段 3 (v0.4.14 加): dev-data/excel-transferred.json — Excel「轉隱適美」等轉品牌分頁
    //   Python script 需先加讀該 sheet (目前 import-clinic-takeover.py 只讀生產資料庫 + 牙套下單)
    //   用 import.meta.glob (build-time glob、檔不存在不 error、只是 modules 空 object)
    //   schema 假設：{ rows: [{ patientName, doctor, sourceSheet }] }
    let transferredByName = new Map<string, { doctor: string; sheet: string }[]>();
    try {
      const transferredModules = import.meta.glob('../../dev-data/excel-transferred.json');
      const loader = Object.values(transferredModules)[0];
      if (loader) {
        const mod = (await loader()) as {
          default: { rows: { patientName: string; doctor: string; sourceSheet?: string }[] };
        };
        for (const r of mod.default?.rows ?? []) {
          const key = r.patientName?.trim();
          if (!key) continue;
          if (!transferredByName.has(key)) transferredByName.set(key, []);
          transferredByName.get(key)!.push({ doctor: r.doctor, sheet: r.sourceSheet ?? '轉品牌' });
        }
      }
    } catch {
      transferredByName = new Map();
    }

    const matched: {
      chartNo: string;
      name: string;
      doctor: string;
      source: 'db' | 'excel' | 'transferred';
      orderCount: number;
    }[] = [];
    const ambiguous: {
      chartNo: string;
      name: string;
      doctors: string[];
      source: 'db' | 'excel' | 'transferred';
    }[] = [];
    const truelyNoData: { chartNo: string; name: string }[] = [];

    const nowIso = new Date().toISOString();
    for (const p of candidates) {
      // 階段 1: 查 IndexedDB orders
      const dbOrders = ordersByPatient.get(p.id) ?? [];
      const dbDoctors = [
        ...new Set(dbOrders.map((o) => o.doctor?.trim()).filter((d): d is string => !!d)),
      ];
      if (dbDoctors.length === 1) {
        await getDataLayer().updatePatient(
          p.id,
          { doctor: dbDoctors[0], updatedAt: nowIso },
          p._version ?? 1,
        );
        matched.push({
          chartNo: p.chartNo,
          name: p.name,
          doctor: dbDoctors[0],
          source: 'db',
          orderCount: dbOrders.length,
        });
        continue;
      }
      if (dbDoctors.length > 1) {
        ambiguous.push({
          chartNo: p.chartNo,
          name: p.name,
          doctors: dbDoctors,
          source: 'db',
        });
        continue;
      }

      // 階段 2 fallback: 查 Excel orders（IndexedDB 沒 order 或 order 缺 doctor 都試）
      const excelDoctorsList = excelOrdersByName.get(p.name) ?? [];
      const excelDoctors = [
        ...new Set(excelDoctorsList.map((o) => o.doctor?.trim()).filter((d): d is string => !!d)),
      ];
      if (excelDoctors.length === 1) {
        await getDataLayer().updatePatient(
          p.id,
          { doctor: excelDoctors[0], updatedAt: nowIso },
          p._version ?? 1,
        );
        matched.push({
          chartNo: p.chartNo,
          name: p.name,
          doctor: excelDoctors[0],
          source: 'excel',
          orderCount: excelDoctorsList.length,
        });
        continue;
      }
      if (excelDoctors.length > 1) {
        ambiguous.push({
          chartNo: p.chartNo,
          name: p.name,
          doctors: excelDoctors,
          source: 'excel',
        });
        continue;
      }

      // 階段 3 (v0.4.14) fallback: 查 Excel 轉品牌分頁 (轉隱適美 等)
      const transferredList = transferredByName.get(p.name) ?? [];
      const transferredDoctors = [
        ...new Set(transferredList.map((r) => r.doctor?.trim()).filter((d): d is string => !!d)),
      ];
      if (transferredDoctors.length === 1) {
        await getDataLayer().updatePatient(
          p.id,
          { doctor: transferredDoctors[0], updatedAt: nowIso },
          p._version ?? 1,
        );
        matched.push({
          chartNo: p.chartNo,
          name: p.name,
          doctor: transferredDoctors[0],
          source: 'transferred',
          orderCount: transferredList.length,
        });
        continue;
      }
      if (transferredDoctors.length > 1) {
        ambiguous.push({
          chartNo: p.chartNo,
          name: p.name,
          doctors: transferredDoctors,
          source: 'transferred',
        });
        continue;
      }

      // 三階段都沒救
      truelyNoData.push({ chartNo: p.chartNo, name: p.name });
    }

    setResult({
      candidatesCount: candidates.length,
      matched,
      ambiguous,
      truelyNoData,
    });
    setState('done');
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">補醫師（從下單記錄）</h2>
          <span className="text-xs text-zinc-500">候選 {candidatePatients.length} 人</span>
        </div>
        <button
          onClick={go}
          disabled={state === 'running' || candidatePatients.length === 0}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⏳ 處理中…' : '👤 立即補上'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          掃缺醫師的病患、三階段查詢補回：
          <strong className="text-zinc-300 block mt-1">
            (1) IndexedDB orders → (2)
            <code className="text-zinc-400 mx-1">dev-data/excel-orders.json</code> → (3)
            <code className="text-zinc-400 mx-1">dev-data/excel-transferred.json</code>（轉隱適美等分頁）
          </strong>
          唯一一位醫師才補。completed / transferred-out 的病患不算。
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
              {' '}(DB {result.matched.filter((m) => m.source === 'db').length}
              {' '}/ Excel {result.matched.filter((m) => m.source === 'excel').length}
              {' '}/ 轉品牌 {result.matched.filter((m) => m.source === 'transferred').length})
              {result.ambiguous.length > 0 && ` · 多位醫師 ${result.ambiguous.length}`}
              {result.truelyNoData.length > 0 && ` · 三邊都查無 ${result.truelyNoData.length}`}
            </div>
            {result.matched.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 補上清單 ({result.matched.length})
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.matched.slice(0, 50).map((m, i) => (
                    <div key={`${m.chartNo}-${i}`} className="text-zinc-400">
                      <span className="font-mono text-sky-300">{m.chartNo}</span>{' '}
                      <span className="text-zinc-300">{m.name}</span>
                      <span className="text-zinc-600 mx-1">→</span>
                      <span className="text-emerald-400/80">{m.doctor}</span>
                      <span
                        className={`text-[10px] ml-1 ${
                          m.source === 'db'
                            ? 'text-sky-400/70'
                            : m.source === 'excel'
                              ? 'text-amber-400/70'
                              : 'text-fuchsia-400/70'
                        }`}
                      >
                        [
                        {m.source === 'db'
                          ? `DB·${m.orderCount} 筆`
                          : m.source === 'excel'
                            ? `Excel·${m.orderCount} 筆`
                            : `轉品牌·${m.orderCount} 筆`}
                        ]
                      </span>
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
                  ⚠ 多位醫師（{result.ambiguous.length}）— 不同 order 對應不同醫師、不自動補
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.ambiguous.map((a) => (
                    <div key={a.chartNo} className="text-zinc-400">
                      <span className="font-mono text-sky-300">{a.chartNo}</span>{' '}
                      <strong className="text-zinc-200">{a.name}</strong>:
                      <span className="text-amber-300 ml-1">{a.doctors.join(' / ')}</span>
                      <span className="text-[10px] text-zinc-500 ml-1">[from {a.source}]</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.truelyNoData.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 兩邊都查無（{result.truelyNoData.length}）— IndexedDB 沒 order、Excel 也沒
                </summary>
                <div className="mt-2 space-y-1 pl-3 text-zinc-500">
                  {result.truelyNoData
                    .slice(0, 30)
                    .map((p) => `${p.chartNo} ${p.name}`)
                    .join('、')}
                  {result.truelyNoData.length > 30 && ` ... +${result.truelyNoData.length - 30}`}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 從資料夾名補技工所（v0.4.14 新增）─────────────────────────
 *   候選：order.lab 空
 *   邏輯：對每個 order、查 patient.sourceFolder + allSourceFolders 是否含技工所名
 *     - 唯一 1 個 lab name match → 自動補 order.lab
 *     - 多個 lab match → 標 ambiguous 不動
 *     - 沒 match → 標 not-found 不動
 *   技工所列表動態 from useLabs() — 預設「鎂鉑 / 世宇 / 隱適美」、user 可在設定改
 */
function LabBackfillSection() {
  const labs = useLabs();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    candidatesCount: number;
    matched: { chartNo: string; name: string; lab: string; date: string }[];
    ambiguous: { chartNo: string; name: string; labs: string[]; date: string }[];
    notFound: { chartNo: string; name: string; date: string }[];
  } | null>(null);

  const candidateCount =
    useLiveQuery(async () => {
      const all = await db.orders.toArray();
      return all.filter((o) => !o.lab?.trim()).length;
    }) ?? 0;

  async function go() {
    setState('running');
    setError('');
    setResult(null);

    const allOrders = await db.orders.toArray();
    const allPatients = await db.patients.toArray();
    const patientById = new Map(allPatients.map((p) => [p.id, p]));

    const candidates = allOrders.filter((o) => !o.lab?.trim());
    if (candidates.length === 0) {
      setError('沒有缺技工所的 order');
      setState('error');
      return;
    }

    const matched: { chartNo: string; name: string; lab: string; date: string }[] = [];
    const ambiguous: { chartNo: string; name: string; labs: string[]; date: string }[] = [];
    const notFound: { chartNo: string; name: string; date: string }[] = [];

    const nowIso = new Date().toISOString();
    const labNames = labs.map((l) => l.name).filter((n): n is string => !!n?.trim());

    for (const o of candidates) {
      const p = patientById.get(o.patientId);
      if (!p) {
        notFound.push({ chartNo: o.patientChartNo, name: o.patientName, date: o.date });
        continue;
      }
      // 從 patient sourceFolder + allSourceFolders + order.notes 找技工所名
      const haystack = [
        p.sourceFolder ?? '',
        ...(p.allSourceFolders ?? []),
        o.notes ?? '',
      ].join(' ');

      const foundLabs = [...new Set(labNames.filter((name) => haystack.includes(name)))];

      if (foundLabs.length === 1) {
        await getDataLayer().updateOrder(
          o.id,
          { lab: foundLabs[0], updatedAt: nowIso },
          o._version ?? 1,
        );
        matched.push({
          chartNo: p.chartNo,
          name: p.name,
          lab: foundLabs[0],
          date: o.date,
        });
      } else if (foundLabs.length > 1) {
        ambiguous.push({
          chartNo: p.chartNo,
          name: p.name,
          labs: foundLabs,
          date: o.date,
        });
      } else {
        notFound.push({ chartNo: p.chartNo, name: p.name, date: o.date });
      }
    }

    setResult({
      candidatesCount: candidates.length,
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
          <h2 className="text-sm font-medium text-zinc-200">補技工所（從資料夾名）</h2>
          <span className="text-xs text-zinc-500">候選 {candidateCount} 筆 order</span>
        </div>
        <button
          onClick={go}
          disabled={state === 'running' || candidateCount === 0}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'running' ? '⏳ 處理中…' : '🔧 立即補上'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500">
          掃缺技工所的 order、查該 patient 的 sourceFolder / allSourceFolders / order.notes 是否含技工所名
          (<span className="text-zinc-400">{labs.map((l) => l.name).join(' / ') || '無'}</span>)。
          <strong className="text-zinc-300 block mt-1">唯一 1 個 match 才補</strong>、
          多個 / 沒 match 不動。技工所列表可在「技工所管理」section 修改。
        </p>
        {error && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        {result && (
          <div className="space-y-2 text-xs">
            <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              ✓ 補上 {result.matched.length} / {result.candidatesCount} 筆 order
              {result.ambiguous.length > 0 && ` · 多個技工所 ${result.ambiguous.length}`}
              {result.notFound.length > 0 && ` · 找不到 ${result.notFound.length}`}
            </div>
            {result.matched.length > 0 && (
              <details>
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  ▸ 補上清單 ({result.matched.length})
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.matched.slice(0, 50).map((m, i) => (
                    <div key={`${m.chartNo}-${m.date}-${i}`} className="text-zinc-400">
                      <span className="font-mono text-sky-300">{m.chartNo}</span>{' '}
                      <span className="text-zinc-300">{m.name}</span>
                      <span className="text-zinc-600 mx-1">·</span>
                      <span className="text-zinc-500">{m.date}</span>
                      <span className="text-zinc-600 mx-1">→</span>
                      <span className="text-emerald-400/80">{m.lab}</span>
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
                  ⚠ 多個技工所（{result.ambiguous.length}）— sourceFolder 同時含多個技工所名、不自動補
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {result.ambiguous.map((a, i) => (
                    <div key={`${a.chartNo}-${a.date}-${i}`} className="text-zinc-400">
                      <span className="font-mono text-sky-300">{a.chartNo}</span>{' '}
                      <strong className="text-zinc-200">{a.name}</strong>
                      <span className="text-zinc-500 ml-1">({a.date})</span>:
                      <span className="text-amber-300 ml-1">{a.labs.join(' / ')}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── 同名病患統計（v0.3.17 新增）─────────────────────────────
 *   分兩類：
 *     🔴 suspected = 同名 + 同生日 / 或同名 + 至少一筆缺生日（dedup miss、疑似重複）
 *     🟡 homonym   = 同名 + 每筆生日都不同且非 null（真同名巧合）
 *   每組可展開、列每筆 chartNo / 生日 / 醫師 / 來源資料夾、點任一筆跳病患詳細頁。
 */
type DupGroup = {
  name: string;
  list: Patient[];
  kind: 'suspected' | 'homonym';
};

function classifyDupGroup(list: Patient[]): 'suspected' | 'homonym' {
  // 看 (姓名, 生日) tuple 是否有重複、或是否有 null birthday
  const seenBdays = new Set<string>();
  let hasNull = false;
  let hasDup = false;
  for (const p of list) {
    const bday = p.birthday ?? '';
    if (!bday) hasNull = true;
    else if (seenBdays.has(bday)) hasDup = true;
    else seenBdays.add(bday);
  }
  return hasNull || hasDup ? 'suspected' : 'homonym';
}

function DuplicateNameSection() {
  const allPatients = useLiveQuery(() => db.patients.toArray()) ?? [];

  // 同名分組
  const byName = new Map<string, Patient[]>();
  for (const p of allPatients) {
    const key = (p.name ?? '').trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p);
  }

  const dupGroups: DupGroup[] = [...byName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, list, kind: classifyDupGroup(list) }))
    .sort((a, b) => {
      // suspected 先、再依筆數多到少
      if (a.kind !== b.kind) return a.kind === 'suspected' ? -1 : 1;
      return b.list.length - a.list.length;
    });

  const suspected = dupGroups.filter((g) => g.kind === 'suspected');
  const homonyms = dupGroups.filter((g) => g.kind === 'homonym');
  const totalDupPatients = dupGroups.reduce((s, g) => s + g.list.length, 0);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-200">同名病患統計</h2>
      </header>
      <div className="p-5 space-y-3 text-sm">
        <p className="text-xs text-zinc-500 leading-relaxed">
          掃描 IndexedDB 內所有病患、依姓名分組。<strong className="text-rose-300">疑似重複</strong>
          通常是 dedup 比對失敗造成（生日缺漏 / 格式不一致），<strong className="text-amber-300">同名巧合</strong>
          是真的不同人、不用處理。
        </p>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <StatBox label="同名組數" value={dupGroups.length} />
          <StatBox label="🔴 疑似重複" value={suspected.length} tone="rose" />
          <StatBox label="🟡 同名巧合" value={homonyms.length} tone="amber" />
        </div>

        {dupGroups.length === 0 && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            ✓ 沒有同名病患（總計 {allPatients.length} 位都是獨一無二的姓名）
          </div>
        )}

        {suspected.length > 0 && (
          <details className="text-xs" open>
            <summary className="cursor-pointer text-rose-300 hover:text-rose-200 font-medium">
              🔴 疑似重複（{suspected.length} 組 / 共 {suspected.reduce((s, g) => s + g.list.length, 0)} 筆）
            </summary>
            <div className="mt-2 space-y-2">
              {suspected.map((g) => (
                <DupGroupCard key={g.name} group={g} />
              ))}
            </div>
          </details>
        )}

        {homonyms.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-amber-300 hover:text-amber-200 font-medium">
              🟡 同名巧合（{homonyms.length} 組 / 共 {homonyms.reduce((s, g) => s + g.list.length, 0)} 筆）
            </summary>
            <div className="mt-2 space-y-2">
              {homonyms.map((g) => (
                <DupGroupCard key={g.name} group={g} />
              ))}
            </div>
          </details>
        )}

        {dupGroups.length > 0 && (
          <p className="text-[11px] text-zinc-600 leading-relaxed pt-1">
            點 chartNo 跳到該病患詳細頁、或按組右上「🔗 合併此組」一鍵合併（會把下單轉到保留筆、空欄位互補、notes concat、然後刪掉多餘病患）。
            <strong className="text-rose-400 block mt-1">
              ⚠️ 合併不可復原 — 動作前建議先到「資料備份/還原」匯出 backup。
            </strong>
          </p>
        )}

        <p className="text-[11px] text-zinc-600 pt-1">
          總共 {allPatients.length} 位病患、其中 {totalDupPatients} 筆牽涉同名（{((totalDupPatients / Math.max(allPatients.length, 1)) * 100).toFixed(1)}%）
        </p>
      </div>
    </section>
  );
}

function StatBox({
  label,
  value,
  tone = 'zinc',
}: {
  label: string;
  value: number;
  tone?: 'zinc' | 'rose' | 'amber';
}) {
  const toneCls =
    tone === 'rose'
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-200'
      : tone === 'amber'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
      : 'border-zinc-700 bg-zinc-900/40 text-zinc-200';
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function DupGroupCard({ group }: { group: DupGroup }) {
  // 同組內按 chartNo ASC 排序
  const sorted = [...group.list].sort((a, b) => (a.chartNo ?? '').localeCompare(b.chartNo ?? ''));
  const [mergeMode, setMergeMode] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function doMerge() {
    if (!keepId) return;
    const keep = sorted.find((p) => p.id === keepId);
    if (!keep) return;
    const toMerge = sorted.filter((p) => p.id !== keepId);

    // 預先 count source 的 order 數，用於 confirm dialog
    const orderCounts = await Promise.all(
      toMerge.map((p) => db.orders.where('patientId').equals(p.id).count()),
    );
    const totalOrders = orderCounts.reduce((s, c) => s + c, 0);

    const lines = [
      `確定要合併下列病患？`,
      ``,
      `★ 保留：${keep.chartNo} ${keep.name}（${keep.birthday ?? '無生日'}）`,
      ...toMerge.map(
        (p, i) =>
          `✗ 刪除：${p.chartNo} ${p.name}（${p.birthday ?? '無生日'}）— ${orderCounts[i]} 筆下單`,
      ),
      ``,
      `動作：把 ${totalOrders} 筆下單轉到保留筆 → target 空欄位從 source 補 → notes 合併 → 刪除其他病患`,
      ``,
      `⚠️ 不可復原（建議先「資料備份/還原」匯出 backup 再執行）`,
    ];
    if (!confirm(lines.join('\n'))) return;

    setBusy(true);
    setMsg(null);
    try {
      let totalTransferred = 0;
      const mergedFields = new Set<string>();
      for (const src of toMerge) {
        const r = await mergePatients(src.id, keepId);
        totalTransferred += r.ordersTransferred;
        r.fieldsMerged.forEach((f) => mergedFields.add(f));
      }
      const fieldsText = mergedFields.size > 0 ? `、補欄位 ${[...mergedFields].join('/')}` : '';
      setMsg({
        kind: 'ok',
        text: `✓ 完成：${toMerge.length} 筆併入「${keep.chartNo} ${keep.name}」、轉移 ${totalTransferred} 筆下單${fieldsText}`,
      });
      setMergeMode(false);
      setKeepId(null);
    } catch (e) {
      setMsg({
        kind: 'err',
        text: `✗ 失敗：${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-zinc-200 font-medium">
          {group.name}{' '}
          <span className="text-zinc-500 text-[10px]">({group.list.length} 筆)</span>
        </div>
        {!busy && (
          <button
            onClick={() => {
              setMergeMode(!mergeMode);
              setKeepId(null);
              setMsg(null);
            }}
            className="text-[11px] text-rose-300 hover:text-rose-200 px-2 py-0.5 rounded hover:bg-rose-500/10"
          >
            {mergeMode ? '✗ 取消合併' : '🔗 合併此組'}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {sorted.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            {mergeMode && (
              <input
                type="radio"
                name={`keep-${group.name}`}
                checked={keepId === p.id}
                onChange={() => setKeepId(p.id)}
                disabled={busy}
                className="accent-emerald-500 cursor-pointer"
                title="勾選 = 保留這筆、其他併進來"
              />
            )}
            <Link
              to={`/patients/${p.id}`}
              className="flex-1 flex items-center gap-3 px-2 py-1 rounded hover:bg-zinc-800/60 transition group"
            >
              <span className="font-mono text-sky-300 group-hover:text-sky-200 min-w-[3em]">
                {p.chartNo}
              </span>
              <span className="text-zinc-400 min-w-[6em] text-[11px]">
                {p.birthday ?? <span className="text-rose-400">⚠ 無生日</span>}
              </span>
              <span className="text-zinc-500 text-[11px] min-w-[5em]">{p.doctor ?? '—'}</span>
              <span
                className="text-zinc-600 text-[10px] truncate flex-1"
                title={p.sourceFolder ?? ''}
              >
                {p.sourceFolder ?? '—'}
              </span>
            </Link>
          </div>
        ))}
      </div>
      {mergeMode && (
        <div className="mt-2 flex items-center gap-3 px-2">
          <span className="text-[11px] text-zinc-500 flex-1">
            勾選要「保留」的那筆 → 其他會合併進來、原 chartNo 會刪除
          </span>
          <button
            onClick={doMerge}
            disabled={!keepId || busy}
            className="px-2.5 py-1 rounded bg-rose-600/20 border border-rose-500/50 text-rose-200 text-[11px] hover:bg-rose-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? '合併中…' : '執行合併'}
          </button>
        </div>
      )}
      {msg && (
        <div
          className={`mt-2 px-2.5 py-1.5 rounded text-[11px] ${
            msg.kind === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-200'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

/* ─── sourceFolder 健檢（v0.3.19 新增、v0.3.20 加自動修復）─────
 *   掃所有 patient.sourceFolder + consentPdfPath、用 helper 檢查實際是否存在。
 *   找出 dead links：可能原因 (1) 資料夾被改名 (2) 被移到別處 (3) 已刪除 (4) NAS 沒連
 *   點 chartNo 跳病患詳細頁、可手動處理。
 *
 *   v0.3.20: 加「自動修復」— 對每筆 dead sourceFolder、查該 patient.allSourceFolders
 *           內是否有活路徑（合併殘留 / 跨機 sync 記下）、找到就一鍵替換。
 */
type DeadLink = {
  patient: Patient;
  field: 'sourceFolder' | 'consentPdfPath';
  path: string;
};

type RepairCandidate = {
  patient: Patient;
  oldPath: string;
  newPath: string;
};

function SourceFolderHealthSection() {
  // v0.4.7: 移除 useLiveQuery — UI 內沒用到、go() 改成直接 await db.patients.toArray()
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [deadLinks, setDeadLinks] = useState<DeadLink[]>([]);
  const [repairs, setRepairs] = useState<RepairCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{
    totalPatients: number;
    totalPaths: number;
    deadCount: number;
    noSourceFolderCount: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function go() {
    setState('checking');
    setErrorMsg('');
    setDeadLinks([]);
    setRepairs([]);
    setStats(null);

    // v0.4.7: 直接抓最新、不依賴 useLiveQuery 的 stale closure
    //   原本用 `allPatients` (component-level useLiveQuery)、
    //   `applyAllRepairs` 完 `await go()` 時 closure 抓的還是修復前的 snapshot。
    const freshPatients = await db.patients.toArray();

    // 集合所有要檢查的路徑、用 Map 對應到 patient + field
    const pathMap = new Map<string, { patient: Patient; field: 'sourceFolder' | 'consentPdfPath' }[]>();
    let noSourceFolderCount = 0;
    for (const p of freshPatients) {
      if (!p.sourceFolder) noSourceFolderCount++;
      else {
        if (!pathMap.has(p.sourceFolder)) pathMap.set(p.sourceFolder, []);
        pathMap.get(p.sourceFolder)!.push({ patient: p, field: 'sourceFolder' });
      }
      if (p.consentPdfPath) {
        if (!pathMap.has(p.consentPdfPath)) pathMap.set(p.consentPdfPath, []);
        pathMap.get(p.consentPdfPath)!.push({ patient: p, field: 'consentPdfPath' });
      }
    }

    const allPaths = [...pathMap.keys()];
    if (allPaths.length === 0) {
      setStats({
        totalPatients: freshPatients.length,
        totalPaths: 0,
        deadCount: 0,
        noSourceFolderCount,
      });
      setState('done');
      return;
    }

    const r = await checkPaths(allPaths);
    if (r.state === 'helper-down') {
      setErrorMsg('本機 helper 沒回應');
      setState('error');
      return;
    }
    if (r.state === 'error') {
      setErrorMsg(r.message);
      setState('error');
      return;
    }

    const dead: DeadLink[] = [];
    for (const [path, refs] of pathMap.entries()) {
      if (!r.results[path]) {
        for (const ref of refs) {
          dead.push({ ...ref, path });
        }
      }
    }

    // 排序：先 sourceFolder、再 chartNo ASC
    dead.sort((a, b) => {
      if (a.field !== b.field) return a.field === 'sourceFolder' ? -1 : 1;
      return (a.patient.chartNo ?? '').localeCompare(b.patient.chartNo ?? '');
    });

    // ── 第二階段：對每筆 dead sourceFolder、查 allSourceFolders 找活的 ──
    const extraPathsToCheck = new Set<string>();
    for (const d of dead) {
      if (d.field !== 'sourceFolder') continue;
      for (const alt of d.patient.allSourceFolders ?? []) {
        if (alt === d.path) continue;
        if (alt in r.results) continue; // 已 check 過、結果在 r.results 內
        extraPathsToCheck.add(alt);
      }
    }
    let extraResults: Record<string, boolean> = {};
    if (extraPathsToCheck.size > 0) {
      const r2 = await checkPaths([...extraPathsToCheck]);
      if (r2.state === 'ok') extraResults = r2.results;
    }
    const allResults = { ...r.results, ...extraResults };

    const repairCandidates: RepairCandidate[] = [];
    for (const d of dead) {
      if (d.field !== 'sourceFolder') continue;
      const alts = d.patient.allSourceFolders ?? [];
      const alive = alts.find((a) => a !== d.path && allResults[a] === true);
      if (alive) {
        repairCandidates.push({ patient: d.patient, oldPath: d.path, newPath: alive });
      }
    }

    setDeadLinks(dead);
    setRepairs(repairCandidates);
    setStats({
      totalPatients: freshPatients.length,
      totalPaths: allPaths.length,
      deadCount: dead.length,
      noSourceFolderCount,
    });
    setState('done');
  }

  // v0.4.7: 修復時把 oldPath（dead）保留進 allSourceFolders、
  // 跟 confirm dialog 文案「原 dead 路徑會保留」一致、不丟歷史。
  async function patchSourceFolder(r: RepairCandidate, nowIso: string) {
    const merged = new Set<string>(r.patient.allSourceFolders ?? []);
    if (r.oldPath) merged.add(r.oldPath); // 保留 dead 歷史
    merged.add(r.newPath); // 確保 new 在
    await getDataLayer().updatePatient(
      r.patient.id,
      {
        sourceFolder: r.newPath,
        allSourceFolders: [...merged],
        updatedAt: nowIso,
      },
      r.patient._version ?? 1,
    );
  }

  async function applyAllRepairs() {
    if (repairs.length === 0) return;
    if (
      !confirm(
        `要把 ${repairs.length} 位病患的 sourceFolder 改成 allSourceFolders 內的活路徑嗎？\n\n` +
          `每筆會：把 sourceFolder 設成找到的活路徑、原 dead 路徑會保留在 allSourceFolders 內（不丟）。\n` +
          `不可一鍵 undo、但 allSourceFolders 還在、之後可在病患詳細頁切換。`,
      )
    )
      return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      for (const r of repairs) {
        await patchSourceFolder(r, nowIso);
      }
      // 完成後立刻重跑一次健檢（go 內部會 await db.patients.toArray() 抓最新、不受 closure 影響）
      await go();
    } finally {
      setBusy(false);
    }
  }

  async function applyOneRepair(r: RepairCandidate) {
    if (!confirm(`把 ${r.patient.chartNo} ${r.patient.name} 的 sourceFolder 改成：\n\n${r.newPath}\n\n原 dead 路徑會保留在 allSourceFolders 內。`)) return;
    setBusy(true);
    try {
      await patchSourceFolder(r, new Date().toISOString());
      await go();
    } finally {
      setBusy(false);
    }
  }

  const sourceFolderDead = deadLinks.filter((d) => d.field === 'sourceFolder');
  const consentPdfDead = deadLinks.filter((d) => d.field === 'consentPdfPath');
  const repairableIds = new Set(repairs.map((r) => r.patient.id));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">sourceFolder 健檢</h2>
        <button
          onClick={go}
          disabled={state === 'checking'}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {state === 'checking' ? '🩺 檢查中…' : '🩺 立即掃描'}
        </button>
      </header>
      <div className="p-5 space-y-2 text-sm">
        <p className="text-xs text-zinc-500 leading-relaxed">
          透過 helper 檢查每位病患的 <code className="text-zinc-400">sourceFolder</code> 跟{' '}
          <code className="text-zinc-400">consentPdfPath</code> 在實際檔案系統上是否存在。
          找出「指向不存在」的死路徑 — 可能原因：資料夾被改名 / 移到別處 / 已刪除 / NAS 沒連。
          <strong className="text-zinc-400 block mt-1">先跑「路徑遷移」把 prefix 統一、再來健檢比較準。</strong>
        </p>

        {stats && (
          <div className="grid grid-cols-4 gap-2 text-xs">
            <StatBox label="病患總數" value={stats.totalPatients} />
            <StatBox label="掃描路徑" value={stats.totalPaths} />
            <StatBox label="死路徑" value={stats.deadCount} tone={stats.deadCount > 0 ? 'rose' : 'zinc'} />
            <StatBox label="無 sourceFolder" value={stats.noSourceFolderCount} tone={stats.noSourceFolderCount > 0 ? 'amber' : 'zinc'} />
          </div>
        )}

        {state === 'error' && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {errorMsg}
          </div>
        )}

        {state === 'done' && deadLinks.length === 0 && stats && stats.totalPaths > 0 && (
          <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            ✓ 所有 {stats.totalPaths} 個路徑都實際存在。
            {stats.noSourceFolderCount > 0 && (
              <div className="text-zinc-500 mt-1">
                注：有 {stats.noSourceFolderCount} 位病患沒設 sourceFolder（placeholder / 手動新增 / 待補）。
              </div>
            )}
          </div>
        )}

        {repairs.length > 0 && (
          <div className="px-3 py-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-emerald-300 font-medium">
                ✨ 找到 {repairs.length} 筆可自動修復（allSourceFolders 內有活路徑）
              </div>
              <button
                onClick={applyAllRepairs}
                disabled={busy}
                className="px-2.5 py-1 rounded bg-emerald-600/30 border border-emerald-500/60 text-emerald-100 text-[11px] hover:bg-emerald-600/40 transition disabled:opacity-40"
              >
                {busy ? '修復中…' : '⚡ 一鍵全修復'}
              </button>
            </div>
            <details>
              <summary className="cursor-pointer text-emerald-400/80 hover:text-emerald-300 text-[11px]">
                展開看修復對照（{repairs.length} 筆）
              </summary>
              <div className="mt-2 space-y-1.5">
                {repairs.map((r) => (
                  <div
                    key={r.patient.id}
                    className="px-2 py-1.5 rounded bg-zinc-950/40 border border-zinc-800 space-y-0.5"
                  >
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/patients/${r.patient.id}`}
                        className="font-mono text-sky-300 hover:text-sky-200 text-[11px]"
                      >
                        {r.patient.chartNo}
                      </Link>
                      <span className="text-zinc-300 text-[11px]">{r.patient.name}</span>
                      <button
                        onClick={() => applyOneRepair(r)}
                        disabled={busy}
                        className="ml-auto px-2 py-0.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 text-[10px] hover:bg-emerald-600/30 disabled:opacity-40"
                      >
                        ✓ 修這筆
                      </button>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      <span className="text-rose-400/80">✗ </span>
                      <code className="break-all">{r.oldPath}</code>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      <span className="text-emerald-400/80">→ </span>
                      <code className="break-all">{r.newPath}</code>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {sourceFolderDead.length > 0 && (
          <details className="text-xs" open>
            <summary className="cursor-pointer text-rose-300 hover:text-rose-200 font-medium">
              🔴 sourceFolder 指向不存在（{sourceFolderDead.length} 筆
              {repairs.length > 0 && `、其中 ${repairs.length} 筆可自動修復`}）
            </summary>
            <div className="mt-2 space-y-1">
              {sourceFolderDead.map((d, i) => (
                <DeadLinkRow
                  key={`${d.patient.id}-${i}`}
                  d={d}
                  hasRepair={repairableIds.has(d.patient.id)}
                />
              ))}
            </div>
          </details>
        )}

        {consentPdfDead.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-amber-300 hover:text-amber-200 font-medium">
              🟡 consentPdfPath 指向不存在（{consentPdfDead.length} 筆）
            </summary>
            <div className="mt-2 space-y-1">
              {consentPdfDead.map((d, i) => (
                <DeadLinkRow key={`${d.patient.id}-${i}`} d={d} />
              ))}
            </div>
          </details>
        )}

        {state === 'done' && deadLinks.length > 0 && (
          <p className="text-[11px] text-zinc-600 leading-relaxed pt-1">
            處理方法：點 chartNo 跳病患詳細頁、手動編輯 sourceFolder 指到正確位置。
            常見原因：診所在 NAS 改了資料夾名（加備註、整理）但 App 內紀錄沒更新。
          </p>
        )}
      </div>
    </section>
  );
}

function DeadLinkRow({ d, hasRepair = false }: { d: DeadLink; hasRepair?: boolean }) {
  return (
    <Link
      to={`/patients/${d.patient.id}`}
      className="flex items-center gap-3 px-2 py-1 rounded hover:bg-zinc-800/60 transition group"
    >
      <span className="font-mono text-sky-300 group-hover:text-sky-200 min-w-[3em]">
        {d.patient.chartNo}
      </span>
      <span className="text-zinc-300 min-w-[5em]">{d.patient.name}</span>
      <span className="text-zinc-500 text-[11px] min-w-[6em]">{d.patient.birthday ?? '—'}</span>
      <span className="text-rose-400/80 text-[10px] truncate flex-1" title={d.path}>
        {d.path}
      </span>
      {hasRepair && (
        <span
          className="text-[10px] text-emerald-400 flex-shrink-0"
          title="此筆有自動修復候選（allSourceFolders 內找到活路徑）"
        >
          ✨ 可修
        </span>
      )}
    </Link>
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
    // v0.6.0 提醒：destructive admin op、刻意不走 DataLayer、只清本機 Dexie
    // dual 模式下重 load 會從 server 重新拉、回到 server 端真相
    await db.delete();
    location.reload();
  }

  async function resetLabsToDefaults() {
    if (!confirm('還原預設技工所 (鎂鉑/世宇/隱適美)？目前自定義的技工所會被覆寫。')) return;
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
