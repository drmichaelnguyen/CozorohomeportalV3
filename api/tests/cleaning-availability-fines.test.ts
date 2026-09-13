import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AUTO_CLEANING_FINE_DESCRIPTION_PREFIX,
  FINE_AMOUNT_COLUMN,
  FINE_CONTENT_COLUMN,
  FINE_DESCRIPTION_COLUMN,
  FINE_DISPUTE_COLUMN,
  FINE_STATUS_COLUMN,
  computeMissedCleaningFineAmount,
  isCancelledOrVoidedOrExemptFine
} from "../src/cleaning-missed-fine-amount.ts";
import { computeCleaningReleasePenalty } from "../src/cleaning-release-penalty.ts";
import {
  __setDutyCancellationLedgerForTests,
  getDutyCancellationByTaskId,
  isReleasedOrExemptCancellationStatus,
  markDutyCancellationReleased,
  upsertDutyCancellationNotice
} from "../src/cleaning-duty-cancellation.ts";

const TRASH_CONTENT = "Không đổ rác theo lịch đã phân công";

function dutyRow(input: {
  taskId: string;
  dutyDate: string; // dd/mm/yyyy
  amount: number;
  content?: string;
  status?: string;
  dispute?: string;
}) {
  return {
    EMAIL: "resident@example.com",
    [FINE_CONTENT_COLUMN]: input.content ?? TRASH_CONTENT,
    [FINE_DESCRIPTION_COLUMN]: `${AUTO_CLEANING_FINE_DESCRIPTION_PREFIX} Task ID: ${input.taskId}. The resident did not mark trash duty D7 complete on ${input.dutyDate}.`,
    [FINE_AMOUNT_COLUMN]: String(input.amount),
    [FINE_STATUS_COLUMN]: input.status ?? "CHƯA",
    [FINE_DISPUTE_COLUMN]: input.dispute ?? ""
  };
}

test("release penalty notice boundaries: same-day, 1, 4, 5 days", () => {
  const duty = new Date(Date.UTC(2026, 7, 10)); // 2026-08-10
  assert.equal(computeCleaningReleasePenalty(duty, new Date(Date.UTC(2026, 7, 10))).fineRate, 0.75);
  assert.equal(computeCleaningReleasePenalty(duty, new Date(Date.UTC(2026, 7, 9))).fineAmount, 5000);
  assert.equal(computeCleaningReleasePenalty(duty, new Date(Date.UTC(2026, 7, 6))).fineAmount, 5000);
  assert.equal(computeCleaningReleasePenalty(duty, new Date(Date.UTC(2026, 7, 5))).fineAmount, 0);
  // Notice preserved: commit later same day still uses Aug 1 notice → free for Aug 10
  assert.equal(computeCleaningReleasePenalty(duty, new Date(Date.UTC(2026, 7, 1, 12, 59, 56))).fineAmount, 0);
});

test("preference-only away does not mark duty released in durable ledger", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cozoro-cancel-"));
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    await upsertDutyCancellationNotice({
      taskId: "task-aug-10",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-10",
      noticeAt: new Date("2026-08-01T12:59:56.000Z"),
      status: "PREFERENCE_ONLY"
    });
    const row = await getDutyCancellationByTaskId("task-aug-10");
    assert.equal(row?.status, "PREFERENCE_ONLY");
    assert.equal(isReleasedOrExemptCancellationStatus(row?.status), false);
  } finally {
    process.chdir(previousCwd);
    await rm(tmp, { recursive: true, force: true });
  }
});

test("retry preserves first noticeAt and released status is sticky", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cozoro-cancel-"));
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    const first = await upsertDutyCancellationNotice({
      taskId: "task-aug-15",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-15",
      noticeAt: new Date("2026-08-01T12:59:56.000Z"),
      status: "PENDING_CONFIRMATION"
    });
    const second = await upsertDutyCancellationNotice({
      taskId: "task-aug-15",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-15",
      noticeAt: new Date("2026-08-14T00:00:00.000Z"),
      status: "FAILED",
      lastError: "No replacement user is available for this date"
    });
    assert.equal(second.noticeAt, first.noticeAt);
    assert.equal(second.status, "FAILED");

    await markDutyCancellationReleased({
      taskId: "task-aug-15",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-15",
      fineAmountVnd: 0
    });
    const afterFailRetry = await upsertDutyCancellationNotice({
      taskId: "task-aug-15",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-15",
      status: "FAILED",
      lastError: "calendar write failed"
    });
    assert.equal(afterFailRetry.status, "RELEASED");
  } finally {
    process.chdir(previousCwd);
    await rm(tmp, { recursive: true, force: true });
  }
});

test("August duties processed in September use duty dates; forward and reverse order match", () => {
  const seed = [dutyRow({ taskId: "t-0810", dutyDate: "10/08/2026", amount: 15000 })];
  const pending = [
    { taskId: "t-0815", dutyDate: new Date(Date.UTC(2026, 7, 15)), label: "15/08/2026" },
    { taskId: "t-0829", dutyDate: new Date(Date.UTC(2026, 7, 29)), label: "29/08/2026" },
    { taskId: "t-0830", dutyDate: new Date(Date.UTC(2026, 7, 30)), label: "30/08/2026" },
    { taskId: "t-0902", dutyDate: new Date(Date.UTC(2026, 8, 2)), label: "02/09/2026" }
  ];
  const peers = pending.map((entry) => ({
    taskId: entry.taskId,
    dutyDate: entry.dutyDate,
    content: TRASH_CONTENT
  }));

  const amountFor = (taskId: string) => {
    const target = pending.find((entry) => entry.taskId === taskId)!;
    return computeMissedCleaningFineAmount({
      taskId,
      dutyDate: target.dutyDate,
      content: TRASH_CONTENT,
      userAutomaticCleaningFines: seed,
      peerPendingDuties: peers
    });
  };

  const forward = Object.fromEntries(pending.map((entry) => [entry.taskId, amountFor(entry.taskId)]));
  const reverse = Object.fromEntries([...pending].reverse().map((entry) => [entry.taskId, amountFor(entry.taskId)]));

  assert.deepEqual(forward, reverse);
  assert.equal(forward["t-0815"], 45000);
  assert.equal(forward["t-0829"], 90000);
  assert.equal(forward["t-0830"], 180000);
  assert.equal(forward["t-0902"], 30000);
});

test("cancelled or exempt offences are excluded from escalation", () => {
  const cancelled = dutyRow({
    taskId: "t-old",
    dutyDate: "05/08/2026",
    amount: 30000,
    status: "ĐÃ HỦY SAU KHIẾU NẠI",
    dispute: "Manager resolution (owner): Fine cancelled"
  });
  assert.equal(isCancelledOrVoidedOrExemptFine(cancelled), true);

  const amount = computeMissedCleaningFineAmount({
    taskId: "t-new",
    dutyDate: new Date(Date.UTC(2026, 7, 15)),
    content: TRASH_CONTENT,
    userAutomaticCleaningFines: [cancelled]
  });
  // Cancelled prior does not count as "ever had" → base 15000
  assert.equal(amount, 15000);
});

test("released duty cancellation blocks missed-fine eligibility helper", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cozoro-cancel-"));
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    await __setDutyCancellationLedgerForTests([]);
    await markDutyCancellationReleased({
      taskId: "task-released",
      userEmail: "resident@example.com",
      scheduledDate: "2026-08-10"
    });
    const row = await getDutyCancellationByTaskId("task-released");
    assert.equal(isReleasedOrExemptCancellationStatus(row?.status), true);
  } finally {
    process.chdir(previousCwd);
    await rm(tmp, { recursive: true, force: true });
  }
});
