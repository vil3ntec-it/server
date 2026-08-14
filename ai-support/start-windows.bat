@echo off
chcp 65001 >nul
REM اجرای دستیارِ پشتیبانی — ویندوز
cd /d "%~dp0"
title دستیارِ پشتیبانیِ پمپ یعقوبی
node src\index.js
echo.
echo سرویس بسته شد.
pause
