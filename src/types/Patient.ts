export type ProductLine = 'invisalign' | 'riyue' | 'zenyum' | 'retainer';

export const PRODUCT_LINE_LABEL: Record<ProductLine, string> = {
  invisalign: '隱適美',
  riyue: '日月辰心',
  zenyum: '綻雅',
  retainer: '維持器',
};

// 臨床狀態：4 個值（精調級別已拆出去成 refinementLevel）
export type PatientStatus = 'active' | 'paused' | 'completed' | 'transferred-out';

// 流派（供應商倒閉事件後分類）：第一筆 order 的 batchType 決定
//   新設計  ← 第一筆 = 新設計 / 新設計1（比對失敗、重做療程）
//   舊設計  ← 第一筆 = 舊設計 / 舊（比對成功、繼續用舊資料）
//   null   ← 第一筆 = 新 / (空) 或無 order（看不出來、不分類）
export type PatientTrack = 'new-design' | 'old-design' | null;

export type PatientFlag =
  | 'needs-payment'
  | 'needs-followup'
  | 'brand-switched-to-invisalign';

// 病歷照片 14-slot：人像 (6) + X-ray (2) + 口外 (2) + 口內 (4)
// 人像 3 個角度 × 2 表情（休息/微笑）= 整齊 3x2 grid
export type PhotoSlot =
  // 人像（face / portrait）
  | 'portraitFrontalRest' // 正面（休息）
  | 'portraitFrontalSmile' // 正面（微笑）
  | 'portraitOblique45Rest' // 45° 斜位（休息）
  | 'portraitOblique45Smile' // 45° 斜位（微笑）
  | 'portraitProfileRest' // 90° 側面（休息）
  | 'portraitProfileSmile' // 90° 側面（微笑）
  // X-ray
  | 'pano'
  | 'ceph'
  // 口外（extra-oral）
  | 'frontClosed'
  | 'frontOpen'
  // 口內（intra-oral）
  | 'leftClosed'
  | 'rightClosed'
  | 'upperOcclusal'
  | 'lowerOcclusal';

export type PhotoSlotGroup = 'portrait' | 'xray' | 'extraoral' | 'intraoral';

export const PHOTO_SLOTS: { key: PhotoSlot; label: string; group: PhotoSlotGroup }[] = [
  { key: 'portraitFrontalRest', label: '正面（休息）', group: 'portrait' },
  { key: 'portraitFrontalSmile', label: '正面（微笑）', group: 'portrait' },
  { key: 'portraitOblique45Rest', label: '45° 斜位（休息）', group: 'portrait' },
  { key: 'portraitOblique45Smile', label: '45° 斜位（微笑）', group: 'portrait' },
  { key: 'portraitProfileRest', label: '90° 側面（休息）', group: 'portrait' },
  { key: 'portraitProfileSmile', label: '90° 側面（微笑）', group: 'portrait' },
  { key: 'pano', label: 'Panoramic (Pano)', group: 'xray' },
  { key: 'ceph', label: 'Cephalometric (Ceph)', group: 'xray' },
  { key: 'frontClosed', label: 'Front (Closed)', group: 'extraoral' },
  { key: 'frontOpen', label: 'Front (Open)', group: 'extraoral' },
  { key: 'leftClosed', label: 'Left (Closed)', group: 'intraoral' },
  { key: 'rightClosed', label: 'Right (Closed)', group: 'intraoral' },
  { key: 'upperOcclusal', label: 'Upper Occlusal', group: 'intraoral' },
  { key: 'lowerOcclusal', label: 'Lower Occlusal', group: 'intraoral' },
];

export const PHOTO_GROUP_LABEL: Record<PhotoSlotGroup, string> = {
  portrait: '人像',
  xray: 'X-ray',
  extraoral: '口外',
  intraoral: '口內',
};

// 每張照片的編輯 metadata（旋轉、翻轉、縮放、亮度等純前端 transform、不動原檔）
export type PhotoMeta = {
  filename: string;
  rotate?: 0 | 90 | 180 | 270; // 順時針度數
  flipH?: boolean; // 水平翻轉
  flipV?: boolean; // 垂直翻轉
  displayScale?: number; // 0.5 ~ 2.0，預設 1.0 — 該 cell 內部 img 的視覺縮放（等比 X+Y）
  imageStretchX?: number; // 0.5 ~ 2.5，預設 1.0 — img 水平拉寬倍數（X 軸非等比 scale）
  imageStretchY?: number; // 0.5 ~ 2.5，預設 1.0 — img 垂直拉高倍數（Y 軸非等比 scale）
  brightness?: number; // 0.5 ~ 1.5，預設 1.0 — CSS filter brightness（1.0 = 原圖）
  // 裁切（裁掉的部分不顯示、剩下的撐滿 cell）— 0 ~ 0.45、各邊獨立
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
  /** @deprecated v0.3.10 加、v0.3.11 拋棄，改用 imageStretchX。保留欄位避免舊資料炸 */
  aspectRatio?: number;
};

// cell 固定 4:3 預設、不再讓 user 直接改 cell 比例（user 反饋是要拉「照片」不是「框」）
export const DEFAULT_ASPECT_RATIO = 4 / 3;

export type Patient = {
  id: string;
  chartNo: string;
  name: string;
  birthday: string | null;

  productLine: ProductLine;
  status: PatientStatus;
  track: PatientTrack; // 新設計 / 舊設計 / 不分類
  refinementLevel: 0 | 1 | 2 | 3; // 第二筆+ 又出現「新設計」batchType 的次數，cap 3

  orderDate: string | null;
  startDate: string | null;

  totalAlignersUpper: number | null;
  currentAlignerUpper: number | null;
  totalAlignersLower: number | null;
  currentAlignerLower: number | null;
  cycleDays: number;

  lastVisit: string | null;
  nextVisit: string | null;

  hasConsent: boolean;
  consentPdfPath: string | null;
  scanInfo: string | null; // 口掃資訊 例 "1/28 5000" 或 "1/28 5000(2/4付)"
  doctor: string | null; // 主治醫師 例 "陳執中" / "林英辰" / "張綺真"

  // v0.5.1: 奧優 AUU 後台病患編號（純數字、約 5 位、例 26681 對應後台 A26681）
  // 有填 → PatientDetailPage 「🌐 奧優」button 直跳 detail page
  // 沒填 → button fallback 跳 list page、user 自己搜
  auuId?: string;
  flags: PatientFlag[];
  notes: string;
  sourceFolder: string;
  allSourceFolders?: string[];

  // ─── 病患筆記 + 病歷照片（v0.1.9 新增 / v0.1.10 升級）──
  markdownNote: string; // 自由格式筆記、之後可接 markdown render
  // v0.1.9: photos: Partial<Record<PhotoSlot, string>>（單純檔名）
  // v0.1.10: 改成 PhotoMeta object 支援 rotate/flip 編輯；Dexie v7 upgrade 自動轉換
  photos: Partial<Record<PhotoSlot, PhotoMeta>>;

  createdAt: string;
  updatedAt: string;

  // v0.6.0: server 端樂觀鎖版本號（從 NAS API 拉回時 server 塞、本機端讀但不改）
  // 寫操作（PUT/PATCH/DELETE）必須回傳這個值給 server 驗證
  _version?: number;
  _createdBy?: string;
  _updatedBy?: string;
};

export const DEFAULT_CYCLE_DAYS = 14;

// ─── 下單追蹤 (Order) ───────────────────────────────────────
// 與 Patient 是 N:1（一個病患可能多次下單）。
// 對齊 Excel「下單記錄」結構：每筆下單一列，登記副數區間 + 進度 + 醫師等。
export type ProgressStatus =
  | '尚未開始'
  | '設計中'
  | '已下單牙套'
  | '診所已收到牙套'
  | '已完成';

export const PROGRESS_OPTIONS: ProgressStatus[] = [
  '尚未開始',
  '設計中',
  '已下單牙套',
  '診所已收到牙套',
  '已完成',
];

export type Order = {
  id: string;
  patientId: string;
  patientChartNo: string; // denormalized 方便顯示與排序
  patientName: string; // denormalized

  date: string; // YYYY-MM-DD 該批下單日 (來自 Excel 第一欄)
  doctor: string; // 該批負責醫師
  batchType: string; // 新 / 舊 / 新設計 / 新設計1 / 舊設計 / 其他
  alignerRange: string; // 例 "UL12-13"
  progress: ProgressStatus;

  expectedDate: string | null; // 預計收件日 (押看診前一週)
  actualDate: string | null; // 實際收件日
  nextStep: string;
  notes: string;
  lab: string; // 技工所 鎂鉑/世宇/隱適美

  createdAt: string;
  updatedAt: string;

  // v0.6.0 樂觀鎖版本（同 Patient._version）
  _version?: number;
  _createdBy?: string;
  _updatedBy?: string;
};

export const BATCH_TYPE_OPTIONS = ['新', '舊', '新設計', '新設計1', '舊設計', '其他'];
// DOCTOR_OPTIONS 已搬到 src/lib/doctors.ts 變動態，改用 useDoctors() hook
