# Handoff

This file is for the next agent or future chat to resume quickly without re-discovering the current behavior.

## Working Summary

Cozorohome Portal V3 is a portal + management app with a Next.js frontend and an Express/Prisma backend. Local development is done on Windows, and there are helper `.cmd` scripts to restart the portal, API, and Cloudflare tunnel.

## Current Important State

- version `3.5.11` adds inline `?` help buttons for key resident and manager functions
- user dashboard and manager workspace now include policy-aligned help popovers for rent, support, laundry, feature lock, contract status, and client actions
- branch policy is now: `main` for both active development and production; do not use `sandboxing`
- release and production refresh should use `manage-apps.bat` only
- future agents should not deploy from a dirty local workspace; production should be refreshed from a clean `main` source
- if a release adds a newly imported file, confirm it is tracked in git before pushing or refreshing production
- production app-manager meanings are now:
  - option `15` = deploy local workspace to production
  - option `19` = reset production to `origin/main`
  - option `20` = restore production from backup
- production restart/start should bring up portal, API, backup worker, bot chat, and the hostel guest-booking site together
- hostel public hostname is now `https://hostel.cozorohome.com`
- version `3.5.10` includes rent receipt flow fixes, member-tier rule clarification, and payment sheet branch normalization
- Monthly Rent `Create Receipt` now writes directly to the payment sheet, then marks that month paid automatically
- BIÊN NHẬN `Chi nhánh Dorm` now writes numeric branch values only: `2` or `7`
- Cozoro Member ranking now uses lifetime accumulated coins, previous-month earned coins, and one-time re-upgrade fees after losing rank
- account overview and coins pages now show a `?` explainer for how member tier is calculated
- local manual email/password login works
- public manual login depends on deployment rebuild and correct production API env
- Google login is still unreliable and should be treated as a separate follow-up
- the login page is intentionally shorter now
- the long admin content was moved into the dedicated manager workspace
- manager statistics panels were compacted to avoid very long pages

## Current Access Model

- `app_admin`
- `owner`
- `manager`
- `user`

Rules currently expected:

- app admin can reset passwords for owners, managers, and users
- owner can reset passwords for managers and users
- manager cannot reset passwords
- manager cannot view sensitive identity or birthday-style fields

## Files To Read First

- `README.md`
- `docs/local-operations.md`
- `portal/components/client-login-client.tsx`
- `portal/components/manager-client.tsx`
- `portal/components/portal-session.tsx`
- `portal/app/manager/page.tsx`
- `api/src/index.ts`
- `api/src/staff-access.ts`
- `api/src/google-sheets.ts`

## Local Startup

Best one-click option:

- `C:\Users\User\Desktop\Restart Cozoro App.cmd`

That script starts:

- API on `4000`
- portal on `3000`
- Cloudflare tunnel

Other helpers:

- `C:\Users\User\Desktop\Restart Cozoro Portal.cmd`
- `portal/refresh-portal.cmd`
- `api/refresh-api.cmd`
- `tools/refresh-tunnel.cmd`

## Common Local Problems

### Portal looks stale

Usually this is old `.next` output or a half-restarted dev server.

Use:

- `Restart Cozoro App.cmd`

### Portal works but login page shows proxy errors

If you see `ECONNREFUSED 127.0.0.1:4000`, the API is not running.

### Public site fails while localhost works

Most likely:

- portal deployment has not rebuilt from latest `main`
- production portal env is missing `API_SERVER_ORIGIN` or absolute `NEXT_PUBLIC_API_BASE_URL`
- Google origin config is wrong if the problem is Google-only

### Intermittent 502s on Public Site / Login
If the public API drops intermittently (showing `502 Bad Gateway` on preflights) or mobile login fails seemingly at random, **check if `cloudflared` is running on a backup computer or another terminal.** Cloudflare tunnels load-balance traffic, and if a backup machine isn't actively running the API on port 4000, half of all requests will fail. Turn off `cloudflared` on the backup computer to resolve this.

## Current Login Intent

- logged-out users should see manual email/password form
- logged-in users on the same browser should not see that form
- Google sign-in can remain visible, but do not depend on it for core access until production config is cleaned up

## Current Manager UI Intent

- login page only links to manager workspace
- `/manager` is the main management surface
- `Owners & employees` and `Cleaning schedule assigning` should be visible there
- laundry and other statistics entries should stay in compact scroll panels

## Deployment Reminder

Portal production proxy behavior is controlled in:

- `portal/next.config.ts`

Release / production guideline:

- commit feature work on `main`, or merge a short-lived feature branch into `main`
- refresh production from `main`
- use `manage-apps.bat` for backup, recreate, restart, and rollback
- `manage-apps.bat` creates a backup automatically before local-to-production deploys and before resets to `origin/main`
- do not rely on legacy deploy scripts for the normal flow
- after a clean production sync, restore runtime files that are not part of the normal tracked code release:
  - `api/.env`
  - `api/.google-oauth.json`
  - important `api/data/*` files
- if Google integrations fail after deploy with `Google OAuth tokens are missing`, check `api/.google-oauth.json` first

If production login fails, verify:

- deploy picked up latest commit
- `API_SERVER_ORIGIN` points to real production API
- or `NEXT_PUBLIC_API_BASE_URL` is an absolute public API URL

## Suggested Next Work

- fix production manual login env if still broken after deploy
- fix Google login origins and client separation
- continue Vietnamese cleanup where mojibake remains
- tighten manager UX further if the workspace still feels heavy

## Suggested Resume Prompt

```text
Read README.md, HANDOFF.md, and docs/local-operations.md. Then inspect the current login flow, manager workspace, and production portal env assumptions before making changes.
```
