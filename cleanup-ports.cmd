@echo off
setlocal

echo ============================================================
echo   CLEANING UP PORTAL AND API PROCESSES
echo ============================================================

:: Kill processes by port 3000 (Portal)
echo [1/3] Killing processes on port 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%P /F >nul 2>&1
)

:: Kill processes by port 4000 (API)
echo [2/3] Killing processes on port 4000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
    taskkill /PID %%P /F >nul 2>&1
)

:: Kill processes by port 4001 (Local API / Conflict)
echo [3/3] Killing processes on port 4001...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4001" ^| findstr "LISTENING"') do (
    taskkill /PID %%P /F >nul 2>&1
)

:: Specifically target windows with titles if they exist
echo.
echo [!] Closing any windows titled "API Refresh" or "Portal Refresh"...
taskkill /FI "WINDOWTITLE eq API Refresh*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Portal Refresh*" /F >nul 2>&1

echo.
echo ============================================================
echo   CLEANUP COMPLETE
echo ============================================================
pause
