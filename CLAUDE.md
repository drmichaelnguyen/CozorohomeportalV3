# CozoroHome Webapp â€” Agent Guide

## Project Overview

CozoroHome is a resident management portal for co-living housing (branches D2 and D7). It has two main parts:

- **portal/** â€” Next.js 16 frontend (TypeScript, Tailwind CSS)
- **api/** â€” Node.js/Express backend (TypeScript, Prisma ORM, MariaDB)

---

## Environments

| Environment | Portal | API | Folder | Branch |
|-------------|--------|-----|--------|--------|
| **Dev (this machine)** | :3000 | :4000 | `cozorohome webapp` | `sandboxing` |
| **Production (public)** | :3000 | :4000 | `cozorohome-prod` (git worktree) | `main` |

### Start production (public app)
```cmd
cd C:\Users\User\Desktop\cozorohome-prod
start-prod.cmd
```
Starts API (:4000), portal (:3000), and Cloudflare tunnel in separate windows.

- Public URL: https://app.cozorohome.com
- API URL: https://api.cozorohome.com

**Mac public host:** use `corepack pnpm host:*` from the repo root on `main`, or double‑click **`manage-server.command`** (menu: status, backup/restore, pull‑deploy, kill ports **3000/4000**). Finder permission / `xattr` / one‑liner details: **`docs/mac-hosting.md`** § *manage-server.command*.

### Start dev
```bash
bash start-sandbox.sh
# or on Windows:
start-sandbox.cmd
```
- Portal: http://localhost:3000
- API: http://localhost:4000

### Git worktree setup
Production runs as a git worktree of the same repo:
```bash
# Already created â€” do not run again:
git worktree add ../cozorohome-prod main
```
Current branch policy:

- `sandboxing` = active development branch
- `main` = release / production branch
- production app must follow `main`, not `sandboxing`

Release rule for future agents:

1. make and verify changes on `sandboxing`
2. commit on `sandboxing`
3. when the release is approved, promote `sandboxing` to `main`
4. if `main` and `sandboxing` are cleanly mergeable, merge `sandboxing` into `main`
5. if histories have diverged badly and the user explicitly approves `sandboxing` as the new baseline, reset `main` to the `sandboxing` commit instead of doing a risky manual conflict merge
6. push the updated `main`
7. refresh production from `main` only

Important release safety rules:

- do not deploy directly from a dirty local workspace
- do not use old deploy scripts; use `manage-apps.bat` only
- before releasing, make sure every newly imported runtime file is tracked in git
- if the app imports a file that is still untracked, production can boot with `MODULE_NOT_FOUND` even when local dev appears fine
- if production needs local secrets or env values, sync production env deliberately after code sync
- for this app, a production refresh is not complete unless these runtime files are preserved or restored:
  - `api/.env`
  - `api/.google-oauth.json`
  - important `api/data/*` files such as caches, staff access, and other operational state
- if `api/.google-oauth.json` is missing in production, Google Sheets / Gmail / Calendar startup calls can fail with `Google OAuth tokens are missing`

Production sync rule:

- prefer a clean `main` worktree or clean `main` checkout as the source for production sync
- do not copy `sandboxing` directly to production unless the user explicitly asks for a non-standard emergency deploy

Operational note:

- `manage-apps.bat` is now the canonical app manager for backup, production refresh, rollback, and restart
- outdated deploy commands should be treated as legacy and not used for normal release flow

### Cloudflare tunnel
Named tunnel `cozorohome-portal` (ID: `ace69517-369e-44a3-9f00-3304bf2153df`)
- Config: `C:\Users\User\.cloudflared\config.yml`
- Routes `app.cozorohome.com` â†’ `localhost:3000` and `api.cozorohome.com` â†’ `localhost:4000`
- `cloudflared.exe` lives in `tools/` (not in git â€” copy from `cozorohome-public/tools/` if missing)

### After pulling or changing Prisma schema
```bash
cd api && npx prisma generate
```
- **`Unexpected token … JSON` when running Prisma:** often a **UTF-8 BOM** on `api/package.json` (common with OneDrive / some Windows editors). Run `node scripts/verify-package-json.mjs` from the repo root — it parses all workspace `package.json` files and **removes a BOM on disk** if present. `pnpm --filter cozorohome-api prisma:generate` runs this automatically before `prisma generate`.
- **Windows `EPERM` renaming `query_engine-windows.dll.node`:** another process (usually a running **API** or `tsx watch`) has the Prisma engine file locked. Stop dev/production API on that machine, then rerun `prisma generate` or `pnpm --filter cozorohome-api build`.

### WSL / Linux note
If `esbuild` fails with a platform mismatch (win32-x64 vs linux-x64), run:
```bash
cd api && npm install
```

### Login broken via public URL (Cloudflare tunnel)
**Symptom:** Login page loads at `https://app.cozorohome.com` but submitting does nothing â€” form appears interactive but clicks/submits have no effect.

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
| `site-shell.tsx` | Root layout wrapper â€” header, nav, providers |
| `portal-session.tsx` | Session context (`sessionEmail`, `sessionRole`, `isLoggedIn`) |
| `portal-language.tsx` | i18n context with `t()` helper (Vietnamese/English) |
| `cleaning-schedule-client.tsx` | Full cleaning calendar with self-assign, availability, task management |
| `manager-support-inbox.tsx` | iMessage-style support chat for managers |
| `support-client.tsx` | Resident support chat (tabs: personal, room, floor, branch) |
| `notification-bell.tsx` | Header bell icon with total unread badge |
| `notification-center-client.tsx` | Full notifications list page |
| `contract-extension.tsx` | Near contract end: resident extends with preset months or a **chosen end date**, e-sign; creates a pending approval (no contract email until an owner approves). |
| `route-error.tsx` | Shared error boundary components (Critical / Standard) |

**Roles:**
- `user` / resident â€” sees resident nav and pages
- `manager`, `owner`, `app_admin` â€” manager workspace at `/manager?view=...`
- `mechanic` â€” mechanic workspace at `/mechanic`

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
| `GET /staff/clients/duplicates?actorEmail=` | List clients with multiple active rows in the sheet |
| `POST /staff/clients/set-inactive` | Set a specific contract row (by maHd) to Hiá»‡n cÃ²n á»Ÿ = âˆ’1 |
| `POST /clients/contracts/extend` | Resident contract extension: body includes `email` and `newContractEndDate` (`dd/mm/yyyy`) or legacy `extensionMonths`; writes a **pending** entry to contract-approvals JSON (duplicate guard for pending extension per email). |
| `GET /manager/contract-approvals?actorEmail=` | **Owner, app_admin, manager** â€” list **pending** and **rejected** registration/extension approvals (approved excluded). |
| `POST /manager/contract-approvals/:id/approve` | **Owner, app_admin** â€” run sheet/bridge workflow; marks approved. |
| `POST /manager/contract-approvals/:id/reject` | **Owner, app_admin** â€” marks rejected (stays in queue for visibility). |
| `POST /manager/rent-paid-status` | Staff rent status toggle now also supports owner/app_admin partial monthly component tracking (`componentUnpaid`) for rent/parking/gate/laundry/fines. |
| `POST /manager/payments/create-manual` | **Manager, owner, app_admin** â€” create payment receipt for a person not in current client DB; branch/receiver can be prefilled by UI branch tools. |
| `POST /manager/branch-broadcast` | **Manager, owner, app_admin** â€” push a branch-wide message to all active clients in D2/D7 and queue first-open prompt notices. |
| `GET /clients/branch-broadcasts/pending?email=` | Resident fetches unread branch prompts queued after branch broadcasts. |
| `POST /clients/branch-broadcasts/:id/read` | Resident acknowledges a branch prompt so it no longer appears on next app open. |

### Rent coin behavior (source of truth)

- `applyCoinsTowardRent` is only a resident preference toggle. It does not deduct coins by itself.
- Coins are deducted only when resident confirms `POST /rent-paid-status/redeem-coins-for-bill`.
- Successful redemption writes a locked snapshot on `MonthlyRentStatus`: `rentCoinRedeemCoins`, `rentCoinRedeemValueVnd`, `rentCoinRedeemAt`.
- `POST /pay-rent` must use only that locked redemption snapshot for receipt coin lines and coin credit math.
- If no locked redemption snapshot exists, rent receipts must use `0` coins and `0` coin value.

### Partial unpaid behavior (owner/app_admin)

- The monthly paid toggle still controls whole-month paid/unpaid as before.
- Owner/app_admin can mark specific monthly components unpaid: `rentSubtotal`, `parking`, `gateParking`, `laundry`, `fines`.
- Bed/table unpaid markers should stay visible when either:
  - whole month is unpaid, or
  - whole month is paid but one or more components remain unpaid.
- This is especially important for prepaid residents whose rent package is paid but monthly add-ons (for example parking) are still due.

**Contract approvals queue:** Shown at the top of the manager **Client list** workspace when `manager-client.tsx` loads items from `GET /manager/contract-approvals`. Managers see extension details and registration summary but cannot approve/reject. Rejected rows remain in the list so any owner can see history; residents must submit a new request after rejection if they still want to extend.

---

## Google Sheet â€” Client Row Schema

The main client sheet (`sheetName` in `google-sheets.ts`) has one row per contract registration. Key columns:

| Column | Notes |
|--------|-------|
| `Dáº¤U THá»œI GIAN` | Form submission timestamp â€” format `dd/mm/yyyy hh:mm:ss`. **This is the tiebreaker** when a client has multiple active rows: the row with the latest `Dáº¤U THá»œI GIAN` is treated as the current contract by `getActiveClientByEmail`. |
| `Äá»‹a chá»‰ email` | Resident email (primary lookup key) |
| `Hiá»‡n cÃ²n á»Ÿ` | Active status: `1` = currently staying, `0` = moved out, `-1` = left/removed/inactive, blank = new registration not yet confirmed |
| `MÃƒ HD` | Contract code â€” unique identifier for a row (used by `updateClientColumns`) |
| `NgÃ y báº¯t Ä‘áº§u há»£p Ä‘á»“ng` | Contract start date (`dd/mm/yyyy`) |
| `NgÃ y háº¿t háº¡n há»£p Ä‘á»“ng` | Contract end date (`dd/mm/yyyy`) |
| `Thá»i háº¡n há»£p Ä‘á»“ng (thÃ¡ng)` | Contract duration in months |
| `sá»‘ giÆ°á»ng` | Bed number |
| `Chi nhÃ¡nh Cozoro dorm` | Branch â€” `2` or `7` (normalized to `D2`/`D7`) |
| `PhÃ­ gá»Ÿi xe` | Parking fee (VND) |
| `Biá»ƒn sá»‘ xe mÃ¡y Ä‘Äƒng kÃ½ gá»Ÿi xe` | Motorbike licence plate |
| `áº¢nh Ä‘Ã­nh kÃ¨m CMND hoáº·c cÄƒn cÆ°á»›c cÃ´ng dÃ¢n` | ID scan URL |

**Duplicate row rule:** A client extending their contract gets a new row appended; the old row should be set to `Hiá»‡n cÃ²n á»Ÿ = -1`. If both rows remain active (non -1), the app uses the one with the latest `Dáº¤U THá»œI GIAN`. Managers can detect and resolve duplicates from the bed diagram (amber highlight) â†’ client detail panel â†’ "Mark Inactive (âˆ’1)" button.

---

## Cleaning Schedule Business Rules

- **Self-assign**: residents can claim open slots for today or future dates
- **Take Over**: if today is after 20:00 and an assigned resident hasn't completed the task, others can take over
- **Task types**: `KITCHEN_D2`, `KITCHEN_D7`, `TRASH_D7`
- **Completion window**: `KITCHEN_D7` = 17:00â€“23:00 on assigned date; others = any time that day
- **Release penalties**: 5+ days ahead = no fine; 1â€“4 days = 50%; same day = 75%; past = no release
- **Calendar colors**: green = open slot, blue = taken by another resident, amber dot = your task

---

## Version History

| Version | Description |
|---------|-------------|
| 3.8.47 | Deposit refund email: bilingual notice now lists deposit, unpaid fines (per line), unpaid gate tickets (per ticket), other deductions when refund is below auto-suggested, and final refund amount. |
| 3.8.45 | Prepaid rent marker: treat package as paid when contract end or sheet `Đã đóng phí tháng` applies, not only package expiry (fixes false “payment due” when expiry date is stale). Payment receipts: fix empty `Số giường` when writing from manager portal (header casing `Số giường` vs `số giường`). |
| 3.8.44 | Manager bed diagram / client list: hide red unpaid-rent ($) marker for residents on an active 3/6-month prepaid package (rent covered by package); still show $ when the package expired or add-on components (parking, gate, laundry, fines) are marked unpaid. |
| 3.8.42 | Billing and manager controls hardening: parking fee in rent calculations is now profile-driven (no fallback 200k from plate), manager rent status now supports owner/app_admin component-level unpaid tracking (rent/parking/gate/laundry/fines) so prepaid residents can still show unpaid add-ons, rent receipt coin credit only follows committed redemption records, deposit-refund contract lookup is more resilient for legacy contracts (termination/payment cache fallback), and manager coin summary current balance now falls back to history-derived net when profile balance is stale. |
| 3.8.39 | Payment reminder flows expanded: resident Notification Center now renders total due + expandable details inside each `PAYMENT_DUE` card, manager tools menu mobile clipping fixed, and contract termination safety tightened (removed quick terminate from tools menu + added final double-confirm). Rent paid/unpaid app truth now syncs back to Google Sheet column `Đã đóng phí tháng` (`TRUE`/`FALSE`) for the current month. |
| 3.8.38 | Payment reminders now show **total unpaid due** with an expandable **Details** breakdown in Notification Center, aligned with the blocking rent popup summary. Removed standalone termination checkout banner outside tools, and added `🧰 Tools` to the bed-diagram quick actions popup so managers can open the same client tools menu directly from diagram cards. |
| 3.8.37 | Client tab **Branch Tools** (D2/D7): manual receipt creation for non-database clients (`/manager/payments/create-manual`) with branch/receiver prefill, plus branch-wide notifications (`/manager/branch-broadcast`). Added resident first-open popup queue for branch notices (`/clients/branch-broadcasts/pending`, `/:id/read`) backed by `data/branch-broadcasts.json`. |
| 3.8.36 | Resident contract extension: optional **custom end date** (max 36 months from new term start) plus presets; API `newContractEndDate` + `extendClientContract` term union; tiered extension coins. **Contract approvals queue**: owners, app admins, and **managers** can view pending/rejected registrations and extensions (snapshot for extensions); only owners/app admins approve or reject; rejected items stay visible. |
| 3.8.33 | Owner-only Client -> Analytics payment dashboard: native bar/donut revenue charts, configurable grouping order (all payments, receiver, branch, category, bed, year, month), click/tap drilldown through each grouping level, and final payment receipt entry table |
| 3.8.29 | Cleaning swap requests: residents can offer coins (up to task reward) to another available resident to take over their cleaning slot; resident-to-resident coin transfer via Google Sheets on accept; `CleaningSwapRequest` DB table + migration; 6 new API routes (`swap-candidates`, `swap-requests` CRUD); inline swap flow UI in task card with candidate list and coin offer input; Swap Requests inbox section (received + sent, accept/decline/cancel); bilingual EN/VI `?` help panels for removal rules (with swap tip), auto-scheduling (4-step fairness algorithm), and swap flow |
| 3.7.2 | Manager deposit refund email (preview, editable amount, bilingual VI/EN, 5–10 business days); checkout step 5 deposit timing copy; API routes for deposit refund |
| 3.7.1 | Multi-month prepaid: full package calculator breakdown (register-style recurring lines, no deposit; laundry / gate / fines explicit); readable UI on manager package card and resident next payment |
| 3.7.0 | Named motorbike parking tiers per branch (`ParkingPricingTier`), manager Settings + registration multi-choice; portable dev start without `migrate deploy`; rebuild-restart / start-sandbox helpers |
| 3.6.10 | Multi-month prepaid: manager draft/confirm package total and note, in-app (`PREPAID_PACKAGE`) and email notify; resident next payment shows manager-confirmed amount vs engine estimate; `PrepaidPackageBilling` in Prisma |
| 3.6.9 | Resident personal support: optional Cozoro Assistant (Gemini) replies in the same thread as manager inbox; optional callback fields (phone, Facebook, other) on conversation; `ASSISTANT` message role; manager Messages workspace: open-maintenance count on tab + mobile nav badge, compact scroll area with sticky subtab row; `bot/README` clarifies `chatbot.cozorohome.com` as standalone HTTPS bot vs portal and Facebook as optional |
| 3.6.6 | Darken inactive nav items in dark mode (text-slate-100, hover white, removed black pill background) |
| 3.6.5 | Manager AI chat assistant (Gemini Flash 2.5) inline in Settings â€” add coins, create fine/receipt, query bed availability, navigate to views; chat history persisted in localStorage (20-msg cap); staff messages display as "Cozoro"; group-context polling skipped for staff sessions; IoT device controller grouped by branchâ†’areaâ†’floor, collapsed by default; dark mode toggle in manager Settings; tap sender name in support chat to view client details; auto-scheduler section collapsed by default; D7 cleaning task remove fixed (stale calendar event IDs no longer block DB deletion) |
| 3.6.1 | Duplicate active contract detection and resolution: bed diagram highlights duplicate clients (amber + ! badge); client detail panel shows all active rows sorted by Dáº¤U THá»œI GIAN with "Mark Inactive (âˆ’1)" button per old row; getActiveClientByEmail auto-picks latest Dáº¤U THá»œI GIAN row when duplicates exist; contract extension now generates a unique MÃƒ HD for the new row; support message sender names fixed (staff display name stored, not email); Google Sheet column schema documented in CLAUDE.md |
| 3.6.0 | Unified pricing management: Settings tab replaces Employees tab; long-term bed prices editable via full bed diagram (per-bed, by-room+tier, or by-branch+tier bulk modes); deposit auto-set equal to monthly price; discounts stored in Google Sheets "DISCOUNTS" tab with debounced write queue (30s flush, batched API calls); discount eligibility rules expanded (status, minMonths, referral, bed tier T/M/B, gender, occupation); registration form shows claimable discounts as checkboxes with bilingual EN/VI labels â€” registrant self-attests with proof-required notice; bed availability loads after branch + sex selection |
| 3.5.5 | Pre-login landing page with hero, vision (4 pillars), founder bio, cozorohome.com link; global EN/VI language toggle in header (visible on all pages including pre-login) |
| 3.5.4 | Manager delete for coins/fines/payments/laundry entries; laundry stats table redesigned (name, start, end, machine â€” 1 row per entry); fix laundry overlap from old-system events with wrong end times (always use machine duration); open slots limited to current month; fine creator field shown to residents and managers; About section collapses by default |
| 3.5.3 | Hide air fryer section entirely for D2 users; hide microwave section entirely for D7 users (no "branch only" message â€” section simply absent); About section on account page (app history, Dr. Trong Nguyen, Facebook link) |
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
- `CriticalRouteError` â€” for critical services (bookings, controller, laundry) â€” auto-retries after 8s
- `StandardRouteError` â€” for standard pages â€” manual retry only

`portal/app/global-error.tsx` is the last-resort fallback (renders its own `<html>`).

---

## Commit / Branch Convention

- Active dev branch: `sandboxing`
- Main branch: `main`
- Commit messages follow: `type: description` (e.g. `feat:`, `fix:`, `chore:`)
- Release commits should bump the visible version when user-facing behavior changes
- **Version scheme** (`portal/lib/app-version.ts`, `portal/package.json`, `api/package.json`): use **semver-style `MAJOR.MINOR.PATCH`** (e.g. `3.7.4`, `3.7.11`, `3.7.23`). The PATCH segment **may exceed 9** — `3.7.11` is normal; do not jump to `3.8.0` just because PATCH is “double digits”. Reserve **`3.8.0`** (MINOR bump) for **larger** product releases the team treats as a minor milestone, not for routine fixes/features.
- When asked to "commit and push", first confirm whether the user wants:
  - commit only
  - push branch to GitHub
  - or refresh the local production app
- These are separate operations and should not be assumed to be the same
