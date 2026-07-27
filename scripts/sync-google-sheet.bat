@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\sync-google-sheet.mjs >> logs\sheet-sync.log 2>&1
