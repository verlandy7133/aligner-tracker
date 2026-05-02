# Changelog

## v0.1.4 — 2026-05-02

病患列表 UI 微調。

### 修正

- **filter row 縮成 2 行 + 警示 1 行**（原本 5 行佔太多空間）：
  - Row 1: 狀態 + 品牌
  - Row 2: 設計 + 精調
  - Row 3: 警示
- **filter row label** 字級 12px → 14px、加粗、顏色 zinc-500 → zinc-300（更顯眼）
- **品牌欄居中對齊**（跟年齡 / 進度 / 下次回診 / 授權書一致）

## v0.1.3 — 2026-05-01

UI 細修 + 狀態系統重構（拆成兩軸：臨床狀態 / 設計+精調）+ 接續療程友善的進度計算 + 一鍵更新.bat。

### 新增

- **一鍵更新.bat**（`scripts/update.ps1` + 根目錄 `更新.bat`）：master 端雙擊就 git pull + npm install (依需要) + npm run build。follower 模式拒跑（開發機從這邊 push、不該反向 pull）。
- **詳細頁 4 顆按鈕**：✎ 編輯 / 📁 開資料夾 / 📄 開授權書（有檔才顯示）/ 📋 開指示單（動態 readdir 找 PDF）。helper 新 endpoint `/find-and-open?folder=&pattern=` 給「指示單」這類動態文件。
- **副數進度卡 4 格時間摘要**：一副要帶 / 已進行 / 剩餘 / 預計總療程。
- **狀態系統拆兩軸**：
  - PatientStatus 砍回 4 個值（active / paused / completed / transferred-out），refinement-X 不再放這
  - 新增 `track`：'new-design' | 'old-design' | null（第一筆 order batchType 決定）
  - 新增 `refinementLevel`：0-3（第二筆+ 又出現「新設計/新設計1」的次數）
- **PatientList filter row × 3** 全多選：狀態 / 設計 / 精調。狀態欄顯示 badge 串。
- **分頁標題**：`--app` → `矯正追蹤系統`。
- **nav 版本號自動跟隨 package.json**（vite define `__APP_VERSION__`），未來 bump 不用改兩處。

### 修正

- **接續療程的進度計算**：放棄 startDate/orderDate，改用實際 current 副數推算（已進行 = max(current) × cycleDays / 30）。對接續/精調病患不再誤判。
- **移除「預計到第 N 副 / 超前 / 落後」**：接續療程會誤判，UI 拿掉。
- **DEFAULT_CYCLE_DAYS 從 10 改 14**（兩週符合臨床慣例）。
- **chartNo 重編**：seed.ts 在 import 完後按 earliest orderDate ASC 編，解決 0137/0139 撞號。
- **seed 完從 orders 推 currentAligner**：之前要點「重新套用 Excel」才會推算、副數進度條不顯示，現在 fresh seed 就 work。
- **cycleDays 預設值同步**：types/scan/import-excel/import-supp 4 處統一 14。
- **PatientList 表格對齊**：年齡 / 進度 / 下次回診 / 授權書 改置中。
- **PatientList filter useMemo deps bug**：trackFilter / refinementFilter 沒進 deps，filter 改不更新，已補上。

## v0.1.2 — 2026-05-01

兩台機器架構正式化 + 病患資料夾扁平化 + 全 IndexedDB 重建。為了讓筆電變正式 master、開發機降為 follower，這版做了基礎建設。

### 新增

- **Master / Follower 角色機制**：
  - `dev-data/clinic-role.txt` 每台機器寫 `master` 或 `follower`（不存在預設 follower 防誤動）
  - master = 持有真實 `矯正/` 資料夾、可掃描；follower = 只能透過 backup JSON 還原
  - 守門 3 層：`scan-aligner-folders.mjs` CLI 拒跑 / helper `/rescan-folders` 回 403 / UI Settings 按鈕 disable + 顯示指引
  - helper 新 endpoint `GET /role` 回 `{role, drive, dataRoot, scanFolder, scanFolderExists}`
- **病患資料夾扁平化**：原本三層巢狀（月份 / 日期 / 病患 + 6 個狀態類資料夾）改為 `D:\矯正\病患資料夾\` 單層，狀態用前綴標：`[結束]` `[中斷]` `[隱適美]` `[綻雅]` `[維持器]` `[待確認]`，活躍無前綴
- **scan v2** (`scripts/scan-aligner-folders.mjs` 重寫)：從前綴讀 status / productLine，不再需要 CATEGORY_MAP / 月份-日期推算邏輯
- **chartNo 重編機制** (`src/seed.ts`)：所有 import 完成後依 earliest orderDate ASC 重編，並同步更新 `patient.orderDate` + `order.patientChartNo`

### 一次性遷移腳本（已執行完畢，保留供參考 / 未來新部署用）

- `scripts/build-flat-patient-folder.mjs`：從舊扁平結構複製到新位置 + 加狀態前綴（含 dry-run + 衝突合併）
- `scripts/patch-completed-folders.mjs`：補修 `矯正結束/` 多嵌套一層 YYYYMMDD 的 bug
- `scripts/normalize-name-date-order.mjs`：「姓名+日期」格式改成「日期+姓名」（11 個資料夾）
- `scripts/merge-zhang.mjs`：張家婷活躍 + 結束資料夾合併（同人多階段）

### 已知問題

- 還沒做：App 點選「矯正結束」時自動把資料夾 rename 加 `[結束]` 前綴（需要 helper `/rename-folder` endpoint + Patient form change handler，留 v0.1.3）
- `DEPLOYMENT.md` 文件還寫舊的 `口掃檔 取資料 下單/` SOP，需要更新成 `病患資料夾/`

### 部署 SOP（master 第一次上線）

1. 建 `dev-data/clinic-role.txt` 寫 `master`
2. 跑 `node scripts/scan-aligner-folders.mjs` 產 `patients-import.json`
3. 跑 `python scripts/import-excel-orders.py`（用 `PYTHONIOENCODING=utf-8` 避免 cp950 print crash）
4. 跑 `python scripts/import-supplementary-orders.py --apply`
5. 開 App → 設定 → 清空 DB → 自動 reload + seed

## v0.1.1 — 2026-04-27

跨機部署修正版本。從主上把整個系統複製到一台只有 C 槽的筆電試用時，發現一連串路徑寫死 D: 的雷，這版本一次處理完。

### 修正

- **`scripts/installer.ps1`**：自動偵測安裝目標碟（優先 D，否則用 SystemDrive，C 通常）。原本寫死 `D:\dev\矯正追蹤-app` 跟 `D:\矯正` 在 C 槽機器會 fail。
- **`scripts/installer.ps1`**：加 `--legacy-peer-deps`。原因：vite 8 vs vite-plugin-pwa 1.2 / @tailwindcss/vite 4.2 peer 衝突，新版 npm 嚴格 resolve 會直接 fail。等 plugin 升級後可移除。
- **`scripts/installer.ps1`**：移除 `--silent | Out-Null`，npm 失敗時印出真實錯誤 + log path（之前完全靜默看不到原因）。
- **`scripts/folder-helper.mjs`**：`ALLOWED_ROOTS` 改為依當前 DRIVE 動態組（同 installer 邏輯）。
- **`scripts/folder-helper.mjs`**：`/open-folder` `/open-file` 加 path remap — 收到 `D:\矯正\...` 但本機沒 D 槽時，自動 rewrite 開頭碟符。**這是這版本的核心**：避免要回去修 backup JSON 內 823 個寫死路徑。
- 編碼修正：所有含中文的 `.ps1` 檔存成 UTF-8 with BOM，避免 Windows PowerShell 5.1 在系統 ANSI codepage 環境誤解 UTF-8 多位元組成 `??` 等假 token。

### 已知問題（待 v0.1.2）

- Backup JSON 內 `sourceFolder` / `allSourceFolders` / `consentPdfPath` 仍寫死 D: — folder-helper 端有 remap 但前端 UI 顯示的還是 D: 路徑（誤導但不影響功能）。
- `dev-data/patients-import.json` 未動，內含 D: 路徑（只在重新 scan 病患資料夾時有用）。
- `安裝.bat` UTF-8 BOM 在跨機傳輸時可能被某些工具加上 → 前 3 個 byte 吃掉 cmd 命令名 → 解法：直接 `powershell -ExecutionPolicy Bypass -File 安裝\install.ps1` 跳過 `.bat`。

### 重新 build + deploy 步驟

D 機器（主機）：
```
cd D:\dev\矯正追蹤-app
npm run build
node scripts\build-distributable.mjs
```

→ 產生新版 `D:\隱形矯正追蹤系統\` bundle。再把 bundle 整包複製到目標機器跑安裝即可。

## v0.1.0 — 2026-04-23

初始版本。
