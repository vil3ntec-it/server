@echo off
rem Background runner used by INSTALL-SERVICE.bat: keeps the site running and restarts it if it ever stops.
setlocal
cd /d "%~dp0.."
call "%~dp0find-node.bat"
if not defined NODE_EXE exit /b 1
if not exist "data\logs" mkdir "data\logs"
:loop
echo [%date% %time%] start >> "data\logs\server.log"
"%NODE_EXE%" server.js >> "data\logs\server.log" 2>&1
echo [%date% %time%] stopped with code %errorlevel% >> "data\logs\server.log"
rem exit code 1 right at start usually means "already running" or "port busy": wait longer before retrying
timeout /t 8 /nobreak >nul
goto loop
