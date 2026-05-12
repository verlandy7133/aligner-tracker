// 路徑遷移工具（v0.3.2 新增）
//
// 用途：當 user 改 dataRoot（例 C:\矯正 → W:\0矯正追蹤）後、IndexedDB 內所有
// patient.sourceFolder / consentPdfPath 還是舊路徑、需要 batch 改寫。
//
// 使用流程（App ⚙ 設定 → 路徑遷移 section）：
//   1. 點「掃描」→ 回傳要遷移的筆數 + 3 個 sample
//   2. 用戶確認 → 點「執行遷移」→ batch update IndexedDB
//   3. 提示「Ctrl+Shift+R 重整 + 推到 NAS」

import { db } from '../db';
import type { Patient } from '../types/Patient';

// 預設要 strip 的「舊 prefix」、改寫成當前 dataRoot
// 順序：先 match 最具體（含子資料夾）、再 match 一般
const OLD_PREFIXES = [
  /^C:\\矯正\\/i,
  /^D:\\矯正\\/i,
  /^W:\\矯正追蹤\\/i, // v0.3.1 之前還沒改 0 前綴的版本
];

export type MigrationCandidate = {
  id: string;
  name: string;
  field: 'sourceFolder' | 'consentPdfPath';
  oldPath: string;
  newPath: string;
};

export type MigrationScan = {
  total: number;
  candidates: MigrationCandidate[];
  // 已是新路徑（skip）+ 找不到舊 prefix 的（skip）的計數
  alreadyCorrect: number;
  unknown: number;
};

// 把舊路徑 prefix 改寫成新 dataRoot 前綴
// 例：C:\矯正\病患資料夾\xxx + newRoot=W:\0矯正追蹤 → W:\0矯正追蹤\病患資料夾\xxx
function rewritePath(oldPath: string, newRoot: string): string | null {
  if (!oldPath) return null;
  for (const re of OLD_PREFIXES) {
    if (re.test(oldPath)) {
      const stripped = oldPath.replace(re, '');
      // newRoot 結尾不要 \、加上 \ + stripped
      const cleanRoot = newRoot.replace(/\\+$/, '');
      return `${cleanRoot}\\${stripped}`;
    }
  }
  return null; // 沒匹配 = 不知道怎麼 migrate
}

export async function scanMigration(newDataRoot: string): Promise<MigrationScan> {
  const all = await db.patients.toArray();
  const candidates: MigrationCandidate[] = [];
  let alreadyCorrect = 0;
  let unknown = 0;

  const cleanRoot = newDataRoot.replace(/\\+$/, '');

  for (const p of all) {
    // sourceFolder
    if (p.sourceFolder) {
      if (p.sourceFolder.toLowerCase().startsWith(cleanRoot.toLowerCase())) {
        alreadyCorrect++;
      } else {
        const newPath = rewritePath(p.sourceFolder, newDataRoot);
        if (newPath) {
          candidates.push({
            id: p.id,
            name: p.name,
            field: 'sourceFolder',
            oldPath: p.sourceFolder,
            newPath,
          });
        } else {
          unknown++;
        }
      }
    }
    // consentPdfPath
    if (p.consentPdfPath) {
      if (p.consentPdfPath.toLowerCase().startsWith(cleanRoot.toLowerCase())) {
        alreadyCorrect++;
      } else {
        const newPath = rewritePath(p.consentPdfPath, newDataRoot);
        if (newPath) {
          candidates.push({
            id: p.id,
            name: p.name,
            field: 'consentPdfPath',
            oldPath: p.consentPdfPath,
            newPath,
          });
        } else {
          unknown++;
        }
      }
    }
  }

  return {
    total: all.length,
    candidates,
    alreadyCorrect,
    unknown,
  };
}

export type MigrationResult = {
  updatedPatients: number;
  fieldsUpdated: number;
};

export async function applyMigration(candidates: MigrationCandidate[]): Promise<MigrationResult> {
  const nowIso = new Date().toISOString();
  // 按 id group（同一 patient 可能 sourceFolder + consentPdfPath 都要改）
  const byId = new Map<string, MigrationCandidate[]>();
  for (const c of candidates) {
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id)!.push(c);
  }

  let updatedPatients = 0;
  let fieldsUpdated = 0;

  await db.transaction('rw', db.patients, async () => {
    for (const [id, fixes] of byId) {
      const p = await db.patients.get(id);
      if (!p) continue;
      const patch: Partial<Patient> = { updatedAt: nowIso };
      for (const f of fixes) {
        (patch as Record<string, unknown>)[f.field] = f.newPath;
        fieldsUpdated++;
      }
      await db.patients.update(id, patch);
      updatedPatients++;
    }
  });

  return { updatedPatients, fieldsUpdated };
}
