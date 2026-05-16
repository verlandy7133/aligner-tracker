// ApiDataLayer — 透過 NAS API server 操作資料、SSE 即時收變更
//
// 用途：
//   - Phase 1：在 DualDataLayer 內當「遠端端」（成功 server 寫入 + SSE 廣播）
//   - Phase 2：唯一資料層（IndexedDB 只當快取）
//
// 設計：
//   - 寫操作：fetch → server SQLite UPDATE → 接 SSE 廣播給其他 client
//   - 讀操作：fetch → server → 直接回（Phase 2 會加 IndexedDB 快取）
//   - 樂觀鎖：所有 PUT/PATCH/DELETE 必須帶 version、衝突回 409 → 拋 VersionConflictError
//   - SSE：透過 EventSource 連 /events、收到變更後 emit ChangeEvent
//
// 不負責：本機 Dexie 寫入（那是 DexieDataLayer / DualDataLayer 的事）

import type { Patient, Order } from '../types/Patient';
import type { Setting } from '../db';
import type {
  DataLayer,
  ChangeEvent,
  Unsubscribe,
  PatientFilter,
  OrderFilter,
} from './data-layer';
import { api, apiGet, apiBase, NetworkError } from './api-client';

type ServerResponse<T> = { data: T; meta?: Record<string, unknown> };

// server 回 patient/order 物件 — 含 _version / _createdBy / _updatedBy
// client 端視角直接用 _version 取版本號
function unwrapPatient(p: any): Patient {
  return p as Patient;
}
function unwrapOrder(o: any): Order {
  return o as Order;
}

export class ApiDataLayer implements DataLayer {
  private listeners = new Set<(e: ChangeEvent) => void>();
  private connListeners = new Set<(online: boolean) => void>();
  private es: EventSource | null = null;
  private esReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private esReconnectDelayMs = 1000; // exponential backoff start
  private lastEventId: string | null = null;
  private _online = false; // 初始 false、SSE 連上後變 true

  private emit(e: ChangeEvent): void {
    for (const cb of this.listeners) {
      try { cb(e); } catch (err) { console.error('[ApiDataLayer] listener throw:', err); }
    }
  }

  private setOnline(v: boolean): void {
    if (this._online === v) return;
    this._online = v;
    for (const cb of this.connListeners) {
      try { cb(v); } catch (err) { console.error('[ApiDataLayer] conn listener throw:', err); }
    }
  }

  // ─── 生命週期 ──
  async start(): Promise<void> {
    this.connectSse();
  }

  async stop(): Promise<void> {
    if (this.esReconnectTimer) {
      clearTimeout(this.esReconnectTimer);
      this.esReconnectTimer = null;
    }
    this.es?.close();
    this.es = null;
    this.setOnline(false);
  }

  // ─── SSE 管理 ──
  private connectSse(): void {
    if (this.es) return;
    const url = `${apiBase}/events`;
    // EventSource 不支援自訂 headers — Last-Event-ID 是內建欄位、瀏覽器自動帶
    // X-Client-Id 沒法透過 EventSource 帶、用 query string 替代
    // (server 也接受 query)
    // 注意 Phase 1：先用 plain url、server 端 broadcast 不 exclude 自己無所謂（會收到自己廣播）
    this.es = new EventSource(url, { withCredentials: false });

    this.es.onopen = () => {
      console.log('[sse] connected');
      this.setOnline(true);
      this.esReconnectDelayMs = 1000; // reset backoff
    };

    this.es.onerror = (ev) => {
      console.warn('[sse] error:', ev);
      this.setOnline(false);
      this.es?.close();
      this.es = null;
      // backoff reconnect
      this.esReconnectTimer = setTimeout(() => {
        this.esReconnectDelayMs = Math.min(this.esReconnectDelayMs * 2, 30_000);
        this.connectSse();
      }, this.esReconnectDelayMs);
    };

    // 各種 entity 事件
    const handle = (ev: MessageEvent, fn: (data: any) => ChangeEvent | null) => {
      this.lastEventId = (ev as any).lastEventId || this.lastEventId;
      try {
        const data = JSON.parse(ev.data);
        const change = fn(data);
        if (change) this.emit(change);
      } catch (e) {
        console.error('[sse] parse failed:', e, ev.data);
      }
    };

    this.es.addEventListener('patient.created', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'patient', action: 'created', id: d.id, version: d.version })),
    );
    this.es.addEventListener('patient.updated', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'patient', action: 'updated', id: d.id, version: d.version })),
    );
    this.es.addEventListener('patient.deleted', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'patient', action: 'deleted', id: d.id })),
    );
    this.es.addEventListener('order.created', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'order', action: 'created', id: d.id, patientId: d.patientId, version: d.version })),
    );
    this.es.addEventListener('order.updated', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'order', action: 'updated', id: d.id, patientId: d.patientId, version: d.version })),
    );
    this.es.addEventListener('order.deleted', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'order', action: 'deleted', id: d.id, patientId: d.patientId })),
    );
    this.es.addEventListener('setting.updated', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'setting', action: 'updated', key: d.key })),
    );
    this.es.addEventListener('setting.deleted', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'setting', action: 'deleted', key: d.key })),
    );
    this.es.addEventListener('bulk.imported', (ev) =>
      handle(ev as MessageEvent, (d) => ({ entity: 'bulk', subEntity: d.entity, count: d.count })),
    );
    this.es.addEventListener('heartbeat', () => {
      // 確保視為在線
      this.setOnline(true);
    });
  }

  // ─── Patients ──
  async getPatient(id: string): Promise<Patient | null> {
    try {
      const r = await apiGet<ServerResponse<Patient>>(`/api/patients/${encodeURIComponent(id)}`);
      return unwrapPatient(r.data);
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  async listPatients(filter?: PatientFilter): Promise<Patient[]> {
    const qs = filter?.since ? `?since=${encodeURIComponent(filter.since)}` : '';
    const r = await apiGet<ServerResponse<Patient[]>>(`/api/patients${qs}`);
    let list = r.data.map(unwrapPatient);
    if (filter?.status) list = list.filter((p) => p.status === filter.status);
    if (filter?.productLine) list = list.filter((p) => p.productLine === filter.productLine);
    return list;
  }

  async createPatient(p: Partial<Patient> & Pick<Patient, 'chartNo' | 'name' | 'productLine' | 'status'>): Promise<Patient> {
    const r = await api<ServerResponse<Patient>>('/api/patients', { method: 'POST', body: p });
    return unwrapPatient(r.data);
  }

  async updatePatient(id: string, patch: Partial<Patient>, version: number): Promise<Patient> {
    const r = await api<ServerResponse<Patient>>(`/api/patients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...patch, version },
    });
    return unwrapPatient(r.data);
  }

  async putPatient(p: Patient, version: number): Promise<Patient> {
    const r = await api<ServerResponse<Patient>>(`/api/patients/${encodeURIComponent(p.id)}`, {
      method: 'PUT',
      body: { ...p, version },
    });
    return unwrapPatient(r.data);
  }

  async deletePatient(id: string, version: number): Promise<void> {
    await api(`/api/patients/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' });
  }

  async bulkPutPatients(patients: Patient[]): Promise<void> {
    await api('/api/patients/bulk', { method: 'POST', body: { patients } });
  }

  // ─── Orders ──
  async getOrder(id: string): Promise<Order | null> {
    try {
      const r = await apiGet<ServerResponse<Order>>(`/api/orders/${encodeURIComponent(id)}`);
      return unwrapOrder(r.data);
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  async listOrders(filter?: OrderFilter): Promise<Order[]> {
    const params: string[] = [];
    if (filter?.since) params.push(`since=${encodeURIComponent(filter.since)}`);
    if (filter?.patientId) params.push(`patientId=${encodeURIComponent(filter.patientId)}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const r = await apiGet<ServerResponse<Order[]>>(`/api/orders${qs}`);
    return r.data.map(unwrapOrder);
  }

  async createOrder(o: Partial<Order> & Pick<Order, 'patientId' | 'date' | 'progress'>): Promise<Order> {
    const r = await api<ServerResponse<Order>>('/api/orders', { method: 'POST', body: o });
    return unwrapOrder(r.data);
  }

  async updateOrder(id: string, patch: Partial<Order>, version: number): Promise<Order> {
    const r = await api<ServerResponse<Order>>(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...patch, version },
    });
    return unwrapOrder(r.data);
  }

  async putOrder(o: Order, version: number): Promise<Order> {
    const r = await api<ServerResponse<Order>>(`/api/orders/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body: { ...o, version },
    });
    return unwrapOrder(r.data);
  }

  async deleteOrder(id: string, version: number): Promise<void> {
    await api(`/api/orders/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' });
  }

  async bulkPutOrders(orders: Order[]): Promise<void> {
    await api('/api/orders/bulk', { method: 'POST', body: { orders } });
  }

  // ─── Settings ──
  async getSetting<T = unknown>(key: string): Promise<T | null> {
    try {
      const r = await apiGet<ServerResponse<Setting>>(`/api/settings/${encodeURIComponent(key)}`);
      return (r.data.value as T) ?? null;
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  async listSettings(): Promise<Setting[]> {
    const r = await apiGet<ServerResponse<Setting[]>>('/api/settings');
    return r.data;
  }

  async putSetting(key: string, value: unknown): Promise<void> {
    await api(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
  }

  async deleteSetting(key: string): Promise<void> {
    await api(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  // ─── 事件 + 連線狀態 ──
  onChange(cb: (e: ChangeEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isOnline(): boolean {
    return this._online;
  }

  onConnectivityChange(cb: (online: boolean) => void): Unsubscribe {
    this.connListeners.add(cb);
    // 立即 fire 一次當前值
    queueMicrotask(() => cb(this._online));
    return () => this.connListeners.delete(cb);
  }
}

// 給 TypeScript 知道 NetworkError 在這檔有引用（避免 unused import）
export { NetworkError };
