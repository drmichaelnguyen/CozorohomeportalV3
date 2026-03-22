@echo off
setlocal

cd /d "%~dp0"

echo Closing existing cloudflared processes...
taskkill /IM cloudflared.exe /F >nul 2>&1

set "CF_CONFIG=%USERPROFILE%\.cloudflared\config.yml"

if exist "%CF_CONFIG%" (
  echo Starting named Cloudflare tunnel...
  call cloudflared.exe tunnel run cozorohome-portal
) else (
  echo Starting Cloudflare quick tunnel for http://localhost:3000 ...
  call cloudflared.exe tunnel --url http://localhost:3000
)
