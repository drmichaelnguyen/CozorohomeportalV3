# CozoroHome - Full Backup
# Double-click or: powershell -ExecutionPolicy Bypass -File backup.ps1
# Backs up immediately, then every 12 hours as long as the window stays open.

$mysqldump     = "C:\Program Files\MariaDB 12.2\bin\mysqldump.exe"
$dbHost        = "127.0.0.1"
$dbPort        = "3306"
$dbUser        = "root"
$dbPass        = "root"
$dbName        = "cozorohome"
$backupRoot    = "C:\Users\User\Desktop\DATABASE"
$intervalHours = 12

$sandboxRoot   = "C:\Users\User\Desktop\cozorohome webapp"
$prodRoot      = "C:\Users\User\Desktop\cozorohome-prod"

function Write-Step($msg) { Write-Host "  >> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !! $msg" -ForegroundColor Yellow }

function Copy-Safe($src, $destFile) {
    if (Test-Path $src) {
        $destDir = Split-Path $destFile -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
        Copy-Item $src $destFile -Force
    } else {
        Write-Warn "Skipped (not found): $src"
    }
}

function Copy-Dir($src, $dest) {
    if (Test-Path $src) {
        Copy-Item $src $dest -Recurse -Force
    } else {
        Write-Warn "Skipped (not found): $src"
    }
}

function Run-Backup {
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
    $base      = Join-Path $backupRoot $timestamp

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Magenta
    Write-Host "  CozoroHome Backup  -  $timestamp" -ForegroundColor Magenta
    Write-Host "==========================================" -ForegroundColor Magenta

    # ──────────────────────────────────────────────────────────────────────────
    # Folder: database  (single dump covers both sandbox + prod - same DB)
    # ──────────────────────────────────────────────────────────────────────────
    $dbFolder = Join-Path $base "database"
    New-Item -ItemType Directory -Path $dbFolder | Out-Null

    Write-Step "Dumping MariaDB '$dbName'..."
    $dbFile = Join-Path $dbFolder "cozorohome.sql"
    $env:MYSQL_PWD = $dbPass
    & $mysqldump `
        --host=$dbHost --port=$dbPort --user=$dbUser `
        --single-transaction --routines --triggers --events `
        --result-file=$dbFile $dbName

    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Database dump failed!"
    } else {
        $kb = [math]::Round((Get-Item $dbFile).Length / 1KB, 1)
        Write-Ok "database/cozorohome.sql  ($kb KB)"
    }

    # ──────────────────────────────────────────────────────────────────────────
    # Folder: sandbox  (dev environment - cozorohome webapp)
    # ──────────────────────────────────────────────────────────────────────────
    $sandboxFolder = Join-Path $base "sandbox"
    New-Item -ItemType Directory -Path $sandboxFolder | Out-Null

    Write-Step "Backing up sandbox (dev)..."
    Copy-Safe  "$sandboxRoot\api\.env"                             "$sandboxFolder\api.env"
    Copy-Safe  "$sandboxRoot\guest-booking-standalone\.env"        "$sandboxFolder\standalone.env"
    Copy-Dir   "$sandboxRoot\api\data"                             "$sandboxFolder\api-data"
    Copy-Dir   "$sandboxRoot\guest-booking-standalone\data"        "$sandboxFolder\standalone-data"
    Write-Ok   "sandbox/ done"

    # ──────────────────────────────────────────────────────────────────────────
    # Folder: production  (live site - cozorohome-prod)
    # ──────────────────────────────────────────────────────────────────────────
    $prodFolder = Join-Path $base "production"
    New-Item -ItemType Directory -Path $prodFolder | Out-Null

    Write-Step "Backing up production..."
    Copy-Safe  "$prodRoot\api\.env"                                "$prodFolder\api.env"
    Copy-Safe  "$prodRoot\guest-booking-standalone\.env"           "$prodFolder\standalone.env"
    Copy-Dir   "$prodRoot\api\data"                                "$prodFolder\api-data"
    Copy-Dir   "$prodRoot\guest-booking-standalone\data"           "$prodFolder\standalone-data"
    Write-Ok   "production/ done"

    # ──────────────────────────────────────────────────────────────────────────
    # Summary
    # ──────────────────────────────────────────────────────────────────────────
    $totalKb = [math]::Round(
        (Get-ChildItem $base -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB, 1
    )
    Write-Host ""
    Write-Host "  Saved: $base" -ForegroundColor White
    Write-Host "  Size:  $totalKb KB total" -ForegroundColor White
    Write-Host ""
    Write-Host "  Folder layout:" -ForegroundColor DarkGray
    Write-Host "    $timestamp/database/       - full MariaDB dump" -ForegroundColor DarkGray
    Write-Host "    $timestamp/sandbox/        - dev .env + data files" -ForegroundColor DarkGray
    Write-Host "    $timestamp/production/     - prod .env + data files" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Run immediately, then loop every 12 hours ──────────────────────────────────
if (-not (Test-Path $backupRoot)) {
    New-Item -ItemType Directory -Path $backupRoot | Out-Null
}

Run-Backup

while ($true) {
    $nextTime = (Get-Date).AddHours($intervalHours)
    Write-Host "Next backup at: $($nextTime.ToString('yyyy-MM-dd HH:mm'))" -ForegroundColor DarkGray
    Write-Host "Keep this window open. Press Ctrl+C to stop." -ForegroundColor DarkGray

    while ((Get-Date) -lt $nextTime) {
        $rem = $nextTime - (Get-Date)
        $h = [math]::Floor($rem.TotalHours)
        $m = $rem.Minutes
        Write-Host "`r  Next in: ${h}h ${m}m   " -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Seconds 60
    }

    Write-Host ""
    Run-Backup
}
