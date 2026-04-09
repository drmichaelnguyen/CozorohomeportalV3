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
echo 15. Deploy local workspace to production and restart
echo 16. Back up production
echo 17. Restart production portal + API + bot + guest booking
echo 18. Restart production tunnel only
echo 19. Reset production to origin/main and restart
echo 20. Restore production from backup
echo 0. Exit
echo.
set /p "choice=Choose an option: "

if "%choice%"=="1" call :check_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="2" call :check_stack "PROD" 3000 4000 "%PROD_ROOT%"
if "%choice%"=="3" call :check_public
if "%choice%"=="4" call :start_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="5" call :start_prod_full_stack
if "%choice%"=="6" call :stop_stack "LOCAL" 3002 4002
if "%choice%"=="7" call :stop_prod_full_stack
if "%choice%"=="8" call :stop_stack "LOCAL" 3002 4002 & call :start_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%"
if "%choice%"=="9" call :restart_prod_full_stack
if "%choice%"=="10" call :check_stack "LOCAL" 3002 4002 "%LOCAL_ROOT%" & call :check_stack "PROD" 3000 4000 "%PROD_ROOT%" & call :check_public
if "%choice%"=="11" call :rollback_local
if "%choice%"=="12" call :rollback_prod_remote
if "%choice%"=="13" call :rollback_prod_one
if "%choice%"=="14" call :recreate_prod_worktree
if "%choice%"=="15" call :migrate_local_to_prod
if "%choice%"=="16" call :backup_prod
if "%choice%"=="17" call :restart_prod_full_stack
if "%choice%"=="18" call :restart_prod_tunnel
if "%choice%"=="19" call :deploy_prod_from_main
if "%choice%"=="20" call :restore_prod_from_backup
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

call :prepare_stack "%STACK_NAME%" "%STACK_ROOT%"
if errorlevel 1 (
  echo [%STACK_NAME%] Preparation failed. Stack was not started.
  goto :eof
)

if /I "%STACK_NAME%"=="LOCAL" (
  start "%STACK_NAME% API :%API_PORT%" cmd /k "cd /d ""%STACK_ROOT%\api"" && corepack pnpm dev"
  timeout /t 3 /nobreak >nul
  start "%STACK_NAME% Portal :%PORTAL_PORT%" cmd /k "cd /d ""%STACK_ROOT%\portal"" && corepack pnpm dev"
) else (
  start "%STACK_NAME% API :%API_PORT%" cmd /k "cd /d ""%STACK_ROOT%\api"" && corepack pnpm start"
  timeout /t 3 /nobreak >nul
  start "%STACK_NAME% Portal :%PORTAL_PORT%" cmd /k "cd /d ""%STACK_ROOT%\portal"" && corepack pnpm start"
  call :start_backup_worker
)
echo [%STACK_NAME%] Start commands launched.
goto :eof

:prepare_stack
set "STACK_NAME=%~1"
set "STACK_ROOT=%~2"
echo [%STACK_NAME%] Preparing dependencies and build artifacts...

if /I "%STACK_NAME%"=="LOCAL" (
  call :run_pnpm "%STACK_ROOT%" "install --no-frozen-lockfile"
) else (
  call :run_pnpm "%STACK_ROOT%" "install --no-frozen-lockfile"
)
if errorlevel 1 exit /b 1

call :run_pnpm "%STACK_ROOT%\api" "prisma:generate"
if errorlevel 1 exit /b 1

call :run_pnpm "%STACK_ROOT%\api" "exec prisma migrate deploy"
if errorlevel 1 exit /b 1

if /I "%STACK_NAME%"=="PROD" (
  call :run_pnpm "%STACK_ROOT%\api" "build"
  if errorlevel 1 exit /b 1
  call :run_pnpm "%STACK_ROOT%\portal" "build"
  if errorlevel 1 exit /b 1
  call :prepare_guest_booking "%STACK_ROOT%"
  if errorlevel 1 exit /b 1
)

exit /b 0

:run_pnpm
set "RUN_DIR=%~1"
set "RUN_ARGS=%~2"
echo [PNPM] %RUN_DIR% :: %RUN_ARGS%
pushd "%RUN_DIR%"
call corepack pnpm %RUN_ARGS%
set "PNPM_EXIT=%ERRORLEVEL%"
popd
exit /b %PNPM_EXIT%

:prepare_guest_booking
set "STACK_ROOT=%~1"
if not exist "%STACK_ROOT%\guest-booking-standalone\package.json" exit /b 0
echo [GUEST] Preparing hostel guest booking dependencies...
pushd "%STACK_ROOT%\guest-booking-standalone"
if not exist node_modules\express (
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
)
popd
exit /b 0

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

:start_prod_full_stack
echo.
echo [PROD] Starting portal, API, backup, bot chat, and hostel guest booking...
echo [PROD] Tunnel is managed separately and will not be touched.
call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if errorlevel 1 goto :eof
call :start_bot_chat
call :start_guest_booking
echo [PROD] Full production start commands launched.
goto :eof

:stop_prod_full_stack
echo.
echo [PROD] Stopping portal, API, backup, bot chat, and hostel guest booking...
call :stop_stack "PROD" 3000 4000
call :stop_bot_chat
call :stop_guest_booking
echo [PROD] Full production stop commands completed.
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
echo [DEPLOY-LOCAL] Deploying local workspace to production...
call :backup_prod_internal
if errorlevel 1 (
  echo [DEPLOY-LOCAL] Backup failed. Deployment cancelled.
  goto :eof
)
echo [DEPLOY-LOCAL] Backup created at %TARGET_BACKUP%
call :stop_stack "LOCAL" 3002 4002
call :stop_prod_full_stack
if not exist "%PROD_ROOT%" (
  echo [DEPLOY-LOCAL] Production folder not found.
  goto :eof
)
robocopy "%LOCAL_ROOT%" "%PROD_ROOT%" /MIR /XD ".git" "node_modules" ".next" ".codex-logs" ".stversions" "cozorohome-prod" /XF ".env.local"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo [DEPLOY-LOCAL] Robocopy failed with code %ROBOCODE%.
  goto :eof
)
if not exist "%PROD_ROOT%\portal" (
  echo [DEPLOY-LOCAL] Production portal folder missing after copy.
  goto :eof
)
if not exist "%PROD_ROOT%\api" (
  echo [DEPLOY-LOCAL] Production API folder missing after copy.
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
echo [DEPLOY-LOCAL] Local workspace copied to production. Prod env reset to 3000/4000.
goto :eof

:backup_prod
echo.
echo [BACKUP] Creating production backup...
call :backup_prod_internal
if errorlevel 1 goto :eof
echo [BACKUP] Production backup created at:
echo [BACKUP] %TARGET_BACKUP%
goto :eof

:backup_prod_internal
if not exist "%PROD_ROOT%" (
  echo [BACKUP] Production folder not found.
  exit /b 1
)
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format ''yyyyMMdd-HHmmss''"') do set "STAMP=%%I"
set "TARGET_BACKUP=%BACKUP_ROOT%\cozorohome-prod-%STAMP%"
robocopy "%PROD_ROOT%" "%TARGET_BACKUP%" /MIR /XD ".git" "node_modules" ".next" ".codex-logs" ".stversions"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo [BACKUP] Backup failed with code %ROBOCODE%.
  exit /b 1
)
exit /b 0

:restart_prod_full_stack
echo.
echo [PROD] Restarting portal, API, backup, bot chat, and hostel guest booking...
echo [PROD] Tunnel is managed separately and will not be touched.
call :stop_prod_full_stack
echo.
echo [PROD] Starting portal, API, backup, bot chat, and hostel guest booking...
echo [PROD] Tunnel is managed separately and will not be touched.
call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if errorlevel 1 goto :eof
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

:deploy_prod_from_main
echo.
echo [PROD-MAIN] Resetting production to origin/main...
call :backup_prod_internal
if errorlevel 1 (
  echo [PROD-MAIN] Backup failed. Reset cancelled.
  goto :eof
)
echo [PROD-MAIN] Backup created at %TARGET_BACKUP%
call :stop_prod_full_stack
if not exist "%PROD_ROOT%" (
  echo [PROD-MAIN] Folder not found.
  goto :eof
)
cd /d "%PROD_ROOT%"
git fetch origin
if errorlevel 1 goto :git_failed
git reset --hard origin/main
if errorlevel 1 goto :git_failed
git clean -fd
if errorlevel 1 goto :git_failed
echo.
echo [PROD] Starting portal, API, backup, bot chat, and hostel guest booking...
echo [PROD] Tunnel is managed separately and will not be touched.
call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if errorlevel 1 goto :eof
call :start_bot_chat
call :start_guest_booking
echo [PROD-MAIN] Production reset to origin/main and restart commands launched.
goto :eof

:restore_prod_from_backup
echo.
echo [RESTORE] Available production backups:
if not exist "%BACKUP_ROOT%" (
  echo [RESTORE] Backup folder not found.
  goto :eof
)
set "BACKUP_COUNT=0"
for /f "delims=" %%D in ('dir "%BACKUP_ROOT%\cozorohome-prod-*" /b /ad /o-n 2^>nul') do (
  set /a BACKUP_COUNT+=1
  set "BACKUP_!BACKUP_COUNT!=%%D"
  echo   !BACKUP_COUNT!. %%D
)
if "%BACKUP_COUNT%"=="0" (
  echo [RESTORE] No production backups were found.
  goto :eof
)
echo.
set "RESTORE_CHOICE="
set /p "RESTORE_CHOICE=Enter backup number to restore: "
if not defined RESTORE_CHOICE (
  echo [RESTORE] No backup selected.
  goto :eof
)
set "SELECTED_BACKUP=!BACKUP_%RESTORE_CHOICE%!"
if not defined SELECTED_BACKUP (
  echo [RESTORE] Invalid backup number.
  goto :eof
)
set "RESTORE_SOURCE=%BACKUP_ROOT%\%SELECTED_BACKUP%"
echo [RESTORE] Restoring from %RESTORE_SOURCE%
call :stop_stack "PROD" 3000 4000
call :stop_bot_chat
call :stop_guest_booking
if not exist "%PROD_ROOT%" (
  echo [RESTORE] Production folder not found.
  goto :eof
)
robocopy "%RESTORE_SOURCE%" "%PROD_ROOT%" /MIR /XD ".git" "node_modules" ".next" ".codex-logs" ".stversions"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo [RESTORE] Restore failed with code %ROBOCODE%.
  goto :eof
)
echo.
echo [PROD] Starting portal, API, backup, bot chat, and hostel guest booking...
echo [PROD] Tunnel is managed separately and will not be touched.
call :start_stack "PROD" 3000 4000 "%PROD_ROOT%"
if errorlevel 1 goto :eof
call :start_bot_chat
call :start_guest_booking
echo [RESTORE] Production restored from %SELECTED_BACKUP%.
goto :eof

:start_bot_chat
echo [PROD] Starting bot chat from %PROD_ROOT%\bot
if not exist "%PROD_ROOT%\bot\run-bot-win.cmd" (
  echo [PROD] Bot run script not found.
  goto :eof
)
start "PROD Bot Chat :4111" cmd /c "cd /d ""%PROD_ROOT%\bot"" && call run-bot-win.cmd"
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
start "PROD Guest Booking :4115" cmd /k "cd /d ""%PROD_ROOT%\guest-booking-standalone"" && node server.js"
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
