@echo off
setlocal

cd /d "%~dp0"

echo Closing any existing background cloudflared processes on this machine...
taskkill /IM cloudflared.exe /F >nul 2>&1

echo.
echo Starting named Cloudflare tunnel manually...
echo Keep this window open. Close it or press CTRL+C to stop the tunnel.
echo.

set "CF_CONFIG=%USERPROFILE%\.cloudflared\config.yml"
if exist "%CF_CONFIG%" (
  call cloudflared.exe tunnel run cozorohome-portal
) else (
  echo WARNING: No config.yml found in %USERPROFILE%\.cloudflared\
  echo Trying fallback quick tunnel for port 3000...
  call cloudflared.exe tunnel --url http://localhost:3000
)

pause
