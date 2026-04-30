# 隱形矯正追蹤 — 一鍵更新
# 動作：git pull → (依賴變動才) npm install → npm run build → 提示重啟 App
#
# 在 D 機 (D:\dev\...) 跟筆電 (C:\dev\...) 都能跑，自動偵測。
# 由 更新.bat 呼叫（或 PowerShell 直接跑）。

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ''
Write-Host '╔══════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║  隱形矯正追蹤 — 一鍵更新         ║' -ForegroundColor Cyan
Write-Host '╚══════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ── 偵測 App 目錄 ──────────────────────────────────────
$appDir = $null
foreach ($candidate in @('D:\dev\矯正追蹤-app', 'C:\dev\矯正追蹤-app')) {
    if (Test-Path (Join-Path $candidate '.git')) {
        $appDir = $candidate
        break
    }
}
if (-not $appDir) {
    Write-Host '❌ 找不到 App 目錄（找了 D:\dev\矯正追蹤-app 跟 C:\dev\矯正追蹤-app）' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}
Set-Location $appDir
Write-Host "App 目錄：$appDir" -ForegroundColor Gray
Write-Host ''

# ── 偵測 Node ─────────────────────────────────────────
$nodeExe = $null
foreach ($p in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
    if (Test-Path $p) { $nodeExe = $p; break }
}
if (-not $nodeExe) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $nodeExe = $cmd.Source }
}
if (-not $nodeExe) {
    Write-Host '❌ 找不到 Node.js，請先安裝：https://nodejs.org' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}
$nodeDir = Split-Path $nodeExe -Parent
$npmCmd = Join-Path $nodeDir 'npm.cmd'
$env:PATH = "$nodeDir;$env:PATH"

# ── 0. 檢查工作樹是否乾淨 ─────────────────────────────
Write-Host '[0/3] 檢查本機是否有未提交變動...'
$dirty = git status --porcelain
if ($dirty) {
    Write-Host '⚠️ 工作樹有未提交變動：' -ForegroundColor Yellow
    Write-Host $dirty -ForegroundColor Yellow
    Write-Host ''
    Write-Host '請先 commit / stash / 還原這些變動再跑更新，或回開發機處理後 push。' -ForegroundColor Yellow
    Read-Host '按 Enter 結束'
    exit 1
}
Write-Host '  ✓ 工作樹乾淨' -ForegroundColor Green
Write-Host ''

# ── 1. git pull ───────────────────────────────────────
Write-Host '[1/3] 拉最新版本（git pull）...'
$beforeHash = (git rev-parse HEAD).Trim()
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host '❌ git pull 失敗' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}
$afterHash = (git rev-parse HEAD).Trim()
if ($beforeHash -eq $afterHash) {
    Write-Host ''
    Write-Host '✓ 已是最新版本，無需更新。' -ForegroundColor Green
    Write-Host ''
    Read-Host '按 Enter 關閉'
    exit 0
}
Write-Host "  ✓ $($beforeHash.Substring(0,7)) → $($afterHash.Substring(0,7))" -ForegroundColor Green
Write-Host ''

# ── 2. 依賴變動才 npm install ─────────────────────────
$changedFiles = git diff "$beforeHash" "$afterHash" --name-only
$pkgChanged = $changedFiles | Select-String -Pattern '^package(-lock)?\.json$' -Quiet
if ($pkgChanged) {
    Write-Host '[2/3] 偵測到 package.json 變動，重裝套件（1-3 分鐘）...'
    & $npmCmd install --legacy-peer-deps
    if ($LASTEXITCODE -ne 0) {
        Write-Host '❌ npm install 失敗' -ForegroundColor Red
        Read-Host '按 Enter 結束'
        exit 1
    }
    Write-Host '  ✓ npm install 完成' -ForegroundColor Green
} else {
    Write-Host '[2/3] 套件依賴無變動，跳過 npm install' -ForegroundColor DarkGray
}
Write-Host ''

# ── 3. build ──────────────────────────────────────────
Write-Host '[3/3] 編譯（30 秒～1 分鐘）...'
& $npmCmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host '❌ build 失敗' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}
Write-Host '  ✓ build 完成' -ForegroundColor Green
Write-Host ''

# ── 摘要 ─────────────────────────────────────────────
Write-Host '╔══════════════════════════════════╗' -ForegroundColor Green
Write-Host '║  ✓ 更新完成                      ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host "版本：$($beforeHash.Substring(0,7)) → $($afterHash.Substring(0,7))" -ForegroundColor Cyan

# 顯示這次更新涉及的檔案（最多 15 個）
$shortList = $changedFiles | Select-Object -First 15
if ($shortList) {
    Write-Host ''
    Write-Host '改動檔案：' -ForegroundColor Cyan
    foreach ($f in $shortList) { Write-Host "  • $f" -ForegroundColor Gray }
    if ($changedFiles.Count -gt 15) {
        Write-Host "  ...（還有 $($changedFiles.Count - 15) 個）" -ForegroundColor DarkGray
    }
}

Write-Host ''
Write-Host '下一步：' -ForegroundColor Cyan
Write-Host '  1. 如果 App 正在跑 → 關掉那個黑色 PS 視窗（server 會停）'
Write-Host '  2. 雙擊桌面【隱形矯正追蹤】捷徑重新啟動'
Write-Host '  3. 如果用 PWA → 在 App 視窗按 Ctrl+R 重整'
Write-Host ''
Read-Host '按 Enter 關閉'
