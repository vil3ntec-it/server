@echo off
REM ---------------------------------------------------------------------------
REM   نصبِ برنامهٔ سرور خانگی — همین فایل را دوبار کلیک کنید.
REM   یک پنجرهٔ نصب باز می‌شود: پوشه را انتخاب می‌کنید و «نصب کن» را می‌زنید.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

if exist "%~dp0homelab-panel\desktop\install-hidden.vbs" (
  start "" wscript.exe "%~dp0homelab-panel\desktop\install-hidden.vbs"
  exit
)

start "" powershell -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0homelab-panel\desktop\install.ps1"
exit
