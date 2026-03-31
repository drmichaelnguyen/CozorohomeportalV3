$wd = 'C:\Users\User\Desktop\cozorohome webapp\bot'
$log = Join-Path $wd 'bot-win-4211.log'
$err = Join-Path $wd 'bot-win-4211.err.log'

Get-NetTCPConnection -LocalPort 4211 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {}
  }

Start-Sleep -Seconds 1
Remove-Item $log, $err -ErrorAction SilentlyContinue
Start-Process -FilePath 'C:\Windows\System32\cmd.exe' -ArgumentList '/c', 'set PORT=4211&& set BOT_PUBLIC_BASE_URL=http://localhost:4211&& "C:\Program Files\nodejs\node.exe" dist\src\index.js 1>> bot-win-4211.log 2>> bot-win-4211.err.log' -WorkingDirectory $wd -WindowStyle Hidden
Start-Sleep -Seconds 3
if (Test-NetConnection -ComputerName 127.0.0.1 -Port 4211 -InformationLevel Quiet) {
  Write-Output 'listening'
} else {
  Write-Output 'not-listening'
  if (Test-Path $log) { Get-Content $log -Tail 40 }
  if (Test-Path $err) { Get-Content $err -Tail 40 }
}
