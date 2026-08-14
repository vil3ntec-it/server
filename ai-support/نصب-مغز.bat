@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title نصبِ مغزِ دستیارِ هوشمند

REM وقتی «نصب-همه-چیز» این را صدا می‌زند، با auto اجرا می‌شود تا کاربر دوبار
REM پشتِ سرِ هم Enter نزند.
set "AUTO=0"
if /i "%~1"=="auto" set "AUTO=1" 

echo.
echo ═══════════════════════════════════════════════════════════
echo    نصبِ «مغز» دستیارِ هوشمند
echo    همه‌چیز خودکار — فقط صبر کن
echo ═══════════════════════════════════════════════════════════
echo.
echo   این اسکریپت خودش این کارها را می‌کند:
echo     ۱. Ollama را نصب می‌کند (اگر نباشد)
echo     ۲. می‌بیند کامپیوترت چه مدلی را می‌کِشد
echo     ۳. همان مدل را دانلود می‌کند
echo     ۴. دانشِ برنامه را ایندکس می‌کند
echo.
echo   حجمِ دانلود حدود ۲ تا ۳ گیگابایت است.
echo.
if "%AUTO%"=="0" pause

REM ═══════════════════ ۱) Node ═══════════════════
echo.
echo [۱/۵] بررسیِ Node.js…
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js نصب نیست.
  echo       از https://nodejs.org نصبش کن ^(نسخهٔ 22 به بالا^) و دوباره اجرا کن.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [OK] Node.js %%v

REM ═══════════════════ ۲) Ollama ═══════════════════
echo.
echo [۲/۵] بررسیِ Ollama…

set "OLLAMA=ollama"
where ollama >nul 2>nul
if not errorlevel 1 goto :ollama_ready

REM شاید نصب باشد ولی در PATH نباشد — مسیرِ همیشگی‌اش را هم ببین
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
  set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
  goto :ollama_ready
)

echo   Ollama نصب نیست — نصبش می‌کنم…
echo.

REM راهِ اول: winget ^(روی ویندوز ۱۰ به بعد هست^)
where winget >nul 2>nul
if not errorlevel 1 (
  echo   [تلاش ۱] نصب با winget…
  winget install --id Ollama.Ollama -e --silent --accept-source-agreements --accept-package-agreements
  timeout /t 3 /nobreak >nul
  if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
    set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
    goto :ollama_ready
  )
  where ollama >nul 2>nul
  if not errorlevel 1 goto :ollama_ready
)

REM راهِ دوم: دانلودِ مستقیمِ نصب‌کننده
echo   [تلاش ۲] دانلودِ مستقیم…
set "SETUP=%TEMP%\OllamaSetup.exe"
powershell -NoProfile -Command "try { $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile '%SETUP%' -UseBasicParsing; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo   [X] دانلود نشد. اینترنت را بررسی کن، یا دستی نصب کن:
  echo       https://ollama.com/download
  echo.
  pause
  exit /b 1
)

echo   نصب‌کننده باز می‌شود — روی Install بزن و منتظر بمان.
echo.
"%SETUP%"
echo.
echo   وقتی نصب تمام شد، یک کلید بزن تا ادامه بدهم…
pause >nul

if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
  set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
  goto :ollama_ready
)
where ollama >nul 2>nul
if errorlevel 1 (
  echo   [X] هنوز پیدا نشد. کامپیوتر را ری‌استارت کن و دوباره این فایل را اجرا کن.
  pause
  exit /b 1
)

:ollama_ready
echo   [OK] Ollama آماده است

REM سرویسش باید بالا باشد تا pull کار کند
echo   بالا آوردنِ سرویسِ Ollama…
start "" /b "%OLLAMA%" serve >nul 2>nul
timeout /t 4 /nobreak >nul

REM ═══════════════════ ۳) انتخابِ مدل ═══════════════════
echo.
echo [۳/۵] بررسیِ سخت‌افزار و انتخابِ مدل…
set "MODEL="
for /f "usebackq delims=" %%m in (`node bin\detect-hardware.mjs --print-model`) do set "MODEL=%%m"

if "!MODEL!"=="" (
  echo.
  echo   [!] رَمِ این کامپیوتر برای اجرای مدلِ محلی کافی نیست.
  echo       دستیار باز هم کار می‌کند، ولی جواب‌ها مستقیم از مستندات می‌آیند.
  echo       ^(اگر مطمئنی، می‌توانی دستی این را نصب کنی:^)
  echo         ollama pull qwen2.5:1.5b-instruct-q4_K_M
  echo.
  goto :build_index
)
echo   [OK] مدلِ مناسبِ این کامپیوتر: !MODEL!

REM ═══════════════════ ۴) دانلودِ مدل ═══════════════════
echo.
echo [۴/۵] دانلودِ مدل — این مرحله طولانی است، پنجره را نبند…
echo.
"%OLLAMA%" pull !MODEL!
if errorlevel 1 (
  echo.
  echo   [X] دانلودِ مدل نشد. اینترنت را بررسی کن و دوباره اجرا کن.
  echo       ^(چیزی خراب نشده — هر بار از همان‌جا که مانده ادامه می‌دهد.^)
  pause
  exit /b 1
)

echo.
echo   دانلودِ مدلِ جست‌وجوی معنایی…
"%OLLAMA%" pull nomic-embed-text
if errorlevel 1 echo   [!] این یکی نشد — جست‌وجو با کلمات کار می‌کند، فقط کمی ضعیف‌تر.

REM تنظیماتِ مناسبِ همین کامپیوتر نوشته شود
node bin\detect-hardware.mjs --apply >nul 2>nul

REM ═══════════════════ ۵) ایندکس ═══════════════════
:build_index
echo.
echo [۵/۵] ساختِ ایندکسِ دانش…
node bin\build-index.mjs
if errorlevel 1 (
  echo   [!] ایندکس ساخته نشد — سرویس خودش موقعِ اجرا می‌سازدش.
)

REM ═══════════════════ تمام ═══════════════════
echo.
echo ═══════════════════════════════════════════════════════════
echo    ✅ تمام شد
echo ═══════════════════════════════════════════════════════════
echo.
if not "!MODEL!"=="" (
  echo   مغزِ دستیار نصب شد: !MODEL!
  echo.
  echo   حالا پنلِ سرور را یک بار ببند و دوباره باز کن.
  echo   بعدش در سایت: رباتِ دستیار ^<- تبِ «پشتیبانی هوشمند»
  echo.
  echo   دیگر کنارِ جواب‌ها «از مستندات» نمی‌نویسد.
) else (
  echo   دستیار در حالتِ «فقط مستندات» کار می‌کند.
)
echo.
if "%AUTO%"=="0" pause
