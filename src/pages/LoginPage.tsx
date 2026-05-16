// LoginPage — 帳號密碼登入 / 首次 bootstrap admin
//
// 兩種 mode（由 AuthContext.state.phase 決定）：
//   'unauthenticated' → 顯示登入表單
//   'bootstrap-needed' → 顯示首次建立 admin 帳號表單

import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { state, login, bootstrapAdmin } = useAuth();
  const isBootstrap = state.phase === 'bootstrap-needed';

  const [username, setUsername] = useState(isBootstrap ? 'verlandy' : '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(isBootstrap ? '主上' : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const initialError =
    state.phase === 'unauthenticated' && state.reason ? state.reason : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = isBootstrap
        ? await bootstrapAdmin(username.trim(), password, displayName.trim() || username.trim())
        : await login(username.trim(), password);
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
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-3 py-2 rounded-md bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
        >
          {submitting ? '處理中...' : isBootstrap ? '建立 + 登入' : '登入'}
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
