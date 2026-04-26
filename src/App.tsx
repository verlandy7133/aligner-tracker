import { useEffect } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import PatientList from './pages/PatientList';
import PatientDetailPage from './pages/PatientDetailPage';
import OrderTracking from './pages/OrderTracking';
import OrderReportPage from './pages/OrderReportPage';
import SettingsPage from './pages/SettingsPage';
import ThemeSelector from './components/ThemeSelector';
import { seedIfEmpty } from './seed';
import { useTheme } from './themes';

export default function App() {
  useTheme(); // 套用儲存的主題
  useEffect(() => {
    // 一次性 seed (singleton 內部已有 race guard)
    seedIfEmpty();
  }, []);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-zinc-800/80 bg-zinc-950/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold text-zinc-100 tracking-tight">隱形矯正追蹤</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">v0.1.0</span>
          </Link>
          <div className="flex items-center gap-1">
            <NavItem to="/">病患列表</NavItem>
            <NavItem to="/orders">下單追蹤</NavItem>
            <NavItem to="/settings">⚙ 設定</NavItem>
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
