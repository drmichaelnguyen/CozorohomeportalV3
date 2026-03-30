$wd = 'C:\Users\User\Desktop\cozorohome webapp\bot'
$log = Join-Path $wd 'bot-win.log'
$err = Join-Path $wd 'bot-win.err.log'
Remove-Item $log, $err -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $wd 'run-bot-win.cmd') -WorkingDirectory $wd -WindowStyle Hidden
Start-Sleep -Seconds 3
if (Test-NetConnection -ComputerName 127.0.0.1 -Port 4111 -InformationLevel Quiet) {
  Write-Output 'listening'
} else {
  Write-Output 'not-listening'
  if (Test-Path $log) { Get-Content $log -Tail 40 }
  if (Test-Path $err) { Get-Content $err -Tail 40 }
}
