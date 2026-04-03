@echo off
REM CozoroHome Local API — :4002

cd /d "%~dp0api"
set PORT=4002
set GOOGLE_REDIRECT_URI=http://localhost:4002/integrations/google/oauth/callback
npx tsx watch src/index.ts
