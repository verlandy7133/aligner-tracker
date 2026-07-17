import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import PatientList from './pages/PatientList';
import PatientDetailPage from './pages/PatientDetailPage';
import OrderTracking from './pages/OrderTracking';
import OrderReportPage from './pages/OrderReportPage';
import VisitWorkbenchPage from './pages/VisitWorkbenchPage';
import SettingsPage from './pages/SettingsPage';
import ThemeSelector from './components/ThemeSelector';
import { OnlineStatusBadge, OfflineBanner } from './components/OnlineStatus';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import { seedIfEmpty } from './seed';
import { useTheme } from './themes';
import { initScale } from './lib/ui-scale';
import { initPhotoStyle } from './lib/photo-style';
import { syncStat, initHelperDetection } from './lib/helper-client';
import { READ_ONLY, initReadOnlyData } from './lib/read-only';

const SYNC_LAST_PUSHED_KEY = 'aligner-sync-last-pushed';
const SYNC_LAST_PULLED_KEY = 'aligner-sync-last-pulled';

export default function App() {
  useTheme(); // 套用儲存的主題
  const { state: authState, user, logout } = useAuth();
  const [nasNewer, setNasNewer] = useState(false);
  const [readOnlyState, setReadOnlyState] = useState<{
    state: 'loading' | 'imported' | 'cached' | 'no-server' | 'error';
    message?: string;
  }>(READ_ONLY ? { state: 'loading' } : { state: 'no-server' });

  useEffect(() => {
    // 套用儲存的 UI 字級 scale + 框線樣式（不論 readOnly 與否都套）
    initScale();
    initPhotoStyle();
    // v0.6.7: 偵測本機 helper service 是否可用、決定照片走 helper 還是 NAS API
    initHelperDetection();

    if (READ_ONLY) {
      // readOnly mode (Stage B iPad)：從 server fetch snapshot 進 IndexedDB
      initReadOnlyData().then((r) => {
        setReadOnlyState(r);
        if (r.state === 'imported') {
          console.log('[read-only] imported snapshot', r.counts);
        } else if (r.state === 'cached') {
          console.log('[read-only] using cached snapshot', r.mtime);
        }
      });
      return; // readOnly mode 不做 seed / sync check
    }

    // master/follower mode：原本邏輯
    seedIfEmpty();
    checkSyncStatus();
    const onFocus = () => checkSyncStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function checkSyncStatus() {
    const r = await syncStat();
    if (r.state !== 'ok') {
      setNasNewer(false);
      return;
    }
    const nasMtime = new Date(r.stat.mtime).getTime();
    const lastPushed = localStorage.getItem(SYNC_LAST_PUSHED_KEY);
    const lastPulled = localStorage.getItem(SYNC_LAST_PULLED_KEY);
    const lp = lastPushed ? new Date(lastPushed).getTime() : 0;
    const lpu = lastPulled ? new Date(lastPulled).getTime() : 0;
    // NAS 比兩個基準時間都新（+5s 緩衝避免剛推完誤判）
    setNasNewer(nasMtime > Math.max(lp, lpu) + 5000);
  }

  // v0.6.1 Auth gate：未登入 / 首次 bootstrap → 跳 LoginPage
  if (authState.phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">
        驗證登入狀態…
      </div>
    );
  }
  if (authState.phase === 'unauthenticated' || authState.phase === 'bootstrap-needed') {
    return <LoginPage />;
  }

  // readOnly mode + 還在 loading / error → show 提示頁
  if (READ_ONLY && readOnlyState.state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">
        載入中…
      </div>
    );
  }
  if (READ_ONLY && readOnlyState.state === 'no-server') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
          <h2 className="text-lg font-semibold mb-2">⚠️ 還沒有資料</h2>
          <p className="text-sm">
            {readOnlyState.message || 'server 上 sync.json 不存在'}
          </p>
          <p className="text-xs text-amber-300/80 mt-3">
            診所端 master 機需要先按一次「📤 推到 NAS」推資料、之後 iPad 重整就會看到。
          </p>
        </div>
      </div>
    );
  }
  if (READ_ONLY && readOnlyState.state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">
          <h2 className="text-lg font-semibold mb-2">⚠️ 載入失敗</h2>
          <p className="text-sm font-mono break-all">{readOnlyState.message}</p>
          <button
            onClick={() => location.reload()}
            className="mt-3 px-3 py-1.5 rounded-md text-xs bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 transition"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-zinc-800/80 bg-zinc-950/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold text-zinc-100 tracking-tight">隱形矯正追蹤</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">v{__APP_VERSION__}</span>
            {READ_ONLY && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">
                唯讀
              </span>
            )}
          </Link>
          <div className="flex items-center gap-1">
            <NavItem to="/">病患列表</NavItem>
            <NavItem to="/orders">下單追蹤</NavItem>
            <NavItem to="/visits">回診</NavItem>
            <NavItem to="/settings">
              <span className="relative inline-flex items-center">
                ⚙ 設定
                {!READ_ONLY && nasNewer && (
                  <span
                    className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-zinc-950 animate-pulse"
                    title="NAS 有新版資料 → 去設定 → 跨機同步 → 從 NAS 拉"
                  />
                )}
              </span>
            </NavItem>
            <div className="ml-2 flex items-center gap-3">
              <OnlineStatusBadge />
              <ThemeSelector />
              {user && (
                <div className="flex items-center gap-2 ml-2 pl-3 border-l border-zinc-800">
                  <span
                    className="text-xs text-zinc-400"
                    title={`${user.username} · ${user.role}`}
                  >
                    {user.displayName}
                  </span>
                  <button
                    onClick={logout}
                    className="text-[10px] text-zinc-500 hover:text-rose-400 transition"
                    title="登出"
                  >
                    登出
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <OfflineBanner />

      <main className="max-w-[1800px] mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<PatientList />} />
          <Route path="/patients/:id" element={<PatientDetailPage />} />
          <Route path="/orders" element={<OrderTracking />} />
          <Route path="/orders/report" element={<OrderReportPage />} />
          <Route path="/visits" element={<VisitWorkbenchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md text-sm transition ${
          isActive
            ? 'bg-zinc-800/80 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
