// AuthContext — currentUser + login / logout + permission helper
//
// 用法：
//   import { useAuth, usePermission } from './contexts/AuthContext';
//   const { user, login, logout } = useAuth();
//   const canCreatePatient = usePermission('patient.create');

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  api,
  apiPost,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from '../lib/api-client';

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  passwordless?: boolean;
};

type LoginResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; error: string };

type BootstrapResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; error: string };

type AuthState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated'; reason?: string }
  | { phase: 'authenticated'; user: CurrentUser }
  | { phase: 'bootstrap-needed' }; // server 沒任何 user、要先建 admin

type AuthContextValue = {
  state: AuthState;
  user: CurrentUser | null;
  isAdmin: boolean;
  hasPermission: (perm: string) => boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  bootstrapAdmin: (username: string, password: string, displayName: string) => Promise<BootstrapResult>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// 預設 'dexie' 模式不接 server — 直接 fake admin user 給整個 app
// 只有 dual / api 模式才走真實 auth
const MODE = (import.meta.env.VITE_DATA_MODE as string) || 'dexie';
const REQUIRES_AUTH = MODE === 'dual' || MODE === 'api';

// 純 dexie 模式假 user — 給整個 app 假裝是 admin
const FAKE_LOCAL_USER: CurrentUser = {
  id: 'local-system',
  username: 'local',
  displayName: '本機',
  role: 'admin',
  permissions: ['*'], // 萬用權限
  isActive: true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ phase: 'loading' });

  const logout = useCallback(() => {
    setAuthToken(null);
    setState({ phase: 'unauthenticated' });
  }, []);

  // 註冊 401 handler — 由 api-client 在收到 401 時呼叫
  // 注意：使用 setState callback form 拿到當前 phase，避免在 'loading' / 'bootstrap-needed' 期間
  // 被 DataLayer.start() 觸發的 401 race 蓋掉 — 只在已 authenticated 時降級
  useEffect(() => {
    if (!REQUIRES_AUTH) return;
    setUnauthorizedHandler((reason) => {
      setState((prev) => {
        if (prev.phase !== 'authenticated') return prev; // 還沒登入過、忽略無謂的 401
        setAuthToken(null);
        return { phase: 'unauthenticated', reason };
      });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 啟動時：dexie 模式直接走 fake user；server 模式試解 token / 偵測 bootstrap
  useEffect(() => {
    if (!REQUIRES_AUTH) {
      setState({ phase: 'authenticated', user: FAKE_LOCAL_USER });
      return;
    }
    (async () => {
      const token = getAuthToken();
      if (token) {
        try {
          const r = await api<{ data: CurrentUser }>('/api/auth/me');
          setState({ phase: 'authenticated', user: r.data });
          return;
        } catch (_e) {
          // token 無效、繼續往下走 unauthenticated
          setAuthToken(null);
        }
      }
      // 沒 token、看 server 有沒有 user（有 → 直接 unauth、無 → bootstrap）
      // 用 bootstrap-admin 405 / 403 試探：但 server 沒有「check 是否需要 bootstrap」endpoint
      // 簡單做法：嘗試 bootstrap-admin 不帶資料、server 會回 'validation_error'（已 bootstrap）或'already_bootstrapped'
      try {
        const r = await fetch(
          (import.meta.env.VITE_API_BASE ?? '') + '/api/auth/bootstrap-admin',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          },
        );
        const data = await r.json();
        if (data?.error === 'already_bootstrapped') {
          setState({ phase: 'unauthenticated' });
        } else {
          // validation_error / 其他 → server 願意接受 bootstrap、users 表是空的
          setState({ phase: 'bootstrap-needed' });
        }
      } catch (_e) {
        // server 連不到、退回 unauth
        setState({ phase: 'unauthenticated', reason: 'server 連不到' });
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    try {
      const r = await apiPost<{ data: { user: CurrentUser; token: string } }>(
        '/api/auth/login',
        { username, password },
      );
      setAuthToken(r.data.token);
      setState({ phase: 'authenticated', user: r.data.user });
      return { ok: true, user: r.data.user };
    } catch (e: any) {
      return { ok: false, error: e?.message || '登入失敗' };
    }
  }, []);

  const bootstrapAdmin = useCallback(
    async (username: string, password: string, displayName: string): Promise<BootstrapResult> => {
      try {
        const r = await apiPost<{ data: { user: CurrentUser; token: string } }>(
          '/api/auth/bootstrap-admin',
          { username, password, displayName },
        );
        setAuthToken(r.data.token);
        setState({ phase: 'authenticated', user: r.data.user });
        return { ok: true, user: r.data.user };
      } catch (e: any) {
        return { ok: false, error: e?.message || 'Bootstrap 失敗' };
      }
    },
    [],
  );

  const refreshMe = useCallback(async () => {
    if (!REQUIRES_AUTH) return;
    try {
      const r = await api<{ data: CurrentUser }>('/api/auth/me');
      setState({ phase: 'authenticated', user: r.data });
    } catch {
      // ignore
    }
  }, []);

  const user = state.phase === 'authenticated' ? state.user : null;
  const isAdmin = user?.role === 'admin' || user?.permissions?.includes('*') === true;

  const hasPermission = useCallback(
    (perm: string) => {
      if (!user) return false;
      if (user.permissions.includes('*')) return true; // 萬用權限（dexie 模式）
      return user.permissions.includes(perm);
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ state, user, isAdmin, hasPermission, login, bootstrapAdmin, logout, refreshMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function usePermission(perm: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(perm);
}

export function useCurrentUser(): CurrentUser | null {
  return useAuth().user;
}
