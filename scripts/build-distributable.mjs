// 把整套東西打包到 D:\隱形矯正追蹤系統\，方便 copy 到 USB 帶到診所電腦。
//
// 用法：
//   1. 先 npm run build (確保 dist/ 是最新)
//   2. node scripts/build-distributable.mjs
//   3. 把 D:\隱形矯正追蹤系統\ 整個 copy 到 USB
//   4. 在新電腦解開 → 雙擊 安裝.bat

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE = 'D:\\隱形矯正追蹤系統';
const DATA_SRC = 'D:\\矯正';

const APP_EXCLUDE = new Set(['node_modules', 'dist', '.git', '.vscode', '.claude', '.DS_Store']);

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function copyDir(src, dst, exclude = new Set()) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d, exclude);
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

async function dirSize(p) {
  let total = 0;
  try {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) total += await dirSize(f);
      else {
        const stat = await fsp.stat(f);
        total += stat.size;
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function main() {
  const skipData = process.argv.includes('--skip-data');
  const skipApp = process.argv.includes('--skip-app');
  console.log('=== 隱形矯正追蹤 — 打包成 USB 部署版 ===');
  if (skipData) console.log('  (--skip-data：跳過 60GB+ 病患資料夾複製)');
  if (skipApp) console.log('  (--skip-app：跳過 app code 複製)');
  console.log();

  // 1. 確認 dist/ 存在 (要有 build 過)
  if (!fs.existsSync(path.join(ROOT, 'dist'))) {
    console.error('❌ 找不到 dist/，請先跑：npm run build');
    process.exit(1);
  }

  // 2. 確保 bundle dir 存在 (skip 模式下保留既有資料)
  if (!skipData && !skipApp) {
    console.log(`→ 清空 ${BUNDLE}`);
    await rmrf(BUNDLE);
  }
  await fsp.mkdir(BUNDLE, { recursive: true });

  // 3. Copy app code (排除大檔)
  if (!skipApp) {
    const appDst = path.join(BUNDLE, 'app');
    console.log(`→ 複製 app 程式碼 (排除 node_modules/dist)`);
    await rmrf(appDst); // 增量模式下也要先清舊 app/
    await copyDir(ROOT, appDst, APP_EXCLUDE);
    console.log(`  完成 (${fmtSize(await dirSize(appDst))})`);
  } else {
    console.log(`→ 跳過 app code 複製`);
  }

  // 4. Copy 矯正資料夾 (病患 PDF / JPG / 口掃)
  if (skipData) {
    console.log(`→ 跳過病患資料夾複製 (${path.join(BUNDLE, '矯正資料')} 維持原狀)`);
  } else if (fs.existsSync(DATA_SRC)) {
    console.log(`→ 複製病患資料夾 ${DATA_SRC}`);
    const dataDst = path.join(BUNDLE, '矯正資料');
    await copyDir(DATA_SRC, dataDst);
    console.log(`  完成 (${fmtSize(await dirSize(dataDst))})`);
  } else {
    console.log(`⚠️ 找不到 ${DATA_SRC}，跳過`);
  }

  // 5. 從 dev-data 重建 backup JSON (給新電腦匯入用)
  console.log(`→ 產生備份 JSON`);
  const backup = await buildBackupFromDevData();
  const backupDir = path.join(BUNDLE, '備份');
  await fsp.mkdir(backupDir, { recursive: true });
  const backupName = `aligner-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  await fsp.writeFile(path.join(backupDir, backupName), JSON.stringify(backup, null, 2));
  console.log(`  ${backupName} (${backup.counts.patients} 病患 / ${backup.counts.orders} 下單 / ${backup.counts.settings} 設定)`);

  // 6. Copy installer
  console.log(`→ 寫入安裝程式`);
  const installerDir = path.join(BUNDLE, '安裝');
  await fsp.mkdir(installerDir, { recursive: true });
  await fsp.copyFile(
    path.join(ROOT, 'scripts/installer.ps1'),
    path.join(installerDir, 'install.ps1'),
  );
  await fsp.copyFile(path.join(ROOT, 'scripts/安裝.bat'), path.join(BUNDLE, '安裝.bat'));

  // 7. Copy SOP
  if (fs.existsSync(path.join(ROOT, 'DEPLOYMENT.md'))) {
    await fsp.copyFile(path.join(ROOT, 'DEPLOYMENT.md'), path.join(BUNDLE, '部署說明.md'));
  }

  // 8. README
  await fsp.writeFile(
    path.join(BUNDLE, '快速開始.txt'),
    `隱形矯正追蹤系統 — USB 部署包\n` +
      `產生時間：${new Date().toLocaleString('zh-TW')}\n\n` +
      `使用步驟：\n` +
      `1. 把整個 [隱形矯正追蹤系統] 資料夾複製到新電腦 (建議放 D 槽)\n` +
      `2. 雙擊 [安裝.bat] (會跳 PowerShell 視窗，按提示走)\n` +
      `3. 安裝完桌面會出現 [隱形矯正追蹤] 捷徑 → 雙擊啟動\n` +
      `4. App 開啟後 → 設定 → 資料備份 → ⬆ 選擇備份檔\n` +
      `5. 選 [備份/${backupName}] → 確認覆寫 → 完成\n\n` +
      `若 Node.js 沒裝會提示去 https://nodejs.org 下載 LTS 版本\n` +
      `詳細說明見 [部署說明.md]\n`,
  );

  // 完成
  const totalSize = await dirSize(BUNDLE);
  console.log(`\n=== 打包完成 ===`);
  console.log(`位置：${BUNDLE}`);
  console.log(`總大小：${fmtSize(totalSize)}`);
  console.log(`下一步：把整個資料夾 copy 到 USB`);
}

// 跟 src/lib/reapply-excel.ts 一樣的 alignerRange parser
function parseAlignerRangeMax(range) {
  if (!range) return { upper: null, lower: null };
  let upper = null, lower = null;
  for (const seg of String(range).split('+')) {
    const m = seg.match(/^(UL|U|L)(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const prefix = m[1];
    const max = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
    if (prefix === 'UL') {
      if (upper == null || max > upper) upper = max;
      if (lower == null || max > lower) lower = max;
    } else if (prefix === 'U') {
      if (upper == null || max > upper) upper = max;
    } else if (prefix === 'L') {
      if (lower == null || max > lower) lower = max;
    }
  }
  return { upper, lower };
}

async function buildBackupFromDevData() {
  const devData = path.join(ROOT, 'dev-data');
  const APP_VERSION = '0.1.0';

  let patients = [];
  let orders = [];
  let updates = [];
  let newPatients = [];

  try {
    const p = JSON.parse(await fsp.readFile(path.join(devData, 'patients-import.json'), 'utf8'));
    patients = p.patients ?? [];
  } catch {
    /* ignore */
  }
  try {
    const o = JSON.parse(await fsp.readFile(path.join(devData, 'excel-orders.json'), 'utf8'));
    orders = o.orders ?? [];
  } catch {
    /* ignore */
  }
  try {
    const u = JSON.parse(await fsp.readFile(path.join(devData, 'excel-patient-updates.json'), 'utf8'));
    updates = u.updates ?? [];
    newPatients = u.newPatients ?? [];
  } catch {
    /* ignore */
  }

  // 1. Apply updates (帶 refName/refBirthday，跟 reapply 一樣的 fallback)
  const updateMap = new Map(updates.map((u) => [u.id, u]));
  // fallback by name+birthday：DB 重 seed 後 patient.id 跟 update.id 對得上 (剛 seed)
  // 但補充檔產生的 update 的 id 可能不在 patients 裡 (orphan)，要 fallback 到 name+birthday
  const byNameBirthday = new Map();
  for (const p of patients) {
    if (p.name && p.birthday) byNameBirthday.set(`${p.name}|${p.birthday}`, p);
  }
  let merged = patients.map((p) => {
    if (updateMap.has(p.id)) {
      const u = updateMap.get(p.id);
      return { ...p, ...u };
    }
    return p;
  });
  // 把 update 中 id 對不上但 refName/refBirthday 對得上的，套到對應 patient
  const mergedById = new Map(merged.map((p) => [p.id, p]));
  for (const u of updates) {
    if (mergedById.has(u.id)) continue; // 已套
    const ref = u.refName && u.refBirthday ? byNameBirthday.get(`${u.refName}|${u.refBirthday}`) : null;
    if (ref) Object.assign(mergedById.get(ref.id), u, { id: ref.id });
  }
  merged = [...mergedById.values(), ...newPatients];

  // 2. 強制覆寫 totalAlignersUpper/Lower (因為 update 帶的才是對的)
  //    並清掉 currentAligner (等下從 orders 推)
  for (const p of merged) {
    const u = updateMap.get(p.id);
    if (u && u.totalAlignersUpper != null) p.totalAlignersUpper = u.totalAlignersUpper;
    if (u && u.totalAlignersLower != null) p.totalAlignersLower = u.totalAlignersLower;
  }

  // 3. 從 orders 推 currentAligner
  const ordersByPid = new Map();
  for (const o of orders) {
    if (!ordersByPid.has(o.patientId)) ordersByPid.set(o.patientId, []);
    ordersByPid.get(o.patientId).push(o);
  }
  for (const p of merged) {
    const os = ordersByPid.get(p.id) ?? [];
    if (!os.length) continue;
    const completed = os.filter(
      (o) => o.progress === '已完成' || o.progress === '診所已收到牙套',
    );
    const pool = completed.length > 0 ? completed : os;
    let upper = null, lower = null;
    for (const o of pool) {
      const m = parseAlignerRangeMax(o.alignerRange ?? '');
      if (m.upper != null && (upper == null || m.upper > upper)) upper = m.upper;
      if (m.lower != null && (lower == null || m.lower > lower)) lower = m.lower;
    }
    if (upper != null) p.currentAlignerUpper = upper;
    if (lower != null) p.currentAlignerLower = lower;
  }

  // 預設 settings (理想是讀現有 IndexedDB，這裡給 default)
  const settings = [
    {
      key: 'labs',
      value: [
        { id: 'meibo', name: '美鉑', color: '#a855f7' },
        { id: 'shiyu', name: '世宇', color: '#f59e0b' },
        { id: 'invisalign', name: '隱適美', color: '#0ea5e9' },
      ],
    },
    {
      key: 'doctors',
      value: [
        { id: 'chen-zhizhong', name: '陳執中', color: '#f59e0b' },
        { id: 'lin-yingchen', name: '林英辰', color: '#10b981' },
        { id: 'zhang-qizhen', name: '張綺真', color: '#a855f7' },
      ],
    },
  ];

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts: {
      patients: merged.length,
      orders: orders.length,
      settings: settings.length,
    },
    patients: merged,
    orders,
    settings,
  };
}

main().catch((e) => {
  console.error('❌ 打包失敗：', e);
  process.exit(1);
});
