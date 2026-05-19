# Aligner Viewer Server — Stage B iPad viewer + v0.6.0 NAS API
#
# Multi-stage build:
#   1. builder    — npm install + vite build
#   2. runtime    — copy dist + server/ + install server deps only
#
# v0.6.0 變更：
#   - base 從 node:20-alpine → node:24-alpine
#     (server 用 node:sqlite、需 Node ≥ 22.5；24 是穩定版)
#   - DATA_PATH 從 ro → rw (server 要寫 db.sqlite + audit_log)
#   - 加 DB_PATH 環境變數
#
# 結果 image ~180MB，跑在 Synology DS918+ Docker (x86_64)
#
# Build:
#   docker build -t aligner-viewer:0.6.0 .
#
# Run locally for testing:
#   docker run --rm -p 8080:8080 \
#     -v D:/dev/矯正追蹤-app/dev-data:/data:rw \
#     -e DB_PATH=/data/db.sqlite \
#     aligner-viewer:0.6.0
#
# Export for NAS deploy:
#   docker save aligner-viewer:0.6.0 -o aligner-viewer-0.6.0.tar

# ─── Stage 1: builder ────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# 裝主 dependency（含 vite 等 dev deps）
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source + 跑 build
# v0.6.4：拿掉 VITE_READ_ONLY=1（Phase 1 結束、DataLayer 已切到 dual mode）
# 設 VITE_DATA_MODE=dual → dist 內建 dual mode、API 直接打 NAS（不需要本機 helper）
# VITE_API_BASE 留空、runtime fallback 用 window.location.hostname:8080 自動偵測
# （iPad 連 192.168.0.220:8080 → api 也用 192.168.0.220:8080；Tailscale 連 100.x → api 也用 100.x）
COPY . .
ENV VITE_DATA_MODE=dual
RUN npm run build

# 安裝 server deps（獨立、不混進 main package.json）
# server 用 node:sqlite + express、無 native build、純 JS
WORKDIR /app/server
RUN npm ci --omit=dev


# ─── Stage 2: runtime ────────────────────────────────
FROM node:24-alpine
WORKDIR /app

# 只 copy 必要檔案：dist + server + server/node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Default env vars (NAS deploy 時 docker-compose 會 override)
ENV PORT=8080
ENV DATA_PATH=/data
ENV DB_PATH=/data/db.sqlite
ENV NODE_ENV=production

# Healthcheck — 每 30s ping /api/health
# 用 127.0.0.1 不用 localhost (alpine 內 wget 走 IPv6 先試、若 server 只綁 v4 → fail)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8080/api/health || exit 1

EXPOSE 8080
WORKDIR /app/server
CMD ["node", "index.js"]
