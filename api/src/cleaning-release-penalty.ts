/** Notice-based late-cancellation penalty tiers (10,000 VND full fine). */

export const CLEANING_FULL_FINE_AMOUNT = 10000;

function normalizeCalendarDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

export function getCalendarDayDiff(from: Date, to: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((normalizeCalendarDate(to).getTime() - normalizeCalendarDate(from).getTime()) / millisecondsPerDay);
}

/**
 * Penalty uses the preserved notice timestamp, not the commit/retry time.
 * Same-day / 1–4 / 5+ day boundaries are relative to noticeAt → duty date.
 */
export function computeCleaningReleasePenalty(taskDate: Date, noticeAt: Date = new Date()) {
  const daysUntilTask = getCalendarDayDiff(noticeAt, taskDate);

  if (daysUntilTask < 0) {
    return {
      canRelease: false,
      fineRate: 1,
      fineAmount: CLEANING_FULL_FINE_AMOUNT,
      message: "The assigned date has passed. No work is charged as a full fine."
    };
  }

  if (daysUntilTask === 0) {
    return {
      canRelease: true,
      fineRate: 0.75,
      fineAmount: Math.round(CLEANING_FULL_FINE_AMOUNT * 0.75),
      message: "Same-day notice applies a 75% fine."
    };
  }

  if (daysUntilTask <= 4) {
    return {
      canRelease: true,
      fineRate: 0.5,
      fineAmount: Math.round(CLEANING_FULL_FINE_AMOUNT * 0.5),
      message: "Notice 1 to 4 days ahead applies a 50% fine."
    };
  }

  return {
    canRelease: true,
    fineRate: 0,
    fineAmount: 0,
    message: "No fine is charged when you reschedule at least 5 days ahead."
  };
}
