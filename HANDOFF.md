# Handoff

This file is for the next agent or future chat to resume quickly without re-discovering the current behavior.

## Working Summary

Cozorohome Portal V3 is a portal + management app with a Next.js frontend and an Express/Prisma backend. Local development is done on Windows, and there are helper `.cmd` scripts to restart the portal, API, and Cloudflare tunnel.

## Current Important State

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
