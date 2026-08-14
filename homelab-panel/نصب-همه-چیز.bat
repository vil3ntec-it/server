@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title نصبِ کاملِ سرورِ خانگی + دستیارِ هوشمند

echo.
echo ═══════════════════════════════════════════════════════════
echo    نصبِ کامل — سرورِ خانگی و دستیارِ هوشمند
echo ═══════════════════════════════════════════════════════════
echo.
echo   یک بار اجرا کن و برو چای بخور. همه‌چیز خودکار است:
echo.
echo     ۱. وابستگی‌های پنل نصب می‌شود
echo     ۲. Ollama نصب می‌شود
echo     ۳. مدلِ مناسبِ همین کامپیوتر دانلود می‌شود
echo     ۴. دانشِ برنامه ایندکس می‌شود
echo     ۵. پنل بالا می‌آید و دستیار خودش با آن روشن می‌شود
echo.
echo   حجمِ دانلود: حدود ۳ گیگابایت. پنجره را نبند.
echo.
pause

REM ═══════════ Node ═══════════
echo.
echo [۱/۴] بررسیِ Node.js…
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js نصب نیست.
  echo       از https://nodejs.org نصبش کن ^(نسخهٔ 22 به بالا^)، بعد دوباره اینجا برگرد.
  echo.
  echo   می‌خواهی همین حالا صفحهٔ دانلودش را باز کنم؟ ^(کلید بزن^)
  pause >nul
  start "" https://nodejs.org
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [OK] Node.js %%v

REM ═══════════ وابستگی‌های پنل ═══════════
echo.
echo [۲/۴] نصبِ وابستگی‌های پنل…
pushd server
if exist node_modules (
  echo   [OK] از قبل نصب است
) else (
  call npm install
  if errorlevel 1 (
    echo   [X] نصب نشد. اینترنت را بررسی کن.
    popd
    pause
    exit /b 1
  )
  echo   [OK] نصب شد
)
popd

REM ═══════════ مغزِ دستیار ═══════════
echo.
echo [۳/۴] نصبِ مغزِ دستیار…
echo.
REM ⚠️ آن اسکریپت خودش cd می‌کند و چون با call در همین پنجره اجرا می‌شود،
REM    مسیرِ جاری را هم عوض می‌کند. با pushd/popd سرِ جایش برمی‌گردانیم،
REM    وگرنه «cd server» پایین‌تر شکست می‌خورد.
if exist "..\ai-support\نصب-مغز.bat" (
  pushd .
  call "..\ai-support\نصب-مغز.bat" auto
  popd
) else (
  echo   [!] پوشهٔ ai-support کنارِ پنل نیست.
  echo       دستیار در حالتِ ساده کار می‌کند.
)

REM ═══════════ اجرا ═══════════
echo.
echo [۴/۴] بالا آوردنِ سرور…
echo.
echo ═══════════════════════════════════════════════════════════
echo    همه‌چیز آماده است
echo ═══════════════════════════════════════════════════════════
echo.
echo   پنل الان بالا می‌آید و دستیار خودش با آن روشن می‌شود.
echo   دنبالِ این خط بگرد:
echo.
echo      دستیارِ پشتیبانی روشن شد ^(پورت 8788^)
echo.
echo   بعدش سایت را باز کن: رباتِ دستیار ^<- تبِ «پشتیبانی هوشمند»
echo.
echo   دفعهٔ بعد فقط  server\start-windows.bat  را بزن.
echo.
pause

cd server
call start-windows.bat
