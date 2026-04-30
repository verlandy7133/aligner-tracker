#!/usr/bin/env node
// 比對兩個 aligner-tracker backup JSON 是否同步。
// 用法：
//   node scripts/verify-sync.mjs <master.json> <mirror.json> [--report=path/to/report.md]
//
// 場景：D 機器（master）跟筆電（mirror）各自 export backup 後，跑這個工具驗證內容一致。
// 預期：mirror 應該完全來自 master（單向同步），所以 hash 一致 = 同步成功。
// 差異：列出 patient / order / settings 的 added / removed / changed。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const reportArg = args.find((a) => a.startsWith('--report='));
const reportPath = reportArg ? reportArg.slice('--report='.length) : null;
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length !== 2) {
  console.error(`用法：node verify-sync.mjs <master.json> <mirror.json> [--report=PATH]

範例：
  node scripts/verify-sync.mjs \\
    "D:/Dropbox/Dropbox/應用程式/aligner-tracker-sync/master-latest.json" \\
    "D:/Dropbox/Dropbox/應用程式/aligner-tracker-sync/laptop-latest.json"
`);
  process.exit(2);
}

const [masterPath, mirrorPath] = positional;

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`❌ 找不到 ${label}: ${p}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`❌ ${label} 不是合法 JSON: ${e.message}`);
    process.exit(1);
  }
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

const master = readJson(masterPath, 'master');
const mirror = readJson(mirrorPath, 'mirror');

const lines = [];
const log = (s) => { console.log(s); lines.push(s); };

log(`# Aligner Tracker — Sync Verification`);
log(``);
log(`- master:  \`${path.basename(masterPath)}\` (export ${master.exportedAt || '?'}, app ${master.appVersion || '?'})`);
log(`- mirror:  \`${path.basename(mirrorPath)}\` (export ${mirror.exportedAt || '?'}, app ${mirror.appVersion || '?'})`);
log(``);

// 1. 整體 hash
const mHash = sha256(master);
const lHash = sha256(mirror);
const allMatch = mHash === lHash;
log(`## 整體 hash`);
log(``);
log(`- master sha256: \`${mHash}\``);
log(`- mirror sha256: \`${lHash}\``);
log(`- 結果: ${allMatch ? '✅ 完全一致 — 同步成功' : '⚠️ 不一致 — 看以下逐項'}`);
log(``);

// 2. 逐 collection 比對
const collections = ['patients', 'orders', 'settings'];
const idField = { patients: 'id', orders: 'id', settings: 'key' };

let totalDiffs = 0;

for (const col of collections) {
  const mList = master[col] || [];
  const lList = mirror[col] || [];
  const idKey = idField[col];

  const mMap = new Map(mList.map((r) => [r[idKey], r]));
  const lMap = new Map(lList.map((r) => [r[idKey], r]));

  const onlyMaster = [];
  const onlyMirror = [];
  const changed = [];

  for (const [id, mRec] of mMap) {
    if (!lMap.has(id)) {
      onlyMaster.push(mRec);
    } else if (sha256(mRec) !== sha256(lMap.get(id))) {
      changed.push({ id, master: mRec, mirror: lMap.get(id) });
    }
  }
  for (const [id, lRec] of lMap) {
    if (!mMap.has(id)) onlyMirror.push(lRec);
  }

  const ok = onlyMaster.length === 0 && onlyMirror.length === 0 && changed.length === 0;
  log(`## ${col}`);
  log(``);
  log(`- master 筆數: ${mList.length}`);
  log(`- mirror 筆數: ${lList.length}`);
  log(`- 結果: ${ok ? '✅ 完全一致' : `⚠️ 有差異`}`);

  if (!ok) {
    totalDiffs += onlyMaster.length + onlyMirror.length + changed.length;
    if (onlyMaster.length > 0) {
      log(``);
      log(`### Master 有但 Mirror 沒（筆電未同步）— ${onlyMaster.length} 筆`);
      log(``);
      for (const r of onlyMaster.slice(0, 20)) {
        const label = r.name ? `${r.chartNo || '?'} ${r.name}` : (r.key || r.id);
        log(`- \`${r[idKey]}\` ${label} (created ${r.createdAt || '?'})`);
      }
      if (onlyMaster.length > 20) log(`- ...還有 ${onlyMaster.length - 20} 筆`);
    }
    if (onlyMirror.length > 0) {
      log(``);
      log(`### Mirror 有但 Master 沒（筆電端不該有的多餘資料 — 警告）— ${onlyMirror.length} 筆`);
      log(``);
      for (const r of onlyMirror.slice(0, 20)) {
        const label = r.name ? `${r.chartNo || '?'} ${r.name}` : (r.key || r.id);
        log(`- \`${r[idKey]}\` ${label} (created ${r.createdAt || '?'})`);
      }
      if (onlyMirror.length > 20) log(`- ...還有 ${onlyMirror.length - 20} 筆`);
    }
    if (changed.length > 0) {
      log(``);
      log(`### 兩邊內容不同 — ${changed.length} 筆`);
      log(``);
      for (const c of changed.slice(0, 20)) {
        const m = c.master, l = c.mirror;
        const label = m.name ? `${m.chartNo || '?'} ${m.name}` : (m.key || c.id);
        log(`- \`${c.id}\` ${label}`);
        // 找出哪些欄位不同
        const allKeys = new Set([...Object.keys(m), ...Object.keys(l)]);
        const diffs = [];
        for (const k of allKeys) {
          if (JSON.stringify(m[k]) !== JSON.stringify(l[k])) {
            diffs.push(k);
          }
        }
        log(`    差異欄位: ${diffs.join(', ')}`);
      }
      if (changed.length > 20) log(`- ...還有 ${changed.length - 20} 筆`);
    }
  }
  log(``);
}

// 3. 結論
log(`## 結論`);
log(``);
if (allMatch) {
  log(`✅ **同步成功** — master 與 mirror 內容完全一致。`);
} else if (totalDiffs === 0) {
  log(`⚠️ 整體 hash 不一致但逐項無差異 — 可能 export 時間 / 排序差異，內容實質一致。`);
} else {
  log(`❌ **同步失敗** — 共 ${totalDiffs} 筆差異待處理。`);
  log(``);
  log(`下一步建議：`);
  log(`1. 確認 master export 後，**筆電是否有重新 import**`);
  log(`2. 「Mirror 有但 Master 沒」的條目 = 筆電端被誤改 → 不該發生（筆電是 read-only mirror）`);
  log(`3. 重 import master-latest.json 到筆電後再跑一次 verify`);
}

if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\n→ 報告已寫到 ${reportPath}`);
}

process.exit(allMatch ? 0 : 1);
