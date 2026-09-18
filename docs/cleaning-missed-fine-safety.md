# Cleaning missed-fine safety

## Problem

Missed-cleaning fine tickets could be duplicated under concurrent API requests or retries, and managers could one-click fine every overdue duty (including historical backlog) via the bulk “Issue missed fine” button. Manual overdue sweeps also created fines even when `autoMissedCleaningFines` was disabled.

Separately, manager **Dismiss** on overdue assigned duties called photo-audit rejection, which only allows `DONE_PENDING_AUDIT` / `APPROVED`, so every valid overdue `ASSIGNED` dismiss failed.

## Idempotency design

- Cross-process MySQL advisory locks live in `api/src/db-advisory-lock.ts`.
- Missed cleaning fines use lock key `missed-cleaning-fine:<spreadsheetId>:<taskId>`.
- Monthly evasion fines use `cleaning-evasion-fine:<spreadsheetId>:<email>:<YYYY-MM>`.
- Inside the lock the API:
  1. Re-reads the `CleaningTask` from SQL
  2. Confirms ASSIGNED + not cancelled/exempt
  3. Reads the fines sheet live (`readFinesSheetRows`), not only the file cache
  4. Matches the stable marker `Task ID: <taskId>.`
  5. Appends only when no marker exists
  6. Marks the task `MISSED`
- A crash after Google append but before SQL update recovers on retry: the sheet marker is found (`alreadyExists`) and the task is marked missed without a second append.

## Overdue dismiss (no fine)

- Dedicated path in `api/src/cleaning-overdue-dismiss.ts` (not photo-audit rejection).
- Transitions overdue `ASSIGNED → REJECTED` with note prefix `[Dismissed overdue task]`.
- Creates one `CleaningAudit(REJECT)` + action log; retries return `alreadyDismissed` without duplicate audits.
- Syncs calendar status and invalidates cleaning overview cache; does **not** reverse coins or open normal audit reject to arbitrary assigned tasks.
- Single and bulk dismiss endpoints share this path.

## Catch-up policy

- Config: `missedFineLookbackDays` in `api/data/cleaning-auto-scheduler-config.json` (default **14**, range 1–90).
- Automatic/startup/interval sweeps only create fines inside the lookback window (measured from each task’s missed-fine deadline).
- Older duties are returned as `skippedOld` / shown as review-required in the manager queue; they are not auto-ticketed.
- Manual “Run overdue sweep” is review/refresh only unless the request sets `createMissedFines: true`.

## Diagnostics

Report-only (never mutates):

```bash
cd api
npx tsx scripts/report-duplicate-cleaning-fines.ts
```

Detects duplicate Task ID markers, duplicate evasion email/month groups (fingerprinted), and action-log creations whose task marker is missing from the current sheet.
