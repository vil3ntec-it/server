@echo off
chcp 65001 >nul
title Control Center Agent
cd /d "%~dp0"

REM سه مقدار زیر را با چیزی که پنل نشان داد پر کنید
if "%CC_PANEL_URL%"=="" set CC_PANEL_URL=http://192.168.0.102:4700
if "%CC_SERVER_ID%"=="" set CC_SERVER_ID=srv_00000000
if "%CC_AGENT_KEY%"=="" set CC_AGENT_KEY=

if "%CC_AGENT_KEY%"=="" (
  echo [X] CC_AGENT_KEY خالی است.
  echo     در پنل، صفحهٔ «سرورها» ^> «Agent» ^> «ساخت کلید» را بزنید.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js پیدا نشد. از nodejs.org نصب کنید.
  pause
  exit /b 1
)

node agent.mjs
pause
