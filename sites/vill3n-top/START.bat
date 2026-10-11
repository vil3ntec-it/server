@echo off
rem VILL3N site - start the server and open the owner panel in the browser.
rem Needs nothing installed: if Node.js is missing, a portable copy is downloaded into the "runtime" folder.
setlocal
cd /d "%~dp0"
title VILL3N site
call "%~dp0scripts\find-node.bat"
if not defined NODE_EXE (
  echo.
  echo  Node.js was not found and could not be downloaded.
  echo  Connect to the internet once and run START.bat again,
  echo  or install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo.
echo  Starting VILL3N site ...  (close this window to stop it)
echo.
"%NODE_EXE%" server.js --open
echo.
echo  The server stopped. Read the message above.
pause
