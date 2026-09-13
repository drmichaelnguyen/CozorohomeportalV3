/**
 * Durable duty-cancellation notices for coordinated away + release.
 * Notice timestamps drive late-cancellation penalties across retries.
 * RELEASED / EXEMPT records block missed-duty fines for that task id.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CleaningDutyCancellationStatus =
  | "PREFERENCE_ONLY"
  | "PENDING_CONFIRMATION"
  | "RELEASED"
  | "DECLINED"
  | "FAILED"
  | "EXEMPT";

export type CleaningDutyCancellationRecord = {
  taskId: string;
  userEmail: string;
  scheduledDate: string; // YYYY-MM-DD
  noticeAt: string; // ISO
  status: CleaningDutyCancellationStatus;
  lastError?: string | null;
  fineAmountVnd?: number | null;
  releasedAt?: string | null;
  updatedAt: string;
};

type CleaningDutyCancellationLedger = {
  version: 1;
  byTaskId: Record<string, CleaningDutyCancellationRecord>;
};

const ledgerFilePath = path.join(process.cwd(), "data", "cleaning-duty-cancellations.json");
let writeChain: Promise<void> = Promise.resolve();

async function readLedger(): Promise<CleaningDutyCancellationLedger> {
  try {
    const raw = await readFile(ledgerFilePath, "utf8");
    const parsed = JSON.parse(raw) as CleaningDutyCancellationLedger;
    if (!parsed || parsed.version !== 1 || typeof parsed.byTaskId !== "object" || !parsed.byTaskId) {
      return { version: 1, byTaskId: {} };
    }
    return parsed;
  } catch {
    return { version: 1, byTaskId: {} };
  }
}

async function writeLedger(ledger: CleaningDutyCancellationLedger) {
  await mkdir(path.dirname(ledgerFilePath), { recursive: true });
  await writeFile(ledgerFilePath, JSON.stringify(ledger, null, 2), "utf8");
}

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function isReleasedOrExemptCancellationStatus(status: CleaningDutyCancellationStatus | string | null | undefined) {
  return status === "RELEASED" || status === "EXEMPT";
}

export async function getDutyCancellationByTaskId(taskId: string) {
  const ledger = await readLedger();
  return ledger.byTaskId[taskId] ?? null;
}

export async function listDutyCancellationsForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const ledger = await readLedger();
  return Object.values(ledger.byTaskId).filter((row) => row.userEmail === normalized);
}

/** Preserve first noticeAt; update status/error on retries. */
export async function upsertDutyCancellationNotice(input: {
  taskId: string;
  userEmail: string;
  scheduledDate: string;
  noticeAt?: Date;
  status: CleaningDutyCancellationStatus;
  lastError?: string | null;
  fineAmountVnd?: number | null;
  releasedAt?: Date | null;
}): Promise<CleaningDutyCancellationRecord> {
  return enqueueWrite(async () => {
    const ledger = await readLedger();
    const existing = ledger.byTaskId[input.taskId];
    const nowIso = new Date().toISOString();
    const noticeAt =
      existing?.noticeAt ??
      (input.noticeAt ?? new Date()).toISOString();

    // Never downgrade a successful release / exempt on retry of a failed later write.
    let status = input.status;
    if (existing && isReleasedOrExemptCancellationStatus(existing.status) && status !== "EXEMPT") {
      status = existing.status as CleaningDutyCancellationStatus;
    }

    const record: CleaningDutyCancellationRecord = {
      taskId: input.taskId,
      userEmail: input.userEmail.trim().toLowerCase(),
      scheduledDate: input.scheduledDate,
      noticeAt,
      status,
      lastError: input.lastError ?? null,
      fineAmountVnd: input.fineAmountVnd ?? existing?.fineAmountVnd ?? null,
      releasedAt:
        status === "RELEASED" || status === "EXEMPT"
          ? (existing?.releasedAt ?? (input.releasedAt ?? new Date()).toISOString())
          : (input.releasedAt?.toISOString() ?? existing?.releasedAt ?? null),
      updatedAt: nowIso
    };

    ledger.byTaskId[input.taskId] = record;
    await writeLedger(ledger);
    return record;
  });
}

export async function markDutyCancellationReleased(input: {
  taskId: string;
  userEmail: string;
  scheduledDate: string;
  fineAmountVnd?: number;
}) {
  return upsertDutyCancellationNotice({
    ...input,
    status: "RELEASED",
    lastError: null,
    fineAmountVnd: input.fineAmountVnd ?? null,
    releasedAt: new Date()
  });
}

/** Test helper — replace ledger contents. */
export async function __setDutyCancellationLedgerForTests(records: CleaningDutyCancellationRecord[]) {
  return enqueueWrite(async () => {
    const byTaskId: Record<string, CleaningDutyCancellationRecord> = {};
    for (const record of records) {
      byTaskId[record.taskId] = record;
    }
    await writeLedger({ version: 1, byTaskId });
  });
}
