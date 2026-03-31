@echo off
setlocal

cd /d "%~dp0"

if not exist dist mkdir dist

echo Building cozoroctl.exe with pkg...
set PKG_CACHE_PATH=%LOCALAPPDATA%\\CozoroHome\\pkg-cache
set XDG_CACHE_HOME=%LOCALAPPDATA%\\CozoroHome\\xdg-cache
corepack pnpm dlx pkg@5.8.1 --targets node18-win-x64 --output dist\\cozoroctl.exe cozoroctl.cjs

if %errorlevel% neq 0 (
  echo Build failed.
  exit /b 1
)

echo Built: %cd%\\dist\\cozoroctl.exe
pause
