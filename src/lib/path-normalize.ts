// 跨機 sync 用的 path normalize / denormalize
//
// 場景：
//   master 機 A 的 dataRoot = W:\0矯正追蹤
//   master 機 B 的 dataRoot = D:\診所nas 0矯正追蹤
//   sync.json 在 NAS 上、兩台都會 push / pull
//
// 沒 normalize：A 推的 path 是 W:\..\、B pull 後 IndexedDB 內 W:\.. 找不到實體
// 有 normalize：A push 時 strip dataRoot → 病患資料夾\xxx；B pull 時 prepend D:\診所nas... → D:\診所nas 0矯正追蹤\病患資料夾\xxx ✓
//
// 規則：
//   - sync.json 內 sourceFolder / consentPdfPath 永遠是 relative path
//   - 本機 IndexedDB 內 sourceFolder / consentPdfPath 仍是 absolute path（跟本機 dataRoot 對齊）
//   - 只在 push (export) 跟 pull (import) 時 transform

import type { Patient } from '../types/Patient';

// 把 absolute 改成 relative（strip dataRoot prefix）
// 若已是 relative（沒 X:\ 開頭）或不 match dataRoot、原值返回
export function normalizePath(absolute: string | null, dataRoot: string): string | null {
  if (!absolute) return absolute;
  if (!dataRoot) return absolute;
  const cleanRoot = dataRoot.replace(/\\+$/, '');
  // case-insensitive 比對 prefix
  const lowerAbs = absolute.toLowerCase();
  const lowerRoot = cleanRoot.toLowerCase();
  if (lowerAbs.startsWith(lowerRoot + '\\')) {
    return absolute.slice(cleanRoot.length + 1); // +1 for trailing \
  }
  // 不 match dataRoot prefix → 可能是 absolute 但跟 dataRoot 不一致（舊資料）、留原值
  return absolute;
}

// 把 relative 改成 absolute（prepend 本機 dataRoot）
// 若已是 absolute（X:\ 或 \\ 開頭）、原值返回
export function denormalizePath(relative: string | null, dataRoot: string): string | null {
  if (!relative) return relative;
  if (!dataRoot) return relative;
  // 已是 absolute（X:\ 開頭、UNC \\、或 / 開頭 Unix-style）→ 原值
  if (/^([A-Z]:\\|\\\\|\/)/i.test(relative)) return relative;
  const cleanRoot = dataRoot.replace(/\\+$/, '');
  return `${cleanRoot}\\${relative}`;
}

// 把 patient 內所有路徑欄位 normalize（push 前用）
export function normalizePatient(p: Patient, dataRoot: string): Patient {
  return {
    ...p,
    sourceFolder: normalizePath(p.sourceFolder || '', dataRoot) ?? '',
    consentPdfPath: normalizePath(p.consentPdfPath, dataRoot),
  };
}

// 把 patient 內所有路徑欄位 denormalize（pull 後用）
export function denormalizePatient(p: Patient, dataRoot: string): Patient {
  return {
    ...p,
    sourceFolder: denormalizePath(p.sourceFolder || '', dataRoot) ?? '',
    consentPdfPath: denormalizePath(p.consentPdfPath, dataRoot),
  };
}
