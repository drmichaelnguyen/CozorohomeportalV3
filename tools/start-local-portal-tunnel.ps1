$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\User\Desktop\cozorohome webapp"
$portalDir = Join-Path $workspaceRoot "portal"
$apiDir = Join-Path $workspaceRoot "api"
$cloudflaredPath = Join-Path $workspaceRoot "tools\cloudflared.exe"

if (-not (Test-Path $cloudflaredPath)) {
  throw "cloudflared.exe was not found at $cloudflaredPath"
}

Write-Host "Starting API dev server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoLogo",
  "-NoProfile",
  "-Command",
  "cd '$apiDir'; npm run dev"
) -WorkingDirectory $apiDir

Start-Sleep -Seconds 3

Write-Host "Starting portal dev server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoLogo",
  "-NoProfile",
  "-Command",
  "cd '$portalDir'; npm run dev"
) -WorkingDirectory $portalDir

Start-Sleep -Seconds 5

Write-Host "Starting Cloudflare Quick Tunnel for http://localhost:3000 ..." -ForegroundColor Cyan
Write-Host "Keep this window open while the tunnel is in use." -ForegroundColor Yellow
& $cloudflaredPath tunnel --url http://localhost:3000
