@echo off
chcp 65001 >nul
title 隱形矯正追蹤 安裝程式
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安裝\install.ps1" -BundlePath "%~dp0"
