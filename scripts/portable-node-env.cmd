@echo off
rem Prepend portable Node to PATH for this cmd session (no admin).
rem Install: tools\nodejs-portable\HOWTO.txt

pushd "%~dp0.." >nul || exit /b 1
set "REPO_ROOT=%CD%"
popd >nul

set "BASE=%REPO_ROOT%\tools\nodejs-portable"
set "NODE_BIN="

if exist "%BASE%\node.exe" set "NODE_BIN=%BASE%"

if not defined NODE_BIN for /d %%D in ("%BASE%\node-v*-win-x64") do (
  if exist "%%~fD\node.exe" (
    set "NODE_BIN=%%~fD"
    goto :found
  )
)

:found
if not defined NODE_BIN (
  echo [portable-node] No node.exe under "%BASE%"
  echo [portable-node] See tools\nodejs-portable\HOWTO.txt
  exit /b 1
)

set "PATH=%NODE_BIN%;%PATH%"
exit /b 0
