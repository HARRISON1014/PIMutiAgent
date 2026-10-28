@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  echo Then double-click start.bat again.
  pause
  exit /b 1
)
node scripts\launch.js
if errorlevel 1 pause
