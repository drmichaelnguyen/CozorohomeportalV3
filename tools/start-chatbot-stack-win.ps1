$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\User\Desktop\cozorohome webapp"
$botStartScript = Join-Path $workspaceRoot "bot\start-bot-win.ps1"
$tunnelStartScript = Join-Path $workspaceRoot "tools\start-chatbot-tunnel-hidden.ps1"

if (-not (Test-Path $botStartScript)) {
  throw "Bot start script was not found at $botStartScript"
}

if (-not (Test-Path $tunnelStartScript)) {
  throw "Tunnel start script was not found at $tunnelStartScript"
}

& $botStartScript
Start-Sleep -Seconds 2
& $tunnelStartScript
