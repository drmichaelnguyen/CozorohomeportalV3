@echo off
setlocal

cd /d "%~dp0"

echo Closing any process using port 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

echo Clearing Next.js cache...
if exist ".next" rmdir /s /q ".next"
if exist "tsconfig.tsbuildinfo" del /f /q "tsconfig.tsbuildinfo"

echo Building the portal for production...
call npm run build

echo Restarting Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /c ..\tools\refresh-tunnel.cmd

echo Starting portal production server...
call npm run start
