// 警示規則 + 閾值設定
//
// 4 種警示：
//   A. vendor-delay   — batch.date 過 X 天但仍「已下單牙套」 (廠商遲交)
//   B. pickup-delay   — batch.actualDate 過 X 天但仍「診所已收到牙套」 (病患沒來領)
//   C. no-order       — patient 是 active/refinement-N 但 0 筆 order (整個漏單)
//   D. pending-too-long — batch.date 過 X 天但仍「尚未開始」 (建檔了沒下單)
//
// 閾值存在 settings table，可以改。

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Order, Patient } from '../types/Patient';

export type AlertThresholds = {
  vendorDelayDays: number; // A
  pickupDelayDays: number; // B
  pendingOrderDays: number; // D
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  vendorDelayDays: 28, // 4 週
  pickupDelayDays: 14,
  pendingOrderDays: 14,
};

const SETTINGS_KEY = 'alert-thresholds';

export async function loadThresholds(): Promise<AlertThresholds> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return DEFAULT_THRESHOLDS;
  return { ...DEFAULT_THRESHOLDS, ...(row.value as Partial<AlertThresholds>) };
}

export async function saveThresholds(t: AlertThresholds): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: t });
}

export function useThresholds(): AlertThresholds {
  const v = useLiveQuery(async () => loadThresholds(), [], DEFAULT_THRESHOLDS);
  return v ?? DEFAULT_THRESHOLDS;
}

export type OrderAlertType = 'vendor-delay' | 'pickup-delay' | 'pending-too-long';

export type OrderAlert = {
  type: OrderAlertType;
  daysOverdue: number;
  message: string;
};

export type PatientAlert = {
  type: 'no-order';
  message: string;
};

const PATIENT_ACTIVE_STATUSES = new Set(['active']);

function daysBetween(a: string, b: string): number {
  const ad = new Date(a).getTime();
  const bd = new Date(b).getTime();
  return Math.floor((bd - ad) / (1000 * 60 * 60 * 24));
}

export function deriveOrderAlerts(
  order: Order,
  todayISO: string,
  thresholds: AlertThresholds,
): OrderAlert[] {
  const alerts: OrderAlert[] = [];
  if (!order.date) return alerts;

  // A — 廠商遲交
  if (order.progress === '已下單牙套') {
    const days = daysBetween(order.date, todayISO);
    if (days > thresholds.vendorDelayDays) {
      alerts.push({
        type: 'vendor-delay',
        daysOverdue: days - thresholds.vendorDelayDays,
        message: `廠商遲交：下單已 ${days} 天 (超過 ${thresholds.vendorDelayDays} 天閾值)`,
      });
    }
  }

  // B — 病患沒來領
  if (order.progress === '診所已收到牙套' && order.actualDate) {
    const days = daysBetween(order.actualDate, todayISO);
    if (days > thresholds.pickupDelayDays) {
      alerts.push({
        type: 'pickup-delay',
        daysOverdue: days - thresholds.pickupDelayDays,
        message: `病患未領：收件已 ${days} 天 (超過 ${thresholds.pickupDelayDays} 天閾值)`,
      });
    }
  }

  // D — 尚未開始太久
  if (order.progress === '尚未開始') {
    const days = daysBetween(order.date, todayISO);
    if (days > thresholds.pendingOrderDays) {
      alerts.push({
        type: 'pending-too-long',
        daysOverdue: days - thresholds.pendingOrderDays,
        message: `待下單：建檔已 ${days} 天 (超過 ${thresholds.pendingOrderDays} 天閾值)`,
      });
    }
  }

  return alerts;
}

export function derivePatientAlert(
  patient: Patient,
  ordersForPatient: Order[],
): PatientAlert | null {
  if (!PATIENT_ACTIVE_STATUSES.has(patient.status)) return null;
  if (ordersForPatient.length > 0) return null;
  return {
    type: 'no-order',
    message: '病患在治療階段但 0 筆下單紀錄 (可能漏單)',
  };
}

// UI 用的 badge 配色
export const ORDER_ALERT_BADGE: Record<OrderAlertType, string> = {
  'vendor-delay': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  'pickup-delay': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'pending-too-long': 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};

export const ORDER_ALERT_LABEL: Record<OrderAlertType, string> = {
  'vendor-delay': '廠商遲交',
  'pickup-delay': '病患未領',
  'pending-too-long': '待下單逾時',
};
