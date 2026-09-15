/**
 * Hostel stay calendar helpers shared by the main API.
 * Stay days are Vietnam (Asia/Ho_Chi_Minh) calendar labels, not host-local days.
 */

export const HOSTEL_BUSINESS_TIME_ZONE = process.env.COZORO_TIMEZONE || "Asia/Ho_Chi_Minh";

export function businessTodayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSTEL_BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function formatHostelBookingDateKey(value: unknown): string {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const normalized = /T|Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)
      ? trimmed
      : trimmed.replace(" ", "T");
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value as string | number);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → UTC noon for night counts (host-TZ independent). */
export function parseHostelStayDate(value: string): Date {
  const key = formatHostelBookingDateKey(value);
  if (!key) {
    return new Date(NaN);
  }
  return new Date(`${key}T12:00:00.000Z`);
}

export function hostelStayNights(checkIn: string, checkOut: string): number {
  const start = parseHostelStayDate(checkIn);
  const end = parseHostelStayDate(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

/** Parse sheet dd/mm/yyyy or ISO date into a YYYY-MM-DD Vietnam stay key. */
export function parseSheetOrIsoDateKey(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.includes("/")) {
    const [day, month, year] = raw.split("/");
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) {
      return "";
    }
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return formatHostelBookingDateKey(raw);
}
