@echo off
rem Dev stack using portable Node (no admin). Requires: tools\nodejs-portable\ — see HOWTO.txt there.
call "%~dp0scripts\portable-node-env.cmd" || exit /b 1
cd /d "%~dp0"

if not exist "node_modules" (
  echo [dev-portable] First run: enabling corepack and installing deps...
  call corepack enable
  call corepack pnpm install || exit /b 1
)

echo [dev-portable] Starting API in a new window...
start "CozoroHome API" cmd /k "cd /d ""%~dp0"" && call ""%~dp0scripts\portable-node-env.cmd"" && corepack pnpm --filter cozorohome-api dev"

timeout /t 4 /nobreak >nul
echo [dev-portable] Starting portal on http://localhost:3000 ...
call corepack pnpm --filter cozorohome-portal dev
