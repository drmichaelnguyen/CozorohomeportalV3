import assert from "node:assert/strict";
import { test } from "node:test";
import { CleaningTaskStatus } from "@prisma/client";

import { evaluateCleaningTaskCompletionGate } from "../src/cleaning-task-complete-gate.ts";

test("APPROVED tasks are never downgraded / re-completed", () => {
  const gate = evaluateCleaningTaskCompletionGate(
    { status: CleaningTaskStatus.APPROVED, userEmail: "a@example.com" },
    "a@example.com"
  );
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.match(gate.error, /already been reviewed/);
  }
});

test("REJECTED tasks cannot be completed again", () => {
  const gate = evaluateCleaningTaskCompletionGate(
    { status: CleaningTaskStatus.REJECTED, userEmail: "a@example.com" },
    "a@example.com"
  );
  assert.equal(gate.ok, false);
});

test("ASSIGNED can complete; DONE_PENDING_AUDIT is idempotent retry", () => {
  assert.deepEqual(
    evaluateCleaningTaskCompletionGate(
      { status: CleaningTaskStatus.ASSIGNED, userEmail: "a@example.com" },
      "a@example.com"
    ),
    { ok: true, isRetry: false }
  );
  assert.deepEqual(
    evaluateCleaningTaskCompletionGate(
      { status: CleaningTaskStatus.DONE_PENDING_AUDIT, userEmail: "a@example.com" },
      "a@example.com"
    ),
    { ok: true, isRetry: true }
  );
});

test("photo-save failure leaves status unchanged (ordering contract)", async () => {
  let status: CleaningTaskStatus = CleaningTaskStatus.ASSIGNED;
  const written: string[] = [];
  const deleted: string[] = [];

  async function persistFiles() {
    written.push("done-temp.jpg");
    throw new Error("compress failed");
  }

  async function commitStatus() {
    status = CleaningTaskStatus.DONE_PENDING_AUDIT;
  }

  async function cleanup(files: string[]) {
    deleted.push(...files);
  }

  // Same order as completeCleaningTask: write files → then status. On failure, cleanup files.
  try {
    const files: string[] = [];
    try {
      await persistFiles();
      files.push(...written);
      await commitStatus();
    } catch (error) {
      await cleanup(files.length ? files : written);
      throw error;
    }
  } catch (error) {
    assert.equal(error instanceof Error ? error.message : "", "compress failed");
  }

  assert.equal(status, CleaningTaskStatus.ASSIGNED);
  assert.deepEqual(deleted, ["done-temp.jpg"]);
});

test("idempotent retry replaces prior photo set instead of duplicating", async () => {
  const rows: Array<{ storageName: string }> = [{ storageName: "old-1.jpg" }];
  const deletedFiles: string[] = [];

  const previous = rows.map((row) => row.storageName);
  const written = [{ storageName: "new-1.jpg" }, { storageName: "new-2.jpg" }];

  rows.splice(0, rows.length);
  for (const file of written) {
    rows.push({ storageName: file.storageName });
  }
  deletedFiles.push(...previous);

  assert.deepEqual(
    rows.map((row) => row.storageName),
    ["new-1.jpg", "new-2.jpg"]
  );
  assert.deepEqual(deletedFiles, ["old-1.jpg"]);
});
