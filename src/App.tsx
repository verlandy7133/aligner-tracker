import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import PatientList from './pages/PatientList';
import PatientDetailPage from './pages/PatientDetailPage';
import OrderTracking from './pages/OrderTracking';
import OrderReportPage from './pages/OrderReportPage';
import SettingsPage from './pages/SettingsPage';
import ThemeSelector from './components/ThemeSelector';
import { seedIfEmpty } from './seed';
import { useTheme } from './themes';
import { initScale } from './lib/ui-scale';
import { initPhotoStyle } from './lib/photo-style';
import { syncStat } from './lib/helper-client';

const SYNC_LAST_PUSHED_KEY = 'aligner-sync-last-pushed';
const SYNC_LAST_PULLED_KEY = 'aligner-sync-last-pulled';

export default function App() {
  useTheme(); // 套用儲存的主題
  const [nasNewer, setNasNewer] = useState(false);

  useEffect(() => {
    // 一次性 seed (singleton 內部已有 race guard)
    seedIfEmpty();
    // 套用儲存的 UI 字級 scale
    initScale();
    // 套用儲存的 photo 框線樣式（CSS variable）
    initPhotoStyle();
    // 啟動時偵測 NAS sync.json 是否比本地新
    checkSyncStatus();
    // window focus 時也檢查（例：從另一台推完換回這台）
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

  return (
    <div className="min-h-screen">
      <nav className="border-b border-zinc-800/80 bg-zinc-950/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold text-zinc-100 tracking-tight">隱形矯正追蹤</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">v{__APP_VERSION__}</span>
          </Link>
          <div className="flex items-center gap-1">
            <NavItem to="/">病患列表</NavItem>
            <NavItem to="/orders">下單追蹤</NavItem>
            <NavItem to="/settings">
              <span className="relative inline-flex items-center">
                ⚙ 設定
                {nasNewer && (
                  <span
                    className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-zinc-950 animate-pulse"
                    title="NAS 有新版資料 → 去設定 → 跨機同步 → 從 NAS 拉"
                  />
                )}
              </span>
            </NavItem>
            <div className="ml-2"><ThemeSelector /></div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1800px] mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<PatientList />} />
          <Route path="/patients/:id" element={<PatientDetailPage />} />
          <Route path="/orders" element={<OrderTracking />} />
          <Route path="/orders/report" element={<OrderReportPage />} />
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
