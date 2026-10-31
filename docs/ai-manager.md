# Cozoro AI Manager

An autonomous **manager staff agent** with its own portal login. It watches day-to-day operations and **reports to owners**, instead of only answering when a human types in the Settings AI chat.

## What it is

| Piece | Detail |
|-------|--------|
| **Account** | Real staff row (`manager` role). Default email `ai.manager@cozorohome.com` (override with `AI_MANAGER_EMAIL`). |
| **Login** | Same portal email/password login as any manager. Owners set the password from **Settings → AI Manager**. |
| **Background job** | API `setInterval` (~30 min check) runs a tick when enabled and the configured interval has elapsed. |
| **Report** | LLM digest emailed to owners + stored under `api/data/ai-manager-reports.json` + Notification Center card for owners. |
| **Modes** | `report_only` (default) or `assist` (unsent support drafts when chat auto-reply is off). |
| **Capabilities** | Owner toggles in Settings: `ownerReports`, `answerChat`, `manageFines`, `scheduleAssignment` (all off except reports by default). |

It reuses the same LLM stack as other portal AI (9router `gpt-5` when configured, else Gemini).

## Owner-controlled functions

| Toggle | When enabled on a tick |
|--------|-------------------------|
| **Owner reports** | LLM digest emailed + stored + Notification Center |
| **Answer support chat** | Auto-sends AI replies on personal threads waiting for staff (max 5/tick). Sensitive topics (deposit refund, terminate, bed transfer, legal) escalate instead of auto-reply. |
| **Create / correct fines** | Runs missed-cleaning fine sweep; resolves open fine disputes with conservative keep/cancel rules |
| **Cleaning schedule assignment** | Fills open cleaning slots via `autoScheduleCleaningTasksByJob` (respects admin auto-scheduler enablement) |

Every capability action writes `ai_manager.*` rows to **ActionLog**.

## Owner feedback & learning

In **Settings → AI Manager → Action log**, owners can:

1. Open any AI Manager action
2. Mark **Like** or **Dislike**
3. Write a **learning guide** for similar future events

Guides are stored in `api/data/ai-manager-feedback.json` and injected into later ticks:

| Capability | How guides are used |
|------------|---------------------|
| Answer chat | Appended to support reply draft system prompt |
| Manage fines | Influence keep/cancel on open fine disputes |
| Owner reports | Included in digest LLM system prompt |
| Schedule assignment | Recorded on assign logs (fairness algorithm unchanged) |

Also listed under **Learning guides** in the same Settings panel.

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
| `PUT` | `/manager/ai-manager/action-logs/:id/feedback` | owner / app_admin (like/dislike + guide) |
| `GET` | `/manager/ai-manager/feedback` | staff |

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

## Safety

- Mutating functions stay **off** until an owner enables them in Settings.
- Chat auto-reply skips sensitive topics and never posts to group channels.
- Fine dispute cancels only when the resident text clearly indicates paid/duplicate/wrong person; otherwise the fine is kept with a logged note.
- Schedule assignment uses the same fairness ranking as the human auto-scheduler and will no-op if that scheduler is disabled.
- Existing human **Manager AI chat** tools are unchanged.

## Related

- Human manager assist chat: `api/src/manager-ai-chat.ts`
- Support reply drafts: `generateManagerSupportReplyDraft` in `resident-support-ai.ts`
- Behavior / usage logs: `docs/ai-behavior-log.md` (channel `manager`, feature `ai_manager_report`)
