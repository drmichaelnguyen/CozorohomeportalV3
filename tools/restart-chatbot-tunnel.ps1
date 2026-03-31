$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\User\Desktop\cozorohome webapp"
$cloudflaredPath = Join-Path $workspaceRoot "tools\cloudflared.exe"
$chatbotConfigPath = Join-Path $workspaceRoot "tools\cloudflared-config.chatbot.yml"
$chatbotTunnelName = "cozorohome-chatbot"

if (-not (Test-Path $cloudflaredPath)) {
  throw "cloudflared.exe was not found at $cloudflaredPath"
}

if (-not (Test-Path $chatbotConfigPath)) {
  throw "Chatbot tunnel config was not found at $chatbotConfigPath"
}

# Stop only the chatbot tunnel process, not other cloudflared tunnels (like the portal service).
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "tunnel\\s+.*\\s+run\\s+$chatbotTunnelName" } |
  ForEach-Object {
    try {
      Write-Host "Stopping chatbot tunnel PID $($_.ProcessId)..." -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {}
  }

Start-Sleep -Seconds 1

Write-Host "Starting Cloudflare named tunnel: $chatbotTunnelName" -ForegroundColor Cyan
Write-Host "Tunnel URL: https://chatbot.cozorohome.com" -ForegroundColor Green
Write-Host "Short-term URL: https://shortterm.cozorohome.com" -ForegroundColor Green
Write-Host "Keep this PowerShell window open while chatbot tunnel is in use." -ForegroundColor Yellow

& $cloudflaredPath tunnel --config $chatbotConfigPath run $chatbotTunnelName
