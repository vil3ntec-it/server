@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title نصب مرکز فرمان
cd /d "%~dp0"

echo.
echo ==============================================================
echo    نصب مرکز فرمان و پنل سرور خانگی
echo ==============================================================
echo.

REM ── ۱) Node.js ────────────────────────────────────────────────────────────
echo [1/5] بررسی Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js نصب نیست.
  echo.
  echo       به nodejs.org بروید و نسخهٔ LTS ^(۲۲ یا بالاتر^) را نصب کنید،
  echo       بعد این فایل را دوباره اجرا کنید.
  echo.
  start https://nodejs.org/fa/download
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -p "process.versions.node"') do set NODEMAJOR=%%a
if !NODEMAJOR! LSS 22 (
  echo.
  echo   [X] Node.js نسخهٔ !NODEMAJOR! دارید؛ نسخهٔ ۲۲ یا بالاتر لازم است.
  echo       از nodejs.org نسخهٔ تازه را نصب کنید.
  echo.
  start https://nodejs.org/fa/download
  pause
  exit /b 1
)
echo       [OK] Node.js نسخهٔ !NODEMAJOR!

REM ── ۲) وابستگی‌ها ─────────────────────────────────────────────────────────
echo.
echo [2/5] نصب وابستگی‌ها ^(فقط بار اول، به اینترنت نیاز دارد^) ...
cd server
if exist "node_modules\express" (
  echo       [OK] از قبل نصب است
) else (
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [X] نصب وابستگی‌ها ناموفق بود. اینترنت را بررسی کنید.
    pause
    exit /b 1
  )
  echo       [OK] نصب شد
)

REM ── ۳) فایل تنظیمات ───────────────────────────────────────────────────────
echo.
echo [3/5] فایل تنظیمات ...
if exist ".env" (
  echo       [OK] .env از قبل هست — دست نخورد
) else (
  copy /y ".env.example" ".env" >nul
  echo       [OK] .env از روی نمونه ساخته شد
)

REM ── ۴) بررسی سلامت ────────────────────────────────────────────────────────
echo.
echo [4/5] بررسی سلامت نصب ...
node --disable-warning=ExperimentalWarning scripts\doctor.mjs
if errorlevel 1 (
  echo.
  echo   [X] بررسی سلامت مشکل پیدا کرد. پیام بالا را بخوانید.
  pause
  exit /b 1
)

REM ── ۵) اجرا ───────────────────────────────────────────────────────────────
echo.
echo [5/5] راه‌اندازی پنل ...
echo.
echo ==============================================================
echo    آدرس پنل روی همین کامپیوتر:  http://localhost:4700
echo.
echo    بار اول یک نام کاربری و رمز مدیر می‌سازید.
echo    برای بستن، این پنجره را ببندید یا Ctrl+C بزنید.
echo ==============================================================
echo.

node --disable-warning=ExperimentalWarning src\index.js

echo.
echo پنل بسته شد.
pause
