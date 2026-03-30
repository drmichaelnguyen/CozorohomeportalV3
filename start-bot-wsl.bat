@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BOT_DIR=%ROOT%\bot"
set "START_PS1=%BOT_DIR%\start-bot-win.ps1"
set "LOG_FILE=%BOT_DIR%\bot-win.log"
set "ERR_FILE=%BOT_DIR%\bot-win.err.log"
set "PORT=4111"
set "LOCAL_HEALTH=http://127.0.0.1:%PORT%/health"
set "PUBLIC_HEALTH=https://chatbot.cozorohome.com/health"
set "MODE=%~1"

if "%MODE%"=="" set "MODE=start"

if /I "%MODE%"=="start" goto start_bot
if /I "%MODE%"=="stop" goto stop_bot
if /I "%MODE%"=="restart" goto restart_bot
if /I "%MODE%"=="diagnose" goto diagnose_bot
if /I "%MODE%"=="wsl" goto start_wsl
if /I "%MODE%"=="help" goto usage

echo Unknown command: %MODE%
goto usage

:usage
echo Usage: %~nx0 [start^|stop^|restart^|diagnose^|wsl^|help]
echo.
echo   start     Start the Windows bot on port %PORT%
echo   stop      Stop the Windows bot process
echo   restart   Stop and then start the Windows bot
echo   diagnose  Check bot process, port, local health, public health, and logs
echo   wsl       Run the bot in WSL dev mode
echo   help      Show this help
exit /b 1

:start_bot
if not exist "%START_PS1%" (
  echo Missing start script: %START_PS1%
  exit /b 1
)
echo Starting Windows bot on port %PORT%...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%START_PS1%"
exit /b %ERRORLEVEL%

:stop_bot
echo Stopping Windows bot...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and (($_.Name -eq 'node.exe' -and $_.CommandLine -match 'cozorohome webapp\\bot\\dist\\src\\index\.js') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'run-bot-win\.cmd')) });" ^
  "if (-not $targets) { Write-Output 'bot-not-running'; exit 0 };" ^
  "$targets | ForEach-Object { Write-Output ('stopping ' + $_.Name + ' ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Start-Sleep -Seconds 1;" ^
  "Write-Output 'stop-complete'"
exit /b %ERRORLEVEL%

:restart_bot
call :stop_bot
if errorlevel 1 exit /b %ERRORLEVEL%
call :start_bot
exit /b %ERRORLEVEL%

:diagnose_bot
echo Running bot diagnostics...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$botPattern = 'cozorohome webapp\\bot\\dist\\src\\index\.js';" ^
  "$tunnelPattern = 'cloudflared-config\.chatbot\.yml';" ^
  "$bot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match $botPattern });" ^
  "$tunnel = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -and $_.CommandLine -match $tunnelPattern });" ^
  "Write-Output ('bot-processes: ' + $bot.Count);" ^
  "if ($bot.Count -gt 0) { $bot | ForEach-Object { Write-Output ('  PID ' + $_.ProcessId + ' ' + $_.Name) } };" ^
  "Write-Output ('tunnel-processes: ' + $tunnel.Count);" ^
  "if ($tunnel.Count -gt 0) { $tunnel | ForEach-Object { Write-Output ('  PID ' + $_.ProcessId + ' cloudflared.exe') } };" ^
  "if (Test-NetConnection -ComputerName 127.0.0.1 -Port %PORT% -InformationLevel Quiet) { Write-Output 'port-%PORT%: listening' } else { Write-Output 'port-%PORT%: closed' };" ^
  "try { $local = Invoke-WebRequest -UseBasicParsing '%LOCAL_HEALTH%' -TimeoutSec 5; Write-Output ('local-health: ' + [int]$local.StatusCode + ' ' + $local.Content) } catch { Write-Output ('local-health: ERROR ' + $_.Exception.Message) };" ^
  "try { $public = Invoke-WebRequest -UseBasicParsing '%PUBLIC_HEALTH%' -TimeoutSec 10; Write-Output ('public-health: ' + [int]$public.StatusCode + ' ' + $public.Content) } catch { if ($_.Exception.Response) { Write-Output ('public-health: ERROR ' + [int]$_.Exception.Response.StatusCode.value__) } else { Write-Output ('public-health: ERROR ' + $_.Exception.Message) } };" ^
  "if (Test-Path '%LOG_FILE%') { Write-Output 'log-tail:'; Get-Content '%LOG_FILE%' -Tail 10 };" ^
  "if (Test-Path '%ERR_FILE%') { Write-Output 'err-tail:'; Get-Content '%ERR_FILE%' -Tail 10 }"
exit /b %ERRORLEVEL%

:start_wsl
for /f "usebackq delims=" %%i in (`wsl wslpath -a "%ROOT%"`) do set "WSL_ROOT=%%i"

if not defined WSL_ROOT (
  echo Failed to resolve WSL path for %ROOT%
  exit /b 1
)

echo Starting Cozorohome bot in WSL from %ROOT%
echo WSL path: %WSL_ROOT%
wsl bash -lc "cd \"%WSL_ROOT%\" && COREPACK_HOME=/tmp/corepack TMPDIR=/tmp corepack pnpm --filter cozorohome-bot dev"
exit /b %ERRORLEVEL%
