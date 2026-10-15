# Cleaning assignment algorithm

This document describes how empty cleaning slots are filled and how manager assign / release / swap reuse the same ranking.

Implementation lives mainly in `api/src/cleaning.ts` (`compareCleaningCandidateRank`, `getAssignableCandidates`, `getAvailableUsersForAdminSlot`, `autoScheduleCleaningTasksByJob`).

## Paths that assign a resident

| Path | Source | Who picks the person |
|------|--------|----------------------|
| Background auto-scheduler (hourly + startup + manual) | `SYSTEM` | Shared ranking → top candidate, on duty days only |
| Manager bulk auto-assign | `MANAGER` | Same shared ranking (one person reserved per batch date); rest days show “rest (gap)” and are not filled |
| Manager manual assign | `MANAGER` | Staff picks from available-users list (list order = same ranking) |
| Manager bulk **preview** | — | Same available-users endpoint → same ranking as commit |
| Resident self-assign | `SELF` | Resident chooses an open future slot (max 30 days; coin multipliers) |
| Release → replacement | usually stays assigned to replacement | Shared ranking via available-users |
| Release → place releaser later | `SYSTEM` | Only if releaser is **top** underdue pick for that later **duty** day (not a rest day) |

## Shared ranking (order)

For a given calendar slot (`type` + date + trash floor when `TRASH_D7`):

1. **Eligibility** — active long-term client (not hostel `SHORTTERM-*`), correct branch/floor, not monthly opt-out, not contract cleaning opt-out, not `UNAVAILABLE` that day (manager may `force` on manual assign only).
2. **Same-day** — anyone who already has a cleaning task that calendar day ranks last / is excluded from auto-fill.
3. **Availability tier** — `PREFERRED` → `AVAILABLE` → unmarked. Marking Available beats staying silent; Preferred beats Available.
4. **Per-type fairness (60 days)** — fewest non-`MISSED` tasks of **this slot type** first. Kitchen and trash counts are separate so D7 dual-duty does not stack into one global “already busy” score.
5. **Correction soft penalty** — residents managers recently corrected *away* from a slot get a small demotion (heavier for overlap / over-assigned / wrong-person reasons). Never excludes someone; tie-break only.
6. **Name** — stable locale tie-break.

Counts include future `ASSIGNED` tasks in the window so self-assign ahead of time reduces near-term auto picks (intended).

## Horizons and config

- Background fill: per-job settings in cleaning scheduler config (`enabled`, `fillUnassignedDates`, `horizonDays` 1–60, default often 15, `rotationGapDays` 1–7, optional `autoGap`). Starts at **tomorrow** (not today).
- D2 kitchen automation can be forced off via branch closure.
- Self-assign: future dates only, max 30 days; weekday/weekend/holiday coin multipliers vs base system/manager reward.
- Post-release auto-place for the releaser: search same type/floor duty days within **15 days after** the released date; place only when the releaser would be `candidates[0]` under the shared ranking.

## Rotation gap

Each job (`KITCHEN_D7`, `KITCHEN_D2`, `TRASH_D7:<floor>`) can space duties out so a lightly occupied floor is not filled every day.

| Setting | Meaning |
|---------|---------|
| `rotationGapDays` 1 (default) | Duty every day. Same dates as before this setting existed. |
| `rotationGapDays` 2 | Every other day. 3 = every third day, up to 7. |
| `autoGap.enabled` | Widen the gap from eligible headcount. Default off. Target default is 6 duties / resident / 30 days. |
| Effective gap | `clamp(ceil(30 / (eligibleCount × target)), rotationGapDays, 7)`. Never tighter than the manual gap, never looser than 7. |
| Eligible count 0 with auto gap on | Skip that job for the run. |

Eligible residents match auto-assign: active long-term, correct branch/floor, not assignment-exempt, not opted out for the horizon-start month, not contract-opted-out, not hostel `SHORTTERM-*`. Day-specific unavailability is not part of the headcount.

A date inside the horizon is a **duty day** only when no occupying task of that job (same type, and same floor for trash) sits within `effectiveGap − 1` days before or after it. The walk starts at tomorrow and treats each planned duty day as an anchor, so later hourly runs do not drift. Lookback is the same radius before the horizon start. Tasks of any source and status occupy the cadence, including `MISSED`. Removed tasks are gone from the database and do not. A self-assigned or manager task on a rest day is kept; the next auto duty is at least `effectiveGap` days after that task.

Raising the gap does **not** delete future tasks already on the calendar. It only changes which empty dates are filled from the next run onward.

Rest days stay valid for resident self-assign (coin multipliers unchanged). They are not open slots for `SELF_ASSIGN_OPPORTUNITY`, the Schedule badge, Claim next, or Cozoro Bee. The resident overview returns `restDatesByType` (`YYYY-MM-DD`) and the calendar shows those days as neutral, with a rest-day label on wider screens. Tapping still opens self-assign.

Manager bulk preview lists rest days as “rest (gap)” and does not propose a person. Bulk commit skips them. Manual assign of one slot is unrestricted. Release replacement on the existing duty date is unchanged. Post-release re-place of the releaser only considers later duty days.

## Hostel short-term guests

Guests with contract code `SHORTTERM-*` are excluded from the cleaning schedule entirely:

- Not in `getActiveCleaningUsers` (auto/bulk/manual candidate pools, self-assign, swaps, availability)
- `isResidentEligibleForCleaningSchedule` returns false (left-resident sweep / overview purge leftover tasks)
- Creating or confirming a hostel guest clears any existing cleaning tasks for that email
- Portal Schedule still shows laundry/payment; cleaning UI shows a not-required notice

## Manager overrides

Manual assign may:

- Reassign an existing filled slot
- `force` past `UNAVAILABLE` or same-day double book (requires correction feedback when fixing SYSTEM / force)

Reassign recalculates `rewardCoins` from current settings and the new `isSelfAssigned` flag so SELF multipliers do not stick after a manager/system overwrite.

## Opt-out month keys

Monthly opt-out rows use `YYYY-MM` from the task’s **UTC calendar date** (`cleaningMonthKeyFromDate`), shared by auto-schedule, admin assign, and self-assign checks.

## Related UI copy

Resident help panels (`autoScheduleHelp`, `removalHelp` in `portal/components/portal-language.tsx`) summarize this algorithm in EN/VI.
