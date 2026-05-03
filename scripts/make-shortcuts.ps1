# 一鍵建桌面捷徑：隱形矯正追蹤（啟動）+ 更新
# 用法：在 PowerShell 跑這行
#   powershell -ExecutionPolicy Bypass -File C:\dev\矯正追蹤-app\scripts\make-shortcuts.ps1
# 或 D 槽：
#   powershell -ExecutionPolicy Bypass -File D:\dev\矯正追蹤-app\scripts\make-shortcuts.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 偵測 App 目錄
$appDir = $null
foreach ($candidate in @('C:\dev\矯正追蹤-app', 'D:\dev\矯正追蹤-app')) {
    if (Test-Path $candidate) { $appDir = $candidate; break }
}
if (-not $appDir) {
    Write-Host '❌ 找不到 App 目錄' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}
Write-Host "App 目錄：$appDir" -ForegroundColor Gray

# 偵測 Node
$nodeExe = $null
foreach ($p in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
    if (Test-Path $p) { $nodeExe = $p; break }
}
if (-not $nodeExe) {
    Write-Host '❌ 找不到 Node.js' -ForegroundColor Red
    Read-Host '按 Enter 結束'
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

# 找最佳 icon：優先用 .ico（Windows 捷徑顯示效果最好）、退到 .png
$icon = $null
foreach ($cand in @('public\icon.ico', 'public\favicon.png', 'public\icon-512.png')) {
    $p = Join-Path $appDir $cand
    if (Test-Path $p) { $icon = $p; break }
}

# 1. 啟動捷徑
$lnk1 = $shell.CreateShortcut((Join-Path $desktop '隱形矯正追蹤.lnk'))
$lnk1.TargetPath = $nodeExe
$lnk1.Arguments = '"' + (Join-Path $appDir 'scripts\start-clinic.mjs') + '"'
$lnk1.WorkingDirectory = $appDir
$lnk1.Description = '隱形矯正追蹤 — 啟動 server + Chrome'
if ($icon) { $lnk1.IconLocation = "$icon,0" }
$lnk1.Save()
Write-Host "  ✓ 桌面建：隱形矯正追蹤.lnk" -ForegroundColor Green

# 2. 更新捷徑（用 shell32.dll 的下載/重整 icon、跟啟動 icon 區分）
$updateBat = Join-Path $appDir '更新.bat'
if (Test-Path $updateBat) {
    $lnk2 = $shell.CreateShortcut((Join-Path $desktop '更新.lnk'))
    $lnk2.TargetPath = $updateBat
    $lnk2.WorkingDirectory = $appDir
    $lnk2.Description = '從 GitHub 拉最新版（master 才能用）'
    # shell32.dll,238 = 雲端下載 icon（很適合「更新」）
    $lnk2.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
    $lnk2.Save()
    Write-Host "  ✓ 桌面建：更新.lnk" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ 找不到 $updateBat，跳過更新捷徑" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '✓ 完成。雙擊桌面【隱形矯正追蹤】啟動。' -ForegroundColor Cyan
