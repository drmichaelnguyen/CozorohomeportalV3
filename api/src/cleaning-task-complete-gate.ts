import { CleaningTaskStatus } from "@prisma/client";

/** Status/ownership gate for completing a cleaning task. */
export function evaluateCleaningTaskCompletionGate(
  task: { status: CleaningTaskStatus; userEmail: string },
  email: string
): { ok: true; isRetry: boolean } | { ok: false; error: string } {
  const normalizedEmail = email.trim().toLowerCase();
  if (task.userEmail.toLowerCase() !== normalizedEmail) {
    return { ok: false, error: "You can only complete your own cleaning task" };
  }
  if (
    task.status === CleaningTaskStatus.APPROVED ||
    task.status === CleaningTaskStatus.REJECTED ||
    task.status === CleaningTaskStatus.MISSED
  ) {
    return {
      ok: false,
      error: "This cleaning task has already been reviewed and cannot be completed again."
    };
  }
  const isRetry = task.status === CleaningTaskStatus.DONE_PENDING_AUDIT;
  if (task.status !== CleaningTaskStatus.ASSIGNED && !isRetry) {
    return { ok: false, error: "This cleaning task cannot be completed in its current status." };
  }
  return { ok: true, isRetry };
}
