$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\User\Desktop\cozorohome webapp"
$cloudflaredPath = Join-Path $workspaceRoot "tools\cloudflared.exe"
$shorttermConfigPath = Join-Path $workspaceRoot "tools\cloudflared-config.shortterm.yml"
$shorttermTunnelName = "cozorohome-shortterm"

if (-not (Test-Path $cloudflaredPath)) {
  throw "cloudflared.exe was not found at $cloudflaredPath"
}

if (-not (Test-Path $shorttermConfigPath)) {
  throw "Short-term tunnel config was not found at $shorttermConfigPath"
}

# This keeps shortterm on its own tunnel and avoids touching the main portal tunnel.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "tunnel\s+.*\s+run\s+$shorttermTunnelName" } |
  ForEach-Object {
    try {
      Write-Host "Stopping named tunnel PID $($_.ProcessId)..." -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {}
  }

Start-Sleep -Seconds 1

Write-Host "Starting Cloudflare named tunnel: $shorttermTunnelName" -ForegroundColor Cyan
Write-Host "Short-term URL: https://shortterm.cozorohome.com" -ForegroundColor Green
Write-Host "Keep this PowerShell window open while the short-term site is in use." -ForegroundColor Yellow

& $cloudflaredPath tunnel --config $shorttermConfigPath run $shorttermTunnelName
