@echo off
REM ---------------------------------------------------------------------------
REM   برنامهٔ سرور خانگی — این فایل را دوبار کلیک کنید.
REM   پنجرهٔ برنامه باز می‌شود (پنجرهٔ سیاه فقط یک لحظه دیده می‌شود و می‌رود).
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo   PowerShell پیدا نشد. این برنامه فقط روی ویندوز کار می‌کند.
  echo.
  pause
  exit /b 1
)

start "" powershell -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app.ps1"
exit
