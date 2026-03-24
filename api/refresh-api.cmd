@echo off
setlocal

cd /d "%~dp0"

set APP_PORT=%PORT%

:: Try to load PORT from .env if not already set
if "%APP_PORT%"=="" (
    if exist ".env" (
        for /f "tokens=1,2 delims==" %%A in (.env) do (
            if "%%A"=="PORT" set APP_PORT=%%B
        )
    )
)

if "%APP_PORT%"=="" set APP_PORT=4000

echo Closing any process using port %APP_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%APP_PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

echo Starting API dev server on port %APP_PORT%...
call npm run dev
