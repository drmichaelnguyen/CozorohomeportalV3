@echo off
REM CozoroHome Production API on Desktop — :4000

cd /d "C:\Users\User\Desktop\cozorohome-prod\api"
set PORT=4000
set GOOGLE_REDIRECT_URI=http://localhost:4000/integrations/google/oauth/callback
npx tsx watch src/index.ts
