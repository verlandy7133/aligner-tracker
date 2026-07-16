@echo off
chcp 65001 > nul
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\backup-from-nas.mjs
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
  echo [backup-nas] node exit %EXITCODE% ^-- 備份失敗
  REM 失敗要能叫：node 端已寫 logs\backup-FAILED-<date>.flag（可靠、給 vault 監控掃）。
  REM 這裡再 best-effort 送一則 Telegram（tg-notify.ps1 存在才試、失敗也不影響 exit code）。
  set "TGNOTIFY=D:\Dropbox\Dropbox\claude code\000_Agent\hooks\tg-notify.ps1"
  if exist "%TGNOTIFY%" (
    echo {"tool_name":"Bash","tool_input":{"command":"aligner 每日備份失敗 exit %EXITCODE% ^-- 檢查 logs\backup-FAILED-*.flag / logs\backup-*.log"}} | powershell -NoProfile -ExecutionPolicy Bypass -File "%TGNOTIFY%" > nul 2>&1
  )
)

exit /b %EXITCODE%
