@echo off
REM Home server panel launcher (Windows)
setlocal
cd /d "%~dp0"

set "PANEL_PORT=4700"
if not "%HLP_PORT%"=="" set "PANEL_PORT=%HLP_PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install Node.js 22 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   Installing dependencies ^(first run only^)...
  echo.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo   Install failed. Check your internet connection.
    pause
    exit /b 1
  )
)

echo.
echo   ============================================================
echo     The panel is NOT a file you open by double-clicking.
echo     It runs here, and you view it in your browser at:
echo.
echo         http://localhost:%PANEL_PORT%
echo.
echo     The browser will open by itself in a few seconds.
echo     Keep this window open. To stop the panel, press Ctrl+C.
echo   ============================================================
echo.

REM مرورگر چند ثانیه بعد باز می‌شود — وقتی سرور بالا آمده باشد
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start """" http://localhost:%PANEL_PORT%"

node --disable-warning=ExperimentalWarning src\index.js
pause
