# 隱形矯正追蹤 — 診所電腦部署 SOP

把這套 App 從目前的開發機（D 槽）搬到診所實際使用電腦的步驟。

---

## ⚠️ 部署前確認事項

- [ ] 新電腦 **Windows 10 / 11**
- [ ] 新電腦預計**長期常開**（用來跑 server）
- [ ] 病患資料**未加密**（這次決定不開 BitLocker）— 對應做法：
  - 診間實體上鎖
  - 設電腦螢幕鎖（離開鎖屏）
  - 每月匯出備份到 USB
- [ ] 純單機使用（未來想跨裝置看，要再設區網存取，現在不考慮）

---

## 📦 在「目前這台」電腦做的事

### 1. 匯出資料備份

1. 開 App → ⚙ 設定 → 資料備份 / 還原 → ⬇ 匯出備份
2. 下載到 `aligner-tracker-backup-YYYY-MM-DD.json`
3. 把這檔案放到隨身碟或 OneDrive（**會帶過去新電腦**）

### 2. 整套 App 程式碼

把整個資料夾 copy 到隨身碟：
```
D:\dev\矯正追蹤-app\
```

可以排除（縮小）：
- `node_modules\`（很大，新電腦會重新安裝）
- `dev-data\`（含病患個資 JSON，**會帶過去但要小心保管**）

### 3. 病患原始資料夾

把整個資料夾 copy 過去：
```
D:\矯正\
├── 口掃檔 取資料 下單\  ← 含真實病患 PDF / JPG / 口掃檔
└── 病患授權書\          ← 集中複製的 218 份授權書 PDF
```

---

## 🖥 新電腦上的安裝步驟

### 1. 安裝必備軟體

| 軟體 | 用途 | 下載 |
|:--|:--|:--|
| **Node.js LTS** | 跑 vite + helper service | https://nodejs.org |
| **Google Chrome** | App 的執行容器 (PWA) | https://google.com/chrome |

裝完打開 PowerShell 或 CMD 確認：
```powershell
node -v   # 應該顯示 v20+ 或 v24+
npm -v    # 應該顯示 10+ 或 11+
```

### 2. 復原資料夾

在新電腦的 D 槽建立同樣結構：
```
D:\矯正\口掃檔 取資料 下單\   ← 從隨身碟 copy 過來
D:\矯正\病患授權書\           ← 同上
D:\dev\矯正追蹤-app\          ← 同上
```

### 3. 安裝專案依賴 + 建構

打開 CMD：
```cmd
cd /d D:\dev\矯正追蹤-app
npm install
npm run build
```

`npm install` 會花 1-3 分鐘下載依賴。
`npm run build` 把程式碼編譯成 `dist/` 目錄（給瀏覽器讀的靜態檔）。

### 4. 雙擊啟動測試

桌面建一個捷徑：
1. 在桌面右鍵 → 新增 → 捷徑
2. 位置填入：
   ```
   "C:\Program Files\nodejs\node.exe" "D:\dev\矯正追蹤-app\scripts\start-clinic.mjs"
   ```
3. 命名為「**隱形矯正追蹤**」
4. 右鍵捷徑 → 內容 → 變更圖示 → 選 `D:\dev\矯正追蹤-app\public\favicon.png`（或留預設）

雙擊捷徑 → 應會：
- 跳出黑色 CMD 視窗（vite + helper 在裡面跑，**不要關**）
- 5-10 秒後 Chrome 自動跳出 App 視窗（無網址列，像 native app）

### 5. 還原資料

1. 在 App → ⚙ 設定 → 資料備份 / 還原 → ⬆ 選擇備份檔
2. 選你帶過來的 `aligner-tracker-backup-YYYY-MM-DD.json`
3. 看到琥珀色預覽 → 點「⚠ 確認覆寫」
4. 自動重整 → 應該看到 301 病患 / 388 下單

---

## 🚀 開機自動啟動（選用）

不想每天手動雙擊啟動的話：

1. Win + R → 輸入 `shell:startup` → Enter
2. 把桌面的「隱形矯正追蹤」捷徑**複製**過去這個資料夾
3. 重開機 → 應自動啟動

⚠️ 這樣會每次開機都跳出 CMD 黑視窗 + Chrome。可接受的話這是最方便的方式。

如果**想隱藏 CMD 視窗**（進階）：
1. 在 `D:\dev\矯正追蹤-app\` 建一個 `start-hidden.vbs`，內容：
   ```vbs
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run """C:\Program Files\nodejs\node.exe"" ""D:\dev\矯正追蹤-app\scripts\start-clinic.mjs""", 0, False
   ```
2. 把 `.vbs` 放進 startup 資料夾（取代 `.lnk` 捷徑）
3. 重開機 → 看不到黑視窗，但 server 在跑

---

## 🦷 變成桌面 App (PWA 安裝)

第一次跑完後，可以把 App 變成正式 PWA：

1. App 跑著的時候，Chrome 視窗右上角網址列會出現「⊕ 安裝」icon
   - （或選單 ⋮ → 安裝隱形矯正追蹤）
2. 點下去 → 桌面 / 開始選單會多一個 PWA icon
3. **以後直接點 PWA icon 就能用**（前提：`start-clinic.cmd` 那個 server 還在跑）

PWA 模式好處：
- 看起來真的像獨立 App，不是瀏覽器分頁
- 自己的 dock icon
- 跟其他 Chrome 分頁分離（不會誤關）

---

## 📅 日常使用

| 場景 | 操作 |
|:--|:--|
| 早上開診 | 開電腦 → 開機自動啟動（或雙擊捷徑） |
| 新增病患 | 病患列表 → + 新增病患 |
| 新增下單 | 下單追蹤 → + 新增下單（或群組頭 + 新增） |
| 新病患資料夾掃描 | 設定 → 資料夾掃描 → 立即掃描（從 `D:\矯正\口掃檔 取資料 下單\` 自動偵測新增） |
| 月底備份 | 設定 → 資料備份 → ⬇ 匯出備份 → 存隨身碟（**強烈建議每月做**） |
| 主題 / 配色 | 右上角 🎨 切換 / ✎ 自定義 |
| 警示閾值 | 設定 → 警示閾值（A 廠商遲交 28 天 / B 病患未領 14 天 / D 待下單 14 天） |

---

## 🔧 常見問題

### Q1：雙擊捷徑後 CMD 跳出但沒開 Chrome？

可能原因：
- Chrome 沒裝在標準位置 → 編輯 `scripts/start-clinic.mjs` 的 `chromePaths` 加你的 Chrome 路徑
- 防毒軟體擋住 → 把 `D:\dev\矯正追蹤-app\` 加進防毒例外

### Q2：「開啟資料夾」按鈕沒反應？

helper service 沒跑。檢查：
- CMD 視窗是否還開著（不能關）
- 看 CMD 訊息有沒有 `[helper] listening on http://127.0.0.1:8765`

### Q3：誤觸了「清空 DB」/ 不小心刪了病患怎麼辦？

從備份還原：設定 → 資料備份 / 還原 → ⬆ 選擇備份檔 → 上次匯出的 JSON

**這就是為什麼要每月備份**。

### Q4：要更新 App（程式碼有改）？

1. 開發機改完 code 後：`npm run build`
2. 把整個 `dist/` 資料夾 copy 到診所電腦的同一位置
3. 診所電腦的 PWA 會自動偵測到新版本（registerType: autoUpdate）
4. 重整 PWA 視窗即套用

或更乾脆：把整包 `D:\dev\矯正追蹤-app\` 重 copy 一次，跑 `npm install && npm run build`，重啟 server。

### Q5：未來想讓 iPad / 手機看 App？

vite preview 已經 listen 在 `0.0.0.0`，理論上區網內其他裝置可連 `http://[診所電腦的IP]:5174`。

需要：
- 診所電腦關 Windows 防火牆（或加 5174 例外）
- iPad 跟診所電腦在**同個 Wi-Fi**
- iPad Safari 開 `http://192.168.x.x:5174`（IP 用 `ipconfig` 查）

⚠️ 區網存取會讓 helper service「開資料夾」功能失效（helper 只認 127.0.0.1），可改 helper 監聽 0.0.0.0 但要更小心 allowlist。

---

## 🆘 緊急聯絡

App 完全壞掉、資料全消？

1. 找出最新一份 `aligner-tracker-backup-*.json`（USB / OneDrive / Email 自己的副本）
2. 找另一台電腦或請工程師重裝 App
3. 從備份還原

**App 程式碼 + dev-data 不重要（可重建）；備份 JSON 才是命根子**。

---

_最後更新：2026-04-26_
