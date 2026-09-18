/**
 * Idempotent missed-cleaning and monthly evasion fine issuance.
 * Critical section: MySQL advisory lock → SQL re-read → live sheet read → append-once → SQL mark.
 */

import {
  AUTO_CLEANING_FINE_DESCRIPTION_PREFIX,
  FINE_AMOUNT_COLUMN,
  FINE_CONTENT_COLUMN,
  FINE_DESCRIPTION_COLUMN,
  isAutomaticCleaningFineForTask,
  parseFineAmount
} from "./cleaning-missed-fine-amount.js";
import { withDbAdvisoryLock } from "./db-advisory-lock.js";

export type MissedFineIssueOutcome = "created" | "alreadyExists" | "skipped" | "skippedOld";

export type MissedFineIssueResult = {
  outcome: MissedFineIssueOutcome;
  fineAmount: number;
  taskId: string;
  userEmail: string;
  reason?: string;
};

export type EvasionFineIssueOutcome = "created" | "alreadyExists" | "skipped";

export type EvasionFineIssueResult = {
  outcome: EvasionFineIssueOutcome;
  email: string;
  month: string;
  reason?: string;
};

export function missedCleaningFineLockKey(spreadsheetId: string, taskId: string) {
  return `missed-cleaning-fine:${spreadsheetId}:${taskId}`;
}

export function cleaningEvasionFineLockKey(spreadsheetId: string, email: string, month: string) {
  return `cleaning-evasion-fine:${spreadsheetId}:${email.trim().toLowerCase()}:${month}`;
}

export function taskIdFineMarker(taskId: string) {
  return `Task ID: ${taskId}.`;
}

export function findMissedCleaningFineRow(
  rows: Array<Record<string, string>>,
  taskId: string
): Record<string, string> | undefined {
  return rows.find((row) => isAutomaticCleaningFineForTask(row, taskId));
}

export function isEvasionFineForUserMonth(
  row: Record<string, string>,
  email: string,
  month: string,
  content = "Cleaning duty evasion"
) {
  return (
    row.EMAIL?.trim().toLowerCase() === email.trim().toLowerCase() &&
    row[FINE_CONTENT_COLUMN] === content &&
    (row[FINE_DESCRIPTION_COLUMN] ?? "").includes(month)
  );
}

export function isOutsideMissedFineLookback(input: {
  missedFineDeadlineAt: Date;
  now: Date;
  lookbackDays: number;
}) {
  const lookbackMs = Math.max(0, Math.trunc(input.lookbackDays)) * 24 * 60 * 60 * 1000;
  return input.now.getTime() - input.missedFineDeadlineAt.getTime() > lookbackMs;
}

export type IssueMissedCleaningFineOnceDeps = {
  spreadsheetId: string;
  taskId: string;
  operatorLabel: string;
  now: Date;
  customAmount?: number;
  /** When set, tasks older than lookback are skipped without creating a fine. */
  lookbackDays?: number | null;
  getMissedFineDeadline: (task: CleaningTaskLike) => Date;
  withLock?: typeof withDbAdvisoryLock;
  findTask: (taskId: string) => Promise<CleaningTaskLike | null>;
  isCancelledOrExempt: (taskId: string) => Promise<boolean>;
  readFinesSheetRows: () => Promise<Array<Record<string, string>>>;
  computeFineAmount: (
    task: CleaningTaskLike,
    sheetRows: Array<Record<string, string>>
  ) => Promise<number>;
  buildFineContent: (task: CleaningTaskLike) => string;
  buildFineDescription: (task: CleaningTaskLike, now: Date) => string;
  buildFineLocation: (task: CleaningTaskLike) => string;
  createFine: (input: {
    email: string;
    amount: number;
    content: string;
    description: string;
    location: string;
    operator: string;
  }) => Promise<unknown>;
  markTaskMissed: (input: {
    taskId: string;
    fineAmount: number;
    operatorLabel: string;
    now: Date;
  }) => Promise<CleaningTaskLike>;
  logOutcome: (input: {
    outcome: MissedFineIssueOutcome;
    task: CleaningTaskLike;
    fineAmount: number;
    operatorLabel: string;
    reason?: string;
  }) => Promise<void>;
};

export type CleaningTaskLike = {
  id: string;
  userEmail: string;
  userName?: string | null;
  status: string;
  type: string;
  branchId: string;
  floor?: number | null;
  scheduledDate: Date;
  rewardCoins?: number;
  calendarId?: string | null;
  calendarEventId?: string | null;
  completedAt?: Date | null;
  completionNote?: string | null;
  completionPhoto?: string | null;
  auditorNote?: string | null;
};

const ASSIGNED = "ASSIGNED";

/**
 * Durable idempotent missed-fine issuance. Safe under concurrent API processes
 * and after "sheet append succeeded / SQL update failed" retries.
 */
export async function issueMissedCleaningFineOnce(
  deps: IssueMissedCleaningFineOnceDeps
): Promise<MissedFineIssueResult> {
  const withLock = deps.withLock ?? withDbAdvisoryLock;
  const lockKey = missedCleaningFineLockKey(deps.spreadsheetId || "local", deps.taskId);

  return withLock(lockKey, async () => {
    const task = await deps.findTask(deps.taskId);
    if (!task) {
      return {
        outcome: "skipped" as const,
        fineAmount: 0,
        taskId: deps.taskId,
        userEmail: "",
        reason: "not_found"
      };
    }

    if (task.status !== ASSIGNED) {
      const sheetRows = await deps.readFinesSheetRows();
      const existing = findMissedCleaningFineRow(sheetRows, task.id);
      if (existing) {
        const fineAmount = parseFineAmount(existing[FINE_AMOUNT_COLUMN]);
        await deps.logOutcome({
          outcome: "alreadyExists",
          task,
          fineAmount,
          operatorLabel: deps.operatorLabel,
          reason: `status=${task.status}`
        });
        return {
          outcome: "alreadyExists",
          fineAmount,
          taskId: task.id,
          userEmail: task.userEmail,
          reason: `status=${task.status}`
        };
      }
      await deps.logOutcome({
        outcome: "skipped",
        task,
        fineAmount: 0,
        operatorLabel: deps.operatorLabel,
        reason: `status=${task.status}`
      });
      return {
        outcome: "skipped",
        fineAmount: 0,
        taskId: task.id,
        userEmail: task.userEmail,
        reason: `status=${task.status}`
      };
    }

    if (await deps.isCancelledOrExempt(task.id)) {
      await deps.logOutcome({
        outcome: "skipped",
        task,
        fineAmount: 0,
        operatorLabel: deps.operatorLabel,
        reason: "cancelled_or_exempt"
      });
      return {
        outcome: "skipped",
        fineAmount: 0,
        taskId: task.id,
        userEmail: task.userEmail,
        reason: "cancelled_or_exempt"
      };
    }

    if (deps.lookbackDays != null && Number.isFinite(deps.lookbackDays)) {
      const deadline = deps.getMissedFineDeadline(task);
      if (isOutsideMissedFineLookback({ missedFineDeadlineAt: deadline, now: deps.now, lookbackDays: deps.lookbackDays })) {
        await deps.logOutcome({
          outcome: "skippedOld",
          task,
          fineAmount: 0,
          operatorLabel: deps.operatorLabel,
          reason: `lookbackDays=${deps.lookbackDays}`
        });
        return {
          outcome: "skippedOld",
          fineAmount: 0,
          taskId: task.id,
          userEmail: task.userEmail,
          reason: "review_required_outside_lookback"
        };
      }
    }

    const sheetRows = await deps.readFinesSheetRows();
    const existing = findMissedCleaningFineRow(sheetRows, task.id);
    let fineAmount: number;
    let outcome: MissedFineIssueOutcome;

    if (existing) {
      fineAmount = parseFineAmount(existing[FINE_AMOUNT_COLUMN]);
      outcome = "alreadyExists";
    } else {
      fineAmount =
        deps.customAmount != null
          ? deps.customAmount
          : await deps.computeFineAmount(task, sheetRows);
      const content = deps.buildFineContent(task);
      const description = deps.buildFineDescription(task, deps.now);
      // Ensure stable Task ID marker is always present for idempotency recovery.
      const descriptionWithMarker = description.includes(taskIdFineMarker(task.id))
        ? description
        : `${description} ${taskIdFineMarker(task.id)}`.trim();
      if (!descriptionWithMarker.includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX)) {
        throw new Error("Missed cleaning fine description missing auto-generated prefix.");
      }
      await deps.createFine({
        email: task.userEmail,
        amount: fineAmount,
        content,
        description: descriptionWithMarker,
        location: deps.buildFineLocation(task),
        operator: deps.operatorLabel
      });
      outcome = "created";
    }

    await deps.markTaskMissed({
      taskId: task.id,
      fineAmount,
      operatorLabel: deps.operatorLabel,
      now: deps.now
    });

    await deps.logOutcome({
      outcome,
      task,
      fineAmount,
      operatorLabel: deps.operatorLabel
    });

    return {
      outcome,
      fineAmount,
      taskId: task.id,
      userEmail: task.userEmail
    };
  }, {
    busyMessage: "Missed cleaning fine is busy; please retry"
  });
}

export type IssueEvasionFineOnceDeps = {
  spreadsheetId: string;
  email: string;
  month: string;
  amount: number;
  content: string;
  description: string;
  location: string;
  operator: string;
  withLock?: typeof withDbAdvisoryLock;
  readFinesSheetRows: () => Promise<Array<Record<string, string>>>;
  createFine: (input: {
    email: string;
    amount: number;
    content: string;
    description: string;
    location: string;
    operator: string;
  }) => Promise<unknown>;
  logOutcome: (input: {
    outcome: EvasionFineIssueOutcome;
    email: string;
    month: string;
    reason?: string;
  }) => Promise<void>;
};

export async function issueCleaningEvasionFineOnce(
  deps: IssueEvasionFineOnceDeps
): Promise<EvasionFineIssueResult> {
  const withLock = deps.withLock ?? withDbAdvisoryLock;
  const normalizedEmail = deps.email.trim().toLowerCase();
  const lockKey = cleaningEvasionFineLockKey(deps.spreadsheetId || "local", normalizedEmail, deps.month);

  return withLock(lockKey, async () => {
    const rows = await deps.readFinesSheetRows();
    if (rows.some((row) => isEvasionFineForUserMonth(row, normalizedEmail, deps.month, deps.content))) {
      await deps.logOutcome({
        outcome: "alreadyExists",
        email: normalizedEmail,
        month: deps.month
      });
      return { outcome: "alreadyExists", email: normalizedEmail, month: deps.month };
    }

    await deps.createFine({
      email: normalizedEmail,
      amount: deps.amount,
      content: deps.content,
      description: deps.description,
      location: deps.location,
      operator: deps.operator
    });

    await deps.logOutcome({
      outcome: "created",
      email: normalizedEmail,
      month: deps.month
    });

    return { outcome: "created", email: normalizedEmail, month: deps.month };
  }, {
    busyMessage: "Cleaning evasion fine is busy; please retry"
  });
}

/** In-process mutex that mirrors cross-process serialization for unit tests. */
export function createInProcessAdvisoryLock() {
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
      if (tails.get(key) === next) {
        tails.delete(key);
      }
    }
  };
}
