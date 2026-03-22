$ErrorActionPreference = "Stop"

Write-Host "Stopping all local Node.js processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

Start-Sleep -Seconds 2

Write-Host "Ports after cleanup:" -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 3000,3001,4000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess, State

Write-Host ""
Write-Host "Now start these in 3 separate PowerShell windows:" -ForegroundColor Green
Write-Host "1. API  -> cd ""C:\Users\User\Desktop\cozorohome webapp\api""; npm run dev"
Write-Host "2. App  -> cd ""C:\Users\User\Desktop\cozorohome webapp\portal""; npm run dev"
Write-Host "3. Tunnel -> cd ""C:\Users\User\Desktop\cozorohome webapp\tools""; .\cloudflared.exe tunnel run cozorohome-portal"
