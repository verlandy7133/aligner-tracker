// 連線狀態指示器 + 離線警告 banner
//
// 三種顯示形式（依 VITE_DATA_MODE）：
//   - 'dexie'（預設、單機模式）→ 灰色「單機」（沒 server 概念）
//   - 'api' / 'dual'（雙寫 / 純 server）→ 綠/紅 sync 狀態
//
//   <OnlineStatusBadge />  小圓點、可放任何角落
//   <OfflineBanner />      離線時顯示橫幅、文字 + 重試提示（dual/api 模式才會出現）

import { useOnlineStatus } from '../hooks/useDataLayer';

// v0.6.0: 判斷是否走 server。env 預設 'dexie' = 沒接 server
const MODE = (import.meta.env.VITE_DATA_MODE as string) || 'dexie';
const HAS_REMOTE = MODE === 'dual' || MODE === 'api';

export function OnlineStatusBadge() {
  const online = useOnlineStatus();

  // 單機模式（純 Dexie）— 沒 server、顯示灰色「單機」
  if (!HAS_REMOTE) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-zinc-500"
        title="本機單機模式（IndexedDB only、未啟用 server）"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-zinc-600" />
        <span>單機</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${online ? 'text-emerald-400' : 'text-rose-400'}`}
      title={online ? '已連線到 NAS server' : '離線中、無法寫入'}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          online ? 'bg-emerald-500 shadow-[0_0_6px_rgb(16,185,129)]' : 'bg-rose-500'
        }`}
      />
      <span>{online ? '同步中' : '離線'}</span>
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  // 單機模式沒有「離線」概念、不顯示 banner
  if (!HAS_REMOTE) return null;
  if (online) return null;
  return (
    <div className="bg-rose-950/80 border border-rose-700 text-rose-200 text-sm px-4 py-2 rounded mx-2 my-1 flex items-center gap-2">
      <span className="text-rose-400">⚠</span>
      <span>
        <strong>離線中</strong> — 目前無法寫入資料。請檢查網路或連回診所內網。讀取仍可用（顯示最後一次同步的本機快取）。
      </span>
    </div>
  );
}
