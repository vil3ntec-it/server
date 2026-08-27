@echo off
chcp 65001 >nul
title به‌روزرسانی از GitHub
cd /d "%~dp0server"

echo.
echo ==============================================================
echo   به‌روزرسانی برنامه از GitHub
echo ==============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js پیدا نشد.
  echo     از nodejs.org نسخهٔ 22 به بالا را نصب کنید و دوباره امتحان کنید.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [*] نصب وابستگی‌ها...
  call npm install --omit=dev --no-audit --no-fund
)

node scripts\update.mjs %*
set CODE=%errorlevel%

echo.
if "%CODE%"=="0" (
  echo [OK] تمام شد. حالا start-windows.bat را اجرا کنید.
) else if "%CODE%"=="10" (
  echo [i] فقط بررسی شد.
) else (
  echo [X] به‌روزرسانی ناموفق بود. نسخهٔ قبلی دست‌نخورده است.
)
echo.
pause
