/**
 * Manager overdue-task dismissal: ASSIGNED → REJECTED for past-deadline duties only.
 * Intentionally separate from photo-audit rejection (DONE_PENDING_AUDIT / APPROVED).
 */

import { withDbAdvisoryLock } from "./db-advisory-lock.js";

export const DISMISSED_OVERDUE_TASK_NOTE_PREFIX = "[Dismissed overdue task]";

export type OverdueDismissOutcome = "dismissed" | "alreadyDismissed";

export type OverdueDismissTaskLike = {
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

export type DismissOverdueAssignedTaskDeps = {
  taskId: string;
  reviewer: string;
  now: Date;
  withLock?: typeof withDbAdvisoryLock;
  findTask: (taskId: string) => Promise<OverdueDismissTaskLike | null>;
  isPastMissedFineDeadline: (task: OverdueDismissTaskLike, now: Date) => boolean;
  claimAssignedAsRejected: (input: {
    taskId: string;
    auditorNote: string;
  }) => Promise<{ count: number }>;
  createAudit: (input: {
    taskId: string;
    reviewer: string;
    note: string;
  }) => Promise<unknown>;
  logDismiss: (input: {
    task: OverdueDismissTaskLike;
    reviewer: string;
    note: string;
    outcome: OverdueDismissOutcome;
  }) => Promise<void>;
  syncCalendar: (task: OverdueDismissTaskLike, reviewer: string) => Promise<void>;
  invalidateOverview: (email: string) => Promise<void>;
};

export function isDismissedOverdueNote(note: string | null | undefined) {
  return Boolean(note?.includes(DISMISSED_OVERDUE_TASK_NOTE_PREFIX));
}

export function buildDismissedOverdueNote(reviewer: string, now: Date) {
  return `${DISMISSED_OVERDUE_TASK_NOTE_PREFIX} by ${reviewer} on ${now.toISOString()}`;
}

/**
 * Safe overdue dismiss. Does not reverse cleaning coins and does not open
 * normal audit rejection to arbitrary ASSIGNED tasks.
 */
export async function dismissOverdueAssignedTaskOnce(
  deps: DismissOverdueAssignedTaskDeps
): Promise<{
  outcome: OverdueDismissOutcome;
  task: OverdueDismissTaskLike;
}> {
  const withLock = deps.withLock ?? withDbAdvisoryLock;
  const reviewer = deps.reviewer.trim() || "System";

  return withLock(`cleaning-overdue-dismiss:${deps.taskId}`, async () => {
    const task = await deps.findTask(deps.taskId);
    if (!task) {
      throw new Error("Cleaning task not found");
    }

    if (task.status === "REJECTED" && isDismissedOverdueNote(task.auditorNote)) {
      await deps.syncCalendar(task, reviewer);
      await deps.invalidateOverview(task.userEmail);
      return { outcome: "alreadyDismissed" as const, task };
    }

    if (task.status !== "ASSIGNED") {
      throw new Error("Only assigned tasks can be dismissed.");
    }

    if (!deps.isPastMissedFineDeadline(task, deps.now)) {
      throw new Error("This task is not past the completion deadline yet.");
    }

    const note = buildDismissedOverdueNote(reviewer, deps.now);
    const claimed = await deps.claimAssignedAsRejected({
      taskId: task.id,
      auditorNote: note
    });

    if (claimed.count === 0) {
      const again = await deps.findTask(deps.taskId);
      if (again && again.status === "REJECTED" && isDismissedOverdueNote(again.auditorNote)) {
        await deps.syncCalendar(again, reviewer);
        await deps.invalidateOverview(again.userEmail);
        return { outcome: "alreadyDismissed" as const, task: again };
      }
      throw new Error("This task changed and can no longer be dismissed.");
    }

    const dismissedTask: OverdueDismissTaskLike = {
      ...task,
      status: "REJECTED",
      auditorNote: note
    };

    await deps.createAudit({
      taskId: task.id,
      reviewer,
      note
    });

    await deps.logDismiss({
      task: dismissedTask,
      reviewer,
      note,
      outcome: "dismissed"
    });

    await deps.syncCalendar(dismissedTask, reviewer);
    await deps.invalidateOverview(dismissedTask.userEmail);

    return { outcome: "dismissed" as const, task: dismissedTask };
  }, {
    busyMessage: "Overdue cleaning dismiss is busy; please retry"
  });
}
