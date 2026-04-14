@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0scripts\portable-node-env.cmd" || (
  echo [rebuild-restart] No portable Node under tools\nodejs-portable — install per tools\nodejs-portable\HOWTO.txt
  echo [rebuild-restart] Or open a shell where Node/pnpm are on PATH and run: pnpm build ^&^& portable-dev.cmd restart
  exit /b 1
)

echo [rebuild-restart] Building API + portal...
call corepack pnpm build || exit /b 1

echo [rebuild-restart] Restarting dev servers ^(:3000 portal, :4000 API^)...
call "%~dp0portable-dev.cmd" restart || exit /b 1

endlocal
exit /b 0
