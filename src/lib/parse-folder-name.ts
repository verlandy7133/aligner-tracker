// 解析病患資料夾名 → { name, birthday }
//
// 格式樣本（來自 scan-aligner-folders.mjs 邏輯，跟 build-flat-patient-folder 後的扁平結構一致）：
//   821102嚴家彬                              → name=嚴家彬, bday=1993-11-02
//   1041207池佳                                → name=池佳, bday=2015-12-07
//   591110何尹偉0126取資料精調 無授權書         → name=何尹偉, bday=1970-11-10
//   [結束] 851102 林小華                       → name=林小華, bday=1996-11-02 (剝掉前綴)
//   [維持器] 730225林欣潔 已下單下顎暫維         → name=林欣潔, bday=1984-02-25
//   [隱適美] 1021208谷婕寧 轉隱適美 0314下單     → name=谷婕寧, bday=2013-12-08
//
// 民國年支援 6 位（YYMMDD）跟 7 位（YYYMMDD），補上 1911 為西元年

const STATUS_PREFIXES = ['[結束]', '[中斷]', '[隱適美]', '[綻雅]', '[維持器]', '[待確認]'];

export type FolderParsed = {
  name: string;
  birthday: string | null; // YYYY-MM-DD，無法解析時 null
  raw: string;
};

function rocBirthdayToISO(rocStr: string): string | null {
  if (!/^\d{6,7}$/.test(rocStr)) return null;
  let year: number, month: number, day: number;
  if (rocStr.length === 6) {
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

export function parseFolderName(folderName: string): FolderParsed {
  const raw = folderName;
  let inner = folderName.trim();

  // 1. 剝前綴 [結束] / [中斷] 等
  for (const prefix of STATUS_PREFIXES) {
    if (inner.startsWith(prefix + ' ')) {
      inner = inner.slice(prefix.length + 1);
      break;
    } else if (inner.startsWith(prefix)) {
      inner = inner.slice(prefix.length).trim();
      break;
    }
  }

  // 2. parsePatientFolderName 4 種格式
  //   A: 730602王小明        → 數字在前
  //   B: 881018 王小英       → 數字 + 空白 + 姓名
  //   C: 王小明810413        → 姓名在前
  //   D: 王明1041207         → 2 字姓名 + 7 位數
  //   E: 1021208王小華 轉隱適美 → 數字 + 姓名 + 備註

  let rocBirth: string | null = null;
  let name: string | null = null;

  // 開頭數字優先
  let m =
    inner.match(/^(\d{7})\s*(.+)$/) ||
    inner.match(/^(\d{6})\s*(.+)$/);
  if (m) {
    rocBirth = m[1];
    const rest = m[2].trim();
    const nameMatch = rest.match(/^([一-龥]+)/);
    if (nameMatch) {
      name = nameMatch[1].length > 4 ? nameMatch[1].slice(0, 4) : nameMatch[1];
    }
  } else {
    // 姓名在前
    m =
      inner.match(/^([一-龥]+)(\d{7})/) ||
      inner.match(/^([一-龥]+)(\d{6})/);
    if (m) {
      name = m[1].length > 4 ? m[1].slice(0, 4) : m[1];
      rocBirth = m[2];
    }
  }

  return {
    name: name ?? '',
    birthday: rocBirth ? rocBirthdayToISO(rocBirth) : null,
    raw,
  };
}
