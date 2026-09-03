@echo off
REM ---------------------------------------------------------------------------
REM   ساختِ آدرسِ ثابت — همین فایل را دوبار کلیک کنید.
REM
REM   همان سه کاری را می‌کند که دکمهٔ «ساخت آدرس ثابت» در پنل می‌کند، ولی
REM   بدونِ گشتن در صفحه‌ها:
REM       ۱) ورود به حساب Cloudflare (فقط اگر قبلاً وارد نشده باشید)
REM       ۲) ساختِ تونل
REM       ۳) وصل کردنِ زیردامنه
REM
REM   زیردامنه را می‌شود جلوی همین فایل نوشت:
REM       ساخت-آدرس-ثابت.bat sync.vill3n.top
REM   ننویسید، همان api.vill3n.top گرفته می‌شود.
REM ---------------------------------------------------------------------------
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "HOST=%~1"
if "%HOST%"=="" set "HOST=api.vill3n.top"
set "TUNNEL=control-center"

echo.
echo   ==========================================================
echo     ساختِ آدرسِ ثابت برای:  %HOST%
echo   ==========================================================
echo.

REM ---- پیدا کردنِ cloudflared -------------------------------------------------
REM  اول کنارِ خودِ برنامه، بعد جاهای همیشگی، آخر هم PATH.
set "CF="
for %%P in (
  "%~dp0homelab-panel\server\data\bin\cloudflared.exe"
  "%~dp0data\bin\cloudflared.exe"
  "%~dp0bin\cloudflared.exe"
  "%LOCALAPPDATA%\ControlCenter\bin\cloudflared.exe"
  "%ProgramData%\ControlCenter\bin\cloudflared.exe"
) do if not defined CF if exist %%P set "CF=%%~P"

if not defined CF (
  for /f "delims=" %%W in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%W"
)

if not defined CF (
  echo   cloudflared.exe پیدا نشد.
  echo.
  echo   مسیرش را می‌دانید؟ فایلِ cloudflared.exe را با ماوس بگیرید و
  echo   روی همین فایل رها کنید — یا مسیرش را این‌جا بنویسید و Enter بزنید.
  echo   (مثال:  D:\server\New folder ^(2^)\bin\cloudflared.exe )
  echo.
  set /p "CF=مسیر: "
)

if not exist "%CF%" (
  echo.
  echo   پیدا نشد: %CF%
  echo   یک‌بار پنل را باز کنید و صفحهٔ «آدرس اینترنتی» را ببینید —
  echo   خودش cloudflared را دانلود می‌کند. بعد دوباره این فایل را بزنید.
  echo.
  pause
  exit /b 1
)
echo   cloudflared:  %CF%
echo.

REM ---- گام ۱: ورود ------------------------------------------------------------
if exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo   [۱/۳] از قبل وارد شده‌اید.
) else (
  echo   [۱/۳] مرورگر باز می‌شود. وارد حساب Cloudflare شوید و دامنه را تایید کنید.
  echo.
  "%CF%" tunnel login
  if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
    echo.
    echo   ورود کامل نشد. دوباره این فایل را بزنید.
    echo.
    pause
    exit /b 1
  )
)
echo.

REM ---- گام ۲: ساختِ تونل ------------------------------------------------------
REM  اگر از قبل هست، خطایش را نادیده می‌گیریم — تونل که هست، همان کافی است.
REM  خروجیِ ناموفق این‌جا مشکلی نیست: «already exists» یعنی تونل هست و
REM  همان به کار می‌آید. فقط گام سه باید موفق شود.
echo   [۲/۳] ساختِ تونل «%TUNNEL%»...
"%CF%" tunnel create %TUNNEL%
echo.

REM ---- گام ۳: وصل کردنِ زیردامنه ----------------------------------------------
echo   [۳/۳] وصل کردنِ %HOST% به تونل...
"%CF%" tunnel route dns --overwrite-dns %TUNNEL% %HOST%
if errorlevel 1 (
  echo.
  echo   وصل نشد. معمولاً یعنی این دامنه در همان حسابی نیست که با آن وارد شدید.
  echo   متنِ بالا را برای مهندس بفرستید.
  echo.
  pause
  exit /b 1
)

echo.
echo   ==========================================================
echo     تمام شد.
echo.
echo     آدرسِ سرور:   https://%HOST%
echo.
echo     حالا پنل را باز کنید:  آدرس اینترنتی  ^<  آدرس ثابت
echo     و دکمهٔ «ساخت آدرس ثابت» را بزنید تا پنل بقیه‌اش را تمام کند.
echo   ==========================================================
echo.
pause
