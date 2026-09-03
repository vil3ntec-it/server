@echo off
REM ===========================================================================
REM   Create the permanent address for the home server.
REM
REM   NOTES FOR MAINTAINERS - every one of these is a bug that already bit:
REM     * ASCII only. cmd.exe parses a .bat in the machine's ANSI codepage,
REM       not UTF-8, so Persian text here turns into garbage AND cmd then
REM       tries to run that garbage as a command.
REM     * No parenthesised if-blocks. The install path contains
REM       "New folder (2)" and an unescaped ")" closes a block early.
REM     * Never use %VAR:"=% to strip quotes. When VAR is undefined cmd
REM       leaves the expression literal, the quotes go unbalanced, and the
REM       next line gets swallowed. Use  for /f  with %%~A instead.
REM     * The file does not have to sit next to the panel: it searches.
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

REM ---- find cloudflared.exe: the cheap places first --------------------------
if exist "%~dp0bin\cloudflared.exe" set "CF=%~dp0bin\cloudflared.exe"
if not defined CF if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF if exist "%~dp0data\bin\cloudflared.exe" set "CF=%~dp0data\bin\cloudflared.exe"
if not defined CF if exist "%~dp0..\bin\cloudflared.exe" set "CF=%~dp0..\bin\cloudflared.exe"
if not defined CF if exist "%~dp0homelab-panel\server\data\bin\cloudflared.exe" set "CF=%~dp0homelab-panel\server\data\bin\cloudflared.exe"
if not defined CF if exist "%LOCALAPPDATA%\ControlCenter\bin\cloudflared.exe" set "CF=%LOCALAPPDATA%\ControlCenter\bin\cloudflared.exe"
if not defined CF if exist "%ProgramData%\ControlCenter\bin\cloudflared.exe" set "CF=%ProgramData%\ControlCenter\bin\cloudflared.exe"
if defined CF goto have_cf

for /f "delims=" %%W in ('where cloudflared 2^>nul') do set "CF=%%W"
if defined CF goto have_cf

REM ---- still nothing: search this drive, then the user folder ----------------
echo   Looking for cloudflared.exe on drive %~d0 - this can take a minute ...
for /f "delims=" %%F in ('dir /s /b "%~d0\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto have_cf

echo   Looking in your user folder ...
for /f "delims=" %%F in ('dir /s /b "%USERPROFILE%\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto have_cf

echo   Looking on drive D ...
for /f "delims=" %%F in ('dir /s /b "D:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto have_cf

echo   Looking on drive C ...
for /f "delims=" %%F in ('dir /s /b "C:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if defined CF goto have_cf

:ask_path
echo.
echo   cloudflared.exe was not found automatically.
echo.
echo   Drag cloudflared.exe from Explorer into this window, then press Enter.
echo   Or type its full path. Type  q  and Enter to quit.
echo.
set "CF="
set /p "CF=path: "
if not defined CF goto ask_path
if /i "%CF%"=="q" goto quit
REM  %%~A strips surrounding quotes safely - a dragged path arrives quoted
for /f "tokens=* delims=" %%A in ("%CF%") do set "CF=%%~A"
if not defined CF goto ask_path
if not exist "%CF%" goto bad_path

:have_cf
if not exist "%CF%" goto no_cf
echo.
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

REM ---- step 2: create the tunnel --------------------------------------------
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

:bad_path
echo.
echo   That path does not exist:
echo   %CF%
goto ask_path

:no_cf
echo.
echo   cloudflared.exe could not be found.
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
echo   Send the text above to the engineer.
echo.
pause
exit /b 1

:quit
echo.
echo   Cancelled.
echo.
pause
exit /b 1
