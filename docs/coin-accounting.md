# Coin accounting and cleaning reward recovery

## Source of truth and release 3.9.31

The resident's active roster row supplies `Cozoro coins hiện có` (spendable balance) and `Tổng Coins tích luỹ` (gross lifetime earnings). The Coins and Home screens trust a present numeric roster balance, including zero and negative balances. Transaction history is a fallback only when that field is unavailable or invalid. Gross earnings sum positive credits; spending and cleaning clawbacks do not reduce gross lifetime/monthly earnings.

Cleaning history uses stable transaction IDs `CleaningReward{taskId}` and `CleaningReversal{taskId}`. An approved task and its SQL `CoinLedger` entry alone do not prove that Google Sheets was synchronized.

Before 3.9.31, cleaning awards read a cached balance, appended a history row, then separately overwrote the roster balance. Concurrent awards could overwrite one another, a partial failure could leave history without its balance update, and positive awards omitted lifetime/monthly earnings entirely. A later writer could therefore continue from inconsistent totals. A duplicate-history early return prevented retries from fixing a partial update.

## Cleaning write guarantees

- `coin-write-lock.ts` uses MySQL/MariaDB `GET_LOCK` on a dedicated single-connection Prisma client. All cleaning sheet writes for the configured spreadsheet share a lock, including reversals. Audit operations also lock by task ID so concurrent approve/reject requests cannot interleave their database and sheet changes. Lock waits fail after 15 seconds. The private connection owns the lock for the whole callback, without a SQL transaction timer expiring during an external Google operation. The dedicated client disconnects in `finally`, including error paths, so advisory locks are not left on pooled application connections.
- After acquiring the sheet lock, read the live roster and history; do not calculate from local caches. Select the latest active contract using the existing submission-time rule. Missing sheets, identity columns, transaction-ID column, balance columns, or an active resident abort the write.
- Submit one `spreadsheets.batchUpdate` containing roster `updateCells` requests and history `appendCells`. Google applies the requests [atomically](https://developers.google.com/workspace/sheets/api/guides/batch): history and balances either commit together or fail together. Cell values are typed; names and transaction IDs are literal strings.
- The batch write has no automatic HTTP retry. If its response is lost, retry the audit operation: its live history check detects a committed transaction and prevents a second payment. A failed batch leaves no history marker and can be retried normally.
- Positive cleaning awards increment current and lifetime balances. Current-month gross earnings are rebuilt from live positive history and include the new reward. Reversals debit the original recorded reward (even if the task's configured reward later changes), once only. A spent reward can create a negative balance, preserving the full debit. Gross earnings remain unchanged.
- A retry of the same completed audit refreshes Calendar/Sheets without creating another SQL audit/ledger entry. Optional rejection fines use a live task-marker check under their own lock: retries create a missing fine once and skip an existing fine and its email. Cache-file failures after a successful batch are logged; they do not repeat the reward.

These locks coordinate the new cleaning flow across API processes using the same database. They do **not** lock out human sheet edits, Apps Script, or older laundry/manager/extension writers that do not acquire this lock. Google Sheets does not provide a compare-and-swap read/write transaction. Keep those writers out of a manual reconciliation window; a universal coin-ledger migration is outside this patch. Existing SQL approval and external Google operations remain separate transactions, so an interrupted audit still needs a retry.

## Historical reconciliation

Do not replay old cleaning rewards or add a new adjustment credit when the rewards already exist in history. That would double-count earned coins. This release intentionally does not auto-rewrite balances for every resident: older contracts, manual adjustments, duplicate rows, and legacy transaction identifiers require individual review.

For a reported discrepancy:

1. Read the live active roster row and all coin history for the normalized email. Compare gross positive credits, absolute negative debits, history net, spendable balance, and lifetime earnings. Retain exact row positions and a private before snapshot.
2. Verify suspected `CleaningReward` IDs against `CleaningTask` and `CoinLedger`: distinct approved tasks, correct positive amounts, no reversal. Do not deduplicate old laundry entries solely by their transaction IDs; historical IDs were reused within a month.
3. Explain the entire proposed difference. For the September 8 incident, four approved cleaning rewards totaled 25,000; history earned 1,100,000 and spent 990,000, while the roster held 85,000 spendable and 1,075,000 lifetime. The reviewed correction is 110,000 spendable and 1,100,000 lifetime, without appending another credit. July's three simultaneous awards were 5,000 + 5,000 + 10,000; August's award was 5,000.
4. Immediately re-read and abort if the expected values, history, active contract, or task status changed. Save the before snapshot and audit intent privately. Write only the reviewed balance fields together, then record the outcome in `ActionLog` and the private snapshot.
5. Refresh client/coin caches and verify the production `/clients?email=...` and `/coins?email=...` responses. Recheck after a sync cycle for competing legacy automation. Never commit customer snapshots or OAuth credentials to git.

## Verification

Run `corepack pnpm --filter cozorohome-api test:coins` and the API/portal builds. The regression suite covers simultaneous distinct rewards, duplicate requests, failure before commit, lost success responses, reversal amount/idempotency, absent awards, invalid amounts, and zero/negative profile balances. The lock can also be checked with concurrent callbacks under an isolated test key; that check does not modify resident data.

A git push publishes source only. Refresh production separately using the host workflow; preserve `api/.env`, `api/.google-oauth.json`, and `api/data`.
