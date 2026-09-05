@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

:menu
cls
echo ============================================================
echo   COZOROHOME DEV MANAGER
echo ============================================================
echo.
echo   Portal  http://localhost:3000
echo   API     http://localhost:4000
echo   Public  https://app.cozorohome.com
echo.
echo 1. Check status
echo 2. Start dev app
echo 3. Stop dev app
echo 4. Restart dev app
echo 5. Check public website
echo 6. Roll back to origin/main
echo 0. Exit
echo.
set /p "choice=Choose an option: "

if "%choice%"=="1" call :check_status
if "%choice%"=="2" call :start_dev
if "%choice%"=="3" call :stop_dev
if "%choice%"=="4" call :stop_dev & call :start_dev
if "%choice%"=="5" call :check_public
if "%choice%"=="6" call :rollback
if "%choice%"=="0" goto :eof

echo.
pause
goto :menu

:check_status
echo.
call :print_port_status "Portal" 3000
call :print_port_status "API" 4000
call :check_url "Portal" "http://127.0.0.1:3000"
call :check_url "API" "http://127.0.0.1:4000/health"
goto :eof

:check_public
echo.
call :check_url "Public Portal" "https://app.cozorohome.com"
call :check_url "Public API" "https://api.cozorohome.com/health"
goto :eof

:start_dev
echo.
echo Starting dev app...
call :run_pnpm "%ROOT%" "install --no-frozen-lockfile"
if errorlevel 1 goto :eof
call :run_pnpm "%ROOT%\api" "prisma:generate"
if errorlevel 1 goto :eof
call :run_pnpm "%ROOT%\api" "exec prisma migrate deploy"
if errorlevel 1 goto :eof
start "DEV API :4000" cmd /k "cd /d "%ROOT%\api" && corepack pnpm dev"
timeout /t 3 /nobreak >nul
start "DEV Portal :3000" cmd /k "cd /d "%ROOT%\portal" && corepack pnpm dev"
echo Dev app started.
goto :eof

:stop_dev
echo.
echo Stopping dev app...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq DEV API :4000*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq DEV Portal :3000*" /F >nul 2>&1
echo Dev app stopped.
goto :eof

:rollback
echo.
echo Rolling back to origin/main...
call :stop_dev
cd /d "%ROOT%"
git fetch origin
if errorlevel 1 goto :git_failed
git reset --hard origin/main
if errorlevel 1 goto :git_failed
git clean -fd
if errorlevel 1 goto :git_failed
echo Rollback complete.
goto :eof

:print_port_status
set "LABEL=%~1"
set "TARGET_PORT=%~2"
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TARGET_PORT%" ^| findstr "LISTENING"') do (
  echo [%LABEL%] LISTENING on port %TARGET_PORT% ^(PID %%P^)
  set "FOUND=1"
)
if not defined FOUND echo [%LABEL%] Not listening on port %TARGET_PORT%.
goto :eof

:check_url
set "LABEL=%~1"
set "TARGET_URL=%~2"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $r = Invoke-WebRequest -Uri '%TARGET_URL%' -Method Head -TimeoutSec 8 -UseBasicParsing; Write-Host '[%LABEL%] HTTP' $r.StatusCode } catch { if ($_.Exception.Response) { Write-Host '[%LABEL%] HTTP' $_.Exception.Response.StatusCode.value__ } else { Write-Host '[%LABEL%] DOWN' $_.Exception.Message } }"
goto :eof

:run_pnpm
set "RUN_DIR=%~1"
set "RUN_ARGS=%~2"
echo [PNPM] %RUN_DIR% :: %RUN_ARGS%
pushd "%RUN_DIR%"
call corepack pnpm %RUN_ARGS%
set "PNPM_EXIT=%ERRORLEVEL%"
popd
exit /b %PNPM_EXIT%

:git_failed
echo [ERROR] Git operation failed. Review the output above.
goto :eof
