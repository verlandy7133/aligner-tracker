// Permission 常量 + role template
//
// 設計：
//   - permission 是字串、namespace.action 格式（patient.create / order.view / ...）
//   - user.permissions 是 string[]、儲存 effective permissions
//   - user.role 只是顯示用標籤、不影響權限檢查
//   - admin 編輯帳號時可「套 template」一鍵 fill、或個別勾選 override

export const PERMISSIONS = Object.freeze({
  // 病患
  PATIENT_VIEW: 'patient.view',
  PATIENT_CREATE: 'patient.create',
  PATIENT_EDIT: 'patient.edit',
  PATIENT_DELETE: 'patient.delete',
  PATIENT_NOTES: 'patient.notes',
  PATIENT_PHOTOS: 'patient.photos',
  PATIENT_CONSENT: 'patient.consent',

  // 下單
  ORDER_VIEW: 'order.view',
  ORDER_CREATE: 'order.create',
  ORDER_EDIT: 'order.edit',
  ORDER_DELETE: 'order.delete',

  // 設定
  SETTINGS_PREFERENCES: 'settings.preferences', // theme / 字級 / alert 閾值
  SETTINGS_DOCTORS: 'settings.doctors',
  SETTINGS_LABS: 'settings.labs',
  SETTINGS_DATA: 'settings.data', // 匯入 / 合併 / 健檢 / restore
  SETTINGS_USERS: 'settings.users', // 管帳號（最高權限）
  SETTINGS_AUDIT: 'settings.audit', // 看 audit_log
});

// 全部 permission 清單（給 admin UI 列勾選框用）
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// permission 分組（給 admin UI 分區顯示）
export const PERMISSION_GROUPS = {
  patient: [
    'patient.view', 'patient.create', 'patient.edit', 'patient.delete',
    'patient.notes', 'patient.photos', 'patient.consent',
  ],
  order: [
    'order.view', 'order.create', 'order.edit', 'order.delete',
  ],
  settings: [
    'settings.preferences', 'settings.doctors', 'settings.labs',
    'settings.data', 'settings.users', 'settings.audit',
  ],
};

export const PERMISSION_LABEL = {
  'patient.view': '看病患詳細頁',
  'patient.create': '新增病患',
  'patient.edit': '改基本資料',
  'patient.delete': '刪病患',
  'patient.notes': '改筆記 / 病歷',
  'patient.photos': '管照片 slot',
  'patient.consent': '管授權書 PDF',
  'order.view': '看下單記錄',
  'order.create': '新增下單',
  'order.edit': '改下單記錄',
  'order.delete': '刪下單',
  'settings.preferences': '改 UI 偏好（theme / 字級 / alert）',
  'settings.doctors': '管醫師清單',
  'settings.labs': '管技工所清單',
  'settings.data': '匯入 Excel / 合併 / 健檢 / restore',
  'settings.users': '管帳號（最高權限）',
  'settings.audit': '看 audit_log 歷史',
};

// Role template — admin 建用戶時的「快速套」
export const ROLE_TEMPLATES = {
  admin: ALL_PERMISSIONS, // 全部

  doctor: [
    'patient.view', 'patient.create', 'patient.edit', 'patient.delete',
    'patient.notes', 'patient.photos', 'patient.consent',
    'order.view', 'order.create', 'order.edit', 'order.delete',
    'settings.preferences',
  ],

  // 主上特別要的角色 — 只能下單、看病患找對人即可
  'order-clerk': [
    'patient.view',
    'order.view', 'order.create', 'order.edit',
  ],

  assistant: [
    'patient.view', 'patient.create', 'patient.edit', 'patient.delete',
    'patient.notes', 'patient.photos', 'patient.consent',
    'order.view', 'order.create', 'order.edit', 'order.delete',
    'settings.preferences', 'settings.doctors', 'settings.labs',
  ],

  viewer: [
    'patient.view',
    'order.view',
  ],

  custom: [], // 自訂、不套 template、admin 一個一個勾
};

export const ROLE_LABEL = {
  admin: '管理員',
  doctor: '醫師',
  'order-clerk': '下單助理',
  assistant: '助理',
  viewer: '唯讀',
  custom: '自訂',
};

// helper: 給一個 permission 字串、回 effective permissions 是否包含
export function hasPermission(userPermissions, required) {
  if (!Array.isArray(userPermissions)) return false;
  return userPermissions.includes(required);
}

// helper: 判斷一個 permissions array 是否完全 match 某個 role template
// （用來在 admin UI 上自動 detect「現在是 doctor 還是 custom」）
export function detectRole(userPermissions) {
  if (!Array.isArray(userPermissions)) return 'custom';
  const sorted = [...userPermissions].sort();
  for (const [role, template] of Object.entries(ROLE_TEMPLATES)) {
    if (role === 'custom') continue;
    const t = [...template].sort();
    if (t.length === sorted.length && t.every((p, i) => p === sorted[i])) {
      return role;
    }
  }
  return 'custom';
}
