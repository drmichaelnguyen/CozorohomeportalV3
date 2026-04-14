@echo off
rem Windows dev stack — same as portable-dev (portal :3000, API :4000). Requires portable Node: tools\nodejs-portable\ — see tools\nodejs-portable\HOWTO.txt
cd /d "%~dp0"
call "%~dp0portable-dev.cmd" %*
