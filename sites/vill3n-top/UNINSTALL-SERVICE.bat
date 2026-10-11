@echo off
rem VILL3N site - stop the background service and remove it from Windows start-up. Your data stays untouched.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\service.ps1" remove
echo.
pause
