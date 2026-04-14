@echo off
rem Wrapper: uses portable Node from tools\nodejs-portable (no admin). See tools\nodejs-portable\HOWTO.txt
cd /d "%~dp0"
call "%~dp0scripts\portable-dev.cmd" %*
