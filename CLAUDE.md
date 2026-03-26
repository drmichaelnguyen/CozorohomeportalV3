# CozoroHome Webapp — Agent Guide

## Project Overview

CozoroHome is a resident management portal for co-living housing (branches D2 and D7). It has two main parts:

- **portal/** — Next.js 16 frontend (TypeScript, Tailwind CSS)
- **api/** — Node.js/Express backend (TypeScript, Prisma ORM, SQLite)

---

## Running Locally

### Sandbox (isolated dev — ports 3002 / 4002)
```bash
bash start-sandbox.sh
# or on Windows:
start-sandbox.cmd
```
- Portal: http://localhost:3002
- API: http://localhost:4002

### Production dev (ports 3001 / 4001)
Run the standard Next.js dev and API dev commands in each directory.

### After pulling or changing Prisma schema
```bash
cd api && npx prisma generate
```

### WSL / Linux note
If `esbuild` fails with a platform mismatch (win32-x64 vs linux-x64), run:
```bash
cd api && npm install
```

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
