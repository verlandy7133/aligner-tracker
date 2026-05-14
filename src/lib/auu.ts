// AUU (奧優鎂鉑數位矯正) 後台 URL helpers
//
// 後台 URL 結構（2026-05-15 跟主上一起在後台確認）：
//   /client/main                — 首頁
//   /client/patient/list        — 病患列表（client-side search、URL 不帶 query）
//   /client/patient/detail/<id> — 病患詳細頁、<id> 是純數字 5 位（後台顯示為 A<id>）
//   /client/patient/create      — 新增病患
//   /client/plan/detail/<id>    — 治療計畫詳細
//   /client/doctor/clinic/<id>  — 診所頁
//
// 我們 patient.auuId 存的就是「detail/<id>」內的 <id>（純數字、不含 A 前綴）
// 例：patient.auuId = "26681" → 後台 detail URL = /client/patient/detail/26681

const AUU_BASE = 'https://manage.auu.tw';

/**
 * 組 AUU 後台 URL：
 *   有 auuId → 跳 detail page（user 一鍵到該 patient）
 *   沒 auuId → 跳 list page（user 自己 search）
 */
export function buildAuuUrl(auuId?: string | null): string {
  const id = auuId?.trim();
  if (id) {
    // 容錯：user 可能輸入「A26681」帶 prefix、去掉「A」
    const cleaned = id.replace(/^A/i, '');
    return `${AUU_BASE}/client/patient/detail/${encodeURIComponent(cleaned)}`;
  }
  return `${AUU_BASE}/client/patient/list`;
}

/**
 * 在新分頁開啟 AUU 後台 — 跟現有 helper.open-folder 等 helper-side 操作不同、
 * 純 browser window.open、不需要 helper service。
 */
export function openAuu(auuId?: string | null): void {
  window.open(buildAuuUrl(auuId), '_blank', 'noopener,noreferrer');
}
