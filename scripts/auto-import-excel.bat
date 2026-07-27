@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem NOTE: auto-import-excel.mjs writes logs\excel-import.log itself (internal log stream).
rem Do NOT redirect stdout to that same file here - Windows file lock clash => node EBUSY.
rem Only tee stderr to a separate file, to catch crashes before the log stream opens.
rem Keep this file ASCII-only: CJK in .bat comments breaks cmd parsing.
node scripts\auto-import-excel.mjs 2>> logs\excel-import-task.log
