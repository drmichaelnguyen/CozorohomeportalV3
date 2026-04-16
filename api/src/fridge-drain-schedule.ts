import { COZORO_TIMEZONE, getAuthorizedCalendarClient } from "./google-sheets.js";

export type FridgeDrainBranchId = "D2" | "D7";

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
    const events = await listFutureFridgeEvents(calendarId, branchId);
    const onSummary = FRIDGE_ON_SUMMARY[branchId];
    const onEvents = events
      .filter((ev) => (ev.summary ?? "").trim() === onSummary)
      .map((ev) => ({ ev, start: eventStartDate(ev) }))
      .filter((x): x is { ev: (typeof events)[number]; start: Date } => x.start !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const now = new Date();
    const next = onEvents.find((x) => x.start.getTime() >= now.getTime() - 6 * 60 * 60 * 1000);
    const cleaningOn = next?.start ?? null;
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
  const cleaningOn = await getNextFridgeDrainCleaningOn(branchId);
  if (!cleaningOn) {
    return [];
  }

  const days = vnCalendarDaysUntil(cleaningOn, new Date());
  if (days !== 5 && days !== 3 && days !== 1) {
    return [];
  }

  const dayWord = days === 5 ? "5 days" : days === 3 ? "3 days" : "1 day";
  const dateStr = cleaningOn.toLocaleDateString("en-GB", { timeZone: COZORO_TIMEZONE });
  return [
    {
      id: `fridge-drain-${branchId}-${vnDateKeyForDate(cleaningOn)}-${days}`,
      type: "FRIDGE_DRAIN_REMINDER",
      title: `Shared fridge drain (${branchId}) in ${dayWord}`,
      body: `Fridges switch off the day before at 17:00 and back on the cleaning day. Cleaning day (${branchId}): ${dateStr}.`,
      createdAt: new Date().toISOString(),
      unreadCount: 1,
      href: "/"
    }
  ];
}

export async function getManagerFridgeDrainSchedule(branchId: FridgeDrainBranchId) {
  const calendarId = getFridgeDrainCalendarId(branchId);
  if (!calendarId) {
    return {
      branchId,
      configured: false as const,
      error: "Calendar ID is not configured (set GOOGLE_FRIDGE_DRAIN_CALENDAR_D2 / _D7)."
    };
  }

  const cleaningOn = await getNextFridgeDrainCleaningOn(branchId);
  if (!cleaningOn) {
    return {
      branchId,
      configured: true as const,
      calendarId,
      cleaningDate: null as string | null,
      offSummary: FRIDGE_OFF_SUMMARY[branchId],
      onSummary: FRIDGE_ON_SUMMARY[branchId],
      offAt: null as string | null,
      onAt: null as string | null
    };
  }

  const ymd = vnDateKeyForDate(cleaningOn).split("-").map(Number);
  const [y, m, d] = ymd;
  if (!y || !m || !d) {
    return {
      branchId,
      configured: true as const,
      calendarId,
      cleaningDate: null,
      offSummary: FRIDGE_OFF_SUMMARY[branchId],
      onSummary: FRIDGE_ON_SUMMARY[branchId],
      offAt: null,
      onAt: null
    };
  }

  const offParts = ymdAddDays(y, m, d, -1);
  const offAt = atVnLocal(offParts.y, offParts.m, offParts.d, 17, 0);
  const onAt = atVnLocal(y, m, d, 9, 0);

  return {
    branchId,
    configured: true as const,
    calendarId,
    cleaningDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    offSummary: FRIDGE_OFF_SUMMARY[branchId],
    onSummary: FRIDGE_ON_SUMMARY[branchId],
    offAt: offAt.toISOString(),
    onAt: onAt.toISOString()
  };
}

export async function upsertFridgeDrainCleaningDate(input: {
  branchId: FridgeDrainBranchId;
  cleaningDate: string;
}) {
  const calendarId = getFridgeDrainCalendarId(input.branchId);
  if (!calendarId) {
    throw new Error("Fridge drain calendar is not configured for this branch.");
  }

  const ymd = parseYmd(input.cleaningDate);
  if (!ymd) {
    throw new Error("cleaningDate must be YYYY-MM-DD.");
  }

  const calendar = await getAuthorizedCalendarClient();
  const existing = await listFutureFridgeEvents(calendarId, input.branchId);
  for (const ev of existing) {
    if (ev.id) {
      await calendar.events.delete({ calendarId, eventId: ev.id });
    }
  }

  const { y, m, d } = ymd;
  const offParts = ymdAddDays(y, m, d, -1);
  const offStart = atVnLocal(offParts.y, offParts.m, offParts.d, 17, 0);
  const offEnd = new Date(offStart.getTime() + 15 * 60 * 1000);
  const onStart = atVnLocal(y, m, d, 9, 0);
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
