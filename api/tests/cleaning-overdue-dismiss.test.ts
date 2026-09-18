import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DISMISSED_OVERDUE_TASK_NOTE_PREFIX,
  buildDismissedOverdueNote,
  dismissOverdueAssignedTaskOnce,
  isDismissedOverdueNote
} from "../src/cleaning-overdue-dismiss.ts";

function createInProcessLock() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withInProcessLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => gate);
    tails.set(key, next);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (tails.get(key) === next) tails.delete(key);
    }
  };
}

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-overdue-1",
    userEmail: "resident@example.com",
    userName: "Resident",
    status: "ASSIGNED",
    type: "TRASH_D7",
    branchId: "D7",
    floor: 1,
    scheduledDate: new Date("2026-09-01T00:00:00.000Z"),
    rewardCoins: 5000,
    calendarId: "cal-1",
    calendarEventId: "evt-1",
    auditorNote: null as string | null,
    ...overrides
  };
}

function makeHarness(options?: { pastDeadline?: boolean }) {
  let task = baseTask();
  const audits: Array<{ taskId: string; reviewer: string; note: string }> = [];
  const logs: Array<{ outcome: string; note: string }> = [];
  const sideEffects: string[] = [];
  const pastDeadline = options?.pastDeadline ?? true;
  const withLock = createInProcessLock();

  const deps = {
    taskId: task.id,
    reviewer: "manager@example.com",
    now: new Date("2026-09-10T12:00:00.000Z"),
    withLock,
    findTask: async () => task,
    isPastMissedFineDeadline: () => pastDeadline,
    claimAssignedAsRejected: async ({ taskId, auditorNote }: { taskId: string; auditorNote: string }) => {
      if (task.id !== taskId || task.status !== "ASSIGNED") {
        return { count: 0 };
      }
      task = { ...task, status: "REJECTED", auditorNote };
      sideEffects.push("claim");
      return { count: 1 };
    },
    createAudit: async (input: { taskId: string; reviewer: string; note: string }) => {
      audits.push(input);
      sideEffects.push("audit");
    },
    logDismiss: async (input: { outcome: string; note: string }) => {
      logs.push({ outcome: input.outcome, note: input.note });
      sideEffects.push("log");
    },
    syncCalendar: async () => {
      sideEffects.push("calendar");
    },
    invalidateOverview: async () => {
      sideEffects.push("cache");
    }
  };

  return {
    deps,
    get task() {
      return task;
    },
    audits,
    logs,
    sideEffects
  };
}

test("dismiss note helpers", () => {
  const note = buildDismissedOverdueNote("mgr@example.com", new Date("2026-09-10T00:00:00.000Z"));
  assert.ok(note.startsWith(DISMISSED_OVERDUE_TASK_NOTE_PREFIX));
  assert.equal(isDismissedOverdueNote(note), true);
  assert.equal(isDismissedOverdueNote("other"), false);
});

test("eligible overdue assigned task dismisses successfully", async () => {
  const harness = makeHarness({ pastDeadline: true });
  const result = await dismissOverdueAssignedTaskOnce(harness.deps);
  assert.equal(result.outcome, "dismissed");
  assert.equal(result.task.status, "REJECTED");
  assert.ok(isDismissedOverdueNote(result.task.auditorNote));
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.logs.length, 1);
  assert.ok(harness.sideEffects.includes("calendar"));
  assert.ok(harness.sideEffects.includes("cache"));
});

test("task before its deadline cannot be dismissed", async () => {
  const harness = makeHarness({ pastDeadline: false });
  await assert.rejects(
    () => dismissOverdueAssignedTaskOnce(harness.deps),
    /not past the completion deadline/
  );
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.task.status, "ASSIGNED");
});

test("unrelated assigned task cannot be rejected through the normal audit flow", () => {
  const source = readFileSync(new URL("../src/cleaning.ts", import.meta.url), "utf8");
  assert.match(source, /Only pending or approved cleaning tasks can be rejected/);
  assert.match(
    source,
    /task\.status !== CleaningTaskStatus\.DONE_PENDING_AUDIT &&\s*task\.status !== CleaningTaskStatus\.APPROVED/
  );
  assert.match(source, /dismissOverdueAssignedTaskOnce/);
  const dismissFn = source.slice(
    source.indexOf("export async function adminDismissMissedCleaningTask"),
    source.indexOf("export async function getCleaningManagerReviewQueue")
  );
  assert.doesNotMatch(dismissFn, /auditCleaningTask\(/);
});

test("repeated dismissal is idempotent without duplicate audits", async () => {
  const harness = makeHarness({ pastDeadline: true });
  const first = await dismissOverdueAssignedTaskOnce(harness.deps);
  assert.equal(first.outcome, "dismissed");

  const before = {
    audits: harness.audits.length,
    logs: harness.logs.length,
    claims: harness.sideEffects.filter((entry) => entry === "claim").length
  };

  const second = await dismissOverdueAssignedTaskOnce(harness.deps);
  assert.equal(second.outcome, "alreadyDismissed");
  assert.equal(harness.audits.length, before.audits);
  assert.equal(harness.logs.length, before.logs);
  assert.equal(
    harness.sideEffects.filter((entry) => entry === "claim").length,
    before.claims
  );
});

test("concurrent dismissals claim exactly once", async () => {
  const harness = makeHarness({ pastDeadline: true });
  const [a, b] = await Promise.all([
    dismissOverdueAssignedTaskOnce(harness.deps),
    dismissOverdueAssignedTaskOnce(harness.deps)
  ]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ["alreadyDismissed", "dismissed"]);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.logs.length, 1);
});

test("bulk dismiss reports successful and failed items correctly", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /adminDismissMissedCleaningTask\(taskId, parsed\.data\.actorEmail\)/);
  assert.match(
    source,
    /outcome: result\.outcome === "alreadyDismissed" \? "alreadyDismissed" : "dismissed"/
  );
  assert.match(source, /failed \+= 1/);
  assert.match(source, /results\.push\(\{ taskId, ok: false, outcome, error: message \}\)/);
});
