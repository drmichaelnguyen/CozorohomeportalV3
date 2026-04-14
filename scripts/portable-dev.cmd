@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

call "%~dp0portable-node-env.cmd" || (
  echo [portable-dev] Portable Node not found. See tools\nodejs-portable\HOWTO.txt
  exit /b 1
)

if /i "%ACTION%"=="stop" goto :do_stop
if /i "%ACTION%"=="restart" goto :do_restart
if /i not "%ACTION%"=="start" (
  echo Usage: %~nx0 [start ^| stop ^| restart]
  exit /b 1
)
goto :do_start

:do_restart
echo [portable-dev] Restarting...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
rem `timeout` fails when stdin is not a console (e.g. Cursor agent); ping works as a short delay
ping 127.0.0.1 -n 3 >nul

:do_start
set "REPO_ROOT=%CD%"
echo [portable-dev] Installing deps and Prisma (if needed)...
if not exist "node_modules" (
  call corepack enable >nul 2>&1
  call corepack pnpm install --no-frozen-lockfile || exit /b 1
) else (
  call corepack pnpm install --no-frozen-lockfile || exit /b 1
)
call corepack pnpm --filter cozorohome-api prisma:generate || exit /b 1
rem This repo uses schema sync via `prisma db push` / migrate from api — not `migrate deploy` on boot (no migrations dir in git).
echo [portable-dev] After pulling schema changes: cd api ^&^& npx prisma generate ^&^& npx prisma db push

echo [portable-dev] Starting API :4000 in a new window...
start "CozoroHome API :4000" cmd /k "cd /d ""%REPO_ROOT%"" && call ""%~dp0portable-node-env.cmd"" && corepack pnpm --filter cozorohome-api dev"
ping 127.0.0.1 -n 4 >nul
echo [portable-dev] Starting Portal :3000 in a new window...
start "CozoroHome Portal :3000" cmd /k "cd /d ""%REPO_ROOT%"" && call ""%~dp0portable-node-env.cmd"" && corepack pnpm --filter cozorohome-portal dev"
echo [portable-dev] Portal http://localhost:3000   API http://localhost:4000
goto :eof

:do_stop
echo [portable-dev] Stopping listeners on 3000 and 4000...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
echo [portable-dev] Done.
goto :eof
