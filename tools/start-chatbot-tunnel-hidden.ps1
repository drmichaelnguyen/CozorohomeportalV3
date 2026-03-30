$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\User\Desktop\cozorohome webapp"
$toolsDir = Join-Path $workspaceRoot "tools"
$cloudflaredPath = Join-Path $toolsDir "cloudflared.exe"
$chatbotConfigPath = Join-Path $toolsDir "cloudflared-config.chatbot.yml"
$chatbotTunnelName = "cozorohome-chatbot"
$logPath = Join-Path $toolsDir "chatbot-tunnel.log"
$errPath = Join-Path $toolsDir "chatbot-tunnel.err.log"

if (-not (Test-Path $cloudflaredPath)) {
  throw "cloudflared.exe was not found at $cloudflaredPath"
}

if (-not (Test-Path $chatbotConfigPath)) {
  throw "Chatbot tunnel config was not found at $chatbotConfigPath"
}

# Stop only the chatbot tunnel process, not other cloudflared tunnels.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "tunnel\s+.*\s+run\s+$chatbotTunnelName" } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {}
  }

Remove-Item $logPath, $errPath -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Start-Process `
  -FilePath $cloudflaredPath `
  -ArgumentList @("tunnel", "--config", "`"$chatbotConfigPath`"", "run", $chatbotTunnelName) `
  -WorkingDirectory $toolsDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath

Start-Sleep -Seconds 3

$runningTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "tunnel\s+.*\s+run\s+$chatbotTunnelName" } |
  Select-Object -First 1

if ($runningTunnel) {
  Write-Output "tunnel-running"
} else {
  Write-Output "tunnel-not-running"
  if (Test-Path $logPath) { Get-Content $logPath -Tail 40 }
  if (Test-Path $errPath) { Get-Content $errPath -Tail 40 }
}
