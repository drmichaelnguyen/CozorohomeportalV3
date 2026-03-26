@echo off
REM CozoroHome Sandbox — Portal :3002 | API :4002
REM Runs independently from the public app (Portal :3001 | API :4001)

echo === CozoroHome Sandbox ===
echo Portal  ^-^> http://localhost:3002
echo API     ^-^> http://localhost:4002
echo.

REM Start API on 4002 in a new window
start "Sandbox API :4002" cmd /k "cd /d "%~dp0api" && set PORT=4002 && set GOOGLE_REDIRECT_URI=http://localhost:4002/integrations/google/oauth/callback && npx tsx watch src/index.ts"

REM Wait briefly then start Portal on 3002
timeout /t 3 /nobreak >nul
cd /d "%~dp0portal"
set API_SERVER_ORIGIN=http://localhost:4002
npx next dev -p 3002 --webpack
