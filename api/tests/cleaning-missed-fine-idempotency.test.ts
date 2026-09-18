import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

import {
  AUTO_CLEANING_FINE_DESCRIPTION_PREFIX,
  FINE_AMOUNT_COLUMN,
  FINE_CONTENT_COLUMN,
  FINE_DESCRIPTION_COLUMN
} from "../src/cleaning-missed-fine-amount.ts";
import {
  cleaningEvasionFineLockKey,
  createInProcessAdvisoryLock,
  issueCleaningEvasionFineOnce,
  issueMissedCleaningFineOnce,
  isOutsideMissedFineLookback,
  missedCleaningFineLockKey,
  taskIdFineMarker
} from "../src/cleaning-missed-fine-issue.ts";

const DEFAULT_MISSED_FINE_LOOKBACK_DAYS = 14;

function clampMissedFineLookbackDays(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MISSED_FINE_LOOKBACK_DAYS;
  return Math.max(1, Math.min(90, Math.trunc(numeric)));
}

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    userEmail: "resident@example.com",
    status: "ASSIGNED",
    type: "TRASH_D7",
    branchId: "D7",
    floor: 1,
    scheduledDate: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeHarness(options?: {
  initialRows?: Array<Record<string, string>>;
  failSqlAfterAppend?: boolean;
  lookbackDays?: number | null;
}) {
  const sheetRows = [...(options?.initialRows ?? [])];
  let task = baseTask();
  let appendCount = 0;
  let markCount = 0;
  const outcomes: string[] = [];
  const withLock = createInProcessAdvisoryLock();

  const deps = {
    spreadsheetId: "sheet-test",
    taskId: task.id,
    operatorLabel: "manager@example.com",
    now: new Date("2026-09-10T12:00:00.000Z"),
    lookbackDays: options?.lookbackDays ?? null,
    withLock,
    getMissedFineDeadline: () => new Date("2026-09-02T12:00:00.000Z"),
    findTask: async () => task,
    isCancelledOrExempt: async () => false,
    readFinesSheetRows: async () => sheetRows.map((row) => ({ ...row })),
    computeFineAmount: async () => 15000,
    buildFineContent: () => "Không đổ rác theo lịch đã phân công",
    buildFineDescription: (current: { id: string }) =>
      `${AUTO_CLEANING_FINE_DESCRIPTION_PREFIX} ${taskIdFineMarker(current.id)} duty`,
    buildFineLocation: () => "D7",
    createFine: async (input: {
      email: string;
      amount: number;
      content: string;
      description: string;
    }) => {
      appendCount += 1;
      sheetRows.push({
        EMAIL: input.email,
        [FINE_CONTENT_COLUMN]: input.content,
        [FINE_DESCRIPTION_COLUMN]: input.description,
        [FINE_AMOUNT_COLUMN]: String(input.amount)
      });
      if (options?.failSqlAfterAppend) {
        throw new Error("SQL update failed after sheet append");
      }
    },
    markTaskMissed: async () => {
      markCount += 1;
      task = { ...task, status: "MISSED" };
      return task;
    },
    logOutcome: async ({ outcome }: { outcome: string }) => {
      outcomes.push(outcome);
    }
  };

  return {
    deps,
    get appendCount() {
      return appendCount;
    },
    get markCount() {
      return markCount;
    },
    get outcomes() {
      return outcomes;
    },
    get sheetRows() {
      return sheetRows;
    },
    get task() {
      return task;
    },
    setFailSqlAfterAppend(value: boolean) {
      options = { ...(options ?? {}), failSqlAfterAppend: value };
      // recreate createFine with new flag via mutating options object used by closure
      (options as { failSqlAfterAppend?: boolean }).failSqlAfterAppend = value;
    }
  };
}

test("lock keys are stable and distinct", () => {
  assert.equal(missedCleaningFineLockKey("abc", "task-1"), "missed-cleaning-fine:abc:task-1");
  assert.equal(
    cleaningEvasionFineLockKey("abc", "A@Example.com", "2026-08"),
    "cleaning-evasion-fine:abc:a@example.com:2026-08"
  );
  assert.equal(DEFAULT_MISSED_FINE_LOOKBACK_DAYS, 14);
  assert.equal(clampMissedFineLookbackDays(0), 1);
  assert.equal(clampMissedFineLookbackDays(999), 90);
});

test("two concurrent attempts for the same task append exactly one fine", async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([
    issueMissedCleaningFineOnce(harness.deps),
    issueMissedCleaningFineOnce(harness.deps)
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ["alreadyExists", "created"]);
  assert.equal(harness.appendCount, 1);
  assert.equal(harness.markCount, 1);
  assert.equal(harness.sheetRows.length, 1);
});

test("in-process advisory lock serializes by key like a cross-process DB lock", async () => {
  const withLock = createInProcessAdvisoryLock();
  const order: string[] = [];
  await Promise.all([
    withLock("same-key", async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
    }),
    withLock("same-key", async () => {
      order.push("b-start");
      order.push("b-end");
    })
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("retry after sheet append succeeded and SQL update failed does not append again", async () => {
  const sheetRows: Array<Record<string, string>> = [];
  let task = baseTask();
  let appendCount = 0;
  let markShouldFail = true;
  const withLock = createInProcessAdvisoryLock();

  const run = () =>
    issueMissedCleaningFineOnce({
      spreadsheetId: "sheet-test",
      taskId: task.id,
      operatorLabel: "manager@example.com",
      now: new Date("2026-09-10T12:00:00.000Z"),
      lookbackDays: null,
      withLock,
      getMissedFineDeadline: () => new Date("2026-09-02T12:00:00.000Z"),
      findTask: async () => task,
      isCancelledOrExempt: async () => false,
      readFinesSheetRows: async () => sheetRows.map((row) => ({ ...row })),
      computeFineAmount: async () => 15000,
      buildFineContent: () => "content",
      buildFineDescription: (current) =>
        `${AUTO_CLEANING_FINE_DESCRIPTION_PREFIX} ${taskIdFineMarker(current.id)}`,
      buildFineLocation: () => "D7",
      createFine: async (input) => {
        appendCount += 1;
        sheetRows.push({
          EMAIL: input.email,
          [FINE_CONTENT_COLUMN]: input.content,
          [FINE_DESCRIPTION_COLUMN]: input.description,
          [FINE_AMOUNT_COLUMN]: String(input.amount)
        });
      },
      markTaskMissed: async () => {
        if (markShouldFail) {
          throw new Error("SQL update failed after sheet append");
        }
        task = { ...task, status: "MISSED" };
        return task;
      },
      logOutcome: async () => undefined
    });

  await assert.rejects(run(), /SQL update failed/);
  assert.equal(appendCount, 1);
  assert.equal(task.status, "ASSIGNED");

  markShouldFail = false;
  const recovered = await run();
  assert.equal(recovered.outcome, "alreadyExists");
  assert.equal(appendCount, 1);
  assert.equal(task.status, "MISSED");
});

test("existing Task ID marker returns alreadyExists without a second append", async () => {
  const harness = makeHarness({
    initialRows: [
      {
        EMAIL: "resident@example.com",
        [FINE_CONTENT_COLUMN]: "content",
        [FINE_DESCRIPTION_COLUMN]: `${AUTO_CLEANING_FINE_DESCRIPTION_PREFIX} ${taskIdFineMarker("task-1")}`,
        [FINE_AMOUNT_COLUMN]: "30000"
      }
    ]
  });
  const result = await issueMissedCleaningFineOnce(harness.deps);
  assert.equal(result.outcome, "alreadyExists");
  assert.equal(result.fineAmount, 30000);
  assert.equal(harness.appendCount, 0);
  assert.equal(harness.markCount, 1);
});

test("monthly evasion fine creation is idempotent by normalized email/month", async () => {
  const sheetRows: Array<Record<string, string>> = [];
  let appendCount = 0;
  const withLock = createInProcessAdvisoryLock();
  const deps = {
    spreadsheetId: "sheet-test",
    email: "Resident@Example.com",
    month: "2026-08",
    amount: 100000,
    content: "Cleaning duty evasion",
    description: "Cleaning duty evasion for 2026-08: test",
    location: "D7",
    operator: "System",
    withLock,
    readFinesSheetRows: async () => sheetRows.map((row) => ({ ...row })),
    createFine: async (input: {
      email: string;
      amount: number;
      content: string;
      description: string;
    }) => {
      appendCount += 1;
      sheetRows.push({
        EMAIL: input.email,
        [FINE_CONTENT_COLUMN]: input.content,
        [FINE_DESCRIPTION_COLUMN]: input.description,
        [FINE_AMOUNT_COLUMN]: String(input.amount)
      });
    },
    logOutcome: async () => undefined
  };

  const [first, second] = await Promise.all([
    issueCleaningEvasionFineOnce(deps),
    issueCleaningEvasionFineOnce(deps)
  ]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ["alreadyExists", "created"]);
  assert.equal(appendCount, 1);
});

test("old backlog items are skippedOld / reviewRequired rather than auto-fined", async () => {
  assert.equal(
    isOutsideMissedFineLookback({
      missedFineDeadlineAt: new Date("2026-08-01T00:00:00.000Z"),
      now: new Date("2026-09-10T00:00:00.000Z"),
      lookbackDays: 14
    }),
    true
  );

  const harness = makeHarness({ lookbackDays: 14 });
  harness.deps.getMissedFineDeadline = () => new Date("2026-08-01T00:00:00.000Z");
  const result = await issueMissedCleaningFineOnce(harness.deps);
  assert.equal(result.outcome, "skippedOld");
  assert.equal(harness.appendCount, 0);
  assert.equal(harness.markCount, 0);
});

test("cancelled/exempt duties are skipped without appending", async () => {
  const harness = makeHarness();
  harness.deps.isCancelledOrExempt = async () => true;
  const result = await issueMissedCleaningFineOnce(harness.deps);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "cancelled_or_exempt");
  assert.equal(harness.appendCount, 0);
});

test("bulk endpoint response shape aggregates created/alreadyExists/skipped/failed", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /created,\s*\n\s*alreadyExists,\s*\n\s*skipped,\s*\n\s*failed/);
  assert.match(source, /batchId: requestId/);
  assert.match(source, /createMissedFines: parsed\.data\.createMissedFines === true/);
});

test("manual sweep does not create fines unless explicitly requested", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /trigger === "manual"\s*\n\s*\? options\?\.createMissedFines === true/
  );
  assert.doesNotMatch(
    source,
    /trigger === "manual" \|\| schedulerConfig\.autoMissedCleaningFines !== false/
  );
});

test("bulk UI requires explicit selection and confirmation before sending task IDs", () => {
  const portalSource = readFileSync(
    new URL("../../portal/components/admin-cleaning-client.tsx", import.meta.url),
    "utf8"
  );
  assert.match(portalSource, /openBulkConfirm\("fine"\)/);
  assert.match(portalSource, /selectedOverdueTaskIds/);
  assert.match(portalSource, /BULK_FINE_TYPED_CONFIRM_THRESHOLD/);
  assert.doesNotMatch(
    portalSource,
    /bulkProcessOverdueTasks\(\s*"fine",\s*overdueAssignedSortedNewestFirst\.map/
  );
  assert.match(portalSource, /createMissedFines: manualSweepCreateFines === true/);
});

test("db-advisory-lock module is the cross-process primitive (not a module Set)", () => {
  const lockSource = readFileSync(new URL("../src/db-advisory-lock.ts", import.meta.url), "utf8");
  assert.match(lockSource, /GET_LOCK/);
  assert.match(lockSource, /RELEASE_LOCK/);
  assert.doesNotMatch(lockSource, /new Set/);
});

test("TypeScript transpile of issue helpers remains valid", () => {
  const source = readFileSync(new URL("../src/cleaning-missed-fine-issue.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  });
  assert.ok(output.outputText.includes("issueMissedCleaningFineOnce"));
});
