// DataLayer — 抽象資料存取介面
//
// 目的：所有 component / page 透過此介面操作資料、不直接呼叫 Dexie / fetch。
// 三個實作（switch 由 entry point 決定）：
//   - DexieDataLayer：純本機 IndexedDB（原行為、離線可用）
//   - ApiDataLayer：純 server API + IndexedDB 當快取（Phase 2 目標）
//   - DualDataLayer：Phase 1 雙寫（本機 + server）
//
// 介面設計原則：
//   - 寫操作回傳完整 Patient 物件（含 server 端 _version）
//   - 讀操作支援 since 增量（給啟動拉取 + reconcile 用）
//   - onChange 事件 stream 給 UI live update
//   - isOnline / onConnectivityChange 給 OnlineStatus 元件用

import type { Patient, Order, Visit } from '../types/Patient';
import type { Setting } from '../db';

// ─── 事件 ────────────────────────────────────────────
export type ChangeEvent =
  | { entity: 'patient'; action: 'created' | 'updated' | 'deleted'; id: string; version?: number }
  | { entity: 'order'; action: 'created' | 'updated' | 'deleted'; id: string; patientId?: string; version?: number }
  | { entity: 'visit'; action: 'created' | 'updated' | 'deleted'; id: string; patientId?: string; version?: number }
  | { entity: 'setting'; action: 'updated' | 'deleted'; key: string }
  | { entity: 'bulk'; subEntity: 'patient' | 'order'; count: number };

export type Unsubscribe = () => void;

// ─── Filter 型別 ─────────────────────────────────────
export type PatientFilter = {
  since?: string; // ISO timestamp
  status?: string;
  productLine?: string;
};

export type OrderFilter = {
  since?: string;
  patientId?: string;
};

export type VisitFilter = {
  since?: string;
  patientId?: string;
  date?: string; // YYYY-MM-DD 精確過濾
  limit?: number;
};

// ─── 主介面 ──────────────────────────────────────────
export interface DataLayer {
  // ─── Patients ──
  getPatient(id: string): Promise<Patient | null>;
  listPatients(filter?: PatientFilter): Promise<Patient[]>;
  // createPatient 接 Partial<Patient>：caller 可帶 id（要求用該 id）也可不帶（server 生）
  createPatient(p: Partial<Patient> & Pick<Patient, 'chartNo' | 'name' | 'productLine' | 'status'>): Promise<Patient>;
  updatePatient(id: string, patch: Partial<Patient>, version: number): Promise<Patient>;
  putPatient(p: Patient, version: number): Promise<Patient>;
  deletePatient(id: string, version: number): Promise<void>;
  bulkPutPatients(patients: Patient[]): Promise<void>;

  // ─── Orders ──
  getOrder(id: string): Promise<Order | null>;
  listOrders(filter?: OrderFilter): Promise<Order[]>;
  createOrder(o: Partial<Order> & Pick<Order, 'patientId' | 'date' | 'progress'>): Promise<Order>;
  updateOrder(id: string, patch: Partial<Order>, version: number): Promise<Order>;
  putOrder(o: Order, version: number): Promise<Order>;
  deleteOrder(id: string, version: number): Promise<void>;
  bulkPutOrders(orders: Order[]): Promise<void>;

  // ─── Visits (v0.7.0 回診登記)──
  listVisits(filter?: VisitFilter): Promise<Visit[]>;
  createVisit(v: Partial<Visit> & Pick<Visit, 'patientId' | 'date' | 'visitType'>): Promise<Visit>;
  updateVisit(id: string, patch: Partial<Visit>, version: number): Promise<Visit>;
  deleteVisit(id: string, version: number): Promise<void>;

  // ─── Settings ──
  getSetting<T = unknown>(key: string): Promise<T | null>;
  listSettings(): Promise<Setting[]>;
  putSetting(key: string, value: unknown): Promise<void>;
  deleteSetting(key: string): Promise<void>;

  // ─── 事件 + 連線狀態 ──
  onChange(cb: (e: ChangeEvent) => void): Unsubscribe;
  isOnline(): boolean;
  onConnectivityChange(cb: (online: boolean) => void): Unsubscribe;

  // ─── 生命週期 ──
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

// ─── Singleton 容器 ──────────────────────────────────
// 進入點（main.tsx）會根據環境決定要用哪個實作、塞進來
let _instance: DataLayer | null = null;

export function setDataLayer(impl: DataLayer): void {
  _instance = impl;
}

export function getDataLayer(): DataLayer {
  if (!_instance) {
    throw new Error('DataLayer not initialized — call setDataLayer() in main.tsx first');
  }
  return _instance;
}

// 給 hook 用、UI 不該直接 import db.ts
export const dataLayer = new Proxy({} as DataLayer, {
  get(_target, prop) {
    return (getDataLayer() as any)[prop];
  },
});
