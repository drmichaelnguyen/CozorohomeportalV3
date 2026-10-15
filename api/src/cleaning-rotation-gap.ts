/**
 * Pure rotation-gap / duty-day math for cleaning auto-assignment.
 * Dates are Vietnam calendar labels (`YYYY-MM-DD`) or UTC-noon instants produced by
 * `normalizeCalendarDate` / `addDays` in cleaning.ts. This module only reads UTC
 * date parts so host-local getters cannot shift the cadence.
 */

export const MIN_CLEANING_ROTATION_GAP_DAYS = 1;
export const MAX_CLEANING_ROTATION_GAP_DAYS = 7;
export const DEFAULT_CLEANING_ROTATION_GAP_DAYS = 1;
export const DEFAULT_AUTO_GAP_TARGET_DUTIES = 6;
export const MIN_AUTO_GAP_TARGET_DUTIES = 1;
export const MAX_AUTO_GAP_TARGET_DUTIES = 30;

export type CleaningRotationTaskType = "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";

export type CleaningAutoGapConfig = {
  enabled: boolean;
  targetMaxDutiesPerResidentPer30Days: number;
};

export const DEFAULT_CLEANING_AUTO_GAP: CleaningAutoGapConfig = {
  enabled: false,
  targetMaxDutiesPerResidentPer30Days: DEFAULT_AUTO_GAP_TARGET_DUTIES
};

export type CleaningRotationJob = {
  type: CleaningRotationTaskType;
  floor?: number | null;
};

export type CleaningRotationTask = {
  date: Date | string;
  type: CleaningRotationTaskType;
  floor?: number | null;
  /**
   * Cancelled / removed tasks are absent from the cadence. Callers omit them or
   * set this to false. Every other status, including MISSED, occupies the gap.
   */
  occupiesCadence?: boolean;
};

export type CleaningCadencePlan = {
  dutyDates: string[];
  restDates: string[];
};

export function clampRotationGapDays(value: unknown, fallback = DEFAULT_CLEANING_ROTATION_GAP_DAYS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(MIN_CLEANING_ROTATION_GAP_DAYS, Math.min(MAX_CLEANING_ROTATION_GAP_DAYS, Math.trunc(numeric)));
}

export function clampAutoGapTarget(value: unknown, fallback = DEFAULT_AUTO_GAP_TARGET_DUTIES) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(MIN_AUTO_GAP_TARGET_DUTIES, Math.min(MAX_AUTO_GAP_TARGET_DUTIES, Math.trunc(numeric)));
}

export function normalizeCleaningAutoGap(value: unknown, fallback: CleaningAutoGapConfig = DEFAULT_CLEANING_AUTO_GAP): CleaningAutoGapConfig {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Partial<CleaningAutoGapConfig>;
  return {
    enabled: record.enabled === true,
    targetMaxDutiesPerResidentPer30Days: clampAutoGapTarget(
      record.targetMaxDutiesPerResidentPer30Days,
      fallback.targetMaxDutiesPerResidentPer30Days
    )
  };
}

export function estimateDutiesPerResidentPer30Days(effectiveGap: number, eligibleCount: number) {
  if (eligibleCount <= 0 || effectiveGap <= 0) {
    return null;
  }
  return Math.round((30 / effectiveGap / eligibleCount) * 10) / 10;
}

export type RotationGapDecision = {
  effectiveGap: number;
  skip: boolean;
  estimatedDutiesPerResidentPer30Days: number | null;
};

/**
 * `effectiveGap = clamp(ceil(30 / (eligibleCount * target)), rotationGapDays, 7)`.
 * Auto gap never schedules tighter than the manual gap and never looser than 7.
 * Zero eligible residents skips the job for that run.
 */
export function computeEffectiveRotationGap(input: {
  rotationGapDays: number;
  autoGapEnabled: boolean;
  targetMaxDutiesPerResidentPer30Days: number;
  eligibleCount: number;
}): RotationGapDecision {
  const manual = clampRotationGapDays(input.rotationGapDays);
  if (!input.autoGapEnabled) {
    return {
      effectiveGap: manual,
      skip: false,
      estimatedDutiesPerResidentPer30Days: estimateDutiesPerResidentPer30Days(manual, input.eligibleCount)
    };
  }
  if (input.eligibleCount <= 0) {
    return {
      effectiveGap: manual,
      skip: true,
      estimatedDutiesPerResidentPer30Days: null
    };
  }
  const target = clampAutoGapTarget(input.targetMaxDutiesPerResidentPer30Days);
  const raw = Math.ceil(30 / (input.eligibleCount * target));
  const effectiveGap = Math.min(MAX_CLEANING_ROTATION_GAP_DAYS, Math.max(manual, raw));
  return {
    effectiveGap,
    skip: false,
    estimatedDutiesPerResidentPer30Days: estimateDutiesPerResidentPer30Days(effectiveGap, input.eligibleCount)
  };
}

/** UTC calendar label. Date inputs must already be UTC-noon calendar instants. */
export function cleaningRotationDateKey(value: Date | string) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      throw new Error(`Invalid cleaning calendar date: ${value}`);
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Invalid cleaning calendar date");
  }
  const year = String(value.getUTCFullYear());
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftCleaningRotationDate(value: Date | string, days: number) {
  const key = cleaningRotationDateKey(value);
  const [year, month, day] = key.split("-").map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return cleaningRotationDateKey(shifted);
}

export function cleaningRotationDayDiff(from: Date | string, to: Date | string) {
  const start = Date.parse(`${cleaningRotationDateKey(from)}T12:00:00.000Z`);
  const end = Date.parse(`${cleaningRotationDateKey(to)}T12:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function taskMatchesJob(task: CleaningRotationTask, job: CleaningRotationJob) {
  if (task.type !== job.type) {
    return false;
  }
  if (job.type === "TRASH_D7") {
    return (task.floor ?? null) === (job.floor ?? null);
  }
  return true;
}

/**
 * Walk `horizonStart` for `horizonDays` days.
 * A date is a duty day when no occupying task (and no duty day already planned
 * in this walk) sits within `effectiveGap - 1` days before or after it.
 * Existing tasks of any source re-anchor the cadence, including ones placed on
 * what would have been a rest day. Gap 1 leaves every empty day as a duty day.
 */
export function getCleaningCadencePlan(input: {
  job: CleaningRotationJob;
  horizonStart: Date | string;
  horizonDays: number;
  effectiveGap: number;
  existingTasks: CleaningRotationTask[];
}): CleaningCadencePlan {
  const gap = clampRotationGapDays(input.effectiveGap);
  const radius = gap - 1;
  const horizonDays = Math.max(0, Math.trunc(input.horizonDays) || 0);
  const horizonStart = cleaningRotationDateKey(input.horizonStart);
  const occupied = new Set<string>();
  for (const task of input.existingTasks) {
    if (task.occupiesCadence === false || !taskMatchesJob(task, input.job)) {
      continue;
    }
    occupied.add(cleaningRotationDateKey(task.date));
  }

  const anchors = new Set(occupied);
  const dutyDates: string[] = [];
  const restDates: string[] = [];

  for (let index = 0; index < horizonDays; index += 1) {
    const date = shiftCleaningRotationDate(horizonStart, index);
    if (occupied.has(date)) {
      continue;
    }
    let blocked = false;
    if (radius > 0) {
      for (const anchor of anchors) {
        const distance = Math.abs(cleaningRotationDayDiff(date, anchor));
        if (distance > 0 && distance <= radius) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      restDates.push(date);
      continue;
    }
    dutyDates.push(date);
    anchors.add(date);
  }

  return { dutyDates, restDates };
}

export function getCleaningDutyDays(input: Parameters<typeof getCleaningCadencePlan>[0]) {
  return getCleaningCadencePlan(input).dutyDates;
}

export function getCleaningRestDays(input: Parameters<typeof getCleaningCadencePlan>[0]) {
  return getCleaningCadencePlan(input).restDates;
}

/**
 * True when `date` is a rest day inside the cadence that starts at `horizonStart`
 * (default: `date` itself). Duty days and dates that already have a task are not rest days.
 */
export function isCleaningRestDay(
  job: CleaningRotationJob,
  date: Date | string,
  existingTasks: CleaningRotationTask[],
  effectiveGap: number,
  horizonStart?: Date | string
) {
  const dateKey = cleaningRotationDateKey(date);
  const startKey = cleaningRotationDateKey(horizonStart ?? date);
  const span = cleaningRotationDayDiff(startKey, dateKey);
  if (span < 0) {
    return false;
  }
  const restDates = getCleaningRestDays({
    job,
    horizonStart: startKey,
    horizonDays: span + 1,
    effectiveGap,
    existingTasks
  });
  return restDates.includes(dateKey);
}
