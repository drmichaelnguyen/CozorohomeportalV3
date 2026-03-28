import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CleaningAuditDecision,
  CleaningAvailabilityType,
  CleaningTaskStatus,
  CleaningTaskType,
  CoinReason,
  Prisma
} from "@prisma/client";

import {
  ClientRow,
  CleaningCalendarEvent,
  createAutomaticFineForEmail,
  getConfiguredCleaningCalendars,
  createCleaningCalendarEvent,
  getCleaningCalendarTarget,
  getManagerFines,
  listCleaningCalendarEvents,
  readCachedClients,
  updateCleaningCalendarEvent
} from "./google-sheets.js";
import { prisma } from "./prisma.js";

type ActiveCleaningUser = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  floor: number | null;
  source: ClientRow;
};

type CleaningTaskRecord = Prisma.CleaningTaskGetPayload<Record<string, never>>;
type CleaningOverviewPayload = Awaited<ReturnType<typeof buildCleaningOverviewForUser>>;
type CleaningOverviewCache = {
  syncedAt: string;
  entries: Record<string, CleaningOverviewPayload>;
};
type GenerateCleaningScheduleResult = {
  imported: CleaningTaskRecord[];
  created: CleaningTaskRecord[];
};
type CleaningAvailableUser = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  floor: number | null;
  availabilityType: CleaningAvailabilityType | null;
  availabilityCount: number;
  totalTaskCount: number;
  hasSameDayTask: boolean;
  sameDayTasks: Array<{
    id: string;
    type: CleaningTaskType;
    scheduledDate: Date;
  }>;
};

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

const cleaningRewardMap: Record<CleaningTaskType, number> = {
  [CleaningTaskType.KITCHEN_D2]: 5000,
  [CleaningTaskType.TRASH_D7]: 5000,
  [CleaningTaskType.KITCHEN_D7]: 10000
};

const CLEANING_FULL_FINE_AMOUNT = 10000;
const AUTO_CLEANING_FINE_OPERATOR = "Cleaning schedule system";
const AUTO_CLEANING_FINE_DESCRIPTION_PREFIX = "Auto-generated for missed cleaning task.";
const FINE_CONTENT_COLUMN = "N\u1ed8I DUNG VI PH\u1ea0M";
const FINE_DESCRIPTION_COLUMN = "M\u00d4 T\u1ea2 VI PH\u1ea0M";
const FINE_AMOUNT_COLUMN = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
const FINE_TIMESTAMP_COLUMN = "D\u1ea4U TH\u1edcI GIAN";

const dailyTaskConfigs: Array<{
  type: CleaningTaskType;
  branchId: "D2" | "D7";
  title: string;
}> = [
  { type: CleaningTaskType.KITCHEN_D2, branchId: "D2", title: "Vệ sinh bếp D2" },
  { type: CleaningTaskType.TRASH_D7, branchId: "D7", title: "Đổ rác D7" },
  { type: CleaningTaskType.KITCHEN_D7, branchId: "D7", title: "Vệ sinh bếp D7" }
];

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

async function getActiveCleaningUsers() {
  const cache = await readCachedClients();
  const rows = cache?.rows ?? [];

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
  const tasks = await prisma.cleaningTask.findMany({
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

function getSlotFloor(type: CleaningTaskType, floor?: number | null) {
  return type === CleaningTaskType.TRASH_D7 ? floor ?? null : null;
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
}) {
  const suggestions: string[] = [];
  const normalizedFromDate = normalizeCalendarDate(input.fromDate);
  let cursor = addDays(normalizedFromDate, 1);
  const limit = input.limit ?? 5;
  const searchToDate = addDays(normalizedFromDate, 90);

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

  const userTasks = await prisma.cleaningTask.findMany({
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

async function getRecentTaskCounts(since: Date): Promise<Map<string, number>> {
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      scheduledDate: { gte: since },
      status: { not: CleaningTaskStatus.MISSED }
    },
    select: { userEmail: true }
  });
  const counts = new Map<string, number>();
  for (const { userEmail } of tasks) {
    const key = userEmail.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function getAssignableCandidates(
  activeUsers: ActiveCleaningUser[],
  availabilityMap: Map<string, Prisma.CleaningAvailabilityGetPayload<Record<string, never>>>,
  scheduledDate: Date,
  type: CleaningTaskType,
  occupiedTasks: Array<{ userEmail: string; scheduledDate: Date }>,
  floor?: number | null,
  recentTaskCounts?: Map<string, number>
) {
  const normalizedDateKey = normalizeCalendarDate(scheduledDate).toISOString();

  return activeUsers
    .filter((user) => {
      if (type === CleaningTaskType.KITCHEN_D2) {
        return user.branchId === "D2";
      }
      if (type === CleaningTaskType.KITCHEN_D7) {
        return user.branchId === "D7";
      }
      return user.branchId === "D7" && user.floor === floor;
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
      const availabilityDelta =
        getAvailabilityScore(leftAvailability?.type) - getAvailabilityScore(rightAvailability?.type);

      if (availabilityDelta !== 0) {
        return availabilityDelta;
      }

      // Sort by recent task count (last 60 days) — least work first
      const leftCount = recentTaskCounts?.get(left.email) ?? 0;
      const rightCount = recentTaskCounts?.get(right.email) ?? 0;
      if (leftCount !== rightCount) {
        return leftCount - rightCount;
      }

      return left.name.localeCompare(right.name);
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
}) {
  const normalizedTaskDate = normalizeCalendarDate(input.date);
  const normalizedEmail = input.user.email.trim().toLowerCase();
  const slotFloor = getSlotFloor(input.type, input.floor ?? input.user.floor);

  const sameDayUserTasks = await prisma.cleaningTask.findMany({
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

  const existingSlot = await prisma.cleaningTask.findFirst({
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

    const reassignedTask = await prisma.cleaningTask.update({
      where: { id: existingSlot.id },
      data: {
        userEmail: normalizedEmail,
        userName: input.user.name,
        branchId: input.user.branchId,
        floor: slotFloor
      }
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

  const created = await createCleaningTaskRecord({
    user: input.user,
    type: input.type,
    title: config.title,
    scheduledDate: normalizedTaskDate,
    floor: slotFloor,
    isSelfAssigned: input.isSelfAssigned
  });

  await invalidateCleaningOverviewCache(normalizedEmail);
  return created;
}

async function createCleaningTaskRecord(input: {
  user: ActiveCleaningUser;
  type: CleaningTaskType;
  title: string;
  scheduledDate: Date;
  floor?: number | null;
  isSelfAssigned?: boolean;
}) {
  const normalizedScheduledDate = normalizeCalendarDate(input.scheduledDate);
  let rewardCoins = cleaningRewardMap[input.type];
  
  if (input.isSelfAssigned) {
    rewardCoins = Math.round(rewardCoins * 1.2); // 20% bonus
  }
  const target = getCleaningCalendarTarget(input.type, { floor: input.floor ?? input.user.floor });
  let calendarEventId: string | null = null;
  let calendarId: string | null = target?.calendarId ?? null;

  if (target) {
    try {
      calendarEventId = await createCleaningCalendarEvent({
        calendarId: target.calendarId,
        title: target.title,
        scheduledDate: normalizedScheduledDate,
        userEmail: input.user.email,
        userName: input.user.name,
        branchId: input.user.branchId,
        floor: input.floor ?? input.user.floor,
        rewardCoins,
        type: input.type
      });
    } catch (error) {
      console.warn(
        `Cleaning calendar event creation skipped for ${input.user.email} on ${normalizedScheduledDate.toISOString()}:`,
        error instanceof Error ? error.message : error
      );
      calendarId = null;
      calendarEventId = null;
    }
  }

  return prisma.cleaningTask.create({
    data: {
      userEmail: input.user.email,
      userName: input.user.name,
      branchId: input.user.branchId,
      floor: input.floor ?? input.user.floor,
      type: input.type,
      scheduledDate: normalizedScheduledDate,
      rewardCoins,
      isSelfAssigned: input.isSelfAssigned ?? false,
      calendarId,
      calendarEventId
    }
  });
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

  for (const event of importedEvents) {
    const scheduledDate = normalizeCalendarDate(event.start);
    const normalizedEmail = event.userEmail?.trim().toLowerCase() ?? "";
    const matchedUser = normalizedEmail ? usersByEmail.get(normalizedEmail) ?? null : null;
    const userEmail = normalizedEmail || `calendar-event-${event.id}@local.invalid`;
    const userName = getImportedUserName(event, matchedUser);
    const branchId = matchedUser?.branchId ?? event.branchId;
    const floor = matchedUser?.floor ?? event.floor ?? null;

    const slotMatches = await prisma.cleaningTask.findMany({
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
    const placeholderSlotTask =
      slotMatches.length === 1 && !slotMatches[0].calendarId && !slotMatches[0].calendarEventId ? slotMatches[0] : null;
    const existingTask = existingTaskByEventId ?? placeholderSlotTask;

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
          syncName = existingTask.userName;
        }
      }

      const updatedTask = await prisma.cleaningTask.update({
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

      const staleDuplicateIds = slotMatches
        .filter((task) => task.id !== updatedTask.id)
        .filter((task) => task.status === CleaningTaskStatus.ASSIGNED)
        .filter((task) => !task.calendarEventId)
        .map((task) => task.id);

      if (staleDuplicateIds.length > 0) {
        await prisma.cleaningTask.deleteMany({
          where: {
            id: {
              in: staleDuplicateIds
            }
          }
        });
      }

      importedTasks.push(updatedTask);
      continue;
    }

    const createdTask = await prisma.cleaningTask.create({
      data: {
        userEmail,
        userName,
        branchId,
        floor,
        type: event.taskType as CleaningTaskType,
        scheduledDate,
        calendarId: event.calendarId,
        calendarEventId: event.id,
        rewardCoins: cleaningRewardMap[event.taskType as CleaningTaskType]
      }
    });
    importedTasks.push(createdTask);
  }

  return importedTasks;
}

async function cleanupStaleLocalOnlyTasks(from: Date, to: Date) {
  const tasks = await prisma.cleaningTask.findMany({
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

  const selfAssignMonth = `${normalizedTaskDate.getFullYear()}-${String(normalizedTaskDate.getMonth() + 1).padStart(2, "0")}`;
  const optOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: selfAssignMonth }
  });
  if (optOut) {
    throw new Error("You have opted out of cleaning for this month. Cancel your opt-out to self-assign.");
  }

  const slotFloor = input.type === CleaningTaskType.TRASH_D7 ? user.floor : null;
  const existingSlot = await prisma.cleaningTask.findFirst({
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

  return assignTaskToUser({
    user,
    date: normalizedTaskDate,
    type: input.type,
    floor: slotFloor,
    allowExistingSlotReassign: false,
    isSelfAssigned: true
  });
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

  const checkMonth = `${normalizedTaskDate.getFullYear()}-${String(normalizedTaskDate.getMonth() + 1).padStart(2, "0")}`;
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
  const existingSlot = await prisma.cleaningTask.findFirst({
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
  const task = await prisma.cleaningTask.findUnique({
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
          auditorNote: task.auditorNote
        });
      } catch (calendarError) {
        console.error("[releaseCleaningTask] Google Calendar update failed, proceeding with DB release:", calendarError);
      }
    }
  }

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
        note: "Released self-assigned cleaning task"
      },
      create: {
        userEmail: normalizedEmail,
        branchId: task.branchId,
        floor: task.floor,
        date: normalizeCalendarDate(task.scheduledDate),
        type: CleaningAvailabilityType.UNAVAILABLE,
        note: "Released self-assigned cleaning task"
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

  const tasks = await prisma.cleaningTask.findMany({
    where: {
      userEmail: normalizedEmail,
      OR: [
        { calendarId: { not: null } },
        { calendarEventId: { not: null } }
      ]
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

  const user = (await getActiveCleaningUsers()).find((entry) => entry.email === normalizedEmail) ?? null;

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

  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const optOut = await prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: currentMonth }
  });

  const releasesThisMonth = await countReleasesThisMonth(normalizedEmail);

  return {
    user,
    tasks,
    availability,
    occupiedSlots,
    optOut: optOut ? { month: optOut.month, paymentMethod: optOut.paymentMethod } : null,
    releasesThisMonth,
    monthlyReleaseLimit: MONTHLY_RELEASE_LIMIT
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
  return prisma.cleaningTask.findMany({
    where: {
      OR: [
        { calendarId: { not: null } },
        { calendarEventId: { not: null } }
      ],
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

  return definitions.map((definition) => ({
    ...definition,
    tasks: tasks.filter((task) => {
      if (task.type !== definition.type) {
        return false;
      }
      if (definition.type !== CleaningTaskType.TRASH_D7) {
        return true;
      }
      return task.floor === definition.floor;
    })
  }));
}

export async function getAvailableUsersForAdminSlot(input: {
  date: Date;
  type: CleaningTaskType;
  floor?: number | null;
  excludeEmails?: string[];
}) {
  const normalizedDate = normalizeCalendarDate(input.date);
  if (!isFutureCalendarDate(normalizedDate)) {
    throw new Error("Admin assignment is only available for future dates");
  }
  const excludedEmails = new Set((input.excludeEmails ?? []).map((email) => email.trim().toLowerCase()));
  const activeUsers = await getActiveCleaningUsers();
  const availabilityMap = await getAvailabilityMap(normalizedDate, normalizedDate);
  const occupiedTasks = await prisma.cleaningTask.findMany({
    where: {
      scheduledDate: {
        gte: calendarRangeStart(normalizedDate),
        lte: calendarRangeEnd(normalizedDate)
      }
    }
  });
  const allAvailability = await prisma.cleaningAvailability.findMany({
    where: {
      type: {
        in: [CleaningAvailabilityType.AVAILABLE, CleaningAvailabilityType.PREFERRED]
      }
    }
  });
  const allTasks = await prisma.cleaningTask.findMany({
    where: {
      OR: [{ calendarId: { not: null } }, { calendarEventId: { not: null } }]
    }
  });
  const normalizedDateKey = normalizeCalendarDate(normalizedDate).toISOString();

  const candidates: CleaningAvailableUser[] = [];

  for (const user of activeUsers) {
    if (excludedEmails.has(user.email)) {
      continue;
    }

    const isEligible =
      input.type === CleaningTaskType.KITCHEN_D2
        ? user.branchId === "D2"
        : input.type === CleaningTaskType.KITCHEN_D7
          ? user.branchId === "D7"
          : user.branchId === "D7" && user.floor === (input.floor ?? null);

    if (!isEligible) {
      continue;
    }

    const availabilityType = availabilityMap.get(`${user.email}|${normalizedDateKey}`)?.type ?? null;
    if (availabilityType === CleaningAvailabilityType.UNAVAILABLE) {
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
      branchId: user.branchId,
      floor: user.floor,
      availabilityType,
      availabilityCount,
      totalTaskCount,
      hasSameDayTask: sameDayTasks.length > 0,
      sameDayTasks
    });
  }

  return candidates.sort((left, right) => {
    if (left.hasSameDayTask !== right.hasSameDayTask) {
      return left.hasSameDayTask ? 1 : -1;
    }

    const availabilityDelta =
      getAvailabilityScore(left.availabilityType ?? undefined) - getAvailabilityScore(right.availabilityType ?? undefined);
    if (availabilityDelta !== 0) {
      return availabilityDelta;
    }

    if (left.availabilityCount !== right.availabilityCount) {
      return right.availabilityCount - left.availabilityCount;
    }

    if (left.totalTaskCount !== right.totalTaskCount) {
      return left.totalTaskCount - right.totalTaskCount;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function adminAssignCleaningTask(input: {
  email: string;
  date: Date;
  type: CleaningTaskType;
  floor?: number | null;
  force?: boolean;
}) {
  if (!isFutureCalendarDate(input.date)) {
    throw new Error("Admin assignment is only available for future dates");
  }
  const user = await getUserCleaningContext(input.email);
  if (!user) {
    throw new Error("Active user not found for admin assignment");
  }

  const availability = await prisma.cleaningAvailability.findUnique({
    where: {
      userEmail_date: {
        userEmail: input.email.trim().toLowerCase(),
        date: normalizeCalendarDate(input.date)
      }
    }
  });
  if (availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
    throw new Error("This user marked the date as unavailable");
  }

  const allowedTypes = getAllowedTaskTypesForUser(user);
  if (!allowedTypes.includes(input.type)) {
    throw new Error("This user is not eligible for that cleaning task");
  }

  return assignTaskToUser({
    user,
    date: normalizeCalendarDate(input.date),
    type: input.type,
    floor: input.floor ?? user.floor,
    allowSameDayOverride: input.force
  });
}

export async function adminAutoAssignCleaningSlots(input: {
  dates: Date[];
  type: CleaningTaskType;
  floor?: number | null;
}) {
  const today = normalizeCalendarDate(new Date());
  const activeUsers = await getActiveCleaningUsers();
  const recentTaskCounts = await getRecentTaskCounts(addDays(today, -60));
  const results: CleaningTaskRecord[] = [];
  const reservedEmails = new Set<string>();

  for (const date of input.dates) {
    const normalizedDate = normalizeCalendarDate(date);
    if (!isFutureCalendarDate(normalizedDate)) {
      continue;
    }
    const availabilityMap = await getAvailabilityMap(normalizedDate, normalizedDate);
    const occupiedTasks = await prisma.cleaningTask.findMany({
      where: {
        scheduledDate: {
          gte: calendarRangeStart(normalizedDate),
          lte: calendarRangeEnd(normalizedDate)
        }
      }
    });

    const existingSlot = await prisma.cleaningTask.findFirst({
      where: {
        type: input.type,
        scheduledDate: {
          gte: calendarRangeStart(normalizedDate),
          lte: calendarRangeEnd(normalizedDate)
        },
        ...(input.type === CleaningTaskType.TRASH_D7 ? { floor: input.floor ?? null } : {})
      }
    });

    if (existingSlot) {
      results.push(existingSlot);
      continue;
    }

    const candidates = await getAssignableCandidates(
      activeUsers,
      availabilityMap,
      normalizedDate,
      input.type,
      occupiedTasks,
      input.floor ?? null,
      recentTaskCounts
    ).then((entries) => entries.filter((user) => !reservedEmails.has(user.email)));
    const selectedUser = candidates[0];
    if (!selectedUser) {
      continue;
    }

    const assignedTask = await assignTaskToUser({
      user: selectedUser,
      date: normalizedDate,
      type: input.type,
      floor: input.floor ?? selectedUser.floor
    });
    reservedEmails.add(selectedUser.email);
    recentTaskCounts.set(selectedUser.email, (recentTaskCounts.get(selectedUser.email) ?? 0) + 1);
    results.push(assignedTask);
  }

  return results;
}

export async function completeCleaningTask(taskId: string, email: string, note?: string, photo?: string) {
  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId }
  });

  if (!task) {
    throw new Error("Cleaning task not found");
  }

  if (task.userEmail.toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error("You can only complete your own cleaning task");
  }

  if (!canCompleteTaskNow(task)) {
    throw new Error(`This task can only be marked done during ${getCompletionWindow(task).label}`);
  }

  const updated = await prisma.cleaningTask.update({
    where: { id: taskId },
    data: {
      status: CleaningTaskStatus.DONE_PENDING_AUDIT,
      completedAt: new Date(),
      completionNote: note,
      completionPhoto: photo
    }
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
  const task = await prisma.cleaningTask.findUnique({
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
        auditorNote: updatedTask.auditorNote
      });
    }
  }

  await invalidateCleaningOverviewCache(updatedTask.userEmail);
  return updatedTask;
}

export async function sweepOverdueCleaningTasks(now = new Date()) {
  const overdueTasks = await prisma.cleaningTask.findMany({
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
    const completionWindow = getCompletionWindow(task);
    if (completionWindow.windowEnd >= now) {
      continue;
    }

    const currentTask = await prisma.cleaningTask.findUnique({
      where: { id: task.id }
    });

    if (!currentTask || currentTask.status !== CleaningTaskStatus.ASSIGNED) {
      continue;
    }

    const existingFine = knownFines.find((entry) => isAutomaticCleaningFineForTask(entry.row, currentTask.id));
    const fineAmount = existingFine
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
        operator: AUTO_CLEANING_FINE_OPERATOR
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
    }

    const missedTask = await prisma.cleaningTask.update({
      where: { id: currentTask.id },
      data: {
        status: CleaningTaskStatus.MISSED,
        auditorNote: `Auto-marked as missed on ${now.toISOString()}. Fine amount: ${fineAmount} VND.`
      }
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
          auditorNote: missedTask.auditorNote
        });
      }
    }

    await invalidateCleaningOverviewCache(missedTask.userEmail);
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
  const knownFines = await getManagerFines();
  const results: Array<{ email: string; month: string; unavailableDays: number; releases: number }> = [];

  for (const user of activeUsers) {
    const email = user.email;

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

    const taskInMonth = await prisma.cleaningTask.findFirst({
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
  const activeUsers = await getActiveCleaningUsers();
  return activeUsers.find((entry) => entry.email === normalizedEmail) ?? null;
}

export async function setBulkCleaningAvailability(input: {
  email: string;
  dates: Date[];
  type: CleaningAvailabilityType;
  note?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
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
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getCleaningOptOutForEmail(email: string, month?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const targetMonth = month ?? currentYearMonth();
  return prisma.cleaningOptOut.findFirst({
    where: { userEmail: normalizedEmail, month: targetMonth }
  });
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
  return result;
}

export async function cancelCleaningOptOut(email: string, month: string) {
  const normalizedEmail = email.trim().toLowerCase();
  await prisma.cleaningOptOut.deleteMany({
    where: { userEmail: normalizedEmail, month }
  });
  await invalidateCleaningOverviewCache(normalizedEmail);
}

export async function getOptedOutEmailsForMonth(month: string): Promise<Set<string>> {
  const optOuts = await prisma.cleaningOptOut.findMany({
    where: { month },
    select: { userEmail: true }
  });
  return new Set(optOuts.map((o) => o.userEmail));
}

// Auto-schedule all cleaning slots for the next `horizonDays` days.
// Algorithm: for each empty slot, assign the eligible user with the least
// tasks in the last 60 days who has no other task that day and is not
// unavailable / opted out.
export async function autoScheduleCleaningTasks(horizonDays = 15) {
  const today = normalizeCalendarDate(new Date());
  const recentTaskCounts = await getRecentTaskCounts(addDays(today, -60));
  const activeUsers = await getActiveCleaningUsers();
  const calendarDefs = await getConfiguredCleaningCalendars();

  // Build slot definitions from calendar config (includes floor-specific TRASH_D7)
  const slotDefs =
    calendarDefs.length > 0
      ? calendarDefs.map((def) => ({ type: def.type as CleaningTaskType, floor: def.floor ?? null }))
      : dailyTaskConfigs.map((cfg) => ({ type: cfg.type, floor: null as number | null }));

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
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const optedOut = await getOptedOut(month);
    const eligibleUsers = activeUsers.filter((u) => !optedOut.has(u.email));

    const dayTasks = await prisma.cleaningTask.findMany({
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
        recentTaskCounts
      );

      if (candidates.length === 0) {
        continue;
      }

      const user = candidates[0];
      await assignTaskToUser({ user, date, type: def.type, floor: def.floor });

      // Update in-memory counts so the same user isn't over-assigned within this run
      const key = user.email.toLowerCase();
      recentTaskCounts.set(key, (recentTaskCounts.get(key) ?? 0) + 1);

      await invalidateCleaningOverviewCache(user.email);
      results.created++;
    }
  }

  return results;
}

// After a user releases a task, find the next open slot of the same type
// within the 15-day horizon and assign them to it.
async function autoReassignReleasedUser(input: {
  email: string;
  releasedDate: Date;
  type: CleaningTaskType;
  floor: number | null;
}) {
  const today = normalizeCalendarDate(new Date());
  const horizon = addDays(today, 15);
  const normalizedEmail = input.email.toLowerCase();
  const user = await getUserCleaningContext(normalizedEmail);
  if (!user) return;

  let cursor = addDays(normalizeCalendarDate(input.releasedDate), 1);

  while (cursor.getTime() <= horizon.getTime()) {
    const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const optedOut = await getOptedOutEmailsForMonth(month);
    if (optedOut.has(normalizedEmail)) {
      cursor = addDays(cursor, 1);
      continue;
    }

    // Skip if slot already has an assignment
    const existingSlot = await prisma.cleaningTask.findFirst({
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

    // Check user is not marked unavailable on this date
    const availabilityMap = await getAvailabilityMap(cursor, cursor);
    const normalizedDateKey = normalizeCalendarDate(cursor).toISOString();
    const availability = availabilityMap.get(`${normalizedEmail}|${normalizedDateKey}`);
    if (availability?.type === CleaningAvailabilityType.UNAVAILABLE) {
      cursor = addDays(cursor, 1);
      continue;
    }

    // Check no same-day task already
    const sameDayTask = await prisma.cleaningTask.findFirst({
      where: {
        userEmail: normalizedEmail,
        scheduledDate: { gte: calendarRangeStart(cursor), lte: calendarRangeEnd(cursor) }
      }
    });
    if (sameDayTask) {
      cursor = addDays(cursor, 1);
      continue;
    }

    await assignTaskToUser({ user, date: cursor, type: input.type, floor: input.floor });
    await invalidateCleaningOverviewCache(normalizedEmail);
    return;
  }
}
