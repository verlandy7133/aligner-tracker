import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icon.svg'],
      manifest: {
        name: '隱形矯正追蹤',
        short_name: '矯正追蹤',
        description: '診所內部用 · 病患進度看板與下單追蹤',
        theme_color: '#0c1220',
        background_color: '#09090d',
        display: 'standalone',
        orientation: 'any',
        lang: 'zh-Hant',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // 不快取 helper service API (localhost:8765)
        navigateFallbackDenylist: [/^\/api/, /^\/open-/],
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5174,
    host: true,
  },
  preview: {
    port: 5174,
    host: true,
  },
});
