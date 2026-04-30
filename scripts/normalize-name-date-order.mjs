// 一次性：把 D:\矯正\病患資料夾\ 底下「姓名在前、日期在後」的資料夾，
// 改名成「日期在前、姓名在後」格式，跟其他資料夾一致。
//
// 範例：
//   吳昕怡890121          → 890121吳昕怡
//   池佳1041207           → 1041207池佳
//   池佳1041207 備註xxx   → 1041207池佳 備註xxx
//
// 民國年支援 6 位 (YYMMDD) 跟 7 位 (YYYMMDD)。
//
// 用法：
//   node scripts/normalize-name-date-order.mjs --dry-run   # 只列要改的，不動
//   node scripts/normalize-name-date-order.mjs --apply     # 真的改

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\矯正\\病患資料夾';
// 姓名（2-4 中文字）+ 6 或 7 位數字 + (可選) 備註
const NAME_FIRST_RE = /^([一-龥]{2,4})(\d{6,7})(.*)$/;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isApply = args.includes('--apply');

if (!isDryRun && !isApply) {
  console.error('用法：node normalize-name-date-order.mjs [--dry-run | --apply]');
  process.exit(1);
}

const all = fs.readdirSync(ROOT);
const toRename = [];

for (const name of all) {
  // 跳過已經有狀態前綴的（[結束] xxx 等）— 那些前綴內容也可能是「姓名在前」格式，但 prefix 後我們不動
  // 其實也應該處理 prefixed 的，因為 [結束] 池佳1041207 也是顛倒的
  // 但目前不在 11 個 last entries 裡，先不處理 prefixed 的
  if (name.startsWith('[')) continue;

  const m = name.match(NAME_FIRST_RE);
  if (m) {
    const [, person, date, rest] = m;
    const newName = `${date}${person}${rest}`;
    toRename.push({ old: name, new: newName });
  }
}

console.log('=== 標準化「姓名在前」資料夾 ===');
console.log(`掃到 ${toRename.length} 個需要改名：`);
console.log('');
for (const r of toRename) {
  console.log(`  ${r.old}`);
  console.log(`     → ${r.new}`);
}
console.log('');

if (toRename.length === 0) {
  console.log('（無需改名）');
  process.exit(0);
}

// 衝突檢測
const conflicts = toRename.filter((r) => fs.existsSync(path.join(ROOT, r.new)));
if (conflicts.length > 0) {
  console.error(`❌ 偵測到 ${conflicts.length} 組衝突（新名字已存在）：`);
  for (const c of conflicts) console.error(`   ${c.old} → ${c.new}（已存在）`);
  console.error(`先手動處理再重跑。`);
  process.exit(1);
}

if (isDryRun) {
  console.log('🔍 DRY RUN 結束，未改名。');
  console.log('   要真的改：node scripts/normalize-name-date-order.mjs --apply');
  process.exit(0);
}

console.log('開始改名…');
let done = 0;
for (const r of toRename) {
  fs.renameSync(path.join(ROOT, r.old), path.join(ROOT, r.new));
  done++;
  console.log(`  ✓ ${r.new}`);
}
console.log('');
console.log(`✓ 完成。${done} 個資料夾已改名。`);
console.log(`✓ 病患資料夾總數：${fs.readdirSync(ROOT).length}`);
