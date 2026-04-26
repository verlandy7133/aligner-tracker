// Scanner: 把 D:\矯正\口掃檔 取資料 下單\ 真實資料夾結構
// 轉成 patients-import.json，給 Step 2 的 Dexie 匯入用。
//
// 規則：
//   - 月份資料夾 (1月~12月)：底下有 YYYYMMDD 子層 → orderDate = 該日
//   - 20260421 / 20260422 等獨立日期：底下直接放病患 → orderDate = 該日
//   - 中斷療程 / 矯正結束 / 轉隱適美 / 綻雅病人 / 單純做維持器 / 前期未有授權書：直接放病患 → orderDate = null
//   - 病患資料夾名格式：[民國YYMMDD][姓名][...備註]
//     - 民國年 2 位 (73) 或 3 位 (102) 都支援
//     - 姓名取數字後第一段中文 (到第一個空白或非中文字元為止)
//     - 剩下的算 notes
//   - chartNo: 全部收集後按 (orderDate ASC, name ASC) 排序，編 0001 起
//
// 使用：node scripts/scan-aligner-folders.mjs
// 輸出：dev-data/patients-import.json + 終端統計（不印姓名）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'D:\\矯正\\口掃檔 取資料 下單';
const OUT = 'dev-data/patients-import.json';

// --- 分類映射 ---
// 重要：除了「轉隱適美」是真的隱適美病人，其他預設品牌都是 riyue (日月辰心)。
const CATEGORY_MAP = {
  '中斷療程': { productLine: 'riyue', status: 'paused' },
  '矯正結束': { productLine: 'riyue', status: 'completed' },
  '轉隱適美': { productLine: 'invisalign', status: 'active', flags: ['brand-switched-to-invisalign'] },
  '綻雅病人': { productLine: 'zenyum', status: 'active' },
  '單純做暫維或正式維持器': { productLine: 'retainer', status: 'active' },
  '前期未有授權書的病人 要再跟病人確認方案': {
    productLine: 'riyue',
    status: 'active',
    hasConsent: false, // 此資料夾本身就是「沒授權書」的歸檔，明確強制 false
  },
};

// 掃 patient folder 找授權書 PDF。
// Ground truth：實體 PDF 存在 = 已簽授權書，但要排除已知非授權書的檔名。
// 偵測順序：
//   1. 優先選含「授權書」三字的（最明確）
//   2. 否則選任何 PDF（多數姓名.pdf 是授權書）
//   3. 排除：含「指示單」「轉介單」的 PDF 不算授權書
function findConsentPdf(folderPath) {
  try {
    const files = fs.readdirSync(folderPath, { withFileTypes: true });
    const pdfs = files
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.pdf'))
      .filter((f) => !/(指示單|轉介單)/.test(f.name));
    if (pdfs.length === 0) return null;
    // 優先含「授權書」的
    const named = pdfs.find((f) => f.name.includes('授權書'));
    const chosen = named ?? pdfs[0];
    return path.join(folderPath, chosen.name);
  } catch {
    return null;
  }
}

// 月份資料夾與獨立 YYYYMMDD 資料夾的預設品牌（一般治療中的病人 = 日月辰心）
const DEFAULT_PRODUCT_LINE = 'riyue';

const MONTH_PATTERN = /^(\d{1,2})月$/;
const DATE_FOLDER_PATTERN = /^(\d{8})/; // 20260401, 20260202下單完成 etc.

// --- 個案覆寫：parser 抓不準的 edge case（key = 原始資料夾名）---
// parser 對「3 字姓名 + 緊接中文備註」會抓錯字界，需要 hardcode 修正。
// 真實覆寫表放在 dev-data/folder-overrides.json（含真名，不進 git）。
// 範例格式：{ "YYMMDD真名特殊備註": { "name": "真名", "notes": "特殊備註" } }
let FOLDER_OVERRIDES = {};
try {
  const ovPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'dev-data', 'folder-overrides.json');
  if (fs.existsSync(ovPath)) {
    FOLDER_OVERRIDES = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  }
} catch {
  // 沒這檔也 OK
}

// --- 民國年 → 西元 ISO ---
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

// --- 解析病患資料夾名 ---
// 例：730602王小明 → { rocBirth: '730602', name: '王小明', notes: '' }
// 例：1021208王小華 轉隱適美 0314下單 → { rocBirth: '1021208', name: '王小華', notes: '轉隱適美 0314下單' }
// 註：parser 對「3字姓名 + 緊接中文備註（無空白分隔）」會抓錯字界，
//     此類 edge case 走 dev-data/folder-overrides.json 強制覆寫。
function parsePatientFolderName(folderName) {
  // 三種格式都要支援：
  //   A. 730602王小明          → 數字在前
  //   B. 881018 王小英          → 數字在前 + 空白 + 姓名
  //   C. 王小明810413           → 姓名在前、數字在後
  //   D. 王明1041207            → 姓名 (2字) + 7位數字
  //   E. 1021208王小華 轉隱適美 → 數字在前 + 姓名 + 備註

  let rocBirth, name, notes;

  // Pattern A/B/E：開頭是數字
  let m = folderName.match(/^(\d{7})\s*(.+)$/) || folderName.match(/^(\d{6})\s*(.+)$/);
  if (m) {
    rocBirth = m[1];
    const rest = m[2].trim();
    const nameMatch = rest.match(/^([\u4e00-\u9fa5]+)(.*)$/);
    if (!nameMatch) return null;
    name = nameMatch[1];
    notes = (nameMatch[2] || '').trim();
  } else {
    // Pattern C/D：開頭是中文，後面接數字
    m = folderName.match(/^([\u4e00-\u9fa5]+)(\d{7})(.*)$/) || folderName.match(/^([\u4e00-\u9fa5]+)(\d{6})(.*)$/);
    if (!m) return null;
    name = m[1];
    rocBirth = m[2];
    notes = (m[3] || '').trim();
  }

  // 中文姓名一般 2~4 字。超過代表「姓名後面接的也是中文備註」
  if (name.length > 4) {
    notes = (name.slice(4) + ' ' + notes).trim();
    name = name.slice(0, 4);
  }

  notes = notes.replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '');

  return { rocBirth, name, notes };
}

// --- 解析日期資料夾 (YYYYMMDD...) ---
function parseOrderDateFolder(folderName) {
  const m = folderName.match(DATE_FOLDER_PATTERN);
  if (!m) return null;
  const ymd = m[1];
  const y = ymd.slice(0, 4);
  const mo = ymd.slice(4, 6);
  const d = ymd.slice(6, 8);
  return `${y}-${mo}-${d}`;
}

// --- 主邏輯 ---
const collected = [];
const warnings = [];

function pushPatient({ folderPath, folderName, orderDate, productLine, status, flags = [], hasConsentOverride }) {
  const parsed = parsePatientFolderName(folderName);
  if (!parsed) {
    warnings.push(`無法解析病患資料夾: ${folderPath}`);
    return;
  }
  const birthday = rocBirthdayToISO(parsed.rocBirth);
  if (!birthday) {
    warnings.push(`生日格式異常 (${parsed.rocBirth}): ${folderPath}`);
  }

  // 套用覆寫（如果有）
  const override = FOLDER_OVERRIDES[folderName];
  const finalName = override?.name ?? parsed.name;
  const finalNotes = override?.notes ?? parsed.notes;

  // 掃 PDF（授權書 ground truth）
  const consentPdfPath = findConsentPdf(folderPath);

  collected.push({
    name: finalName,
    birthday,
    productLine,
    status,
    orderDate,
    flags,
    notes: finalNotes,
    sourceFolder: folderPath,
    hasConsentOverride,
    consentPdfPath,
  });
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    warnings.push(`讀取失敗 ${dir}: ${e.message}`);
    return [];
  }
}

const topLevel = safeReaddir(ROOT);

for (const entry of topLevel) {
  if (!entry.isDirectory()) continue;
  const name = entry.name;
  const fullPath = path.join(ROOT, name);

  // 月份資料夾
  if (MONTH_PATTERN.test(name)) {
    const dayFolders = safeReaddir(fullPath);
    for (const dayEntry of dayFolders) {
      if (!dayEntry.isDirectory()) continue;
      const orderDate = parseOrderDateFolder(dayEntry.name);
      if (!orderDate) {
        warnings.push(`月份下找到非日期資料夾: ${path.join(fullPath, dayEntry.name)}`);
        continue;
      }
      const dayPath = path.join(fullPath, dayEntry.name);
      const patients = safeReaddir(dayPath);
      for (const p of patients) {
        if (!p.isDirectory()) continue;
        pushPatient({
          folderPath: path.join(dayPath, p.name),
          folderName: p.name,
          orderDate,
          productLine: DEFAULT_PRODUCT_LINE,
          status: 'active',
        });
      }
    }
    continue;
  }

  // 獨立 YYYYMMDD 資料夾（還沒歸月）
  if (/^\d{8}$/.test(name)) {
    const orderDate = parseOrderDateFolder(name);
    const patients = safeReaddir(fullPath);
    for (const p of patients) {
      if (!p.isDirectory()) continue;
      pushPatient({
        folderPath: path.join(fullPath, p.name),
        folderName: p.name,
        orderDate,
        productLine: DEFAULT_PRODUCT_LINE,
        status: 'active',
      });
    }
    continue;
  }

  // 特殊分類資料夾
  if (CATEGORY_MAP[name]) {
    const cfg = CATEGORY_MAP[name];
    const children = safeReaddir(fullPath);
    for (const child of children) {
      if (!child.isDirectory()) continue;

      // 矯正結束 底下有 YYYYMMDD 子層
      if (name === '矯正結束' && /^\d{8}/.test(child.name)) {
        const orderDate = parseOrderDateFolder(child.name);
        const patients = safeReaddir(path.join(fullPath, child.name));
        for (const p of patients) {
          if (!p.isDirectory()) continue;
          pushPatient({
            folderPath: path.join(fullPath, child.name, p.name),
            folderName: p.name,
            orderDate,
            productLine: cfg.productLine,
            status: cfg.status,
            flags: cfg.flags || [],
          });
        }
        continue;
      }

      // 其他特殊分類：直接放病患
      pushPatient({
        folderPath: path.join(fullPath, child.name),
        folderName: child.name,
        orderDate: null,
        productLine: cfg.productLine,
        status: cfg.status,
        flags: cfg.flags || [],
        hasConsentOverride: cfg.hasConsent,
      });
    }
    continue;
  }

  warnings.push(`未分類的頂層資料夾: ${name}`);
}

// --- 後處理規則 ---
// 「正式維持器」= 矯正療程已結案，status 改 completed（暫維仍是 active）
for (const p of collected) {
  if (p.productLine === 'retainer' && /正式/.test(p.notes)) {
    p.status = 'completed';
  }
}

// --- 同人合併：相同姓名 + 生日 → 視為同一病患的多階段紀錄，合成一筆 ---
// 規則：
//   - 以最早 orderDate 為主紀錄，保留 sourceFolder + 最早的 orderDate
//   - 其他筆的 notes 串接（用 " | " 分隔）
//   - flags 取聯集，hasConsent 取 OR（任何一筆有就算有）
//   - status 升級規則（從低到高）：
//       active < refinement-1 < refinement-2 < refinement-3 < completed
//       paused / transferred-out 為特殊終態
//   - productLine 升級規則：
//       任一筆是 invisalign（轉隱適美）→ 合併後 productLine = invisalign + brand-switched flag
//       任一筆是 retainer（單純維持器）→ 主治療結束 → status = completed
//       任一筆是 zenyum → productLine = zenyum
//   - 「同品牌、同 active 狀態、有多筆下單日」→ 視為精調，count - 1 = 第幾次精調
const byPersonKey = new Map();
for (const p of collected) {
  const key = p.birthday ? `${p.name}|${p.birthday}` : `${p.name}|nobd|${p.sourceFolder}`;
  if (!byPersonKey.has(key)) byPersonKey.set(key, []);
  byPersonKey.get(key).push(p);
}

const merged = [];
const mergedNotes = []; // 紀錄哪幾筆被合併（給 user 看）

for (const records of byPersonKey.values()) {
  if (records.length === 1) {
    merged.push(records[0]);
    continue;
  }

  // 排序：依 orderDate ASC，沒下單日放最後
  records.sort((a, b) => {
    const da = a.orderDate ?? '9999-99-99';
    const db = b.orderDate ?? '9999-99-99';
    return da.localeCompare(db);
  });

  const base = { ...records[0] };
  const allNotes = new Set();
  const allFlags = new Set();
  const allFolders = [];
  let hasConsent = false;
  let consentPdf = null;
  let hasInvisalignSwitch = false;
  let hasZenyum = false;
  let hasCompleted = false;
  let hasPaused = false;

  // 計算同品牌下單筆數（用來決定精調幾）
  // 主品牌 = 最早下單那筆的品牌（通常是 riyue）
  const baseBrand = records[0].productLine;
  let sameBrandOrders = 0;

  for (const r of records) {
    if (r.notes) allNotes.add(r.notes);
    for (const f of r.flags) allFlags.add(f);
    allFolders.push(r.sourceFolder);
    if (r.hasConsent) hasConsent = true;
    if (r.consentPdfPath) consentPdf = r.consentPdfPath;
    if (r.productLine === 'invisalign') hasInvisalignSwitch = true;
    if (r.productLine === 'zenyum') hasZenyum = true;
    if (r.status === 'completed') hasCompleted = true;
    if (r.status === 'paused') hasPaused = true;
    if (r.productLine === baseBrand && r.orderDate) sameBrandOrders++;
  }

  // 決定 productLine
  if (hasInvisalignSwitch) {
    base.productLine = 'invisalign';
    allFlags.add('brand-switched-to-invisalign');
  } else if (hasZenyum) {
    base.productLine = 'zenyum';
  }
  // retainer 不改 productLine（維持原本 riyue / invisalign），只升 status

  // 決定 status
  // hasCompleted 已經涵蓋了「正式維持器」(後處理 1 升級過)，所以這裡不再 OR hasRetainer
  if (hasCompleted) {
    base.status = 'completed';
  } else if (hasPaused) {
    base.status = 'paused';
  } else if (sameBrandOrders >= 2) {
    // 精調：兩筆同品牌下單 = refinement-1，三筆 = refinement-2，依此類推
    const refinementLevel = sameBrandOrders - 1;
    if (refinementLevel === 1) base.status = 'refinement-1';
    else if (refinementLevel === 2) base.status = 'refinement-2';
    else base.status = 'refinement-3';
  } else {
    base.status = 'active';
  }

  base.flags = [...allFlags];
  base.notes = [...allNotes].join(' | ');
  base.hasConsent = hasConsent;
  base.consentPdfPath = consentPdf;
  // sourceFolder 主路徑保留最早那筆，但加個 allSourceFolders 給 modal 顯示用
  base.allSourceFolders = allFolders;

  merged.push(base);
  mergedNotes.push({
    name: records[0].name,
    chartNos: records.map((r) => null), // chartNo 還沒編，先佔位
    finalStatus: base.status,
    finalProductLine: base.productLine,
    sourceFolders: allFolders.length,
  });
}

console.log('\n[merge] 合併同人重複：' + collected.length + ' 筆 → ' + merged.length + ' 筆 (合併 ' + (collected.length - merged.length) + ' 筆)');

// 用 merged 取代 collected 繼續往下走
collected.length = 0;
collected.push(...merged);

// --- 排序 + 編 chartNo ---
collected.sort((a, b) => {
  const da = a.orderDate || '9999-99-99';
  const db = b.orderDate || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
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
  orderDate: p.orderDate,
  startDate: null,
  totalAlignersUpper: null,
  currentAlignerUpper: null,
  totalAlignersLower: null,
  currentAlignerLower: null,
  cycleDays: 10,
  lastVisit: null,
  nextVisit: null,
  hasConsent:
    p.hasConsent !== undefined
      ? p.hasConsent // 已被 merge 階段算好的
      : p.hasConsentOverride !== undefined
        ? p.hasConsentOverride
        : p.consentPdfPath !== null,
  consentPdfPath: p.consentPdfPath,
  allSourceFolders: p.allSourceFolders ?? [p.sourceFolder],
  flags: p.flags,
  notes: p.notes,
  sourceFolder: p.sourceFolder,
  createdAt: now,
  updatedAt: now,
}));

// --- 統計（不印名字）---
const stats = {
  total: patients.length,
  byStatus: {},
  byProductLine: {},
  withBirthday: 0,
  withOrderDate: 0,
  withNotes: 0,
  withFlags: 0,
  withoutConsent: 0,
  birthdayYearRange: { min: null, max: null },
  orderDateRange: { min: null, max: null },
};

for (const p of patients) {
  stats.byStatus[p.status] = (stats.byStatus[p.status] || 0) + 1;
  stats.byProductLine[p.productLine] = (stats.byProductLine[p.productLine] || 0) + 1;
  if (p.birthday) {
    stats.withBirthday++;
    const y = p.birthday.slice(0, 4);
    if (!stats.birthdayYearRange.min || y < stats.birthdayYearRange.min) stats.birthdayYearRange.min = y;
    if (!stats.birthdayYearRange.max || y > stats.birthdayYearRange.max) stats.birthdayYearRange.max = y;
  }
  if (p.orderDate) {
    stats.withOrderDate++;
    if (!stats.orderDateRange.min || p.orderDate < stats.orderDateRange.min) stats.orderDateRange.min = p.orderDate;
    if (!stats.orderDateRange.max || p.orderDate > stats.orderDateRange.max) stats.orderDateRange.max = p.orderDate;
  }
  if (p.notes) stats.withNotes++;
  if (p.flags.length) stats.withFlags++;
  if (!p.hasConsent) stats.withoutConsent++;
}

// --- 輸出 ---
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: now, count: patients.length, patients }, null, 2), 'utf8');

console.log('\n=== Aligner Tracker — Folder Scan ===');
console.log(`輸出檔案：${OUT}`);
console.log(`總人數：${stats.total}\n`);

console.log('— 按 status 分類 —');
for (const [k, v] of Object.entries(stats.byStatus)) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}
console.log('\n— 按 productLine 分類 —');
for (const [k, v] of Object.entries(stats.byProductLine)) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}

console.log('\n— 資料完整度 —');
console.log(`  有生日：${stats.withBirthday}/${stats.total}`);
console.log(`  有下單日：${stats.withOrderDate}/${stats.total}`);
console.log(`  有備註：${stats.withNotes}/${stats.total}`);
console.log(`  有 flags：${stats.withFlags}/${stats.total}`);
console.log(`  無授權書：${stats.withoutConsent}/${stats.total}`);

if (stats.birthdayYearRange.min) {
  console.log(`\n生日年份範圍：${stats.birthdayYearRange.min} ~ ${stats.birthdayYearRange.max}`);
}
if (stats.orderDateRange.min) {
  console.log(`下單日範圍：${stats.orderDateRange.min} ~ ${stats.orderDateRange.max}`);
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 筆警告：`);
  warnings.slice(0, 20).forEach(w => console.log(`  - ${w}`));
  if (warnings.length > 20) console.log(`  ... 還有 ${warnings.length - 20} 筆`);
}
