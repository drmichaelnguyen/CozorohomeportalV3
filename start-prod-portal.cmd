@echo off
REM CozoroHome Production Portal — :3000

cd /d "%~dp0portal"
set API_SERVER_ORIGIN=http://localhost:4000
npx next dev -p 3000 --webpack
