@echo off
rem Sets NODE_EXE to a usable Node.js (18+). Order: runtime\node, system PATH, then download a portable copy.
set "NODE_EXE="
set "ROOT=%~dp0.."
if exist "%ROOT%\runtime\node\node.exe" set "NODE_EXE=%ROOT%\runtime\node\node.exe"
if defined NODE_EXE goto :check
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
:check
if not defined NODE_EXE goto :download
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
if errorlevel 1 (
  set "NODE_EXE="
  goto :download
)
goto :eof
:download
echo  Node.js 18+ not found. Downloading a portable copy (about 30 MB) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-node.ps1"
if exist "%ROOT%\runtime\node\node.exe" set "NODE_EXE=%ROOT%\runtime\node\node.exe"
goto :eof
