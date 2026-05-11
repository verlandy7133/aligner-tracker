# Changelog

## v0.1.10 — 2026-05-07

照片編輯（旋轉 / 翻轉）+ 人像 4 框 + 照片筆記順序對調。

### 新增

- **人像 4 個 slot（portrait group）**：總 slot 數 8 → 12
  - 正面（休息）/ 正面（微笑）/ 側面（右）/ 側面（左）
  - 按 group 分區排版：人像 → X-ray → 口外 → 口內
- **照片簡單編輯**（純前端 CSS transform、不動原檔）
  - 點照片右上 ✎ 開編輯 modal、即時 preview
  - 順時針 / 逆時針 90° 旋轉、水平 / 垂直翻轉、一鍵還原
  - 編輯設定存進 IndexedDB `PhotoMeta`、跟著 sync.json 同步到其他機
- **「照片在上 / 筆記在下」順序對調**（v0.1.9 是反的）

### 資料模型

- `photos` value 從 `string`（檔名）升級成 `PhotoMeta`：`{ filename, rotate?, flipH?, flipV? }`
- **Dexie schema 升 v7**：upgrade callback 自動把舊 string 包成 `{ filename: string }`、不需手動 migrate
- 加 `PhotoSlotGroup` type + `PHOTO_GROUP_LABEL` map

### 設計筆記

- **「純前端 transform」而非「server-side 處理」**：避免動原檔、不用裝 sharp / PIL、跨機同步不用搬處理過的圖檔、只搬 metadata
- **旋轉 90/270° 圖會被 4:3 框裁切**：暫用 `scale: 0.75` 折衷縮小、未來 v0.1.11 可改 dynamic aspect ratio
- **更進階的編輯（crop / brightness / contrast / 標註）**留之後
- **HEIC 顯示**：Chrome 仍有問題、未做轉檔（延到下版）

### 已知問題

- HEIC 在 Chrome 顯示不出來（Safari ok）
- markdown render preview 還沒做（純 textarea）
- PDF case report 匯出還沒做
- AI 智能填入還沒做

## v0.1.9 — 2026-05-07

病患筆記 + 8-slot 病歷照片（從病患資料夾選照片、不複製檔案）。
完整 hybrid plan 三波的第一波，今天先做 1a + 2a-i + 2b-B；下一版做 PDF 匯出（2a-ii），再下一版做 AI 智能填入（2b-C）。

### 新增

- **病患筆記區塊**（PatientDetailPage 詳細頁底下、下單紀錄上面）
  - markdown 風格 textarea、`monospace` 字型、auto-save（停止輸入 0.5 秒）
  - 預期之後接 react-markdown render preview（這版先 plain text）
  - 寫入 `patient.markdownNote`
- **8-slot 病歷照片 grid**：對齊一般矯正 case report 標準 8 view
  - Panoramic / Cephalometric (X-ray)
  - Front Closed / Front Open (extraoral)
  - Left Closed / Right Closed / Upper Occlusal / Lower Occlusal (intraoral)
  - 點空 slot → 列病患資料夾所有圖片 → 選一張綁定
  - 點有照片 slot → 「換」/「✗」hover actions
  - 已被其他 slot 使用的圖會標 amber 「已用」徽章（不擋、提示）
  - 寫入 `patient.photos[slot] = 相對檔名`（不複製檔案、只記檔名）
- **helper 加 2 endpoints**：
  - `GET /list-folder-files?folder=&types=`：列指定資料夾下所有圖片檔（預設 jpg/jpeg/png/heic）
  - `GET /serve-image?path=`：串本機圖片 binary + 適當 Content-Type + 5min Cache-Control
- **`getImageUrl(absPath)` helper-client wrapper**：產出 `<img src=...>` 用的 URL
- **`listFolderFiles()` wrapper**：對應上面 endpoint

### 資料模型

- `Patient` 加 `markdownNote: string` + `photos: Partial<Record<PhotoSlot, string>>`
- `PhotoSlot` 8 個 enum + `PHOTO_SLOTS` 設定表（含中文 / 英文 label + 分組）
- **Dexie schema 升 v6**：upgrade callback 補舊資料預設值（`markdownNote = ''`、`photos = {}`）
- `scan-aligner-folders.mjs`、`PatientFormModal.tsx`、`reapply-excel.ts` 都同步補預設值

### 設計筆記

- **照片不複製、只記檔名**：避免 IndexedDB 爆 + 沒有同步成本。照片實體還是在 NAS 病患資料夾、App 只記「哪個檔名綁哪個 slot」
- **HEIC 顯示**：helper `/serve-image` 設 Content-Type `image/heic`、現代 Safari 直接顯示；Chrome 對 HEIC 不友善，可能要 v0.1.10 加伺服器端轉檔
- **沒 sourceFolder → 顯示提示**：病患如果還沒設資料夾、photo grid 區顯示 warning 引導去點「📁 開資料夾」先建立
- **跨機 sync**：markdownNote + photos 自動跟著 `backup.ts` exportBackup / importBackup 走 sync.json，不用額外處理

### 已知問題

- markdown render preview 還沒做（這版純 textarea）→ v0.1.10
- HEIC 在 Chrome 顯示不出來 → v0.1.10 helper 加 on-the-fly HEIC → JPG 轉檔
- PDF case report 匯出還沒做 → v0.1.10（2a-ii）
- AI 智能填入還沒做 → v0.1.11（2b-C）

## v0.1.8 — 2026-05-07

選版本更新 + 切版前自動備份。

### 新增

- **設定 → App 更新 改成 dropdown 選版本**：列所有 git tag（v 開頭、按 semver desc）+「最新 main」一個選項
  - 顯示當前 HEAD short hash + 當前 tag（detached or tagged）+ origin/main short hash
  - 按鈕文字會根據選擇變化：`⬆ 升到最新 main` / `⬆ 切到 v0.1.X` / `⬇ 退回 v0.1.X` / `✓ 已是此版本`（disabled）
  - 退版按鈕 amber 色、升版 / 切換 sky 色、視覺區分
  - 跨版本 IndexedDB schema 風險用 confirm dialog 提示
- **切版前自動匯出 backup**：寫到 `${dataRoot}\app-backups\pre-switch-{from}-to-{target}-{timestamp}.json`
  - 切版失敗也保留備份檔位置 → 用戶可手動「資料備份 / 還原」匯入回來
- **helper 加 2 個 endpoints**：
  - `GET /list-tags`：回 `{ tags, currentHash, currentTag, latestMain }`、master only、自動 `git fetch --tags origin`
  - `POST /write-backup?name=*.json`：寫到 `${dataRoot}/app-backups/`、master only、檔名嚴格驗（只允英數._-）
- **`runUpdate(ref?)` 接 optional ref**：helper `/run-update?ref=v0.1.5` → update.ps1 `-Ref v0.1.5`
- **update.ps1 加 `-Ref` flag**：
  - 沒帶 → 跑 `git pull origin main`（升 latest，舊行為不變）
  - 帶了 → 跑 `git fetch --tags origin && git reset --hard <ref>`（切到指定版本）
  - 標題會改顯示「切換版本」/「升到最新」、加目標版本標示
  - 嚴格 ref 格式驗證（只允許英數._/-）防 shell injection

### 設計筆記

- **「切版 = 必須 npm install + build」**：跨版本可能 package-lock 變動 → update.ps1 用 `git diff <before> <after> --name-only` 偵測 package.json 變化才跑 install，build 一定跑（dist/ 必更新）
- **detached HEAD 不擔心**：`git reset --hard <tag>` 不進 detached、main branch 直接指到該 tag。下次 `git fetch` 會看到 behind/ahead 計數
- **跨版本 schema 風險**：v0.1.4 之後（含 track + refinementLevel）跨版相容；跨 v0.1.4 可能炸 Dexie。用 confirm dialog + 自動 backup 雙保險
- **master only**：follower 三個 endpoint（list-tags / write-backup / run-update）都擋下、UI 也不顯示按鈕

## v0.1.7 — 2026-05-05

NAS-ready 跨機同步基礎建設。樓上樓下兩台 Windows 機共用 NAS 上的 sync.json。

### 新增

- **路徑設定 section**（設定 → 路徑設定）
  - `dataRoot`（資料根目錄）+ `syncFile`（跨機同步檔位置）兩個欄位
  - master only 可改、follower 唯讀顯示
  - 寫入 `dev-data/clinic-paths.json`（git-ignored、各機獨立）
  - NAS 來了改成 `Z:\矯正追蹤` + `Z:\矯正追蹤\sync.json` 即可
- **跨機同步 section**（設定 → 跨機同步）
  - 「📤 推到 NAS」一鍵把整個 IndexedDB 序列化寫到 NAS sync.json（同 backup 格式）
  - 「📥 從 NAS 拉」讀 NAS sync.json 預覽 + 確認後 importBackup 覆寫本機
  - 顯示 NAS 修改時間 / 檔案大小、本機上次推送 / 拉取時間
  - 自動偵測「NAS 比本地新」 → 紅色 pulse 徽章「● NAS 有新版」+ 拉按鈕變紅
- **Nav 紅點提示** — App 啟動 + window focus 時呼叫 `/sync-stat`，NAS 有新版時 ⚙ 設定旁長出紅點
- **helper 加 4 個 endpoints**：
  - `GET /paths` 讀路徑設定
  - `POST /paths` 寫路徑設定（master only）
  - `GET /sync-stat` 回 syncFile mtime / size
  - `GET /sync-read` 串流 sync.json 內容
  - `POST /sync-write` 原子寫 sync.json（先寫 .tmp 再 rename）
- **`scan-aligner-folders.mjs` 接 `ALIGNER_DATA_ROOT` env** 或讀 clinic-paths.json，從寫死 `D:\矯正` 改成可設定路徑

### 修正 / 重構

- **helper service 動態 allowlist** — ALLOWED_ROOTS 從寫死改成從 clinic-paths.json 動態組（dataRoot + syncFile dir + dev folder + 向後相容 fallback）
- **helper `/role` 多回 syncFile** 給前端 hint
- **5 個 sync 相關 helper-client wrappers** + TS types（`getPaths` `savePaths` `syncStat` `syncRead` `syncWrite`）

### 設計筆記

- **「不會同時用」前提**：紅點偵測用「NAS mtime > max(lastPushed, lastPulled) + 5s」單純比對，不做 conflict resolution。樓上樓下不會同時編輯就不會打架
- **原子寫保護**：sync-write 先寫 `sync.json.tmp` → rename，避免另一台讀到半寫狀態
- **NAS 路徑生效時機**：路徑設定改完要重啟 helper 才會 100% 生效（部分 endpoint 每次重新讀 cfg 但 console log 只啟動時印一次）

### 已知問題

- 路徑設定改完當下，後續同 endpoint 立刻生效（每 request 重讀 cfg），但 helper console 印的是啟動時的舊值 — 視覺干擾、不影響功能
- 53 筆 Excel-only 諮詢病患（無資料夾）birthday 仍 null

## v0.1.6 — 2026-05-05

Excel takeover 流程 + 下單追蹤完整化 + UI 細修。

### 新增

- **Excel takeover 改單檔兩 sheet**：`scripts/import-clinic-takeover.py` 取代舊 `import-excel-orders.py` + `import-supplementary-orders.py`
  - 自動偵測 `D:\矯正\下單Excel\` 底下的 takeover 檔
  - Sheet 1「生產資料庫」= 一人一列病患總表
  - Sheet 2「牙套下單」= 一筆一列下單明細
  - 比舊版乾淨：流程簡化、不會再忘記跑哪一支
- **App 內掃 Excel 按鈕**：「設定 → 掃描 Excel」呼叫 helper `/scan-excel` → 自動 spawn python 重 import + 重新 derive chartNo
- **第一次下單也算下單追蹤**：sheet 1 的「送出設計檔 X/Y」row 視為第一筆 order
  - 新進度狀態 `設計中`（violet badge）
  - 新 regex `(\d{1,2})/(\d{1,2})\s*送出設計檔` 抓日期
  - 結果：order 數 414 → 470（+56 第一次下單）
- **資料夾名生日回填**：「設定 → 從資料夾名補生日」掃所有 patient.birthday=null → 找同名資料夾 → 解析民國 YYMMDD/YYYMMDD → 自動填回
  - 新 helper endpoint `/list-folder-names`
  - 新 lib `parse-folder-name.ts`（4 種 patterns、status prefix strip、民國轉 ISO）
- **下單追蹤升降冪切換**：依日期 view 加 ↑↓ 按鈕（在篩選 row 最右邊）
- **開發機 (follower) 也能掃資料夾**：`/rescan-folders` 取消 master-only 限制，開發機可預掃驗證

### 修正

- **`parse_aligner_range` bug**：之前無 UL/L match 時返 `(full_text, '')`，把非下單 row 也當下單 → order 數虛高 559。改返 `('', s)`，rng 為空才正確判定為非下單 row
- **`OrderTracking.tsx` 月度統計 / `OrderReportPage.tsx` 加「設計中」欄**

### 已知問題

- 53 筆 Excel-only 諮詢病患（沒有實體資料夾）birthday 仍 null，需要補建資料夾後才能回填
- Stage B「App 點選結束自動 rename 加 [結束] 前綴」尚未實作（changelog v0.1.2 已知問題持續）

## v0.1.5 — 2026-05-04

筆電 master 部署 + UI 自助化。整個 session 圍繞「讓 master 端可自更新、自調 UI」這條線。

### 新增

- **App 內更新機制**：「設定 → App 更新」section（master only）
  - 「🔍 檢查更新」呼叫 helper `/check-update` → git fetch + 比 HEAD vs origin/main
  - 「⬆ 立即更新 (N 個 commit)」呼叫 helper `/run-update` → spawn update.ps1 -Silent
  - 完成提示重整 PWA、details 可展開看 stdout
  - follower 自動隱藏按鈕 + 顯示提示
- **字級可調 UI scale**（85% ~ 150%、5% 步進、5 個 preset）
  - 改 root `font-size`、Tailwind 所有 rem utility 自動 scale
  - 即時生效、自動存 IndexedDB（key='ui-scale'）、App 啟動時 initScale() 套用
- **詳細頁自動建資料夾**：📁 按鈕沒對應實體資料夾就 prompt 建立
  - 從生日 + 姓名推 conventional path（民國YYMMDD姓名）
  - helper 新 endpoint `/create-folder`（master only、allowlist 守門、recursive mkdir）
  - 建完自動 persist 到 IndexedDB sourceFolder、下次點不再問
  - 沒生日時 alert 提示先填生日
- **桌面捷徑工具**：`scripts/make-shortcuts.ps1` 一鍵建啟動 + 更新 兩個捷徑
  - 用 `public/icon.ico` (multi-size 16~256) 替換之前的 PNG → 桌面 icon 不再糊
  - 「更新」捷徑用 shell32.dll,238 雲端 icon、跟啟動 icon 視覺區分
- **`update.ps1 -Silent` flag**：給 helper service 自動化用、跳過所有 Read-Host

### 修正

- **production build 可 seed**：之前 `seed.ts` 有 `if (!DEV) return`，vite preview 下完全不 seed → 部署到筆電後清空 DB 不會自動填回。改成 dev/prod 都跑（dev-data JSON 在 build 時 vite 自動 bundle 進 dist）
- **installer.ps1 不被 stderr warning 中斷**：PS 5.1 + `2>&1` + `ErrorActionPreference='Stop'` 三件事互動，npm warn deprecated 直接讓 installer 中斷；改成暫時切 Continue + 用 `$LASTEXITCODE` 判定
- **build-distributable.mjs 只搬新位置**：之前打包 `D:\矯正` 全部搬（含舊三層位置 60GB），現只搬 `病患資料夾/` + `病患授權書/`，bundle 從 ~120GB 縮到 61GB
- **build-distributable.mjs APP_VERSION** 從 package.json 動態讀
- **`PatientFormModal.tsx` 編譯錯誤**：payload 缺 track / refinementLevel（v0.1.3 拆兩軸時沒同步）
- **`progress.ts` 移除未使用的 diffDays / MS_PER_DAY**（前次重寫 startDate 邏輯時遺留）
- **`DebugPanel.tsx` 移除 'not-dev' reason** 殘留（v0.1.4 在 SeedResult 拆掉但漏改 panel）
- **依日期 view 排版**：原本 table 沒 wrapper、`overflow-hidden` 截掉欄；改 table-fixed + colgroup 鎖死欄寬，備註欄吸光剩餘空間
- **病患列表 filter row 縮成 2 行 + 警示** + filter label 字級放大
- **病患列表年齡 / 進度 / 下次回診 / 品牌 改置中對齊**

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
