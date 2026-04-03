# CozoroHome - Database Backup
# Usage: Right-click > Run with PowerShell
#        Or: powershell -ExecutionPolicy Bypass -File backup-db.ps1

$mysqldump  = "C:\Program Files\MariaDB 12.2\bin\mysqldump.exe"
$dbHost     = "127.0.0.1"
$dbPort     = "3306"
$dbUser     = "root"
$dbPass     = "root"
$dbName     = "cozorohome"
$backupDir  = Join-Path $PSScriptRoot "backups"
$keepDays   = 30

# Create backup folder if needed
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

# Timestamped filename
$timestamp  = Get-Date -Format "yyyy-MM-dd_HH-mm"
$filename   = "${dbName}_${timestamp}.sql"
$outputPath = Join-Path $backupDir $filename

# Run mysqldump
Write-Host "Backing up '$dbName' to $outputPath ..."

$env:MYSQL_PWD = $dbPass
& $mysqldump `
    --host=$dbHost `
    --port=$dbPort `
    --user=$dbUser `
    --single-transaction `
    --routines --triggers --events `
    --result-file=$outputPath `
    $dbName

if ($LASTEXITCODE -ne 0) {
    Write-Error "Backup FAILED (exit $LASTEXITCODE)"
    exit 1
}

$sizeKb = [math]::Round((Get-Item $outputPath).Length / 1KB, 1)
Write-Host "OK - $filename ($sizeKb KB)"

# Remove backups older than $keepDays days
$cutoff = (Get-Date).AddDays(-$keepDays)
$old = Get-ChildItem $backupDir -Filter "*.sql" | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) {
    $old | Remove-Item -Force
    Write-Host "Removed $($old.Count) old backup(s)."
}

Write-Host "Done."
