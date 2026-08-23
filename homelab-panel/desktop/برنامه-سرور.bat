@echo off
REM ---------------------------------------------------------------------------
REM   برنامهٔ سرور خانگی — این فایل را دوبار کلیک کنید.
REM   (بعد از نصب، بهتر است از میان‌برِ روی دسکتاپ باز کنید)
REM   اگر باز نشد: فایلِ «عیب‌یابی.bat» کنارِ همین فایل را بزنید.
REM ---------------------------------------------------------------------------
chcp 65001 >nul 2>nul
cd /d "%~dp0"

if exist "launch.vbs" (
  start "" wscript.exe "launch.vbs"
  exit
)

start "" powershell -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "app.ps1"
exit
