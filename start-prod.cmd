@echo off
REM CozoroHome Production — Portal :3000 | API :4000
REM Runs independently from the sandbox app (Portal :3002 | API :4002)

echo === CozoroHome Production ===
echo Portal  ^-^> http://localhost:3000
echo API     ^-^> http://localhost:4000
echo.

REM Start API on 4000 in a new window
start "Prod API :4000" cmd /k "cd /d "%~dp0api" && set PORT=4000 && set GOOGLE_REDIRECT_URI=http://localhost:4000/integrations/google/oauth/callback && npx tsx watch src/index.ts"

REM Wait briefly then start Portal on 3000
timeout /t 3 /nobreak >nul
cd /d "%~dp0portal"
set API_SERVER_ORIGIN=http://localhost:4000
npx next dev -p 3000 --webpack
