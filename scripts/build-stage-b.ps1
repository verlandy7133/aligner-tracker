# 一鍵 build + export Stage B Docker image (aligner-viewer) 到 NAS sync 資料夾
#
# 流程：
#   1. 讀 package.json version
#   2. docker build -t aligner-viewer:<version>
#   3. docker save -o <NAS sync 資料夾>\stage-b\aligner-viewer-<version>.tar
#   4. Drive Client 自動 sync tar 到 NAS
#   5. (手動) DSM Docker UI 載入 tar、replace container
#
# 用法：
#   pwsh -ExecutionPolicy Bypass -File scripts\build-stage-b.ps1
#   或：npm run build-viewer

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content "$repoRoot\package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

# NAS sync 資料夾 — 之後若改 path 改這
$nasSyncFolders = @(
    'D:\診所nas 矯正追蹤\SynologyDrive\stage-b',           # D 機 Drive Client 路徑
    'W:\0矯正追蹤\stage-b',                                # 樓上筆電 W: 路徑
    'C:\SynologyDrive\0矯正追蹤\stage-b'                   # fallback
)
$outDir = $null
foreach ($p in $nasSyncFolders) {
    $parent = Split-Path -Parent $p
    if (Test-Path $parent) {
        if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
        $outDir = $p
        break
    }
}
if (-not $outDir) {
    Write-Host '❌ 找不到 NAS sync 資料夾（試了 D:\診所nas 矯正追蹤、W:\0矯正追蹤、C:\SynologyDrive\0矯正追蹤）' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '╔══════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║  Stage B Image Build & Export            ║' -ForegroundColor Cyan
Write-Host '╚══════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host "  version: $version"
Write-Host "  output:  $outDir\aligner-viewer-$version.tar"
Write-Host ''

# 1. Docker daemon check
$dockerCheck = docker version --format '{{.Server.Version}}' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker daemon 沒在跑、開 Docker Desktop 再試" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker daemon $dockerCheck" -ForegroundColor DarkGray
Write-Host ''

# 2. Build
Write-Host "[1/2] docker build -t aligner-viewer:$version  (預計 5-10 分鐘)..." -ForegroundColor Yellow
docker build -t "aligner-viewer:$version" $repoRoot
if ($LASTEXITCODE -ne 0) {
    Write-Host '❌ docker build 失敗' -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ image built: aligner-viewer:$version" -ForegroundColor Green
Write-Host ''

# 3. Export tar to NAS sync folder
$outFile = "$outDir\aligner-viewer-$version.tar"
Write-Host "[2/2] docker save → $outFile..." -ForegroundColor Yellow
docker save "aligner-viewer:$version" -o $outFile
if ($LASTEXITCODE -ne 0) {
    Write-Host '❌ docker save 失敗' -ForegroundColor Red
    exit 1
}
$sizeMB = [Math]::Round((Get-Item $outFile).Length / 1MB, 1)
Write-Host "  ✓ tar 寫好 ($sizeMB MB)" -ForegroundColor Green
Write-Host ''

# 4. 清掉 .tar 內 stage-b/ 資料夾的舊版（保留最近 3 個）
$oldTars = Get-ChildItem -Path $outDir -Filter 'aligner-viewer-*.tar' | Sort-Object LastWriteTime -Descending
if ($oldTars.Count -gt 3) {
    $toDelete = $oldTars | Select-Object -Skip 3
    Write-Host "清掉舊 tar（保留最近 3 個）:" -ForegroundColor DarkGray
    foreach ($f in $toDelete) {
        Write-Host "  rm $($f.Name)" -ForegroundColor DarkGray
        Remove-Item $f.FullName -Force
    }
    Write-Host ''
}

# Summary + 下一步
Write-Host '╔══════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║  ✓ Build & Export Done                   ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host 'Next steps (手動):' -ForegroundColor Cyan
Write-Host '  1. 等 Synology Drive Client 自動 sync tar 到 NAS (~1-2 分鐘、看 D 機 tray icon)'
Write-Host '  2. NAS DSM → Docker (DSM 6.x) 或 Container Manager (DSM 7.x):'
Write-Host '       影像 → 新增 → 從檔案新增'
Write-Host '       選 NAS 上的 n歐耐恩n/0矯正追蹤/stage-b/aligner-viewer-' -NoNewline
Write-Host "$version.tar"
Write-Host '  3. 停舊 container "aligner-viewer" (右鍵停止) → 刪除舊 container (image 不刪、保留歷史)'
Write-Host '  4. 用新 image 建 container:'
Write-Host '       - 名稱: aligner-viewer'
Write-Host '       - 自動重新啟動: 啟用'
Write-Host '       - 連接埠: 8080 → 8080'
Write-Host '       - 共用資料夾: n歐耐恩n/0矯正追蹤 → /data (勾「唯讀」)'
Write-Host '  5. 啟動 + 確認:'
Write-Host '       Safari / Chrome 開 http://192.168.0.220:8080/api/health'
Write-Host '       應該看到 {"ok": true, "version": "' -NoNewline
Write-Host "$version" -NoNewline
Write-Host '"...}'
Write-Host '  6. iPad 內網 wifi 開 http://192.168.0.220:8080/'
Write-Host ''
