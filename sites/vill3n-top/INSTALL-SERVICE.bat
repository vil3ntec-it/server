@echo off
rem VILL3N site - run automatically and hidden every time this Windows user signs in. No admin rights needed.
setlocal
cd /d "%~dp0"
call "%~dp0scripts\find-node.bat"
if not defined NODE_EXE (
  echo  Node.js is missing. Run START.bat once while online, then run this file again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\service.ps1" install
if errorlevel 1 (
  echo  Could not install the start-up entry. Read the message above.
  pause
  exit /b 1
)
echo  Panel:  http://localhost:4780/admin
echo  To remove it, run UNINSTALL-SERVICE.bat
echo.
pause
