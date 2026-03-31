param (
    [string]$PublicUrl = "https://api.cozorohome.com/health",
    [string]$LocalUrl = "http://localhost:4000/health",
    [int]$CheckIntervalSeconds = 30
)

$TunnelBat = Join-Path $PSScriptRoot "start-tunnel-manual.bat"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       Auto-Failover Monitor Active      " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Monitoring public site: $PublicUrl"
Write-Host "Checking every $CheckIntervalSeconds seconds."
Write-Host "Press CTRL+C to stop monitoring."
Write-Host ""

while ($true) {
    $publicUp = $true
    try {
        # Timeout quickly to catch downed servers
        $response = Invoke-WebRequest -Uri $PublicUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($response.StatusCode -ne 200) {
            $publicUp = $false
        }
    } catch {
        $publicUp = $false
        $errorMsg = $_.Exception.Message
    }
    
    if (-not $publicUp) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ❌ Main site is DOWN!" -ForegroundColor Red
        if ($errorMsg) { Write-Host "   Reason: $errorMsg" -ForegroundColor DarkRed }
        
        Write-Host "   Checking if local backup API is healthy ($LocalUrl)..." -ForegroundColor Yellow
        $localUp = $true
        try {
            $localResponse = Invoke-WebRequest -Uri $LocalUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($localResponse.StatusCode -ne 200) {
                $localUp = $false
            }
        } catch {
            $localUp = $false
        }
        
        if ($localUp) {
            Write-Host "   ✅ Local API is UP! Triggering failover Cloudflare tunnel..." -ForegroundColor Green
            
            # Start the manual tunnel script in a new visible command window
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$TunnelBat`"" -WindowStyle Normal
            
            Write-Host ""
            Write-Host "=========================================" -ForegroundColor Magenta
            Write-Host "           FAILOVER ACTIVATED!           " -ForegroundColor Magenta
            Write-Host "=========================================" -ForegroundColor Magenta
            Write-Host "The backup tunnel is now running in a new window."
            Write-Host "This monitor will now exit to prevent flapping conflicts."
            Write-Host "When your primary PC is restored, close the tunnel window and restart this script."
            Write-Host "Sleeping 10s before exit..."
            Start-Sleep -Seconds 10
            break
        } else {
            Write-Host "   ❌ Local backup API is also DOWN. Cannot failover. Make sure 'npm run dev' is running here." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ✅ Main site is healthy." -ForegroundColor DarkGray
    }
    
    $errorMsg = $null
    Start-Sleep -Seconds $CheckIntervalSeconds
}
