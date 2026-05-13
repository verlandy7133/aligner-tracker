# 隱形矯正追蹤 — 疑難排解

> 看到錯誤先來這查。每條：**症狀 → 原因 → 修法 → 預防**。
> 沒寫到的：把錯誤 log / 截圖丟給皇后，請她「TROUBLESHOOTING.md 加一條」。

## 目錄

- [1. 更新失敗（切換版本 / 升到最新）](#1-更新失敗)
- [2. Excel 匯入](#2-excel-匯入)
- [3. 資料夾掃描](#3-資料夾掃描)
- [4. NAS / 跨機同步](#4-nas--跨機同步)
- [5. 照片 / HEIC / AI 一鍵填入](#5-照片--heic--ai-一鍵填入)
- [6. Helper service](#6-helper-service)
- [7. PWA / 顯示](#7-pwa--顯示)
- [8. 病患資料疑似遺失 / 救援](#8-病患資料疑似遺失--救援)

---

## 1. 更新失敗

### 1.1 工作樹有未提交變動 — exit 1 in [0/3]

- **症狀**：設定頁按「切換到 main」紅字「更新失敗 (exit 1)」、展開 log 看到：
  ```
  ⚠️ 工作樹有未提交變動：
   M package-lock.json
  ```
- **原因**：上次更新時 `npm install` 自動改寫了 `package-lock.json`、git 認為 dirty、下次 update 卡在 step 0。這是 npm 行為、不是主上動到 code。
- **修法（v0.3.16+）**：再按一次更新即可 — 新版 `update.ps1` 會自動 reset、不需要手動處理
- **修法（v0.3.15 以下）**：在筆電 PowerShell 跑：
  ```powershell
  cd C:\dev\矯正追蹤-app
  git -c core.autocrlf=false reset --hard HEAD
  git status   # 應顯示 working tree clean
  ```
  然後回 App 設定頁再按一次更新
- **預防**：升到 v0.3.16+ 就不會再卡

### 1.2 npm install 失敗 — exit 1 in [2/3]

- **症狀**：log 看到 `❌ npm install 失敗`
- **可能原因**：
  - 網路不通（連不到 npm registry）
  - 防毒擋 `node_modules\` 寫入
  - `sharp` 原生編譯失敗（罕見、Windows 通常會抓預編譯 binary）
- **修法**：
  1. 看紅字 stderr — 通常已經寫原因
  2. 開瀏覽器確認筆電能上網
  3. 暫時關防毒、再按一次更新
  4. 仍不行 → 在筆電 PowerShell 手動跑：
     ```powershell
     cd C:\dev\矯正追蹤-app
     npm install --legacy-peer-deps
     ```
     看完整錯誤
- **預防**：診所網路保持暢通、防毒白名單加 `C:\dev\矯正追蹤-app\`

### 1.3 build 失敗 — exit 1 in [3/3]

- **症狀**：log 看到 `❌ build 失敗`、含 TS 或 vite error
- **可能原因**：拉到一個有 bug 的 commit（不該發生、開發機 push 前都 build 過）
- **修法 — 暫時回穩定版**：
  ```powershell
  cd C:\dev\矯正追蹤-app
  git fetch --tags
  git tag -l "v*" --sort=-version:refname | head    # 看可用 tag
  git reset --hard v0.3.16                          # 改成上次穩定 tag
  npm install --legacy-peer-deps
  npm run build
  ```
- **修法 — 通報**：把紅字截圖丟給皇后、回開發機修

### 1.4 找不到 App 目錄

- **症狀**：`❌ 找不到 App 目錄（找了 C:\dev\矯正追蹤-app 跟 D:\dev\矯正追蹤-app）`
- **原因**：git repo clone 路徑不對
- **修法**：確認筆電 clone 在 `C:\dev\矯正追蹤-app`、開發機 clone 在 `D:\dev\矯正追蹤-app`

### 1.5 不是 master 角色，跳過更新

- **症狀**：`⚠️ 此機角色為 follower（開發機），不該從 GitHub 拉更新` 然後 exit 0
- **原因**：`dev-data\clinic-role.txt` 內容不是 `master`、或檔不存在（預設 follower）
- **修法**：
  - 該機真的是診所機 → 在 `dev-data\` 建 `clinic-role.txt`、內容只寫一個字 `master`
  - 不是診所機（開發機）→ 不該按更新、改用 `git pull` 手動更新

---

## 2. Excel 匯入

### 2.1「Excel 資料夾不存在」

- **症狀**：按「掃描並套用 Excel」紅字：
  ```
  Excel 資料夾不存在：W:\0矯正追蹤\下單Excel\（請先建立並放入 .xlsx）
  ```
- **原因**：helper 找的路徑是 `<資料根>\下單Excel\`、該資料夾沒建
- **修法**：
  1. 在 NAS dataRoot 底下建資料夾 `下單Excel\`
  2. 把含「生產資料庫」+「牙套下單」兩個 sheet 的 .xlsx 丟進去
  3. 回 App 再按一次掃描
- **預防**：新機 setup checklist 加：「資料根底下必須有三個資料夾 `病患資料夾\` `病患授權書\` `下單Excel\`」

### 2.2 「ModuleNotFoundError: No module named 'openpyxl'」

- **症狀**：python 輸出 stderr 看到這行
- **原因**：筆電 python 沒裝 openpyxl（讀 .xlsx 必要套件）
- **修法（v0.3.16+）**：跑一次 update.ps1（會自動裝 openpyxl + pillow-heif）
- **修法（v0.3.15 以下）**：筆電 PowerShell：
  ```powershell
  python -m pip install openpyxl
  ```

### 2.3 「沒偵測到 python」

- **症狀**：update 輸出看到 `（沒偵測到 python、跳過 python 套件檢查）`，之後 Excel 掃描噴錯
- **原因**：筆電沒裝 Python、或裝了但不在 PATH
- **修法**：到 https://python.org 下載最新 3.x、安裝時**勾「Add Python to PATH」**

### 2.4 python 跑成功但沒新增資料

- **症狀**：套用後綠色卡片顯示「病患更新 0 / 新建 0 / 下單 +0」
- **可能原因**：
  - Excel 內 sheet 名不是「生產資料庫」+「牙套下單」（被改過名）
  - Excel 內容跟 IndexedDB 已存在的完全重複（沒新東西）
- **修法**：
  1. 開 .xlsx 確認 sheet 名沒變
  2. 看「查看 python 輸出」展開、找關鍵字「新增 / 跳過 / 重複」

---

## 3. 資料夾掃描

### 3.1 掃了但沒找到新資料夾

- **症狀**：按「資料夾掃描 master」、結果回 0 新增
- **可能原因**：
  - 新資料夾命名格式不對（應為 `YYMMDD姓名`、6 位生日+姓名）
  - 該病患（同姓名+生日）已在 IndexedDB
  - 設定頁「資料根」路徑指錯
- **修法**：
  1. 確認資料夾命名（例 `680829陳品之` ✓、`陳品之_680829` ✗）
  2. 看設定頁「資料根」是否指到對的 NAS 路徑
  3. 進 IndexedDB 查（病患列表搜尋姓名）— 若已存在就是真的重複

### 3.2 列資料夾失敗 / 權限錯誤

- **症狀**：紅字「列資料夾失敗：EACCES」或「ENOENT」
- **原因**：NAS 共用沒掛、或 Windows 對該路徑沒讀權限
- **修法**：
  - 開檔案總管手動進 `W:\0矯正追蹤\病人資料夾\`、若進不去 → 重連 NAS（見 [4.1](#41-w-沒掛---檔案總管看不到-w)）
  - 進得去但 helper 抓不到 → 重啟 App（helper 重起）

---

## 4. NAS / 跨機同步

### 4.1 W: 沒掛 / 檔案總管看不到 W:

- **症狀**：設定頁路徑紅字、檔案總管沒有 W: 槽
- **修法**：
  - 檔案總管按「**這台電腦**」→ 工具列「**映射網路磁碟機**」
  - 磁碟代號選 `W:`、資料夾填 `\\<NAS-IP>\n歐耐恩n`（IP 看 Synology 後台 / 路由器）
  - 勾「**登入時重新連線**」+「**使用其他認證**」、填 NAS 帳密
  - 完成 → 應該能進 `W:\0矯正追蹤\`
- **預防**：每台機器只設定一次、之後重開機會自動重連

### 4.2 跨機資料不一致 / sync.json 衝突

- **症狀**：樓上樓下看到的病患數不同、或某筆病患在一邊有、另一邊沒
- **原因**：兩台同時改 + sync.json 來不及合
- **預防**：**一次只在一台改**（早上樓下、下午樓上、不要同時開）
- **修法**：
  1. 確定哪台是「對的」（資料較新較完整）
  2. 在錯的那台、設定頁「資料備份/還原」→ 匯入「對」的那台最近一份 backup JSON
  3. ⚠️ 匯入會**完全覆蓋**既有資料、確定沒救才用

### 4.3 同步檔路徑不一致（路徑遷移）

- **症狀**：跨機切換 dataRoot 後、IndexedDB 內 sourceFolder 還指舊路徑
- **修法**：設定頁「路徑遷移」區、按「執行遷移」（自動把 IndexedDB 內 sourceFolder / consentPdfPath 改寫到新 dataRoot）

---

## 5. 照片 / HEIC / AI 一鍵填入

### 5.1 HEIC 不顯示（破圖）

- **症狀**：iPhone 拍的 .HEIC 在 Chrome 看不到、灰色破圖
- **原因**：Chrome 不支援 HEIC 原生顯示
- **修法**：上傳前先轉 JPG：
  - iPhone 直接設：**設定 → 相機 → 格式 → 「相容性最佳」**（之後拍的都是 JPG）
  - 已拍的 HEIC：用「圖片」app 開 → 共享 → 「儲存為 JPG」
- **預防**：診所拍照前先把全部 iPhone 改成「相容性最佳」

### 5.2 AI 一鍵填入噴「沒設 ANTHROPIC_API_KEY」

- **症狀**：按「📷 AI 自動分類」紅字
- **原因**：開發機 `.env` 沒設 API key
- **修法**：開發機根目錄 `.env`：
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  重啟 App（黑色 PS 視窗關掉重開）
- **注意**：診所機（master）**刻意關 AI 功能**、不該設 key（避免診所端產生 API 費用）

### 5.3 AI 一鍵填入「413 too large」

- **症狀**：分類過程中噴 413
- **原因**：傳給 Anthropic API 的 base64 圖片總量 > 32 MB
- **修法**：v0.3.x+ helper 已自動 sharp resize 到 1024px、不該再撞。若還撞 → 一次拍少張一點、或回報皇后
- **預防**：已內建 resize、無需主動處理

---

## 6. Helper service

### 6.1「本機 helper 沒回應」

- **症狀**：很多動作（掃描、同步、AI 分類）都噴這
- **原因**：localhost:8765 沒服務 / 黑色 PowerShell 視窗被關
- **修法**：
  1. 看工作列、是否有黑色 PowerShell 視窗在跑（標題 `aligner-tracker helper`）
  2. 沒有 → 雙擊桌面【隱形矯正追蹤】捷徑，會自動起 helper
  3. 有 → 看視窗內有沒有 `ERROR` / `EADDRINUSE`
- **預防**：每天開診所第一件事點桌面捷徑、不要關黑色視窗

### 6.2「port 8765 已被佔用」

- **症狀**：helper 起不來、視窗噴 `EADDRINUSE` 或 `listen EADDRINUSE: address already in use :::8765`
- **原因**：之前 helper 沒關乾淨、process 還在
- **修法**：開另一個 PowerShell：
  ```powershell
  Get-NetTCPConnection -LocalPort 8765 | Select-Object OwningProcess
  Stop-Process -Id <上面顯示的 ID> -Force
  ```
  然後重啟桌面捷徑

---

## 7. PWA / 顯示

### 7.1 推了新版本、App 還是舊樣子

- **症狀**：標題版本還是舊的、看不到新功能 / 新欄位
- **原因**：PWA service worker 快取了舊 bundle
- **修法**：在 App 視窗按 **Ctrl + Shift + R**（強制重整 + 清快取）
- **預防**：每次更新後習慣按一下

### 7.2 設定頁 / 病患頁載入超久 / 卡住

- **症狀**：白屏 / 轉圈
- **修法**：
  1. F12 開 DevTools → Console 看紅字 error
  2. **Application** tab → **Service Workers** → Unregister → 重整
  3. 仍不行 → DevTools **Application** → **Storage** → Clear site data（注意：會清 IndexedDB、清前先匯出 backup！）

---

## 8. 病患資料疑似遺失 / 救援

### 8.1 看不到某病患 / 病患列表變空

- **不要慌、先做這個**：
  1. 設定頁「資料備份/還原」→ **先按「匯出」** 把當下狀態存一份（萬一接下來操作搞錯、還有回頭路）
  2. 看設定頁「跨機同步」狀態、是不是同步檔指到別人的 dataRoot
  3. 看 `<dataRoot>\app-backups\` 內最近的 `pre-switch-*.json` — 那是更新前自動存的

### 8.2 從 backup 還原

- 路徑：`<dataRoot>\app-backups\pre-switch-(from)-to-(target)-(時間).json`
- 設定頁「資料備份/還原」→「**匯入**」→ 選 JSON
- ⚠️ 匯入會**完全覆蓋**既有資料 — 確定當前狀態救不回再用

### 8.3 git reflog 救 master 機誤 reset

- 若 update.ps1 自動 reset 砍掉了主上手改的東西（理論上不該、master 不寫 code，但萬一）：
  ```powershell
  cd C:\dev\矯正追蹤-app
  git reflog                  # 看歷史 HEAD 列表
  git reset --hard HEAD@{1}   # 回到上一個 HEAD
  ```

---

## 附：日常自我檢查（建議每月一次）

- [ ] 設定頁「資料備份/還原」→ 匯出一份 backup、存到 NAS / 外接硬碟
- [ ] `<dataRoot>\app-backups\` 內超過 3 個月的舊 backup 可清掉（保留最近 3 個月）
- [ ] 樓上樓下兩台都按一次「同步現在」確認沒分歧
- [ ] App 版本（設定頁頂部 / 標題列）跟 GitHub 最新 tag 對齊（差太多就升）

---

_最後更新：見 git log。要更新這份文件、丟錯誤截圖給皇后說「TROUBLESHOOTING.md 加一條：XXX」。_
