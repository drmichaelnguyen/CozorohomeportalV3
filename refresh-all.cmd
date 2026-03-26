@echo off
setlocal

cd /d "%~dp0"

echo [1/3] Launching API Refresh...
start "API Refresh" cmd /c "cd /d api && call refresh-api.cmd"

echo [2/3] Launching Portal Refresh...
start "Portal Refresh" cmd /c "cd /d portal && call refresh-portal.cmd"

echo [3/3] Launching Tunnel Refresh...
start "Tunnel Refresh" cmd /c "cd /d tools && call refresh-tunnel.cmd"

echo.
echo API, Portal, and Tunnel refresh sequences have been started in new windows.
echo You can monitor their progress individually.
pause
