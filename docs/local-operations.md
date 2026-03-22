# Local Operations

This runbook is for anyone working locally on the Windows machine that already has the project checked out.

## Project Paths

- repo root: `C:\Users\User\Desktop\cozorohome webapp`
- portal: `C:\Users\User\Desktop\cozorohome webapp\portal`
- API: `C:\Users\User\Desktop\cozorohome webapp\api`
- tools: `C:\Users\User\Desktop\cozorohome webapp\tools`

## Services

- portal dev server: `http://localhost:3000`
- API dev server: `http://127.0.0.1:4000`

The portal proxies API calls through `/api-proxy`.

## One-Click Start

Best option:

- `C:\Users\User\Desktop\Restart Cozoro App.cmd`

This starts:

1. API
2. portal
3. Cloudflare tunnel

## Other Shortcuts

- portal only: `C:\Users\User\Desktop\Restart Cozoro Portal.cmd`
- portal script: `portal/refresh-portal.cmd`
- API script: `api/refresh-api.cmd`
- tunnel script: `tools/refresh-tunnel.cmd`

## What Each Script Does

### `portal/refresh-portal.cmd`

- kills anything listening on port `3000`
- removes `portal/.next`
- removes `portal/tsconfig.tsbuildinfo`
- starts `npm run dev`

### `api/refresh-api.cmd`

- kills anything listening on port `4000`
- starts `npm run dev`

### `tools/refresh-tunnel.cmd`

- kills `cloudflared.exe`
- if `%USERPROFILE%\.cloudflared\config.yml` exists, runs named tunnel `cozorohome-portal`
- otherwise starts a quick tunnel to `http://localhost:3000`

## Common Errors

### `connect ECONNREFUSED 127.0.0.1:4000`

Meaning:

- portal is up
- API is down

Fix:

- run `C:\Users\User\Desktop\Restart Cozoro App.cmd`
- or run `api/refresh-api.cmd`

### `'refresh-portal.cmd' is not recognized`

Meaning:

- command was run from the wrong folder

Fix:

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\portal"
npm run dev:refresh
```

or run the full path:

```powershell
cmd /c "C:\Users\User\Desktop\cozorohome webapp\portal\refresh-portal.cmd"
```

### Public site works differently from local

Local usually means code is fine but deployment or env is not.

Check:

- deployment rebuilt from latest `main`
- portal env points to real production API
- Google Cloud origins match the public hostname

## Login Notes

### Manual login

Current expected behavior:

- email/password form shows only when logged out
- after a successful login on the same browser, the form is hidden
- after logout, the form should appear again

Main files:

- `portal/components/client-login-client.tsx`
- `api/src/index.ts`

### Google login

Still needs follow-up. If it breaks in public or local:

- verify `GOOGLE_CLIENT_ID`
- verify exact frontend origin in Google Cloud
- verify the OAuth client is a `Web application`

## Manager Workspace Notes

Main route:

- `/manager`

Main file:

- `portal/components/manager-client.tsx`

Expected structure:

- short login page with manager links only
- full management tools in the manager page
- compact statistics panels with internal scroll, not huge full-page dumps

## Recommended Verification

After UI changes:

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\portal"
.\node_modules\.bin\tsc -p tsconfig.json --noEmit
```

After API changes:

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\api"
.\node_modules\.bin\tsc -p tsconfig.json
```

## Git Reminder

Local behavior can change without a commit. Public behavior cannot.

If localhost works but the public site does not:

1. push to `main`
2. wait for deployment
3. verify production env
