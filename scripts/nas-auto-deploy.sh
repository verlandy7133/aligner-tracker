#!/bin/bash
# nas-auto-deploy.sh — NAS 端自動偵測 stage-b 新 tar、load + 重建 aligner-viewer container
#
# 設計：跑在 Synology NAS、由 DSM Task Scheduler 排程觸發（建議每 5 分鐘）
#
# 路徑：放在 stage-b 資料夾、D 機 Drive Client 會自動把它同步到 NAS
#       NAS 上實際路徑：/volume1/n歐耐恩n/0矯正追蹤/stage-b/nas-auto-deploy.sh
#
# 一次性設定：
#   1. 確認此 .sh 已 Drive sync 到 NAS（檢查上面路徑存在）
#   2. SSH 到 NAS 或在 DSM File Station 給此檔執行權：
#        chmod +x /volume1/n歐耐恩n/0矯正追蹤/stage-b/nas-auto-deploy.sh
#   3. DSM 控制台 → 工作排程器 → 新增 → 已排程的工作 → 使用者定義的指令碼
#      - 任務：aligner-auto-deploy
#      - 使用者：root（要動 docker 必須 root）
#      - 排程：每天、每 5 分鐘執行
#      - 任務設定 → 執行指令：
#          bash /volume1/n歐耐恩n/0矯正追蹤/stage-b/nas-auto-deploy.sh
#
# 之後：D 機 git commit 改 version → post-commit build tar → Drive sync 推到 NAS
#       → 此腳本下次 tick 偵測到 → docker load + 重建 container（停機 < 10 秒）
#       → log 寫回 stage-b/auto-deploy.log（會 Drive sync 回 D 機方便查看）
#
# 安全：
#   - flock 防止同時多個 instance
#   - 比對「最新 tar 版本 vs 上次部署版本」、相同就 skip（每 5 分鐘不會做白工）
#   - mtime 檢查：tar 必須穩定 > 60 秒才動作（避免 Drive sync 進行中讀到不完整 tar）

set -e

# ─── 設定 ──────────────────────────────────────────────
STAGE_B_DIR="/volume1/n歐耐恩n/0矯正追蹤/stage-b"
DATA_VOLUME="/volume1/n歐耐恩n/0矯正追蹤"
CONTAINER_NAME="aligner-viewer"
HOST_PORT=8080
CONTAINER_PORT=8080
LOG_FILE="$STAGE_B_DIR/auto-deploy.log"
STATE_FILE="$STAGE_B_DIR/.last-deployed-version"
LOCK_FILE="/tmp/aligner-auto-deploy.lock"
MIN_TAR_AGE_SEC=60  # tar 至少穩定多久才動作（避免 Drive sync 還沒寫完）

# 找 docker 執行檔
DOCKER=$(command -v docker || echo /usr/local/bin/docker)
if [ ! -x "$DOCKER" ]; then
  # Synology Container Manager（DSM 7.2+）有時候 docker 在 /var/packages/ContainerManager/target/usr/bin/
  for p in /var/packages/ContainerManager/target/usr/bin/docker /usr/local/bin/docker /usr/bin/docker; do
    if [ -x "$p" ]; then DOCKER="$p"; break; fi
  done
fi
if [ ! -x "$DOCKER" ]; then
  echo "[$(date)] ERROR: docker binary 找不到" >> "$LOG_FILE"
  exit 1
fi

# ─── 鎖（防止同時跑） ──────────────────────────────────
exec 200>"$LOCK_FILE"
flock -n 200 || exit 0  # 另一個 instance 在跑、安靜離開

# ─── log helper ───────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

quiet_log() {
  # 不 print 到 stdout、只寫 file（避免 cron mail 每 5 分鐘 spam）
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# ─── 找最新 tar ───────────────────────────────────────
if [ ! -d "$STAGE_B_DIR" ]; then
  quiet_log "stage-b 資料夾不存在、skip"
  exit 0
fi

LATEST_TAR=$(ls -1 "$STAGE_B_DIR"/aligner-viewer-*.tar 2>/dev/null | sort -V | tail -1)
if [ -z "$LATEST_TAR" ]; then
  quiet_log "stage-b 沒有 tar、skip"
  exit 0
fi

# 從 filename 萃取版本：aligner-viewer-0.6.2.tar → 0.6.2
LATEST_VERSION=$(basename "$LATEST_TAR" | sed 's/^aligner-viewer-//;s/\.tar$//')

# ─── 對比上次部署版本 ─────────────────────────────────
LAST_DEPLOYED=""
[ -f "$STATE_FILE" ] && LAST_DEPLOYED=$(cat "$STATE_FILE")
if [ "$LATEST_VERSION" = "$LAST_DEPLOYED" ]; then
  exit 0  # 同版本、無需動作、安靜離開（不 log spam）
fi

# ─── tar 必須穩定（避免 Drive sync 中途）────────────
TAR_MTIME=$(stat -c %Y "$LATEST_TAR" 2>/dev/null || stat -f %m "$LATEST_TAR" 2>/dev/null)
NOW=$(date +%s)
AGE=$((NOW - TAR_MTIME))
if [ "$AGE" -lt "$MIN_TAR_AGE_SEC" ]; then
  quiet_log "tar 太新（${AGE}s）、等下一次 tick 再動（避免 Drive 還沒寫完）"
  exit 0
fi

# ─── 開始部署 ─────────────────────────────────────────
log "================================================"
log "偵測到新版本 v$LATEST_VERSION（上次部署 v${LAST_DEPLOYED:-無}）"
log "tar: $LATEST_TAR ($(du -h "$LATEST_TAR" | cut -f1))"
log "docker: $DOCKER"

# 1. 載入 image
log "→ docker load ..."
if ! $DOCKER load -i "$LATEST_TAR" >> "$LOG_FILE" 2>&1; then
  log "❌ docker load 失敗、abort"
  exit 1
fi
log "✓ image 載入完成"

# 2. 停 + 刪舊 container（如果存在）
if $DOCKER ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "→ 停止 + 移除舊 container $CONTAINER_NAME ..."
  $DOCKER stop "$CONTAINER_NAME" >> "$LOG_FILE" 2>&1 || true
  $DOCKER rm "$CONTAINER_NAME" >> "$LOG_FILE" 2>&1 || true
  log "✓ 舊 container 已清除"
else
  log "→ 沒有舊 container、跳過清除"
fi

# 3. 建新 container
log "→ 啟動 aligner-viewer:$LATEST_VERSION ..."
if ! $DOCKER run -d \
  --name "$CONTAINER_NAME" \
  --restart always \
  -p ${HOST_PORT}:${CONTAINER_PORT} \
  -v "$DATA_VOLUME:/data" \
  -e DATA_PATH=/data \
  -e DB_PATH=/data/db.sqlite \
  -e PORT=$CONTAINER_PORT \
  "aligner-viewer:$LATEST_VERSION" >> "$LOG_FILE" 2>&1; then
  log "❌ docker run 失敗、abort"
  exit 1
fi
log "✓ container 已啟動"

# 4. 等啟動 + 健康檢查
log "→ 等 container 起來、健康檢查 ..."
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10; do
  HEALTH=$(curl -s -m 3 "http://127.0.0.1:${HOST_PORT}/api/health" 2>/dev/null || echo "")
  if echo "$HEALTH" | grep -q '"ok":true'; then
    PATIENT_COUNT=$(echo "$HEALTH" | sed 's/.*"patientCount":\([0-9]*\).*/\1/')
    log "✅ 部署成功 v$LATEST_VERSION、health OK、$PATIENT_COUNT patients"
    echo "$LATEST_VERSION" > "$STATE_FILE"
    log "================================================"
    exit 0
  fi
  sleep 3
done

log "⚠️ 健康檢查 10 次都失敗、container 可能有問題、請手動檢查"
log "   $DOCKER logs $CONTAINER_NAME --tail 50"
log "================================================"
exit 1
