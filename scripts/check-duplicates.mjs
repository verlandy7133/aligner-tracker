import fs from 'node:fs';
import path from 'node:path';

const d = JSON.parse(fs.readFileSync('dev-data/patients-import.json', 'utf8'));

const byName = {};
d.patients.forEach((p) => {
  if (!byName[p.name]) byName[p.name] = [];
  byName[p.name].push(p);
});

const dups = Object.entries(byName).filter(([, arr]) => arr.length > 1);

const mask = (s) => (s ? s[0] + '*'.repeat(Math.max(s.length - 1, 1)) : '');
const ROOT = 'D:\\矯正\\口掃檔 取資料 下單\\';

console.log('=== 重複姓名分析 ===');
console.log(
  '共 ' + dups.length + ' 個姓名出現 >1 次（涉及 ' + dups.reduce((s, [, a]) => s + a.length, 0) + ' 筆）',
);

const sameBirthday = [];
const diffBirthday = [];

for (const [name, arr] of dups) {
  const bdays = new Set(arr.map((p) => p.birthday));
  if (bdays.size === 1) sameBirthday.push({ name, arr });
  else diffBirthday.push({ name, arr });
}

console.log('');
console.log('=== A. 同姓名同生日 (' + sameBirthday.length + ' 組) — 大概率是同一人在不同分類 ===');
for (const { name, arr } of sameBirthday) {
  console.log('');
  console.log('  ' + mask(name) + ' (' + arr[0].birthday + ')');
  for (const p of arr) {
    const rel = p.sourceFolder.startsWith(ROOT) ? p.sourceFolder.slice(ROOT.length) : p.sourceFolder;
    console.log('    [' + p.chartNo + '] ' + p.status.padEnd(10) + ' ' + p.productLine.padEnd(11) + ' → ' + rel);
  }
}

console.log('');
console.log('=== B. 同姓名但不同生日 (' + diffBirthday.length + ' 組) — 不同人 ===');
for (const { name, arr } of diffBirthday) {
  console.log('  ' + mask(name) + ': ' + arr.map((p) => p.chartNo + '(' + p.birthday + ')').join(' | '));
}
