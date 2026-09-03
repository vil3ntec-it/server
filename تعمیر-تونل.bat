@echo off
REM ===========================================================================
REM   Repair the panel's tunnel config.
REM
REM   The problem this fixes: config.yml pinned an OLD tunnel id. The DNS
REM   record points at the CURRENT tunnel, so Cloudflare had a route with
REM   nothing connected behind it - error 1033. The panel reads the id out of
REM   config.yml, so it kept running the wrong tunnel forever.
REM
REM   ASCII only. No parenthesised blocks. See the other bat for why.
REM ===========================================================================
setlocal EnableDelayedExpansion

set "ROOT=D:\server\New folder (2)"
set "CFDIR=%ROOT%\cloudflared"
set "CFG=%CFDIR%\config.yml"
set "TUNNEL=control-center"
set "PORT=4701"
set "CF="
set "TID="

echo.
echo   ==========================================================
echo     Repairing the panel tunnel config
echo   ==========================================================
echo.

if exist "%ROOT%\bin\cloudflared.exe" set "CF=%ROOT%\bin\cloudflared.exe"
if not defined CF for /f "delims=" %%F in ('dir /s /b "D:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if not defined CF for /f "delims=" %%F in ('dir /s /b "C:\cloudflared.exe" 2^>nul') do set "CF=%%F"
if not defined CF goto no_cf
echo   cloudflared: %CF%

REM ---- which tunnel id does the name resolve to RIGHT NOW? ------------------
for /f "tokens=1,2" %%A in ('"%CF%" tunnel list 2^>nul') do if "%%B"=="%TUNNEL%" set "TID=%%A"
if not defined TID goto no_tunnel
echo   tunnel id:   %TID%

REM ---- make sure the credentials file is where the panel looks -------------
if not exist "%CFDIR%" mkdir "%CFDIR%"
if exist "%CFDIR%\%TID%.json" goto have_creds
if exist "%USERPROFILE%\.cloudflared\%TID%.json" copy /y "%USERPROFILE%\.cloudflared\%TID%.json" "%CFDIR%\%TID%.json" >nul
if exist "%CFDIR%\%TID%.json" goto have_creds
echo   Fetching the credentials file from Cloudflare ...
"%CF%" tunnel token --cred-file "%CFDIR%\%TID%.json" %TUNNEL% >nul 2>&1
if not exist "%CFDIR%\%TID%.json" goto no_creds

:have_creds
echo   credentials: %CFDIR%\%TID%.json
echo.

REM ---- keep a copy of the old config, then write the new one ---------------
if exist "%CFG%" copy /y "%CFG%" "%CFG%.old" >nul
set "CREDS=%CFDIR%\%TID%.json"
set "CREDS=!CREDS:\=/!"

> "%CFG%" echo tunnel: %TID%
>> "%CFG%" echo credentials-file: !CREDS!
>> "%CFG%" echo ingress:
>> "%CFG%" echo   - hostname: api.vill3n.top
>> "%CFG%" echo     service: http://127.0.0.1:%PORT%
>> "%CFG%" echo   - hostname: sync.vill3n.top
>> "%CFG%" echo     service: http://127.0.0.1:%PORT%
>> "%CFG%" echo   - service: http_status:404

echo   ---- new config.yml ----
type "%CFG%"
echo.
echo   ==========================================================
echo     Config file fixed.
echo.
echo     IMPORTANT - one more thing:
echo     The panel only reads this file when its own setting says
echo     "named". This file cannot change that setting.
echo.
echo     So after restarting the panel, go to:
echo       Internet address  ^>  Permanent address
echo     and press the "create permanent address" button ONCE.
echo.
echo     Panel version 1.8.6 and newer does that by itself on
echo     startup - then no button is needed.
echo.
echo     Then open:  https://api.vill3n.top/health
echo   ==========================================================
echo.
pause
exit /b 0

:no_cf
echo   cloudflared.exe not found.
echo.
pause
exit /b 1

:no_tunnel
echo   No tunnel named "%TUNNEL%" in this Cloudflare account.
echo   Run the create-address file first.
echo.
pause
exit /b 1

:no_creds
echo   Could not get the credentials file for %TID%.
echo   Send this screen to the engineer.
echo.
pause
exit /b 1
