/// <reference types="vite/client" />

// Vite define 注入的常數（見 vite.config.ts define 區）
declare const __APP_VERSION__: string;

// Vite env vars
interface ImportMetaEnv {
  readonly VITE_READ_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
