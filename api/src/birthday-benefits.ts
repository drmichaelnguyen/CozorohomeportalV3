export const BIRTHDAY_COIN_GRANT = 30_000;
export const BIRTH_MONTH_EXTENSION_COIN_MULTIPLIER = 2;
export const BIRTH_MONTH_EXTENSION_MIN_MONTHS = 3;

const DOB_COLUMN_ALIASES = [
  "Ngày tháng năm sinh",
  "Ngay thang nam sinh",
  "Date of birth",
  "birthday",
  "birthdate"
];

export type ParsedDateOfBirth = {
  day: number;
  month: number;
  year: number;
};

export function vietnamCalendarParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.COZORO_TIMEZONE || "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day"))
  };
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseDdMmYyyy(value: string): ParsedDateOfBirth | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1]!, 10);
    const month = Number.parseInt(isoMatch[2]!, 10);
    const day = Number.parseInt(isoMatch[3]!, 10);
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
    return { year, month, day };
  }

  if (!trimmed.includes("/")) return null;
  const parts = trimmed.split("/");
  if (parts.length < 3) return null;
  const day = Number.parseInt(parts[0]!.trim(), 10);
  const month = Number.parseInt(parts[1]!.trim(), 10);
  const yearRaw = Number.parseInt(parts[2]!.trim(), 10);
  if (![day, month, yearRaw].every((n) => Number.isFinite(n))) return null;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime()) || dt.getDate() !== day || dt.getMonth() !== month - 1) return null;
  return { year, month, day };
}

export function findClientDateOfBirthValue(row: Record<string, string>): string {
  for (const alias of DOB_COLUMN_ALIASES) {
    const value = row[alias]?.trim();
    if (value) return value;
  }
  const target = normalizeLookupKey("ngaythangnamsinh");
  for (const [key, value] of Object.entries(row)) {
    if (!String(value ?? "").trim()) continue;
    if (normalizeLookupKey(key) === target) return String(value).trim();
  }
  return "";
}

export function parseClientDateOfBirth(row: Record<string, string>): ParsedDateOfBirth | null {
  return parseDdMmYyyy(findClientDateOfBirthValue(row));
}

export function isBirthMonth(dob: ParsedDateOfBirth, now = new Date()): boolean {
  const calendar = vietnamCalendarParts(now);
  return dob.month === calendar.month;
}

export function isBirthdayToday(dob: ParsedDateOfBirth, now = new Date()): boolean {
  const calendar = vietnamCalendarParts(now);
  return dob.month === calendar.month && dob.day === calendar.day;
}

export function isClientBirthMonth(row: Record<string, string>, now = new Date()): boolean {
  const dob = parseClientDateOfBirth(row);
  return dob ? isBirthMonth(dob, now) : false;
}

export function isClientBirthdayToday(row: Record<string, string>, now = new Date()): boolean {
  const dob = parseClientDateOfBirth(row);
  return dob ? isBirthdayToday(dob, now) : false;
}

export function extensionCoinRewardTier(extensionMonths: number): number {
  if (extensionMonths >= 12) return 50_000;
  if (extensionMonths >= 6) return 25_000;
  if (extensionMonths >= 3) return 10_000;
  return 0;
}

export function computeExtensionCoinReward(extensionMonths: number, birthMonthBonus: boolean): number {
  const base = extensionCoinRewardTier(extensionMonths);
  if (!birthMonthBonus || extensionMonths < BIRTH_MONTH_EXTENSION_MIN_MONTHS) {
    return base;
  }
  return base * BIRTH_MONTH_EXTENSION_COIN_MULTIPLIER;
}

export function buildBirthdayBenefitsSummary(row: Record<string, string> | null, now = new Date()) {
  const dob = row ? parseClientDateOfBirth(row) : null;
  const birthMonthActive = dob ? isBirthMonth(dob, now) : false;
  const birthdayToday = dob ? isBirthdayToday(dob, now) : false;
  return {
    hasDateOfBirth: Boolean(dob),
    isBirthMonth: birthMonthActive,
    isBirthdayToday: birthdayToday,
    birthdayCoinGrant: BIRTHDAY_COIN_GRANT,
    extensionCoinMultiplier: BIRTH_MONTH_EXTENSION_COIN_MULTIPLIER,
    extensionMinMonths: BIRTH_MONTH_EXTENSION_MIN_MONTHS,
    extensionCoinTiers: {
      3: computeExtensionCoinReward(3, birthMonthActive),
      6: computeExtensionCoinReward(6, birthMonthActive),
      12: computeExtensionCoinReward(12, birthMonthActive)
    }
  };
}
