import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CleaningAssignmentSource,
  CleaningAuditDecision,
  CleaningAvailabilityType,
  CleaningScheduleCorrectionAction,
  CleaningSwapRequestStatus,
  CleaningTaskStatus,
  CleaningTaskType,
  CoinReason,
  Prisma
} from "@prisma/client";

import {
  CONTRACT_CODE_COLUMN,
  ClientRow,
  CleaningCalendarEvent,
  awardCleaningCoinsToSheet,
  createAutomaticFineForEmail,
  deleteCleaningCalendarEvent,
  getConfiguredCleaningCalendars,
  createCleaningCalendarEvent,
  getCleaningCalendarTarget,
  getActiveClientByEmail,
  getManagerFines,
  listCleaningCalendarEvents,
  readCachedClients,
  syncClientsFromSheet,
  transferSwapCoins,
  updateCleaningCalendarEvent
} from "./google-sheets.js";
import { isBranchAutomationDisabled, isCleaningTaskAutomationDisabled } from "./branch-closure.js";
import { logAction } from "./action-log.js";
import {
  type CorrectionPayload,
  inferCorrectionAction,
  recordCleaningScheduleCorrection
} from "./cleaning-schedule-corrections.js";
import {
  SELF_ASSIGN_MAX_DAYS_AHEAD,
  computeCleaningRewardCoins,
  getCleaningRewardSettings
} from "./cleaning-reward-settings.js";
import { hasCompletedCheckout, listCheckedOutEmails } from "./checkout.js";
import { listVietnamHolidays } from "./vietnam-holidays.js";
import { prisma } from "./prisma.js";

type ActiveCleaningUser = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  floor: number | null;
  source: ClientRow;
};

type CleaningTaskRecord = Prisma.CleaningTaskGetPayload<Record<string, never>>;
type CleaningTaskDelegate = Pick<
  typeof prisma.cleaningTask,
  "findMany" | "findFirst" | "findUnique" | "create" | "update" | "delete"
>;
type CleaningOverviewPayload = Awaited<ReturnType<typeof buildCleaningOverviewForUser>>;
type CleaningOverviewCache = {
  syncedAt: string;
  entries: Record<string, CleaningOverviewPayload>;
};
type GenerateCleaningScheduleResult = {
  imported: CleaningTaskRecord[];
  created: CleaningTaskRecord[];
};
type ContractCleaningOptOutSummary = {
  contractCode: string;
  cleaningFeeVnd: number;
  startDate: string | null;
  endDate: string | null;
};
type CleaningAvailableUser = {
  email: string;
  name: string;
  /** Branch, bed #, room zone, floor — for manager UI without exposing email. */
  bedDisplay: string;
  branchId: "D2" | "D7";
  floor: number | null;
  availabilityType: CleaningAvailabilityType | null;
  availabilityCount: number;
  totalTaskCount: number;
  /** Non-missed tasks of this slot's type in the fairness window (display + shared rank). */
  recentTypeTaskCount: number;
  /** Soft demotion from recent manager corrections that removed this person from a slot. */
  correctionPenalty: number;
  hasSameDayTask: boolean;
  sameDayTasks: Array<{
    id: string;
    type: CleaningTaskType;
    scheduledDate: Date;
  }>;
};

/** Fairness lookback for auto-assign / manager ranking (days). */
const CLEANING_FAIRNESS_LOOKBACK_DAYS = 60;
/** Soft demotion window for manager correction feedback (days). */
const CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS = 60;

const CONTRACT_CLEANING_FEE_VND = 100000;

class CleaningAssignmentConflictError extends Error {
  conflicts: Array<{
    id: string;
    type: CleaningTaskType;
    scheduledDate: Date;
  }>;

  constructor(conflicts: Array<{ id: string; type: CleaningTaskType; scheduledDate: Date }>) {
    super("This user already has another cleaning task on that date");
    this.name = "CleaningAssignmentConflictError";
    this.conflicts = conflicts;
  }
}

class CleaningSelfAssignConflictError extends Error {
  suggestions: string[];

  constructor(suggestions: string[]) {
    super("This task is already assigned on that date");
    this.name = "CleaningSelfAssignConflictError";
    this.suggestions = suggestions;
  }
}

export type SelfAssignCheckResult = {
  canSubmit: boolean;
  reason?: string;
  suggestions?: string[];
};

const cacheDirPath = path.join(process.cwd(), "data");
const cleaningOverviewCacheFilePath = path.join(cacheDirPath, "cleaning-overview-cache.json");
const cleaningOverviewMemoryCache = new Map<string, CleaningOverviewPayload>();
const CLEANING_TASK_LEGACY_ASSIGNER_OMIT = {
  assignedByEmail: true,
  assignedByName: true
} as const;
let cleaningTaskAssignerColumnsMissing = false;
let cleaningTaskAssignerFieldsUnsupported = false;

const CLEANING_FULL_FINE_AMOUNT = 10000;
const AUTO_CLEANING_FINE_OPERATOR = "System";
const AUTO_CLEANING_FINE_DESCRIPTION_PREFIX = "Auto-generated for missed cleaning task.";
const FINE_CONTENT_COLUMN = "N\u1ed8I DUNG VI PH\u1ea0M";
const FINE_DESCRIPTION_COLUMN = "M\u00d4 T\u1ea2 VI PH\u1ea0M";
const FINE_AMOUNT_COLUMN = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
const FINE_TIMESTAMP_COLUMN = "D\u1ea4U TH\u1edcI GIAN";

/**
 * In-process guard that prevents two concurrent calls from creating a task
 * for the same (type, date, floor) slot. Key format: `type|YYYY-MM-DD|floor`.
 */
const slotCreationInFlight = new Set<string>();

function getSlotCreationKey(type: CleaningTaskType, date: Date, floor?: number | null) {
  const d = normalizeCalendarDate(date);
  return `${type}|${d.toISOString().slice(0, 10)}|${floor ?? ""}`;
}

const dailyTaskConfigs: Array<{
  type: CleaningTaskType;
  branchId: "D2" | "D7";
  title: string;
}> = [
  { type: CleaningTaskType.KITCHEN_D2, branchId: "D2", title: "Vệ sinh bếp D2" },
  { type: CleaningTaskType.TRASH_D7, branchId: "D7", title: "Đổ rác D7" },
  { type: CleaningTaskType.KITCHEN_D7, branchId: "D7", title: "Vệ sinh bếp D7" }
];

function isCleaningTaskAssignerColumnMissingError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2022") {
    return false;
  }

  const column = String(error.meta?.column ?? "");
  return (
    column.includes("CleaningTask.assignedByEmail") ||
    column.includes("CleaningTask.assignedByName")
  );
}

function isCleaningTaskAssignerUnsupportedError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientValidationError)) {
    return false;
  }

  const message = error.message;
  const referencesCleaningTask =
    message.includes("model `CleaningTask`") || message.includes("model \"CleaningTask\"");
  const referencesAssignerField =
    message.includes("assignedByEmail") || message.includes("assignedByName");

  return referencesCleaningTask && referencesAssignerField;
}

function withLegacyCleaningTaskAssignerOmit<T extends { omit?: object | null }>(args: T): T {
  return {
    ...args,
    omit: {
      ...(args.omit ?? {}),
      ...CLEANING_TASK_LEGACY_ASSIGNER_OMIT
    }
  };
}

function stripLegacyCleaningTaskAssignerFields<T extends { data: Record<string, unknown> }>(args: T): T {
  const { assignedByEmail: _assignedByEmail, assignedByName: _assignedByName, ...data } = args.data;
  void _assignedByEmail;
  void _assignedByName;
  return {
    ...args,
    data
  };
}

function addLegacyCleaningTaskAssignerFields<T>(result: T): T {
  if (Array.isArray(result)) {
    return result.map((entry) => addLegacyCleaningTaskAssignerFields(entry)) as T;
  }

  if (result && typeof result === "object") {
    return {
      assignedByEmail: null,
      assignedByName: null,
      ...(result as Record<string, unknown>)
    } as T;
  }

  return result;
}

async function findManyCleaningTasks<T extends Prisma.CleaningTaskFindManyArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findMany(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindManyArgs)
    ) as Prisma.CleaningTaskGetPayload<T>[];
  }

  try {
    return (await delegate.findMany(args)) as Prisma.CleaningTaskGetPayload<T>[];
  } catch (error) {
    if (!isCleaningTaskAssignerColumnMissingError(error)) {
      throw error;
    }

    cleaningTaskAssignerColumnsMissing = true;
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findMany(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindManyArgs)
    ) as Prisma.CleaningTaskGetPayload<T>[];
  }
}

async function findFirstCleaningTask<T extends Prisma.CleaningTaskFindFirstArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findFirst(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindFirstArgs)
    ) as Prisma.CleaningTaskGetPayload<T> | null;
  }

  try {
    return (await delegate.findFirst(args)) as Prisma.CleaningTaskGetPayload<T> | null;
  } catch (error) {
    if (!isCleaningTaskAssignerColumnMissingError(error)) {
      throw error;
    }

    cleaningTaskAssignerColumnsMissing = true;
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findFirst(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindFirstArgs)
    ) as Prisma.CleaningTaskGetPayload<T> | null;
  }
}

async function findUniqueCleaningTask<T extends Prisma.CleaningTaskFindUniqueArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findUnique(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindUniqueArgs)
    ) as Prisma.CleaningTaskGetPayload<T> | null;
  }

  try {
    return (await delegate.findUnique(args)) as Prisma.CleaningTaskGetPayload<T> | null;
  } catch (error) {
    if (!isCleaningTaskAssignerColumnMissingError(error)) {
      throw error;
    }

    cleaningTaskAssignerColumnsMissing = true;
    return addLegacyCleaningTaskAssignerFields(
      await delegate.findUnique(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskFindUniqueArgs)
    ) as Prisma.CleaningTaskGetPayload<T> | null;
  }
}

async function createCleaningTask<T extends Prisma.CleaningTaskCreateArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing || cleaningTaskAssignerFieldsUnsupported) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.create(
        stripLegacyCleaningTaskAssignerFields(
          args as T & { data: Record<string, unknown> }
        ) as Prisma.CleaningTaskCreateArgs
      )
    ) as Prisma.CleaningTaskGetPayload<T>;
  }

  try {
    return (await delegate.create(args)) as Prisma.CleaningTaskGetPayload<T>;
  } catch (error) {
    // DB unique constraint on slotKey: another process already created this slot.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target ?? "").includes("slotKey")
    ) {
      throw new Error("That cleaning slot was already assigned by another process. Please refresh.");
    }
    if (isCleaningTaskAssignerColumnMissingError(error)) {
      cleaningTaskAssignerColumnsMissing = true;
    } else if (isCleaningTaskAssignerUnsupportedError(error)) {
      cleaningTaskAssignerFieldsUnsupported = true;
    } else {
      throw error;
    }

    return addLegacyCleaningTaskAssignerFields(
      await delegate.create(
        stripLegacyCleaningTaskAssignerFields(
          args as T & { data: Record<string, unknown> }
        ) as Prisma.CleaningTaskCreateArgs
      )
    ) as Prisma.CleaningTaskGetPayload<T>;
  }
}

async function updateCleaningTask<T extends Prisma.CleaningTaskUpdateArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing || cleaningTaskAssignerFieldsUnsupported) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.update(
        stripLegacyCleaningTaskAssignerFields(
          args as T & { data: Record<string, unknown> }
        ) as Prisma.CleaningTaskUpdateArgs
      )
    ) as Prisma.CleaningTaskGetPayload<T>;
  }

  try {
    return (await delegate.update(args)) as Prisma.CleaningTaskGetPayload<T>;
  } catch (error) {
    if (isCleaningTaskAssignerColumnMissingError(error)) {
      cleaningTaskAssignerColumnsMissing = true;
    } else if (isCleaningTaskAssignerUnsupportedError(error)) {
      cleaningTaskAssignerFieldsUnsupported = true;
    } else {
      throw error;
    }

    return addLegacyCleaningTaskAssignerFields(
      await delegate.update(
        stripLegacyCleaningTaskAssignerFields(
          args as T & { data: Record<string, unknown> }
        ) as Prisma.CleaningTaskUpdateArgs
      )
    ) as Prisma.CleaningTaskGetPayload<T>;
  }
}

async function deleteCleaningTask<T extends Prisma.CleaningTaskDeleteArgs>(
  args: T,
  delegate: CleaningTaskDelegate = prisma.cleaningTask
) {
  if (cleaningTaskAssignerColumnsMissing) {
    return addLegacyCleaningTaskAssignerFields(
      await delegate.delete(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskDeleteArgs)
    ) as Prisma.CleaningTaskGetPayload<T>;
  }

  try {
    return (await delegate.delete(args)) as Prisma.CleaningTaskGetPayload<T>;
  } catch (error) {
    if (!isCleaningTaskAssignerColumnMissingError(error)) {
      throw error;
    }

    cleaningTaskAssignerColumnsMissing = true;
    return addLegacyCleaningTaskAssignerFields(
      await delegate.delete(withLegacyCleaningTaskAssignerOmit(args) as Prisma.CleaningTaskDeleteArgs)
    ) as Prisma.CleaningTaskGetPayload<T>;
  }
}

function normalizeBranch(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "2" || normalized === "D2") {
    return "D2" as const;
  }
  if (normalized === "7" || normalized === "D7") {
    return "D7" as const;
  }
  return null;
}

function inferFloorFromBed(bedValue: string) {
  const numeric = Number.parseInt(bedValue, 10);
  if (Number.isNaN(numeric) || numeric <= 0) {
    return null;
  }

  if (numeric <= 24) {
    return 1;
  }
  if (numeric <= 48) {
    return 2;
  }
  return 3;
}

function parseBedNumberForLabel(value: string | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Room / zone label from bed index (same rules as group-support). */
function deriveRoomLabelFromBed(branchId: "D2" | "D7", bedValue: string | undefined) {
  const bed = parseBedNumberForLabel(bedValue);
  if (!bed || bed <= 0) {
    return "";
  }

  if (branchId === "D2") {
    if (bed >= 1 && bed <= 9) return "1";
    if (bed >= 10 && bed <= 15) return "2";
    if (bed >= 16 && bed <= 21) return "3";
    return "";
  }

  if (bed >= 1 && bed <= 9) return "1.1";
  if (bed >= 10 && bed <= 15) return "1.2";
  if (bed >= 16 && bed <= 24) return "1.3";
  if (bed >= 25 && bed <= 33) return "2.1";
  if (bed >= 34 && bed <= 39) return "2.2";
  if (bed >= 40 && bed <= 48) return "2.3";
  if (bed >= 49 && bed <= 57) return "3.1";
  if (bed >= 58 && bed <= 63) return "3.2";
  return "";
}

/** Compact bed line for manager admin cleaning pickers (no email). */
function formatCleaningUserBedLine(user: ActiveCleaningUser): string {
  const bedRaw = (user.source["số giường"] ?? "").trim();
  const bedPart = bedRaw ? `Bed ${bedRaw}` : "Bed —";
  const room = deriveRoomLabelFromBed(user.branchId, user.source["số giường"]);
  const roomPart = room ? `Rm ${room}` : "";
  const floorPart = user.floor != null ? `Fl ${user.floor}` : "";
  return [user.branchId, bedPart, roomPart, floorPart].filter(Boolean).join(" · ");
}

function normalizeCalendarDate(value: Date | string) {
  if (typeof value === "string") {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, yearValue, monthValue, dayValue] = dateOnlyMatch;
      return new Date(Date.UTC(Number.parseInt(yearValue, 10), Number.parseInt(monthValue, 10) - 1, Number.parseInt(dayValue, 10), 12, 0, 0, 0));
    }
    return normalizeCalendarDate(new Date(value));
  }

  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0));
}

function calendarRangeStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function calendarRangeEnd(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12, 0, 0, 0));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), 12, 0, 0, 0));
}

function isFutureCalendarDate(date: Date) {
  return normalizeCalendarDate(date).getTime() > normalizeCalendarDate(new Date()).getTime();
}

function canReleaseCalendarDate(date: Date) {
  const today = normalizeCalendarDate(new Date());
  const normalized = normalizeCalendarDate(date);
  return normalized.getTime() >= today.getTime();
}

function getCalendarDayDiff(from: Date, to: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((normalizeCalendarDate(to).getTime() - normalizeCalendarDate(from).getTime()) / millisecondsPerDay);
}

function getCleaningReleasePenalty(date: Date) {
  const daysUntilTask = getCalendarDayDiff(new Date(), date);

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

function formatTaskTypeForFine(type: CleaningTaskType) {
  if (type === CleaningTaskType.KITCHEN_D2) {
    return "kitchen cleaning D2";
  }
  if (type === CleaningTaskType.KITCHEN_D7) {
    return "kitchen cleaning D7";
  }
  return "trash duty D7";
}

function formatTaskDateForFine(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

function parseFineAmount(value: string | undefined) {
  const numeric = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isSameMonth(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();
}

function getAutomaticCleaningFineContent(type: CleaningTaskType) {
  if (type === CleaningTaskType.TRASH_D7) {
    return "Kh\u00f4ng \u0111\u1ed5 r\u00e1c theo l\u1ecbch \u0111\u00e3 ph\u00e2n c\u00f4ng";
  }

  return "Kh\u00f4ng v\u1ec7 sinh theo l\u1ecbch \u0111\u00e3 ph\u00e2n c\u00f4ng";
}

function getAutomaticCleaningFineDescription(task: CleaningTaskRecord, now: Date) {
  const completionWindow = getCompletionWindow(task);
  const location =
    task.type === CleaningTaskType.TRASH_D7 && task.floor
      ? `${task.branchId} floor ${task.floor}`
      : task.branchId;

  return [
    AUTO_CLEANING_FINE_DESCRIPTION_PREFIX,
    `Task ID: ${task.id}.`,
    `The resident did not mark ${formatTaskTypeForFine(task.type)} complete on ${formatTaskDateForFine(task.scheduledDate)}.`,
    `Completion window ended at ${completionWindow.windowEnd.toISOString()}.`,
    `Sweep time: ${now.toISOString()}.`,
    `Location: ${location}.`
  ].join(" ");
}

function isAutomaticCleaningFineForTask(row: Record<string, string>, taskId: string) {
  const description = row[FINE_DESCRIPTION_COLUMN] ?? "";
  return description.includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX) && description.includes(`Task ID: ${taskId}.`);
}

function isAutomaticCleaningFineRow(row: Record<string, string>) {
  return (row[FINE_DESCRIPTION_COLUMN] ?? "").includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX);
}

async function getMissedCleaningFineAmount(
  task: CleaningTaskRecord,
  allFines: Awaited<ReturnType<typeof getManagerFines>>
) {
  const normalizedEmail = task.userEmail.trim().toLowerCase();
  const taskContent = getAutomaticCleaningFineContent(task.type);
  const taskDate = normalizeCalendarDate(task.scheduledDate);

  const userAutomaticCleaningFines = allFines.filter(
    (entry) => (entry.row.EMAIL ?? "").trim().toLowerCase() === normalizedEmail && isAutomaticCleaningFineRow(entry.row)
  );
  const sameErrorThisMonth = userAutomaticCleaningFines
    .filter((entry) => (entry.row[FINE_CONTENT_COLUMN] ?? "").trim() === taskContent)
    .filter((entry) => {
      if (!entry.parsedTimestamp) {
        return false;
      }

      const parsedTimestamp = new Date(entry.parsedTimestamp);
      return !Number.isNaN(parsedTimestamp.getTime()) && isSameMonth(parsedTimestamp, taskDate);
    })
    .sort((left, right) => (left.parsedTimestamp ?? "").localeCompare(right.parsedTimestamp ?? ""));

  const baseAmount = userAutomaticCleaningFines.length === 0 ? 15000 : 30000;

  if (sameErrorThisMonth.length === 0) {
    return baseAmount;
  }

  if (sameErrorThisMonth.length === 1) {
    return Math.round(baseAmount * 1.5);
  }

  const latestAmount = parseFineAmount(sameErrorThisMonth.at(-1)?.row[FINE_AMOUNT_COLUMN]);
  return Math.max(baseAmount, latestAmount) * 2;
}

function sameDay(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function getCompletionWindow(task: { type: CleaningTaskType; scheduledDate: Date }) {
  const year = task.scheduledDate.getUTCFullYear();
  const month = task.scheduledDate.getUTCMonth();
  const day = task.scheduledDate.getUTCDate();

  if (task.type === CleaningTaskType.KITCHEN_D7) {
    const windowStart = new Date(Date.UTC(year, month, day, 10, 0, 0, 0));
    const windowEnd = new Date(Date.UTC(year, month, day, 16, 0, 0, 0));
    return {
      windowStart,
      windowEnd,
      label: "17:00 to 23:00 on the assigned date"
    };
  }

  const windowStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  return {
    windowStart,
    windowEnd,
    label: "any time on the assigned date"
  };
}

function canCompleteTaskNow(task: { type: CleaningTaskType; scheduledDate: Date }, now = new Date()) {
  const { windowStart, windowEnd } = getCompletionWindow(task);
  return now >= windowStart && now <= windowEnd;
}

const LATE_COMPLETION_HOURS = 10;
const LATE_COMPLETION_REWARD_RATE = 0.5;

function getLateCompletionWindow(task: { type: CleaningTaskType; scheduledDate: Date }) {
  const { windowEnd } = getCompletionWindow(task);
  const lateEnd = new Date(windowEnd.getTime() + LATE_COMPLETION_HOURS * 60 * 60 * 1000);
  return { lateStart: windowEnd, lateEnd };
}

function canCompleteTaskLate(task: { type: CleaningTaskType; scheduledDate: Date }, now = new Date()) {
  const { lateStart, lateEnd } = getLateCompletionWindow(task);
  return now > lateStart && now <= lateEnd;
}

function mapActiveCleaningUsers(rows: ClientRow[]) {
  return rows
    .map((row) => {
      const branchId = normalizeBranch(row["Chi nhánh Cozoro dorm"] ?? "");
      if (!branchId) {
        return null;
      }

      return {
        email: (row["Địa chỉ email"] ?? "").trim().toLowerCase(),
        name: row["Tên"] ?? row["Địa chỉ email"] ?? "",
        branchId,
        floor: branchId === "D7" ? inferFloorFromBed(row["số giường"] ?? "") : null,
        source: row
      } satisfies ActiveCleaningUser;
    })
    .filter((row): row is ActiveCleaningUser => Boolean(row?.email));
}

async function getActiveCleaningUsers(options?: { emailHint?: string; forceRefresh?: boolean }) {
  const normalizedEmailHint = options?.emailHint?.trim().toLowerCase();
  const initialCache = options?.forceRefresh ? await syncClientsFromSheet() : ((await readCachedClients()) ?? await syncClientsFromSheet());
  let users = mapActiveCleaningUsers(initialCache.rows ?? []);

  if (!normalizedEmailHint || users.some((user) => user.email === normalizedEmailHint)) {
    return filterCheckedOutCleaningUsers(users);
  }

  const refreshedCache = await syncClientsFromSheet();
  users = mapActiveCleaningUsers(refreshedCache.rows ?? []);
  return filterCheckedOutCleaningUsers(users);
}

async function filterCheckedOutCleaningUsers(users: ActiveCleaningUser[]): Promise<ActiveCleaningUser[]> {
  if (users.length === 0) return users;
  const checkedOut = await listCheckedOutEmails();
  if (checkedOut.size === 0) return users;
  return users.filter((user) => !checkedOut.has(user.email));
}

/**
 * True when the resident should keep a cleaning schedule.
 * Expired contract end dates alone do NOT remove eligibility — only confirmed checkout
 * (or no remaining active client row) does.
 */
export async function isResidentEligibleForCleaningSchedule(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (await hasCompletedCheckout(normalized)) return false;
  const client = await getActiveClientByEmail(normalized);
  return Boolean(client);
}

async function readCleaningOverviewCacheFile() {
  try {
    const file = await readFile(cleaningOverviewCacheFilePath, "utf8");
    return JSON.parse(file) as CleaningOverviewCache;
  } catch {
    return null;
  }
}

async function saveCleaningOverviewToCache(email: string, overview: CleaningOverviewPayload) {
  const normalizedEmail = email.trim().toLowerCase();
  cleaningOverviewMemoryCache.set(normalizedEmail, overview);

  await mkdir(cacheDirPath, { recursive: true });
  const existing = (await readCleaningOverviewCacheFile()) ?? {
    syncedAt: new Date().toISOString(),
    entries: {}
  };

  existing.syncedAt = new Date().toISOString();
  existing.entries[normalizedEmail] = overview;
  await writeFile(cleaningOverviewCacheFilePath, JSON.stringify(existing, null, 2), "utf8");
}

async function invalidateCleaningOverviewCache(email?: string) {
  if (!email) {
    cleaningOverviewMemoryCache.clear();
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  cleaningOverviewMemoryCache.delete(normalizedEmail);

  const existing = await readCleaningOverviewCacheFile();
  if (!existing) {
    return;
  }

  delete existing.entries[normalizedEmail];
  existing.syncedAt = new Date().toISOString();
  await mkdir(cacheDirPath, { recursive: true });
  await writeFile(cleaningOverviewCacheFilePath, JSON.stringify(existing, null, 2), "utf8");
}

async function getAvailabilityMap(from: Date, to: Date) {
  const entries = await prisma.cleaningAvailability.findMany({
    where: {
      date: {
        gte: calendarRangeStart(from),
        lte: calendarRangeEnd(to)
      }
    }
  });

  return new Map(
    entries.map((entry) => [`${entry.userEmail.toLowerCase()}|${normalizeCalendarDate(entry.date).toISOString()}`, entry])
  );
}

async function getExistingTaskMap(from: Date, to: Date) {
  const tasks = await findManyCleaningTasks({
    where: {
      scheduledDate: {
        gte: calendarRangeStart(from),
        lte: calendarRangeEnd(to)
      }
    },
    orderBy: {
      scheduledDate: "asc"
    }
  });

  return tasks;
}

function getTaskTargetFloor(type: CleaningTaskType, users: ActiveCleaningUser[]) {
  if (type !== CleaningTaskType.TRASH_D7) {
    return null;
  }

  const floors = users.map((user) => user.floor).filter((value): value is number => Boolean(value));
  if (floors.length === 0) {
    return null;
  }

  const uniqueFloors = Array.from(new Set(floors)).sort();
  return uniqueFloors;
}

function countAssignments(tasks: Array<{ userEmail: string }>, userEmail: string) {
  return tasks.filter((task) => task.userEmail.toLowerCase() === userEmail.toLowerCase()).length;
}

function getAvailabilityScore(type: CleaningAvailabilityType | undefined) {
  if (type === CleaningAvailabilityType.PREFERRED) {
    return 0;
  }
  if (type === CleaningAvailabilityType.AVAILABLE) {
    return 1;
  }
  return 2;
}

function getConfigForTaskType(type: CleaningTaskType) {
  return dailyTaskConfigs.find((config) => config.type === type) ?? null;
}

function getTaskSlotKey(type: CleaningTaskType, scheduledDate: Date, floor?: number | null) {
  return `${type}|${normalizeCalendarDate(scheduledDate).toISOString()}|${floor ?? "none"}`;
}

function getAllowedTaskTypesForUser(user: ActiveCleaningUser): CleaningTaskType[] {
  if (user.branchId === "D2") {
    return [CleaningTaskType.KITCHEN_D2];
  }

  return user.floor ? [CleaningTaskType.TRASH_D7, CleaningTaskType.KITCHEN_D7] : [CleaningTaskType.KITCHEN_D7];
}

function isHostelShortTermCleaningUser(user: ActiveCleaningUser) {
  const contractCode = (user.source[CONTRACT_CODE_COLUMN] ?? "").trim().toUpperCase();
  return contractCode.startsWith("SHORTTERM-");
}

function getUserContractCode(user: Pick<ActiveCleaningUser, "source"> | null | undefined) {
  return (user?.source?.[CONTRACT_CODE_COLUMN] ?? "").trim();
}

async function getContractCleaningOptOutByContractCode(contractCode: string) {
  const normalizedContractCode = contractCode.trim();
  if (!normalizedContractCode) {
    return null;
  }

  return prisma.cleaningContractOptOut.findUnique({
    where: { contractCode: normalizedContractCode }
  });
}

async function getContractCleaningOptOutLookup(contractCodes: string[]) {
  const normalizedCodes = Array.from(new Set(contractCodes.map((value) => value.trim()).filter(Boolean)));

  if (normalizedCodes.length === 0) {
    return new Map<string, ContractCleaningOptOutSummary>();
  }

  const rows = await prisma.cleaningContractOptOut.findMany({
    where: {
      contractCode: { in: normalizedCodes }
    },
    select: {
      contractCode: true,
      cleaningFeeVnd: true,
      startDate: true,
      endDate: true
    }
  });

  return new Map(
    rows.map((row) => [
      row.contractCode,
      {
        contractCode: row.contractCode,
        cleaningFeeVnd: row.cleaningFeeVnd,
        startDate: row.startDate ? row.startDate.toISOString() : null,
        endDate: row.endDate ? row.endDate.toISOString() : null
      }
    ])
  );
}

function getSlotFloor(type: CleaningTaskType, floor?: number | null) {
  return type === CleaningTaskType.TRASH_D7 ? floor ?? null : null;
}

/** Month key `YYYY-MM` in UTC for cleaning monthly opt-out rows. */
function cleaningMonthKeyFromDate(date: Date) {
  const n = normalizeCalendarDate(date);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Admin picker / auto-assign: kitchen D7 = any D7 resident (floor irrelevant).
 * TRASH_D7 = only residents on `trashFloor` (1/2/3); `trashFloor` must be a number.
 */
function isUserEligibleForCleaningSlot(
  user: ActiveCleaningUser,
  type: CleaningTaskType,
  trashFloor?: number | null
): boolean {
  if (type === CleaningTaskType.KITCHEN_D2) {
    return user.branchId === "D2";
  }
  if (type === CleaningTaskType.KITCHEN_D7) {
    return user.branchId === "D7";
  }
  if (type === CleaningTaskType.TRASH_D7) {
    if (user.branchId !== "D7" || typeof trashFloor !== "number") {
      return false;
    }
    return user.floor === trashFloor;
  }
  return false;
}

function formatCalendarDate(date: Date) {
  const normalized = normalizeCalendarDate(date);
  const year = String(normalized.getUTCFullYear());
  const month = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  const day = String(normalized.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getNearestOpenDatesForUser(input: {
  user: ActiveCleaningUser;
  type: CleaningTaskType;
  fromDate: Date;
  floor?: number | null;
  limit?: number;
  /** Hard cap for suggestion search (inclusive). Defaults to today + self-assign max horizon. */
  maxDate?: Date;
}) {
  const suggestions: string[] = [];
  const normalizedFromDate = normalizeCalendarDate(input.fromDate);
  let cursor = addDays(normalizedFromDate, 1);
  const limit = input.limit ?? 5;
  const defaultMax = addDays(normalizeCalendarDate(new Date()), SELF_ASSIGN_MAX_DAYS_AHEAD);
  const searchToDate = normalizeCalendarDate(input.maxDate ?? defaultMax);
  if (cursor.getTime() > searchToDate.getTime()) {
    return suggestions;
  }

  await syncCleaningCalendarWindow(cursor, searchToDate);

  const availabilityEntries = await prisma.cleaningAvailability.findMany({
    where: {
      userEmail: input.user.email,
      date: {
        gte: cursor,
        lte: searchToDate
      }
    }
  });
  const availabilityMap = new Map(
    availabilityEntries.map((entry) => [`${entry.userEmail}|${formatCalendarDate(entry.date)}`, entry])
  );

  const userTasks = await findManyCleaningTasks({
    where: {
      userEmail: input.user.email,
      scheduledDate: {
        gte: calendarRangeStart(cursor),
        lte: calendarRangeEnd(searchToDate)
      }
    }
  });

  const calendarEvents = await listCleaningCalendarEvents(calendarRangeStart(cursor), calendarRangeEnd(searchToDate), {
    forceRefresh: true
  });
  const occupiedDateKeys = new Set(
    calendarEvents.map((event: CleaningCalendarEvent) => formatCalendarDate(normalizeCalendarDate(event.start)))
  );

  while (suggestions.length < limit && cursor.getTime() <= searchToDate.getTime()) {
    const cursorDateKey = formatCalendarDate(cursor);
    const availability = availabilityMap.get(`${input.user.email}|${cursorDateKey}`);

    if (availability?.type !== CleaningAvailabilityType.UNAVAILABLE) {
      const sameDayTasks = userTasks.filter((task) => sameDay(task.scheduledDate, cursor));
      const hasAssignedCalendarEvent = occupiedDateKeys.has(cursorDateKey);

      if (sameDayTasks.length === 0 && !hasAssignedCalendarEvent) {
        suggestions.push(cursorDateKey);
      }
    }

    cursor = addDays(cursor, 1);
  }

  return suggestions;
}

/**
 * Per-type fairness counts for the last N days.
 * Key: `${emailLower}|${CleaningTaskType}` → non-MISSED task count for that type only.
 * Separating kitchen vs trash prevents D7 dual-duty stacking from looking "fair" globally.
 */
function recentTypeTaskCountKey(email: string, type: CleaningTaskType) {
  return `${email.trim().toLowerCase()}|${type}`;
}

function getRecentTypeTaskCount(counts: Map<string, number>, email: string, type: CleaningTaskType) {
  return counts.get(recentTypeTaskCountKey(email, type)) ?? 0;
}

function bumpRecentTypeTaskCount(counts: Map<string, number>, email: string, type: CleaningTaskType) {
  const key = recentTypeTaskCountKey(email, type);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

async function getRecentTaskCountsByType(since: Date): Promise<Map<string, number>> {
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      scheduledDate: { gte: since },
      status: { not: CleaningTaskStatus.MISSED }
    },
    select: { userEmail: true, type: true }
  });
  const counts = new Map<string, number>();
  for (const { userEmail, type } of tasks) {
    bumpRecentTypeTaskCount(counts, userEmail, type);
  }
  return counts;
}

/**
 * Soft demotion for people managers recently corrected *away* from a slot.
 * Heavier weight for overlap / over-assigned reasons. Used only as a tie-break after
 * availability + per-type fairness — never excludes someone.
 */
async function getCorrectionPenalties(since: Date): Promise<Map<string, number>> {
  const rows = await prisma.cleaningScheduleCorrection.findMany({
    where: {
      createdAt: { gte: since },
      previousUserEmail: { not: null }
    },
    select: {
      previousUserEmail: true,
      reasons: {
        select: {
          reason: { select: { code: true } }
        }
      }
    }
  });

  const penalties = new Map<string, number>();
  for (const row of rows) {
    const email = (row.previousUserEmail ?? "").trim().toLowerCase();
    if (!email) continue;
    const codes = new Set(row.reasons.map((link) => link.reason.code).filter(Boolean));
    let weight = 1;
    if (
      codes.has("overlap") ||
      codes.has("overlap_random") ||
      codes.has("over_assigned_week") ||
      codes.has("wrong_person")
    ) {
      weight = 2;
    }
    penalties.set(email, (penalties.get(email) ?? 0) + weight);
  }
  return penalties;
}

type CleaningRankable = {
  email: string;
  name: string;
  availabilityType?: CleaningAvailabilityType | null;
  hasSameDayTask?: boolean;
};

/**
 * Shared ranking used by background auto-schedule, manager bulk assign, manager
 * available-users list (incl. bulk preview), release replacement, and swap candidates.
 *
 * Order:
 * 1. Same-day conflict last (when flagged)
 * 2. Availability: Preferred → Available → unmarked
 * 3. Fewest non-missed tasks of *this slot type* in the fairness window
 * 4. Lower correction penalty (manager fix feedback)
 * 5. Name
 */
function compareCleaningCandidateRank(
  left: CleaningRankable,
  right: CleaningRankable,
  options: {
    type: CleaningTaskType;
    recentTaskCounts: Map<string, number>;
    correctionPenalties?: Map<string, number>;
  }
) {
  const leftSameDay = Boolean(left.hasSameDayTask);
  const rightSameDay = Boolean(right.hasSameDayTask);
  if (leftSameDay !== rightSameDay) {
    return leftSameDay ? 1 : -1;
  }

  const availabilityDelta =
    getAvailabilityScore(left.availabilityType ?? undefined) -
    getAvailabilityScore(right.availabilityType ?? undefined);
  if (availabilityDelta !== 0) {
    return availabilityDelta;
  }

  const leftCount = getRecentTypeTaskCount(options.recentTaskCounts, left.email, options.type);
  const rightCount = getRecentTypeTaskCount(options.recentTaskCounts, right.email, options.type);
  if (leftCount !== rightCount) {
    return leftCount - rightCount;
  }

  const leftPenalty = options.correctionPenalties?.get(left.email.trim().toLowerCase()) ?? 0;
  const rightPenalty = options.correctionPenalties?.get(right.email.trim().toLowerCase()) ?? 0;
  if (leftPenalty !== rightPenalty) {
    return leftPenalty - rightPenalty;
  }

  return left.name.localeCompare(right.name);
}

async function getAssignableCandidates(
  activeUsers: ActiveCleaningUser[],
  availabilityMap: Map<string, Prisma.CleaningAvailabilityGetPayload<Record<string, never>>>,
  scheduledDate: Date,
  type: CleaningTaskType,
  occupiedTasks: Array<{ userEmail: string; scheduledDate: Date }>,
  floor?: number | null,
  recentTaskCounts?: Map<string, number>,
  correctionPenalties?: Map<string, number>
) {
  const normalizedDateKey = normalizeCalendarDate(scheduledDate).toISOString();
  const counts = recentTaskCounts ?? new Map<string, number>();
  const penalties = correctionPenalties ?? new Map<string, number>();

  return activeUsers
    .filter((user) => {
      return isUserEligibleForCleaningSlot(user, type, floor);
    })
    .filter((user) => {
      const availability = availabilityMap.get(`${user.email}|${normalizedDateKey}`);
      if (availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
        return false;
      }

      const hasTaskSameDay = occupiedTasks.some(
        (task) => task.userEmail.toLowerCase() === user.email && sameDay(task.scheduledDate, scheduledDate)
      );

      return !hasTaskSameDay;
    })
    .sort((left, right) => {
      const leftAvailability = availabilityMap.get(`${left.email}|${normalizedDateKey}`);
      const rightAvailability = availabilityMap.get(`${right.email}|${normalizedDateKey}`);
      return compareCleaningCandidateRank(
        { email: left.email, name: left.name, availabilityType: leftAvailability?.type ?? null },
        { email: right.email, name: right.name, availabilityType: rightAvailability?.type ?? null },
        { type, recentTaskCounts: counts, correctionPenalties: penalties }
      );
    });
}

async function assignTaskToUser(input: {
  user: ActiveCleaningUser;
  date: Date;
  type: CleaningTaskType;
  floor?: number | null;
  allowSameDayOverride?: boolean;
  allowExistingSlotReassign?: boolean;
  isSelfAssigned?: boolean;
  assignmentSource?: CleaningAssignmentSource;
  assignedByEmail?: string | null;
  assignedByName?: string | null;
}) {
  const normalizedTaskDate = normalizeCalendarDate(input.date);
  const normalizedEmail = input.user.email.trim().toLowerCase();
  const slotFloor = getSlotFloor(input.type, input.floor ?? input.user.floor);

  const sameDayUserTasks = await findManyCleaningTasks({
    where: {
      userEmail: normalizedEmail,
      scheduledDate: {
        gte: calendarRangeStart(normalizedTaskDate),
        lte: calendarRangeEnd(normalizedTaskDate)
      }
    },
    orderBy: {
      scheduledDate: "asc"
    }
  });

  const conflictingSameDayTasks = sameDayUserTasks.filter((task) => {
    if (task.type !== input.type) {
      return true;
    }

    if (task.type !== CleaningTaskType.TRASH_D7) {
      return false;
    }

    return (task.floor ?? null) !== slotFloor;
  });

  if (conflictingSameDayTasks.length > 0 && !input.allowSameDayOverride) {
    throw new CleaningAssignmentConflictError(
      conflictingSameDayTasks.map((task) => ({
        id: task.id,
        type: task.type,
        scheduledDate: task.scheduledDate
      }))
    );
  }

  const existingSlot = await findFirstCleaningTask({
    where: {
      type: input.type,
      scheduledDate: {
        gte: calendarRangeStart(normalizedTaskDate),
        lte: calendarRangeEnd(normalizedTaskDate)
      },
      ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: slotFloor } : {})
    }
  });

  if (existingSlot) {
    if (existingSlot.status !== CleaningTaskStatus.ASSIGNED) {
      throw new Error("That cleaning slot can no longer be reassigned");
    }

    if (existingSlot.userEmail.toLowerCase() === normalizedEmail) {
      return existingSlot;
    }

    if (input.allowExistingSlotReassign === false) {
      throw new Error("That cleaning slot is already assigned to another user");
    }

    const isSelfAssigned = input.isSelfAssigned ?? false;
    const rewardSettings = await getCleaningRewardSettings();
    const { rewardCoins } = computeCleaningRewardCoins(
      rewardSettings,
      input.type,
      normalizedTaskDate,
      isSelfAssigned
    );

      const reassignedTask = await updateCleaningTask({
        where: { id: existingSlot.id },
        data: {
          userEmail: normalizedEmail,
          userName: input.user.name,
          branchId: input.user.branchId,
          floor: slotFloor,
          rewardCoins,
          isSelfAssigned,
          assignmentSource: input.assignmentSource ?? (isSelfAssigned ? CleaningAssignmentSource.SELF : undefined),
          assignedByEmail: input.assignedByEmail ?? undefined,
          assignedByName: input.assignedByName ?? undefined
        }
      });
      await logAction({
        actorEmail: input.assignedByEmail ?? null,
        actorName: input.assignedByName ?? existingSlot.userName,
        actorRole:
          input.assignmentSource === CleaningAssignmentSource.SELF
            ? "resident"
            : input.assignmentSource === CleaningAssignmentSource.MANAGER
              ? "manager"
              : "system",
        action: "cleaning.task.reassign",
        entityType: "CleaningTask",
        entityId: reassignedTask.id,
        entityLabel: `${reassignedTask.type}|${reassignedTask.scheduledDate.toISOString().slice(0, 10)}`,
        details: `from=${existingSlot.userEmail}; to=${normalizedEmail}`
      });

    if (reassignedTask.calendarId && reassignedTask.calendarEventId) {
      const target = getCleaningCalendarTarget(reassignedTask.type, { floor: reassignedTask.floor });
      if (target) {
        try {
          await updateCleaningCalendarEvent({
            calendarId: reassignedTask.calendarId,
            eventId: reassignedTask.calendarEventId,
            title: target.title,
            scheduledDate: reassignedTask.scheduledDate,
            userEmail: reassignedTask.userEmail,
            userName: reassignedTask.userName,
            branchId: reassignedTask.branchId,
            floor: reassignedTask.floor,
            rewardCoins: reassignedTask.rewardCoins,
            type: reassignedTask.type,
            status: reassignedTask.status,
            completedAt: reassignedTask.completedAt,
            completionNote: reassignedTask.completionNote,
            completionPhoto: reassignedTask.completionPhoto,
            auditorNote: reassignedTask.auditorNote
          });
        } catch (error) {
          console.warn(
            `Cleaning calendar event update skipped for reassigned task ${reassignedTask.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    }

    await invalidateCleaningOverviewCache(existingSlot.userEmail);
    await invalidateCleaningOverviewCache(normalizedEmail);
    return reassignedTask;
  }

  const config = getConfigForTaskType(input.type);
  if (!config) {
    throw new Error("Cleaning task config not found");
  }

  // Guard against concurrent slot creation (e.g. auto-scheduler + admin assign race).
  // Only one call per (type, date, floor) slot is allowed to proceed to INSERT at a time.
  const slotKey = getSlotCreationKey(input.type, normalizedTaskDate, slotFloor);
  if (slotCreationInFlight.has(slotKey)) {
    throw new Error("Another assignment for this slot is already in progress. Please try again.");
  }
  slotCreationInFlight.add(slotKey);
  try {
    // Final re-check inside the guarded section to close the check-then-act window.
    const raceSlot = await findFirstCleaningTask({
      where: {
        type: input.type,
        scheduledDate: {
          gte: calendarRangeStart(normalizedTaskDate),
          lte: calendarRangeEnd(normalizedTaskDate)
        },
        ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: slotFloor } : {})
      }
    });
    if (raceSlot) {
      // Another concurrent call already created the slot; treat like an existing slot.
      if (raceSlot.status !== CleaningTaskStatus.ASSIGNED) {
        throw new Error("That cleaning slot can no longer be reassigned");
      }
      if (raceSlot.userEmail.toLowerCase() === normalizedEmail || input.allowExistingSlotReassign === false) {
        return raceSlot;
      }
      const raceReassigned = await updateCleaningTask({
        where: { id: raceSlot.id },
        data: {
          userEmail: normalizedEmail,
          userName: input.user.name,
          branchId: input.user.branchId,
          floor: slotFloor,
          isSelfAssigned: input.isSelfAssigned ?? false,
          assignmentSource: input.assignmentSource ?? (input.isSelfAssigned ? CleaningAssignmentSource.SELF : undefined),
          assignedByEmail: input.assignedByEmail ?? undefined,
          assignedByName: input.assignedByName ?? undefined
        }
      });
      await logAction({
        actorEmail: input.assignedByEmail ?? null,
        actorName: input.assignedByName ?? raceSlot.userName,
        actorRole:
          input.assignmentSource === CleaningAssignmentSource.SELF
            ? "resident"
            : input.assignmentSource === CleaningAssignmentSource.MANAGER
              ? "manager"
              : "system",
        action: "cleaning.task.reassign",
        entityType: "CleaningTask",
        entityId: raceReassigned.id,
        entityLabel: `${raceReassigned.type}|${raceReassigned.scheduledDate.toISOString().slice(0, 10)}`,
        details: `from=${raceSlot.userEmail}; to=${normalizedEmail}`
      });
      await invalidateCleaningOverviewCache(raceSlot.userEmail);
      await invalidateCleaningOverviewCache(normalizedEmail);
      return raceReassigned;
    }

    const created = await createCleaningTaskRecord({
      user: input.user,
      type: input.type,
      title: config.title,
      scheduledDate: normalizedTaskDate,
      floor: slotFloor,
      isSelfAssigned: input.isSelfAssigned,
      assignmentSource: input.assignmentSource ?? (input.isSelfAssigned ? CleaningAssignmentSource.SELF : undefined),
      assignedByEmail: input.assignedByEmail ?? undefined,
      assignedByName: input.assignedByName ?? undefined
    });
    await logAction({
      actorEmail: input.assignedByEmail ?? null,
      actorName: input.assignedByName ?? input.user.name,
      actorRole:
        input.assignmentSource === CleaningAssignmentSource.SELF
          ? "resident"
          : input.assignmentSource === CleaningAssignmentSource.MANAGER
            ? "manager"
            : "system",
      action: "cleaning.task.assign",
      entityType: "CleaningTask",
      entityId: created.id,
      entityLabel: `${created.type}|${created.scheduledDate.toISOString().slice(0, 10)}`,
      details: `source=${input.assignmentSource ?? (input.isSelfAssigned ? "SELF" : "SYSTEM")}`
    });

    await invalidateCleaningOverviewCache(normalizedEmail);
    return created;
  } finally {
    slotCreationInFlight.delete(slotKey);
  }
}

/** Batch Google Calendar inserts for new assignments to reduce latency and API bursts. */
const CLEANING_CALENDAR_DEFER_FLUSH_MS = 5 * 60 * 1000;
const CLEANING_CALENDAR_DEFER_BATCH_MAX = 8;

const deferredCleaningCalendarCreateIds = new Set<string>();
let deferredCleaningCalendarTimer: ReturnType<typeof setTimeout> | null = null;
let deferredCleaningCalendarFlushChain: Promise<void> = Promise.resolve();
export function getDeferredCleaningCalendarFlushChain() {
  return deferredCleaningCalendarFlushChain;
}

function scheduleDeferredCleaningCalendarFlush() {
  if (deferredCleaningCalendarTimer) {
    return;
  }
  deferredCleaningCalendarTimer = setTimeout(() => {
    deferredCleaningCalendarTimer = null;
    flushDeferredCleaningCalendarCreates("timer");
  }, CLEANING_CALENDAR_DEFER_FLUSH_MS);
}

function enqueueDeferredCleaningCalendarCreate(taskId: string) {
  deferredCleaningCalendarCreateIds.add(taskId);
  if (deferredCleaningCalendarCreateIds.size >= CLEANING_CALENDAR_DEFER_BATCH_MAX) {
    flushDeferredCleaningCalendarCreates("batch");
    return;
  }
  scheduleDeferredCleaningCalendarFlush();
}

export function flushDeferredCleaningCalendarCreates(reason: string) {
  if (deferredCleaningCalendarTimer) {
    clearTimeout(deferredCleaningCalendarTimer);
    deferredCleaningCalendarTimer = null;
  }

  deferredCleaningCalendarFlushChain = deferredCleaningCalendarFlushChain
    .catch(() => undefined)
    .then(async () => {
      const ids = [...deferredCleaningCalendarCreateIds];
      deferredCleaningCalendarCreateIds.clear();
      if (ids.length === 0) {
        return;
      }
      console.log(`[cleaning-calendar] deferred flush: ${ids.length} task(s) (${reason})`);
      for (const taskId of ids) {
        await syncDeferredCleaningCalendarCreate(taskId);
      }
    });

  void deferredCleaningCalendarFlushChain.catch((err) => {
    console.error("[cleaning-calendar] deferred flush error", err);
  });
}

async function syncDeferredCleaningCalendarCreate(taskId: string) {
  const task = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!task || task.calendarEventId || !task.calendarId || task.status !== CleaningTaskStatus.ASSIGNED) {
    return;
  }

  const config = getConfigForTaskType(task.type);
  if (!config) {
    return;
  }

  const normalizedScheduledDate = normalizeCalendarDate(task.scheduledDate);

  // Before creating a new event, check if one already exists in the calendar for this
  // task's slot. This prevents duplicate events when the API restarts mid-flush (after the
  // Google Calendar insert succeeded but before the calendarEventId was saved back to DB).
  try {
    const existingEvents = await listCleaningCalendarEvents(
      calendarRangeStart(normalizedScheduledDate),
      calendarRangeEnd(normalizedScheduledDate),
      { forceRefresh: true }
    );
    const alreadyExists = existingEvents.find(
      (event: CleaningCalendarEvent) =>
        event.calendarId === task.calendarId && event.taskType === task.type
    );
    if (alreadyExists) {
      console.log(
        `[cleaning-calendar] calendar event already exists for task ${taskId} on ${normalizedScheduledDate.toISOString().slice(0, 10)} — linking DB record to event ${alreadyExists.id}`
      );
      await prisma.cleaningTask.update({
        where: { id: taskId },
        data: { calendarEventId: alreadyExists.id }
      });
      return;
    }
  } catch (lookupError) {
    console.warn(
      `[cleaning-calendar] pre-create calendar lookup failed for task ${taskId}, proceeding with insert:`,
      lookupError instanceof Error ? lookupError.message : lookupError
    );
  }

  try {
    const eventId = await createCleaningCalendarEvent({
      calendarId: task.calendarId,
      title: config.title,
      scheduledDate: normalizedScheduledDate,
      userEmail: task.userEmail,
      userName: task.userName,
      branchId: task.branchId,
      floor: task.floor,
      rewardCoins: task.rewardCoins,
      type: task.type
    });
    if (eventId) {
      await prisma.cleaningTask.update({
        where: { id: taskId },
        data: { calendarEventId: eventId }
      });
    }
  } catch (error) {
    console.warn(
      `[cleaning-calendar] deferred create failed for task ${taskId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/** Re-enqueues ASSIGNED rows that have a target calendar but no Google event yet (e.g. after process restart). */
export async function recoverDeferredCleaningCalendarCreates() {
  const since = addDays(normalizeCalendarDate(new Date()), -30);
  const stuck = await prisma.cleaningTask.findMany({
    where: {
      calendarEventId: null,
      calendarId: { not: null },
      status: CleaningTaskStatus.ASSIGNED,
      scheduledDate: { gte: since }
    },
    select: { id: true },
    orderBy: { scheduledDate: "asc" },
    take: 200
  });
  for (const row of stuck) {
    deferredCleaningCalendarCreateIds.add(row.id);
  }
  if (stuck.length > 0) {
    flushDeferredCleaningCalendarCreates("startup-recovery");
  }
}

async function createCleaningTaskRecord(input: {
  user: ActiveCleaningUser;
  type: CleaningTaskType;
  title: string;
  scheduledDate: Date;
  floor?: number | null;
  isSelfAssigned?: boolean;
  assignmentSource?: CleaningAssignmentSource;
  assignedByEmail?: string | null;
  assignedByName?: string | null;
}) {
  const normalizedScheduledDate = normalizeCalendarDate(input.scheduledDate);
  const rewardSettings = await getCleaningRewardSettings();
  const { rewardCoins } = computeCleaningRewardCoins(
    rewardSettings,
    input.type,
    normalizedScheduledDate,
    Boolean(input.isSelfAssigned)
  );
  const target = getCleaningCalendarTarget(input.type, { floor: input.floor ?? input.user.floor });
  const calendarId: string | null = target?.calendarId ?? null;
  const calendarEventId: string | null = null;
  const slotFloorForKey = input.type === CleaningTaskType.TRASH_D7 ? (input.floor ?? input.user.floor ?? null) : null;
  const slotKey = getSlotCreationKey(input.type, normalizedScheduledDate, slotFloorForKey);

  const created = await createCleaningTask({
    data: {
      userEmail: input.user.email,
      userName: input.user.name,
      branchId: input.user.branchId,
      floor: input.floor ?? input.user.floor,
      type: input.type,
      scheduledDate: normalizedScheduledDate,
        slotKey,
        rewardCoins,
        isSelfAssigned: input.isSelfAssigned ?? false,
        assignmentSource: input.assignmentSource ?? undefined,
        assignedByEmail: input.assignedByEmail ?? undefined,
        assignedByName: input.assignedByName ?? undefined,
        calendarId,
      calendarEventId
    }
  });

  await logAction({
    actorEmail: input.assignedByEmail ?? null,
    actorName: input.assignedByName ?? input.user.name,
    actorRole:
      input.assignmentSource === CleaningAssignmentSource.SELF
        ? "resident"
        : input.assignmentSource === CleaningAssignmentSource.MANAGER
          ? "manager"
          : "system",
    action: "cleaning.task.create",
    entityType: "CleaningTask",
    entityId: created.id,
    entityLabel: `${created.type}|${created.scheduledDate.toISOString().slice(0, 10)}`,
    details: `source=${input.assignmentSource ?? (input.isSelfAssigned ? "SELF" : "SYSTEM")}`
  });

  if (calendarId) {
    enqueueDeferredCleaningCalendarCreate(created.id);
  }

  return created;
}

function getImportedUserName(event: CleaningCalendarEvent, matchedUser: ActiveCleaningUser | null) {
  return event.userName?.trim() || matchedUser?.name || event.userEmail || "Unassigned";
}

async function syncCalendarTasksIntoDatabase(
  from: Date,
  to: Date,
  activeUsers: ActiveCleaningUser[]
) {
  const importedEvents = await listCleaningCalendarEvents(calendarRangeStart(from), calendarRangeEnd(to), {
    forceRefresh: true
  });
  const importedTasks: CleaningTaskRecord[] = [];
  const usersByEmail = new Map(activeUsers.map((user) => [user.email, user]));
  const rewardSettings = await getCleaningRewardSettings();

  for (const event of importedEvents) {
    const scheduledDate = normalizeCalendarDate(event.start);
    const normalizedEmail = event.userEmail?.trim().toLowerCase() ?? "";
    const matchedUser = normalizedEmail ? usersByEmail.get(normalizedEmail) ?? null : null;
    const userEmail = normalizedEmail || `calendar-event-${event.id}@local.invalid`;
    const userName = getImportedUserName(event, matchedUser);
    const branchId = matchedUser?.branchId ?? event.branchId;
    const floor = matchedUser?.floor ?? event.floor ?? null;

    const slotMatches = await findManyCleaningTasks({
      where: {
        type: event.taskType as CleaningTaskType,
        scheduledDate: {
          gte: calendarRangeStart(scheduledDate),
          lte: calendarRangeEnd(scheduledDate)
        },
        ...(event.taskType === CleaningTaskType.TRASH_D7 ? { floor } : {})
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const existingTaskByEventId = slotMatches.find((task) => task.calendarEventId === event.id) ?? null;
    const existingTaskBySameUser =
      normalizedEmail
        ? slotMatches.find((task) => task.userEmail.trim().toLowerCase() === normalizedEmail) ?? null
        : null;
    const placeholderSlotTask = slotMatches.find((task) => !task.calendarId && !task.calendarEventId) ?? null;
    const canonicalExistingTask =
      existingTaskByEventId ??
      existingTaskBySameUser ??
      placeholderSlotTask ??
      slotMatches.find((task) => task.status === CleaningTaskStatus.ASSIGNED) ??
      slotMatches[0] ??
      null;
    const existingTask = canonicalExistingTask;

    if (existingTask) {
      // If the calendar shows a user who is UNAVAILABLE on this date, the DB assignment is
      // authoritative (they released the task). Keep the existing DB email/name instead of
      // overwriting with stale calendar data.
      let syncEmail = userEmail;
      let syncName = userName;
      if (normalizedEmail && normalizedEmail !== existingTask.userEmail.trim().toLowerCase()) {
        const calendarUserAvailability = await prisma.cleaningAvailability.findUnique({
          where: { userEmail_date: { userEmail: normalizedEmail, date: scheduledDate } }
        });
        if (calendarUserAvailability?.type === CleaningAvailabilityType.UNAVAILABLE) {
          syncEmail = existingTask.userEmail;
          syncName = existingTask.userName ?? syncName;
        }
      }

      const updatedTask = await updateCleaningTask({
        where: { id: existingTask.id },
        data: {
          userEmail: syncEmail,
          userName: syncName,
          branchId,
          floor,
          type: event.taskType as CleaningTaskType,
          scheduledDate,
          calendarId: event.calendarId,
          calendarEventId: event.id || existingTask.calendarEventId
        }
      });
      await logAction({
        actorEmail: normalizedEmail || null,
        actorName: userName,
        actorRole: "system",
        action: "cleaning.task.sync",
        entityType: "CleaningTask",
        entityId: updatedTask.id,
        entityLabel: `${updatedTask.type}|${updatedTask.scheduledDate.toISOString().slice(0, 10)}`,
        details: `event=${event.id}`
      });

      const staleDuplicateIds = slotMatches
        .filter((task) => task.id !== updatedTask.id)
        .filter((task) => task.status === CleaningTaskStatus.ASSIGNED)
        .map((task) => task.id);

      if (staleDuplicateIds.length > 0) {
        await prisma.cleaningTask.deleteMany({
          where: {
            id: {
              in: staleDuplicateIds
            }
          }
        });
        await logAction({
          actorEmail: normalizedEmail || null,
          actorName: userName,
          actorRole: "system",
          action: "cleaning.task.delete_many",
          entityType: "CleaningTask",
          entityId: updatedTask.id,
          entityLabel: `${updatedTask.type}|${updatedTask.scheduledDate.toISOString().slice(0, 10)}`,
          details: `deleted=${staleDuplicateIds.length}`
        });
      }

      importedTasks.push(updatedTask);
      continue;
    }

    const createdTask = await createCleaningTask({
      data: {
        userEmail,
        userName,
        branchId,
        floor,
        type: event.taskType as CleaningTaskType,
        scheduledDate,
          slotKey: getSlotCreationKey(event.taskType as CleaningTaskType, scheduledDate, event.taskType === CleaningTaskType.TRASH_D7 ? floor : null),
          calendarId: event.calendarId,
          calendarEventId: event.id,
          rewardCoins: rewardSettings.baseRewards[event.taskType as CleaningTaskType],
          assignmentSource: CleaningAssignmentSource.SYSTEM,
          assignedByName: "System"
        }
      });
    await logAction({
      actorEmail: normalizedEmail || null,
      actorName: userName,
      actorRole: "system",
      action: "cleaning.task.sync_create",
      entityType: "CleaningTask",
      entityId: createdTask.id,
      entityLabel: `${createdTask.type}|${createdTask.scheduledDate.toISOString().slice(0, 10)}`,
      details: `event=${event.id}`
    });
    importedTasks.push(createdTask);
  }

  return importedTasks;
}

async function cleanupStaleLocalOnlyTasks(from: Date, to: Date) {
  const tasks = await findManyCleaningTasks({
    where: {
      scheduledDate: {
        gte: calendarRangeStart(from),
        lte: calendarRangeEnd(to)
      }
    }
  });

  const tasksBySlot = new Map<string, CleaningTaskRecord[]>();
  for (const task of tasks) {
    const key = getTaskSlotKey(task.type, task.scheduledDate, task.floor);
    const bucket = tasksBySlot.get(key) ?? [];
    bucket.push(task);
    tasksBySlot.set(key, bucket);
  }

  const duplicateIdsToDelete = Array.from(tasksBySlot.values())
    .flatMap((slotTasks) => {
      const hasCalendarBackedTask = slotTasks.some((task) => task.calendarId || task.calendarEventId);
      if (!hasCalendarBackedTask) {
        return [];
      }

      return slotTasks
        .filter((task) => !task.calendarId && !task.calendarEventId)
        .filter((task) => task.status === CleaningTaskStatus.ASSIGNED)
        .map((task) => task.id);
    });

  if (duplicateIdsToDelete.length === 0) {
    return;
  }

  await prisma.cleaningTask.deleteMany({
    where: {
      id: {
        in: duplicateIdsToDelete
      }
    }
  });
}

async function syncCleaningCalendarWindow(from: Date, to: Date) {
  const normalizedFrom = normalizeCalendarDate(from);
  const normalizedTo = normalizeCalendarDate(to);
  const activeUsers = await getActiveCleaningUsers();
  const importedTasks = await syncCalendarTasksIntoDatabase(normalizedFrom, normalizedTo, activeUsers);
  await cleanupStaleLocalOnlyTasks(normalizedFrom, normalizedTo);
  return importedTasks;
}

export async function generateCleaningSchedule(from: Date, to: Date): Promise<GenerateCleaningScheduleResult> {
  const normalizedFrom = normalizeCalendarDate(from);
  const normalizedTo = normalizeCalendarDate(to);
  const importedTasks = await syncCleaningCalendarWindow(normalizedFrom, normalizedTo);

  await Promise.all(
    Array.from(new Set(importedTasks.map((task) => task.userEmail))).map((email) =>
      invalidateCleaningOverviewCache(email)
    )
  );

  return {
    imported: importedTasks,
    created: []
  };
}

export async function setCleaningAvailability(input: {
  email: string;
  branchId: string;
  floor?: number | null;
  date: Date;
  type: CleaningAvailabilityType;
  note?: string;
}) {
  const normalizedDate = normalizeCalendarDate(input.date);
  if (
    input.type === CleaningAvailabilityType.UNAVAILABLE &&
    normalizedDate.getTime() < normalizeCalendarDate(new Date()).getTime()
  ) {
    throw new Error("Past dates cannot be marked unavailable");
  }
  const availability = await prisma.cleaningAvailability.upsert({
    where: {
      userEmail_date: {
        userEmail: input.email.toLowerCase(),
        date: normalizedDate
      }
    },
    update: {
      branchId: input.branchId,
      floor: input.floor ?? null,
      type: input.type,
      note: input.note
    },
    create: {
      userEmail: input.email.toLowerCase(),
      branchId: input.branchId,
      floor: input.floor ?? null,
      date: normalizedDate,
      type: input.type,
      note: input.note
    }
  });

  await invalidateCleaningOverviewCache(input.email);
  await logAction({
    actorEmail: input.email.toLowerCase(),
    actorRole: "resident",
    action: "cleaning.availability.set",
    entityType: "CleaningAvailability",
    entityId: `${input.email.toLowerCase()}|${normalizedDate.toISOString().slice(0, 10)}`,
    entityLabel: input.email.toLowerCase(),
    details: `type=${input.type}${input.note ? `; note=${input.note}` : ""}`
  });
  return availability;
}

export async function selfAssignCleaningTask(input: {
  email: string;
  date: Date;
  type: CleaningTaskType;
}) {
  if (!isFutureCalendarDate(input.date)) {
    throw new Error("Self-assignment is only available for future dates");
  }
  const daysAhead = getCalendarDayDiff(new Date(), input.date);
  if (daysAhead > SELF_ASSIGN_MAX_DAYS_AHEAD) {
    throw new Error(`Self-assignment is limited to ${SELF_ASSIGN_MAX_DAYS_AHEAD} days in advance`);
  }
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await getUserCleaningContext(normalizedEmail);

  if (!user) {
    throw new Error("Active user not found for cleaning self-assignment");
  }

  const allowedTypes = getAllowedTaskTypesForUser(user);
  if (!allowedTypes.includes(input.type)) {
    throw new Error("This cleaning task type is not allowed for your branch or floor");
  }

  const normalizedTaskDate = normalizeCalendarDate(input.date);
  await syncCleaningCalendarWindow(normalizedTaskDate, normalizedTaskDate);
  const availability = await prisma.cleaningAvailability.findUnique({
    where: {
      userEmail_date: {
        userEmail: normalizedEmail,
        date: normalizedTaskDate
      }
    }
  });

  if (availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
    throw new Error("This date is marked unavailable");
  }

  const selfAssignMonth = cleaningMonthKeyFromDate(normalizedTaskDate);
  const contractOptOut = await getContractCleaningOptOutByContractCode(getUserContractCode(user));
  if (contractOptOut) {
    throw new Error("You are opted out of cleaning for this contract.");
  }
  const optOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: selfAssignMonth }
  });
  if (optOut) {
    throw new Error("You have opted out of cleaning for this month. Cancel your opt-out to self-assign.");
  }

  const slotFloor = input.type === CleaningTaskType.TRASH_D7 ? user.floor : null;
  const existingSlot = await findFirstCleaningTask({
    where: {
      type: input.type,
      scheduledDate: {
        gte: calendarRangeStart(normalizedTaskDate),
        lte: calendarRangeEnd(normalizedTaskDate)
      },
      ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: slotFloor } : {})
    }
  });

  if (existingSlot && existingSlot.userEmail.toLowerCase() !== normalizedEmail) {
    const suggestions = await getNearestOpenDatesForUser({
      user,
      type: input.type,
      fromDate: normalizedTaskDate,
      floor: slotFloor,
      limit: 5
    });
    throw new CleaningSelfAssignConflictError(suggestions);
  }

  const assignedTask = await assignTaskToUser({
      user,
      date: normalizedTaskDate,
      type: input.type,
      floor: slotFloor,
      allowExistingSlotReassign: false,
      isSelfAssigned: true,
      assignmentSource: CleaningAssignmentSource.SELF,
      assignedByEmail: normalizedEmail,
      assignedByName: "Self assign"
    });
  await logAction({
    actorEmail: normalizedEmail,
    actorName: "Self assign",
    actorRole: "resident",
    action: "cleaning.task.self_assign",
    entityType: "CleaningTask",
    entityId: assignedTask.id,
    entityLabel: `${assignedTask.type}|${assignedTask.scheduledDate.toISOString().slice(0, 10)}`
  });
  return assignedTask;
}

export async function checkSelfAssignCleaningTask(input: {
  email: string;
  date: Date;
  type: CleaningTaskType;
}): Promise<SelfAssignCheckResult> {
  if (!isFutureCalendarDate(input.date)) {
    return {
      canSubmit: false,
      reason: "Self-assignment is only available for future dates."
    };
  }

  const daysAhead = getCalendarDayDiff(new Date(), input.date);
  if (daysAhead > SELF_ASSIGN_MAX_DAYS_AHEAD) {
    return {
      canSubmit: false,
      reason: `Self-assignment is limited to ${SELF_ASSIGN_MAX_DAYS_AHEAD} days in advance.`
    };
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await getUserCleaningContext(normalizedEmail);
  if (!user) {
    return {
      canSubmit: false,
      reason: "Active user not found for cleaning self-assignment."
    };
  }

  const allowedTypes = getAllowedTaskTypesForUser(user);
  if (!allowedTypes.includes(input.type)) {
    return {
      canSubmit: false,
      reason: "This cleaning task type is not allowed for your branch or floor."
    };
  }

  const normalizedTaskDate = normalizeCalendarDate(input.date);
  await syncCleaningCalendarWindow(normalizedTaskDate, normalizedTaskDate);

  const availability = await prisma.cleaningAvailability.findUnique({
    where: {
      userEmail_date: {
        userEmail: normalizedEmail,
        date: normalizedTaskDate
      }
    }
  });

  if (availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
    return {
      canSubmit: false,
      reason: "This date is marked unavailable."
    };
  }

  const checkMonth = cleaningMonthKeyFromDate(normalizedTaskDate);
  const contractOptOut = await getContractCleaningOptOutByContractCode(getUserContractCode(user));
  if (contractOptOut) {
    return {
      canSubmit: false,
      reason: "You are opted out of cleaning for this contract."
    };
  }
  const optOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: checkMonth }
  });
  if (optOut) {
    return {
      canSubmit: false,
      reason: "You have opted out of cleaning for this month. Cancel your opt-out to self-assign."
    };
  }

  const slotFloor = input.type === CleaningTaskType.TRASH_D7 ? user.floor : null;
  const existingSlot = await findFirstCleaningTask({
    where: {
      type: input.type,
      scheduledDate: {
        gte: calendarRangeStart(normalizedTaskDate),
        lte: calendarRangeEnd(normalizedTaskDate)
      },
      ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: slotFloor } : {})
    }
  });

  if (existingSlot && existingSlot.userEmail.toLowerCase() !== normalizedEmail) {
    const suggestions = await getNearestOpenDatesForUser({
      user,
      type: input.type,
      fromDate: normalizedTaskDate,
      floor: slotFloor,
      limit: 5
    });
    return {
      canSubmit: false,
      reason: "This date is already scheduled to another guest.",
      suggestions
    };
  }

  return {
    canSubmit: true
  };
}

const MONTHLY_RELEASE_LIMIT = 3;

async function countReleasesThisMonth(email: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return prisma.cleaningAvailability.count({
    where: {
      userEmail: email.trim().toLowerCase(),
      type: CleaningAvailabilityType.UNAVAILABLE,
      note: "Released self-assigned cleaning task",
      date: { gte: monthStart, lte: monthEnd }
    }
  });
}

export async function releaseCleaningTask(taskId: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const task = await findUniqueCleaningTask({
    where: { id: taskId }
  });

  if (!task) {
    throw new Error("Cleaning task not found");
  }

  if (task.userEmail.toLowerCase() !== normalizedEmail) {
    throw new Error("You can only release your own cleaning task");
  }

  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    throw new Error("Only assigned tasks can be released");
  }

  const releasePenalty = getCleaningReleasePenalty(task.scheduledDate);

  // Self-assigned tasks released with 5+ days notice: no penalty and doesn't count against monthly limit
  const isSelfAssignedEarlyRelease = task.isSelfAssigned && releasePenalty.fineRate === 0;

  if (!isSelfAssignedEarlyRelease) {
    const releasesThisMonth = await countReleasesThisMonth(normalizedEmail);
    if (releasesThisMonth >= MONTHLY_RELEASE_LIMIT) {
      throw new Error(`You have reached the limit of ${MONTHLY_RELEASE_LIMIT} removals this month.`);
    }
  }

  if (!releasePenalty.canRelease || !canReleaseCalendarDate(task.scheduledDate)) {
    throw new Error(releasePenalty.message);
  }

  const candidates = await getAvailableUsersForAdminSlot({
    date: task.scheduledDate,
    type: task.type,
    floor: task.floor ?? undefined
  });

  const replacement = candidates.find(
    (candidate) => candidate.email !== normalizedEmail && !candidate.hasSameDayTask
  );

  if (!replacement) {
    throw new Error("No replacement user is available for this date");
  }

  const replacementUser = await getUserCleaningContext(replacement.email);
  if (!replacementUser) {
    throw new Error("Replacement user context not found");
  }

  const newFloor = task.type === CleaningTaskType.TRASH_D7 ? replacementUser.floor : task.floor;

  // Attempt to update Google Calendar. If this fails, log and continue — the DB is
  // authoritative for released tasks, and the sync will respect the UNAVAILABLE record
  // set below to avoid overwriting with stale calendar data.
  if (task.calendarId && task.calendarEventId) {
    const target = getCleaningCalendarTarget(task.type, { floor: newFloor });
    if (target) {
      try {
        await updateCleaningCalendarEvent({
          calendarId: task.calendarId,
          eventId: task.calendarEventId,
          title: target.title,
          scheduledDate: task.scheduledDate,
          userEmail: replacementUser.email,
          userName: replacementUser.name,
          branchId: replacementUser.branchId,
          floor: newFloor,
          rewardCoins: task.rewardCoins,
          type: task.type,
          status: task.status,
          completedAt: task.completedAt,
          completionNote: task.completionNote,
          completionPhoto: task.completionPhoto,
          auditorNote: task.auditorNote
        });
      } catch (calendarError) {
        console.error("[releaseCleaningTask] Google Calendar update failed, proceeding with DB release:", calendarError);
      }
    }
  }

  const releasedAvailabilityNote = task.isSelfAssigned
    ? "Released self-assigned cleaning task"
    : "Released cleaning task";

  const reassignedTask = await prisma.$transaction(async (tx) => {
    const updatedAvailability = await tx.cleaningAvailability.upsert({
      where: {
        userEmail_date: {
          userEmail: normalizedEmail,
          date: normalizeCalendarDate(task.scheduledDate)
        }
      },
      update: {
        branchId: task.branchId,
        floor: task.floor,
        type: CleaningAvailabilityType.UNAVAILABLE,
        note: releasedAvailabilityNote
      },
      create: {
        userEmail: normalizedEmail,
        branchId: task.branchId,
        floor: task.floor,
        date: normalizeCalendarDate(task.scheduledDate),
        type: CleaningAvailabilityType.UNAVAILABLE,
        note: releasedAvailabilityNote
      }
    });

    const updatedTask = await tx.cleaningTask.update({
      where: { id: task.id },
      data: {
        userEmail: replacementUser.email,
        userName: replacementUser.name,
        branchId: replacementUser.branchId,
        floor: newFloor
      }
    });

    void updatedAvailability;
    return updatedTask;
  });
  await logAction({
    actorEmail: normalizedEmail,
    actorName: task.userName ?? normalizedEmail,
    actorRole: "resident",
    action: "cleaning.task.release",
    entityType: "CleaningTask",
    entityId: reassignedTask.id,
    entityLabel: `${reassignedTask.type}|${reassignedTask.scheduledDate.toISOString().slice(0, 10)}`,
    details: `replacement=${replacement.email}; penalty=${releasePenalty.fineAmount}`
  });

  if (releasePenalty.fineAmount > 0) {
    await createAutomaticFineForEmail({
      email: normalizedEmail,
      amount: releasePenalty.fineAmount,
      content: "Late cleaning cancellation",
      description: `Late release for ${formatTaskTypeForFine(task.type)} scheduled on ${formatTaskDateForFine(task.scheduledDate)}. ${releasePenalty.message}`,
      location: task.branchId,
      operator: "Cleaning schedule system"
    });
  }

  await invalidateCleaningOverviewCache(normalizedEmail);
  await invalidateCleaningOverviewCache(replacement.email);

  // Auto-reassign the releasing user to the next available date of the same type
  void autoReassignReleasedUser({
    email: normalizedEmail,
    releasedDate: task.scheduledDate,
    type: task.type,
    floor: task.floor
  }).catch((err) => {
    console.warn("[releaseCleaningTask] auto-reassign failed:", err instanceof Error ? err.message : err);
  });

  return {
    task: reassignedTask,
    penalty: {
      fineRate: releasePenalty.fineRate,
      fineAmount: releasePenalty.fineAmount,
      message: releasePenalty.message
    }
  };
}

async function buildCleaningOverviewForUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const today = normalizeCalendarDate(new Date());
  const syncFrom = addMonths(today, -6);
  const syncTo = addMonths(today, 12);

  await syncCleaningCalendarWindow(syncFrom, syncTo);

  const tasks = await findManyCleaningTasks({
    where: {
      userEmail: normalizedEmail
    },
    orderBy: {
      scheduledDate: "asc"
    }
  });

  const availability = await prisma.cleaningAvailability.findMany({
    where: {
      userEmail: normalizedEmail
    },
    orderBy: {
      date: "asc"
    }
  });

  const user = await getUserCleaningContext(normalizedEmail);

  // Fetch upcoming slots taken by OTHER users so the frontend can color the calendar
  const upcomingOccupiedTasks = await prisma.cleaningTask.findMany({
    where: {
      scheduledDate: {
        gte: today,
        lte: addMonths(today, 3)
      },
      userEmail: { not: normalizedEmail },
      status: { in: [CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.DONE_PENDING_AUDIT] }
    },
    select: {
      type: true,
      scheduledDate: true,
      floor: true
    }
  });

  const occupiedSlots = upcomingOccupiedTasks.map((task) => ({
    date: formatCalendarDate(task.scheduledDate),
    type: task.type,
    floor: task.floor
  }));

  const currentMonth = cleaningMonthKeyFromDate(today);
  const contractOptOut = await getContractCleaningOptOutByContractCode(getUserContractCode(user));
  const optOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: currentMonth }
  });

  const releasesThisMonth = await countReleasesThisMonth(normalizedEmail);
  const rewardSettings = await getCleaningRewardSettings();
  const holidayYear = today.getUTCFullYear();
  const holidays = listVietnamHolidays(holidayYear - 1, holidayYear + 1);

  return {
    user,
    tasks,
    availability,
    occupiedSlots,
    contractOptOut,
    optOut: optOut ? { month: optOut.month, paymentMethod: optOut.paymentMethod } : null,
    releasesThisMonth,
    monthlyReleaseLimit: MONTHLY_RELEASE_LIMIT,
    selfAssignMaxDaysAhead: SELF_ASSIGN_MAX_DAYS_AHEAD,
    rewardMultipliers: {
      selfAssign: rewardSettings.selfAssignBonusMultiplier,
      weekend: rewardSettings.selfAssignWeekendMultiplier,
      holiday: rewardSettings.selfAssignHolidayMultiplier
    },
    holidays
  };
}

async function fetchFreshOccupiedSlots(normalizedEmail: string) {
  const today = new Date();
  const upcomingOccupiedTasks = await prisma.cleaningTask.findMany({
    where: {
      scheduledDate: {
        gte: today,
        lte: addMonths(today, 3)
      },
      userEmail: { not: normalizedEmail },
      status: { in: [CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.DONE_PENDING_AUDIT] }
    },
    select: {
      type: true,
      scheduledDate: true,
      floor: true
    }
  });
  return upcomingOccupiedTasks.map((task) => ({
    date: formatCalendarDate(task.scheduledDate),
    type: task.type,
    floor: task.floor
  }));
}

export async function getCleaningOverviewForUser(email: string, options?: { forceRefresh?: boolean }) {
  const normalizedEmail = email.trim().toLowerCase();
  const memoryCached = cleaningOverviewMemoryCache.get(normalizedEmail);
  const fileCache = await readCleaningOverviewCacheFile();
  const fileCached = fileCache?.entries?.[normalizedEmail];

  if (!options?.forceRefresh) {
    if (memoryCached) {
      // occupiedSlots depends on all users' tasks — always fetch fresh to avoid stale slot visibility
      const occupiedSlots = await fetchFreshOccupiedSlots(normalizedEmail);
      return { ...memoryCached, occupiedSlots };
    }

    if (fileCached) {
      cleaningOverviewMemoryCache.set(normalizedEmail, fileCached);
      const occupiedSlots = await fetchFreshOccupiedSlots(normalizedEmail);
      return { ...fileCached, occupiedSlots };
    }
  }

  try {
    const overview = await buildCleaningOverviewForUser(normalizedEmail);
    await saveCleaningOverviewToCache(normalizedEmail, overview);
    return overview;
  } catch (error) {
    if (memoryCached) {
      return memoryCached;
    }
    if (fileCached) {
      cleaningOverviewMemoryCache.set(normalizedEmail, fileCached);
      return fileCached;
    }
    throw error;
  }
}

export async function getAdminCleaningTasks(from?: Date, to?: Date) {
  return findManyCleaningTasks({
    where: {
      ...(from || to
        ? {
            scheduledDate: {
              ...(from ? { gte: calendarRangeStart(normalizeCalendarDate(from)) } : {}),
              ...(to ? { lte: calendarRangeEnd(normalizeCalendarDate(to)) } : {})
            }
          }
        : {})
    },
    include: {
      audits: {
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    orderBy: [{ scheduledDate: "asc" }, { branchId: "asc" }]
  });
}

export async function getAdminCleaningCalendars(from?: Date, to?: Date) {
  const definitions = getConfiguredCleaningCalendars();
  const tasks = await getAdminCleaningTasks(from, to);
  const activeUsers = await getActiveCleaningUsers();
  const bedLineByEmail = new Map(
    activeUsers.map((user) => [user.email.trim().toLowerCase(), formatCleaningUserBedLine(user)])
  );

  return definitions.map((definition) => ({
    ...definition,
    tasks: tasks
      .filter((task) => {
        if (task.type !== definition.type) {
          return false;
        }
        if (definition.type !== CleaningTaskType.TRASH_D7) {
          return true;
        }
        return task.floor === definition.floor;
      })
      .map((task) => ({
        ...task,
        bedDisplay: bedLineByEmail.get(task.userEmail.trim().toLowerCase()) ?? null
      }))
  }));
}

export async function getAvailableUsersForAdminSlot(input: {
  date: Date;
  type: CleaningTaskType;
  floor?: number | null;
  excludeEmails?: string[];
  showAll?: boolean;
}) {
  const normalizedDate = normalizeCalendarDate(input.date);
  if (!isFutureCalendarDate(normalizedDate)) {
    throw new Error("Admin assignment is only available for future dates");
  }
  const excludedEmails = new Set((input.excludeEmails ?? []).map((email) => email.trim().toLowerCase()));
  const activeUsers = await getActiveCleaningUsers();
  const contractOptOutLookup = await getContractCleaningOptOutLookup(activeUsers.map((user) => getUserContractCode(user)));
  const monthKey = cleaningMonthKeyFromDate(normalizedDate);
  const monthlyOptOutEmails = await getOptedOutEmailsForMonth(monthKey);
  const availabilityMap = await getAvailabilityMap(normalizedDate, normalizedDate);
  const occupiedTasks = await findManyCleaningTasks({
    where: {
      scheduledDate: {
        gte: calendarRangeStart(normalizedDate),
        lte: calendarRangeEnd(normalizedDate)
      }
    }
  });
  const fairnessSince = addDays(normalizeCalendarDate(new Date()), -CLEANING_FAIRNESS_LOOKBACK_DAYS);
  const correctionSince = addDays(normalizeCalendarDate(new Date()), -CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS);
  const [recentTaskCounts, correctionPenalties, allAvailability, allTasks] = await Promise.all([
    getRecentTaskCountsByType(fairnessSince),
    getCorrectionPenalties(correctionSince),
    prisma.cleaningAvailability.findMany({
      where: {
        type: {
          in: [CleaningAvailabilityType.AVAILABLE, CleaningAvailabilityType.PREFERRED]
        }
      }
    }),
    findManyCleaningTasks({})
  ]);
  const normalizedDateKey = normalizeCalendarDate(normalizedDate).toISOString();
  const slotFloor = input.type === CleaningTaskType.TRASH_D7 ? input.floor : null;

  const candidates: CleaningAvailableUser[] = [];

  for (const user of activeUsers) {
    if (excludedEmails.has(user.email)) {
      continue;
    }
    if (contractOptOutLookup.has(getUserContractCode(user))) {
      continue;
    }
    if (monthlyOptOutEmails.has(user.email.toLowerCase())) {
      continue;
    }

    if (!isUserEligibleForCleaningSlot(user, input.type, slotFloor)) {
      continue;
    }

    const availabilityType = availabilityMap.get(`${user.email}|${normalizedDateKey}`)?.type ?? null;
    if (!input.showAll && availabilityType === CleaningAvailabilityType.UNAVAILABLE) {
      continue;
    }

    const sameDayTasks = occupiedTasks
      .filter((task) => task.userEmail.toLowerCase() === user.email)
      .map((task) => ({
        id: task.id,
        type: task.type,
        scheduledDate: task.scheduledDate
      }));
    const availabilityCount = allAvailability.filter((entry) => entry.userEmail.toLowerCase() === user.email).length;
    const totalTaskCount = allTasks.filter((task) => task.userEmail.toLowerCase() === user.email).length;

    candidates.push({
      email: user.email,
      name: user.name,
      bedDisplay: formatCleaningUserBedLine(user),
      branchId: user.branchId,
      floor: user.floor,
      availabilityType,
      availabilityCount,
      totalTaskCount,
      recentTypeTaskCount: getRecentTypeTaskCount(recentTaskCounts, user.email, input.type),
      correctionPenalty: correctionPenalties.get(user.email.toLowerCase()) ?? 0,
      hasSameDayTask: sameDayTasks.length > 0,
      sameDayTasks
    });
  }

  return candidates.sort((left, right) =>
    compareCleaningCandidateRank(left, right, {
      type: input.type,
      recentTaskCounts,
      correctionPenalties
    })
  );
}

export async function adminAssignCleaningTask(input: {
  email: string;
  date: Date;
  type: CleaningTaskType;
  floor?: number | null;
  force?: boolean;
  actorEmail?: string;
  actorName?: string | null;
  correction?: CorrectionPayload | null;
}) {
  if (!isFutureCalendarDate(input.date)) {
    throw new Error("Admin assignment is only available for future dates");
  }
  const user = await getUserCleaningContext(input.email);
  if (!user) {
    throw new Error("Active user not found for admin assignment");
  }

  const contractOptOut = await getContractCleaningOptOutByContractCode(getUserContractCode(user));
  if (contractOptOut) {
    throw new Error("This user is opted out of cleaning for the current contract.");
  }

  const normalizedDate = normalizeCalendarDate(input.date);
  const slotFloor =
    input.type === CleaningTaskType.TRASH_D7 && typeof input.floor === "number" ? input.floor : undefined;

  const existingSlot = await findFirstCleaningTask({
    where: {
      type: input.type,
      scheduledDate: {
        gte: calendarRangeStart(normalizedDate),
        lte: calendarRangeEnd(normalizedDate)
      },
      ...(typeof slotFloor === "number" ? { floor: slotFloor } : {})
    }
  });

  const replacingDifferentUser =
    !!existingSlot &&
    existingSlot.status === CleaningTaskStatus.ASSIGNED &&
    existingSlot.userEmail.toLowerCase() !== input.email.trim().toLowerCase();
  const isSystemCorrection =
    replacingDifferentUser && existingSlot?.assignmentSource === CleaningAssignmentSource.SYSTEM;
  const needsCorrectionFeedback = Boolean(input.force || isSystemCorrection);

  if (needsCorrectionFeedback && !input.correction) {
    throw new Error("Correction reason is required when fixing auto-schedule or overriding a same-day conflict.");
  }

  const availability = await prisma.cleaningAvailability.findUnique({
    where: {
      userEmail_date: {
        userEmail: input.email.trim().toLowerCase(),
        date: normalizedDate
      }
    }
  });
  if (!input.force && availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
    throw new Error("This user marked the date as unavailable");
  }

  const assignMonth = cleaningMonthKeyFromDate(input.date);
  const monthlyOptOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: input.email.trim().toLowerCase(), month: assignMonth }
  });
  if (monthlyOptOut) {
    throw new Error("This user has opted out of cleaning for this month.");
  }

  if (!isUserEligibleForCleaningSlot(user, input.type, input.type === CleaningTaskType.TRASH_D7 ? input.floor : null)) {
    throw new Error("This user is not eligible for that cleaning slot (branch / floor).");
  }

  const assignedTask = await assignTaskToUser({
    user,
    date: normalizedDate,
    type: input.type,
    floor: slotFloor,
    allowSameDayOverride: input.force,
    assignmentSource: CleaningAssignmentSource.MANAGER,
    assignedByEmail: input.actorEmail?.trim().toLowerCase() ?? null,
    assignedByName: input.actorName?.trim() || "Cozoro"
  });
  await logAction({
    actorEmail: input.actorEmail?.trim().toLowerCase() ?? null,
    actorName: input.actorName?.trim() || "Cozoro",
    actorRole: "manager",
    action: "cleaning.task.assign",
    entityType: "CleaningTask",
    entityId: assignedTask.id,
    entityLabel: `${assignedTask.type}|${assignedTask.scheduledDate.toISOString().slice(0, 10)}`,
    details: `target=${assignedTask.userEmail}`
  });

  if (input.correction && (needsCorrectionFeedback || replacingDifferentUser)) {
    await recordCleaningScheduleCorrection({
      action: inferCorrectionAction({
        force: input.force,
        previousSource: existingSlot?.assignmentSource ?? null,
        hadPreviousAssignee: replacingDifferentUser
      }),
      taskId: assignedTask.id,
      slotKey: assignedTask.slotKey,
      taskType: assignedTask.type,
      scheduledDate: assignedTask.scheduledDate,
      floor: assignedTask.floor,
      previousUserEmail: existingSlot?.userEmail ?? null,
      previousUserName: existingSlot?.userName ?? null,
      previousSource: existingSlot?.assignmentSource ?? null,
      newUserEmail: assignedTask.userEmail,
      actorEmail: input.actorEmail?.trim().toLowerCase() || "unknown",
      actorName: input.actorName?.trim() || "Cozoro",
      correction: input.correction
    });
  }

  return assignedTask;
}

export async function adminAutoAssignCleaningSlots(input: {
  dates: Date[];
  type: CleaningTaskType;
  floor?: number | null;
  actorEmail?: string;
  actorName?: string | null;
}) {
  const today = normalizeCalendarDate(new Date());
  const activeUsers = (await getActiveCleaningUsers()).filter((user) => !isHostelShortTermCleaningUser(user));
  const contractOptOutLookup = await getContractCleaningOptOutLookup(activeUsers.map((user) => getUserContractCode(user)));
  const eligibleActiveUsers = activeUsers.filter((user) => !contractOptOutLookup.has(getUserContractCode(user)));
  const fairnessSince = addDays(today, -CLEANING_FAIRNESS_LOOKBACK_DAYS);
  const correctionSince = addDays(today, -CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS);
  const [recentTaskCounts, correctionPenalties] = await Promise.all([
    getRecentTaskCountsByType(fairnessSince),
    getCorrectionPenalties(correctionSince)
  ]);
  const results: CleaningTaskRecord[] = [];
  const reservedEmails = new Set<string>();

  for (const date of input.dates) {
    const normalizedDate = normalizeCalendarDate(date);
    if (!isFutureCalendarDate(normalizedDate)) {
      continue;
    }
    if (input.type === CleaningTaskType.TRASH_D7 && typeof input.floor !== "number") {
      continue;
    }
    const monthOptOuts = await getOptedOutEmailsForMonth(cleaningMonthKeyFromDate(normalizedDate));
    const usersForDate = eligibleActiveUsers.filter((user) => !monthOptOuts.has(user.email.toLowerCase()));

    const availabilityMap = await getAvailabilityMap(normalizedDate, normalizedDate);
    const occupiedTasks = await findManyCleaningTasks({
      where: {
        scheduledDate: {
          gte: calendarRangeStart(normalizedDate),
          lte: calendarRangeEnd(normalizedDate)
        }
      }
    });

    const existingSlot = await findFirstCleaningTask({
      where: {
        type: input.type,
        scheduledDate: {
          gte: calendarRangeStart(normalizedDate),
          lte: calendarRangeEnd(normalizedDate)
        },
        ...(input.type === CleaningTaskType.TRASH_D7 && typeof input.floor === "number" ? { floor: input.floor } : {})
      }
    });

    if (existingSlot) {
      continue;
    }

    const candidates = await getAssignableCandidates(
      usersForDate,
      availabilityMap,
      normalizedDate,
      input.type,
      occupiedTasks,
      input.type === CleaningTaskType.TRASH_D7 ? input.floor : undefined,
      recentTaskCounts,
      correctionPenalties
    ).then((entries) => entries.filter((user) => !reservedEmails.has(user.email)));
    const selectedUser = candidates[0];
    if (!selectedUser) {
      continue;
    }

    const assignedTask = await assignTaskToUser({
      user: selectedUser,
      date: normalizedDate,
      type: input.type,
      floor:
        input.type === CleaningTaskType.TRASH_D7 && typeof input.floor === "number"
          ? input.floor
          : undefined,
      assignmentSource: CleaningAssignmentSource.MANAGER,
      assignedByEmail: input.actorEmail?.trim().toLowerCase() ?? null,
      assignedByName: input.actorName?.trim() || "Cozoro"
    });
    await logAction({
      actorEmail: input.actorEmail?.trim().toLowerCase() ?? null,
      actorName: input.actorName?.trim() || "Cozoro",
      actorRole: "manager",
      action: "cleaning.task.auto_assign",
      entityType: "CleaningTask",
      entityId: assignedTask.id,
      entityLabel: `${assignedTask.type}|${assignedTask.scheduledDate.toISOString().slice(0, 10)}`,
      details: `target=${assignedTask.userEmail}`
    });
    reservedEmails.add(selectedUser.email);
    bumpRecentTypeTaskCount(recentTaskCounts, selectedUser.email, input.type);
    results.push(assignedTask);
  }

  return results;
}

export async function adminRemoveCleaningTask(
  taskId: string,
  actorEmail?: string,
  actorName?: string | null,
  correction?: CorrectionPayload | null
) {
  const task = await findUniqueCleaningTask({ where: { id: taskId } });
  if (!task) {
    throw new Error("Cleaning task not found");
  }

  if (!canReleaseCalendarDate(task.scheduledDate)) {
    throw new Error("Cleaning tasks cannot be removed after the scheduled date has passed.");
  }

  const isSystemCorrection = task.assignmentSource === CleaningAssignmentSource.SYSTEM;
  if (isSystemCorrection && !correction) {
    throw new Error("Correction reason is required when removing an auto-scheduled task.");
  }

  if (task.calendarId && task.calendarEventId) {
    try {
      await deleteCleaningCalendarEvent({
        calendarId: task.calendarId,
        eventId: task.calendarEventId
      });
    } catch (calErr) {
      // If the calendar event is already gone (404/410), proceed with DB deletion
      const msg = calErr instanceof Error ? calErr.message : String(calErr);
      const isGone = /404|410|not found|Resource has been deleted/i.test(msg);
      if (!isGone) throw calErr;
    }
  }

  if (correction && (isSystemCorrection || correction.reasonIds?.length || correction.newReasonLabel)) {
    await recordCleaningScheduleCorrection({
      action: CleaningScheduleCorrectionAction.REMOVE,
      taskId: task.id,
      slotKey: task.slotKey,
      taskType: task.type,
      scheduledDate: task.scheduledDate,
      floor: task.floor,
      previousUserEmail: task.userEmail,
      previousUserName: task.userName,
      previousSource: task.assignmentSource,
      newUserEmail: null,
      actorEmail: actorEmail?.trim().toLowerCase() || "unknown",
      actorName: actorName?.trim() || "Cozoro",
      correction
    });
  }

  await deleteCleaningTask({ where: { id: taskId } });
  await logAction({
    actorEmail: actorEmail?.trim().toLowerCase() ?? null,
    actorName: actorName?.trim() || "Cozoro",
    actorRole: "manager",
    action: "cleaning.task.delete",
    entityType: "CleaningTask",
    entityId: taskId,
    entityLabel: `${task.type}|${task.scheduledDate.toISOString().slice(0, 10)}`
  });
  await invalidateCleaningOverviewCache(task.userEmail);
  return { id: taskId, removed: true };
}

async function deleteAssignedCleaningTaskForDeparture(
  task: {
    id: string;
    userEmail: string;
    type: CleaningTaskType;
    scheduledDate: Date;
    calendarId: string | null;
    calendarEventId: string | null;
  },
  reason: string
) {
  if (task.calendarId && task.calendarEventId) {
    try {
      await deleteCleaningCalendarEvent({
        calendarId: task.calendarId,
        eventId: task.calendarEventId
      });
    } catch (calErr) {
      const msg = calErr instanceof Error ? calErr.message : String(calErr);
      const isGone = /404|410|not found|Resource has been deleted/i.test(msg);
      if (!isGone) {
        console.warn(
          `[cleaning-purge] calendar delete failed for ${task.id}: ${msg}`
        );
      }
    }
  }

  await deleteCleaningTask({ where: { id: task.id } });
  await logAction({
    actorEmail: null,
    actorName: "System",
    actorRole: "system",
    action: "cleaning.task.purge_on_departure",
    entityType: "CleaningTask",
    entityId: task.id,
    entityLabel: `${task.type}|${task.scheduledDate.toISOString().slice(0, 10)}`,
    details: reason
  });
}

/**
 * Remove today+future ASSIGNED cleaning tasks and cancel open swap requests for a resident.
 * Used when a contract ends, is terminated, or the resident is marked inactive.
 */
export async function purgeResidentCleaningSchedule(
  email: string,
  options?: { reason?: string }
): Promise<{ removedTaskIds: string[]; cancelledSwapIds: string[] }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { removedTaskIds: [], cancelledSwapIds: [] };
  }

  const reason = options?.reason?.trim() || "resident-departed";
  const today = normalizeCalendarDate(new Date());
  const tasks = await findManyCleaningTasks({
    where: {
      userEmail: normalized,
      status: CleaningTaskStatus.ASSIGNED,
      scheduledDate: { gte: calendarRangeStart(today) }
    },
    orderBy: { scheduledDate: "asc" }
  });

  const removedTaskIds: string[] = [];
  for (const task of tasks) {
    await deleteAssignedCleaningTaskForDeparture(task, reason);
    removedTaskIds.push(task.id);
  }

  const pendingSwaps = await prisma.cleaningSwapRequest.findMany({
    where: {
      status: CleaningSwapRequestStatus.PENDING,
      OR: [{ requesterEmail: normalized }, { targetEmail: normalized }]
    },
    select: { id: true }
  });
  const cancelledSwapIds: string[] = [];
  if (pendingSwaps.length > 0) {
    await prisma.cleaningSwapRequest.updateMany({
      where: { id: { in: pendingSwaps.map((row) => row.id) } },
      data: { status: CleaningSwapRequestStatus.CANCELLED, cancelledAt: new Date() }
    });
    for (const row of pendingSwaps) {
      cancelledSwapIds.push(row.id);
    }
  }

  if (removedTaskIds.length > 0 || cancelledSwapIds.length > 0) {
    await invalidateCleaningOverviewCache(normalized);
    console.log(
      `[cleaning-purge] email=${normalized} removedTasks=${removedTaskIds.length} cancelledSwaps=${cancelledSwapIds.length} reason=${reason}`
    );
  }

  return { removedTaskIds, cancelledSwapIds };
}

/** Purge only when the resident is no longer eligible (inactive / contract ended). */
export async function purgeResidentCleaningScheduleIfIneligible(
  email: string,
  options?: { reason?: string; force?: boolean }
): Promise<{ removedTaskIds: string[]; cancelledSwapIds: string[]; skipped: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!options?.force) {
    const eligible = await isResidentEligibleForCleaningSchedule(normalized);
    if (eligible) {
      return { removedTaskIds: [], cancelledSwapIds: [], skipped: true };
    }
  }
  const result = await purgeResidentCleaningSchedule(normalized, {
    reason: options?.reason ?? "confirmed-departure-or-inactive"
  });
  return { ...result, skipped: false };
}

/**
 * Safety net: clear future schedules only for residents who confirmed checkout
 * or no longer have an active client row.
 */
export async function sweepLeftResidentCleaningSchedules(now = new Date()) {
  const today = normalizeCalendarDate(now);
  const futureAssigned = await findManyCleaningTasks({
    where: {
      status: CleaningTaskStatus.ASSIGNED,
      scheduledDate: { gte: calendarRangeStart(today) }
    },
    select: { userEmail: true }
  });

  const emails = [...new Set(futureAssigned.map((task) => task.userEmail.trim().toLowerCase()).filter(Boolean))];
  let removedTasks = 0;
  let purgedEmails = 0;
  const details: Array<{ email: string; removed: number }> = [];

  for (const email of emails) {
    const result = await purgeResidentCleaningScheduleIfIneligible(email, {
      reason: "left-resident-cleaning-sweep"
    });
    if (result.removedTaskIds.length > 0) {
      purgedEmails += 1;
      removedTasks += result.removedTaskIds.length;
      details.push({ email, removed: result.removedTaskIds.length });
    }
  }

  return {
    scannedEmails: emails.length,
    purgedEmails,
    removedTasks,
    details
  };
}

export async function completeCleaningTask(taskId: string, email: string, note?: string, photo?: string) {
  const task = await findUniqueCleaningTask({
    where: { id: taskId }
  });

  if (!task) {
    throw new Error("Cleaning task not found");
  }

  if (task.userEmail.toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error("You can only complete your own cleaning task");
  }

  const isLate = !canCompleteTaskNow(task) && canCompleteTaskLate(task);

  if (!canCompleteTaskNow(task) && !isLate) {
    const { lateEnd } = getLateCompletionWindow(task);
    throw new Error(
      `This task can only be marked done during ${getCompletionWindow(task).label}, or up to ${LATE_COMPLETION_HOURS} hours after the deadline (before ${lateEnd.toISOString()}).`
    );
  }

  const lateRewardCoins = isLate ? Math.round(task.rewardCoins * LATE_COMPLETION_REWARD_RATE) : task.rewardCoins;
  const lateNote = isLate
    ? `[Late submission — ${LATE_COMPLETION_REWARD_RATE * 100}% reward applied]${note ? ` ${note}` : ""}`
    : note;

  const updated = await updateCleaningTask({
    where: { id: taskId },
    data: {
      status: CleaningTaskStatus.DONE_PENDING_AUDIT,
      completedAt: new Date(),
      completionNote: lateNote,
      completionPhoto: photo,
      rewardCoins: lateRewardCoins
    }
  });
  await logAction({
    actorEmail: email.trim().toLowerCase(),
    actorName: task.userName ?? task.userEmail,
    actorRole: "resident",
    action: "cleaning.task.complete",
    entityType: "CleaningTask",
    entityId: updated.id,
    entityLabel: `${updated.type}|${updated.scheduledDate.toISOString().slice(0, 10)}`,
    details: isLate ? "late=true" : "late=false"
  });

  if (updated.calendarId && updated.calendarEventId) {
    const target = getCleaningCalendarTarget(updated.type, { floor: updated.floor });
    if (target) {
      await updateCleaningCalendarEvent({
        calendarId: updated.calendarId,
        eventId: updated.calendarEventId,
        title: target.title,
        scheduledDate: updated.scheduledDate,
        userEmail: updated.userEmail,
        userName: updated.userName,
        branchId: updated.branchId,
        floor: updated.floor,
        rewardCoins: updated.rewardCoins,
        type: updated.type,
        status: CleaningTaskStatus.DONE_PENDING_AUDIT,
        completedAt: updated.completedAt,
        completionNote: updated.completionNote,
        completionPhoto: updated.completionPhoto,
        auditorNote: updated.auditorNote
      });
    }
  }

  await invalidateCleaningOverviewCache(updated.userEmail);
  return updated;
}

export async function auditCleaningTask(input: {
  taskId: string;
  reviewer: string;
  decision: CleaningAuditDecision;
  note?: string;
}) {
  const task = await findUniqueCleaningTask({
    where: { id: input.taskId }
  });

  if (!task) {
    throw new Error("Cleaning task not found");
  }

  const nextStatus =
    input.decision === CleaningAuditDecision.APPROVE
      ? CleaningTaskStatus.APPROVED
      : CleaningTaskStatus.REJECTED;

  const updatedTask = await prisma.$transaction(async (tx) => {
    const updated = await tx.cleaningTask.update({
      where: { id: input.taskId },
      data: {
        status: nextStatus,
        auditorNote: input.note
      }
    });

    await tx.cleaningAudit.create({
      data: {
        taskId: input.taskId,
        reviewer: input.reviewer,
        decision: input.decision,
        note: input.note
      }
    });

    if (input.decision === CleaningAuditDecision.APPROVE) {
      await tx.coinLedger.create({
        data: {
          userId: updated.userEmail,
          delta: updated.rewardCoins,
          reason: CoinReason.CLEANING_REWARD,
          refType: "cleaning_task",
          refId: updated.id
        }
      });
    }

    if (input.decision === CleaningAuditDecision.REJECT) {
      const existingReward = await tx.coinLedger.findFirst({
        where: {
          refType: "cleaning_task",
          refId: updated.id,
          reason: CoinReason.CLEANING_REWARD
        }
      });

      if (existingReward) {
        await tx.coinLedger.create({
          data: {
            userId: updated.userEmail,
            delta: -updated.rewardCoins,
            reason: CoinReason.CLEANING_REVERSAL,
            refType: "cleaning_task",
            refId: updated.id
          }
        });
      }
    }

    await (tx as any).actionLog.create({
      data: {
        actorEmail: input.reviewer.trim().toLowerCase(),
        actorName: input.reviewer.trim(),
        actorRole: "manager",
        action: "cleaning.task.audit",
        entityType: "CleaningTask",
        entityId: updated.id,
        entityLabel: `${updated.type}|${updated.scheduledDate.toISOString().slice(0, 10)}`,
        details: `${input.decision}${input.note ? `; note=${input.note}` : ""}`
      }
    });

    return updated;
  });

  if (updatedTask.calendarId && updatedTask.calendarEventId) {
    const target = getCleaningCalendarTarget(updatedTask.type, { floor: updatedTask.floor });
    if (target) {
      await updateCleaningCalendarEvent({
        calendarId: updatedTask.calendarId,
        eventId: updatedTask.calendarEventId,
        title: target.title,
        scheduledDate: updatedTask.scheduledDate,
        userEmail: updatedTask.userEmail,
        userName: updatedTask.userName,
        branchId: updatedTask.branchId,
        floor: updatedTask.floor,
        rewardCoins: updatedTask.rewardCoins,
        type: updatedTask.type,
        status: updatedTask.status,
        completedAt: updatedTask.completedAt,
        completionNote: updatedTask.completionNote,
        completionPhoto: updatedTask.completionPhoto,
        auditorNote: updatedTask.auditorNote,
        reviewedBy: input.reviewer
      });
    }
  }

  if (input.decision === CleaningAuditDecision.APPROVE) {
    await awardCleaningCoinsToSheet({
      userEmail: updatedTask.userEmail,
      userName: updatedTask.userName,
      branchId: updatedTask.branchId,
      rewardCoins: updatedTask.rewardCoins,
      taskId: updatedTask.id,
      reviewedBy: input.reviewer
    });
  }

  await invalidateCleaningOverviewCache(updatedTask.userEmail);
  return updatedTask;
}

function getMissedCleaningFineThresholdDate(task: CleaningTaskRecord) {
  const completionWindow = getCompletionWindow(task);
  return new Date(completionWindow.windowEnd.getTime() + 12 * 60 * 60 * 1000);
}

function isAssignedTaskPastMissedFineDeadline(task: CleaningTaskRecord, now: Date) {
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    return false;
  }
  return getMissedCleaningFineThresholdDate(task).getTime() <= now.getTime();
}

async function markAssignedTaskMissedWithFine(
  currentTask: CleaningTaskRecord,
  knownFines: Awaited<ReturnType<typeof getManagerFines>>,
  now: Date,
  operatorLabel: string,
  customAmount?: number
) {
  const existingFine = knownFines.find((entry) => isAutomaticCleaningFineForTask(entry.row, currentTask.id));
  const fineAmount = customAmount != null
    ? customAmount
    : existingFine
      ? parseFineAmount(existingFine.row[FINE_AMOUNT_COLUMN])
      : await getMissedCleaningFineAmount(currentTask, knownFines);
  const fineContent = getAutomaticCleaningFineContent(currentTask.type);
  const fineDescription = getAutomaticCleaningFineDescription(currentTask, now);

  if (!existingFine) {
    await createAutomaticFineForEmail({
      email: currentTask.userEmail,
      amount: fineAmount,
      content: fineContent,
      description: fineDescription,
      location:
        currentTask.type === CleaningTaskType.TRASH_D7 && currentTask.floor
          ? `${currentTask.branchId} floor ${currentTask.floor}`
          : currentTask.branchId,
      operator: operatorLabel
    });

    knownFines.push({
      row: {
        EMAIL: currentTask.userEmail,
        [FINE_TIMESTAMP_COLUMN]: now.toISOString(),
        [FINE_CONTENT_COLUMN]: fineContent,
        [FINE_DESCRIPTION_COLUMN]: fineDescription,
        [FINE_AMOUNT_COLUMN]: String(fineAmount)
      },
      parsedTimestamp: now.toISOString(),
      parsedDueDate: null,
      coinPayment: {
        coinCost: 0,
        currentCoins: 0,
        canPay: false,
        recordedMember: "",
        multiplier: 1,
        isPaid: false
      }
    });

    await logAction({
      actorEmail: operatorLabel === AUTO_CLEANING_FINE_OPERATOR ? null : operatorLabel,
      actorRole: operatorLabel === AUTO_CLEANING_FINE_OPERATOR ? "system" : "manager",
      action: "cleaning.task.missed_fine",
      entityType: "CleaningTask",
      entityId: currentTask.id,
      entityLabel: `${currentTask.type}|${currentTask.scheduledDate.toISOString().slice(0, 10)}`,
      details: `fineAmount=${fineAmount}`
    });
  }

  const missedTask = await updateCleaningTask({
    where: { id: currentTask.id },
    data: {
      status: CleaningTaskStatus.MISSED,
      auditorNote: `${operatorLabel === AUTO_CLEANING_FINE_OPERATOR ? "Auto-marked" : "Marked"} as missed on ${now.toISOString()}. Fine amount: ${fineAmount} VND.`
    }
  });
  await logAction({
    actorEmail: operatorLabel === AUTO_CLEANING_FINE_OPERATOR ? null : operatorLabel,
    actorRole: operatorLabel === AUTO_CLEANING_FINE_OPERATOR ? "system" : "manager",
    action: "cleaning.task.missed",
    entityType: "CleaningTask",
    entityId: missedTask.id,
    entityLabel: `${missedTask.type}|${missedTask.scheduledDate.toISOString().slice(0, 10)}`,
    details: `fineAmount=${fineAmount}`
  });

  if (missedTask.calendarId && missedTask.calendarEventId) {
    const target = getCleaningCalendarTarget(missedTask.type, { floor: missedTask.floor });
    if (target) {
      await updateCleaningCalendarEvent({
        calendarId: missedTask.calendarId,
        eventId: missedTask.calendarEventId,
        title: target.title,
        scheduledDate: missedTask.scheduledDate,
        userEmail: missedTask.userEmail,
        userName: missedTask.userName,
        branchId: missedTask.branchId,
        floor: missedTask.floor,
        rewardCoins: missedTask.rewardCoins,
        type: missedTask.type,
        status: missedTask.status,
        completedAt: missedTask.completedAt,
        completionNote: missedTask.completionNote,
        completionPhoto: missedTask.completionPhoto,
        auditorNote: missedTask.auditorNote
      });
    }
  }

  await invalidateCleaningOverviewCache(missedTask.userEmail);
  return { missedTask, fineAmount };
}

export async function adminMarkMissedCleaningTaskFine(taskId: string, operatorEmail: string, customAmount?: number) {
  const now = new Date();
  const task = await findUniqueCleaningTask({ where: { id: taskId } });
  if (!task) {
    throw new Error("Cleaning task not found");
  }
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    throw new Error("Only assigned tasks can be marked missed with a fine.");
  }
  if (!isAssignedTaskPastMissedFineDeadline(task, now)) {
    throw new Error("This task is not past the completion deadline yet.");
  }

  const knownFines = await getManagerFines();
  const operator = operatorEmail.trim() || AUTO_CLEANING_FINE_OPERATOR;
  const { missedTask, fineAmount } = await markAssignedTaskMissedWithFine(task, knownFines, now, operator, customAmount);

  return {
    taskId: missedTask.id,
    userEmail: missedTask.userEmail,
    fineAmount,
    task: missedTask
  };
}

const DISMISSED_OVERDUE_TASK_NOTE_PREFIX = "[Dismissed overdue task]";

export async function adminDismissMissedCleaningTask(taskId: string, operatorEmail: string) {
  const now = new Date();
  const task = await findUniqueCleaningTask({ where: { id: taskId } });
  if (!task) {
    throw new Error("Cleaning task not found");
  }
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    throw new Error("Only assigned tasks can be dismissed.");
  }
  if (!isAssignedTaskPastMissedFineDeadline(task, now)) {
    throw new Error("This task is not past the completion deadline yet.");
  }

  const reviewer = operatorEmail.trim() || AUTO_CLEANING_FINE_OPERATOR;
  const note = `${DISMISSED_OVERDUE_TASK_NOTE_PREFIX} by ${reviewer} on ${now.toISOString()}`;
  const dismissedTask = await auditCleaningTask({
    taskId,
    reviewer,
    decision: CleaningAuditDecision.REJECT,
    note
  });

  await invalidateCleaningOverviewCache(dismissedTask.userEmail);
  return {
    taskId: dismissedTask.id,
    userEmail: dismissedTask.userEmail,
    task: dismissedTask
  };
}

export async function getCleaningManagerReviewQueue(now = new Date()) {
  const activeUsers = await getActiveCleaningUsers();
  const bedLineByEmail = new Map(
    activeUsers.map((user) => [user.email.trim().toLowerCase(), formatCleaningUserBedLine(user)])
  );

  const knownFines = await getManagerFines();

  const [pendingAuditTasks, assignedTasks] = await Promise.all([
    findManyCleaningTasks({
      where: { status: CleaningTaskStatus.DONE_PENDING_AUDIT },
      orderBy: { scheduledDate: "asc" }
    }),
    findManyCleaningTasks({
      where: { status: CleaningTaskStatus.ASSIGNED },
      orderBy: { scheduledDate: "asc" }
    })
  ]);

  const pendingAudit = pendingAuditTasks.map((task) => ({
    id: task.id,
    userEmail: task.userEmail,
    userName: task.userName,
    bedDisplay: bedLineByEmail.get(task.userEmail.trim().toLowerCase()) ?? null,
    branchId: task.branchId,
    floor: task.floor,
    type: task.type,
    scheduledDate: task.scheduledDate,
    status: task.status,
    rewardCoins: task.rewardCoins,
    completedAt: task.completedAt,
    completionNote: task.completionNote,
    completionPhoto: task.completionPhoto
  }));

  const overdueAssigned: Array<{
    id: string;
    userEmail: string;
    userName: string | null;
    bedDisplay: string | null;
    branchId: string;
    floor: number | null;
    type: CleaningTaskType;
    scheduledDate: Date;
    status: CleaningTaskStatus;
    rewardCoins: number;
    hasAutomaticFine: boolean;
    suggestedFineAmount: number;
    missedFineDeadlineAt: string;
  }> = [];

  for (const task of assignedTasks) {
    if (!isAssignedTaskPastMissedFineDeadline(task, now)) {
      continue;
    }
    const existingFine = knownFines.find((entry) => isAutomaticCleaningFineForTask(entry.row, task.id));
    const suggestedFineAmount = existingFine
      ? parseFineAmount(existingFine.row[FINE_AMOUNT_COLUMN])
      : await getMissedCleaningFineAmount(task, knownFines);
    overdueAssigned.push({
      id: task.id,
      userEmail: task.userEmail,
      userName: task.userName,
      bedDisplay: bedLineByEmail.get(task.userEmail.trim().toLowerCase()) ?? null,
      branchId: task.branchId,
      floor: task.floor,
      type: task.type,
      scheduledDate: task.scheduledDate,
      status: task.status,
      rewardCoins: task.rewardCoins,
      hasAutomaticFine: Boolean(existingFine),
      suggestedFineAmount,
      missedFineDeadlineAt: getMissedCleaningFineThresholdDate(task).toISOString()
    });
  }

  return { pendingAudit, overdueAssigned };
}

export async function sweepOverdueCleaningTasks(now = new Date()) {
  const overdueTasks = await findManyCleaningTasks({
    where: {
      status: CleaningTaskStatus.ASSIGNED
    },
    orderBy: {
      scheduledDate: "asc"
    }
  });

  const results: Array<{
    taskId: string;
    userEmail: string;
    fineAmount: number;
  }> = [];
  const knownFines = await getManagerFines();

  for (const task of overdueTasks) {
    if (isCleaningTaskAutomationDisabled(task.type)) {
      continue;
    }

    const fineThreshold = getMissedCleaningFineThresholdDate(task);
    if (fineThreshold > now) {
      continue;
    }

    const currentTask = await findUniqueCleaningTask({
      where: { id: task.id }
    });

    if (!currentTask || currentTask.status !== CleaningTaskStatus.ASSIGNED) {
      continue;
    }

    const { missedTask, fineAmount } = await markAssignedTaskMissedWithFine(
      currentTask,
      knownFines,
      now,
      AUTO_CLEANING_FINE_OPERATOR
    );

    results.push({
      taskId: missedTask.id,
      userEmail: missedTask.userEmail,
      fineAmount
    });
  }

  return {
    scanned: overdueTasks.length,
    markedMissed: results.length,
    tasks: results
  };
}

const MONTHLY_EVASION_FINE_AMOUNT = 100000;
const MONTHLY_EVASION_FINE_CONTENT = "Cleaning duty evasion";
const MONTHLY_EVASION_UNAVAILABLE_THRESHOLD = 15;

function isEvasionFineForUserMonth(row: Record<string, string>, email: string, month: string) {
  return (
    row["EMAIL"]?.trim().toLowerCase() === email.toLowerCase() &&
    row[FINE_CONTENT_COLUMN] === MONTHLY_EVASION_FINE_CONTENT &&
    (row[FINE_DESCRIPTION_COLUMN] ?? "").includes(month)
  );
}

// Charges users who evaded cleaning duties for the previous month:
// - Marked UNAVAILABLE more than 15 days
// - Released at least 1 task
// - Has no active or completed cleaning task that month
export async function sweepMonthlyEvasionPenalties(now = new Date()) {
  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const activeUsers = await getActiveCleaningUsers();
  const contractOptOutLookup = await getContractCleaningOptOutLookup(activeUsers.map((user) => getUserContractCode(user)));
  const knownFines = await getManagerFines();
  const results: Array<{ email: string; month: string; unavailableDays: number; releases: number }> = [];

  for (const user of activeUsers) {
    const email = user.email;
    if (isBranchAutomationDisabled(user.branchId)) {
      continue;
    }
    if (contractOptOutLookup.has(getUserContractCode(user))) {
      continue;
    }

    if (knownFines.some((f) => isEvasionFineForUserMonth(f.row, email, month))) {
      continue;
    }

    const unavailableDays = await prisma.cleaningAvailability.count({
      where: {
        userEmail: email,
        type: CleaningAvailabilityType.UNAVAILABLE,
        date: { gte: monthStart, lte: monthEnd }
      }
    });
    if (unavailableDays <= MONTHLY_EVASION_UNAVAILABLE_THRESHOLD) continue;

    const releases = await prisma.cleaningAvailability.count({
      where: {
        userEmail: email,
        type: CleaningAvailabilityType.UNAVAILABLE,
        note: "Released self-assigned cleaning task",
        date: { gte: monthStart, lte: monthEnd }
      }
    });
    if (releases < 1) continue;

    const taskInMonth = await findFirstCleaningTask({
      where: {
        userEmail: email,
        scheduledDate: { gte: monthStart, lte: monthEnd },
        status: { in: [CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.DONE_PENDING_AUDIT, CleaningTaskStatus.APPROVED] }
      }
    });
    if (taskInMonth) continue;

    await createAutomaticFineForEmail({
      email,
      amount: MONTHLY_EVASION_FINE_AMOUNT,
      content: MONTHLY_EVASION_FINE_CONTENT,
      description: `Cleaning duty evasion for ${month}: ${unavailableDays} unavailable days, ${releases} task release(s), no completed cleaning task.`,
      location: user.branchId,
      operator: AUTO_CLEANING_FINE_OPERATOR
    });

    results.push({ email, month, unavailableDays, releases });
  }

  return { scanned: activeUsers.length, charged: results.length, entries: results };
}

export async function getUserCleaningContext(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const activeUsers = await getActiveCleaningUsers({ emailHint: normalizedEmail });
  return activeUsers.find((entry) => entry.email === normalizedEmail) ?? null;
}

export async function setBulkCleaningAvailability(input: {
  email: string;
  dates: Date[];
  type: CleaningAvailabilityType;
  note?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (
    input.type === CleaningAvailabilityType.UNAVAILABLE &&
    input.dates.some(
      (date) => normalizeCalendarDate(date).getTime() < normalizeCalendarDate(new Date()).getTime()
    )
  ) {
    throw new Error("Past dates cannot be marked unavailable");
  }
  const userContext = await getUserCleaningContext(normalizedEmail);
  if (!userContext) {
    throw new Error("Active user not found for cleaning availability");
  }

  const results = [];
  for (const date of input.dates) {
    const result = await setCleaningAvailability({
      email: normalizedEmail,
      branchId: userContext.branchId,
      floor: userContext.floor,
      date,
      type: input.type,
      note: input.note
    });
    results.push(result);
  }

  return results;
}

function currentYearMonth() {
  return cleaningMonthKeyFromDate(normalizeCalendarDate(new Date()));
}

export async function getCleaningOptOutForEmail(email: string, month?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const targetMonth = month ?? currentYearMonth();
  return prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: targetMonth }
  });
}

export async function upsertContractCleaningOptOut(input: {
  email: string;
  branchId: string;
  contractCode: string;
  contractStartDate?: string;
  contractEndDate?: string;
  cleaningFeeVnd?: number;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const contractCode = input.contractCode.trim();
  if (!contractCode) {
    throw new Error("Contract code is required for contract cleaning opt-out.");
  }

  const cleaningFeeVnd = Math.max(0, Math.trunc(input.cleaningFeeVnd ?? CONTRACT_CLEANING_FEE_VND));
  const startDate = input.contractStartDate ? normalizeCalendarDate(input.contractStartDate) : null;
  const endDate = input.contractEndDate ? normalizeCalendarDate(input.contractEndDate) : null;

  const result = await prisma.cleaningContractOptOut.upsert({
    where: { contractCode },
    update: {
      userEmail: normalizedEmail,
      branchId: input.branchId,
      cleaningFeeVnd,
      startDate,
      endDate
    },
    create: {
      userEmail: normalizedEmail,
      branchId: input.branchId,
      contractCode,
      cleaningFeeVnd,
      startDate,
      endDate
    }
  });

  await invalidateCleaningOverviewCache(normalizedEmail);
  await logAction({
    actorEmail: normalizedEmail,
    actorRole: "manager",
    action: "cleaning.opt_out.contract_upsert",
    entityType: "CleaningContractOptOut",
    entityId: contractCode,
    entityLabel: normalizedEmail,
    details: `fee=${cleaningFeeVnd}`
  });
  return result;
}

export async function setCleaningOptOut(input: {
  email: string;
  branchId: string;
  month: string;
  paymentMethod: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: input.month }
  });
  if (existing) {
    throw new Error("You have already opted out of cleaning for this month.");
  }
  const result = await prisma.cleaningOptOut.create({
    data: {
      userEmail: normalizedEmail,
      branchId: input.branchId,
      month: input.month,
      paymentMethod: input.paymentMethod,
      chargedAt: new Date()
    }
  });
  await invalidateCleaningOverviewCache(normalizedEmail);
  await logAction({
    actorEmail: normalizedEmail,
    actorRole: "resident",
    action: "cleaning.opt_out.create",
    entityType: "CleaningOptOut",
    entityId: `${normalizedEmail}|${input.month}`,
    entityLabel: normalizedEmail,
    details: `paymentMethod=${input.paymentMethod}`
  });
  return result;
}

export async function cancelCleaningOptOut(email: string, month: string) {
  const normalizedEmail = email.trim().toLowerCase();
  await prisma.cleaningOptOut.deleteMany({
    where: { userEmail: normalizedEmail, month }
  });
  await invalidateCleaningOverviewCache(normalizedEmail);
  await logAction({
    actorEmail: normalizedEmail,
    actorRole: "resident",
    action: "cleaning.opt_out.delete",
    entityType: "CleaningOptOut",
    entityId: `${normalizedEmail}|${month}`,
    entityLabel: normalizedEmail
  });
}

export async function getOptedOutEmailsForMonth(month: string): Promise<Set<string>> {
  const optOuts = await prisma.cleaningOptOut.findMany({
    where: { month },
    select: { userEmail: true }
  });
  return new Set(optOuts.map((o) => o.userEmail));
}

// Auto-schedule all cleaning slots for the next `horizonDays` days.
// Uses the shared candidate ranking (see docs/cleaning-auto-assign.md).
export async function autoScheduleCleaningTasks(horizonDays = 15) {
  const today = normalizeCalendarDate(new Date());
  const fairnessSince = addDays(today, -CLEANING_FAIRNESS_LOOKBACK_DAYS);
  const correctionSince = addDays(today, -CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS);
  const [recentTaskCounts, correctionPenalties] = await Promise.all([
    getRecentTaskCountsByType(fairnessSince),
    getCorrectionPenalties(correctionSince)
  ]);
  const activeUsers = (await getActiveCleaningUsers()).filter((user) => !isHostelShortTermCleaningUser(user));
  const contractOptOutLookup = await getContractCleaningOptOutLookup(activeUsers.map((user) => getUserContractCode(user)));
  const calendarDefs = await getConfiguredCleaningCalendars();

  // Build slot definitions from calendar config (includes floor-specific TRASH_D7)
  const slotDefs =
    calendarDefs.length > 0
      ? calendarDefs.map((def) => ({ type: def.type as CleaningTaskType, floor: def.floor ?? null }))
      : dailyTaskConfigs
          .filter((cfg) => !isCleaningTaskAutomationDisabled(cfg.type))
          .map((cfg) => ({ type: cfg.type, floor: null as number | null }));

  const optOutCache = new Map<string, Set<string>>();
  const getOptedOut = async (month: string) => {
    if (!optOutCache.has(month)) {
      optOutCache.set(month, await getOptedOutEmailsForMonth(month));
    }
    return optOutCache.get(month)!;
  };

  const results = { created: 0, skipped: 0 };

  for (let d = 1; d <= horizonDays; d++) {
    const date = addDays(today, d);
    const month = cleaningMonthKeyFromDate(date);
    const optedOut = await getOptedOut(month);
    const eligibleUsers = activeUsers.filter(
      (u) => !optedOut.has(u.email) && !contractOptOutLookup.has(getUserContractCode(u))
    );

    const dayTasks = await findManyCleaningTasks({
      where: {
        scheduledDate: { gte: calendarRangeStart(date), lte: calendarRangeEnd(date) }
      }
    });
    const availabilityMap = await getAvailabilityMap(date, date);

    for (const def of slotDefs) {
      const existingSlot = dayTasks.find(
        (t) => t.type === def.type && (def.type !== CleaningTaskType.TRASH_D7 || t.floor === def.floor)
      );
      if (existingSlot) {
        results.skipped++;
        continue;
      }

      const candidates = await getAssignableCandidates(
        eligibleUsers,
        availabilityMap,
        date,
        def.type,
        dayTasks,
        def.floor,
        recentTaskCounts,
        correctionPenalties
      );

      if (candidates.length === 0) {
        continue;
      }

      const user = candidates[0];
      const assignedTask = await assignTaskToUser({
        user,
        date,
        type: def.type,
        floor: def.floor,
        assignmentSource: CleaningAssignmentSource.SYSTEM,
        assignedByName: "System"
      }).catch((err: unknown) => {
        console.warn(
          `[auto-schedule] skipped ${def.type} floor=${def.floor ?? "n/a"} on ${date.toISOString().slice(0, 10)} for ${user.email}:`,
          err instanceof Error ? err.message : err
        );
        return null;
      });
      if (!assignedTask) continue;

      // Keep dayTasks fresh so subsequent slots for this day see up-to-date occupiedTasks.
      dayTasks.push(assignedTask);
      bumpRecentTypeTaskCount(recentTaskCounts, user.email, def.type);

      await invalidateCleaningOverviewCache(user.email);
      results.created++;
    }
  }

  return results;
}

export async function autoScheduleCleaningTasksByJob(
  jobs: Array<{
    key: string;
    type: CleaningTaskType;
    floor: number | null;
    enabled: boolean;
    fillUnassignedDates: boolean;
    horizonDays: number;
  }>
) {
  const activeJobs = jobs
    .filter((job) => job.enabled && job.fillUnassignedDates && !isCleaningTaskAutomationDisabled(job.type))
    .map((job) => ({
      ...job,
      horizonDays: Math.max(1, Math.min(60, Number(job.horizonDays) || 1))
    }));

  if (activeJobs.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const today = normalizeCalendarDate(new Date());
  const maxHorizonDays = Math.max(...activeJobs.map((job) => job.horizonDays));
  const fairnessSince = addDays(today, -CLEANING_FAIRNESS_LOOKBACK_DAYS);
  const correctionSince = addDays(today, -CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS);
  const [recentTaskCounts, correctionPenalties] = await Promise.all([
    getRecentTaskCountsByType(fairnessSince),
    getCorrectionPenalties(correctionSince)
  ]);
  const activeUsers = (await getActiveCleaningUsers()).filter((user) => !isHostelShortTermCleaningUser(user));
  const contractOptOutLookup = await getContractCleaningOptOutLookup(activeUsers.map((user) => getUserContractCode(user)));

  const optOutCache = new Map<string, Set<string>>();
  const getOptedOut = async (month: string) => {
    if (!optOutCache.has(month)) {
      optOutCache.set(month, await getOptedOutEmailsForMonth(month));
    }
    return optOutCache.get(month)!;
  };

  const results = { created: 0, skipped: 0 };

  for (let d = 1; d <= maxHorizonDays; d++) {
    const date = addDays(today, d);
    const month = cleaningMonthKeyFromDate(date);
    const optedOut = await getOptedOut(month);
    const eligibleUsers = activeUsers.filter(
      (u) => !optedOut.has(u.email) && !contractOptOutLookup.has(getUserContractCode(u))
    );

    const dayTasks = await findManyCleaningTasks({
      where: {
        scheduledDate: { gte: calendarRangeStart(date), lte: calendarRangeEnd(date) }
      }
    });
    const availabilityMap = await getAvailabilityMap(date, date);

    for (const job of activeJobs.filter((entry) => d <= entry.horizonDays)) {
      const existingSlot = dayTasks.find(
        (t) => t.type === job.type && (job.type !== CleaningTaskType.TRASH_D7 || t.floor === job.floor)
      );
      if (existingSlot) {
        results.skipped++;
        continue;
      }

      const candidates = await getAssignableCandidates(
        eligibleUsers,
        availabilityMap,
        date,
        job.type,
        dayTasks,
        job.floor,
        recentTaskCounts,
        correctionPenalties
      );

      if (candidates.length === 0) {
        continue;
      }

      const user = candidates[0];
      const assignedTask = await assignTaskToUser({
        user,
        date,
        type: job.type,
        floor: job.floor,
        assignmentSource: CleaningAssignmentSource.SYSTEM,
        assignedByName: "System"
      }).catch((err: unknown) => {
        console.warn(
          `[auto-schedule] skipped ${job.type} floor=${job.floor ?? "n/a"} on ${date.toISOString().slice(0, 10)} for ${user.email}:`,
          err instanceof Error ? err.message : err
        );
        return null;
      });
      if (!assignedTask) continue;

      // Keep dayTasks fresh so subsequent jobs for this day use up-to-date occupiedTasks.
      dayTasks.push(assignedTask);
      bumpRecentTypeTaskCount(recentTaskCounts, user.email, job.type);
      await invalidateCleaningOverviewCache(user.email);
      results.created++;
    }
  }

  return results;
}

// After a user releases a task, try to place them on a later open slot of the
// same type within 15 days — but only when they are the most underdue eligible
// candidate for that slot (shared fairness ranking). Avoids dumping releasers
// onto the next empty day when others are more underdue.
async function autoReassignReleasedUser(input: {
  email: string;
  releasedDate: Date;
  type: CleaningTaskType;
  floor: number | null;
}) {
  const normalizedReleasedDate = normalizeCalendarDate(input.releasedDate);
  const horizon = addDays(normalizedReleasedDate, 15);
  const normalizedEmail = input.email.toLowerCase();
  const user = await getUserCleaningContext(normalizedEmail);
  if (!user || isHostelShortTermCleaningUser(user)) return;

  const fairnessSince = addDays(normalizeCalendarDate(new Date()), -CLEANING_FAIRNESS_LOOKBACK_DAYS);
  const correctionSince = addDays(normalizeCalendarDate(new Date()), -CLEANING_CORRECTION_PENALTY_LOOKBACK_DAYS);
  const activeUsers = (await getActiveCleaningUsers()).filter((entry) => !isHostelShortTermCleaningUser(entry));
  const [recentTaskCounts, correctionPenalties, contractOptOutLookup] = await Promise.all([
    getRecentTaskCountsByType(fairnessSince),
    getCorrectionPenalties(correctionSince),
    getContractCleaningOptOutLookup(activeUsers.map((entry) => getUserContractCode(entry)))
  ]);

  let cursor = addDays(normalizedReleasedDate, 1);

  while (cursor.getTime() <= horizon.getTime()) {
    const month = cleaningMonthKeyFromDate(cursor);
    const optedOut = await getOptedOutEmailsForMonth(month);
    if (optedOut.has(normalizedEmail)) {
      cursor = addDays(cursor, 1);
      continue;
    }

    // Skip if slot already has an assignment
    const existingSlot = await findFirstCleaningTask({
      where: {
        type: input.type,
        scheduledDate: { gte: calendarRangeStart(cursor), lte: calendarRangeEnd(cursor) },
        ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: input.floor } : {})
      }
    });
    if (existingSlot) {
      cursor = addDays(cursor, 1);
      continue;
    }

    const dayTasks = await findManyCleaningTasks({
      where: {
        scheduledDate: { gte: calendarRangeStart(cursor), lte: calendarRangeEnd(cursor) }
      }
    });
    const availabilityMap = await getAvailabilityMap(cursor, cursor);
    const eligibleUsers = activeUsers.filter(
      (entry) => !optedOut.has(entry.email) && !contractOptOutLookup.has(getUserContractCode(entry))
    );

    const candidates = await getAssignableCandidates(
      eligibleUsers,
      availabilityMap,
      cursor,
      input.type,
      dayTasks,
      input.floor,
      recentTaskCounts,
      correctionPenalties
    );

    // Only re-place when the releaser is the top fairness pick for this open slot.
    if (candidates[0]?.email.toLowerCase() !== normalizedEmail) {
      cursor = addDays(cursor, 1);
      continue;
    }

    await assignTaskToUser({
      user,
      date: cursor,
      type: input.type,
      floor: input.floor,
      assignmentSource: CleaningAssignmentSource.SYSTEM,
      assignedByName: "System"
    });
    await invalidateCleaningOverviewCache(normalizedEmail);
    return;
  }

  console.warn("[autoReassignReleasedUser] No underdue open slot found within horizon", {
    email: normalizedEmail,
    type: input.type,
    releasedDate: normalizedReleasedDate.toISOString().slice(0, 10),
    horizon: horizon.toISOString().slice(0, 10)
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleaning Swap Requests
// Residents can offer coins to another resident to take over their cleaning task.
// ─────────────────────────────────────────────────────────────────────────────

export class CleaningSwapError extends Error {
  code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "CONFLICT" | "INSUFFICIENT_COINS" | "VALIDATION";
  constructor(message: string, code: CleaningSwapError["code"]) {
    super(message);
    this.name = "CleaningSwapError";
    this.code = code;
  }
}

/**
 * Returns eligible residents who could take over the given task.
 * Reuses getAvailableUsersForAdminSlot — same shared fairness ranking.
 */
export async function getSwapCandidates(taskId: string, requesterEmail: string) {
  const normalizedEmail = requesterEmail.trim().toLowerCase();
  const task = await findUniqueCleaningTask({ where: { id: taskId } });
  if (!task) throw new CleaningSwapError("Cleaning task not found", "NOT_FOUND");
  if (task.userEmail.toLowerCase() !== normalizedEmail) {
    throw new CleaningSwapError("You can only find swap partners for your own tasks", "FORBIDDEN");
  }
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    throw new CleaningSwapError("Only assigned tasks can be swapped", "INVALID_STATE");
  }
  if (!isFutureCalendarDate(normalizeCalendarDate(task.scheduledDate))) {
    throw new CleaningSwapError("Task date has passed — swap is no longer possible", "INVALID_STATE");
  }
  return getAvailableUsersForAdminSlot({
    date: task.scheduledDate,
    type: task.type,
    floor: task.floor,
    excludeEmails: [normalizedEmail],
    showAll: false
  });
}

/**
 * Creates a pending swap request from the requester to a specific target resident.
 * One PENDING request per task is enforced (requester must cancel before re-requesting).
 */
export async function createSwapRequest(input: {
  taskId: string;
  requesterEmail: string;
  targetEmail: string;
  offeredCoins: number;
}) {
  const normalizedRequester = input.requesterEmail.trim().toLowerCase();
  const normalizedTarget = input.targetEmail.trim().toLowerCase();

  if (normalizedRequester === normalizedTarget) {
    throw new CleaningSwapError("You cannot request a swap with yourself", "VALIDATION");
  }
  if (!Number.isInteger(input.offeredCoins) || input.offeredCoins < 0) {
    throw new CleaningSwapError("offeredCoins must be a non-negative integer", "VALIDATION");
  }

  const task = await findUniqueCleaningTask({ where: { id: input.taskId } });
  if (!task) throw new CleaningSwapError("Cleaning task not found", "NOT_FOUND");
  if (task.userEmail.toLowerCase() !== normalizedRequester) {
    throw new CleaningSwapError("You can only create swap requests for your own tasks", "FORBIDDEN");
  }
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    throw new CleaningSwapError("Only assigned tasks can be swapped", "INVALID_STATE");
  }
  if (!isFutureCalendarDate(normalizeCalendarDate(task.scheduledDate))) {
    throw new CleaningSwapError("Task date has passed — swap is no longer possible", "INVALID_STATE");
  }
  if (input.offeredCoins > task.rewardCoins) {
    throw new CleaningSwapError(`Offered coins cannot exceed the task reward (${task.rewardCoins})`, "VALIDATION");
  }

  // Enforce one pending swap per task
  const existingPending = await prisma.cleaningSwapRequest.findFirst({
    where: { taskId: input.taskId, requesterEmail: normalizedRequester, status: CleaningSwapRequestStatus.PENDING }
  });
  if (existingPending) {
    throw new CleaningSwapError(
      "You already have a pending swap request for this task. Cancel it before sending a new one.",
      "CONFLICT"
    );
  }

  // Verify the target is an active resident (getUserCleaningContext is sufficient)
  const targetUser = await getUserCleaningContext(normalizedTarget);
  if (!targetUser) {
    throw new CleaningSwapError("Target resident not found or is not an active cleaning member", "NOT_FOUND");
  }

  return prisma.cleaningSwapRequest.create({
    data: {
      taskId: input.taskId,
      requesterEmail: normalizedRequester,
      requesterName: task.userName ?? null,
      targetEmail: normalizedTarget,
      targetName: targetUser.name ?? null,
      offeredCoins: input.offeredCoins,
      status: CleaningSwapRequestStatus.PENDING,
      taskType: task.type,
      taskScheduledDate: task.scheduledDate,
      taskBranchId: task.branchId,
      taskRewardCoins: task.rewardCoins
    }
  });
}

/**
 * Target resident accepts a swap request.
 * Reassigns the cleaning task and transfers coins.
 */
export async function acceptSwapRequest(requestId: string, targetEmail: string) {
  const normalizedTarget = targetEmail.trim().toLowerCase();
  const swapReq = await prisma.cleaningSwapRequest.findUnique({ where: { id: requestId } });
  if (!swapReq) throw new CleaningSwapError("Swap request not found", "NOT_FOUND");
  if (swapReq.targetEmail.toLowerCase() !== normalizedTarget) {
    throw new CleaningSwapError("You are not the target of this swap request", "FORBIDDEN");
  }
  if (swapReq.status !== CleaningSwapRequestStatus.PENDING) {
    throw new CleaningSwapError(
      `This swap request is already ${swapReq.status.toLowerCase()} and can no longer be accepted`,
      "INVALID_STATE"
    );
  }

  // Fresh task check
  const task = await findUniqueCleaningTask({ where: { id: swapReq.taskId } });
  if (!task) throw new CleaningSwapError("The cleaning task for this swap no longer exists", "NOT_FOUND");
  if (task.status !== CleaningTaskStatus.ASSIGNED) {
    // Auto-cancel the swap since the task is no longer actionable
    await prisma.cleaningSwapRequest.update({
      where: { id: requestId },
      data: { status: CleaningSwapRequestStatus.CANCELLED, cancelledAt: new Date() }
    });
    throw new CleaningSwapError(
      "This task has already been completed, missed, or rejected. The swap request has been cancelled automatically.",
      "INVALID_STATE"
    );
  }
  if (!isFutureCalendarDate(normalizeCalendarDate(task.scheduledDate))) {
    await prisma.cleaningSwapRequest.update({
      where: { id: requestId },
      data: { status: CleaningSwapRequestStatus.CANCELLED, cancelledAt: new Date() }
    });
    throw new CleaningSwapError("The task date has passed. The swap request has been cancelled.", "INVALID_STATE");
  }

  // Check target doesn't already have a task that day
  const conflictTask = await findFirstCleaningTask({
    where: {
      userEmail: normalizedTarget,
      scheduledDate: { gte: calendarRangeStart(task.scheduledDate), lte: calendarRangeEnd(task.scheduledDate) },
      status: { notIn: [CleaningTaskStatus.MISSED, CleaningTaskStatus.REJECTED] }
    }
  });
  if (conflictTask) {
    throw new CleaningSwapError("You already have a cleaning task on that date", "CONFLICT");
  }

  const targetUser = await getUserCleaningContext(normalizedTarget);
  if (!targetUser) throw new CleaningSwapError("Your resident account could not be found", "NOT_FOUND");

  const newFloor = task.type === CleaningTaskType.TRASH_D7 ? (targetUser.floor ?? task.floor) : task.floor;

  // DB transaction: mark accepted, cancel other pending swaps for this task, update task
  const updatedTask = await prisma.$transaction(async (tx) => {
    await tx.cleaningSwapRequest.update({
      where: { id: requestId },
      data: { status: CleaningSwapRequestStatus.ACCEPTED, respondedAt: new Date() }
    });

    // Cancel all other pending requests for the same task
    await tx.cleaningSwapRequest.updateMany({
      where: { taskId: swapReq.taskId, status: CleaningSwapRequestStatus.PENDING, id: { not: requestId } },
      data: { status: CleaningSwapRequestStatus.CANCELLED, cancelledAt: new Date() }
    });

    // Audit trail in CoinLedger
    if (swapReq.offeredCoins > 0) {
      await tx.coinLedger.create({
        data: { userId: swapReq.requesterEmail, delta: -swapReq.offeredCoins, reason: CoinReason.CLEANING_SWAP_DEBIT, refType: "cleaning_swap_request", refId: requestId }
      });
      await tx.coinLedger.create({
        data: { userId: normalizedTarget, delta: swapReq.offeredCoins, reason: CoinReason.CLEANING_SWAP_CREDIT, refType: "cleaning_swap_request", refId: requestId }
      });
    }

    return tx.cleaningTask.update({
      where: { id: task.id },
      data: { userEmail: normalizedTarget, userName: targetUser.name, branchId: targetUser.branchId, floor: newFloor }
    });
  });

  // Google Calendar update (non-blocking)
  if (task.calendarId && task.calendarEventId) {
    const target = getCleaningCalendarTarget(task.type, { floor: newFloor });
    if (target) {
      updateCleaningCalendarEvent({
        calendarId: task.calendarId,
        eventId: task.calendarEventId,
        title: target.title,
        scheduledDate: task.scheduledDate,
        userEmail: targetUser.email,
        userName: targetUser.name,
        branchId: targetUser.branchId,
        floor: newFloor,
        rewardCoins: task.rewardCoins,
        type: task.type,
        status: task.status,
        completedAt: task.completedAt,
        completionNote: task.completionNote,
        completionPhoto: task.completionPhoto,
        auditorNote: task.auditorNote
      }).catch((err: unknown) => {
        console.error("[acceptSwapRequest] Calendar update failed:", err instanceof Error ? err.message : err);
      });
    }
  }

  // Coin transfer via Google Sheets (non-blocking on failure — CoinLedger is source of truth)
  if (swapReq.offeredCoins > 0) {
    transferSwapCoins({
      requesterEmail: swapReq.requesterEmail,
      requesterName: swapReq.requesterName,
      targetEmail: normalizedTarget,
      targetName: targetUser.name,
      coins: swapReq.offeredCoins,
      swapRequestId: requestId,
      branchId: task.branchId
    }).catch((err: unknown) => {
      console.error("[acceptSwapRequest] Sheets coin transfer failed:", err instanceof Error ? err.message : err);
    });
  }

  await invalidateCleaningOverviewCache(swapReq.requesterEmail);
  await invalidateCleaningOverviewCache(normalizedTarget);

  return { swapRequest: swapReq, updatedTask };
}

/**
 * Target resident declines a swap request.
 */
export async function declineSwapRequest(requestId: string, targetEmail: string) {
  const normalizedTarget = targetEmail.trim().toLowerCase();
  const swapReq = await prisma.cleaningSwapRequest.findUnique({ where: { id: requestId } });
  if (!swapReq) throw new CleaningSwapError("Swap request not found", "NOT_FOUND");
  if (swapReq.targetEmail.toLowerCase() !== normalizedTarget) {
    throw new CleaningSwapError("You are not the target of this swap request", "FORBIDDEN");
  }
  if (swapReq.status !== CleaningSwapRequestStatus.PENDING) {
    throw new CleaningSwapError(`This request is already ${swapReq.status.toLowerCase()}`, "INVALID_STATE");
  }
  return prisma.cleaningSwapRequest.update({
    where: { id: requestId },
    data: { status: CleaningSwapRequestStatus.DECLINED, respondedAt: new Date() }
  });
}

/**
 * Requester cancels their own pending swap request.
 */
export async function cancelSwapRequest(requestId: string, requesterEmail: string) {
  const normalizedRequester = requesterEmail.trim().toLowerCase();
  const swapReq = await prisma.cleaningSwapRequest.findUnique({ where: { id: requestId } });
  if (!swapReq) throw new CleaningSwapError("Swap request not found", "NOT_FOUND");
  if (swapReq.requesterEmail.toLowerCase() !== normalizedRequester) {
    throw new CleaningSwapError("You can only cancel your own swap requests", "FORBIDDEN");
  }
  if (swapReq.status !== CleaningSwapRequestStatus.PENDING) {
    throw new CleaningSwapError(`This request is already ${swapReq.status.toLowerCase()} and cannot be cancelled`, "INVALID_STATE");
  }
  return prisma.cleaningSwapRequest.update({
    where: { id: requestId },
    data: { status: CleaningSwapRequestStatus.CANCELLED, cancelledAt: new Date() }
  });
}

/**
 * Returns all swap requests involving a user — both sent (requester) and received (target).
 */
export async function getSwapRequestsForUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [sent, received] = await Promise.all([
    prisma.cleaningSwapRequest.findMany({
      where: { requesterEmail: normalizedEmail },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.cleaningSwapRequest.findMany({
      where: { targetEmail: normalizedEmail },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);
  const pendingReceivedCount = received.filter((r) => r.status === CleaningSwapRequestStatus.PENDING).length;
  return { sent, received, pendingReceivedCount };
}
