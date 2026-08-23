@echo off
REM ---------------------------------------------------------------------------
REM   برنامهٔ سرور خانگی — این فایل را دوبار کلیک کنید.
REM   (بعد از نصب، بهتر است از میان‌برِ روی دسکتاپ باز کنید: اصلاً پنجرهٔ سیاه ندارد)
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

if exist "%~dp0launch.vbs" (
  start "" wscript.exe "%~dp0launch.vbs"
  exit
)

start "" powershell -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app.ps1"
exit
