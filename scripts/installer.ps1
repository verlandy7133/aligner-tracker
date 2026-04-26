# 隱形矯正追蹤 — 自動安裝程式
# 由 安裝.bat 呼叫 (PowerShell)
#
# 動作：
#   1. 確認 Node.js 已安裝
#   2. 把 app/ 複製到 D:\dev\矯正追蹤-app\
#   3. 把 矯正資料/ 複製到 D:\矯正\ (若不存在才複製)
#   4. 跑 npm install + npm run build
#   5. 建桌面捷徑「隱形矯正追蹤」
#   6. 提示用戶啟動 + 還原備份

param([string]$BundlePath)

$ErrorActionPreference = 'Stop'

# UTF-8 console
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ''
Write-Host '╔════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║  隱形矯正追蹤 — 安裝程式               ║' -ForegroundColor Cyan
Write-Host '╚════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

if (-not $BundlePath) {
    $BundlePath = (Get-Item $PSScriptRoot).Parent.FullName
}
Write-Host "Bundle 來源：$BundlePath"
Write-Host ''

# ── 1. 檢查 Node.js ─────────────────────────────────────
Write-Host '[1/5] 檢查 Node.js...'
$nodeExe = $null
$candidates = @(
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
)
foreach ($p in $candidates) {
    if (Test-Path $p) { $nodeExe = $p; break }
}
if (-not $nodeExe) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $nodeExe = $cmd.Source }
}
if (-not $nodeExe) {
    Write-Host '❌ 找不到 Node.js' -ForegroundColor Red
    Write-Host '請先到 https://nodejs.org 下載 LTS 版本安裝後重新執行此程式' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org'
    Read-Host '按 Enter 結束'
    exit 1
}
$nodeDir = Split-Path $nodeExe -Parent
$env:PATH = "$nodeDir;$env:PATH"
$nodeVer = & $nodeExe --version
Write-Host "  ✓ Node.js $nodeVer ($nodeExe)" -ForegroundColor Green

# ── 2. 複製 app 程式碼 ────────────────────────────────────
Write-Host ''
Write-Host '[2/5] 複製 App 程式碼...'
$srcApp = Join-Path $BundlePath 'app'
$dstApp = 'D:\dev\矯正追蹤-app'
if (-not (Test-Path $srcApp)) {
    Write-Host "❌ 找不到 $srcApp" -ForegroundColor Red
    Read-Host '按 Enter 結束'; exit 1
}
if (Test-Path $dstApp) {
    $bk = "${dstApp}.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "  ⚠️ 目標已存在，移到備份：$bk" -ForegroundColor Yellow
    Rename-Item $dstApp $bk
}
New-Item -ItemType Directory -Force -Path (Split-Path $dstApp -Parent) | Out-Null
Copy-Item -Recurse $srcApp $dstApp
Write-Host "  ✓ 複製到 $dstApp" -ForegroundColor Green

# ── 3. 複製 矯正資料 ──────────────────────────────────────
Write-Host ''
Write-Host '[3/5] 複製病患資料夾...'
$srcData = Join-Path $BundlePath '矯正資料'
$dstData = 'D:\矯正'
if (Test-Path $srcData) {
    if (Test-Path $dstData) {
        Write-Host "  ⚠️ $dstData 已存在，跳過 (避免覆蓋現有病患檔)" -ForegroundColor Yellow
    } else {
        Copy-Item -Recurse $srcData $dstData
        Write-Host "  ✓ 複製到 $dstData" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠️ Bundle 內無 矯正資料/ ，跳過" -ForegroundColor Yellow
}

# ── 4. npm install + build ───────────────────────────────
Write-Host ''
Write-Host '[4/5] 安裝依賴 (1-3 分鐘)...'
$npmCmd = Join-Path $nodeDir 'npm.cmd'
Set-Location $dstApp
& $npmCmd install --silent 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ npm install 失敗" -ForegroundColor Red
    Read-Host '按 Enter 結束'; exit 1
}
Write-Host '  ✓ npm install 完成' -ForegroundColor Green

# 檢查 dist/ — bundle 內已含 build 過的就不用重 build
if (Test-Path (Join-Path $dstApp 'dist')) {
    Write-Host '  ✓ dist/ 已存在 (跳過 build)' -ForegroundColor Green
} else {
    Write-Host '  → 編譯中...'
    & $npmCmd run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ build 失敗" -ForegroundColor Red
        Read-Host '按 Enter 結束'; exit 1
    }
    Write-Host '  ✓ 編譯完成' -ForegroundColor Green
}

# ── 5. 桌面捷徑 ─────────────────────────────────────────
Write-Host ''
Write-Host '[5/5] 建立桌面捷徑...'
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '隱形矯正追蹤.lnk'
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $nodeExe
$shortcut.Arguments = '"' + $dstApp + '\scripts\start-clinic.mjs"'
$shortcut.WorkingDirectory = $dstApp
$shortcut.Description = '隱形矯正追蹤 — 啟動 server + Chrome'
$iconPath = Join-Path $dstApp 'public\favicon.png'
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Save()
Write-Host "  ✓ $lnkPath" -ForegroundColor Green

# ── 完成 ────────────────────────────────────────────────
Write-Host ''
Write-Host '╔════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║  ✓ 安裝完成                            ║' -ForegroundColor Cyan
Write-Host '╚════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''
Write-Host '下一步：'
Write-Host '  1. 雙擊桌面【隱形矯正追蹤】捷徑啟動 App'
Write-Host '  2. App 開啟後 → ⚙ 設定 → 資料備份 → ⬆ 選擇備份檔'
Write-Host "  3. 選 $BundlePath\備份\ 內的 JSON 檔還原資料"
Write-Host ''
$reply = Read-Host '現在啟動 App？ (Y/n)'
if ($reply -ne 'n' -and $reply -ne 'N') {
    Start-Process -FilePath $lnkPath
}
Write-Host ''
Read-Host '按 Enter 關閉此視窗'
