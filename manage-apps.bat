@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "LOCAL_ROOT=%~dp0"
if "%LOCAL_ROOT:~-1%"=="\" set "LOCAL_ROOT=%LOCAL_ROOT:~0,-1%"
set "PROD_ROOT=C:\Users\User\Desktop\cozorohome-prod"
set "BACKUP_ROOT=C:\Users\User\Desktop\cozorohome-backups"

:menu
cls
echo ============================================================
echo   COZOROHOME APP MANAGER
echo ============================================================
echo.
echo Local app:
echo   Portal http://localhost:3002
echo   API    http://localhost:4002
echo.
echo Production app:
echo   Portal http://localhost:3000
echo   API    http://localhost:4000
echo   Bot    http://localhost:4111
echo   Guest  http://localhost:4115
echo   Backup backup.ps1 loop
echo   Tunnel managed separately
echo.
echo Public domains:
echo   https://app.cozorohome.com
echo   https://api.cozorohome.com
echo.
echo 1. Check local status
echo 2. Check production status
echo 3. Check public website status
echo 4. Start local app
echo 5. Start production app
echo 6. Stop local app
echo 7. Stop production app
echo 8. Restart local app
echo 9. Restart production app
echo 10. Check everything
echo 11. Roll back local to origin/sandboxing
echo 12. Roll back production to origin/main
echo 13. Roll back production one commit
echo 14. Recreate production worktree
echo 15. Migrate local app to production
echo 16. Back up production
echo 17. Restart production portal + API + bot + guest booking
echo 18. Restart production tunnel only
echo 0. Exit
echo.
set /p "choice=Choose an option: "

if "%choice%"=="1" call :check_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="2" call :check_stack "PROD" 3000 4000 "%PROD_ROOT%"
if "%choice%"=="3" call :check_public
if "%choice%"=="4" call :start_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="5" call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if "%choice%"=="6" call :stop_stack "LOCAL" 3002 4002
if "%choice%"=="7" call :stop_stack "PROD" 3000 4000
if "%choice%"=="8" call :stop_stack "LOCAL" 3002 4002 & call :start_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="9" call :stop_stack "PROD" 3000 4000 & call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if "%choice%"=="10" call :check_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%" & call :check_stack "PROD" 3000 4000 "%PROD_ROOT%" & call :check_public
if "%choice%"=="11" call :rollback_local
if "%choice%"=="12" call :rollback_prod_remote
if "%choice%"=="13" call :rollback_prod_one
if "%choice%"=="14" call :recreate_prod_worktree
if "%choice%"=="15" call :migrate_local_to_prod
if "%choice%"=="16" call :backup_prod
if "%choice%"=="17" call :restart_prod_full_stack
if "%choice%"=="18" call :restart_prod_tunnel
if "%choice%"=="0" goto :eof

echo.
pause
goto :menu

:check_stack
set "STACK_NAME=%~1"
set "PORTAL_PORT=%~2"
set "API_PORT=%~3"
set "STACK_ROOT=%~4"
echo.
echo [%STACK_NAME%] Root: %STACK_ROOT%
if not exist "%STACK_ROOT%" (
  echo [%STACK_NAME%] Folder not found.
  goto :eof
)
call :print_port_status "%STACK_NAME% Portal" %PORTAL_PORT%
call :print_port_status "%STACK_NAME% API" %API_PORT%
call :check_url "%STACK_NAME% Portal URL" "http://127.0.0.1:%PORTAL_PORT%"
call :check_url "%STACK_NAME% API URL" "http://127.0.0.1:%API_PORT%/health"
goto :eof

:check_public
echo.
call :check_url "Public Portal" "https://app.cozorohome.com"
call :check_url "Public API" "https://api.cozorohome.com/health"
goto :eof

:start_stack
set "STACK_NAME=%~1"
set "PORTAL_PORT=%~2"
set "API_PORT=%~3"
set "STACK_ROOT=%~4"
echo.
echo [%STACK_NAME%] Starting stack from %STACK_ROOT%
if not exist "%STACK_ROOT%" (
  echo [%STACK_NAME%] Folder not found.
  goto :eof
)
if not exist "%STACK_ROOT%\api" (
  echo [%STACK_NAME%] API folder not found.
  goto :eof
)
if not exist "%STACK_ROOT%\portal" (
  echo [%STACK_NAME%] Portal folder not found.
  goto :eof
)

if /I "%STACK_NAME%"=="LOCAL" (
  start "%STACK_NAME% API :%API_PORT%" "%LOCAL_ROOT%\start-local-api.cmd"
  timeout /t 3 /nobreak >nul
  start "%STACK_NAME% Portal :%PORTAL_PORT%" "%LOCAL_ROOT%\start-local-portal.cmd"
) else (
  start "%STACK_NAME% API :%API_PORT%" "%LOCAL_ROOT%\start-prod-desktop-api.cmd"
  timeout /t 3 /nobreak >nul
  start "%STACK_NAME% Portal :%PORTAL_PORT%" "%LOCAL_ROOT%\start-prod-desktop-portal.cmd"
  call :start_backup_worker
)
echo [%STACK_NAME%] Start commands launched.
goto :eof

:stop_stack
set "STACK_NAME=%~1"
set "PORTAL_PORT=%~2"
set "API_PORT=%~3"
echo.
echo [%STACK_NAME%] Stopping portal on %PORTAL_PORT% and API on %API_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORTAL_PORT%" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%API_PORT%" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq %STACK_NAME% API :%API_PORT%*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq %STACK_NAME% Portal :%PORTAL_PORT%*" /F >nul 2>&1
if /I "%STACK_NAME%"=="PROD" call :stop_backup_worker
echo [%STACK_NAME%] Stop commands completed.
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

:rollback_local
echo.
echo [LOCAL] Rolling back to origin/sandboxing...
call :stop_stack "LOCAL" 3002 4002
cd /d "%LOCAL_ROOT%"
git fetch origin
if errorlevel 1 goto :git_failed
git reset --hard origin/sandboxing
if errorlevel 1 goto :git_failed
git clean -fd
if errorlevel 1 goto :git_failed
echo [LOCAL] Rollback complete.
goto :eof

:rollback_prod_remote
echo.
echo [PROD] Rolling back to origin/main...
call :stop_stack "PROD" 3000 4000
if not exist "%PROD_ROOT%" (
  echo [PROD] Folder not found.
  goto :eof
)
cd /d "%PROD_ROOT%"
git fetch origin
if errorlevel 1 goto :git_failed
git reset --hard origin/main
if errorlevel 1 goto :git_failed
git clean -fd
if errorlevel 1 goto :git_failed
echo [PROD] Rollback complete.
goto :eof

:rollback_prod_one
echo.
echo [PROD] Rolling back one commit...
call :stop_stack "PROD" 3000 4000
if not exist "%PROD_ROOT%" (
  echo [PROD] Folder not found.
  goto :eof
)
cd /d "%PROD_ROOT%"
git reset --hard HEAD~1
if errorlevel 1 goto :git_failed
git clean -fd
if errorlevel 1 goto :git_failed
echo [PROD] Rolled back one commit.
goto :eof

:recreate_prod_worktree
echo.
echo [PROD] Recreating production worktree...
call :stop_stack "PROD" 3000 4000
cd /d "%LOCAL_ROOT%"
git worktree remove --force "%PROD_ROOT%"
if exist "%PROD_ROOT%" rmdir /s /q "%PROD_ROOT%"
git worktree prune
if errorlevel 1 goto :git_failed
git worktree add "%PROD_ROOT%" main
if errorlevel 1 goto :git_failed
echo [PROD] Worktree recreated.
goto :eof

:migrate_local_to_prod
echo.
echo [MIGRATE] Copying local app into production worktree...
call :stop_stack "LOCAL" 3002 4002
call :stop_stack "PROD" 3000 4000
if not exist "%PROD_ROOT%" (
  echo [MIGRATE] Production folder not found.
  goto :eof
)
robocopy "%LOCAL_ROOT%" "%PROD_ROOT%" /MIR /XD ".git" "node_modules" ".next" ".codex-logs" ".stversions" "cozorohome-prod" /XF ".env.local"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo [MIGRATE] Robocopy failed with code %ROBOCODE%.
  goto :eof
)
if not exist "%PROD_ROOT%\portal" (
  echo [MIGRATE] Production portal folder missing after copy.
  goto :eof
)
if not exist "%PROD_ROOT%\api" (
  echo [MIGRATE] Production API folder missing after copy.
  goto :eof
)
(
echo PORT=3000
echo NEXT_PUBLIC_API_BASE_URL=/api-proxy
echo API_SERVER_ORIGIN=http://localhost:4000
) > "%PROD_ROOT%\portal\.env.local"
if exist "%LOCAL_ROOT%\api\.env" (
  powershell -NoProfile -Command "$content = Get-Content '%LOCAL_ROOT%\api\.env' -Raw; $content = $content -replace 'PORT=4002','PORT=4000'; $content = $content -replace 'http://localhost:4002/integrations/google/oauth/callback','http://localhost:4000/integrations/google/oauth/callback'; Set-Content '%PROD_ROOT%\api\.env' $content"
)
echo [MIGRATE] Local app copied to production. Prod env reset to 3000/4000.
goto :eof

:backup_prod
echo.
echo [BACKUP] Creating production backup...
if not exist "%PROD_ROOT%" (
  echo [BACKUP] Production folder not found.
  goto :eof
)
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format ''yyyyMMdd-HHmmss''"') do set "STAMP=%%I"
set "TARGET_BACKUP=%BACKUP_ROOT%\cozorohome-prod-%STAMP%"
robocopy "%PROD_ROOT%" "%TARGET_BACKUP%" /MIR /XD ".git" "node_modules" ".next" ".codex-logs" ".stversions"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo [BACKUP] Backup failed with code %ROBOCODE%.
  goto :eof
)
echo [BACKUP] Production backup created at:
echo [BACKUP] %TARGET_BACKUP%
goto :eof

:restart_prod_full_stack
echo.
echo [PROD] Restarting portal, API, backup, bot chat, and guest booking only...
echo [PROD] Tunnel is managed separately and will not be touched.
call :stop_stack "PROD" 3000 4000
call :stop_bot_chat
call :stop_guest_booking
call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
call :start_bot_chat
call :start_guest_booking
echo [PROD] Full production restart commands launched.
goto :eof

:restart_prod_tunnel
echo.
echo [PROD] Restarting tunnel only...
if not exist "%PROD_ROOT%\tools\refresh-tunnel.cmd" (
  echo [PROD] Tunnel refresh script not found.
  goto :eof
)
start "PROD Tunnel Refresh" cmd /c "cd /d "%PROD_ROOT%\tools" && call refresh-tunnel.cmd"
echo [PROD] Tunnel restart command launched.
goto :eof

:start_bot_chat
echo [PROD] Starting bot chat from %PROD_ROOT%\bot
if not exist "%PROD_ROOT%\bot\run-bot-win.cmd" (
  echo [PROD] Bot run script not found.
  goto :eof
)
start "PROD Bot Chat :4111" cmd /c "cd /d "%PROD_ROOT%\bot" && call run-bot-win.cmd"
goto :eof

:stop_bot_chat
echo [PROD] Stopping bot chat on 4111...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4111" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq PROD Bot Chat :4111*" /F >nul 2>&1
goto :eof

:start_guest_booking
echo [PROD] Starting guest booking on 4115...
if not exist "%PROD_ROOT%\guest-booking-standalone\package.json" (
  echo [PROD] Guest booking folder not found.
  goto :eof
)
start "PROD Guest Booking :4115" cmd /k "cd /d "%PROD_ROOT%\guest-booking-standalone" && if not exist node_modules\express (npm install) && node server.js"
goto :eof

:stop_guest_booking
echo [PROD] Stopping guest booking on 4115...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4115" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq PROD Guest Booking :4115*" /F >nul 2>&1
goto :eof

:start_backup_worker
echo [PROD] Starting backup worker from %LOCAL_ROOT%\backup.ps1
if not exist "%LOCAL_ROOT%\backup.ps1" (
  echo [PROD] Backup script not found.
  goto :eof
)
taskkill /FI "WINDOWTITLE eq PROD Data Backup*" /F >nul 2>&1
start "PROD Data Backup" powershell -ExecutionPolicy Bypass -File "%LOCAL_ROOT%\backup.ps1"
goto :eof

:stop_backup_worker
echo [PROD] Stopping backup worker...
taskkill /FI "WINDOWTITLE eq PROD Data Backup*" /F >nul 2>&1
goto :eof

:git_failed
echo [ERROR] Git operation failed. Review the output above.
goto :eof
