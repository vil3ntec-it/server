@echo off
setlocal EnableExtensions
title Control Center - Installer

REM ---------------------------------------------------------------------------
REM  Control Center / Home Server Panel - Windows installer
REM
REM  Just double-click this file. It works from anywhere, including your
REM  Downloads folder: if the program is not next to it, it downloads it.
REM
REM  This file is deliberately plain ASCII with CRLF line endings, and avoids
REM  line continuations inside parenthesised blocks, because cmd.exe mis-parses
REM  both. Every Persian message lives in install.ps1, where UTF-8 works.
REM ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "PS1=%HERE%install.ps1"
set "REPO=vil3ntec-it/server"
set "CC_PS1=%HERE%install.ps1"
set "CC_REPO=vil3ntec-it/server"

echo.
echo ==============================================================
echo    Control Center - Installer
echo    Persian messages start in a moment...
echo ==============================================================
echo.

REM ------------------------- find PowerShell ------------------------------
set "PWSH=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%PWSH%" goto have_powershell
set "PWSH=powershell.exe"
where powershell.exe >nul 2>nul
if not errorlevel 1 goto have_powershell

echo  [X] PowerShell was not found on this computer.
echo      This installer needs Windows PowerShell 5.1 or newer,
echo      which ships with Windows 7 and later.
echo.
pause
exit /b 1

:have_powershell

REM ------------- download install.ps1 if it is not next to us -------------
if exist "%PS1%" goto have_script

REM  Only from the main branch. There is deliberately NO fallback to any other
REM  branch (master, claude/...): whoever can push to a fallback branch would
REM  decide what every new install runs. If main cannot be reached, stop here.
echo  [*] Downloading the installer script from the main branch...
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/' + $env:CC_REPO + '/main/homelab-panel/install.ps1') -OutFile $env:CC_PS1"
if not errorlevel 1 goto have_script

echo.
echo  [X] Could not download install.ps1 from the main branch of %REPO%
echo      No other branch is tried, on purpose.
echo.
echo      Check your internet connection, or download the project
echo      manually and run this file from inside its homelab-panel folder:
echo      https://github.com/%REPO%
echo.
pause
exit /b 1

:have_script

REM ------- files downloaded from the internet are marked as blocked -------
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -Command "try { Unblock-File -LiteralPath $env:CC_PS1 -ErrorAction SilentlyContinue } catch { }" >nul 2>nul

REM ------------------------------- run it ---------------------------------
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Repo "%REPO%" %*
set "CODE=%errorlevel%"

if "%CODE%"=="0" goto done
echo.
echo  [X] The installer stopped with exit code %CODE%
echo.
pause

:done
exit /b %CODE%
