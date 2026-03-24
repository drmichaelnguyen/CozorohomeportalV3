@echo off
setlocal

cd /d "%~dp0"

set APP_PORT=%PORT%

:: Try to load PORT from .env.local if not already set
if "%APP_PORT%"=="" (
    if exist ".env.local" (
        for /f "tokens=1,2 delims==" %%A in (.env.local) do (
            if "%%A"=="PORT" set APP_PORT=%%B
        )
    )
)

if "%APP_PORT%"=="" set APP_PORT=3000

echo Closing any process using port %APP_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%APP_PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

echo Clearing Next.js cache...
if exist ".next" rmdir /s /q ".next"
if exist "tsconfig.tsbuildinfo" del /f /q "tsconfig.tsbuildinfo"

echo Building the portal for production...
call npm run build
if %ERRORLEVEL% neq 0 (
  color 4f
  echo.
  echo  [!] ERROR: Build failed. Check the logs above.
  echo.
  pause
  exit /b %ERRORLEVEL%
)

echo Restarting Cloudflare Tunnel...
wt -w 0 nt -d "%~dp0" --title "Cloudflare Tunnel" cmd /c ..\tools\refresh-tunnel.cmd

echo Starting portal production server...
call npm run start
if %ERRORLEVEL% neq 0 (
  color 4f
  echo.
  echo  [!] ERROR: Server failed to start.
  echo.
  pause
  exit /b %ERRORLEVEL%
)

