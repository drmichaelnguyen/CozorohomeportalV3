/**
 * Hostel stay calendar helpers.
 *
 * Property business days are always Asia/Ho_Chi_Minh (Vietnam), even when the
 * Node host runs in America/Vancouver. Stay dates are calendar labels
 * (YYYY-MM-DD), stored as UTC-noon DATETIME anchors for stable round-trips.
 */

const BUSINESS_TIME_ZONE = process.env.COZORO_TIMEZONE || "Asia/Ho_Chi_Minh";
/** Vietnam observes UTC+7 year-round (no DST). */
const BUSINESS_UTC_OFFSET = "+07:00";

function isDateOnlyString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function businessTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function addBusinessDays(isoDate, days) {
  const match = String(isoDate || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day + Number(days), 12, 0, 0, 0));
  return utc.toISOString().slice(0, 10);
}

/**
 * Format a DB Date / DATETIME / YYYY-MM-DD into a stay calendar key.
 * Never slice the first 10 chars of a DATETIME wall-clock string — legacy rows
 * written from UTC midnight on a Vancouver host are stored as the previous
 * local evening (e.g. 2026-03-14 17:00:00 for 2026-03-15).
 */
function formatBookingDateKey(value) {
  if (value == null || value === "") {
    return "";
  }
  if (isDateOnlyString(value)) {
    return String(value).trim();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → Date at UTC noon (storage / night-math anchor). */
function parseBusinessDate(value) {
  const key = formatBookingDateKey(value);
  if (!key) {
    return new Date(NaN);
  }
  return new Date(`${key}T12:00:00.000Z`);
}

/** Alias kept for older call sites. */
function dateOnlyToUtc(value) {
  return parseBusinessDate(value);
}

/** Instant of Vietnam local midnight for a stay calendar day. */
function businessDayStartMs(isoDate) {
  const key = formatBookingDateKey(isoDate);
  if (!key) {
    return NaN;
  }
  return new Date(`${key}T00:00:00${BUSINESS_UTC_OFFSET}`).getTime();
}

function nightsBetween(checkIn, checkOut) {
  const start = parseBusinessDate(checkIn);
  const end = parseBusinessDate(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NaN;
  }
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function hoursUntilBusinessCheckIn(checkInValue, now = Date.now()) {
  const checkInAt = businessDayStartMs(checkInValue);
  if (!Number.isFinite(checkInAt)) {
    return NaN;
  }
  const current = Number.isFinite(now) ? now : Date.now();
  return (checkInAt - current) / 3600000;
}

function isFaceCaptureWindowOpen(checkInValue, windowHours, now = Date.now()) {
  const remainingHours = hoursUntilBusinessCheckIn(checkInValue, now);
  return Number.isFinite(remainingHours) && remainingHours <= windowHours && remainingHours >= 0;
}

module.exports = {
  BUSINESS_TIME_ZONE,
  BUSINESS_UTC_OFFSET,
  businessTodayKey,
  addBusinessDays,
  formatBookingDateKey,
  parseBusinessDate,
  dateOnlyToUtc,
  businessDayStartMs,
  nightsBetween,
  hoursUntilBusinessCheckIn,
  isFaceCaptureWindowOpen
};
