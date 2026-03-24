@echo off
setlocal enabledelayedexpansion

:: Cozorohome Data Backup & Mirroring Script
:: This script mirrors the critical 'data' directory and configuration files to a backup location.
:: Use this to sync to OneDrive, Google Drive, or another networked computer.

:: --- CONFIGURATION ---
set "SOURCE_DIR=%~dp0..\api\data"
set "ENV_FILE=%~dp0..\api\.env"
set "BACKUP_ROOT=C:\Users\%USERNAME%\OneDrive\CozoroBackup"
:: If syncing to another computer via network share, use a path like:
:: set "BACKUP_ROOT=\\BACKUP-PC\CozoroMirror"

echo [INFO] Starting Cozorohome Backup Sync...
echo [INFO] Source: %SOURCE_DIR%
echo [INFO] Target: %BACKUP_ROOT%

:: Create backup root if it doesn't exist
if not exist "%BACKUP_ROOT%" (
    echo [INFO] Creating backup directory...
    mkdir "%BACKUP_ROOT%"
)

:: Sync the data directory using robocopy
:: /MIR mirrors the directory (deletes files in target if not in source)
:: /R:3 retries 3 times on failure
:: /W:5 waits 5 seconds between retries
:: /MT:8 multi-threaded (8 threads)
echo [INFO] Syncing data directory...
robocopy "%SOURCE_DIR%" "%BACKUP_ROOT%\data" /MIR /R:3 /W:5 /MT:8 /NP /NFL /NDL

:: Backup the .env file (important for credentials)
echo [INFO] Backing up configuration...
copy /Y "%ENV_FILE%" "%BACKUP_ROOT%\.env.backup" >nul

echo [SUCCESS] Backup sync completed at %DATE% %TIME%
echo [TIP] You can schedule this script using Windows Task Scheduler to run every hour.
pause
