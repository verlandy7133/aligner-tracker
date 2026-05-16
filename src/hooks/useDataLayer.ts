// React hooks for DataLayer
//
// 用法（替代既有 useLiveQuery(() => db.patients.get(id))）：
//   const patient = usePatient(id)
//   const patients = usePatients(filter)
//   const orders = useOrders(filter)
//   const setting = useSetting<T>(key)
//
// 機制：
//   - mount 時呼叫 dataLayer.getX() / listX()
//   - 訂閱 dataLayer.onChange() — 相關 entity 變更時 re-fetch
//   - unmount 時 unsub

import { useEffect, useState, useRef } from 'react';
import type { Patient, Order } from '../types/Patient';
import type { Setting } from '../db';
import { getDataLayer } from '../lib/data-layer';
import type { PatientFilter, OrderFilter } from '../lib/data-layer';

// ─── Patient hooks ───────────────────────────────────
export function usePatient(id: string | null | undefined): Patient | null | undefined {
  // undefined = 還沒 load 完 / null = load 完但找不到
  const [val, setVal] = useState<Patient | null | undefined>(undefined);
  useEffect(() => {
    if (!id) {
      setVal(null);
      return;
    }
    let alive = true;
    const dl = getDataLayer();
    dl.getPatient(id).then((p) => alive && setVal(p));
    const unsub = dl.onChange((e) => {
      if (e.entity === 'patient' && e.id === id) {
        dl.getPatient(id).then((p) => alive && setVal(p));
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [id]);
  return val;
}

export function usePatients(filter?: PatientFilter): Patient[] | undefined {
  const [val, setVal] = useState<Patient[] | undefined>(undefined);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    let alive = true;
    const dl = getDataLayer();
    const refresh = () => dl.listPatients(filterRef.current).then((ps) => alive && setVal(ps));
    refresh();
    const unsub = dl.onChange((e) => {
      if (e.entity === 'patient' || (e.entity === 'bulk' && e.subEntity === 'patient')) {
        refresh();
      }
    });
    return () => {
      alive = false;
      unsub();
    };
    // 注意：filter 物件每次 render 都是新 ref、所以用 filterRef 避免重訂閱
    // 想要 filter 變動時重新拉？deps 加 JSON.stringify(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);
  return val;
}

// ─── Order hooks ─────────────────────────────────────
export function useOrder(id: string | null | undefined): Order | null | undefined {
  const [val, setVal] = useState<Order | null | undefined>(undefined);
  useEffect(() => {
    if (!id) {
      setVal(null);
      return;
    }
    let alive = true;
    const dl = getDataLayer();
    dl.getOrder(id).then((o) => alive && setVal(o));
    const unsub = dl.onChange((e) => {
      if (e.entity === 'order' && e.id === id) {
        dl.getOrder(id).then((o) => alive && setVal(o));
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [id]);
  return val;
}

export function useOrders(filter?: OrderFilter): Order[] | undefined {
  const [val, setVal] = useState<Order[] | undefined>(undefined);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    let alive = true;
    const dl = getDataLayer();
    const refresh = () => dl.listOrders(filterRef.current).then((os) => alive && setVal(os));
    refresh();
    const unsub = dl.onChange((e) => {
      if (e.entity === 'order' || (e.entity === 'bulk' && e.subEntity === 'order')) {
        refresh();
      }
    });
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);
  return val;
}

// ─── Setting hooks ───────────────────────────────────
export function useSetting<T = unknown>(key: string): T | null | undefined {
  const [val, setVal] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const dl = getDataLayer();
    dl.getSetting<T>(key).then((v) => alive && setVal(v));
    const unsub = dl.onChange((e) => {
      if (e.entity === 'setting' && e.key === key) {
        dl.getSetting<T>(key).then((v) => alive && setVal(v));
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [key]);
  return val;
}

export function useSettings(): Setting[] | undefined {
  const [val, setVal] = useState<Setting[] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const dl = getDataLayer();
    const refresh = () => dl.listSettings().then((ss) => alive && setVal(ss));
    refresh();
    const unsub = dl.onChange((e) => {
      if (e.entity === 'setting') refresh();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return val;
}

// ─── 連線狀態 ────────────────────────────────────────
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => {
    try {
      return getDataLayer().isOnline();
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const dl = getDataLayer();
    const unsub = dl.onConnectivityChange(setOnline);
    return unsub;
  }, []);
  return online;
}
