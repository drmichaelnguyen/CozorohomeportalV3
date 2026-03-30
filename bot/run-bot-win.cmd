@echo off
setlocal

set SCRIPT_DIR=%~dp0
set PORT=4111
set BOT_PUBLIC_BASE_URL=http://localhost:4111
if exist "%SCRIPT_DIR%knowledge\Previous_chat_fanpage_raw.txt" (
  set "BOT_FANPAGE_TRANSCRIPT_PATHS=%SCRIPT_DIR%knowledge\Previous_chat_fanpage_raw.txt"
)
"C:\Program Files\nodejs\node.exe" "%SCRIPT_DIR%dist\src\index.js" 1>> "%SCRIPT_DIR%bot-win.log" 2>> "%SCRIPT_DIR%bot-win.err.log"
