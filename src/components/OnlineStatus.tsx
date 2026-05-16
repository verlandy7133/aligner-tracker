// 連線狀態指示器 + 離線警告 banner
//
// 兩種顯示形式：
//   <OnlineStatusBadge />  小圓點、可放任何角落
//   <OfflineBanner />      離線時顯示橫幅、文字 + 重試提示

import { useOnlineStatus } from '../hooks/useDataLayer';

export function OnlineStatusBadge() {
  const online = useOnlineStatus();
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
