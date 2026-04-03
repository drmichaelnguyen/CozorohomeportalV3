@echo off
REM CozoroHome Local Portal — :3002

cd /d "%~dp0portal"
set API_SERVER_ORIGIN=http://localhost:4002
npx next dev -p 3002 --webpack
