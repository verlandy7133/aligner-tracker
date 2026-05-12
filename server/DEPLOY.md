# Stage B 部署到 NAS Docker

> 目標：把 `aligner-viewer` server image deploy 到 Synology DS918+ Docker、iPad 內網可訪問

## 前置條件

- ✅ NAS = Synology DS918+ DSM 6.2.2 + Docker 套件已裝
- ✅ NAS 內網 IP = 192.168.0.220、外網 IP = 122.116.147.128:5058
- ✅ `n歐耐恩n/0矯正追蹤/` 共用資料夾已建（File Station 確認）
- ⏳ 診所 master 機已用 App「📤 推到 NAS」推 sync.json 進 `0矯正追蹤/`
  - 如果還沒推、deploy 後也能跑、只是 SPA 顯示「⚠️ 還沒有資料」提示頁
- ⏳ 開發機有 Docker Desktop（或在 NAS 上 build）

---

## 部署流程

### Step 1: D 機 build image（在 aligner-tracker repo root）

```powershell
docker build -t aligner-viewer:0.3.0 .
```

預計 5-10 分鐘（npm ci × 2 + vite build）。

如果 D 機沒 Docker Desktop：
- **裝 Docker Desktop**（https://www.docker.com/products/docker-desktop/、需要 WSL 2、~3GB 下載）
- 或 **跳過此 step、用方法 B**（NAS 上 build）

### Step 2: Export image 成 tar 檔

```powershell
docker save aligner-viewer:0.3.0 -o aligner-viewer-0.3.0.tar
```

產出 `aligner-viewer-0.3.0.tar` ~150MB。

### Step 3: 上傳 tar 到 NAS

- 開 File Station → `n歐耐恩n/0矯正追蹤/` 或別的位置
- 上傳 `aligner-viewer-0.3.0.tar`
- 或用 Synology Drive Client 同步上去也行

### Step 4: DSM Docker UI 載入 image

1. DSM 主選單 → **Docker** → 左欄 **影像**
2. 點 **新增** → **從檔案新增** → 選剛上傳的 .tar
3. 等載入完成（1-2 分鐘）→ 應該看到 `aligner-viewer:0.3.0` 在影像列表

### Step 5: 啟動 container

1. 點選 `aligner-viewer:0.3.0` → **啟動**
2. **建立容器** 精靈：
   - **一般設定**：
     - 容器名稱：`aligner-viewer`
     - 勾 **啟用自動重新啟動**
   - **進階設定** → **連接埠**：
     - 本機連接埠 `8080` → 容器連接埠 `8080`
   - **進階設定** → **共用資料夾**：
     - 加入：`n歐耐恩n/0矯正追蹤` → 掛載路徑 `/data` → **勾「唯讀」**
   - **進階設定** → **環境變數**（通常 Dockerfile 已設好、可不動）：
     - `PORT=8080`
     - `DATA_PATH=/data`
3. **完成** → container 啟動

### Step 6: 確認 server 運作

開瀏覽器 → `http://192.168.0.220:8080/api/health`

應該看到：
```json
{
  "ok": true,
  "service": "aligner-viewer-server",
  "version": "0.3.0",
  "syncExists": true|false,
  ...
}
```

- `syncExists: true` → 已可用、進 `http://192.168.0.220:8080/` 看 SPA
- `syncExists: false` → 診所 master 機還沒推過 sync.json、推完就會出來

### Step 7: NAS 防火牆設定

控制台 → **安全性** → **防火牆** → 確認 LAN 內 port 8080 允許：

- 預設規則：LAN（192.168.x.x）→ 允許所有 port
- 外網 → 8080 應該擋住（避免 iPad 唯讀 web 暴露到公網）

確認方式：在診所 LAN 外（手機開 4G）試 `http://122.116.147.128:8080` → 應該連不到（這是預期、安全）。

### Step 8: iPad 連線測試

1. iPad 連診所 wifi（內部 SSID `Mi`、密碼 milan31603879）
2. Safari 開 `http://192.168.0.220:8080/`
3. 應該看到「載入中…」→ 病患列表
4. 把 URL 加入主畫面 → 變類似 App 的圖示

---

## 方法 B：在 NAS 上直接 build（不裝 Docker Desktop）

DSM 6.2 Docker 套件**沒有**內建「從 Dockerfile build」UI、要透過 SSH：

```bash
# 1. SSH 連進 NAS
ssh admin@192.168.0.220 -p 22

# 2. 把 source code clone 到 NAS shared folder
cd /volume1/n歐耐恩n/0矯正追蹤
git clone https://github.com/verlandy7133/aligner-tracker.git

# 3. NAS 上 build（需要先確認 docker CLI 在 PATH）
cd aligner-tracker
sudo docker build -t aligner-viewer:0.3.0 .

# 4. Run（一行）
sudo docker run -d \
  --name aligner-viewer \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /volume1/n歐耐恩n/0矯正追蹤:/data:ro \
  -e PORT=8080 \
  -e DATA_PATH=/data \
  aligner-viewer:0.3.0
```

DSM 6.2 預設 SSH 沒開、要去**控制台 → 終端機與 SNMP → 啟用 SSH 服務**。

---

## 更新流程

當 master push 新版（v0.3.1 之類）：

1. D 機 `git pull && docker build -t aligner-viewer:0.3.1 .`
2. `docker save aligner-viewer:0.3.1 -o aligner-viewer-0.3.1.tar`
3. 上傳 + DSM Docker UI 載入新 image
4. 停舊 container → 用新 image 建 container（保留設定）

---

## 常見問題

### Q: iPad Safari 開不出來（loading 一直轉）

- 確認 iPad 連的是診所 wifi（不是 4G）
- 確認 NAS 防火牆 LAN 允許 8080
- ping NAS：iPad 上開另一個 tab 試 `http://192.168.0.220:5058`（DSM 介面）能不能開

### Q: 看到「⚠️ 還沒有資料」提示頁

- 診所 master 機還沒推 sync.json
- 解：master 機 App → ⚙ 設定 → 跨機同步 → 「📤 推到 NAS」
- 等 30 秒 → iPad 重整

### Q: container 啟動失敗

- 看 DSM Docker → 容器 → aligner-viewer → 詳細資料 → 終端機 → 看 log
- 常見：8080 port 被別的服務占住、改成 8081 試

### Q: HEIC 照片在 iPad 顯示正常嗎？

- 預期 ✅ — iOS Safari 原生支援 HEIC
- 若顯示不出來：可能 server stream 的 Content-Type 沒設對、檢查 `/api/image?path=...` response header
