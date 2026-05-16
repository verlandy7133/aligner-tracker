// DexieDataLayer — 包現有 Dexie 操作、實作 DataLayer 介面
//
// 用途：
//   - Phase 1：在 DualDataLayer 內當「本機端」、保留離線可用
//   - Phase 2：不再使用（或退化為快取角色）
//   - 開發 / fallback：API 連不到時還能單機跑
//
// 設計：
//   - 100% wrap db.ts 既有 table 操作
//   - onChange 用內部 EventTarget 自己觸發（IndexedDB 沒原生 change event）
//   - isOnline 永遠回 true（本機 Dexie 不依賴網路）

import { db } from '../db';
import type { Patient, Order } from '../types/Patient';
import type { Setting } from '../db';
import type {
  DataLayer,
  ChangeEvent,
  Unsubscribe,
  PatientFilter,
  OrderFilter,
} from './data-layer';

export class DexieDataLayer implements DataLayer {
  private listeners = new Set<(e: ChangeEvent) => void>();

  private emit(e: ChangeEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(e);
      } catch (err) {
        console.error('[DexieDataLayer] listener throw:', err);
      }
    }
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  // ─── Patients ──
  async getPatient(id: string): Promise<Patient | null> {
    return (await db.patients.get(id)) ?? null;
  }

  async listPatients(filter?: PatientFilter): Promise<Patient[]> {
    let coll = db.patients.toCollection();
    if (filter?.since) {
      coll = db.patients.filter((p) => (p.updatedAt || '') > filter.since!);
    }
    let result = await coll.toArray();
    if (filter?.status) result = result.filter((p) => p.status === filter.status);
    if (filter?.productLine) result = result.filter((p) => p.productLine === filter.productLine);
    return result;
  }

  async createPatient(p: Partial<Patient> & Pick<Patient, 'chartNo' | 'name' | 'productLine' | 'status'>): Promise<Patient> {
    const now = this.nowIso();
    const full: Patient = {
      ...(p as Patient),
      id: p.id || crypto.randomUUID(),
      createdAt: p.createdAt || now,
      updatedAt: now,
    };
    await db.patients.put(full);
    this.emit({ entity: 'patient', action: 'created', id: full.id });
    return full;
  }

  async updatePatient(id: string, patch: Partial<Patient>, _version: number): Promise<Patient> {
    // DexieDataLayer 不檢查 version（IndexedDB 沒 server 端鎖）
    // version 參數保留簽名相容、實際由 ApiDataLayer 處理
    const before = await db.patients.get(id);
    if (!before) throw new Error(`patient not found: ${id}`);
    const updated = { ...before, ...patch, id, updatedAt: this.nowIso() };
    await db.patients.put(updated);
    this.emit({ entity: 'patient', action: 'updated', id });
    return updated;
  }

  async putPatient(p: Patient, _version: number): Promise<Patient> {
    const updated = { ...p, updatedAt: this.nowIso() };
    await db.patients.put(updated);
    this.emit({ entity: 'patient', action: 'updated', id: p.id });
    return updated;
  }

  async deletePatient(id: string, _version: number): Promise<void> {
    await db.patients.delete(id);
    this.emit({ entity: 'patient', action: 'deleted', id });
  }

  async bulkPutPatients(patients: Patient[]): Promise<void> {
    await db.patients.bulkPut(patients);
    this.emit({ entity: 'bulk', subEntity: 'patient', count: patients.length });
  }

  // ─── Orders ──
  async getOrder(id: string): Promise<Order | null> {
    return (await db.orders.get(id)) ?? null;
  }

  async listOrders(filter?: OrderFilter): Promise<Order[]> {
    let coll;
    if (filter?.patientId) {
      coll = db.orders.where('patientId').equals(filter.patientId);
    } else {
      coll = db.orders.toCollection();
    }
    let result = await coll.toArray();
    if (filter?.since) result = result.filter((o) => (o.updatedAt || '') > filter.since!);
    return result;
  }

  async createOrder(o: Partial<Order> & Pick<Order, 'patientId' | 'date' | 'progress'>): Promise<Order> {
    const now = this.nowIso();
    const full: Order = {
      ...(o as Order),
      id: o.id || crypto.randomUUID(),
      createdAt: o.createdAt || now,
      updatedAt: now,
    };
    await db.orders.put(full);
    this.emit({ entity: 'order', action: 'created', id: full.id, patientId: full.patientId });
    return full;
  }

  async updateOrder(id: string, patch: Partial<Order>, _version: number): Promise<Order> {
    const before = await db.orders.get(id);
    if (!before) throw new Error(`order not found: ${id}`);
    const updated = { ...before, ...patch, id, updatedAt: this.nowIso() };
    await db.orders.put(updated);
    this.emit({ entity: 'order', action: 'updated', id, patientId: updated.patientId });
    return updated;
  }

  async putOrder(o: Order, _version: number): Promise<Order> {
    const updated = { ...o, updatedAt: this.nowIso() };
    await db.orders.put(updated);
    this.emit({ entity: 'order', action: 'updated', id: o.id, patientId: o.patientId });
    return updated;
  }

  async deleteOrder(id: string, _version: number): Promise<void> {
    const before = await db.orders.get(id);
    await db.orders.delete(id);
    this.emit({ entity: 'order', action: 'deleted', id, patientId: before?.patientId });
  }

  async bulkPutOrders(orders: Order[]): Promise<void> {
    await db.orders.bulkPut(orders);
    this.emit({ entity: 'bulk', subEntity: 'order', count: orders.length });
  }

  // ─── Settings ──
  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const row = await db.settings.get(key);
    return (row?.value as T) ?? null;
  }

  async listSettings(): Promise<Setting[]> {
    return db.settings.toArray();
  }

  async putSetting(key: string, value: unknown): Promise<void> {
    await db.settings.put({ key, value });
    this.emit({ entity: 'setting', action: 'updated', key });
  }

  async deleteSetting(key: string): Promise<void> {
    await db.settings.delete(key);
    this.emit({ entity: 'setting', action: 'deleted', key });
  }

  // ─── 事件 + 連線狀態 ──
  onChange(cb: (e: ChangeEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isOnline(): boolean {
    return true; // 本機 Dexie 永遠線上
  }

  onConnectivityChange(_cb: (online: boolean) => void): Unsubscribe {
    return () => {}; // no-op
  }
}
