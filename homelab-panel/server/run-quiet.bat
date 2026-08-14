@echo off
REM ---------------------------------------------------------------------------
REM  اجرای پنل بدون هیچ پنجره‌ای — همهٔ خروجی در data\panel.log می‌نشیند.
REM  این فایل را مستقیم اجرا نکنید؛ service-windows.bat آن را صدا می‌زند.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist data mkdir data

where node >nul 2>nul
if errorlevel 1 (
  echo [%date% %time%] Node.js not found >> data\panel.log
  exit /b 1
)

if not exist node_modules (
  echo [%date% %time%] installing dependencies... >> data\panel.log
  call npm install --omit=dev --no-audit --no-fund >> data\panel.log 2>&1
)

echo [%date% %time%] starting panel >> data\panel.log
node --disable-warning=ExperimentalWarning src\index.js >> data\panel.log 2>&1
echo [%date% %time%] panel stopped (exit %errorlevel%) >> data\panel.log
