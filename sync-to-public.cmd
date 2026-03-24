@echo off
setlocal

:: Define Source (current folder) and Destination
set SOURCE=%CD%
set DEST=C:\Users\User\Desktop\cozorohome-public

echo.
echo ============================================================
echo   COZORO DEPLOYMENT SYNC: LOCAL -^> PUBLIC
echo ============================================================
echo Source: %SOURCE%
echo Dest:   %DEST%
echo.

:: Check if destination exists, if not, create it
if not exist "%DEST%" (
    echo [!] Public folder does not exist. Creating: "%DEST%"
    mkdir "%DEST%"
)

echo [1/1] Syncing files...
:: /E : Copy subdirectories, including empty ones.
:: /Z : Copy files in restartable mode.
:: /XB : Exclude junction points and symbolic links.
:: /R:3 /W:5 : Retry 3 times, wait 5 seconds between retries.
:: /XD : Exclude directories (node_modules, .git, .next, dist).
:: /XF : Exclude files (.env, .env.local, log files).
robocopy "%SOURCE%" "%DEST%" /E /Z /R:3 /W:5 /TBD /NP /V /MT:8 ^
    /XD ".git" ".next" "node_modules" "api\dist" "api\.prisma" "temp" ".codex-logs" ^
    /XF ".env" ".env.local" "npm-error.log" "npm-verbose-error.log" "tsc_output.txt" "api.zip"

echo.
echo ============================================================
echo   STAGING COMPLETE
echo ============================================================
echo Next step: Go to "%DEST%" and run refresh-all.cmd
echo.
pause
