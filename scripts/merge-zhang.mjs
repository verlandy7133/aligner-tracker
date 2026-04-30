// 一次性：把 810425張家婷（活躍）合併進 [結束] 810425張家婷 已下單UL活維3組 矯正結束/，
// 然後刪掉活躍那個。確認用戶說「張家婷定義為結束」的指示。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\矯正\\病患資料夾';
const SRC = path.join(ROOT, '810425張家婷');
const DST = path.join(ROOT, '[結束] 810425張家婷 已下單UL活維3組 矯正結束');

function merge(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, e.name);
    let dp = path.join(d, e.name);
    if (e.isDirectory()) {
      merge(sp, dp);
    } else if (e.isFile()) {
      if (fs.existsSync(dp)) {
        const ext = path.extname(e.name);
        const base = e.name.slice(0, -ext.length || undefined);
        let n = 2;
        while (fs.existsSync(path.join(d, `${base}_${n}${ext}`))) n++;
        dp = path.join(d, `${base}_${n}${ext}`);
        console.log(`  [merge] ${e.name} → ${path.basename(dp)}`);
      }
      fs.copyFileSync(sp, dp);
    }
  }
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const sub = path.join(p, e.name);
    if (e.isDirectory()) rmrf(sub);
    else fs.unlinkSync(sub);
  }
  fs.rmdirSync(p);
}

if (!fs.existsSync(SRC)) {
  console.error(`❌ 來源不存在：${SRC}`);
  process.exit(1);
}
if (!fs.existsSync(DST)) {
  console.error(`❌ 目標不存在：${DST}`);
  process.exit(1);
}

console.log(`合併：${path.basename(SRC)} → ${path.basename(DST)}`);
merge(SRC, DST);
console.log(`刪除來源…`);
rmrf(SRC);

const remaining = fs.readdirSync(ROOT).filter((n) => n.includes('張家婷'));
console.log(`✓ 完成。剩下含「張家婷」的：${JSON.stringify(remaining)}`);
console.log(`✓ 病患資料夾總數：${fs.readdirSync(ROOT).length}`);
