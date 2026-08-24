@echo off
REM ---------------------------------------------------------------------------
REM   حذفِ برنامهٔ سرور خانگی — پنجره‌ای باز می‌شود و می‌پرسد دادهٔ شما بماند یا نه.
REM ---------------------------------------------------------------------------
chcp 65001 >nul 2>nul
cd /d "%~dp0"
start "" powershell -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "uninstall.ps1"
exit
