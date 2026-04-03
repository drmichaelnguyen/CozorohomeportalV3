@echo off
REM CozoroHome Production Portal on Desktop — :3000

cd /d "C:\Users\User\Desktop\cozorohome-prod\portal"
set API_SERVER_ORIGIN=http://localhost:4000
if exist .next rmdir /s /q .next
npx next dev -p 3000 --webpack
