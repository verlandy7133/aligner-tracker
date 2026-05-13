// 治療前後對比 HTML 接口（v0.4.13 預留）
//
// HTML 由獨立 session「矯正對照」的 `100_Todo/drafts/gen_classified_top13.py`
// 產生、放在 `<BEFORE_AFTER_ROOT>\<民國生日><姓名>\_前後對比.html`。
// 例：`D:\矯正\before-after-照片整理\770131蕭凱星\_前後對比.html`
//
// 此檔只負責「組路徑 + 透過 helper open-file」接口層。
// 整合完成前該 HTML 可能不存在、helper 會回 error、UI 顯示提示告知主上去跑 python script。
//
// 未來可擴充：
// - BEFORE_AFTER_ROOT 改 settings 可配（目前 hard-coded）
// - 偵測檔存在性、按鈕只在有 HTML 時 enable
// - 整合 NAS 路徑（目前指 D:\、之後可能搬到 NAS 共享）

import { callHelper } from './helper-client';
import type { Patient } from '../types/Patient';

// TODO v0.5: 改成從 helper paths config 讀（讓 user 可在設定頁改）
const BEFORE_AFTER_ROOT = 'D:\\矯正\\before-after-照片整理';

/**
 * 把 YYYY-MM-DD 轉成民國 YYMMDD（用於組資料夾名）
 * 2002-01-19 → "910119" (民國 91 年)
 * 1988-10-29 → "771029" (民國 77 年)
 * 民國年 ≥ 100 也 OK：用 String() 不 padStart 多餘
 */
function toRocBirth(birthday: string): string | null {
  const m = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const rocYear = parseInt(y, 10) - 1911;
  if (rocYear < 1 || rocYear > 200) return null;
  return String(rocYear).padStart(2, '0') + mo + d;
}

/**
 * 組對比 HTML 完整路徑。缺資料 → null。
 */
export function buildBeforeAfterPath(patient: Patient): string | null {
  if (!patient.birthday || !patient.name?.trim()) return null;
  const rocBirth = toRocBirth(patient.birthday);
  if (!rocBirth) return null;
  const folder = rocBirth + patient.name.trim();
  return `${BEFORE_AFTER_ROOT}\\${folder}\\_前後對比.html`;
}

export type OpenBeforeAfterResult =
  | { state: 'opened' }
  | { state: 'no-data'; message: string }
  | { state: 'not-generated'; expectedPath: string }
  | { state: 'helper-down' }
  | { state: 'error'; message: string };

/**
 * 試圖開啟病人的治療前後對比 HTML。
 * 不存在 / helper 抓不到時、給足夠資訊讓 UI 跳提示。
 */
export async function openBeforeAfter(patient: Patient): Promise<OpenBeforeAfterResult> {
  const path = buildBeforeAfterPath(patient);
  if (!path) {
    return { state: 'no-data', message: '缺生日或姓名、無法組路徑' };
  }
  const r = await callHelper('open-file', path);
  if (r.state === 'opened') return { state: 'opened' };
  if (r.state === 'helper-down') return { state: 'helper-down' };
  // helper 回 error → 多半是檔案不存在（gen_classified_top13.py 還沒跑過此人）
  return { state: 'not-generated', expectedPath: path };
}
