export type ProductLine = 'invisalign' | 'riyue' | 'zenyum' | 'retainer';

export const PRODUCT_LINE_LABEL: Record<ProductLine, string> = {
  invisalign: '隱適美',
  riyue: '日月辰心',
  zenyum: '綻雅',
  retainer: '維持器',
};

export type PatientStatus =
  | 'active'
  | 'refinement-1'
  | 'refinement-2'
  | 'refinement-3'
  | 'paused'
  | 'completed'
  | 'transferred-out';

export type PatientFlag =
  | 'needs-payment'
  | 'needs-followup'
  | 'brand-switched-to-invisalign';

export type Patient = {
  id: string;
  chartNo: string;
  name: string;
  birthday: string | null;

  productLine: ProductLine;
  status: PatientStatus;

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
  flags: PatientFlag[];
  notes: string;
  sourceFolder: string;
  allSourceFolders?: string[];

  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_CYCLE_DAYS = 14;

// ─── 下單追蹤 (Order) ───────────────────────────────────────
// 與 Patient 是 N:1（一個病患可能多次下單）。
// 對齊 Excel「下單記錄」結構：每筆下單一列，登記副數區間 + 進度 + 醫師等。
export type ProgressStatus =
  | '尚未開始'
  | '已下單牙套'
  | '診所已收到牙套'
  | '已完成';

export const PROGRESS_OPTIONS: ProgressStatus[] = [
  '尚未開始',
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
  lab: string; // 技工所 美鉑/世宇/隱適美

  createdAt: string;
  updatedAt: string;
};

export const BATCH_TYPE_OPTIONS = ['新', '舊', '新設計', '新設計1', '舊設計', '其他'];
// DOCTOR_OPTIONS 已搬到 src/lib/doctors.ts 變動態，改用 useDoctors() hook
