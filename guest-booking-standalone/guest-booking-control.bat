@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "REPO_DIR=%ROOT_DIR%.."
set "PORTAL_DIR=%REPO_DIR%\portal"
set "TOOLS_DIR=%REPO_DIR%\tools"
set "SHORTTERM_TUNNEL_SCRIPT=%TOOLS_DIR%\restart-shortterm-tunnel.ps1"

set "GUEST_PORT=4115"
set "GUEST_ONLINE_URL=https://hostel.cozorohome.com"
set "PORTAL_PORT=3001"
set "PORTAL_LOCAL_URL=http://localhost:3001"
set "PORTAL_WINDOW_TITLE=Guest Booking Standalone"
set "TUNNEL_WINDOW_TITLE=Cloudflare Tunnel"

call :load_guest_env
call :load_portal_env

set "COMMAND=%~1"
if "%COMMAND%"=="" goto :menu

if /I "%COMMAND%"=="menu" goto :menu
if /I "%COMMAND%"=="guest-diagnose" goto :guest_diagnose
if /I "%COMMAND%"=="guest-start" goto :guest_start
if /I "%COMMAND%"=="guest-kill" goto :guest_kill
if /I "%COMMAND%"=="guest-restart" goto :guest_restart
if /I "%COMMAND%"=="portal-diagnose" goto :portal_diagnose
if /I "%COMMAND%"=="portal-start" goto :portal_start
if /I "%COMMAND%"=="portal-kill" goto :portal_kill
if /I "%COMMAND%"=="portal-restart" goto :portal_restart
if /I "%COMMAND%"=="tunnel-diagnose" goto :tunnel_diagnose
if /I "%COMMAND%"=="tunnel-start" goto :tunnel_start
if /I "%COMMAND%"=="tunnel-kill" goto :tunnel_kill
if /I "%COMMAND%"=="tunnel-restart" goto :tunnel_restart
if /I "%COMMAND%"=="diagnose-all" goto :diagnose_all
if /I "%COMMAND%"=="restart-all" goto :restart_all
if /I "%COMMAND%"=="help" goto :help

echo Unknown command: %COMMAND%
echo.
goto :help

:menu
cls
echo ============================================================
echo   COZOROHOME CONTROL PANEL
echo ============================================================
echo.
echo Guest booking:
echo   1. Diagnose guest booking
echo   2. Start guest booking
echo   3. Kill guest booking
echo   4. Restart guest booking
echo.
echo Portal:
echo   5. Diagnose portal
echo   6. Start portal
echo   7. Kill portal
echo   8. Restart portal
echo.
echo Tunnel:
echo   9. Diagnose tunnel
echo   10. Start tunnel
echo   11. Kill tunnel
echo   12. Restart tunnel
echo.
echo Combined:
echo   13. Diagnose all
echo   14. Restart all
echo   15. Exit
echo.
set /p "CHOICE=Select an option: "

if "%CHOICE%"=="1" goto :guest_diagnose
if "%CHOICE%"=="2" goto :guest_start
if "%CHOICE%"=="3" goto :guest_kill
if "%CHOICE%"=="4" goto :guest_restart
if "%CHOICE%"=="5" goto :portal_diagnose
if "%CHOICE%"=="6" goto :portal_start
if "%CHOICE%"=="7" goto :portal_kill
if "%CHOICE%"=="8" goto :portal_restart
if "%CHOICE%"=="9" goto :tunnel_diagnose
if "%CHOICE%"=="10" goto :tunnel_start
if "%CHOICE%"=="11" goto :tunnel_kill
if "%CHOICE%"=="12" goto :tunnel_restart
if "%CHOICE%"=="13" goto :diagnose_all
if "%CHOICE%"=="14" goto :restart_all
if "%CHOICE%"=="15" goto :done

echo.
echo Invalid selection.
pause
goto :menu

:load_guest_env
if not exist "%ROOT_DIR%.env" goto :eof

for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT_DIR%.env") do (
    if /I "%%A"=="PORT" set "GUEST_PORT=%%B"
    if /I "%%A"=="ONLINE_URL" set "GUEST_ONLINE_URL=%%B"
)
goto :eof

:load_portal_env
if not exist "%PORTAL_DIR%\.env.local" goto :eof

for /f "usebackq tokens=1,* delims==" %%A in ("%PORTAL_DIR%\.env.local") do (
    if /I "%%A"=="PORT" set "PORTAL_PORT=%%B"
)
set "PORTAL_LOCAL_URL=http://localhost:%PORTAL_PORT%"
goto :eof

:guest_diagnose
cls
echo ============================================================
echo   GUEST BOOKING DIAGNOSE
echo ============================================================
echo Port       : %GUEST_PORT%
echo Local URL  : http://localhost:%GUEST_PORT%/
echo Online URL : %GUEST_ONLINE_URL%
echo.
call :check_port "%GUEST_PORT%" "Guest booking"
call :check_http "http://localhost:%GUEST_PORT%/" "Guest booking local page"
call :check_http "http://localhost:%GUEST_PORT%/api/config" "Guest booking local API"
if defined GUEST_ONLINE_URL call :check_http "%GUEST_ONLINE_URL%" "Guest booking online page"
goto :finish_action

:guest_start
cls
echo Starting guest booking on http://localhost:%GUEST_PORT%/
start "%PORTAL_WINDOW_TITLE%" cmd /k "cd /d "%ROOT_DIR%" && npm run dev"
goto :finish_action

:guest_kill
cls
echo Closing guest booking window...
taskkill /FI "WINDOWTITLE eq %PORTAL_WINDOW_TITLE%*" /F >nul 2>&1
call :kill_port "%GUEST_PORT%" "Guest booking"
goto :finish_action

:guest_restart
call :guest_kill
timeout /t 2 /nobreak >nul
call :guest_start
goto :finish_action

:portal_diagnose
cls
echo ============================================================
echo   PORTAL DIAGNOSE
echo ============================================================
echo Port       : %PORTAL_PORT%
echo Local URL  : %PORTAL_LOCAL_URL%
echo.
call :check_port "%PORTAL_PORT%" "Portal"
call :check_http "%PORTAL_LOCAL_URL%" "Portal local page"
goto :finish_action

:portal_start
cls
if not exist "%PORTAL_DIR%\refresh-portal.cmd" (
    echo FAIL - Missing %PORTAL_DIR%\refresh-portal.cmd
    goto :finish_action
)
echo Starting portal using refresh-portal.cmd ...
start "Portal Refresh" cmd /c "cd /d "%PORTAL_DIR%" && call refresh-portal.cmd"
goto :finish_action

:portal_kill
cls
echo Closing portal windows...
taskkill /FI "WINDOWTITLE eq Portal Refresh*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cozoro Portal*" /F >nul 2>&1
call :kill_port "%PORTAL_PORT%" "Portal"
goto :finish_action

:portal_restart
call :portal_kill
timeout /t 2 /nobreak >nul
call :portal_start
goto :finish_action

:tunnel_diagnose
cls
echo ============================================================
echo   TUNNEL DIAGNOSE
echo ============================================================
call :check_process "cloudflared.exe" "Cloudflare tunnel process"
if exist "%TOOLS_DIR%\cloudflared.exe" (
    echo OK - cloudflared.exe found at %TOOLS_DIR%\cloudflared.exe
 ) else (
    echo FAIL - Missing %TOOLS_DIR%\cloudflared.exe
 )
echo.
call :check_http "%GUEST_ONLINE_URL%" "Guest booking online page"
goto :finish_action

:tunnel_start
cls
if not exist "%SHORTTERM_TUNNEL_SCRIPT%" (
    echo FAIL - Missing %SHORTTERM_TUNNEL_SCRIPT%
    goto :finish_action
)
echo Starting Cloudflare tunnel for %GUEST_ONLINE_URL%...
start "%TUNNEL_WINDOW_TITLE%" powershell -NoProfile -ExecutionPolicy Bypass -File "%SHORTTERM_TUNNEL_SCRIPT%"
goto :finish_action

:tunnel_kill
cls
echo Closing Cloudflare tunnel...
taskkill /FI "WINDOWTITLE eq %TUNNEL_WINDOW_TITLE%*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1
echo Done.
goto :finish_action

:tunnel_restart
call :tunnel_kill
timeout /t 2 /nobreak >nul
call :tunnel_start
goto :finish_action

:diagnose_all
cls
call :guest_diagnose_inline
echo.
call :portal_diagnose_inline
echo.
call :tunnel_diagnose_inline
goto :finish_action

:restart_all
cls
echo Restarting guest booking, portal, and tunnel...
call :guest_kill_inline
call :portal_kill_inline
call :tunnel_kill_inline
timeout /t 3 /nobreak >nul
call :guest_start_inline
call :portal_start_inline
timeout /t 3 /nobreak >nul
call :tunnel_start_inline
goto :finish_action

:guest_diagnose_inline
echo ============================================================
echo   GUEST BOOKING
echo ============================================================
call :check_port "%GUEST_PORT%" "Guest booking"
call :check_http "http://localhost:%GUEST_PORT%/" "Guest booking local page"
call :check_http "http://localhost:%GUEST_PORT%/api/config" "Guest booking local API"
if defined GUEST_ONLINE_URL call :check_http "%GUEST_ONLINE_URL%" "Guest booking online page"
goto :eof

:portal_diagnose_inline
echo ============================================================
echo   PORTAL
echo ============================================================
call :check_port "%PORTAL_PORT%" "Portal"
call :check_http "%PORTAL_LOCAL_URL%" "Portal local page"
goto :eof

:tunnel_diagnose_inline
echo ============================================================
echo   TUNNEL
echo ============================================================
call :check_process "cloudflared.exe" "Cloudflare tunnel process"
call :check_http "%GUEST_ONLINE_URL%" "Guest booking online page"
goto :eof

:guest_kill_inline
taskkill /FI "WINDOWTITLE eq %PORTAL_WINDOW_TITLE%*" /F >nul 2>&1
call :kill_port "%GUEST_PORT%" "Guest booking"
goto :eof

:portal_kill_inline
taskkill /FI "WINDOWTITLE eq Portal Refresh*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cozoro Portal*" /F >nul 2>&1
call :kill_port "%PORTAL_PORT%" "Portal"
goto :eof

:tunnel_kill_inline
taskkill /FI "WINDOWTITLE eq %TUNNEL_WINDOW_TITLE%*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1
goto :eof

:guest_start_inline
start "%PORTAL_WINDOW_TITLE%" cmd /k "cd /d "%ROOT_DIR%" && npm run dev"
goto :eof

:portal_start_inline
if exist "%PORTAL_DIR%\refresh-portal.cmd" start "Portal Refresh" cmd /c "cd /d "%PORTAL_DIR%" && call refresh-portal.cmd"
goto :eof

:tunnel_start_inline
if exist "%SHORTTERM_TUNNEL_SCRIPT%" start "%TUNNEL_WINDOW_TITLE%" powershell -NoProfile -ExecutionPolicy Bypass -File "%SHORTTERM_TUNNEL_SCRIPT%"
goto :eof

:check_port
set "CHECK_PORT=%~1"
set "CHECK_LABEL=%~2"
set "FOUND_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%CHECK_PORT%" ^| findstr "LISTENING"') do (
    set "FOUND_PID=%%P"
    goto :check_port_done
)
:check_port_done
if defined FOUND_PID (
    echo OK - %CHECK_LABEL% is listening on port %CHECK_PORT% with PID !FOUND_PID!
) else (
    echo FAIL - %CHECK_LABEL% is not listening on port %CHECK_PORT%.
)
goto :eof

:kill_port
set "KILL_PORT=%~1"
set "KILL_LABEL=%~2"
echo Killing %KILL_LABEL% on port %KILL_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%KILL_PORT%" ^| findstr "LISTENING"') do (
    echo Killing PID %%P
    taskkill /PID %%P /F >nul 2>&1
)
goto :eof

:check_process
set "PROC_NAME=%~1"
set "PROC_LABEL=%~2"
tasklist /FI "IMAGENAME eq %PROC_NAME%" | find /I "%PROC_NAME%" >nul
if errorlevel 1 (
    echo FAIL - %PROC_LABEL% is not running.
 ) else (
    echo OK - %PROC_LABEL% is running.
 )
goto :eof

:check_http
set "CHECK_URL=%~1"
set "CHECK_LABEL=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { $r = Invoke-WebRequest -Uri '%CHECK_URL%' -UseBasicParsing -TimeoutSec 10; Write-Host ('OK - %CHECK_LABEL% responded with HTTP ' + [int]$r.StatusCode); exit 0 } catch { if ($_.Exception.Response) { Write-Host ('FAIL - %CHECK_LABEL% returned HTTP ' + [int]$_.Exception.Response.StatusCode.value__); } else { Write-Host ('FAIL - %CHECK_LABEL% did not respond: ' + $_.Exception.Message); }; exit 1 }"
goto :eof

:help
echo Commands:
echo   %~nx0 guest-diagnose
echo   %~nx0 guest-start
echo   %~nx0 guest-kill
echo   %~nx0 guest-restart
echo   %~nx0 portal-diagnose
echo   %~nx0 portal-start
echo   %~nx0 portal-kill
echo   %~nx0 portal-restart
echo   %~nx0 tunnel-diagnose
echo   %~nx0 tunnel-start
echo   %~nx0 tunnel-kill
echo   %~nx0 tunnel-restart
echo   %~nx0 diagnose-all
echo   %~nx0 restart-all
goto :finish_action

:finish_action
echo.
pause
goto :done

:done
endlocal
