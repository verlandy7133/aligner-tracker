import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { setDataLayer } from './lib/data-layer';
import { DexieDataLayer } from './lib/data-layer-dexie';
import { ApiDataLayer } from './lib/data-layer-api';
import { DualDataLayer } from './lib/data-layer-dual';

// ─── DataLayer 初始化（v0.6.0） ───────────────────────
// 選擇實作：環境變數 VITE_DATA_MODE
//   - 'dexie'  → 純本機（既有行為、Phase 1 fallback）
//   - 'api'    → 純 server（Phase 2 目標）
//   - 'dual'   → 雙寫（Phase 1 預設）
//   - 不設     → 預設 'dexie'（v0.5.x 行為、不破壞既有運作）
const mode = (import.meta.env.VITE_DATA_MODE as string) || 'dexie';
console.log(`[main] DataLayer mode = ${mode}`);

let layer;
if (mode === 'api') {
  layer = new ApiDataLayer();
} else if (mode === 'dual') {
  layer = new DualDataLayer(new DexieDataLayer(), new ApiDataLayer());
} else {
  layer = new DexieDataLayer();
}
setDataLayer(layer);

// 啟動（API / Dual 模式才需要、Dexie 模式沒實作 start）
const startFn = (layer as { start?: () => Promise<void> }).start;
startFn?.call(layer).catch((e: unknown) => console.error('[main] DataLayer start failed:', e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
