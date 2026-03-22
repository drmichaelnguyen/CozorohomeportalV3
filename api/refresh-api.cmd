@echo off
setlocal

cd /d "%~dp0"

echo Closing any process using port 4000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

echo Starting API dev server...
call npm run dev
