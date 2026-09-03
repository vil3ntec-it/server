@echo off
REM ===========================================================================
REM   Create the permanent address for the home server.
REM
REM   NOTE FOR MAINTAINERS: this file is deliberately ASCII-only.
REM   cmd.exe parses a .bat in the machine's ANSI codepage, not UTF-8, so any
REM   Persian text here comes back as garbage AND cmd then tries to run that
REM   garbage as a command. The first version of this file did exactly that.
REM   Parenthesised if-blocks are avoided too: the install path contains
REM   "New folder (2)" and an unescaped ")" inside a block closes it early.
REM   Keep it ASCII, keep it flat with goto labels.
REM ===========================================================================
setlocal
cd /d "%~dp0"

set "HOST=%~1"
if "%HOST%"=="" set "HOST=api.vill3n.top"
set "TUNNEL=control-center"
set "CF="

echo.
echo   ==========================================================
echo     Creating permanent address for:  %HOST%
echo   ==========================================================
echo.

REM ---- find cloudflared.exe -------------------------------------------------
if exist "%~dp0bin\cloudflared.exe" set "CF=%~dp0bin\cloudflared.exe"
if not defined CF if exist "%~dp0data\bin\cloudflared.exe" set "CF=%~dp0data\bin\cloudflared.exe"
if not defined CF if exist "%~dp0homelab-panel\server\data\bin\cloudflared.exe" set "CF=%~dp0homelab-panel\server\data\bin\cloudflared.exe"
if not defined CF if exist "%LOCALAPPDATA%\ControlCenter\bin\cloudflared.exe" set "CF=%LOCALAPPDATA%\ControlCenter\bin\cloudflared.exe"
if not defined CF if exist "%ProgramData%\ControlCenter\bin\cloudflared.exe" set "CF=%ProgramData%\ControlCenter\bin\cloudflared.exe"
if defined CF goto have_cf

for /f "delims=" %%W in ('where cloudflared 2^>nul') do set "CF=%%W"
if defined CF goto have_cf

echo   cloudflared.exe not found next to this file.
echo.
echo   Drag cloudflared.exe into this window and press Enter,
echo   or type its full path.
echo.
set /p "CF=path: "
set "CF=%CF:"=%"

:have_cf
if not exist "%CF%" goto no_cf
echo   cloudflared:  %CF%
echo.

REM ---- step 1: login --------------------------------------------------------
if exist "%USERPROFILE%\.cloudflared\cert.pem" goto logged_in
echo   [1/3] A browser will open. Sign in to Cloudflare and approve the domain.
echo.
"%CF%" tunnel login
if not exist "%USERPROFILE%\.cloudflared\cert.pem" goto login_failed
goto login_done

:logged_in
echo   [1/3] Already signed in.

:login_done
echo.

REM ---- step 2: create tunnel ------------------------------------------------
REM  A failure here is fine: "already exists" means the tunnel is there and
REM  that is all we need. Only step 3 has to succeed.
echo   [2/3] Creating tunnel "%TUNNEL%" ...
"%CF%" tunnel create %TUNNEL%
echo.

REM ---- step 3: route the subdomain ------------------------------------------
echo   [3/3] Pointing %HOST% at the tunnel ...
"%CF%" tunnel route dns --overwrite-dns %TUNNEL% %HOST%
if errorlevel 1 goto route_failed

echo.
echo   ==========================================================
echo     DONE.
echo.
echo     Server address:   https://%HOST%
echo.
echo     Now open the panel, go to the internet-address page,
echo     and press the "create permanent address" button once.
echo   ==========================================================
echo.
pause
exit /b 0

:no_cf
echo.
echo   Not found: %CF%
echo   Open the panel once and visit the internet-address page -
echo   it downloads cloudflared by itself. Then run this file again.
echo.
pause
exit /b 1

:login_failed
echo.
echo   Sign-in did not complete. Run this file again.
echo.
pause
exit /b 1

:route_failed
echo.
echo   Could not create the DNS record.
echo   Usually this means the domain is not in the Cloudflare account
echo   you signed in with. Send the text above to the engineer.
echo.
pause
exit /b 1
