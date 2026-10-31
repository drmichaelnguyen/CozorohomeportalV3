# Cozoro AI Manager

An autonomous **manager staff agent** with its own portal login. It watches day-to-day operations and **reports to owners**, instead of only answering when a human types in the Settings AI chat.

## What it is

| Piece | Detail |
|-------|--------|
| **Account** | Real staff row (`manager` role). Default email `ai.manager@cozorohome.com` (override with `AI_MANAGER_EMAIL`). |
| **Login** | Same portal email/password login as any manager. Owners set the password from **Settings → AI Manager**. |
| **Background job** | API `setInterval` (~30 min check) runs a tick when enabled and the configured interval has elapsed. |
| **Report** | LLM digest emailed to owners + stored under `api/data/ai-manager-reports.json` + Notification Center card for owners. |
| **Modes** | `report_only` (default) or `assist` (also prepares **unsent** support reply drafts in the report). |

It reuses the same LLM stack as other portal AI (9router `gpt-5` when configured, else Gemini).

## What it watches

Each tick builds an ops snapshot:

- Support threads whose **latest message is from the resident**
- Pending contract approvals (registration / extension / transfer)
- Cleaning tasks `DONE_PENDING_AUDIT`
- Overdue cleaning still `ASSIGNED` (duty date before today, Vietnam calendar)
- Hostel pending bookings not yet imported / archived
- Open AC comfort alerts

Quiet interval ticks with **nothing outstanding** are skipped (manual **Run report now** always runs).

## Owner setup

1. Log in as **owner** or **app_admin**.
2. Open **Manager → Settings → AI Manager**.
3. Click **Create / refresh account** (optionally set a password ≥ 8 characters).
4. Turn on **Enable scheduled agent**, choose mode and report emails, **Save**.
5. Optionally **Run report now** to get the first digest immediately.

You can also log into the portal as the AI Manager email and use the normal manager workspace (Messages, cleaning, existing Manager AI chat). Scheduled automation still runs on the API process, not in the browser.

## Environment (optional)

```env
# api/.env
AI_MANAGER_ENABLED=1
AI_MANAGER_EMAIL=ai.manager@cozorohome.com
AI_MANAGER_NAME=Cozoro AI Manager
AI_MANAGER_PASSWORD=choose-a-strong-password
AI_MANAGER_REPORT_EMAILS=dr.trongto@gmail.com
AI_MANAGER_INTERVAL_HOURS=6
AI_MANAGER_MODE=report_only
```

UI settings in `api/data/ai-manager-config.json` override / complement these after first save. Preserve that file (and `ai-manager-reports.json`) across production refreshes like other `api/data/*` operational state.

## API

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/manager/ai-manager?actorEmail=` | staff (status + recent report previews) |
| `PUT` | `/manager/ai-manager` | owner / app_admin (settings + optional password) |
| `POST` | `/manager/ai-manager/ensure-account` | owner / app_admin |
| `POST` | `/manager/ai-manager/run` | owner / app_admin (force tick) |
| `GET` | `/manager/ai-manager/reports` | staff |
| `GET` | `/manager/ai-manager/reports/:id` | staff |
| `GET` | `/manager/ai-manager/action-logs` | staff |

## Action logs

Every meaningful AI Manager event is written to the shared Prisma **`ActionLog`** table (same audit store as other manager ops):

| Action | When |
|--------|------|
| `ai_manager.account.ensure` | Account created/refreshed or password set |
| `ai_manager.settings.update` | Owner saves Settings → AI Manager |
| `ai_manager.tick.report` | Digest produced and (attempted) emailed |
| `ai_manager.tick.skip` | Disabled / already running / quiet interval |
| `ai_manager.tick.fail` | Tick threw |

View recent rows in **Settings → AI Manager → Action log**, or `GET /manager/ai-manager/action-logs?actorEmail=…`. Interval “not elapsed yet” checks are **not** logged (would spam).

## Safety (v1)

- Does **not** auto-send support replies, create fines, adjust coins, or write payment receipts from the scheduled loop.
- Assist mode only **suggests** drafts inside the owner report.
- Staff permissions on the AI account default to broad **read** plus support/cleaning write flags for future use; mutating automation is intentionally not wired yet.
- Existing human **Manager AI chat** tools are unchanged and still require a logged-in operator.

## Related

- Human manager assist chat: `api/src/manager-ai-chat.ts`
- Support reply drafts: `generateManagerSupportReplyDraft` in `resident-support-ai.ts`
- Behavior / usage logs: `docs/ai-behavior-log.md` (channel `manager`, feature `ai_manager_report`)
