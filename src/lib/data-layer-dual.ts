// DualDataLayer — Phase 1 雙寫 + 雙讀組合
//
// 策略：
//   讀：
//     - 啟動時 ApiDataLayer.listPatients(since=last_seen) → bulkPut 進 Dexie
//     - 之後讀都從 Dexie（快、本地、UI 順暢）
//     - SSE 收到 server 廣播 → re-fetch 該筆 → 寫進 Dexie → emit change
//
//   寫：
//     - 先寫 Dexie（樂觀更新、UI 立刻 reflect）
//     - 同步呼叫 ApiDataLayer 寫 server
//     - server 成功 → 用 server 回傳值再寫一次 Dexie（version / updated_at 同步）
//     - server 失敗（網路 / 409）→ rollback Dexie（用 before snapshot）+ rethrow
//
// 離線：
//   - 離線（_online=false）時、寫操作直接 throw OfflineError
//   - 讀仍走 Dexie（本機快取可用）

import type { Patient, Order } from '../types/Patient';
import type { Setting } from '../db';
import type {
  DataLayer,
  ChangeEvent,
  Unsubscribe,
  PatientFilter,
  OrderFilter,
} from './data-layer';
import { db } from '../db';
import { ApiError, NetworkError } from './api-client';

export class OfflineError extends Error {
  constructor() {
    super('離線中、無法寫入。請檢查網路 / 連回診所內網後重試。');
    this.name = 'OfflineError';
  }
}

export class DualDataLayer implements DataLayer {
  private listeners = new Set<(e: ChangeEvent) => void>();
  private dexie: DataLayer;
  private remote: DataLayer;

  constructor(dexie: DataLayer, remote: DataLayer) {
    this.dexie = dexie;
    this.remote = remote;
    // bridge：dexie / remote 的 onChange 都轉發出去
    this.dexie.onChange((e) => this.emit(e));
    this.remote.onChange((e) => {
      // SSE 廣播來的 → reconcile 到 Dexie（先 emit、UI 抓得到、實際資料下個 tick 拉回來）
      this.reconcileFromRemote(e);
      this.emit(e);
    });
  }

  private emit(e: ChangeEvent): void {
    for (const cb of this.listeners) {
      try { cb(e); } catch (err) { console.error('[DualDataLayer] listener throw:', err); }
    }
  }

  // SSE 廣播 → fetch server 最新值 → 寫進 Dexie
  private async reconcileFromRemote(e: ChangeEvent): Promise<void> {
    try {
      if (e.entity === 'patient') {
        if (e.action === 'deleted') {
          await db.patients.delete(e.id);
        } else {
          const fresh = await this.remote.getPatient(e.id);
          if (fresh) await db.patients.put(fresh);
        }
      } else if (e.entity === 'order') {
        if (e.action === 'deleted') {
          await db.orders.delete(e.id);
        } else {
          const fresh = await this.remote.getOrder(e.id);
          if (fresh) await db.orders.put(fresh);
        }
      } else if (e.entity === 'setting') {
        if (e.action === 'deleted') {
          await db.settings.delete(e.key);
        } else {
          const v = await this.remote.getSetting(e.key);
          if (v !== null) await db.settings.put({ key: e.key, value: v });
        }
      }
    } catch (err) {
      console.warn('[DualDataLayer] reconcile failed for', e, err);
    }
  }

  // ─── 寫操作 helper：先寫 Dexie、再 server、失敗 rollback ───
  // dexieOp 只負責本機寫（不回傳值）、remoteOp 才是真正回傳結果
  private async dualWrite<T>(
    dexieOp: () => Promise<void>,
    remoteOp: () => Promise<T>,
    rollback: () => Promise<void>,
  ): Promise<T> {
    if (!this.remote.isOnline()) throw new OfflineError();
    await dexieOp();
    try {
      const result = await remoteOp();
      return result;
    } catch (e) {
      try {
        await rollback();
      } catch (rerr) {
        console.error('[DualDataLayer] rollback failed:', rerr);
      }
      throw e;
    }
  }

  // ─── Patients ──
  async getPatient(id: string): Promise<Patient | null> {
    return this.dexie.getPatient(id);
  }

  async listPatients(filter?: PatientFilter): Promise<Patient[]> {
    return this.dexie.listPatients(filter);
  }

  async createPatient(p: Partial<Patient> & Pick<Patient, 'chartNo' | 'name' | 'productLine' | 'status'>): Promise<Patient> {
    if (!this.remote.isOnline()) throw new OfflineError();
    // 先讓 server 生 id + version、再回寫 Dexie
    const created = await this.remote.createPatient(p);
    await db.patients.put(created);
    return created;
  }

  async updatePatient(id: string, patch: Partial<Patient>, version: number): Promise<Patient> {
    const before = await db.patients.get(id);
    return this.dualWrite(
      async () => {
        if (before) await db.patients.put({ ...before, ...patch, updatedAt: new Date().toISOString() });
      },
      async () => {
        const updated = await this.remote.updatePatient(id, patch, version);
        await db.patients.put(updated); // 同步 server 端 _version / updated_at
        return updated;
      },
      async () => {
        if (before) await db.patients.put(before);
      },
    );
  }

  async putPatient(p: Patient, version: number): Promise<Patient> {
    const before = await db.patients.get(p.id);
    return this.dualWrite(
      async () => {
        await db.patients.put({ ...p, updatedAt: new Date().toISOString() });
      },
      async () => {
        const updated = await this.remote.putPatient(p, version);
        await db.patients.put(updated);
        return updated;
      },
      async () => {
        if (before) await db.patients.put(before);
        else await db.patients.delete(p.id);
      },
    );
  }

  async deletePatient(id: string, version: number): Promise<void> {
    const before = await db.patients.get(id);
    if (!this.remote.isOnline()) throw new OfflineError();
    await db.patients.delete(id);
    try {
      await this.remote.deletePatient(id, version);
    } catch (e) {
      if (before) await db.patients.put(before);
      throw e;
    }
  }

  async bulkPutPatients(patients: Patient[]): Promise<void> {
    if (!this.remote.isOnline()) throw new OfflineError();
    await this.remote.bulkPutPatients(patients);
    await db.patients.bulkPut(patients);
  }

  // ─── Orders ──
  async getOrder(id: string): Promise<Order | null> {
    return this.dexie.getOrder(id);
  }

  async listOrders(filter?: OrderFilter): Promise<Order[]> {
    return this.dexie.listOrders(filter);
  }

  async createOrder(o: Partial<Order> & Pick<Order, 'patientId' | 'date' | 'progress'>): Promise<Order> {
    if (!this.remote.isOnline()) throw new OfflineError();
    const created = await this.remote.createOrder(o);
    await db.orders.put(created);
    return created;
  }

  async updateOrder(id: string, patch: Partial<Order>, version: number): Promise<Order> {
    const before = await db.orders.get(id);
    return this.dualWrite(
      async () => {
        if (before) await db.orders.put({ ...before, ...patch, updatedAt: new Date().toISOString() });
      },
      async () => {
        const updated = await this.remote.updateOrder(id, patch, version);
        await db.orders.put(updated);
        return updated;
      },
      async () => {
        if (before) await db.orders.put(before);
      },
    );
  }

  async putOrder(o: Order, version: number): Promise<Order> {
    const before = await db.orders.get(o.id);
    return this.dualWrite(
      async () => {
        await db.orders.put({ ...o, updatedAt: new Date().toISOString() });
      },
      async () => {
        const updated = await this.remote.putOrder(o, version);
        await db.orders.put(updated);
        return updated;
      },
      async () => {
        if (before) await db.orders.put(before);
        else await db.orders.delete(o.id);
      },
    );
  }

  async deleteOrder(id: string, version: number): Promise<void> {
    const before = await db.orders.get(id);
    if (!this.remote.isOnline()) throw new OfflineError();
    await db.orders.delete(id);
    try {
      await this.remote.deleteOrder(id, version);
    } catch (e) {
      if (before) await db.orders.put(before);
      throw e;
    }
  }

  async bulkPutOrders(orders: Order[]): Promise<void> {
    if (!this.remote.isOnline()) throw new OfflineError();
    await this.remote.bulkPutOrders(orders);
    await db.orders.bulkPut(orders);
  }

  // ─── Settings ──
  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return this.dexie.getSetting<T>(key);
  }

  async listSettings(): Promise<Setting[]> {
    return this.dexie.listSettings();
  }

  async putSetting(key: string, value: unknown): Promise<void> {
    if (!this.remote.isOnline()) throw new OfflineError();
    await this.remote.putSetting(key, value);
    await this.dexie.putSetting(key, value);
  }

  async deleteSetting(key: string): Promise<void> {
    if (!this.remote.isOnline()) throw new OfflineError();
    await this.remote.deleteSetting(key);
    await this.dexie.deleteSetting(key);
  }

  // ─── 事件 + 連線狀態 ──
  onChange(cb: (e: ChangeEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isOnline(): boolean {
    return this.remote.isOnline();
  }

  onConnectivityChange(cb: (online: boolean) => void): Unsubscribe {
    return this.remote.onConnectivityChange(cb);
  }

  // ─── 啟動：從 server 拉全量 → 灌進 Dexie ───
  async start(): Promise<void> {
    await this.remote.start?.();
    // 等 SSE 連上（最多 5 秒）— 但即使沒連也繼續、單機模式可用
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5000);
      const unsub = this.remote.onConnectivityChange((online) => {
        if (online) {
          clearTimeout(t);
          unsub();
          resolve();
        }
      });
    });

    if (this.remote.isOnline()) {
      try {
        // 完整 pull patients + orders + settings 進 Dexie
        const [patients, orders, settings] = await Promise.all([
          this.remote.listPatients(),
          this.remote.listOrders(),
          this.remote.listSettings(),
        ]);
        await db.transaction('rw', db.patients, db.orders, db.settings, async () => {
          // Phase 1：bulkPut（不刪 Dexie 既有資料、避免覆蓋手動編輯）
          // Phase 2：改成 sync = 全量替換
          await db.patients.bulkPut(patients);
          await db.orders.bulkPut(orders);
          await db.settings.bulkPut(settings);
        });
        console.log(`[DualDataLayer] initial sync: ${patients.length} patients / ${orders.length} orders / ${settings.length} settings`);
      } catch (e) {
        console.warn('[DualDataLayer] initial sync failed:', e);
      }
    } else {
      console.log('[DualDataLayer] server offline、單機模式起飛');
    }
  }

  async stop(): Promise<void> {
    await this.remote.stop?.();
  }
}

// 給 TypeScript 確保 ApiError 還在 import path（之後 conflict UI 會用）
export { ApiError, NetworkError };
