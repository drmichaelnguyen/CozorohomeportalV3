@echo off
setlocal

cd /d "%~dp0"

echo [1/2] Launching API Refresh...
start "API Refresh" cmd /c "cd /d api && call refresh-api.cmd"

echo [2/2] Launching Portal Refresh...
start "Portal Refresh" cmd /c "cd /d portal && call refresh-portal.cmd"

echo.
echo Both API and Portal refresh sequences have been started in new windows.
echo You can monitor their progress individually.
pause
