@echo off
chcp 65001 >nul
REM ═══════════════════════════════════════════════════════════════════════════
REM   نصبِ دستیارِ پشتیبانی — ویندوز
REM   روی همین فایل دوبار کلیک کن.
REM ═══════════════════════════════════════════════════════════════════════════
cd /d "%~dp0"

echo.
echo ==========================================================
echo    نصبِ دستیارِ پشتیبانیِ پمپ یعقوبی
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js پیدا نشد.
  echo     از https://nodejs.org نصبش کن ^(نسخهٔ 20 به بالا^) و دوباره اجرا کن.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo [OK] Node.js %NODEV%
echo      هیچ npm install ای لازم نیست — این سرویس وابستگی ندارد.
echo.

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [OK] فایلِ .env ساخته شد
) else (
  echo [i]  فایلِ .env از قبل هست — دست نخورد
)
echo.

node bin\detect-hardware.mjs
echo.

set /p ANS="تنظیماتِ پیشنهادی نوشته شود؟ [y/N] "
if /i "%ANS%"=="y" node bin\detect-hardware.mjs --apply
echo.

where ollama >nul 2>nul
if errorlevel 1 (
  echo [i]  Ollama نصب نیست. سرویس بدونِ آن هم کار می‌کند.
  echo      برای مغزِ واقعی: https://ollama.com/download
) else (
  echo [OK] Ollama نصب است
)
echo.

echo ساختِ ایندکسِ دانش...
node bin\build-index.mjs
echo.

echo اجرای تست‌ها...
node test\run-all.mjs >nul 2>nul
if errorlevel 1 (echo [!] بعضی تست‌ها شکست خوردند — برای جزئیات: npm test) else (echo [OK] همهٔ تست‌ها قبول)
echo.

echo ----------------------------------------------------------
echo   تمام. برای اجرا روی start-windows.bat دوبار کلیک کن.
echo   و در برنامه: رباتِ دستیار ^<- تبِ «پشتیبانی هوشمند»
echo ----------------------------------------------------------
echo.
pause
