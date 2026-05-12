# Aligner Viewer Server — Stage B iPad 唯讀 web
#
# Multi-stage build:
#   1. builder    — npm install + vite build (with VITE_READ_ONLY=1)
#   2. runtime    — copy dist + server/ + install server deps only
#
# 結果 image ~150MB，跑在 Synology DS918+ Docker (x86_64)
#
# Build:
#   docker build -t aligner-viewer:0.3.0 .
#
# Run locally for testing:
#   docker run --rm -p 8080:8080 \
#     -v D:/矯正:/data:ro \
#     -e SYNC_FILE=/data/aligner-tracker-backup-2026-04-26-live.json \
#     aligner-viewer:0.3.0
#
# 然後 browser 開 http://localhost:8080
#
# Export for NAS deploy:
#   docker save aligner-viewer:0.3.0 -o aligner-viewer-0.3.0.tar
#   # 上傳 aligner-viewer-0.3.0.tar 到 NAS、用 DSM Docker UI 載入

# ─── Stage 1: builder ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# 裝主 dependency（含 vite 等 dev deps）
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source + 跑 readonly build
COPY . .
ENV VITE_READ_ONLY=1
RUN npm run build

# 安裝 server deps（獨立、不混進 main package.json）
WORKDIR /app/server
RUN npm ci --omit=dev


# ─── Stage 2: runtime ────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# 只 copy 必要檔案：dist + server + server/node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Default env vars (NAS deploy 時 docker-compose 會 override)
ENV PORT=8080
ENV DATA_PATH=/data
ENV NODE_ENV=production

# Healthcheck — 每 30s ping /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost:8080/api/health || exit 1

EXPOSE 8080
WORKDIR /app/server
CMD ["node", "index.js"]
