# Changelog

## v0.4.0 — 2026-05-13

**版本規則修正 — patch ≥ 16 該 minor bump、不可一路 patch。**

### 背景

主上之前定過「版本超過 15 就進一位」規則（patch 上限 15、下一個改動跳 minor）。
今天早上→中午連推 v0.3.16 → v0.3.17 → v0.3.18 → v0.3.19 → v0.3.20 → v0.3.21、全部違規。
主上在 v0.3.21 後糾正。

### 處理方式

- 不動已 ship 的 v0.3.16 ~ v0.3.21 tag（樓上筆電已拉、git history 完整不重寫）
- 把這 6 個 patch 視為「v0.4.0 應該累積的內容」、結算成 v0.4.0
- v0.4.0 內容 = 此 commit + 已 ship 的 v0.3.21 完全相同（無新功能）
- 下一個改動 → v0.4.1（v0.4.0 → v0.4.15 才會跳 v0.5.0）

### 累積內容（從 v0.3.16 起）

- v0.3.16: update.ps1 自動清 dirty + python deps（解筆電更新失敗）
- v0.3.17: 同名病患統計（read-only 列表）
- v0.3.18: 同名病患一鍵合併（transactional）
- v0.3.19: sourceFolder 健檢（dead link 偵測）
- v0.3.20: 健檢自動修復（用 allSourceFolders）+ 病患詳細頁手動編輯路徑
- v0.3.21: 匯出備份同時寫 NAS（manual-{date}.json）

詳見各 patch 版本 entry。

## v0.3.21 — 2026-05-13

匯出備份同時寫一份到 NAS、不只本機下載。

### 變動（`BackupSection`）

- **「⬇ 匯出備份」按下後做兩件事**：
  1. 本機瀏覽器下載（原本行為）
  2. 透過 helper 寫一份到 `<資料根>\app-backups\manual-{ISO 時間}.json`
- NAS 寫入是 best effort — 失敗不擋本機下載、只在結果訊息顯示警告
- 結果訊息分兩行 ✓ 顯示「本機路徑」+「NAS 路徑」、或對應 ⚠ 警告
- 更新說明文字明確標示 NAS 備份位置

### 為什麼

樓上樓下兩台機、原本「匯出備份」只能下載到當前操作的那台筆電本機。
跨機協作下、user 經常忘記把本機下載的 backup 上傳到 NAS 共享、
NAS 上只有 update 切版時的 `pre-switch-*.json` 自動備份。
這版讓手動備份也一起進 NAS、之後恢復不論在哪台都看得到。

### 命名 convention

- `pre-switch-{fromVer}-to-{target}-{date}.json` — update.ps1 切版本前自動寫（v0.3.x+）
- `manual-{date}.json` — 此版新增、user 按「⬇ 匯出備份」時自動寫

## v0.3.20 — 2026-05-13

修補：合併後 sourceFolder 沒升級到活路徑、加自動修復 + 手動編輯入口。

### 背景

v0.3.18 合併功能上線後、主上把 0371（活路徑 W:）合進 0361（死路徑 D:）。
原邏輯「保留 target、source 補空」對 sourceFolder 不適用 — target 的可能是舊死路徑、
source 的才是新活路徑。0371 的活路徑被丟進 0361.allSourceFolders 但沒被升級成主 sourceFolder。

### 新增

- **sourceFolder 健檢加「✨ 自動修復」**（在 `SourceFolderHealthSection`）：
  - 第二階段檢查：對每筆 dead sourceFolder、查該 patient 的 `allSourceFolders` 內是否有活路徑
  - 找到 → 列出修復候選（顯示 ✗ 舊死路徑 → ✨ 新活路徑）
  - 「⚡ 一鍵全修復」批次套用所有候選
  - 每筆也有「✓ 修這筆」單獨按鈕
  - 修復後 sourceFolder 改為活路徑、原死路徑保留在 allSourceFolders（隨時可切換）
- **dead link 列表加「✨ 可修」標記**：在有自動修復候選的那筆顯示
- **病患詳細頁加 sourceFolder 編輯入口**（`PatientDetailPage`）：
  - 主路徑旁加 ✏ 按鈕 → prompt 輸入新路徑
  - 顯示 `allSourceFolders` 歷史路徑列表 + 每條的「✓ 設為主」按鈕
  - 手動 fallback：自動修復找不到時、直接貼新路徑

### 使用流程（解 0361 程瑾恩 case）

1. 樓上筆電升 v0.3.20
2. 設定頁 → 「sourceFolder 健檢」按掃描
3. 若 0361 有 `allSourceFolders = ['D:\矯正\...', 'W:\0矯正追蹤\...']`、
   而 W: 那條 alive → 會出現 ✨ 自動修復候選
4. 按「⚡ 一鍵全修復」→ 0361.sourceFolder 升級到 W: 路徑 ✓
5. 找不到自動修復 → 進病患詳細頁手動 ✏ 編輯

## v0.3.19 — 2026-05-13

加 sourceFolder 健檢、找「指向不存在」的死路徑。

### 背景

v0.3.18 的同名病患統計列出多筆 `C:\矯正\...` 舊路徑（dataRoot 已改成 NAS `W:\0矯正追蹤\` 但 sourceFolder 沒同步）。
跑「路徑遷移」改 prefix 後、可能還有些路徑指到「改過名 / 移過位置 / 刪掉」的資料夾。
需要工具批次檢查實際存在性。

### 新增

- **helper endpoint `POST /check-paths`**：批次接受 path[]、回 { results: { [path]: bool } }
  - 走 path remap（W:\0矯正追蹤\... → /data/... 等）、但不過 allowlist（健檢就是要看歷史路徑）
- **`helper-client.checkPaths()`**：對應 client function
- **`SourceFolderHealthSection`** 加在設定頁 DuplicateName 後面
  - 按「🩺 立即掃描」→ 列 4 個統計（總數 / 掃描路徑 / 死路徑 / 無 sourceFolder）
  - 分兩類列：🔴 sourceFolder 死、🟡 consentPdfPath 死
  - 每筆可點 chartNo 跳病患詳細頁手動修
  - 提示處理方法 + 常見原因

### 使用順序建議

1. 先跑「**路徑遷移**」把所有 prefix 統一（C:\矯正\ → W:\0矯正追蹤\）
2. 再跑「**sourceFolder 健檢**」找 prefix 對但實際資料夾不存在的死指向
3. 死指向通常是診所在 NAS 改了資料夾名 → 進病患詳細頁手動改 sourceFolder

## v0.3.18 — 2026-05-13

「同名病患統計」加一鍵合併功能。

### 背景

v0.3.17 列出疑似重複後，主上反映：「資料夾名打錯造成的兩筆、我把資料夾名改好了、但 App 內還是兩筆」。
資料夾改名 ≠ IndexedDB 內 patient 改名，需要 App 提供合併動作。

### 新增

- **`lib/merge-patients.ts`**：transactional merge
  - 把 source 的所有 `order.patientId` 轉到 target（同步更新 denormalized patientChartNo / patientName）
  - target 空欄位從 source 補：birthday / doctor / scanInfo / totalAligners* / hasConsent / consentPdfPath
  - notes / markdownNote 直接 concat、加分隔行標記來源
  - allSourceFolders 把 source 的資料夾路徑加進去（保留歷史足跡）
  - 最後刪除 source patient
  - **不動的欄位**：photos / sourceFolder / chartNo / track / refinementLevel（避免破壞 target 已編輯）
- **`DupGroupCard` 加合併 UI**：
  - 每組右上「🔗 合併此組」按鈕進入合併模式
  - 每筆出現 radio button，勾「保留」那筆
  - 按「執行合併」→ confirm dialog 列出要保留 / 要刪 / 要轉的 order 數 → 執行
  - 完成顯示綠色卡片、列出轉移筆數 + merge 了哪些欄位
- 更新文案、提醒先做 backup（不可復原）

## v0.3.17 — 2026-05-13

設定頁加「同名病患統計」section、幫助找 dedup miss 造成的重複病患。

### 新增

- **`DuplicateNameSection`**：掃 IndexedDB 全 patient、依姓名分組找同名
- **分兩類顯示**：
  - 🔴 **疑似重複**：同名 + 同生日 OR 同名 + 至少一筆缺生日（dedup miss、該處理）
  - 🟡 **同名巧合**：同名但每筆生日都不同（真不同人、不用處理）
- **每組可展開**：列每筆 chartNo / 生日 / 醫師 / sourceFolder
- **點 chartNo 跳病患詳細頁**（用 react-router Link）
- 含「疑似重複處理建議」4 步驟手動 merge 流程說明

### 背景

v0.3.14 推完後在筆電發現 `0001/0363 蘇茁濼`、`0002/0364 鄧宛唏` 等同名雙筆。
root cause：早期 seed 按「最早下單日」編 chartNo (0001-0009)、後期資料夾掃描補進的用 placeholder chartNo (0300+)；
dedup key `name+birthday` 在某些筆生日缺漏時 miss → 沒擋住、雙筆並存。

v1 不做一鍵 merge（避免誤砍歷史），只統計 + 跳轉。手動 merge 流程在 UI 說明。

## v0.3.16 — 2026-05-13

修 master 角色更新失敗的根本問題 + 補 python 套件自動裝。

### 背景

樓上筆電 v0.3.2 → v0.3.14 更新失敗（exit 1 in [0/3] working tree dirty）。
root cause：上次 npm install 自動改寫 `package-lock.json` → git 認為 dirty → 下次 update 直接卡。
這是**系統性問題**、不是偶發。master 角色契約是「不寫 code、只跑」、任何 tracked file 變動都是噪音。

### 變動（`scripts/update.ps1`）

- **step [0/3] 偵測 dirty 自動 reset**（不再 exit 1）
  - 列出 dirty 清單給看（透明度）→ 跑 `git -c core.autocrlf=false reset --hard HEAD` 自動清乾淨
  - 萬一砍錯、`git reflog` 仍可救前一個 HEAD
- **master 角色首次跑會設 `core.autocrlf=false`**
  - 消除 Windows 自動 CRLF 翻譯造成的跨機 line ending dirty
- **npm install 後自動補 python 套件**：`openpyxl` (Excel 匯入) + `pillow-heif` (HEIC 預覽)
  - 沒有 python 也不擋更新、只跳過

### 結果

- 之後樓上筆電按「更新到 main」**不會再卡 lockfile dirty**
- 之後新增 python import / heic 預覽功能、套件會跟著 update 一起裝、不用主上手動 pip install

## v0.3.15 — 2026-05-13

「掃描 Excel」+「重新套用 Excel」兩個 section 合併成單一「Excel 匯入」、一鍵到底。

### 變動

- **新增 `ExcelImportSection`** 取代原本的 `ScanExcelSection` + `ReapplyExcelSection` 兩塊
  - 主按鈕「📥 掃描並套用 Excel」：跑 python → 成功就接著套進 IndexedDB
  - 顯示分階段進度：「(1/2) 掃描中… → (2/2) 套用中…」
  - 任一步失敗就停在那步、紅色提示 + python log 可展開
- **進階折疊區「分開執行（debug 用）」** 保留兩顆獨立按鈕
  - 「📂 只掃描」— 產 JSON、不動 IndexedDB（看 python 輸出再決定要不要套）
  - 「⟳ 只套用」— 讀現有 JSON 套進 IndexedDB
- **修文案 bug**：「掃描 D:\\矯正\\下單Excel\\」(寫死路徑) → `<資料根>\下單Excel\`（跟實際 helper 邏輯一致）
  - 之前文案誤導 → 樓上筆電 user 以為要在 D:\ 開資料夾、實際 helper 找的是 `<dataRoot>/下單Excel`
- 移除 confirm 對話框（按到掃描的人就是要掃、不需要再問一次）

### 已知前置（外部依賴）

- 筆電 Python 要先裝 `openpyxl`：`python -m pip install openpyxl`
- `<資料根>` 底下要有 `下單Excel\` 資料夾、放含「生產資料庫」+「牙套下單」兩 sheet 的 .xlsx

## v0.3.14 — 2026-05-13

裁切 slider 上限 0.45 → 0.7（45% → 70%）。

### 變動

- 4 邊裁切 slider max 從 0.45 拉到 0.7、讓 user 可以裁更多
- 加註解：「對邊加總超 95% 會被 guard 卡住、crop 不生效」（避免裁過頭沒視野）
- 預設值不變、之前設定不受影響

## v0.3.13 — 2026-05-13

照片裁切（4 邊獨立、emerald 色 slider）。

### 新增

- **PhotoMeta 加 4 個 crop 欄位**：`cropTop` / `cropBottom` / `cropLeft` / `cropRight`（各 0 ~ 0.45）
- **Editor modal 加「✂ 裁切」section**：4 個 slider（上 / 下 / 左 / 右）+ 一鍵「⟲ 清除裁切」
- **`buildPhotoTransform` 加 crop logic**：用 scale + translate 模擬 crop
  - 裁掉區域不顯示、剩下視野自動撐滿 cell
  - 等效於「視野放大 + 中心平移」(crop simulation)
- 「⟲ 還原」按鈕條件接 crop 狀態

### 使用

- 上下左右各 0~45% slider、拖到要裁掉的比例
- 裁切 + 旋轉 + 翻轉 + 縮放 + 拉寬拉高 都可以組合
- 跨機 sync 自動帶 crop 設定

## v0.3.12 — 2026-05-13

加 Y 軸縮放 slider「照片高度」— 跟 X 軸獨立、各自非等比 scale。

### 變動

- **PhotoMeta 加 `imageStretchY`**（0.5 ~ 2.5、預設 1.0）
- Editor modal slider「照片寬度」下新增「照片高度」slider
- `buildPhotoTransform` 加 `scaleY(imageStretchY)`
- 三層 scale 控制：
  - `displayScale` (X+Y 等比)
  - `imageStretchX` (X 軸非等比)
  - `imageStretchY` (Y 軸非等比)
- 「⟲ 還原」按鈕 disabled 條件接 imageStretchY

## v0.3.11 — 2026-05-13

v0.3.10 修正：拉寬的是「**照片本身**」、不是「**cell 框**」。

### 變動

- **PhotoMeta 加 `imageStretchX`**（0.5 ~ 2.5、預設 1.0）→ 控制 img 水平 scaleX
- `aspectRatio` 標記 deprecated（仍保留欄位避免舊資料炸、但不再使用）
- **cell 回 `aspect-[4/3]` 預設**（之前 v0.3.10 改 inline aspectRatio）
- **Editor modal slider 改名「寬高比」→「照片寬度」**
  - 範圍 50% ~ 250%、控制 `imageStretchX` 而非 cell aspect
  - cell 大小不變、img 水平拉伸；超出 cell 邊界被 overflow:hidden 裁切
  - 旋轉 90° + 拉寬 → 牙齒被擠在直立 cell 內、拉寬後撐滿視覺寬度
- 移除 4:3/3:4/16:9/1:1 preset（不再控制 cell aspect）
- 「⟲ 還原」按鈕改 disabled 條件依 imageStretchX

### 使用

旋轉 90° 後牙齒變直立（_MG_5322 右側咬合照那種）：
- 之前：img 被擠在 4:3 cell 內、上下大量黑邊 / 裁切
- 現在：拉「照片寬度」slider → img 水平 scaleX 拉伸、視覺撐滿 cell（會有 cropping 但牙齒主體看得更清楚）

## v0.3.10 — 2026-05-13

每張照片 cell 寬高比可獨立調 — 旋轉 90° / 翻轉後想拉寬時直接 slider 改。

### 新增

- **`PhotoMeta` 加 `aspectRatio?: number`** — 0.5 ~ 2.5、預設 `4/3 ≈ 1.333`
- **PhotoEditorModal 加「寬高比」slider** + 4 個 preset：
  - 4:3 (1.333、預設)
  - 3:4 (0.75、直立)
  - 16:9 (1.778、寬螢幕)
  - 1:1 (1.000、方形)
  - 自由滑動 0.5 ~ 2.5
- **PhotoSlotCell `aspect-[4/3]` → inline `aspectRatio` style**：每個 cell 自己決定高度、不再固定
- **grid container 加 `items-start`**：避免 grid auto-stretch 把矮 cell 拉高

### 場景

口內 Right (Closed) 拍照是橫向長條（牙齒水平延伸）、4:3 框內看不完整 → 拉到 16:9 寬螢幕比例展示完整。
旋轉 90° 後想配合 portrait 比例 → 拉到 3:4。

「⟲ 還原」按鈕現在也清掉 aspectRatio 一起。

## v0.3.9 — 2026-05-13

Hotfix v0.3.8：拖曳不 work 修正、img 加 `draggable={false}` + `pointer-events-none` 讓 drag event 不被 img 攔截、走 outer div。

## v0.3.8 — 2026-05-13

8-slot 病歷照片 grid 支援拖曳交換。

### 新增

- **PhotoSlotCell 加 HTML5 drag & drop**：
  - 有照片的 slot：`draggable`、cursor 變 `move`
  - 拖到任何 slot（空 / 有照片）→ swap 內容（含 rotate/scale/brightness 設定）
  - 拖過 target slot 時 ring + bg 高亮（sky-500）
  - dataTransfer mime type `aligner/slot` 避免跟其他拖曳衝突
- **readOnly mode 不支援拖曳**（iPad 端純看）

### 使用

- 滑鼠按住有照片的 slot → 拖到別的 slot → 放開 → 兩 slot 內容對調
- 拖到空 slot → 照片搬過去（原 slot 變空）
- 拖到自己 → 不動作

## v0.3.7 — 2026-05-13

Hotfix v0.3.6：sharp resize 圖片避免 Anthropic 32MB request limit、model 用 alias 'claude-haiku-4-5'。

實際 Claude 回 model = `claude-haiku-4-5-20251001`（alias 自動帶到 Oct 2025 版）。

Backend 實測 15 張 _MG_*.JPG（陳品之）全分對：pano 95% / frontClosed 90% / portraits 82-90%、共用 14647 input + 1033 output tokens ≈ NT$0.6 / 病患。

## v0.3.6 — 2026-05-13

🤖 AI 一鍵填入照片（Claude Haiku 4.5 vision）— 開發機優先（key gating）。

### 新增

- **helper service 加 2 endpoints**：
  - `GET /anthropic-key-status` — 回 `{ configured: bool }`、給 App 決定要不要顯示按鈕
  - `GET /classify-photos?folder=<path>` — 把資料夾內所有照片丟 Claude vision、回 14-slot mapping JSON
- **`readAnthropicKey()` 從 `dev-data/anthropic-key.txt` 讀 API key**：支援純 key 或含 `ANTHROPIC_API_KEY=...` 格式、剝掉 export / quote / 註解
- **PatientNotesSection 加「🤖 一鍵填入」按鈕**（header 右側）：
  - 只在有 key + 非 readOnly + 有 sourceFolder 時顯示
  - 自動 gating：D 機放 key、筆電不放 = 按鈕只在 D 機出現
- **新 `PhotoAIPickerModal` component**：
  - Loading state（10-30 秒、Claude 分析中）
  - 結果 preview grid：每張照片 + Claude 建議 slot + confidence + reason + dropdown 可改
  - 預設：confidence > 0.5 且 slot 不重複 → 自動採用、否則 skip
  - 顯示 token usage + 預估成本（NT$）
  - 套用後 batch 寫進 patient.photos（保留既有 rotate/scale/brightness 設定、只改 filename）

### 限制

- **HEIC 不支援**（Claude API 限制、會 skip 並 warn user）— 之後可加 Python PIL 自動轉檔
- **每次最多 20 張**（Claude API token 限制、超過分批、之後做）
- **未測 accuracy**：第一次跑要 user 驗證效果、調 prompt（之後 iterate）

### Setup（D 機）

```powershell
# 從 診所業績-app/.env 抽 ANTHROPIC_API_KEY 值
# 寫到 aligner-tracker/dev-data/anthropic-key.txt（純 key 一行、無前綴）
echo "sk-ant-..." > D:\dev\矯正追蹤-app\dev-data\anthropic-key.txt
# 重啟 npm run start、按鈕會出現
```

筆電不放 key → 按鈕自動隱藏、不會誤觸 API。

### 預估成本

- Haiku 4.5: ~$0.016 / 病患（~NT$0.5）
- 365 病患全跑：~NT$200

### 設計筆記

- **gating by API key 比 role 簡單**：不用改 clinic-role.txt、user 自己決定誰能用
- **保留 PhotoMeta transform 設定**：套用時只改 `filename`、`rotate / scale / brightness` 保留
- **dropdown 可手動覆寫**：Claude 建議錯、user 直接選
- **prompt 用 raw JSON output**：避免 markdown fence wrap、parse 容錯

## v0.3.5 — 2026-05-13

revert v0.3.4 — 照片區回到詳細頁 inline、不要在編輯 modal 內。

### 變動

- `PatientFormModal`：移除 tab nav、移除 photos tab、移除 PatientNotesSection import、max-width `max-w-6xl` → `max-w-2xl`（回 v0.3.3 大小）
- `PatientDetailPage`：master mode 也顯示 PatientNotesSection（不再只 readOnly）

### 為什麼 revert

user 試 v0.3.4 後反饋「想跟之前一樣 放照片在第一頁」 — 進 modal 切 tab 兩步比 inline 直接看見一步差。詳細頁底下 inline 體驗更好（一眼掃完）。

## v0.3.4 — 2026-05-13

照片區從詳細頁底下搬進「✎ 編輯」modal 內、做成 tab。

### 變動

- **PatientFormModal**：
  - max-width `max-w-2xl` → `max-w-6xl`（容納 8-slot 大圖）
  - 加 tab navigation：「基本資料」/「📋 病歷照片 / 筆記」
  - 「病歷照片」tab 嵌入 PatientNotesSection（重用既有 component）
  - 加 hint 文字：「照片區即時儲存、基本資料按下方儲存才生效」（兩種 saving 機制差異說明）
  - new 模式（沒 patient.id）不顯示 photos tab
- **PatientDetailPage**：
  - master mode：詳細頁底下不再顯示 PatientNotesSection（避免兩處 entry confused）
  - readOnly mode：仍顯示（iPad 看用）

### 為什麼

user 反饋「inline 邊改邊存、不知道哪些對哪些不對」 — 改成「進編輯 modal、tab 集中編輯」雖然照片仍 auto-save、但 entry 集中、看得到完整 8-slot grid review。

### 已知 trade-off

- 照片 auto-save + form staged 兩種 saving 混合 — 加 hint 註解、但仍存在
- 未來想徹底「review + commit」儀式感、需要把 photo 改動也 staged（schema 重構、暫不做）

## v0.3.3 — 2026-05-13

sync.json 內 path 自動 normalize — 跨機 dataRoot 不一致也能 work。

### 場景

D 開發機在外網、想直連 NAS 但 SMB 445 通常被擋。退路 = Drive Client mirror（本機路徑 `D:\診所nas 0矯正追蹤\SynologyDrive`）。跟筆電 master 機（W:\0矯正追蹤）dataRoot 不同。

之前 sync.json 內 `sourceFolder` 是 absolute path（W:\...）、D 機 pull 後 IndexedDB 內仍是 W:\、開檔找不到。

### 新增

- **`src/lib/path-normalize.ts`** — normalize / denormalize utility
  - `normalizePath(abs, dataRoot)` 把 `W:\0矯正追蹤\病患資料夾\xxx` strip 成 `病患資料夾\xxx`
  - `denormalizePath(rel, dataRoot)` 把 `病患資料夾\xxx` + 本機 dataRoot prepend 回 absolute
  - `normalizePatient` / `denormalizePatient` 處理整個 patient 內 sourceFolder + consentPdfPath
- **`backup.ts` 升 v2**：
  - `exportBackup(dataRoot?)` 有給 dataRoot → patients 內 path 自動 normalize
  - `importBackup(file, dataRoot?)` 新 file (v2) + 給 dataRoot → 自動 denormalize
  - 標記 `BackupFile.dataRoot` 紀錄 sender 來源（debug）
- **SyncSection doPush / doPullConfirm**：抓 helper `/paths` 拿本機 dataRoot 傳給 export/import
- **UpdateSection 切版前自動 backup** 也用 normalize（之後從 backup 還原跨機 OK）
- **BackupSection 本機下載 backup** 維持 v1（無 normalize、user 本機 reimport 用）

### 影響

| 場景 | v0.3.3 行為 |
|:--|:--|
| 同機 push + 同機 pull | path 還原成本機 absolute、行為跟之前一樣 |
| 機 A 推 (dataRoot W:\) + 機 B 拉 (dataRoot D:\) | B 拉下來自動 prepend D:\、開檔 work ✓ |
| 拉舊 v1 backup | dataRoot 給也不 denormalize（file.version < 2）、保留 absolute |
| 本機下載備份檔 | 仍 v1、absolute path、跟之前一樣 |

### 升級流程

1. 筆電升 v0.3.3 → ⚙ 設定 → 跨機同步 → 「📤 推到 NAS」（這次推上去的是 v2 format）
2. D 機升 v0.3.3 → 設定 dataRoot 為本機 mirror 路徑（例 `D:\診所nas 0矯正追蹤\SynologyDrive`）→ 「📥 從 NAS 拉」（自動 denormalize）

跨機就一致了、不再需要每次切機跑「路徑遷移」工具（之前 v0.3.2 的）。

## v0.3.2 — 2026-05-12

路徑遷移工具：dataRoot 改動後、批次改寫 IndexedDB 內舊 sourceFolder / consentPdfPath。

### 場景

User v0.3.1 升級後把 dataRoot 從 `C:\矯正` 改成 `W:\0矯正追蹤`、但 365 個病患 IndexedDB 內 `sourceFolder` 還是 `C:\矯正\病患資料夾\xxx` → 點「📁 開資料夾」打開錯位置。

### 新增

- **`src/lib/path-migration.ts`** — `scanMigration()` + `applyMigration()`
  - 偵測舊 prefix：`C:\矯正\` / `D:\矯正\` / `W:\矯正追蹤\` → 改寫到當前 dataRoot
  - 不會誤改其他欄位、只動 `sourceFolder` 跟 `consentPdfPath`
- **設定 → 路徑遷移 section**：在 PathsSection 之後
  - 點「🔍 掃描」→ 看候選筆數 + 分類（已是新路徑 / 待遷移 / 未知 prefix）
  - 預覽前 5 筆變更（old → new diff）
  - 確認後點「⚡ 執行遷移」→ batch update IndexedDB
  - 完成提示「Ctrl+Shift+R + 推到 NAS」

### 設計

- 兩步驟（掃描 → 套用）避免誤觸
- 預覽顯示具體 old/new 對照、user 看到才安心
- 「未知 prefix」不會被誤改（保留原值）
- readOnly mode 隱藏此 section

## v0.3.1 — 2026-05-12

Stage B 實際 deploy 到 NAS Docker 跑通 + 「矯正追蹤」資料夾改名「0矯正追蹤」（排前面）。

### Deploy 完成

- D 機裝 Docker Desktop v29.4.3（修了 WSL 太舊問題 + ProgramData 殘留問題）
- `docker build -t aligner-viewer:0.3.0 .` 成功（修了 `.dockerignore` 排除 dev-data 的 TS 編譯錯誤）
- `docker save → aligner-viewer-0.3.0.tar` 47 MB
- 上傳 NAS File Station → DSM Docker UI 載入 → container running
- 內網訪問 `http://192.168.0.220:8080/`（外網擋、Stage B 設計就是 LAN-only）

### 變動

- **NAS share rename**：`n歐耐恩n/矯正追蹤` → `n歐耐恩n/0矯正追蹤`（user 為了排前面）
- `server/index.js`：stripMasterPrefix 加 `0矯正追蹤` regex
- `server/DEPLOY.md`：所有「矯正追蹤」改「0矯正追蹤」
- `docker-compose.yml`：mount source 改 `0矯正追蹤`
- `.dockerignore`：移除 `dev-data/` 排除（TypeScript 編譯需要 JSON import；runtime stage 不包 dev-data、不洩個資）

### Build 變化

- Build 時間 ~70s（包含 npm ci × 2 + vite build + 兩個 stage）
- Final image: 200 MB on-disk / 49 MB tar
- Container 跑起來 RAM <50 MB、CPU idle

### Stage B 整體完成度

| Session | 內容 | 狀態 |
|:--|:--|:--|
| 1 | server backend | ✅ |
| 2 | frontend readOnly mode | ✅ |
| 3 | Dockerfile + DEPLOY.md | ✅ |
| 4 | 實際 build + deploy NAS | ✅（本版完成）|
| 5 | 診所 wifi 內 iPad 測試 | ⏳ |

### 後續

- 等到診所 wifi 內測 iPad 開 `http://192.168.0.220:8080/` 看 readOnly App UI
- 診所 master 機掛 W: + 推 sync.json 後、iPad 才會看到真實資料
- 之前 mock 用 D 機 backup-2026-04-26-live.json 已驗證、預期 NAS 上換成 master 推的 sync.json 也 work

## v0.3.0 — 2026-05-12

Stage B 開機：iPad 內網唯讀 web — server backend + frontend readOnly mode + Dockerfile + deployment SOP。

### 新增

- **`server/` — Node Express server**（~250 行、Session 1）
  - 5 endpoints: `/api/health` `/api/snapshot` `/api/files` `/api/image` `/api/file`
  - SPA fallback（serve `dist/index.html` for any non-API route、React Router 用）
  - `safePath()` 嚴格擋 path traversal
  - master-side path prefix 自動 strip（`W:\矯正追蹤\` / `D:\矯正\` / `/n歐耐恩n/矯正追蹤/`）
  - 5min cache on images、no-cache on snapshot
- **Frontend readOnly mode**（build flag `VITE_READ_ONLY=1`、Session 2）
  - 啟動 fetch `/api/snapshot` → `importBackup` 到 IndexedDB
  - component 邏輯不變、只隱 mutation UI
  - `helper-client.ts` 的 `getImageUrl` / `listFolderFiles` 自動 redirect 到 `/api/*`
  - nav 顯示「唯讀」徽章 + 載入失敗提示頁
- **Dockerfile**（multi-stage、node:20-alpine、~150MB image、Session 3）
- **`docker-compose.yml`**（LAN-only、restart unless-stopped、healthcheck）
- **`.dockerignore`** 排除 node_modules / dist / 病患資料夾等
- **`server/DEPLOY.md`** 完整 NAS Docker 部署 SOP

### UI 改動（readOnly mode 下）

- **PatientList**：隱「+ 新增病患」
- **PatientDetailPage**：隱所有 mutation 按鈕（✎ 編輯 / 📁 開資料夾 / 📄 開授權書 / 📋 開指示單）
- **OrderTracking**：隱「+ 新增病患/下單」
- **PatientNotesSection**：隱 hover actions（✎ 換 ✗）、空 slot 改顯「—」、textarea `readOnly` 屬性
- **SettingsPage**：只留 UiScale + PhotoStyle（本機視覺偏好）、其他 12 section 全隱

### Build size

- master mode（default）: 1061 KiB
- **readonly mode**（VITE_READ_ONLY=1）: **997 KiB**（tree-shake -64 KiB）

### 待（v0.3.x 後續 / 用戶 ops）

- 實際 build + deploy 到 NAS Docker：
  - **方法 A**：D 機裝 Docker Desktop → `docker build` + `docker save` + 上傳 → DSM Docker UI 載入
  - **方法 B**：NAS SSH 直接 `docker build`（需先在 DSM 啟用 SSH）
  - 兩者 SOP 都在 `server/DEPLOY.md`
- iPad 內網測試（Safari 開 `http://192.168.0.220:8080/`）
- 診所 master 機先掛 W: + 推 sync.json 到 NAS（前置）

### 設計筆記

- **「IndexedDB 當 server cache」策略** — readOnly mode 不重寫資料層、把 fetch 結果寫進 IndexedDB、後續 component 邏輯不變、`useLiveQuery` 照常 work。改動量小 8 倍
- **master-side path prefix strip** — sync.json 內的 sourceFolder 是 W:\ Windows 絕對路徑、server 端要 strip 後當 relative 在 /data 內找
- **無 auth** — 信任邊界 = 診所 wifi、NAS 防火牆對外擋 8080。若之後要對外、加 Basic Auth 或接登入帳號 doc
- **Express 5 wildcard route** 從 `'*'` 改 `/.*/`  regex（path-to-regexp 新版改 syntax）

## v0.2.0 — 2026-05-07

版本號規則重整 — patch 達到 16 就 bump minor 並 reset patch 到 0。

### 規則

- `0.x.{0..15}` → 在當前 minor
- 第 16 個 patch 來臨時 → bump 到 `0.{x+1}.0`、reset patch
- 之後維持：v0.2.0 → v0.2.1 → ... → v0.2.15 → v0.3.0

### 為什麼

- 避免 minor 版號內 patch 累積太多（v0.1.19 跨到 v0.2.0 對齊 sane 範圍）
- 強迫每 15 個小改版做一次「整理 / 反思」的節點

### 本版內容

純版本號 reset、沒有功能變更（從 v0.1.19 直接進位）。

## v0.1.19 — 2026-05-07

框線樣式從「只影響病歷照片」升級成「全 App 通用」。

### 變動

- **設定 section 改名「框線樣式」**（從「病歷照片框線」）
- **顏色全 App 套用**：透過 `index.css` global override，所有 `.border-zinc-{600,700,800}` 都吃 `var(--photo-border-color)`
  - 影響範圍：病歷照片 / PatientDetailPage Card / 設定 section / Modal / 表格 / Nav 等所有用 zinc 灰系 border 的元素
- **粗細選擇性套用**：只影響「結構框」(`.rounded-xl/lg/md` + `.border` or `.border-2`)、不影響 badge / pill / divider 等小元素
- 用 `!important` 確保勝過 plain theme 的 border override（plain 主題下也能套）

### 設計筆記

- **CSS variable 機制不變**（沿用 v0.1.18 的 `--photo-border-color` / `--photo-border-width`）
- **變數名暫不改**（避免 mass rename），但概念已升級為全 App
- 視覺層級略為扁平化 — 原本不同灰階差異消失、改用 user 設定的單一色

## v0.1.18 — 2026-05-07

病歷照片框線全域可調（粗細 + 顏色）。

### 新增

- **設定 → 病歷照片框線 section**：
  - 粗細 slider 1px ~ 6px、附 6 個 preset 快選按鈕
  - 顏色 picker：8 個 preset（灰/深灰/白/天藍/綠/紫/黃/粉）+ 自訂 color picker + hex 輸入
  - 即時預覽（solid + dashed 兩種版本）
- **CSS variable 機制**：寫入 `:root --photo-border-width` / `--photo-border-color`
  - 所有 photo cell（PHOTO_BORDER_STYLE）+ 左右兩個大框都用 var() 套用
  - 改完即時全 App 生效
- 設定每台機獨立（localStorage、不走 NAS sync — 是視覺偏好）
- App 啟動 `initPhotoStyle()` 套用儲存值

### 變動

- PhotoSlotCell 的 cell border 從寫死 `border-zinc-800` 改成走 CSS var
- 左右兩個大框（人像 + 牙齒）框線也走 CSS var
- 預設 2px / zinc-500 (`#71717a`)

## v0.1.17 — 2026-05-07

照片亮度可調（CSS filter brightness）。

### 變動

- **照片亮度 slider**：編輯 modal 加 0.5x ~ 1.5x（步進 0.05）
  - 純前端 CSS `filter: brightness(...)`、不動原檔
  - 存進 `PhotoMeta.brightness`、跨機 sync 同步
  - 同時套用在 cell display + modal preview
- 「⟲ 還原」按鈕現在也清掉 brightness

### 設計

- CSS filter 跟 transform 是兩個獨立 property、可同時套用、不衝突
- 之後若需要 contrast / saturation / hue 也都走 `buildPhotoFilter()` 同一條路

## v0.1.16 — 2026-05-07

左右獨立 size slider + 單張照片獨立縮放（PhotoMeta.displayScale）。

### 變動

- **拆成左右兩個獨立 slider**（取代 v0.1.15 全域一個）：
  - 人像區尺寸（localStorage `aligner-portrait-size`）
  - 牙齒區尺寸（localStorage `aligner-teeth-size`）
  - 各自 slider 放在自己框框 header 右側
- **單張照片獨立縮放**（編輯 modal 加 slider）：
  - 0.5x ~ 2.0x、步進 0.1
  - 存進 `PhotoMeta.displayScale`、跟著 rotate / flip 一起套 CSS transform
  - 跨機 sync 自動同步
- 「⟲ 還原」按鈕現在也清掉 displayScale

## v0.1.15 — 2026-05-07

框線明顯化 + 整體尺寸可調 slider。

### 變動

- **框線改粗 + 亮**：`border-2 border-zinc-600`（從 `border border-zinc-800`）
- **標題加粗、改亮色**：`text-zinc-200 font-semibold`
- **加 尺寸 slider**（50% ~ 100%、步進 5%）：右上角拖曳調整整體 photo 區寬度
  - 即時生效、自動存 localStorage（key `aligner-photo-size`、跨 session 沿用）
  - 非 100% 時顯示 ⟲ reset 按鈕
  - 整體 maxWidth 縮放、cells 等比變小、左右比例維持 7:5

## v0.1.14 — 2026-05-07

左右各加框 + 牙齒照片縮小。

### 變動

- 左右兩半都包 rounded border 框（zinc-800 outline + zinc-950/40 bg）
- 加 emoji 標題：🙂 人像 / 🦷 牙齒
- 寬度比例 `lg:grid-cols-[7fr_5fr]`（左寬右窄）→ 右側牙齒 cell 自動縮小 ~30%
- 右側 group 間距 `space-y-4`、內部 gap 從 3 → 2 進一步縮緊

## v0.1.13 — 2026-05-07

人像跟牙齒並列：左半人像 6 slot（3×2）、右半牙齒系列（X-ray + 口外 + 口內）。

### 變動

- **photo grid 改成左右並列 layout**：
  - 左 50%：人像 group（6 個 slot、2 col × 3 row）
  - 右 50%：牙齒系列垂直堆疊（X-ray 2 / 口外 2 / 口內 4、各 2 col）
- 視覺上對齊「人像（face）vs 牙齒（teeth）」兩大主軸
- 螢幕窄（< lg breakpoint）時自動退回單列堆疊

## v0.1.12 — 2026-05-07

45° 斜位也拆休息/微笑兩個 — 人像 group 變整齊 3×2 grid。

### 變動

- **人像 6 個 slot**（3 角度 × 2 表情）：
  - 正面（休息）/ 正面（微笑）
  - **45° 斜位（休息）/ 45° 斜位（微笑）**（新拆）
  - 90° 側面（休息）/ 90° 側面（微笑）
- 總 slot 數 13 → 14

### Migration

**Dexie schema 升 v9**：`portraitOblique45` → `portraitOblique45Rest`（單一 slot 默認當 rest 表情）

## v0.1.11 — 2026-05-07

人像 slot 重組：移除「側左/側右」、加「45° 斜位 / 90° 側面（休息）/ 90° 側面（微笑）」。

### 變動

- **人像 group 5 個 slot**（取代 v0.1.10 的 4 個）：
  - 正面（休息）/ 正面（微笑）
  - **45° 斜位**（新）
  - **90° 側面（休息）**（新、取代「側面右」）
  - **90° 側面（微笑）**（新）
- **移除 slot**：`portraitProfileLeft` / `portraitProfileRight`

### Migration

**Dexie schema 升 v8**：
- `portraitProfileRight` → `portraitProfileRest`（自動 migrate、休息姿勢右側 = 標準 90° profile rest）
- `portraitProfileLeft` → 丟掉（左側照非標準矯正 view）

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
