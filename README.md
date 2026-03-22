# Cozorohome Portal V3

This repo contains the Cozorohome portal frontend, the API backend, and a few local operator scripts used to run the project on a Windows machine.

## Repo Layout

- `portal/`: Next.js frontend
- `api/`: Express + Prisma backend
- `docs/`: project notes and runbooks
- `tools/`: tunnel utilities and Cloudflare helpers
- `portal/feedback/`: locally stored feedback payloads

## Stack

- Frontend: Next.js + React + TypeScript
- Backend: Express + TypeScript + Prisma
- Database: MySQL
- External integrations: Google Sheets, Google Calendar, Google Identity

## Current Product Areas

- User portal login
- Manual email/password login
- Google login support in progress
- User account overview, laundry, controller, billing, coins, schedules
- Manager workspace
- Owners & employees management
- Cleaning schedule assigning
- Support inbox and feedback review

## Roles

- `app_admin`: highest access
- `owner`: can manage managers and users, but not app admins or other owners
- `manager`: limited management access, sensitive identity fields hidden
- `user`: normal resident/client access

## Local Requirements

- Node.js 20+
- `pnpm`
- Windows PowerShell or Command Prompt
- local env files and Google credentials not stored in Git

## Important Local Files Not In Git

You may need to copy these from the working machine when setting up another computer:

- `portal/.env.local`
- `api/.env`
- `api/.google-oauth.json`
- any local Cloudflare config in `%USERPROFILE%\.cloudflared\`

## Install

```bash
pnpm install
```

If Prisma client is missing:

```bash
pnpm --filter cozorohome-api prisma:generate
```

## Local Development

Expected local services:

- portal: `http://localhost:3000`
- API: `http://127.0.0.1:4000`

Run both from repo root:

```bash
pnpm dev
```

Run only portal:

```bash
pnpm --filter cozorohome-portal dev
```

Run only API:

```bash
pnpm --filter cozorohome-api dev
```

## Fast Restart Shortcuts

These are the current Windows helper scripts:

- desktop app restart: `C:\Users\User\Desktop\Restart Cozoro App.cmd`
- desktop portal-only restart: `C:\Users\User\Desktop\Restart Cozoro Portal.cmd`
- portal refresh script: `portal/refresh-portal.cmd`
- API refresh script: `api/refresh-api.cmd`
- tunnel refresh script: `tools/refresh-tunnel.cmd`

Recommended local recovery flow when UI looks stale:

1. Run `Restart Cozoro App.cmd`
2. Wait for portal, API, and tunnel windows to start
3. Hard refresh the browser with `Ctrl+Shift+R`

## Manual Login

Current intended behavior:

- logged out users see manual email/password login fields
- logged in users do not see those fields on the same browser session
- Google login is still present, but it is not the primary reliable login path right now

Main files:

- `portal/components/client-login-client.tsx`
- `api/src/index.ts`

## Manager Workspace

The full management UI lives on the dedicated manager page:

- route: `/manager`
- implementation: `portal/components/manager-client.tsx`

Important tabs:

- `Overview`
- `Client list`
- `Owners & employees`
- `Support chat`
- `Feedbacks`
- `Cleaning schedule assigning`

The login page should stay short and only link into the manager workspace rather than duplicating long management sections.

## Environment Notes

Frontend:

- `NEXT_PUBLIC_API_BASE_URL`
- `API_SERVER_ORIGIN`

Backend:

- `DATABASE_URL`
- `PORT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- Sheets and Calendar env values

Production note:

If the public site cannot log in while localhost works, check the portal deployment env first. The portal proxy must point at the real production API, not `127.0.0.1`.

## Typecheck

Portal:

```powershell
.\portal\node_modules\.bin\tsc.cmd -p .\portal\tsconfig.json --noEmit
```

API:

```powershell
.\api\node_modules\.bin\tsc.cmd -p .\api\tsconfig.json
```

## Key Docs

- `HANDOFF.md`
- `docs/local-operations.md`
- `docs/branch-room-bed-layout.md`

## Suggested Resume Prompt

```text
This is my Cozorohome Portal V3 project. Please read README.md, HANDOFF.md, and docs/local-operations.md first, then continue from the current state.
```
