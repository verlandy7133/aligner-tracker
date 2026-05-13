// 合併兩筆 patient — 把 source 的 order 轉到 target、target 空欄位從 source 補、刪 source
// v0.3.18 新增、配合「同名病患統計」section 解決 dedup miss 造成的雙筆
//
// 不會 merge 的欄位（避免破壞 target 已編輯的）：
//   - photos: 完全不動 target.photos
//   - sourceFolder: 保留 target.sourceFolder（target = 對的那筆）
//   - chartNo: 保留 target.chartNo
//   - track / refinementLevel: 保留 target（基本一致、不冒險）
//
// 會 merge 的欄位：
//   - birthday / doctor / scanInfo / totalAligners*: 只在 target 為空時、從 source 補
//   - hasConsent: source=true 就 target=true
//   - consentPdfPath: target 缺就從 source 補
//   - notes / markdownNote: 直接 concat，加分隔行標記來源
//   - allSourceFolders: 把 source.sourceFolder 加進去（保留 source 資料夾的歷史足跡）

import { db } from '../db';
import type { Patient } from '../types/Patient';

export type MergeResult = {
  ordersTransferred: number;
  fieldsMerged: string[];
  sourceLabel: string; // 例 "0363 蘇茁濼"
  targetLabel: string; // 例 "0001 蘇茁濼"
};

export async function mergePatients(
  sourceId: string,
  targetId: string,
): Promise<MergeResult> {
  if (sourceId === targetId) {
    throw new Error('source 不能等於 target');
  }

  const result: MergeResult = {
    ordersTransferred: 0,
    fieldsMerged: [],
    sourceLabel: '',
    targetLabel: '',
  };
  const nowIso = new Date().toISOString();

  await db.transaction('rw', db.patients, db.orders, async () => {
    const source = await db.patients.get(sourceId);
    const target = await db.patients.get(targetId);
    if (!source) throw new Error(`找不到 source patient (id=${sourceId})`);
    if (!target) throw new Error(`找不到 target patient (id=${targetId})`);

    result.sourceLabel = `${source.chartNo} ${source.name}`;
    result.targetLabel = `${target.chartNo} ${target.name}`;

    // 1. 轉 order patientId、同步更新 denormalized 欄位 (patientChartNo / patientName)
    const orders = await db.orders.where('patientId').equals(sourceId).toArray();
    for (const o of orders) {
      await db.orders.update(o.id, {
        patientId: targetId,
        patientChartNo: target.chartNo,
        patientName: target.name,
        updatedAt: nowIso,
      });
    }
    result.ordersTransferred = orders.length;

    // 2. 補 target 的空欄位（從 source 拿）
    const patch: Partial<Patient> = {};
    if (!target.birthday && source.birthday) {
      patch.birthday = source.birthday;
      result.fieldsMerged.push('birthday');
    }
    if (!target.doctor?.trim() && source.doctor?.trim()) {
      patch.doctor = source.doctor;
      result.fieldsMerged.push('doctor');
    }
    if (!target.scanInfo?.trim() && source.scanInfo?.trim()) {
      patch.scanInfo = source.scanInfo;
      result.fieldsMerged.push('scanInfo');
    }
    if (target.totalAlignersUpper == null && source.totalAlignersUpper != null) {
      patch.totalAlignersUpper = source.totalAlignersUpper;
      result.fieldsMerged.push('totalAlignersUpper');
    }
    if (target.totalAlignersLower == null && source.totalAlignersLower != null) {
      patch.totalAlignersLower = source.totalAlignersLower;
      result.fieldsMerged.push('totalAlignersLower');
    }
    if (!target.hasConsent && source.hasConsent) {
      patch.hasConsent = true;
      result.fieldsMerged.push('hasConsent');
    }
    if (!target.consentPdfPath && source.consentPdfPath) {
      patch.consentPdfPath = source.consentPdfPath;
      result.fieldsMerged.push('consentPdfPath');
    }

    // 3. notes / markdownNote: concat、加分隔行
    if (source.notes?.trim()) {
      const sep = `\n──── (從合併 ${source.chartNo} ${source.name} 過來) ────\n`;
      patch.notes = (target.notes?.trim() ? target.notes + sep : '') + source.notes;
      if (!result.fieldsMerged.includes('notes')) result.fieldsMerged.push('notes');
    }
    if (source.markdownNote?.trim()) {
      const sep = `\n\n──── (從合併 ${source.chartNo} ${source.name} 過來) ────\n\n`;
      patch.markdownNote =
        (target.markdownNote?.trim() ? target.markdownNote + sep : '') + source.markdownNote;
      if (!result.fieldsMerged.includes('markdownNote'))
        result.fieldsMerged.push('markdownNote');
    }

    // 4. allSourceFolders: 把 source 的 sourceFolder 也記入 target.allSourceFolders
    //    v0.4.7 修：之前用 `target.allSourceFolders ?? [target.sourceFolder]` 結構不對
    //    — 如果 target.allSourceFolders 已存在但不含 target.sourceFolder、會遺失 target.sourceFolder。
    //    改用「先收 target 既有的所有 path、再加 source 的」、確保 target.sourceFolder 不會丟。
    const oldFoldersSize = (target.allSourceFolders ?? []).length;
    const mergedSet = new Set<string>(target.allSourceFolders ?? []);
    if (target.sourceFolder) mergedSet.add(target.sourceFolder);
    if (source.sourceFolder) mergedSet.add(source.sourceFolder);
    for (const f of source.allSourceFolders ?? []) mergedSet.add(f);
    if (mergedSet.size > oldFoldersSize) {
      patch.allSourceFolders = [...mergedSet];
      result.fieldsMerged.push('allSourceFolders');
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = nowIso;
      await db.patients.update(targetId, patch);
    }

    // 5. 刪 source patient
    await db.patients.delete(sourceId);
  });

  return result;
}
