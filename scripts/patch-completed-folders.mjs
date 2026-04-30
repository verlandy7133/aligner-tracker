// 一次性修補 build-flat-patient-folder.mjs 的 bug：
// - 把 17 個錯誤的 [結束] YYYYMMDD 日期資料夾刪掉
// - 從 矯正結束/*/* 把 26 個真實病患加進去（前綴 [結束]）
// - 衝突的 810425張家婷：把現有改名為 [結束] 並合併新檔案
//
// 跑完後 D:\矯正\病患資料夾\ 就是正確狀態。

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'D:\\矯正\\口掃檔 取資料 下單\\矯正結束';
const TARGET = 'D:\\矯正\\病患資料夾';

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const sub = path.join(p, e.name);
    if (e.isDirectory()) rmrf(sub);
    else fs.unlinkSync(sub);
  }
  fs.rmdirSync(p);
}

function copyMerge(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name);
    let dp = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyMerge(sp, dp);
    } else if (e.isFile()) {
      if (fs.existsSync(dp)) {
        const ext = path.extname(e.name);
        const base = e.name.slice(0, -ext.length || undefined);
        let n = 2;
        while (fs.existsSync(path.join(dst, `${base}_${n}${ext}`))) n++;
        dp = path.join(dst, `${base}_${n}${ext}`);
        console.log(`     [merge] ${e.name} → ${path.basename(dp)}`);
      }
      fs.copyFileSync(sp, dp);
    }
  }
}

console.log('=== Patch [結束] 病患資料夾 ===');
console.log('');

// ── Step 1：刪掉 17 個錯誤的 [結束] YYYYMMDD 資料夾 ─────────────────
console.log('[1/3] 刪除錯誤的 17 個 [結束] 日期資料夾…');
const wrong = fs
  .readdirSync(TARGET)
  .filter((n) => /^\[結束\] \d{8}$/.test(n));
console.log(`   找到 ${wrong.length} 個`);
for (const w of wrong) {
  const wp = path.join(TARGET, w);
  rmrf(wp);
  console.log(`   ✓ 刪 ${w}`);
}
console.log('');

// ── Step 2：找衝突（病患在活躍 + 矯正結束 都有）並把現有改名 ─────
console.log('[2/3] 處理活躍／結束衝突…');
const sourcePatients = []; // { src, name }
for (const dateDir of fs.readdirSync(SOURCE)) {
  const datePath = path.join(SOURCE, dateDir);
  if (!fs.statSync(datePath).isDirectory()) continue;
  for (const patient of fs.readdirSync(datePath)) {
    const pp = path.join(datePath, patient);
    if (fs.statSync(pp).isDirectory()) {
      sourcePatients.push({ src: pp, name: patient });
    }
  }
}
console.log(`   矯正結束 真實病患：${sourcePatients.length} 個`);

const existing = new Set(fs.readdirSync(TARGET));
const conflicts = sourcePatients.filter((p) => existing.has(p.name));
console.log(`   發現衝突：${conflicts.length} 個（病患在活躍 + 結束 兩邊都有）`);
for (const c of conflicts) {
  const oldName = c.name;
  const newName = `[結束] ${c.name}`;
  const oldPath = path.join(TARGET, oldName);
  const newPath = path.join(TARGET, newName);
  if (fs.existsSync(newPath)) {
    console.log(`   ⚠️ 既有 [結束] 同名 ${newName} 已存在，跳過 rename`);
    continue;
  }
  fs.renameSync(oldPath, newPath);
  console.log(`   ✓ 改名 ${oldName} → ${newName}`);
}
console.log('');

// ── Step 3：複製 / 合併 矯正結束 病患到 [結束] 開頭資料夾 ─────────
console.log('[3/3] 複製 / 合併 矯正結束 病患…');
let added = 0;
let merged = 0;
for (const p of sourcePatients) {
  const targetName = `[結束] ${p.name}`;
  const targetPath = path.join(TARGET, targetName);
  const isMerge = fs.existsSync(targetPath);
  if (isMerge) {
    console.log(`   [合併] ${targetName}`);
    merged++;
  }
  copyMerge(p.src, targetPath);
  added++;
}
console.log('');
console.log(`✓ 完成：複製/合併 ${added} 個（其中 ${merged} 個是合併）`);
console.log(`✓ 病患資料夾現有總數：${fs.readdirSync(TARGET).length} 個`);
