// LoginPage — 帳號密碼登入 / 首次 bootstrap admin
//
// 兩種 mode（由 AuthContext.state.phase 決定）：
//   'unauthenticated' → 顯示登入表單
//   'bootstrap-needed' → 顯示首次建立 admin 帳號表單
//
// v0.6.2 新增：passwordless 帳號偵測
//   - 輸入帳號後 debounce 500ms、打 /api/auth/passwordless-check
//   - 若該帳號是 passwordless → 自動隱藏密碼欄、按鈕變「直接進入」
//   - 不洩漏帳號是否存在（passwordless:false 包括「不存在」+「需密碼」兩種）

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (import.meta.env.VITE_API_BASE as string) || '';

export default function LoginPage() {
  const { state, login, bootstrapAdmin } = useAuth();
  const isBootstrap = state.phase === 'bootstrap-needed';

  const [username, setUsername] = useState(isBootstrap ? 'verlandy' : '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(isBootstrap ? '主上' : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPasswordless, setIsPasswordless] = useState(false);
  const [checkingPasswordless, setCheckingPasswordless] = useState(false);

  const initialError =
    state.phase === 'unauthenticated' && state.reason ? state.reason : null;

  // 偵測 passwordless：debounce 500ms 後打 server
  useEffect(() => {
    if (isBootstrap) return; // bootstrap 一定要密碼
    const u = username.trim();
    if (!u) {
      setIsPasswordless(false);
      return;
    }
    setCheckingPasswordless(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `${API_BASE}/api/auth/passwordless-check?username=${encodeURIComponent(u)}`,
        );
        if (r.ok) {
          const data = await r.json();
          setIsPasswordless(!!data?.data?.passwordless);
        } else {
          setIsPasswordless(false);
        }
      } catch {
        setIsPasswordless(false);
      } finally {
        setCheckingPasswordless(false);
      }
    }, 500);
    return () => {
      clearTimeout(t);
      setCheckingPasswordless(false);
    };
  }, [username, isBootstrap]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = isBootstrap
        ? await bootstrapAdmin(username.trim(), password, displayName.trim() || username.trim())
        : await login(username.trim(), isPasswordless ? '' : password);
      if (!r.ok) setError(r.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-zinc-900/60 border border-zinc-800 rounded-xl shadow-2xl p-6 space-y-4"
      >
        <header>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold text-zinc-100 tracking-tight">隱形矯正追蹤</span>
            <span className="text-xs text-zinc-500">v{__APP_VERSION__}</span>
          </div>
          <h1 className="text-lg font-semibold text-zinc-100 mt-3">
            {isBootstrap ? '🚀 首次設定：建立管理員帳號' : '登入'}
          </h1>
          {isBootstrap && (
            <p className="text-xs text-zinc-500 mt-1">
              這是 server 第一次啟動、還沒任何帳號。建一個 admin 開始用。
            </p>
          )}
        </header>

        {(error || initialError) && (
          <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
            ⚠️ {error || initialError}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">帳號</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
              className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-sky-500/50"
            />
            {!isBootstrap && isPasswordless && (
              <p className="text-[10px] text-amber-400 mt-1">
                ⚡ 此帳號為共用機帳號、免密碼登入
              </p>
            )}
            {!isBootstrap && checkingPasswordless && (
              <p className="text-[10px] text-zinc-600 mt-1">確認帳號類型中…</p>
            )}
          </div>

          {isBootstrap && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1">顯示名稱</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-sky-500/50"
              />
            </div>
          )}

          {!isPasswordless && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1">密碼</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                required
                minLength={4}
                className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-sky-500/50"
              />
              {isBootstrap && (
                <p className="text-[10px] text-zinc-600 mt-1">至少 4 字、之後可以改</p>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-3 py-2 rounded-md bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
        >
          {submitting
            ? '處理中...'
            : isBootstrap
            ? '建立 + 登入'
            : isPasswordless
            ? '直接進入'
            : '登入'}
        </button>

        {!isBootstrap && (
          <p className="text-[10px] text-zinc-600 text-center mt-2">
            忘記密碼？請找 admin 重設
          </p>
        )}
      </form>
    </div>
  );
}
