import { COZORO_TIMEZONE, getAuthorizedCalendarClient } from "./google-sheets.js";
import { isBranchAutomationDisabled } from "./branch-closure.js";

export type FridgeDrainBranchId = "D2" | "D7";

/** VN local times used when creating calendar events (defaults). */
export const DEFAULT_FRIDGE_OFF_TIME = "17:00";
export const DEFAULT_FRIDGE_ON_TIME = "17:00";

const DEFAULT_OFF_HM = { hh: 17, mm: 0 };
const DEFAULT_ON_HM = { hh: 17, mm: 0 };

const FRIDGE_OFF_SUMMARY: Record<FridgeDrainBranchId, string> = {
  D2: "D2 xả tủ lạnh OFFD2",
  D7: "D7 xả tủ lạnh OFF D7"
};

const FRIDGE_ON_SUMMARY: Record<FridgeDrainBranchId, string> = {
  D2: "D2 Bật tủ lạnh trở lại OND2",
  D7: "D7 Bật tủ lạnh trở lại ON"
};

const calendarIdByBranch: Record<FridgeDrainBranchId, string | undefined> = {
  D2: process.env.GOOGLE_FRIDGE_DRAIN_CALENDAR_D2?.trim() || undefined,
  D7: process.env.GOOGLE_FRIDGE_DRAIN_CALENDAR_D7?.trim() || undefined
};

const scheduleCache = new Map<
  FridgeDrainBranchId,
  { loadedAt: number; cleaningOn: Date | null }
>();
const SCHEDULE_CACHE_MS = 60 * 1000;

function clearScheduleCache(branchId?: FridgeDrainBranchId) {
  if (branchId) {
    scheduleCache.delete(branchId);
  } else {
    scheduleCache.clear();
  }
}

function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function ymdAddDays(y: number, m: number, d: number, delta: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** YYYY-MM-DD in Asia/Ho_Chi_Minh for a Date (typically event start). */
export function vnDateKeyForDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: COZORO_TIMEZONE });
}

/** Whole calendar days from "today" (VN) to `targetDay` (VN date of cleaning morning). */
export function vnCalendarDaysUntil(targetDay: Date, now = new Date()): number {
  const a = now.toLocaleDateString("en-CA", { timeZone: COZORO_TIMEZONE });
  const b = targetDay.toLocaleDateString("en-CA", { timeZone: COZORO_TIMEZONE });
  const start = new Date(`${a}T12:00:00+07:00`);
  const end = new Date(`${b}T12:00:00+07:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function atVnLocal(y: number, m: number, d: number, hh: number, mm: number) {
  return new Date(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`
  );
}

export function vnFormatHm(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: COZORO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export function parseFridgeHm(
  value: unknown,
  fallback: { hh: number; mm: number }
): { hh: number; mm: number } {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error("offTime and onTime must be HH:mm strings (Asia/Ho_Chi_Minh).");
  }
  const t = value.trim();
  if (t === "") {
    return fallback;
  }
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new Error("offTime and onTime must be HH:mm (e.g. 17:00).");
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error("Invalid fridge schedule time.");
  }
  return { hh, mm };
}

export function getFridgeDrainCalendarId(branchId: FridgeDrainBranchId): string | null {
  return calendarIdByBranch[branchId] ?? null;
}

function eventStartDate(ev: { start?: { dateTime?: string | null; date?: string | null } } | null): Date | null {
  if (!ev?.start) return null;
  if (ev.start.dateTime) {
    const d = new Date(ev.start.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (ev.start.date) {
    const d = new Date(`${ev.start.date}T12:00:00+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function listFutureFridgeEvents(calendarId: string, branchId: FridgeDrainBranchId) {
  const calendar = await getAuthorizedCalendarClient();
  const timeMin = new Date(Date.now() - 2 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 400 * 86400000).toISOString();
  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250
  });
  const items = response.data.items ?? [];
  const onSummary = FRIDGE_ON_SUMMARY[branchId];
  const offSummary = FRIDGE_OFF_SUMMARY[branchId];
  return items.filter((ev) => {
    const s = (ev.summary ?? "").trim();
    return s === onSummary || s === offSummary;
  });
}

export type FridgeDrainNextPair = {
  offAt: Date;
  onAt: Date;
  cleaningDateYmd: string;
};

/** Next OFF/ON pair from Google Calendar (actual event start times). */
export async function loadNextFridgeDrainPair(branchId: FridgeDrainBranchId): Promise<FridgeDrainNextPair | null> {
  const calendarId = getFridgeDrainCalendarId(branchId);
  if (!calendarId) {
    return null;
  }

  const events = await listFutureFridgeEvents(calendarId, branchId);
  const onSummary = FRIDGE_ON_SUMMARY[branchId];
  const offSummary = FRIDGE_OFF_SUMMARY[branchId];

  const onEvents = events
    .filter((ev) => (ev.summary ?? "").trim() === onSummary)
    .map((ev) => ({ ev, start: eventStartDate(ev) }))
    .filter((x): x is { ev: (typeof events)[number]; start: Date } => x.start !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const now = new Date();
  const nextOn = onEvents.find((x) => x.start.getTime() >= now.getTime() - 6 * 60 * 60 * 1000);
  if (!nextOn) {
    return null;
  }

  const onAt = nextOn.start;
  const cleaningDateYmd = vnDateKeyForDate(onAt);
  const ymd = cleaningDateYmd.split("-").map(Number);
  const [y, m, d] = ymd;
  if (!y || !m || !d) {
    return null;
  }

  const offParts = ymdAddDays(y, m, d, -1);
  const offDateKey = `${offParts.y}-${String(offParts.m).padStart(2, "0")}-${String(offParts.d).padStart(2, "0")}`;

  const offCandidates = events
    .filter((ev) => (ev.summary ?? "").trim() === offSummary)
    .map((ev) => ({ ev, start: eventStartDate(ev) }))
    .filter((x): x is { ev: (typeof events)[number]; start: Date } => x.start !== null);

  const offEv = offCandidates.find((x) => vnDateKeyForDate(x.start) === offDateKey);

  const offAt = offEv
    ? offEv.start
    : atVnLocal(offParts.y, offParts.m, offParts.d, DEFAULT_OFF_HM.hh, DEFAULT_OFF_HM.mm);

  return { offAt, onAt, cleaningDateYmd };
}

export async function getNextFridgeDrainCleaningOn(branchId: FridgeDrainBranchId): Promise<Date | null> {
  const calendarId = getFridgeDrainCalendarId(branchId);
  if (!calendarId) {
    return null;
  }

  const cached = scheduleCache.get(branchId);
  if (cached && Date.now() - cached.loadedAt < SCHEDULE_CACHE_MS) {
    return cached.cleaningOn;
  }

  try {
    const pair = await loadNextFridgeDrainPair(branchId);
    const cleaningOn = pair?.onAt ?? null;
    scheduleCache.set(branchId, { loadedAt: Date.now(), cleaningOn });
    return cleaningOn;
  } catch {
    scheduleCache.set(branchId, { loadedAt: Date.now(), cleaningOn: null });
    return null;
  }
}

export type FridgeDrainReminder = {
  id: string;
  type: "FRIDGE_DRAIN_REMINDER";
  title: string;
  body: string;
  createdAt: string;
  unreadCount: number;
  href: string;
};

export async function buildFridgeDrainReminderNotifications(branchId: FridgeDrainBranchId): Promise<FridgeDrainReminder[]> {
  if (isBranchAutomationDisabled(branchId)) {
    return [];
  }

  const pair = await loadNextFridgeDrainPair(branchId);
  if (!pair) {
    return [];
  }

  const days = vnCalendarDaysUntil(pair.onAt, new Date());
  if (days !== 5 && days !== 3 && days !== 1) {
    return [];
  }

  const dayWord = days === 5 ? "5 days" : days === 3 ? "3 days" : "1 day";
  const dateStr = pair.onAt.toLocaleDateString("en-GB", { timeZone: COZORO_TIMEZONE });
  const offHm = vnFormatHm(pair.offAt);
  const onHm = vnFormatHm(pair.onAt);
  return [
    {
      id: `fridge-drain-${branchId}-${vnDateKeyForDate(pair.onAt)}-${days}`,
      type: "FRIDGE_DRAIN_REMINDER",
      title: `Shared fridge drain (${branchId}) in ${dayWord}`,
      body: `Fridges switch off the day before at ${offHm} and back on the cleaning day at ${onHm} (${COZORO_TIMEZONE}). Cleaning day (${branchId}): ${dateStr}.`,
      createdAt: new Date().toISOString(),
      unreadCount: 1,
      href: "/"
    }
  ];
}

export async function getManagerFridgeDrainSchedule(branchId: FridgeDrainBranchId) {
  if (isBranchAutomationDisabled(branchId)) {
    return {
      branchId,
      configured: false as const,
      closed: true as const,
      error: "D2 branch is permanently closed. Fridge drain automation has been stopped."
    };
  }

  const calendarId = getFridgeDrainCalendarId(branchId);
  if (!calendarId) {
    return {
      branchId,
      configured: false as const,
      error: "Calendar ID is not configured (set GOOGLE_FRIDGE_DRAIN_CALENDAR_D2 / _D7)."
    };
  }

  const pair = await loadNextFridgeDrainPair(branchId);
  if (!pair) {
    return {
      branchId,
      configured: true as const,
      calendarId,
      cleaningDate: null as string | null,
      offSummary: FRIDGE_OFF_SUMMARY[branchId],
      onSummary: FRIDGE_ON_SUMMARY[branchId],
      offAt: null as string | null,
      onAt: null as string | null,
      offTime: null as string | null,
      onTime: null as string | null
    };
  }

  const [y, m, d] = pair.cleaningDateYmd.split("-").map(Number);
  if (!y || !m || !d) {
    return {
      branchId,
      configured: true as const,
      calendarId,
      cleaningDate: null,
      offSummary: FRIDGE_OFF_SUMMARY[branchId],
      onSummary: FRIDGE_ON_SUMMARY[branchId],
      offAt: null,
      onAt: null,
      offTime: null,
      onTime: null
    };
  }

  return {
    branchId,
    configured: true as const,
    calendarId,
    cleaningDate: pair.cleaningDateYmd,
    offSummary: FRIDGE_OFF_SUMMARY[branchId],
    onSummary: FRIDGE_ON_SUMMARY[branchId],
    offAt: pair.offAt.toISOString(),
    onAt: pair.onAt.toISOString(),
    offTime: vnFormatHm(pair.offAt),
    onTime: vnFormatHm(pair.onAt)
  };
}

export async function upsertFridgeDrainCleaningDate(input: {
  branchId: FridgeDrainBranchId;
  cleaningDate: string;
  /** VN local time on the day before cleaning (power off). Default 17:00. */
  offTime?: string;
  /** VN local time on cleaning day (power on). Default 17:00. */
  onTime?: string;
}) {
  if (isBranchAutomationDisabled(input.branchId)) {
    throw new Error("D2 branch is permanently closed. Fridge drain automation has been stopped.");
  }

  const calendarId = getFridgeDrainCalendarId(input.branchId);
  if (!calendarId) {
    throw new Error("Fridge drain calendar is not configured for this branch.");
  }

  const ymd = parseYmd(input.cleaningDate);
  if (!ymd) {
    throw new Error("cleaningDate must be YYYY-MM-DD.");
  }

  const offHm = parseFridgeHm(input.offTime, DEFAULT_OFF_HM);
  const onHm = parseFridgeHm(input.onTime, DEFAULT_ON_HM);

  const calendar = await getAuthorizedCalendarClient();
  const existing = await listFutureFridgeEvents(calendarId, input.branchId);
  for (const ev of existing) {
    if (ev.id) {
      await calendar.events.delete({ calendarId, eventId: ev.id });
    }
  }

  const { y, m, d } = ymd;
  const offParts = ymdAddDays(y, m, d, -1);
  const offStart = atVnLocal(offParts.y, offParts.m, offParts.d, offHm.hh, offHm.mm);
  const offEnd = new Date(offStart.getTime() + 15 * 60 * 1000);
  const onStart = atVnLocal(y, m, d, onHm.hh, onHm.mm);
  const onEnd = new Date(onStart.getTime() + 30 * 60 * 1000);

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: FRIDGE_OFF_SUMMARY[input.branchId],
      description:
        "Cozoro portal: fridges off for drain/clean. IFTTT keyword event — do not rename summary. Auto-managed.",
      start: { dateTime: offStart.toISOString(), timeZone: COZORO_TIMEZONE },
      end: { dateTime: offEnd.toISOString(), timeZone: COZORO_TIMEZONE }
    }
  });

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: FRIDGE_ON_SUMMARY[input.branchId],
      description:
        "Cozoro portal: fridges back on after drain/clean. IFTTT keyword event — do not rename summary. Auto-managed.",
      start: { dateTime: onStart.toISOString(), timeZone: COZORO_TIMEZONE },
      end: { dateTime: onEnd.toISOString(), timeZone: COZORO_TIMEZONE }
    }
  });

  clearScheduleCache(input.branchId);
  return getManagerFridgeDrainSchedule(input.branchId);
}
