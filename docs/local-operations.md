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

## `manage-apps.bat`

Use `manage-apps.bat` for normal Windows release and production operations.

Important production actions:

- `15. Deploy local workspace to production and restart`
  Use this when the current local workspace is the version you want to publish to production.
- `19. Reset production to origin/main and restart`
  Use this when production should exactly match the tracked `origin/main` branch.
- `20. Restore production from backup`
  Use this to roll production back to a previous backup snapshot.

Current production behavior:

- the script creates a backup automatically before option `15` and option `19`
- production start/restart prepares dependencies, regenerates Prisma, applies migrations, builds portal/API, and then starts the stack
- production stack startup includes the portal, API, backup worker, bot chat, and hostel guest-booking service on `:4115`
- the tunnel is still restarted separately

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
- hostel guest booking public hostname is `https://hostel.cozorohome.com`

### Intermittent 502s on Public API
If the Cloudflare tunnel (`app.cozorohome.com` or `api.cozorohome.com`) randomly returns `502 Bad Gateway`, check if `cloudflared` is running on a backup computer or another terminal using the same tunnel token. Cloudflare automatically load-balances traffic across all connected instances of the same tunnel. If the backup machine isn't running the API server on port 4000, half of the requests will fail with 502. Ensure the tunnel is only active on the primary instance.

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
