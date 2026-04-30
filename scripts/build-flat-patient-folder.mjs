// 把 D:\矯正\口掃檔 取資料 下單\ 底下所有病患資料夾「扁平複製」到 D:\矯正\病患資料夾\
// status 編入資料夾名前綴：[結束] / [中斷] / [隱適美] / [綻雅] / [維持器] / [待確認]
// 活躍病患無前綴。
//
// 一次性 script — 跑完後 D:\矯正\病患資料夾\ 就是新的單一掃描根。
//
// 用法：
//   node scripts/build-flat-patient-folder.mjs --dry-run    # 只印計劃 + 衝突檢測
//   node scripts/build-flat-patient-folder.mjs --apply      # 真的複製
//   node scripts/build-flat-patient-folder.mjs --apply --skip-size  # 跳過 size 計算（快）

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'D:\\矯正\\口掃檔 取資料 下單';
const TARGET = 'D:\\矯正\\病患資料夾';

const PREFIX_MAP = {
  '中斷療程': '[中斷]',
  '矯正結束': '[結束]',
  '轉隱適美': '[隱適美]',
  '綻雅病人': '[綻雅]',
  '單純做暫維或正式維持器': '[維持器]',
  '前期未有授權書的病人 要再跟病人確認方案': '[待確認]',
};

// 日期資料夾：開頭是 YYYYMMDD，後面可有空白 + 任意備註（如 "20260126 下單完成"）
const DATE_FOLDER_RE = /^\d{8}/;
// 月份資料夾：1月、2月、…、12月
const MONTH_FOLDER_RE = /^\d{1,2}月$/;

function listDirs(p) {
  return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory());
}

// 從 SOURCE 找出所有病患資料夾（已附 prefix 標籤）
// 策略：日期/狀態資料夾底下「所有子目錄」都當作病患（不過濾資料夾名）
function findPatientFolders(root) {
  const list = [];
  const skipped = [];

  for (const entry of listDirs(root)) {
    const topPath = path.join(root, entry.name);
    const prefix = PREFIX_MAP[entry.name];

    // (1) 狀態類資料夾：底下可能直接放病患，也可能再嵌一層 YYYYMMDD（如「矯正結束/」）
    if (prefix !== undefined) {
      for (const sub of listDirs(topPath)) {
        const subPath = path.join(topPath, sub.name);
        if (DATE_FOLDER_RE.test(sub.name)) {
          // 嵌套：狀態 / YYYYMMDD / 病患
          for (const patient of listDirs(subPath)) {
            list.push({
              src: path.join(subPath, patient.name),
              name: patient.name,
              prefix,
              sourceCategory: `${entry.name}/${sub.name}`,
            });
          }
        } else {
          // 扁平：狀態 / 病患
          list.push({ src: subPath, name: sub.name, prefix, sourceCategory: entry.name });
        }
      }
      continue;
    }

    // (2) YYYYMMDD（含後綴）直接日期：底下所有子目錄都是病患
    if (DATE_FOLDER_RE.test(entry.name)) {
      for (const sub of listDirs(topPath)) {
        list.push({ src: path.join(topPath, sub.name), name: sub.name, prefix: '', sourceCategory: entry.name });
      }
      continue;
    }

    // (3) 月份資料夾：底下要有 YYYYMMDD 子層 → 再底下才是病患
    if (MONTH_FOLDER_RE.test(entry.name)) {
      for (const dateEntry of listDirs(topPath)) {
        if (!DATE_FOLDER_RE.test(dateEntry.name)) {
          skipped.push({ path: path.join(topPath, dateEntry.name), reason: '月份底下出現非 YYYYMMDD 開頭子層' });
          continue;
        }
        const datePath = path.join(topPath, dateEntry.name);
        for (const sub of listDirs(datePath)) {
          list.push({ src: path.join(datePath, sub.name), name: sub.name, prefix: '', sourceCategory: `${entry.name}/${dateEntry.name}` });
        }
      }
      continue;
    }

    skipped.push({ path: topPath, reason: '不認得的頂層資料夾類型' });
  }

  return { list, skipped };
}

function makeTargetName({ name, prefix }) {
  return prefix ? `${prefix} ${name}` : name;
}

function getDirSizeShallow(dir) {
  // 只算 dir 底下的檔案大小（不深入子目錄），給粗略估計用。完整算太慢。
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile()) total += fs.statSync(p).size;
      else if (e.isDirectory()) total += getDirSizeShallow(p);
    }
  } catch {}
  return total;
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name);
    let dp = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyDirRecursive(sp, dp);
    } else if (e.isFile()) {
      // 檔名衝突 → 加 _2 / _3 後綴避免覆蓋
      if (fs.existsSync(dp)) {
        const ext = path.extname(e.name);
        const base = e.name.slice(0, -ext.length || undefined);
        let n = 2;
        while (fs.existsSync(path.join(dst, `${base}_${n}${ext}`))) n++;
        dp = path.join(dst, `${base}_${n}${ext}`);
        console.log(`     [merge] ${e.name} → ${path.basename(dp)}（檔名衝突）`);
      }
      fs.copyFileSync(sp, dp);
    }
  }
}

// ─── main ───────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isApply = args.includes('--apply');
const skipSize = args.includes('--skip-size');

if (!isDryRun && !isApply) {
  console.error('用法：node build-flat-patient-folder.mjs [--dry-run | --apply] [--skip-size]');
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) {
  console.error(`❌ 來源不存在：${SOURCE}`);
  process.exit(1);
}

console.log('=== 病患資料夾扁平複製 ===');
console.log(`來源：${SOURCE}`);
console.log(`目標：${TARGET}`);
console.log(`模式：${isDryRun ? 'DRY RUN（只印計劃，不複製）' : 'APPLY（真的複製）'}`);
console.log('');

const { list, skipped } = findPatientFolders(SOURCE);

console.log(`✓ 掃到病患資料夾：${list.length} 個`);
if (skipped.length > 0) {
  console.log(`⚠️ 跳過（非病患格式）：${skipped.length} 個`);
  if (skipped.length <= 20) {
    for (const s of skipped) console.log(`   - ${s.path}（${s.reason}）`);
  } else {
    console.log(`   （> 20 個，只列前 5）`);
    for (const s of skipped.slice(0, 5)) console.log(`   - ${s.path}（${s.reason}）`);
  }
}
console.log('');

// 分類統計
const byPrefix = {};
for (const item of list) {
  const k = item.prefix || '(活躍)';
  byPrefix[k] = (byPrefix[k] ?? 0) + 1;
}
console.log('分類統計：');
for (const [k, v] of Object.entries(byPrefix).sort()) {
  console.log(`  ${k.padEnd(10)} ${v}`);
}
console.log('');

// 同名衝突
const targetNames = list.map(makeTargetName);
const nameCount = {};
for (const n of targetNames) nameCount[n] = (nameCount[n] ?? 0) + 1;
const conflicts = Object.entries(nameCount).filter(([, c]) => c > 1);
console.log(`同名衝突：${conflicts.length} 組`);
for (const [n, c] of conflicts) {
  console.log(`  ⚠️ "${n}" 出現 ${c} 次`);
  // 列出所有出現地點，user 才能判斷
  const matches = list.filter((it) => makeTargetName(it) === n);
  for (const m of matches) {
    console.log(`     ← ${m.src}`);
  }
}
console.log('');

// 大小估算
if (!skipSize) {
  console.log('估算總大小（掃描中，可能要 30 秒…）');
  let totalSize = 0;
  let countedDirs = 0;
  for (const item of list) {
    totalSize += getDirSizeShallow(item.src);
    countedDirs++;
    if (countedDirs % 50 === 0) {
      process.stdout.write(`   [${countedDirs}/${list.length}]\r`);
    }
  }
  console.log(`✓ 總大小：${(totalSize / (1024 ** 3)).toFixed(2)} GB`);
  console.log('');
}

if (isDryRun) {
  console.log('🔍 DRY RUN 結束，未複製任何檔案。');
  console.log('   要真的複製：node scripts/build-flat-patient-folder.mjs --apply');
  process.exit(0);
}

// APPLY mode
if (fs.existsSync(TARGET)) {
  console.error(`❌ 目標已存在：${TARGET}`);
  console.error(`   為避免覆蓋舊內容，請先手動處理：`);
  console.error(`     - 刪除整個 ${TARGET}\\，或`);
  console.error(`     - 改名為 ${TARGET}.backup-YYYYMMDD\\`);
  process.exit(1);
}

if (conflicts.length > 0) {
  console.log(`ℹ️ 偵測到 ${conflicts.length} 組同名衝突 — 將自動合併到同一目標資料夾。`);
  console.log(`   內部檔名若撞檔，後者會加 _2 後綴。`);
  console.log('');
}

console.log('開始複製…');
fs.mkdirSync(TARGET, { recursive: true });
let done = 0;
const start = Date.now();
for (const item of list) {
  const dstName = makeTargetName(item);
  const dst = path.join(TARGET, dstName);
  const isMergeTarget = fs.existsSync(dst);
  if (isMergeTarget) {
    console.log(`  [合併] ${dstName} ← ${item.src}`);
  }
  copyDirRecursive(item.src, dst);
  done++;
  if (done % 20 === 0 || done === list.length) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`  [${done}/${list.length}] ${dstName}（已跑 ${elapsed}s）`);
  }
}

const totalSec = ((Date.now() - start) / 1000).toFixed(0);
console.log('');
console.log(`✓ 完成。${done} 個病患資料夾已複製到：${TARGET}`);
console.log(`  耗時 ${totalSec} 秒`);
