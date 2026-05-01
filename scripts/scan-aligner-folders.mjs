// Scanner v2：把扁平化後的 D:\矯正\病患資料夾\ 轉成 patients-import.json
//
// 規則：
//   - 每個子目錄 = 1 個病患（已在 build-flat-patient-folder.mjs 階段去重合併）
//   - 資料夾名前綴決定 status / productLine：
//     | 前綴       | productLine | status     | flags                          | hasConsent override |
//     | (無)       | riyue       | active     | []                             | -                   |
//     | [中斷]     | riyue       | paused     | []                             | -                   |
//     | [結束]     | riyue       | completed  | []                             | -                   |
//     | [維持器]   | retainer    | active*    | []  (*notes 含「正式」→ completed) | -                   |
//     | [綻雅]     | zenyum      | active     | []                             | -                   |
//     | [隱適美]   | invisalign  | active     | ['brand-switched-to-invisalign'] | -                  |
//     | [待確認]   | riyue       | active     | []                             | false (沒授權書)     |
//   - 資料夾名後半解析：[民國YYMMDD][姓名][備註]，支援 6/7 位民國年、姓名 2-4 字
//   - orderDate 不從資料夾推（新結構沒有日期父層）→ null，由 App 從 Order 紀錄補
//   - 精調級別 (refinement-1/2/3) 不在 scan 推論 → 由 App 從同病患的多筆 Order 推
//
// 使用：node scripts/scan-aligner-folders.mjs
// 輸出：dev-data/patients-import.json + 終端統計（不印姓名）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─── role guard ──────────────────────────────────────────
// dev-data/clinic-role.txt 內容必須是 "master" 才允許掃描。
// follower（開發機）只能透過 backup JSON 還原狀態，不該動 IndexedDB seed。
const ROLE_FILE = path.resolve('dev-data/clinic-role.txt');
let role = 'follower';
try {
  role = fs.readFileSync(ROLE_FILE, 'utf8').trim().toLowerCase();
} catch {
  // 檔不存在 → follower 預設
}
if (role !== 'master') {
  console.error(
    `[scan] 此機角色為 ${role}（檢查 ${ROLE_FILE}），拒絕掃描以免污染資料。\n` +
      `       新增病患請在筆電 (master) 上做、再匯出 backup JSON 到開發機還原。`,
  );
  process.exit(1);
}

// ─── 自動偵測安裝碟 ──────────────────────────────────────
const DRIVE = fs.existsSync('D:\\矯正') ? 'D:' : (process.env.SystemDrive || 'C:');
const ROOT = `${DRIVE}\\矯正\\病患資料夾`;
const OUT = 'dev-data/patients-import.json';

// ─── 前綴 → status/productLine 映射 ──────────────────────
const PREFIX_RULES = [
  { prefix: '[結束]', productLine: 'riyue', status: 'completed', flags: [] },
  { prefix: '[中斷]', productLine: 'riyue', status: 'paused', flags: [] },
  { prefix: '[隱適美]', productLine: 'invisalign', status: 'active', flags: ['brand-switched-to-invisalign'] },
  { prefix: '[綻雅]', productLine: 'zenyum', status: 'active', flags: [] },
  { prefix: '[維持器]', productLine: 'retainer', status: 'active', flags: [] },
  { prefix: '[待確認]', productLine: 'riyue', status: 'active', flags: [], hasConsentOverride: false },
];

function classifyByPrefix(folderName) {
  for (const rule of PREFIX_RULES) {
    if (folderName.startsWith(rule.prefix + ' ')) {
      return { rule, innerName: folderName.slice(rule.prefix.length + 1) };
    }
  }
  return {
    rule: { prefix: '', productLine: 'riyue', status: 'active', flags: [] },
    innerName: folderName,
  };
}

// ─── 個案覆寫：parser 抓不準的 edge case ────────────────
let FOLDER_OVERRIDES = {};
try {
  const ovPath = path.resolve('dev-data/folder-overrides.json');
  if (fs.existsSync(ovPath)) {
    FOLDER_OVERRIDES = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  }
} catch {}

// ─── 民國 → 西元 ISO ────────────────────────────────────
function rocBirthdayToISO(rocStr) {
  if (!/^\d{6,7}$/.test(rocStr)) return null;
  const len = rocStr.length;
  let year, month, day;
  if (len === 6) {
    year = parseInt(rocStr.slice(0, 2), 10) + 1911;
    month = parseInt(rocStr.slice(2, 4), 10);
    day = parseInt(rocStr.slice(4, 6), 10);
  } else {
    year = parseInt(rocStr.slice(0, 3), 10) + 1911;
    month = parseInt(rocStr.slice(3, 5), 10);
    day = parseInt(rocStr.slice(5, 7), 10);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─── 解析病患資料夾名（去前綴後的 inner name）───────────
// 支援格式：
//   A. 730602王小明           （數字在前）
//   B. 881018 王小英          （數字 + 空白 + 姓名）
//   C. 王小明810413           （姓名在前 — 階段 A normalize 後幾乎沒了，但保留容錯）
//   D. 王明1041207            （2 字姓名 + 7 位數）
//   E. 1021208王小華 轉隱適美  （數字 + 姓名 + 備註）
function parsePatientFolderName(folderName) {
  let rocBirth, name, notes;

  let m = folderName.match(/^(\d{7})\s*(.+)$/) || folderName.match(/^(\d{6})\s*(.+)$/);
  if (m) {
    rocBirth = m[1];
    const rest = m[2].trim();
    const nameMatch = rest.match(/^([一-龥]+)(.*)$/);
    if (!nameMatch) return null;
    name = nameMatch[1];
    notes = (nameMatch[2] || '').trim();
  } else {
    m = folderName.match(/^([一-龥]+)(\d{7})(.*)$/) || folderName.match(/^([一-龥]+)(\d{6})(.*)$/);
    if (!m) return null;
    name = m[1];
    rocBirth = m[2];
    notes = (m[3] || '').trim();
  }

  // 中文姓名超過 4 字 → 把超出當 notes 開頭（中文備註緊接姓名後的 edge case）
  if (name.length > 4) {
    notes = (name.slice(4) + ' ' + notes).trim();
    name = name.slice(0, 4);
  }

  notes = notes.replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '');
  return { rocBirth, name, notes };
}

// ─── 找授權書 PDF ─────────────────────────────────────
function findConsentPdf(folderPath) {
  try {
    const files = fs.readdirSync(folderPath, { withFileTypes: true });
    const pdfs = files
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.pdf'))
      .filter((f) => !/(指示單|轉介單)/.test(f.name));
    if (pdfs.length === 0) return null;
    const named = pdfs.find((f) => f.name.includes('授權書'));
    const chosen = named ?? pdfs[0];
    return path.join(folderPath, chosen.name);
  } catch {
    return null;
  }
}

// ─── 主邏輯 ─────────────────────────────────────────
const collected = [];
const warnings = [];

if (!fs.existsSync(ROOT)) {
  console.error(`❌ 來源不存在：${ROOT}`);
  console.error(`   先跑：node scripts/build-flat-patient-folder.mjs --apply`);
  process.exit(1);
}

const entries = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());

for (const entry of entries) {
  const folderName = entry.name;
  const folderPath = path.join(ROOT, folderName);
  const { rule, innerName } = classifyByPrefix(folderName);

  const parsed = parsePatientFolderName(innerName);
  if (!parsed) {
    warnings.push(`無法解析病患資料夾名: ${folderName}`);
    continue;
  }

  const birthday = rocBirthdayToISO(parsed.rocBirth);
  if (!birthday) {
    warnings.push(`生日格式異常 (${parsed.rocBirth}): ${folderName}`);
  }

  // 套用覆寫（key 用整個資料夾名 incl. prefix）
  const override = FOLDER_OVERRIDES[folderName] ?? FOLDER_OVERRIDES[innerName];
  const finalName = override?.name ?? parsed.name;
  const finalNotes = override?.notes ?? parsed.notes;

  const consentPdfPath = findConsentPdf(folderPath);

  // [維持器] 後處理：notes 含「正式」→ status 升 completed
  let status = rule.status;
  if (rule.productLine === 'retainer' && /正式/.test(finalNotes)) {
    status = 'completed';
  }

  // hasConsent：override 有 false 強制設、否則看 PDF 存在
  const hasConsent = rule.hasConsentOverride === false ? false : consentPdfPath !== null;

  collected.push({
    name: finalName,
    birthday,
    productLine: rule.productLine,
    status,
    flags: [...rule.flags],
    notes: finalNotes,
    sourceFolder: folderPath,
    hasConsent,
    consentPdfPath,
  });
}

// ─── 排序：按生日 ASC（最年長 = 0001）當 placeholder chartNo
// （Python Excel script 需要 chartNo 才能匹配病患；
//   真正最終 chartNo 由 src/seed.ts 在所有 import 完後按 earliest orderDate 重新編）
collected.sort((a, b) => {
  if (a.birthday && b.birthday) return a.birthday.localeCompare(b.birthday);
  if (a.birthday) return -1;
  if (b.birthday) return 1;
  return a.name.localeCompare(b.name, 'zh-Hant');
});

const now = new Date().toISOString();
const patients = collected.map((p, i) => ({
  id: crypto.randomUUID(),
  chartNo: String(i + 1).padStart(4, '0'),
  name: p.name,
  birthday: p.birthday,
  productLine: p.productLine,
  status: p.status,
  track: null, // 流派由 seed.ts 從 orders 推
  refinementLevel: 0, // 同上
  orderDate: null, // 新結構沒日期父層，由 App 從 Order 推
  startDate: null,
  totalAlignersUpper: null,
  currentAlignerUpper: null,
  totalAlignersLower: null,
  currentAlignerLower: null,
  cycleDays: 14,
  lastVisit: null,
  nextVisit: null,
  hasConsent: p.hasConsent,
  consentPdfPath: p.consentPdfPath,
  scanInfo: null,
  doctor: null,
  flags: p.flags,
  notes: p.notes,
  sourceFolder: p.sourceFolder,
  allSourceFolders: [p.sourceFolder],
  createdAt: now,
  updatedAt: now,
}));

// ─── 統計 ─────────────────────────────────────────────
const stats = {
  total: patients.length,
  byStatus: {},
  byProductLine: {},
};
for (const p of patients) {
  stats.byStatus[p.status] = (stats.byStatus[p.status] ?? 0) + 1;
  stats.byProductLine[p.productLine] = (stats.byProductLine[p.productLine] ?? 0) + 1;
}

console.log(`[scan v2] root: ${ROOT}`);
console.log(`[scan v2] 掃到 ${patients.length} 個病患`);
console.log(`[scan v2] byStatus: ${JSON.stringify(stats.byStatus)}`);
console.log(`[scan v2] byProductLine: ${JSON.stringify(stats.byProductLine)}`);
if (warnings.length > 0) {
  console.log(`[scan v2] warnings: ${warnings.length} 條`);
  for (const w of warnings.slice(0, 10)) console.log(`   ${w}`);
  if (warnings.length > 10) console.log(`   ...（還有 ${warnings.length - 10} 條）`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ patients }, null, 2), 'utf8');
console.log(`[scan v2] 已寫入：${OUT}`);
