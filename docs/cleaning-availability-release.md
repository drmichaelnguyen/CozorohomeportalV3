# Cleaning availability, duty release, and missed fines

## Problem fixed (3.9.39)

Residents could save **Away / UNAVAILABLE** while assigned duties stayed on their schedule. The portal treated optional follow-up release as a separate request, so preference-only saves were easy to confuse with successful duty removal. Missed-duty fine amounts also depended on ticket creation month and processing order.

## Coordinated away + release

`POST /cleaning/availability` and `POST /cleaning/availability/bulk` accept:

| Field | Meaning |
|-------|---------|
| `releaseAssigned` | When true, attempt to release conflicting ASSIGNED duties after saving availability |
| `confirmations` | Map of `taskId → confirmationKey` for the two-step release commit |
| `declinedTaskIds` | Task ids the resident declined to release |

Response always separates:

- `availabilitySaved` — preference persisted
- `duties[].dutyReleased` — true only when the duty was actually reassigned/released
- `duties[].outcome` — `preference_only` \| `confirmation_required` \| `released` \| `declined` \| `no_replacement` \| `failed` \| …

Durable notices live in `api/data/cleaning-duty-cancellations.json` (retry-safe; first `noticeAt` is preserved). Late-cancellation penalties use **noticeAt → duty date**, not the retry/commit clock.

UNAVAILABLE alone never waives a missed-duty fine. Only `RELEASED` / `EXEMPT` cancellation records (or a successful release that reassigns the task) block missed fines.

## Release notice tiers (unchanged rates)

Relative to **notice** calendar day vs duty day:

| Notice | Fine |
|--------|------|
| Past duty | Cannot release |
| Same day | 75% of 10,000 VND |
| 1–4 days ahead | 50% |
| 5+ days ahead | 0 |

## Missed-duty fine escalation (corrected)

- Count prior automatic cleaning offences by **duty date month**, not ticket creation month.
- Exclude cancelled / voided / exempt sheet rows from escalation.
- Amount for duty D depends only on earlier same-content duties in that month (stable by duty date, then task id), so forward vs reverse overdue processing yields the same VND amounts.
- Does **not** reprice historical production fines.

### Policy ambiguity

Whether “first ever automatic cleaning fine → 15,000 else 30,000” should ignore cancelled history is implemented as: cancelled/voided/exempt rows do not count toward the ever-had base. If operations intended cancelled history to still force the 30,000 base, that needs an explicit product decision.

## Calendar sync

Stale Google Calendar events must not restore a released resident. Sync respects UNAVAILABLE release notes and durable RELEASED/EXEMPT cancellation records, and skips create-from-calendar for released assignees.

## UI

- Away / unavailable: violet square marker + label
- Vietnam holiday: rose circle marker + label
- Both can show together; mobile legend included
- Late-cancel copy separates VND fine from membership coin conversion
