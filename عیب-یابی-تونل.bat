@echo off
REM ===========================================================================
REM   Tunnel diagnostic report. Double-click, then send the screenshot.
REM   ASCII only, no parenthesised blocks - see notes in create-address bat.
REM ===========================================================================
setlocal
set "OUT=%USERPROFILE%\Desktop\tunnel-report.txt"
set "CF="

echo. > "%OUT%"
echo   ==========================================================
echo     Tunnel report - this also gets saved to your Desktop
echo   ==========================================================
echo.

REM ---- find cloudflared -----------------------------------------------------
if exist "%~dp0bin\cloudflared.exe" set "CF=%~dp0bin\cloudflared.exe"
if not defined CF if exist "D:\server\New folder (2)\bin\cloudflared.exe" set "CF=D:\server\New folder (2)\bin\cloudflared.exe"
if defined CF goto found
for /f "delims=" %%W in ('where cloudflared 2^>nul') do set "CF=%%W"
if defined CF goto found
echo   Looking for cloudflared.exe ...
for /f "delims=" %%F in ('dir /s /b "D:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto found
for /f "delims=" %%F in ('dir /s /b "C:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto found
echo   cloudflared.exe NOT FOUND anywhere.>> "%OUT%"
echo   cloudflared.exe NOT FOUND anywhere.
goto finish

:found
echo   cloudflared: %CF%
echo   cloudflared: %CF% >> "%OUT%"
echo.

REM ---- 1: is the certificate there, and for which account? ------------------
echo   ---- 1. LOGIN CERTIFICATE ----
echo ---- 1. LOGIN CERTIFICATE ---- >> "%OUT%"
if exist "%USERPROFILE%\.cloudflared\cert.pem" echo   cert.pem: YES
if exist "%USERPROFILE%\.cloudflared\cert.pem" echo cert.pem: YES >> "%OUT%"
if not exist "%USERPROFILE%\.cloudflared\cert.pem" echo   cert.pem: MISSING
if not exist "%USERPROFILE%\.cloudflared\cert.pem" echo cert.pem: MISSING >> "%OUT%"
echo.

REM ---- 2: does the tunnel have a live connection? ---------------------------
echo   ---- 2. TUNNEL INFO ----
echo. >> "%OUT%"
echo ---- 2. TUNNEL INFO ---- >> "%OUT%"
"%CF%" tunnel info control-center >> "%OUT%" 2>&1
"%CF%" tunnel info control-center 2>&1
echo.

REM ---- 3: which tunnels exist -----------------------------------------------
echo   ---- 3. TUNNEL LIST ----
echo. >> "%OUT%"
echo ---- 3. TUNNEL LIST ---- >> "%OUT%"
"%CF%" tunnel list >> "%OUT%" 2>&1
"%CF%" tunnel list 2>&1
echo.

REM ---- 4: the panel's own tunnel config -------------------------------------
echo   ---- 4. PANEL CONFIG ----
echo. >> "%OUT%"
echo ---- 4. PANEL CONFIG ---- >> "%OUT%"
set "CFG=D:\server\New folder (2)\cloudflared\config.yml"
if exist "%CFG%" type "%CFG%"
if exist "%CFG%" type "%CFG%" >> "%OUT%"
if not exist "%CFG%" echo   config.yml NOT FOUND at %CFG%
if not exist "%CFG%" echo config.yml NOT FOUND at %CFG% >> "%OUT%"
echo.

REM ---- 5: credentials files -------------------------------------------------
echo   ---- 5. CREDENTIAL FILES ----
echo. >> "%OUT%"
echo ---- 5. CREDENTIAL FILES ---- >> "%OUT%"
dir /b "%USERPROFILE%\.cloudflared\*.json" 2>nul
dir /b "%USERPROFILE%\.cloudflared\*.json" >> "%OUT%" 2>nul
dir /b "D:\server\New folder (2)\cloudflared\*.json" 2>nul
dir /b "D:\server\New folder (2)\cloudflared\*.json" >> "%OUT%" 2>nul

:finish
echo.
echo   ==========================================================
echo     Saved to:  %OUT%
echo     Send a screenshot, or send that file.
echo   ==========================================================
echo.
pause
