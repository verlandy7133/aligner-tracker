@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ============================================================
REM   aligner-tracker 升級到 v0.6.0 (NAS API + dual 模式)
REM
REM   用法：筆電上雙擊執行
REM   腳本會：
REM     1. git pull 拉最新 main branch
REM     2. 寫 .env.local 切到 dual 模式（指向 NAS 192.168.0.220）
REM     3. npm install 補齊 dependencies
REM     4. 問你要不要立刻開 dev server
REM
REM   再次執行也安全（idempotent）
REM ============================================================

cd /d "%~dp0"

echo.
echo ╔════════════════════════════════════════════╗
echo ║  aligner-tracker v0.6.0 升級腳本           ║
echo ╚════════════════════════════════════════════╝
echo.

REM 1. 確認在 repo 內
if not exist package.json (
    echo [錯誤] 找不到 package.json、不在 repo 內？
    echo cwd: %CD%
    echo 請把這 .bat 放到 aligner-tracker repo 根目錄
    pause
    exit /b 1
)

echo [1/5] 當前狀態
git branch --show-current 2>nul
findstr /C:"\"version\"" package.json
echo.

REM 2. git pull
echo [2/5] git pull origin main
git pull origin main
if errorlevel 1 (
    echo.
    echo [錯誤] git pull 失敗
    echo - 有未 commit 的 local 改動？先 stash 或 commit
    echo - 網路問題？檢查能不能連 github / 內部 git server
    pause
    exit /b 1
)
echo.

REM 3. 確認 / 建立 .env.local
echo [3/5] .env.local（切 dual 模式 + 指向 NAS）
if exist .env.local (
    echo .env.local 已存在、內容：
    type .env.local
    echo.
    echo 不覆蓋 ^(如果要重設、手動刪了再跑一次^)
) else (
    echo 建立 .env.local...
    (
        echo # 筆電（診所 LAN^）切到 v0.6.0 dual 模式
        echo # API 直連 NAS server、SSE 即時同步
        echo VITE_DATA_MODE=dual
        echo VITE_API_BASE=http://192.168.0.220:8080
    ) > .env.local
    type .env.local
)
echo.

REM 4. npm install
echo [4/5] npm install（確認 deps 同步）
call npm install
if errorlevel 1 (
    echo.
    echo [錯誤] npm install 失敗
    pause
    exit /b 1
)
echo.

REM 5. 驗證 NAS 通
echo [5/5] 測 NAS server (192.168.0.220:8080)
curl -s -o nul -w "  /api/health → HTTP %%{http_code} in %%{time_total}s\n" --max-time 5 http://192.168.0.220:8080/api/health 2>nul
if errorlevel 1 (
    echo   [警告] 連不到 NAS！
    echo   - 確認筆電在診所 wifi
    echo   - 確認 NAS aligner-viewer container 跑著
    echo   - 之後 dev server 上線 OnlineStatus 會顯示「離線」
)
echo.

echo ╔════════════════════════════════════════════╗
echo ║  ✓ 升級完成                                ║
echo ╚════════════════════════════════════════════╝
echo.
echo 下一步：
echo   1. 跑 dev server：npm run dev
echo   2. 瀏覽器開 http://localhost:5174/
echo   3. 右上角應該看到 🟢 同步中
echo   4. 進病患詳細頁、改個筆記試試 — D 機那邊 SSE 會即時收到
echo.

set /p answer=現在啟動 dev server? (Y/n):
if /i "!answer!"=="n" goto end
if /i "!answer!"=="no" goto end

echo.
echo 啟動 dev server...（Ctrl+C 結束）
echo.
call npm run dev

:end
endlocal
echo.
pause
