@echo off
REM CozoroHome Production API — :4000

cd /d "%~dp0api"
set PORT=4000
set GOOGLE_REDIRECT_URI=http://localhost:4000/integrations/google/oauth/callback
npx tsx watch src/index.ts
