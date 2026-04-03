# CozoroHome Webapp — Agent Guide

## Project Overview

CozoroHome is a resident management portal for co-living housing (branches D2 and D7). It has two main parts:

- **portal/** — Next.js 16 frontend (TypeScript, Tailwind CSS)
- **api/** — Node.js/Express backend (TypeScript, Prisma ORM, MariaDB)

---

## Environments

| Environment | Portal | API | Folder | Branch |
|-------------|--------|-----|--------|--------|
| **Production (public)** | :3000 | :4000 | `cozorohome-prod` (git worktree) | `main` |
| **Sandbox (dev)** | :3002 | :4002 | `cozorohome webapp` | `sandboxing` |

### Start production (public app)
```cmd
cd C:\Users\User\Desktop\cozorohome-prod
start-prod.cmd
```
Starts API (:4000), portal (:3000), and Cloudflare tunnel in separate windows.

- Public URL: https://app.cozorohome.com
- API URL: https://api.cozorohome.com

### Start sandbox (dev)
```bash
bash start-sandbox.sh
# or on Windows:
start-sandbox.cmd
```
- Portal: http://localhost:3002
- API: http://localhost:4002

### Git worktree setup
Production runs as a git worktree of the same repo:
```bash
# Already created — do not run again:
git worktree add ../cozorohome-prod main
```
To ship dev changes to production:
```bash
git checkout main
git merge sandboxing
git checkout sandboxing
# then restart start-prod.cmd
```

### Cloudflare tunnel
Named tunnel `cozorohome-portal` (ID: `ace69517-369e-44a3-9f00-3304bf2153df`)
- Config: `C:\Users\User\.cloudflared\config.yml`
- Routes `app.cozorohome.com` → `localhost:3000` and `api.cozorohome.com` → `localhost:4000`
- `cloudflared.exe` lives in `tools/` (not in git — copy from `cozorohome-public/tools/` if missing)

### After pulling or changing Prisma schema
```bash
cd api && npx prisma generate
```

### WSL / Linux note
If `esbuild` fails with a platform mismatch (win32-x64 vs linux-x64), run:
```bash
cd api && npm install
```

### Login broken via public URL (Cloudflare tunnel)
**Symptom:** Login page loads at `https://app.cozorohome.com` but submitting does nothing — form appears interactive but clicks/submits have no effect.

**Cause:** Next.js 16+ dev mode blocks HMR SSE connections (`/_next/webpack-hmr`) from non-localhost origins by default. When the browser can't establish the HMR connection, the `AppDevOverlayErrorBoundary` silently prevents React from fully hydrating, so event handlers (including the login form's `onSubmit`) are never attached.

**Fix:** Ensure `portal/next.config.ts` includes:
```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["app.cozorohome.com"],
  ...
};
```

**Prevention:** After any Next.js upgrade, verify `allowedDevOrigins` is still present in `next.config.ts`. If it gets lost (e.g. during a config rewrite), re-add it. This must be in both the `sandboxing` and `main`/`cozorohome-prod` worktree configs.

---

## Architecture

### Portal (`portal/`)

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages |
| `components/` | All React client components |
| `lib/` | Shared utilities (e.g. `api-base-url.ts`) |

**Key components:**

| Component | Description |
|-----------|-------------|
| `mobile-nav.tsx` | Bottom nav bar (user, manager, mechanic roles). Shows per-button notification badges fetched from `/support/notifications`. |
| `site-shell.tsx` | Root layout wrapper — header, nav, providers |
| `portal-session.tsx` | Session context (`sessionEmail`, `sessionRole`, `isLoggedIn`) |
| `portal-language.tsx` | i18n context with `t()` helper (Vietnamese/English) |
| `cleaning-schedule-client.tsx` | Full cleaning calendar with self-assign, availability, task management |
| `manager-support-inbox.tsx` | iMessage-style support chat for managers |
| `support-client.tsx` | Resident support chat (tabs: personal, room, floor, branch) |
| `notification-bell.tsx` | Header bell icon with total unread badge |
| `notification-center-client.tsx` | Full notifications list page |
| `route-error.tsx` | Shared error boundary components (Critical / Standard) |

**Roles:**
- `user` / resident — sees resident nav and pages
- `manager`, `owner`, `app_admin` — manager workspace at `/manager?view=...`
- `mechanic` — mechanic workspace at `/mechanic`

**Nav badge logic (mobile-nav.tsx):**
- Fetches `/support/notifications?email=` (resident) or `/manager/support/notifications?operatorEmail=` (staff)
- Caches in `localStorage` with 5-minute TTL
- Schedule button: laundry reminder count (top-right), cleaning reminder count (top-left)
- Message button: support reply unread count (top-left)
- Account button: payment due + new fine count (top-right)
- Manager message button: support request unread count (top-left)

### API (`api/`)

| Path | Purpose |
|------|---------|
| `src/index.ts` | Express app entry, all route registrations |
| `src/cleaning.ts` | Cleaning schedule logic (self-assign, availability, tasks) |
| `src/google-sheets.ts` | Google Sheets integration |
| `prisma/schema.prisma` | Database schema |

**Key API endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /cleaning/me?email=` | Load resident's cleaning overview (tasks, availability, occupied slots) |
| `POST /cleaning/self-assign/check` | Validate self-assignment before submitting |
| `POST /cleaning/self-assign` | Submit self-assignment |
| `POST /cleaning/tasks/:id/complete` | Mark task done |
| `POST /cleaning/tasks/:id/release` | Release task (with penalty calculation) |
| `GET /support/notifications?email=` | Resident notifications by type (SUPPORT_REPLY, PAYMENT_DUE, NEW_FINE, LAUNDRY_REMINDER, CLEANING_REMINDER) |
| `GET /manager/support/conversations?operatorEmail=` | Manager inbox list |
| `GET /manager/support/conversations/:id?operatorEmail=` | Conversation thread |
| `POST /manager/support/messages` | Send reply as manager |
| `POST /manager/support/conversations/:id/read` | Mark conversation read |
| `GET /clients/laundry-bookings?email=` | Resident laundry bookings |

---

## Cleaning Schedule Business Rules

- **Self-assign**: residents can claim open slots for today or future dates
- **Take Over**: if today is after 20:00 and an assigned resident hasn't completed the task, others can take over
- **Task types**: `KITCHEN_D2`, `KITCHEN_D7`, `TRASH_D7`
- **Completion window**: `KITCHEN_D7` = 17:00–23:00 on assigned date; others = any time that day
- **Release penalties**: 5+ days ahead = no fine; 1–4 days = 50%; same day = 75%; past = no release
- **Calendar colors**: green = open slot, blue = taken by another resident, amber dot = your task

---

## Version History

| Version | Description |
|---------|-------------|
| 3.5.4 | Manager delete for coins/fines/payments/laundry entries; laundry stats table redesigned (name, start, end, machine — 1 row per entry); fix laundry overlap from old-system events with wrong end times (always use machine duration); open slots limited to current month; fine creator field shown to residents and managers; About section collapses by default |
| 3.5.3 | Hide air fryer section entirely for D2 users; hide microwave section entirely for D7 users (no "branch only" message — section simply absent); About section on account page (app history, Dr. Trong Nguyen, Facebook link) |
| 3.5.2 | D2 microwave controller: IFTTT trigger, pre-use inspection (Clean/Dirty/Damage), 5-min cooldown window, current/last user display, usage logged to Google Sheet (Name/Time/Email/Inspection columns) |
| 3.5.1 | Hide Contract Status card for inactive clients; fix session flash (users seeing login screen on page return) by deferring login-required UI until localStorage is read |
| 3.5.0 | Short-term portal merged into client list (Long term / Short term tabs); bed pricing diagram UI with T/M/B tiers (150k/250k defaults); manager permissions modal sticky footer fix; inactive tab compile fix; short-term booking confirmation (imports standalone booking app guest into main portal with auto account creation); contract termination + checkout form; manager can book services (bed 0); manager permissions data model (per-branch + per-category read/write, owner-configurable) |
| 3.3.4 | Manager password reset, relaxed contract expiration access, optimized extension flow |
| 3.3.0 | Auto-scheduling (15-day horizon, 60-day fairness), monthly release limit (3/month), evasion penalty (100k VND), staff names on receipts, payment sheet fix |
| 3.2.2 | Nav badges (laundry/cleaning/message/account), cleaning self-assign fix for today + 8pm takeover, manager iMessage UI |
| 3.1.1 | iMessage-style messaging, cleaning bonus |
| 3.0.2 | Manager tabs, updated badge |
| 3.0.0 | Full feature launch |

---

## Error Boundaries

Every route in `portal/app/**/error.tsx` uses either:
- `CriticalRouteError` — for critical services (bookings, controller, laundry) — auto-retries after 8s
- `StandardRouteError` — for standard pages — manual retry only

`portal/app/global-error.tsx` is the last-resort fallback (renders its own `<html>`).

---

## Commit / Branch Convention

- Active dev branch: `sandboxing`
- Main branch: `main`
- Commit messages follow: `type: description` (e.g. `feat:`, `fix:`, `chore:`)
