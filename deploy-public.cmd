@echo off
setlocal

:: Define Source (current folder) and Destination
set SOURCE=%CD%
set DEST=C:\Users\User\Desktop\cozorohome-public

echo.
echo ============================================================
echo   COZORO ONE-HIT DEPLOY: LOCAL -^> PUBLIC
echo ============================================================
echo Source: %SOURCE%
echo Dest:   %DEST%
echo.

echo [1/3] Cleaning up existing public processes...
:: Kill processes by port 3000 (Portal), 4000 (API), 4001 (Conflict)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000 :4000 :4001" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1

:: Close previous windows by title
taskkill /FI "WINDOWTITLE eq API Refresh*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Portal Refresh*" /F >nul 2>&1

echo [2/3] Syncing files to public folder...
robocopy "%SOURCE%" "%DEST%" /E /Z /R:3 /W:5 /TBD /NP /V /MT:8 ^
    /XD ".git" ".next" "node_modules" "api\dist" "api\.prisma" "temp" ".codex-logs" ^
    /XF ".env" ".env.local" "npm-error.log" "npm-verbose-error.log" "tsc_output.txt" "api.zip"

echo [3/3] Launching Public API and Portal in tabs...
:: Use 'wt' to launch the refresh sequences in new tabs of the same window
cd /d "%DEST%"
wt -w 0 nt -d "%DEST%\api" --title "API Refresh" cmd /c "set PORT=&& call refresh-api.cmd"
wt -w 0 nt -d "%DEST%\portal" --title "Portal Refresh" cmd /c "set PORT=&& call refresh-portal.cmd"

echo.
echo ============================================================
echo   DEPLOYMENT COMPLETE
echo ============================================================
echo Both API and Portal have been restarted in the public folder.
echo You can monitor their progress in the new windows.
echo.
pause
