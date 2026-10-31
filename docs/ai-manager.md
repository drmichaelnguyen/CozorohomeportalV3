# Cozoro AI Manager

An autonomous **manager staff agent** with its own portal login. It watches day-to-day operations and **reports to owners**, instead of only answering when a human types in the Settings AI chat.

## What it is

| Piece | Detail |
|-------|--------|
| **Account** | Real staff row (`manager` role). Default email `ai.manager@cozorohome.com` (override with `AI_MANAGER_EMAIL`). |
| **Login** | Same portal email/password login as any manager. Owners set the password from **Settings → AI Manager**. |
| **Background job** | API `setInterval` (~30 min check) runs a tick when enabled and the configured interval has elapsed. |
| **Report** | LLM digest emailed to owners + stored under `api/data/ai-manager-reports.json` + posted into the **Messages → AI Manager** chat tab + Notification Center card for owners. |
| **Owner chat tab** | Owners / app admins see **Messages → AI Manager**. The agent reports here and **escalates** when unsure, with multiple-choice options (or free-text guidance). |
| **Modes** | `report_only` (default) or `assist` (unsent support drafts when chat auto-reply is off). |
| **Capabilities** | Owner toggles in Settings: `ownerReports`, `answerChat`, `manageFines`, `scheduleAssignment` (all off except reports by default). |

It reuses the same LLM stack as other portal AI (9router `gpt-5` when configured, else Gemini).

## Owner-controlled functions

| Toggle | When enabled on a tick |
|--------|-------------------------|
| **Owner reports** | LLM digest emailed + stored + Notification Center |
| **Answer support chat** | Auto-sends AI replies on personal threads waiting for staff (max 5/tick). Sensitive topics (deposit refund, terminate, bed transfer, legal) escalate to the owner AI Manager chat tab (multiple choice) instead of auto-reply. |
| **Create / correct fines** | Runs missed-cleaning fine sweep; resolves clear fine disputes; **ambiguous disputes escalate** to the owner chat tab for Keep / Cancel / Need more info |
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
| `GET` | `/manager/ai-manager/usage?actorEmail=&days=` | owner / app_admin (token/cost by task + category) |
| `GET` | `/manager/ai-manager/inbox?actorEmail=` | owner / app_admin — chat-tab reports + open escalations |
| `POST` | `/manager/ai-manager/inbox/:id/choose` | owner / app_admin — pick a multiple-choice option (may close topic) |
| `POST` | `/manager/ai-manager/inbox/:id/reply` | owner / app_admin — reply inside topic (`closeTopic` optional) |
| `POST` | `/manager/ai-manager/inbox/:id/close` | owner / app_admin — close topic |
| `POST` | `/manager/ai-manager/inbox/:id/reopen` | owner / app_admin — reopen topic |
| `POST` | `/manager/ai-manager/inbox/:id/ack` | owner / app_admin — alias for close (reports) |
| `POST` | `/manager/ai-manager/inbox/mark-read` | owner / app_admin |

Inbox state is stored in `api/data/ai-manager-inbox.json` (preserve across production refreshes).

## Owner chat tab (Messages → AI Manager)

Visible only to **owner** and **app_admin**. Conversation is organized as **topics** (open/closed) with **threaded replies inside each topic**, so the agent is not confused by a flat feed.

On each tick the agent can:

1. Open a **report** topic with the digest as the opening message
2. **Escalate** into a dedicated topic when unsure, with multiple-choice buttons:
   - Sensitive support chat (instead of auto-reply)
   - Ambiguous fine disputes (Keep / Cancel / Need more info — keeps topic open)
   - Pending contract approvals (review queue / remind later — keeps topic open)
3. If the same case is still open, append a **follow-up** inside that topic instead of creating a duplicate
4. Read open-topic owner replies on later ticks (injected into learning prompts) so it knows what to do
5. Learn from closed decisions (ActionLog + learning guide)

Owners can **reply inside a topic** (leave open or close after send), **pick a choice**, **close**, or **reopen**.

Deep link: `/manager?view=support_chat&tab=ai_manager`

## Token usage by task / category

Every AI Manager LLM call is recorded in `AiUsageEvent` under a dedicated feature key so owners can see spend separately from human Manager AI chat:

| Feature key | Category (capability) | When |
|-------------|----------------------|------|
| `ai_manager_report` | Owner reports | Digest LLM summary |
| `ai_manager_chat_reply` | Answer support chat | Auto-sent replies and assist-mode unsent drafts |
| `ai_manager_fines` | Create / correct fines | Reserved (dispute/sweep paths are rule-based today → usually 0 tokens) |
| `ai_manager_schedule` | Cleaning schedule assignment | Reserved (uses shared fairness algo → usually 0 tokens) |

View totals, **by task**, **by category**, and recent calls in **Settings → AI Manager → Token usage**, or `GET /manager/ai-manager/usage`. Global AI analytics (`Settings → AI usage`) still includes these features alongside other portal AI.

## Action logs

Every meaningful AI Manager event is written to the shared Prisma **`ActionLog`** table (same audit store as other manager ops):

| Action | When |
|--------|------|
| `ai_manager.account.ensure` | Account created/refreshed or password set |
| `ai_manager.settings.update` | Owner saves Settings → AI Manager |
| `ai_manager.tick.report` | Digest produced and (attempted) emailed |
| `ai_manager.inbox.escalate` | Escalation posted to owner chat tab |
| `ai_manager.inbox.resolve` | Owner/admin chose an option or sent guidance |
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
- Behavior / usage logs: `docs/ai-behavior-log.md` (channel `manager`, features `ai_manager_*`)
