import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { calendar_v3, google } from "googleapis";
import { repairMojibake, repairUnknownText } from "./text-encoding.js";

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID ?? "";
const paymentsSpreadsheetId = process.env.GOOGLE_PAYMENT_SPREADSHEET_ID ?? spreadsheetId;
const sheetName = process.env.GOOGLE_SHEET_NAME ?? "COZORODATABASE";
const coinsSheetName = process.env.GOOGLE_COINS_SHEET_NAME ?? "COZORO COINS";
const paymentsSheetName = process.env.GOOGLE_PAYMENTS_SHEET_NAME ?? "BIÊN NHẬN";
const paymentsSheetId = Number.parseInt(process.env.GOOGLE_PAYMENTS_SHEET_ID ?? "899746382", 10);
const finesSheetName = process.env.GOOGLE_FINES_SHEET_NAME ?? "PHÍ VI PHẠM";
const finesSheetId = Number.parseInt(process.env.GOOGLE_FINES_SHEET_ID ?? "1635408871", 10);
const finesDriveFolderId = process.env.GOOGLE_FINE_IMAGE_FOLDER_ID ?? "";
const maintenanceSheetName = process.env.GOOGLE_MAINTENANCE_SHEET_NAME ?? "MAINTENANCE";
const maintenanceSheetId = Number.parseInt(process.env.GOOGLE_MAINTENANCE_SHEET_ID ?? "0", 10);

export const MAINTENANCE_TICKET_ID_COLUMN = "TICKET ID";
export const MAINTENANCE_RESIDENT_EMAIL_COLUMN = "RESIDENT EMAIL";
export const MAINTENANCE_RESIDENT_NAME_COLUMN = "RESIDENT NAME";
export const MAINTENANCE_BRANCH_COLUMN = "BRANCH";
export const MAINTENANCE_LOCATION_COLUMN = "LOCATION";
export const MAINTENANCE_DEVICE_COLUMN = "DEVICE";
export const MAINTENANCE_ISSUE_COLUMN = "ISSUE DESCRIPTION";
export const MAINTENANCE_REPORTED_AT_COLUMN = "REPORTED AT";
export const MAINTENANCE_STATUS_COLUMN = "STATUS";
export const MAINTENANCE_MECHANIC_EMAIL_COLUMN = "MECHANIC EMAIL";
export const MAINTENANCE_SOLVED_AT_COLUMN = "SOLVED AT";
export const MAINTENANCE_REPAIR_TIME_COLUMN = "REPAIR TIME MINUTES";
export const MAINTENANCE_SATISFACTION_COLUMN = "RESIDENT SATISFACTION";
export const MAINTENANCE_FEEDBACK_COLUMN = "RESIDENT FEEDBACK";
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/integrations/google/oauth/callback";
const SUPPORTED_COZORO_TIMEZONES = ["Asia/Ho_Chi_Minh", "America/Vancouver"] as const;
const requestedCozoroTimeZone = process.env.COZORO_TIMEZONE ?? "Asia/Ho_Chi_Minh";
export const COZORO_TIMEZONE = SUPPORTED_COZORO_TIMEZONES.includes(
  requestedCozoroTimeZone as (typeof SUPPORTED_COZORO_TIMEZONES)[number]
)
  ? requestedCozoroTimeZone
  : "Asia/Ho_Chi_Minh";

const tokenFilePath = path.join(process.cwd(), ".google-oauth.json");
const cacheDirPath = path.join(process.cwd(), "data");
const cacheFilePath = path.join(cacheDirPath, "clients-cache.json");
const coinsCacheFilePath = path.join(cacheDirPath, "coins-cache.json");
const paymentsCacheFilePath = path.join(cacheDirPath, "payments-cache.json");
const finesCacheFilePath = path.join(cacheDirPath, "fines-cache.json");
const cleaningCalendarCacheFilePath = path.join(cacheDirPath, "cleaning-calendars-cache.json");
const laundryCouponsFilePath = path.join(cacheDirPath, "laundry-coupons.json");
const staffAccessFilePath = path.join(cacheDirPath, "portal-staff-access.json");

async function getStaffEntryByEmail(email: string) {
  try {
    const content = await readFile(staffAccessFilePath, "utf8");
    const data = JSON.parse(content);
    return (data.staff || []).find((entry: any) => String(entry.email).toLowerCase() === String(email).toLowerCase()) ?? null;
  } catch (err) {
    return null;
  }
}
const laundryCouponRedemptionsFilePath = path.join(cacheDirPath, "laundry-coupon-redemptions.json");
const maintenanceCacheFilePath = path.join(cacheDirPath, "maintenance-cache.json");
type MemoryCachedValue<T> = {
  value: T;
  loadedAt: number;
};

const CACHE_MEMORY_TTL_MS = Number(process.env.LOCAL_CACHE_MEMORY_TTL_MS ?? 5 * 60 * 1000);
let clientsMemoryCache: MemoryCachedValue<ClientCache> | null = null;
let coinsMemoryCache: MemoryCachedValue<CoinsCache> | null = null;
let paymentsMemoryCache: MemoryCachedValue<PaymentsCache> | null = null;
let finesMemoryCache: MemoryCachedValue<FinesCache> | null = null;
let cleaningCalendarMemoryCache: MemoryCachedValue<CleaningCalendarCache> | null = null;
export type MaintenanceTicket = {
  id: string;
  residentEmail: string;
  residentName: string;
  branch: string;
  location: string;
  device: string;
  issue: string;
  reportedAt: string;
  status: "REPORTED" | "ASSIGNED" | "SOLVED" | "CLOSED";
  mechanicEmail?: string | null;
  solvedAt?: string | null;
  repairTimeMinutes?: number | null;
  satisfaction?: "SATISFIED" | "UNSATISFIED" | null;
  feedback?: string | null;
  row: Record<string, string>;
};

export type MaintenanceCache = {
  syncedAt: string;
  tickets: MaintenanceTicket[];
};

let maintenanceMemoryCache: MemoryCachedValue<MaintenanceCache> | null = null;

const syncIntervalMs = 6 * 60 * 60 * 1000;
const laundryHistoryMonthsBack = 12;
const laundryMonthsForward = 12;
const calendarCacheTtlMs = 4 * 60 * 60 * 1000;
const configuredLaundryCalendarIds = (process.env.GOOGLE_LAUNDRY_CALENDAR_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
export const laundryMachines = [
  {
    id: "d2-washer",
    calendarId: "p5cvikf3pn8292denaig3gmed0@group.calendar.google.com",
    label: "Máy giặt D2",
    branchId: "D2",
    type: "WASHER",
    durationMinutes: 75,
    coinPrice: 7000,
    allowsFreeLaundry: true
  },
  {
    id: "d7-washer-horizontal",
    calendarId: "iqido2c13cb85i2lsgq70qu59g@group.calendar.google.com",
    label: "Giặt lồng đứng D7",
    branchId: "D7",
    type: "WASHER",
    durationMinutes: 90,
    coinPrice: 7000,
    allowsFreeLaundry: true
  },
  {
    id: "d7-washer-paid",
    calendarId: "vmtcgatmh7irp19qsmrrbjsr34@group.calendar.google.com",
    label: "Giặt D7 trả phí (Whirlpool)",
    branchId: "D7",
    type: "WASHER",
    durationMinutes: 90,
    coinPrice: 7000,
    allowsFreeLaundry: false
  },
  {
    id: "d7-dryer",
    calendarId: "029mijq7g3katbdhie206q4fk8@group.calendar.google.com",
    label: "Máy sấy D7",
    branchId: "D7",
    type: "DRYER",
    durationMinutes: 120,
    coinPrice: 7000,
    allowsFreeLaundry: true
  }
] as const;

const EMAIL_COLUMN = "\u0110\u1ecba ch\u1ec9 email";
const HIDDEN_EMAIL_COLUMN = "\u0110\u1ecba ch\u1ec9 email - Hidden";
const ACTIVE_STAYING_COLUMN = "Hi\u1ec7n c\u00f2n \u1edf";
const CONTRACT_CODE_COLUMN = "M\u00c3 HD";
const CLIENT_NAME_COLUMN = "T\u00ean";
const CLIENT_BED_COLUMN = "s\u1ed1 gi\u01b0\u1eddng";
const CLIENT_GENDER_COLUMN = "Gi\u1edbi t\u00ednh";
const CLIENT_BRANCH_COLUMN = "Chi nh\u00e1nh Cozoro dorm";
const CLIENT_PHONE_COLUMN = "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i li\u00ean h\u1ec7";
const CLIENT_CONTRACT_START_COLUMN = "Ng\u00e0y b\u1eaft \u0111\u1ea7u h\u1ee3p \u0111\u1ed3ng";
const CLIENT_CONTRACT_END_COLUMN = "Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng";
const CLIENT_SHORT_TERM_FEE_COLUMN = "Ph\u00ed ng\u1eafn h\u1ea1n";
const CLIENT_SHORT_TERM_FREE_COLUMN = "Mi\u1ec5n ph\u00ed ng\u1eafn h\u1ea1n?";
const CLIENT_TOTAL_COINS_COLUMN = "T\u1ed5ng Coins t\u00edch lu\u1ef9";
const CLIENT_NOTE_COLUMN = "Ch\u00fa th\u00edch";
const CLIENT_CURRENT_COINS_COLUMN = "Cozoro coins hi\u1ec7n c\u00f3";
const COINS_TIMESTAMP_COLUMN = "D\u1ea4U TH\u1edcI GIAN";
const COINS_BALANCE_COLUMN = "COINS";
const COINS_EVENT_COLUMN = "S\u1ef1 ki\u1ec7n";
const COINS_OPERATOR_COLUMN = "Ng\u01b0\u1eddi thao t\u00e1c";
const COINS_MEMBER_COLUMN = "Cozoro Member";
const COINS_CURRENT_BALANCE_COLUMN = "S\u1ed1 Coins hi\u1ec7n c\u00f3";
const COINS_TRANSACTION_CODE_COLUMN = "M\u00e3 giao d\u1ecbch";
const PAYMENT_TIMESTAMP_COLUMN = COINS_TIMESTAMP_COLUMN;
const PAYMENT_AMOUNT_COLUMN = "S\u1ed0 TI\u1ec0N";
const PAYMENT_PURPOSE_COLUMN = "M\u1ee4C \u0110\u00cdCH";
const PAYMENT_DETAILS_COLUMN = "M\u1ee4C \u0110\u00cdCH - GHI R\u00d5";
const PAYMENT_PAYER_COLUMN = "NG\u01af\u1edcI \u0110\u00d3NG TI\u1ec0N";
const PAYMENT_RECEIVER_COLUMN = "NG\u01af\u1edCI NH\u1eacN TI\u1ec0N";
const FINE_EMAIL_COLUMN = "EMAIL";
const FINE_TIMESTAMP_COLUMN = COINS_TIMESTAMP_COLUMN;
const FINE_AMOUNT_COLUMN = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
const FINE_STATUS_COLUMN = "\u0110\u00c3 THANH TO\u00c1N?";
const FINE_CONTENT_COLUMN = "N\u1ed8I DUNG VI PH\u1ea0M";
const FINE_DESCRIPTION_COLUMN = "M\u00d4 T\u1ea2 VI PH\u1ea0M";
const FINE_DUE_COLUMN = "H\u1ea0N THANH TO\u00c1N";
const FINE_DISPUTE_COLUMN = "Khieu nai tu khach hang";
const FINE_CREATED_AT_COLUMN = "TH\u1edcI \u0110I\u1ec2M L\u1eACP PHI\u1ebeU";
const FINE_CREATED_YEAR_COLUMN = "N\u0102M L\u1eACP PHI\u1ebeU";
const FINE_CREATED_MONTH_COLUMN = "TH\u00c1NG L\u1eACP PHI\u1ebeU";
const FINE_BRANCH_COLUMN = "CHI NH\u00c1NH DORM";
const FINE_NAME_COLUMN = "T\u00caN";
const FINE_BED_COLUMN = "S\u1ed0 GI\u01af\u1edcNG";
const FINE_CREATOR_COLUMN = "NG\u01af\u1edCI L\u1eACP PHI\u1ebeU";
const FINE_LOCATION_COLUMN = "V\u1eca TR\u00cd PH\u00c1T HI\u1ec6N VI PH\u1ea0M";
const FINE_IMAGE_COLUMN = "H\u00ccNH \u1ea2NH";

const blockedClientUpdateColumns = new Set([
  "Äá»‹a chá»‰ email - Hidden"
]);

const cozoroMemberTiers = [
  { name: "Gold", threshold: 100000, maintainCoins: 5000, upgradeCoins: 5000 },
  { name: "Platinum", threshold: 150000, maintainCoins: 10000, upgradeCoins: 10000 },
  { name: "Diamond", threshold: 300000, maintainCoins: 20000, upgradeCoins: 20000 },
  { name: "Elite", threshold: 800000, maintainCoins: 40000, upgradeCoins: 40000 }
] as const;

const normalizedHeaderAliases = new Map<string, string>([
  ["\u0111\u1ecba ch\u1ec9 email", EMAIL_COLUMN],
  ["\u0111\u1ecba ch\u1ec9 email hidden", HIDDEN_EMAIL_COLUMN],
  ["hi\u1ec7n c\u00f2n \u1edf", ACTIVE_STAYING_COLUMN],
  ["m\u00e3 hd", CONTRACT_CODE_COLUMN],
  ["d\u1ea5u th\u1eddi gian", COINS_TIMESTAMP_COLUMN],
  ["coins", COINS_BALANCE_COLUMN],
  ["s\u1ef1 ki\u1ec7n", COINS_EVENT_COLUMN],
  ["ng\u01b0\u1eddi thao t\u00e1c", COINS_OPERATOR_COLUMN],
  ["cozoro member", COINS_MEMBER_COLUMN],
  ["s\u1ed1 coins hi\u1ec7n c\u00f3", COINS_CURRENT_BALANCE_COLUMN],
  ["m\u00e3 giao d\u1ecbch", COINS_TRANSACTION_CODE_COLUMN]
]);

export type ClientRow = Record<string, string> & {
  [EMAIL_COLUMN]: string;
  [ACTIVE_STAYING_COLUMN]: string;
  [CONTRACT_CODE_COLUMN]: string;
};

export type ClientCache = {
  syncedAt: string;
  rows: ClientRow[];
};

export type CoinRow = Record<string, string> & {
  [EMAIL_COLUMN]: string;
  [COINS_TIMESTAMP_COLUMN]: string;
};

export type CoinsCache = {
  syncedAt: string;
  rows: CoinRow[];
};

export type PaymentRow = Record<string, string> & {
  [EMAIL_COLUMN]: string;
  [PAYMENT_TIMESTAMP_COLUMN]: string;
};

export type PaymentsCache = {
  syncedAt: string;
  rows: PaymentRow[];
};

export type PaidGuestBookingClientInput = {
  bookingId: string;
  guestEmail: string;
  guestName: string;
  guestPhone: string;
  bioSex: string;
  branchId: "D2" | "D7";
  bedNumber: number;
  checkIn: string;
  checkOut: string;
  pricingTotal: number;
  notes?: string;
};

export type FineRow = Record<string, string> & {
  [FINE_EMAIL_COLUMN]: string;
  [FINE_TIMESTAMP_COLUMN]: string;
};

export type FineEntry = {
  row: FineRow;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
  coinPayment: {
    coinCost: number;
    currentCoins: number;
    canPay: boolean;
    recordedMember: string;
    multiplier: number;
    isPaid: boolean;
  };
};

export type FinesCache = {
  syncedAt: string;
  rows: FineRow[];
};

export type ManagerSafeClient = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  gender: string;
  activeStay: string;
  currentCoins: string;
  totalCoins: string;
  recordedMember: string;
  row: Record<string, string>;
};

export type CleaningCalendarTarget = {
  calendarId: string;
  title: string;
};

export type CleaningCalendarDefinition = {
  calendarId: string;
  title: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  branchId: "D2" | "D7";
  floor: number | null;
};

export type CleaningCalendarEvent = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  status: string;
  start: string;
  end: string;
  htmlLink: string;
  taskType: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  branchId: "D2" | "D7";
  floor: number | null;
  userEmail: string | null;
  userName: string | null;
};

type CleaningCalendarCache = {
  syncedAt: string;
  events: CleaningCalendarEvent[];
};

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientSecret === "REPLACE_WITH_YOUR_CLIENT_SECRET") {
    throw new Error("Google OAuth credentials are not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function readSavedTokens() {
  try {
    const file = await readFile(tokenFilePath, "utf8");
    return repairUnknownText(JSON.parse(file) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function ensureDataFile<T>(filePath: string, fallback: T) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const file = await readFile(filePath, "utf8");
    return repairUnknownText(JSON.parse(file) as T);
  } catch {
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function readLaundryCoupons() {
  return ensureDataFile<LaundryCoupon[]>(laundryCouponsFilePath, []);
}

async function readLaundryCouponRedemptions() {
  return ensureDataFile<LaundryCouponRedemption[]>(laundryCouponRedemptionsFilePath, []);
}

async function writeLaundryCouponRedemptions(redemptions: LaundryCouponRedemption[]) {
  await mkdir(path.dirname(laundryCouponRedemptionsFilePath), { recursive: true });
  await writeFile(
    laundryCouponRedemptionsFilePath,
    JSON.stringify(redemptions),
    "utf8"
  );
}

function readMemoryCache<T>(entry: MemoryCachedValue<T> | null) {
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.loadedAt > CACHE_MEMORY_TTL_MS) {
    return null;
  }

  return entry.value;
}

function setMemoryCache<T>(value: T): MemoryCachedValue<T> {
  return {
    value,
    loadedAt: Date.now()
  };
}

async function readCachedJsonFile<T>(filePath: string, memoryEntry: MemoryCachedValue<T> | null) {
  const cachedValue = readMemoryCache(memoryEntry);
  if (cachedValue) {
    return cachedValue;
  }

  try {
    const file = await readFile(filePath, "utf8");
    return repairUnknownText(JSON.parse(file) as T);
  } catch {
    return null;
  }
}

async function writeCachedJsonFile<T>(filePath: string, payload: T) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload), "utf8");
}

function hasScope(
  tokens: Record<string, unknown> | null,
  requiredScope: string
) {
  const scopeValue = typeof tokens?.scope === "string" ? tokens.scope : "";
  return scopeValue.split(/\s+/).includes(requiredScope);
}

async function saveTokens(tokens: Record<string, unknown>) {
  await writeFile(tokenFilePath, JSON.stringify(tokens), "utf8");
}

async function getAuthorizedSheetsClient() {
  const oauthClient = getOAuthClient();
  const tokens = await readSavedTokens();

  if (!tokens) {
    throw new Error("Google OAuth tokens are missing");
  }

  oauthClient.setCredentials(tokens);
  return google.sheets({ version: "v4", auth: oauthClient });
}

async function getAuthorizedDriveClient() {
  const tokens = await readSavedTokens();

  if (
    !hasScope(tokens, "https://www.googleapis.com/auth/drive.file") &&
    !hasScope(tokens, "https://www.googleapis.com/auth/drive")
  ) {
    throw new Error("Google Drive access has not been granted yet. Reconnect Google OAuth to add Drive access.");
  }

  const auth = await getAuthorizedOAuthClient();
  return google.drive({ version: "v3", auth });
}

function normalizeHeader(value: string) {
  const trimmed = repairMojibake(value).trim();
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  return normalizedHeaderAliases.get(normalized) ?? trimmed;
}

function columnIndexToLetter(index: number) {
  let current = index + 1;
  let result = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function mapRow(headers: string[], row: string[]) {
  const mapped = {} as Record<string, string>;

  headers.forEach((header, index) => {
    mapped[header] = repairMojibake(String(row[index] ?? "")).trim();
  });

  return repairUnknownText(mapped) as ClientRow;
}

function isActiveClient(row: Record<string, string>) {
  const status = String(row[ACTIVE_STAYING_COLUMN] || "").trim();
  // Any status is "Active" except for explicitly removed (-1)
  return status !== "-1";
}

function parseSheetTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (match) {
    const [, dayValue, monthValue, yearValue, hourValue, minuteValue, secondValue, meridiemValue] = match;
    const day = Number.parseInt(dayValue, 10);
    const month = Number.parseInt(monthValue, 10) - 1;
    const year =
      Number.parseInt(yearValue, 10) < 100 ? 2000 + Number.parseInt(yearValue, 10) : Number.parseInt(yearValue, 10);
    let hour = hourValue ? Number.parseInt(hourValue, 10) : 0;
    const minute = minuteValue ? Number.parseInt(minuteValue, 10) : 0;
    const second = secondValue ? Number.parseInt(secondValue, 10) : 0;
    const meridiem = meridiemValue?.toUpperCase();

    if (meridiem === "PM" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "AM" && hour === 12) {
      hour = 0;
    }

    const parsed = new Date(year, month, day, hour, minute, second);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return null;
}

function normalizeClientBranch(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");

  if (!normalized) {
    return "D2" as const;
  }

  if (normalized === "2" || normalized === "D2" || normalized.includes("D2")) {
    return "D2" as const;
  }

  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7" as const;
  }

  return "D2" as const;
}

function formatClientContractDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid contract date: ${value}`);
  }

  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = parsed.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function mapBioSexToVietnamese(value: string) {
  if (value === "female") {
    return "N\u1eef";
  }

  if (value === "male") {
    return "Nam";
  }

  return "";
}

const CLIENT_BRANCH_COLUMN_ALIASES = [
  "Chi nhánh Cozoro dorm",
  "Chi nhÃ¡nh Cozoro dorm",
  "Chi nh?nh Cozoro dorm",
  "CHI NHÁNH DORM",
  "CHI NHANH DORM"
];

function normalizeSheetLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getClientBranchValue(row: Record<string, string>) {
  for (const key of CLIENT_BRANCH_COLUMN_ALIASES) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const branchEntry = Object.entries(row).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }

    const normalizedKey = normalizeSheetLookupKey(key);
    return (
      normalizedKey.includes("chinhanhcozorodorm") ||
      (normalizedKey.includes("chinhanh") && normalizedKey.includes("dorm")) ||
      normalizedKey.includes("branch")
    );
  });

  return String(branchEntry?.[1] ?? "").trim();
}

function inferFloorFromBed(value: string) {
  const numeric = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
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

function parseLooseInteger(value: string | undefined) {
  const numeric = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCozoroMember(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function getCozoroMemberTierIndex(value: string | undefined) {
  const normalized = normalizeCozoroMember(value);
  const index = cozoroMemberTiers.findIndex((tier) => tier.name.toLowerCase() === normalized);
  return index === -1 ? -1 : index;
}

function getCozoroMemberTier(value: string | undefined) {
  const normalized = normalizeCozoroMember(value);
  return cozoroMemberTiers.find((tier) => tier.name.toLowerCase() === normalized) ?? null;
}

function calculatePreviousMonthEarnings(coinsHistory: CoinRow[], email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();
  let targetMonth = now.getMonth() - 1;
  let targetYear = now.getFullYear();
  if (targetMonth < 0) {
    targetMonth = 11;
    targetYear--;
  }

  let earned = 0;
  for (const row of coinsHistory) {
    if (row[EMAIL_COLUMN]?.trim().toLowerCase() !== normalizedEmail) continue;
    const balance = parseLooseInteger(row[COINS_BALANCE_COLUMN]);
    if (balance <= 0) continue;

    const ts = row[COINS_TIMESTAMP_COLUMN];
    const parsed = parseSheetTimestamp(ts);
    if (!parsed) continue;

    const d = new Date(parsed);
    if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
      earned += balance;
    }
  }
  return earned;
}

function calculateLiveCozoroMember(input: {
  branchId: string | undefined;
  totalAccumulatedCoins: string | undefined;
  recordedMember: string | undefined;
  previousMonthEarnings?: number;
}) {
  const branchId = normalizeClientBranch(input.branchId ?? "");
  const recordedMember = (input.recordedMember ?? "").trim() || "Standard";

  if (branchId !== "D2" && branchId !== "D7") {
    return recordedMember;
  }

  const totalAccumulatedCoins = parseLooseInteger(input.totalAccumulatedCoins);
  const previousMonthEarnings = input.previousMonthEarnings ?? 0;

  // Find all tiers that the user QUALIFIES for based on thresholds
  // THEN filter out those they don't MAINTAIN based on last month's coins
  const potentialTiers = [...cozoroMemberTiers]
    .filter((tier) => tier.threshold != null && totalAccumulatedCoins >= tier.threshold)
    .filter((tier) => previousMonthEarnings >= tier.maintainCoins)
    .sort((left, right) => (right.threshold ?? 0) - (left.threshold ?? 0));

  const matchedTier = potentialTiers[0] ?? null;
  const recordedTier = getCozoroMemberTier(recordedMember);

  // If the recorded tier exists, check if it's maintained
  if (recordedTier) {
    if (previousMonthEarnings < recordedTier.maintainCoins) {
      // User lost their recorded tier! Return the next best matched tier (that they maintain) or Standard.
      return matchedTier?.name ?? "Standard";
    }
  }

  // If no recorded tier or recorded tier is maintained, use the higher of recorded vs matched
  if (!recordedTier) {
    return matchedTier?.name ?? "Standard";
  }
  if (!matchedTier) {
    return recordedTier.name;
  }

  return getCozoroMemberTierIndex(recordedTier.name) >= getCozoroMemberTierIndex(matchedTier.name)
    ? recordedTier.name
    : matchedTier.name;
}

function formatVietnameseDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours > 0 && remainder > 0) {
    return `${hours} giờ ${remainder} phút`;
  }
  if (hours > 0) {
    return `${hours} giờ`;
  }
  return `${remainder} phút`;
}

function getLaundryCalendarMachineTitle(machine: LaundryMachine) {
  switch (machine.id) {
    case "d7-washer-horizontal":
      return "GIẶT D7 TOSHIBA 7KG";
    case "d7-washer-paid":
      return "GIẶT D7 WHIRLPOOL 9KG";
    case "d7-dryer":
      return "SẤY D7";
    case "d2-washer":
      return "GIẶT D2";
    default:
      return "LAUNDRY";
  }
}

function getLaundryCalendarBookingLabel(machine: LaundryMachine) {
  return `${getLaundryCalendarMachineTitle(machine)} (${formatVietnameseDuration(machine.durationMinutes)})`;
}

function getFineCoinMultiplier(memberValue: string) {
  const normalized = memberValue.trim().toLowerCase();
  if (
    normalized.includes("platinum") ||
    normalized.includes("diamond") ||
    normalized.includes("elite")
  ) {
    return 2;
  }
  return 1.5;
}

function isFineMarkedPaid(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "0" && normalized !== "false" && normalized !== "chÆ°a";
}

function isDateInSameMonth(date: Date, compareTo: Date) {
  return (
    date.getFullYear() === compareTo.getFullYear() &&
    date.getMonth() === compareTo.getMonth()
  );
}

async function getLaundryCouponSummary(email: string, now: Date) {
  const redemptions = await readLaundryCouponRedemptions();
  const normalizedEmail = email.trim().toLowerCase();
  const monthlyRedemptions = redemptions.filter((redemption) => {
    const redeemedAt = new Date(redemption.redeemedAt);
    return (
      redemption.email.trim().toLowerCase() === normalizedEmail &&
      !Number.isNaN(redeemedAt.getTime()) &&
      isDateInSameMonth(redeemedAt, now)
    );
  });

  const couponFreeUsesPerMonth = monthlyRedemptions.reduce(
    (total, redemption) => total + Math.max(redemption.extraFreeUses, 0),
    0
  );

  return {
    couponFreeUsesPerMonth,
    redeemedCodes: monthlyRedemptions.map((redemption) => redemption.code)
  };
}

async function validateLaundryCoupon(input: {
  code: string;
  email: string;
  branchId: "D2" | "D7";
  now: Date;
}) {
  const coupons = await readLaundryCoupons();
  const redemptions = await readLaundryCouponRedemptions();
  const normalizedCode = input.code.trim().toUpperCase();
  const coupon = coupons.find((entry) => entry.code.trim().toUpperCase() === normalizedCode);

  if (!coupon || coupon.active === false || coupon.extraFreeUses <= 0) {
    throw new Error("Invalid coupon code.");
  }

  if (coupon.branchId && coupon.branchId !== input.branchId) {
    throw new Error("This coupon is not valid for your branch.");
  }

  if (coupon.expiresAt) {
    const expiresAt = new Date(coupon.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < input.now.getTime()) {
      throw new Error("This coupon has expired.");
    }
  }

  const alreadyRedeemed = redemptions.some((redemption) => {
    const redeemedAt = new Date(redemption.redeemedAt);
    return (
      redemption.code.trim().toUpperCase() === normalizedCode &&
      redemption.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
      !Number.isNaN(redeemedAt.getTime()) &&
      isDateInSameMonth(redeemedAt, input.now)
    );
  });

  if (alreadyRedeemed) {
    throw new Error("This coupon has already been used this month.");
  }

  return {
    code: normalizedCode,
    extraFreeUses: coupon.extraFreeUses,
    note: coupon.note ?? ""
  };
}

async function redeemLaundryCoupon(input: {
  code: string;
  email: string;
  branchId: "D2" | "D7";
  extraFreeUses: number;
  now: Date;
}) {
  const redemptions = await readLaundryCouponRedemptions();
  redemptions.push({
    code: input.code.trim().toUpperCase(),
    email: input.email.trim().toLowerCase(),
    redeemedAt: input.now.toISOString(),
    extraFreeUses: input.extraFreeUses,
    branchId: input.branchId
  });
  await writeLaundryCouponRedemptions(redemptions);
}

function getLaundryMemberBonus(memberValue: string) {
  const normalized = memberValue.trim().toLowerCase();

  if (normalized.includes("elite") || normalized.includes("diamond")) {
    return { washer: 3, dryer: 3 };
  }
  if (normalized.includes("platinum")) {
    return { washer: 1, dryer: 2 };
  }
  if (normalized.includes("gold")) {
    return { washer: 1, dryer: 1 };
  }
  if (normalized.includes("silver")) {
    return { washer: 0, dryer: 0 };
  }

  return { washer: 0, dryer: 0 };
}

function getLaundryBaseAllowance(client: ClientRow, branchId: "D2" | "D7") {
  const gender = (client["Giới tính"] ?? "").trim();
  const floor = branchId === "D7" ? inferFloorFromBed(client["sá»‘ giÆ°á»ng"] ?? "") : null;
  const recordedMember = (client["Cozoro Member"] ?? "").trim() || "Standard";
  const bonus = getLaundryMemberBonus(recordedMember);
  const normalizedBonus =
    branchId === "D2"
      ? {
          washer: bonus.washer,
          dryer: 0
        }
      : bonus;
  const baseFreeUsesPerMonth = branchId === "D2" ? 8 : floor === 2 ? 6 : 8;
  const notes: string[] = [];

  if (branchId === "D2") {
    notes.push("D2 members receive 8 free laundry uses each month. / Thành viên D2 được miễn phí 8 lượt giặt mỗi tháng.");
  } else if (floor === 2) {
    notes.push("D7 floor 2 members receive 6 free laundry uses each month. / Thành viên D7 tầng 2 được miễn phí 6 lượt giặt mỗi tháng.");
  } else {
    notes.push("D7 floor 1 and floor 3 members receive 8 free laundry uses each month. / Thành viên D7 tầng 1 và tầng 3 được miễn phí 8 lượt giặt mỗi tháng.");
  }

  if (normalizedBonus.washer > 0 || normalizedBonus.dryer > 0) {
    notes.push(
      branchId === "D2"
        ? `Recorded Cozoro Member adds ${normalizedBonus.washer} free washer use${normalizedBonus.washer === 1 ? "" : "s"} per month. / Hạng thành viên hiện tại được cộng thêm ${normalizedBonus.washer} lượt giặt miễn phí mỗi tháng.`
        : `Recorded Cozoro Member adds ${normalizedBonus.washer} free washer use${normalizedBonus.washer === 1 ? "" : "s"} and ${normalizedBonus.dryer} free dryer use${normalizedBonus.dryer === 1 ? "" : "s"} per month. / Hạng thành viên hiện tại được cộng thêm ${normalizedBonus.washer} lượt giặt và ${normalizedBonus.dryer} lượt sấy miễn phí mỗi tháng.`
    );
  } else {
    notes.push(
      branchId === "D2"
        ? "Current recorded Cozoro Member does not add extra washer uses yet. / Hạng thành viên hiện tại chưa được cộng thêm lượt giặt miễn phí."
        : "Current recorded Cozoro Member does not add extra washer or dryer uses yet. / Hạng thành viên hiện tại chưa được cộng thêm lượt giặt/sấy miễn phí."
    );
  }

  return {
    branchId,
    gender,
    floor,
    recordedMember,
    baseFreeUsesPerMonth,
    bonusWasherUsesPerMonth: normalizedBonus.washer,
    bonusDryerUsesPerMonth: normalizedBonus.dryer,
    notes
  };
}


export async function getLaundryAllowance(client: ClientRow, branchId: "D2" | "D7") {
  const base = getLaundryBaseAllowance(client, branchId);
  const normalizedEmail = (client[EMAIL_COLUMN] ?? "").trim().toLowerCase();
  const now = new Date();
  const couponSummary = await getLaundryCouponSummary(normalizedEmail, now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const bookings = await getLaundryBookingsForEmailWithOptions(normalizedEmail, { forceRefresh: false });
  const monthlyBookings = bookings.filter((booking) => {
    const start = new Date(booking.start);
    return !Number.isNaN(start.getTime()) && start >= monthStart && start < monthEnd;
  });
  const futureBookings = bookings.filter((booking) => {
    const start = new Date(booking.start);
    return !Number.isNaN(start.getTime()) && start >= now;
  });

  let usedFreeLaundryThisMonth = 0;
  let usedBonusWasherThisMonth = 0;
  let usedBonusDryerThisMonth = 0;
  let reservedFutureCoinUses = 0;

  for (const booking of monthlyBookings) {
    const rawEvent = {
      description: booking.description,
      summary: booking.summary,
      status: booking.status
    } as GoogleCalendarEvent;
    
    // Skip cancelled bookings in allowance calculation
    if (rawEvent.status === "cancelled") {
      continue;
    }

    const paymentMethod = getLaundryPaymentMethodFromEvent(rawEvent);
    const machine = laundryMachines.find((entry) => entry.calendarId === booking.calendarId) ?? null;

    if (paymentMethod === "FREE_LAUNDRY") {
      usedFreeLaundryThisMonth += 1;
      if (machine?.type === "WASHER" && usedBonusWasherThisMonth < base.bonusWasherUsesPerMonth) {
        usedBonusWasherThisMonth += 1;
      } else if (machine?.type === "DRYER" && usedBonusDryerThisMonth < base.bonusDryerUsesPerMonth) {
        usedBonusDryerThisMonth += 1;
      }
    }
  }

  for (const booking of futureBookings) {
    const rawEvent = {
      description: booking.description,
      summary: booking.summary
    } as GoogleCalendarEvent;
    if (getLaundryPaymentMethodFromEvent(rawEvent) === "COINS") {
      reservedFutureCoinUses += getLaundryCoinCostFromEvent(rawEvent);
    }
  }

  const remainingBonusWasherUses = Math.max(0, base.bonusWasherUsesPerMonth - usedBonusWasherThisMonth);
  const remainingBonusDryerUses = Math.max(0, base.bonusDryerUsesPerMonth - usedBonusDryerThisMonth);
  const usedBaseFreeLaundry = Math.max(0, usedFreeLaundryThisMonth - usedBonusWasherThisMonth - usedBonusDryerThisMonth);
  const totalBaseAndCouponFreeUses = base.baseFreeUsesPerMonth + couponSummary.couponFreeUsesPerMonth;
  const remainingBaseFreeUses = Math.max(0, totalBaseAndCouponFreeUses - usedBaseFreeLaundry);
  const remainingCouponFreeUses = Math.max(
    0,
    couponSummary.couponFreeUsesPerMonth - Math.max(0, usedBaseFreeLaundry - base.baseFreeUsesPerMonth)
  );
  const currentCoinsBalance =
    Number.parseInt(String(client[CLIENT_CURRENT_COINS_COLUMN] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
  const availableCoinBalance = Math.max(0, currentCoinsBalance - reservedFutureCoinUses);

  return {
    ...base,
    couponFreeUsesPerMonth: couponSummary.couponFreeUsesPerMonth,
    usedFreeLaundryThisMonth,
    remainingBaseFreeUses,
    remainingCouponFreeUses,
    remainingBonusWasherUses,
    remainingBonusDryerUses,
    currentCoinsBalance,
    reservedFutureCoinUses,
    availableCoinBalance,
    notes: [
      ...base.notes,
      ...(couponSummary.couponFreeUsesPerMonth > 0
        ? [`Coupons added ${couponSummary.couponFreeUsesPerMonth} extra free laundry use(s) this month. / Coupon đã cộng thêm ${couponSummary.couponFreeUsesPerMonth} lượt giặt miễn phí.`]
        : []),
      `Remaining this month: ${remainingBaseFreeUses} base/coupon, ${remainingCouponFreeUses} coupon, ${remainingBonusWasherUses} washer bonus, ${remainingBonusDryerUses} dryer bonus. / Còn lại tháng này: ${remainingBaseFreeUses} lượt cơ bản/coupon, ${remainingCouponFreeUses} lượt coupon, ${remainingBonusWasherUses} lượt giặt thêm, ${remainingBonusDryerUses} lượt sấy thêm.`,
      `Available coins after future coin-paid bookings: ${availableCoinBalance}. / Số dư coins sau khi trừ các lịch đã đặt: ${availableCoinBalance}.`
    ]
  } as LaundryAllowanceSummary;
}

export function createAuthUrl() {
  const oauthClient = getOAuthClient();

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/gmail.send"
    ]
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  await saveTokens(tokens as Record<string, unknown>);
  return tokens;
}

async function getAuthorizedOAuthClient() {
  const oauthClient = getOAuthClient();
  const tokens = await readSavedTokens();

  if (!tokens) {
    throw new Error("Google OAuth tokens are missing");
  }

  oauthClient.setCredentials(tokens);
  return oauthClient;
}

export async function readSheetRows() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AMJ`
  });

  const values = response.data.values ?? [];
  if (values.length === 0) {
    return [] as ClientRow[];
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rows = values.slice(1).map((row) => mapRow(headers, row.map((value) => String(value))));

  return rows.filter((row) => row[CONTRACT_CODE_COLUMN]);
}

export async function readCoinsSheetRows() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${coinsSheetName}!A:AMJ`
  });

  const values = response.data.values ?? [];
  if (values.length === 0) {
    return [] as CoinRow[];
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rows = values
    .slice(1)
    .map((row) => mapRow(headers, row.map((value) => String(value))))
    .map((row) => row as unknown as CoinRow);

  return rows.filter((row) => row[EMAIL_COLUMN]?.trim());
}

export async function readPaymentsSheetRows() {
  if (!paymentsSpreadsheetId) {
    throw new Error("GOOGLE_PAYMENT_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  let values: string[][] = [];

  if (Number.isFinite(paymentsSheetId) && paymentsSheetId > 0) {
    const response = await sheets.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId: paymentsSpreadsheetId,
      requestBody: {
        majorDimension: "ROWS",
        dataFilters: [
          {
            gridRange: {
              sheetId: paymentsSheetId
            }
          }
        ]
      }
    });

    values = (response.data.valueRanges?.[0]?.valueRange?.values as string[][] | undefined) ?? [];
  } else {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: paymentsSpreadsheetId,
      range: `${paymentsSheetName}!A:AMJ`
    });
    values = (response.data.values as string[][] | undefined) ?? [];
  }

  if (values.length === 0) {
    return [] as PaymentRow[];
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rows = values
    .slice(1)
    .map((row) => mapRow(headers, row.map((value) => String(value))))
    .map((row) => row as unknown as PaymentRow);

  return rows.filter((row) => row[EMAIL_COLUMN]?.trim());
}

export async function readFinesSheetRows() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  let values: string[][] = [];

  if (Number.isFinite(finesSheetId) && finesSheetId > 0) {
    const response = await sheets.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId,
      requestBody: {
        majorDimension: "ROWS",
        dataFilters: [
          {
            gridRange: {
              sheetId: finesSheetId
            }
          }
        ]
      }
    });

    values = (response.data.valueRanges?.[0]?.valueRange?.values as string[][] | undefined) ?? [];
  } else {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${finesSheetName}!A:AMJ`
    });
    values = (response.data.values as string[][] | undefined) ?? [];
  }

  if (values.length === 0) {
    return [] as FineRow[];
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rows = values
    .slice(1)
    .map((row) => mapRow(headers, row.map((value) => String(value))))
    .map((row) => row as unknown as FineRow);

  return rows.filter((row) => row[FINE_EMAIL_COLUMN]?.trim());
}

export async function recordPaymentReceipt(data: {
  email: string;
  name: string;
  amountVnd: number;
  purpose: string;
  details: string;
  payer: string;
  receiver: string;
}) {
  if (!paymentsSpreadsheetId) {
    throw new Error("GOOGLE_PAYMENT_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const timestamp = new Date().toLocaleString("vi-VN", { timeZone: COZORO_TIMEZONE });

  const values = [
    [
      timestamp,
      data.email,
      data.amountVnd,
      data.purpose,
      data.details,
      data.payer,
      data.receiver
    ]
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: paymentsSpreadsheetId,
    range: `${paymentsSheetName}!A:G`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

export async function sendGmailReceipt(data: {
  to: string;
  subject: string;
  body: string;
}) {
  const auth = await getAuthorizedOAuthClient();
  const gmail = google.gmail({ version: "v1", auth });

  const utf8Subject = `=?utf-8?B?${Buffer.from(data.subject).toString("base64")}?=`;
  const messageParts = [
    `To: ${data.to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${utf8Subject}`,
    "",
    data.body
  ];
  const message = messageParts.join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage
    }
  });
}

export type LaundryCalendarEvent = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: string;
  end: string;
  htmlLink: string;
  syncWarnings?: string[];
};

export type LaundryMachine = (typeof laundryMachines)[number];

export type LaundryAvailabilityDay = {
  date: string;
  slots: string[];
};

export type LaundryAllowanceSummary = {
  branchId: "D2" | "D7";
  gender: string;
  floor: number | null;
  recordedMember: string;
  baseFreeUsesPerMonth: number;
  couponFreeUsesPerMonth: number;
  bonusWasherUsesPerMonth: number;
  bonusDryerUsesPerMonth: number;
  usedFreeLaundryThisMonth: number;
  remainingBaseFreeUses: number;
  remainingCouponFreeUses: number;
  remainingBonusWasherUses: number;
  remainingBonusDryerUses: number;
  currentCoinsBalance: number;
  reservedFutureCoinUses: number;
  availableCoinBalance: number;
  notes: string[];
};

export type LaundryPaymentMethod = "FREE_LAUNDRY" | "COINS" | "CASH";

type GoogleCalendarEvent = calendar_v3.Schema$Event;
type GoogleCalendarListEntry = {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  accessRole?: string | null;
  primary?: boolean | null;
  selected?: boolean | null;
};

type LaundryCoupon = {
  code: string;
  extraFreeUses: number;
  active?: boolean;
  expiresAt?: string | null;
  branchId?: "D2" | "D7" | null;
  note?: string;
};

type LaundryCouponRedemption = {
  code: string;
  email: string;
  redeemedAt: string;
  extraFreeUses: number;
  branchId: "D2" | "D7";
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const calendarEventsCache = new Map<string, CacheEntry<GoogleCalendarEvent[]>>();
const calendarMetadataCache = new Map<string, CacheEntry<GoogleCalendarListEntry>>();

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const cached = cache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function setCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, {
    expiresAt: Date.now() + calendarCacheTtlMs,
    value
  });
}

function clearCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  cache.delete(key);
}

export type LaundryCalendarDebug = {
  id: string;
  summary: string;
  description: string;
  primary: boolean;
  selected: boolean;
  accessRole: string;
  events: LaundryCalendarEvent[];
  error?: string;
};

async function getAuthorizedCalendarClient() {
  const tokens = await readSavedTokens();

  if (
    !hasScope(tokens, "https://www.googleapis.com/auth/calendar.readonly") &&
    !hasScope(tokens, "https://www.googleapis.com/auth/calendar")
  ) {
    throw new Error("Google Calendar access has not been granted yet. Reconnect Google OAuth to add Calendar access.");
  }

  const auth = await getAuthorizedOAuthClient();
  return google.calendar({ version: "v3", auth });
}

async function getLaundryCalendarIds() {
  if (configuredLaundryCalendarIds.length > 0) {
    return configuredLaundryCalendarIds;
  }

  if (laundryMachines.length > 0) {
    return laundryMachines.map((machine) => machine.calendarId);
  }

  const calendar = await getAuthorizedCalendarClient();
  const response = await calendar.calendarList.list();
  const items = response.data.items ?? [];

  return items
    .filter((item) => {
      const haystack = `${item.summary ?? ""} ${item.description ?? ""}`.toLowerCase();
      return (
        haystack.includes("laundry") ||
        haystack.includes("washer") ||
        haystack.includes("dryer") ||
        haystack.includes("giat") ||
        haystack.includes("sáº¥y") ||
        haystack.includes("say")
      );
    })
    .map((item) => item.id ?? "")
    .filter(Boolean);
}

function invalidateLaundryCalendar(calendarId: string) {
  clearCacheValue(calendarEventsCache, calendarId);
  clearCacheValue(calendarMetadataCache, calendarId);
}

function getLaundryMachineById(machineId: string) {
  return laundryMachines.find((machine) => machine.id === machineId) ?? null;
}

function roundUpToNextTenMinutes(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  const remainder = minutes % 10;
  if (remainder !== 0) {
    next.setMinutes(minutes + (10 - remainder));
  }
  return next;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

function getDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

async function listCalendarEvents(calendarId: string, options?: { forceRefresh?: boolean }) {
  const cached = !options?.forceRefresh ? getCacheValue(calendarEventsCache, calendarId) : null;
  if (cached) {
    return cached;
  }

  const calendar = await getAuthorizedCalendarClient();
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - laundryHistoryMonthsBack);
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + laundryMonthsForward);

  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 250,
      pageToken
    });

    events.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  setCacheValue(calendarEventsCache, calendarId, events);
  return events;
}

function parseEmailFromText(value: string) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase() ?? null;
}

function extractFieldFromDescription(description: string, label: string) {
  const match = description.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? null;
}

function getLaundryPaymentMethodFromEvent(event: GoogleCalendarEvent) {
  const value = extractFieldFromDescription(event.description ?? "", "Payment method")?.toUpperCase();
  if (value === "FREE_LAUNDRY" || value === "COINS" || value === "CASH") {
    return value as LaundryPaymentMethod;
  }
  return null;
}

function getLaundryCoinCostFromEvent(event: GoogleCalendarEvent) {
  const explicit = extractFieldFromDescription(event.description ?? "", "Coin cost");
  if (explicit) {
    const parsed = Number.parseInt(explicit.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

async function getCalendarMetadata(
  calendarId: string,
  options?: { forceRefresh?: boolean }
): Promise<GoogleCalendarListEntry> {
  const cached = !options?.forceRefresh ? getCacheValue(calendarMetadataCache, calendarId) : null;
  if (cached) {
    return cached;
  }

  const calendar = await getAuthorizedCalendarClient();

  try {
    const response = await calendar.calendarList.get({ calendarId });
    setCacheValue(calendarMetadataCache, calendarId, response.data);
    return response.data;
  } catch {
    const fallback = await calendar.calendars.get({ calendarId });
    const metadata = {
      id: fallback.data.id ?? calendarId,
      summary: fallback.data.summary ?? calendarId,
      description: fallback.data.description ?? "",
      accessRole: "",
      primary: false,
      selected: false
    };
    setCacheValue(calendarMetadataCache, calendarId, metadata);
    return metadata;
  }
}

export async function listLaundryCalendarsWithEvents(options?: { forceRefresh?: boolean }) {
  const calendar = await getAuthorizedCalendarClient();
  const laundryCalendarIds = await getLaundryCalendarIds();

  const results = await Promise.all(
    laundryCalendarIds.map(async (calendarId) => {
      try {
        const [calendarMetadata, rawEvents] = await Promise.all([
          getCalendarMetadata(calendarId, options),
          listCalendarEvents(calendarId, options)
        ]);

        const summary = calendarMetadata.summary ?? calendarId;
        const events = rawEvents.map((event: GoogleCalendarEvent) => ({
          id: event.id ?? "",
          calendarId,
          calendarSummary: summary,
          summary: event.summary ?? "Laundry booking",
          description: event.description ?? "",
          location: event.location ?? "",
          status: event.status ?? "confirmed",
          start: event.start?.dateTime ?? event.start?.date ?? "",
          end: event.end?.dateTime ?? event.end?.date ?? "",
          htmlLink: event.htmlLink ?? ""
        }));

        return {
          id: calendarId,
          summary,
          description: calendarMetadata.description ?? "",
          primary: Boolean(calendarMetadata.primary),
          selected: Boolean(calendarMetadata.selected),
          accessRole: calendarMetadata.accessRole ?? "",
          events: events.filter((event: LaundryCalendarEvent) => event.id && event.start)
        } as LaundryCalendarDebug;
      } catch (error) {
        return {
          id: calendarId,
          summary: calendarId,
          description: "",
          primary: false,
          selected: false,
          accessRole: "",
          events: [],
          error: error instanceof Error ? error.message : "Unable to load this calendar"
        } as LaundryCalendarDebug;
      }
    })
  );

  return results.sort((left, right) => left.summary.localeCompare(right.summary));
}

function eventMatchesEmail(
  event: {
    attendees?: Array<{ email?: string | null }>;
    description?: string | null;
    summary?: string | null;
  },
  normalizedEmail: string
) {
  const attendeeMatch = (event.attendees ?? []).some(
    (attendee) => attendee.email?.trim().toLowerCase() === normalizedEmail
  );

  if (attendeeMatch) {
    return true;
  }

  const textHaystack = `${event.summary ?? ""}\n${event.description ?? ""}`.toLowerCase();
  if (textHaystack.includes(normalizedEmail)) {
    return true;
  }

  const description = event.description ?? "";
  const explicitEmailMatch = description.match(/email\s*:\s*([^\s\n\r]+)/i);
  if (explicitEmailMatch?.[1]?.trim().toLowerCase() === normalizedEmail) {
    return true;
  }

  const summary = (event.summary ?? "").toLowerCase();
  const summaryParts = summary.split("-").map((part) => part.trim());
  return summaryParts.some((part) => part === normalizedEmail);
}

export async function getLaundryBookingsForEmail(email: string) {
  return getLaundryBookingsForEmailWithOptions(email);
}

export async function getLaundryBookingsForEmailWithOptions(
  email: string,
  options?: { forceRefresh?: boolean }
) {
  const normalizedEmail = email.trim().toLowerCase();
  const calendarIds = await getLaundryCalendarIds();

  if (calendarIds.length === 0) {
    return [] as LaundryCalendarEvent[];
  }

  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const [rawEvents, calendarMetadata] = await Promise.all([
        listCalendarEvents(calendarId, options),
        getCalendarMetadata(calendarId, options)
      ]);

      return rawEvents
        .filter((event: GoogleCalendarEvent) => {
          if (event.status === "cancelled") {
            return false;
          }
          return eventMatchesEmail(event, normalizedEmail);
        })
        .map((event: GoogleCalendarEvent) => {
          const start = event.start?.dateTime ?? event.start?.date ?? "";
          const end = event.end?.dateTime ?? event.end?.date ?? "";

          return {
            id: event.id ?? "",
            calendarId,
            calendarSummary: calendarMetadata.summary ?? "Laundry",
            summary: event.summary ?? "Laundry Booking",
            description: event.description ?? "",
            location: event.location ?? "",
            status: event.status ?? "confirmed",
            start,
            end,
            htmlLink: event.htmlLink ?? ""
          } as LaundryCalendarEvent;
        });
    })
  );

  return results.flat().sort((left, right) => left.start.localeCompare(right.start));
}

export async function createLaundryBooking(input: {
  email: string;
  machineId: string;
  start: string;
  paymentMethod?: LaundryPaymentMethod;
  couponCode?: string;
}) {
  const context = await getLaundryBookingContextForEmail(input.email);
  if (!context) {
    throw new Error("No active client found for that email");
  }

  const machine = getLaundryMachineById(input.machineId);
  if (!machine || machine.branchId !== context.branchId) {
    throw new Error("This machine is not available for your branch");
  }

  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid booking start time");
  }

  const now = new Date();
  const latest = new Date(now);
  latest.setDate(latest.getDate() + 7);

  if (start.getTime() < now.getTime() || start.getTime() > latest.getTime()) {
    throw new Error("Bookings are only available for the next 7 days");
  }

  const end = new Date(start.getTime() + machine.durationMinutes * 60 * 1000);
  const availability = await getLaundryAvailabilityForMachine({
    email: input.email,
    machineId: input.machineId,
    days: 7,
    forceRefresh: true
  });
  const requestedDay = getDateKeyInTimeZone(start, COZORO_TIMEZONE);
  const matchingDay = availability.availability.find((day) => day.date === requestedDay);
  const isSlotOpen = matchingDay?.slots.includes(start.toISOString()) ?? false;

  if (!isSlotOpen) {
    throw new Error("Selected time is no longer available");
  }

  const validatedCoupon = input.couponCode?.trim()
    ? await validateLaundryCoupon({
        code: input.couponCode,
        email: input.email,
        branchId: context.branchId,
        now
      })
    : null;

  const isWasher = machine.type === "WASHER";
  const hasSpecificBonus = isWasher 
    ? context.allowance.remainingBonusWasherUses > 0 
    : context.allowance.remainingBonusDryerUses > 0;
  
  const hasEffectiveFreeUsage = isWasher
    ? (context.allowance.remainingBaseFreeUses > 0 || hasSpecificBonus)
    : hasSpecificBonus;

  const automaticPaymentMethod: LaundryPaymentMethod =
    machine.allowsFreeLaundry && hasEffectiveFreeUsage
      ? "FREE_LAUNDRY"
      : context.allowance.availableCoinBalance >= machine.coinPrice
        ? "COINS"
        : "CASH";

  const requestedPaymentMethod = input.paymentMethod?.trim() as LaundryPaymentMethod | undefined;
  const resolvedPaymentMethod = requestedPaymentMethod ?? automaticPaymentMethod;

  if (resolvedPaymentMethod === "FREE_LAUNDRY") {
    if (!machine.allowsFreeLaundry) {
      throw new Error("This machine does not accept free laundry.");
    }
    if (!hasEffectiveFreeUsage) {
      const errorMsg = isWasher 
        ? "No free laundry uses available (Base or Bonus)." 
        : "You do not have the privilege for free dryer use (Dryer Bonus required).";
      throw new Error(errorMsg);
    }
  }

  if (resolvedPaymentMethod === "COINS" && context.allowance.availableCoinBalance < machine.coinPrice) {
    throw new Error("Not enough available coins for this booking.");
  }

  const calendar = await getAuthorizedCalendarClient();
  const bookingLabel = getLaundryCalendarBookingLabel(machine);
  const summary = `${bookingLabel} - ${input.email}`;
  if (!context.client) {
    throw new Error("Client record not found for this laundry booking.");
  }
  const clientName = (context.client[CLIENT_NAME_COLUMN] ?? "").trim();
  const bedValue = (context.client[CLIENT_BED_COLUMN] ?? "").trim();
  const eventDescription = [
    "--- Đặt lịch ---",
    bookingLabel,
    "",
    "--- Member ---",
    bookingLabel,
    "",
    "--- Customer Information ---",
    `Email: ${input.email}`,
    `Họ & Tên đầy đủ: ${clientName}`,
    "Code giảm giá: ",
    `Giường ${context.branchId}: ${bedValue}`,
    `Chi nhánh: ${context.branchId}`,
    `Máy: ${machine.label}`,
    `Thời lượng: ${machine.durationMinutes} phút`,
    `Coupon: ${validatedCoupon?.code ?? ""}`,
    `Payment method: ${resolvedPaymentMethod}`,
    `Coin cost: ${machine.coinPrice}`
  ].join("\n");

  const response = await calendar.events.insert({
    calendarId: machine.calendarId,
    requestBody: {
      summary,
      description: eventDescription,
      attendees: [{ email: input.email }],
      start: {
        dateTime: start.toISOString(),
        timeZone: COZORO_TIMEZONE
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: COZORO_TIMEZONE
      }
    }
  });

  invalidateLaundryCalendar(machine.calendarId);
  const metadata = await getCalendarMetadata(machine.calendarId, { forceRefresh: true });
  const syncWarnings: string[] = [];

  try {
    if (validatedCoupon) {
      await redeemLaundryCoupon({
        code: validatedCoupon.code,
        email: input.email,
        branchId: context.branchId,
        extraFreeUses: validatedCoupon.extraFreeUses,
        now
      });
    }

    if (resolvedPaymentMethod === "COINS") {
      const nextCoinsBalance = Math.max(0, context.allowance.currentCoinsBalance - machine.coinPrice);
      await appendCoinsSheetRow({
        [COINS_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(new Date()),
        [CONTRACT_CODE_COLUMN]: context.client[CONTRACT_CODE_COLUMN] ?? "",
        ["Chi nhánh Cozoro dorm"]: context.branchId.replace("D", ""),
        [EMAIL_COLUMN]: input.email.trim().toLowerCase(),
        [CLIENT_NAME_COLUMN]: context.client[CLIENT_NAME_COLUMN] ?? "",
        [CLIENT_BED_COLUMN]: context.client[CLIENT_BED_COLUMN] ?? "",
        [COINS_BALANCE_COLUMN]: String(-machine.coinPrice),
        [COINS_EVENT_COLUMN]: getLaundryCoinEventLabel(machine),
        [COINS_OPERATOR_COLUMN]: "",
        [COINS_MEMBER_COLUMN]: context.allowance.recordedMember,
        [COINS_CURRENT_BALANCE_COLUMN]: String(nextCoinsBalance),
        [COINS_TRANSACTION_CODE_COLUMN]: getLaundryCoinTransactionCode(machine, start, input.email)
      });

      if (context.client[CONTRACT_CODE_COLUMN]) {
        await updateClientColumns(context.client[CONTRACT_CODE_COLUMN], {
          [CLIENT_CURRENT_COINS_COLUMN]: String(nextCoinsBalance)
        });
      }
    } else if (resolvedPaymentMethod === "CASH" && context.client[CONTRACT_CODE_COLUMN]) {
      const currentLaundryCost = parseLooseInteger(context.client["Chi phí giặt sấy"]);
      await updateClientColumns(context.client[CONTRACT_CODE_COLUMN], {
        "Chi phí giặt sấy": String(currentLaundryCost + machine.coinPrice)
      });
    }
  } catch (error) {
    syncWarnings.push(
      error instanceof Error
        ? `Google Calendar booking succeeded, but some sheet updates did not: ${error.message}`
        : "Google Calendar booking succeeded, but some sheet updates did not."
    );
  }

  return {
    id: response.data.id ?? "",
    calendarId: machine.calendarId,
    calendarSummary: metadata.summary ?? machine.label,
    summary: response.data.summary ?? summary,
    description: response.data.description ?? eventDescription,
    location: response.data.location ?? "",
    status: response.data.status ?? "confirmed",
    start: response.data.start?.dateTime ?? start.toISOString(),
    end: response.data.end?.dateTime ?? end.toISOString(),
    htmlLink: response.data.htmlLink ?? "",
    syncWarnings
  } as LaundryCalendarEvent;
}

export async function cancelLaundryBooking(input: {
  email: string;
  calendarId: string;
  eventId: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const calendar = await getAuthorizedCalendarClient();

  // 1. Get the event details
  const event = await calendar.events.get({
    calendarId: input.calendarId,
    eventId: input.eventId
  });

  const startStr = event.data.start?.dateTime ?? event.data.start?.date;
  if (!startStr) {
    throw new Error("Unable to determine booking start time.");
  }

  const start = new Date(startStr);
  const now = new Date();
  const diffMs = start.getTime() - now.getTime();
  const oneHourMs = 60 * 60 * 1000;

  if (diffMs < oneHourMs) {
    throw new Error("Cancellations are only allowed up to 1 hour before the scheduled time.");
  }

  // 2. Identify payment info from description
  const description = event.data.description ?? "";
  const paymentMethod = getLaundryPaymentMethodFromEvent(event.data);
  const coinCost = getLaundryCoinCostFromEvent(event.data);

  // 3. Delete the event
  await calendar.events.delete({
    calendarId: input.calendarId,
    eventId: input.eventId
  });

  invalidateLaundryCalendar(input.calendarId);

  // 4. Handle refund if paid by COINS
  if (paymentMethod === "COINS" && coinCost > 0) {
    const context = await getLaundryBookingContextForEmail(normalizedEmail);
    if (context?.client && context.client[CONTRACT_CODE_COLUMN]) {
      const nextCoinsBalance = context.allowance.currentCoinsBalance + coinCost;
      const machine = laundryMachines.find(m => m.calendarId === input.calendarId);
      
      await appendCoinsSheetRow({
        [COINS_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(new Date()),
        [CONTRACT_CODE_COLUMN]: context.client[CONTRACT_CODE_COLUMN],
        ["Chi nhánh Cozoro dorm"]: context.branchId.replace("D", ""),
        [EMAIL_COLUMN]: normalizedEmail,
        [CLIENT_NAME_COLUMN]: context.client[CLIENT_NAME_COLUMN] ?? "",
        [CLIENT_BED_COLUMN]: context.client[CLIENT_BED_COLUMN] ?? "",
        [COINS_BALANCE_COLUMN]: String(coinCost),
        [COINS_EVENT_COLUMN]: machine ? `Hoàn Coins ${machine.type === "DRYER" ? "sấy" : "giặt"}` : "Hoàn Coins giặt sấy",
        [COINS_OPERATOR_COLUMN]: "SYSTEM_CANCEL",
        [COINS_MEMBER_COLUMN]: context.allowance.recordedMember,
        [COINS_CURRENT_BALANCE_COLUMN]: String(nextCoinsBalance),
        [COINS_TRANSACTION_CODE_COLUMN]: `Refund${input.eventId}${normalizedEmail}`
      });

      await updateClientColumns(context.client[CONTRACT_CODE_COLUMN], {
        [CLIENT_CURRENT_COINS_COLUMN]: String(nextCoinsBalance)
      });
    }
  }

  return { ok: true };
}

export async function warmLaundryCalendarCache() {
  const calendarIds = await getLaundryCalendarIds();
  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const [rawEvents, calendarMetadata] = await Promise.all([
        listCalendarEvents(calendarId, { forceRefresh: true }),
        getCalendarMetadata(calendarId, { forceRefresh: true })
      ]);
      const calendarSummary = calendarMetadata.summary ?? calendarId;

      return rawEvents
        .filter((event: GoogleCalendarEvent) => {
          if (event.status === "cancelled") {
            return false;
          }
          return true; // Warm cache for all events in the calendar
        })
        .map((event: GoogleCalendarEvent) => ({
          id: event.id ?? "",
          calendarId,
          calendarSummary,
          summary: event.summary ?? "Laundry booking",
          description: event.description ?? "",
          location: event.location ?? "",
          status: event.status ?? "confirmed",
          start: event.start?.dateTime ?? event.start?.date ?? "",
          end: event.end?.dateTime ?? event.end?.date ?? "",
          htmlLink: event.htmlLink ?? ""
        }));
    })
  );

  return results.flat().filter((event: LaundryCalendarEvent) => event.id && event.start);
}

export function getLaundryMachinesForBranch(branchId: string) {
  return laundryMachines.filter((machine) => machine.branchId === branchId);
}

export async function getLaundryBookingContextForEmail(email: string) {
  let client = await getActiveClientByEmail(email);
  let branchId: "D2" | "D7";

  if (!client) {
    const staff = await getStaffEntryByEmail(email);
    if (staff) {
      // For staff not in Client sheet, use D2 + bed 0 as default
      branchId = "D2";
      client = {
        [EMAIL_COLUMN]: email,
        [CLIENT_NAME_COLUMN]: staff.name ?? "Staff",
        [ACTIVE_STAYING_COLUMN]: "1",
        [CLIENT_BRANCH_COLUMN]: "2",
        [CLIENT_BED_COLUMN]: "0",
        [CONTRACT_CODE_COLUMN]: `STAFF-${email.split("@")[0]?.toUpperCase() ?? "USER"}`
      } as unknown as ClientRow;
    } else {
      return null;
    }
  } else {
    branchId = normalizeClientBranch(getClientBranchValue(client));
  }

  const allowance = await getLaundryAllowance(client!, branchId);
  return {
    client,
    branchId,
    machines: getLaundryMachinesForBranch(branchId),
    allowance,
    timeZone: COZORO_TIMEZONE
  };
}

export async function getLaundryAvailabilityForMachine(input: {
  email: string;
  machineId: string;
  days?: number;
  forceRefresh?: boolean;
}) {
  const context = await getLaundryBookingContextForEmail(input.email);
  if (!context) {
    throw new Error("No active client found for that email");
  }

  const machine = getLaundryMachineById(input.machineId);
  if (!machine || machine.branchId !== context.branchId) {
    throw new Error("This machine is not available for your branch");
  }

  const totalDays = Math.min(Math.max(input.days ?? 7, 1), 7);
  const rawEvents = await listCalendarEvents(machine.calendarId, { forceRefresh: input.forceRefresh });
  const relevantEvents = rawEvents.filter((event) => {
    if (event.status === "cancelled") {
      return false;
    }

    const start = new Date(event.start?.dateTime ?? event.start?.date ?? "");
    const end = new Date(event.end?.dateTime ?? event.end?.date ?? "");
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
  });

  const now = new Date();
  const todayParts = getTimeZoneParts(now, COZORO_TIMEZONE);
  const availability: LaundryAvailabilityDay[] = [];
  const blockedIntervals = relevantEvents.map((event) => {
    const eventStart = new Date(event.start?.dateTime ?? event.start?.date ?? "");
    const eventEnd = new Date(event.end?.dateTime ?? event.end?.date ?? "");
    return {
      start: new Date(eventStart.getTime() - machine.durationMinutes * 60 * 1000),
      end: eventEnd
    };
  });

  for (let dayOffset = 0; dayOffset < totalDays; dayOffset += 1) {
    const dayStart = zonedDateTimeToUtc(
      todayParts.year,
      todayParts.month,
      todayParts.day + dayOffset,
      0,
      0,
      0,
      COZORO_TIMEZONE
    );
    const dayEnd = zonedDateTimeToUtc(
      todayParts.year,
      todayParts.month,
      todayParts.day + dayOffset + 1,
      0,
      0,
      0,
      COZORO_TIMEZONE
    );

    const firstSlot = roundUpToNextTenMinutes(new Date(Math.max(now.getTime(), dayStart.getTime())));
    const slots: string[] = [];

    for (
      let slotStart = new Date(firstSlot);
      slotStart.getTime() < dayEnd.getTime();
      slotStart = new Date(slotStart.getTime() + 10 * 60 * 1000)
    ) {
      const slotEnd = new Date(slotStart.getTime() + machine.durationMinutes * 60 * 1000);
      const overlaps = blockedIntervals.some((interval) => {
        return interval.start.getTime() < slotEnd.getTime() && interval.end.getTime() > slotStart.getTime();
      });

      if (!overlaps) {
        slots.push(slotStart.toISOString());
      }
    }

    availability.push({
      date: getDateKeyInTimeZone(dayStart, COZORO_TIMEZONE),
      slots
    });
  }

  return { availability };
}

export function getConfiguredCleaningCalendars() {
  const definitions: CleaningCalendarDefinition[] = [];

  const kitchenD2 = process.env.CLEANING_KITCHEN_D2_CALENDAR_ID?.trim();
  if (kitchenD2) {
    definitions.push({
      calendarId: kitchenD2,
      title: "Vệ sinh bếp D2",
      type: "KITCHEN_D2",
      branchId: "D2",
      floor: null
    });
  }

  const kitchenD7 = process.env.CLEANING_KITCHEN_D7_CALENDAR_ID?.trim();
  if (kitchenD7) {
    definitions.push({
      calendarId: kitchenD7,
      title: "Vệ sinh bếp D7",
      type: "KITCHEN_D7",
      branchId: "D7",
      floor: null
    });
  }

  const trashFloorMappings = [
    { floor: 1, calendarId: process.env.CLEANING_TRASH_D7_FLOOR_1_CALENDAR_ID?.trim() },
    { floor: 2, calendarId: process.env.CLEANING_TRASH_D7_FLOOR_2_CALENDAR_ID?.trim() },
    { floor: 3, calendarId: process.env.CLEANING_TRASH_D7_FLOOR_3_CALENDAR_ID?.trim() }
  ];

  for (const mapping of trashFloorMappings) {
    if (!mapping.calendarId) {
      continue;
    }

    definitions.push({
      calendarId: mapping.calendarId,
      title: `Trash D7 - Floor ${mapping.floor}`,
      type: "TRASH_D7",
      branchId: "D7",
      floor: mapping.floor
    });
  }

  return definitions;
}

export async function listCleaningCalendarEvents(
  from: Date,
  to: Date,
  options?: { forceRefresh?: boolean }
) {
  const startTime = from.getTime();
  const endTime = to.getTime();
  const events = options?.forceRefresh
    ? await syncCleaningCalendarsToLocalCache()
    : await readOrSyncCleaningCalendarCache();

  return events
    .filter((event: CleaningCalendarEvent) => {
      const eventStart = new Date(event.start);
      if (Number.isNaN(eventStart.getTime())) {
        return false;
      }

      return eventStart.getTime() >= startTime && eventStart.getTime() <= endTime;
    })
    .sort((left: CleaningCalendarEvent, right: CleaningCalendarEvent) => left.start.localeCompare(right.start));
}

export function getCleaningCalendarTarget(
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7",
  options?: { floor?: number | null }
) {
  const match = getConfiguredCleaningCalendars().find((definition) => {
    if (definition.type !== type) {
      return false;
    }

    if (type !== "TRASH_D7") {
      return true;
    }

    return definition.floor === (options?.floor ?? null);
  });

  return match ? ({ calendarId: match.calendarId, title: match.title } as CleaningCalendarTarget) : null;
}

export async function createCleaningCalendarEvent(input: {
  calendarId: string;
  title: string;
  scheduledDate: Date;
  userEmail: string;
  userName?: string | null;
  branchId: string;
  floor?: number | null;
  rewardCoins: number;
  type: string;
}) {
  const calendar = await getAuthorizedCalendarClient();
  const start = new Date(input.scheduledDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(input.scheduledDate);
  end.setHours(10, 0, 0, 0);

  const response = await calendar.events.insert({
    calendarId: input.calendarId,
    requestBody: {
      summary: `${input.title} - ${input.userEmail}`,
      description: [
        `Task: ${input.type}`,
        `User: ${input.userName ?? input.userEmail}`,
        `Email: ${input.userEmail}`,
        `Branch: ${input.branchId}`,
        `Floor: ${input.floor ?? ""}`,
        `Reward coins: ${input.rewardCoins}`
      ].join("\n"),
      start: {
        dateTime: start.toISOString()
      },
      end: {
        dateTime: end.toISOString()
      }
    }
  });

  const eventId = response.data.id ?? null;
  if (eventId) {
    await upsertCleaningCalendarCacheEvent({
      id: eventId,
      calendarId: input.calendarId,
      calendarSummary: input.title,
      summary: `${input.title} - ${input.userEmail}`,
      description: [
        `Task: ${input.type}`,
        `User: ${input.userName ?? input.userEmail}`,
        `Email: ${input.userEmail}`,
        `Branch: ${input.branchId}`,
        `Floor: ${input.floor ?? ""}`,
        `Reward coins: ${input.rewardCoins}`
      ].join("\n"),
      status: response.data.status ?? "confirmed",
      start: start.toISOString(),
      end: end.toISOString(),
      htmlLink: response.data.htmlLink ?? "",
      taskType: input.type as CleaningCalendarEvent["taskType"],
      branchId: input.branchId as CleaningCalendarEvent["branchId"],
      floor: input.floor ?? null,
      userEmail: input.userEmail,
      userName: input.userName ?? input.userEmail
    });
  }

  return eventId;
}

export async function updateCleaningCalendarEvent(input: {
  calendarId: string;
  eventId: string;
  title: string;
  scheduledDate: Date;
  userEmail: string;
  userName?: string | null;
  branchId: string;
  floor?: number | null;
  rewardCoins: number;
  type: string;
  status: string;
  auditorNote?: string | null;
}) {
  const calendar = await getAuthorizedCalendarClient();
  const start = new Date(input.scheduledDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(input.scheduledDate);
  end.setHours(10, 0, 0, 0);

  const response = await calendar.events.update({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      summary: `${input.title} - ${input.userEmail}`,
      description: [
        `Task: ${input.type}`,
        `User: ${input.userName ?? input.userEmail}`,
        `Email: ${input.userEmail}`,
        `Branch: ${input.branchId}`,
        `Floor: ${input.floor ?? ""}`,
        `Reward coins: ${input.rewardCoins}`,
        `Status: ${input.status}`,
        `Auditor note: ${input.auditorNote ?? ""}`
      ].join("\n"),
      start: {
        dateTime: start.toISOString()
      },
      end: {
        dateTime: end.toISOString()
      }
    }
  });

  await upsertCleaningCalendarCacheEvent({
    id: input.eventId,
    calendarId: input.calendarId,
    calendarSummary: input.title,
    summary: `${input.title} - ${input.userEmail}`,
    description: [
      `Task: ${input.type}`,
      `User: ${input.userName ?? input.userEmail}`,
      `Email: ${input.userEmail}`,
      `Branch: ${input.branchId}`,
      `Floor: ${input.floor ?? ""}`,
      `Reward coins: ${input.rewardCoins}`,
      `Status: ${input.status}`,
      `Auditor note: ${input.auditorNote ?? ""}`
    ].join("\n"),
    status: response.data.status ?? "confirmed",
    start: start.toISOString(),
    end: end.toISOString(),
    htmlLink: response.data.htmlLink ?? "",
    taskType: input.type as CleaningCalendarEvent["taskType"],
    branchId: input.branchId as CleaningCalendarEvent["branchId"],
    floor: input.floor ?? null,
    userEmail: input.userEmail,
    userName: input.userName ?? input.userEmail
  });
}

export async function syncMaintenanceFromSheet() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${maintenanceSheetName}!A:AMJ`
  });

  const values = response.data.values ?? [];
  if (values.length === 0) {
    maintenanceMemoryCache = {
      value: { syncedAt: new Date().toISOString(), tickets: [] },
      loadedAt: Date.now()
    };
    return maintenanceMemoryCache.value;
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const tickets: MaintenanceTicket[] = values
    .slice(1)
    .map((row) => {
      const mapped = mapRow(headers, row.map((v) => String(v)));
      return {
        id: (mapped[MAINTENANCE_TICKET_ID_COLUMN] ?? "").trim(),
        residentEmail: (mapped[MAINTENANCE_RESIDENT_EMAIL_COLUMN] ?? "").trim().toLowerCase(),
        residentName: (mapped[MAINTENANCE_RESIDENT_NAME_COLUMN] ?? "").trim(),
        branch: (mapped[MAINTENANCE_BRANCH_COLUMN] ?? "").trim(),
        location: (mapped[MAINTENANCE_LOCATION_COLUMN] ?? "").trim(),
        device: (mapped[MAINTENANCE_DEVICE_COLUMN] ?? "").trim(),
        issue: (mapped[MAINTENANCE_ISSUE_COLUMN] ?? "").trim(),
        reportedAt: (mapped[MAINTENANCE_REPORTED_AT_COLUMN] ?? "").trim(),
        status: (mapped[MAINTENANCE_STATUS_COLUMN] ?? "REPORTED").trim().toUpperCase() as MaintenanceTicket["status"],
        mechanicEmail: (mapped[MAINTENANCE_MECHANIC_EMAIL_COLUMN] ?? "").trim().toLowerCase() || null,
        solvedAt: (mapped[MAINTENANCE_SOLVED_AT_COLUMN] ?? "").trim() || null,
        repairTimeMinutes: Number.parseInt(mapped[MAINTENANCE_REPAIR_TIME_COLUMN] ?? "0", 10) || null,
        satisfaction: (mapped[MAINTENANCE_SATISFACTION_COLUMN] ?? "").trim().toUpperCase() as MaintenanceTicket["satisfaction"],
        feedback: (mapped[MAINTENANCE_FEEDBACK_COLUMN] ?? "").trim() || null,
        row: mapped
      };
    })
    .filter((ticket) => Boolean(ticket.id));

  const cacheValue: MaintenanceCache = {
    syncedAt: new Date().toISOString(),
    tickets
  };

  maintenanceMemoryCache = {
    value: cacheValue,
    loadedAt: Date.now()
  };

  await mkdir(cacheDirPath, { recursive: true });
  await writeFile(maintenanceCacheFilePath, JSON.stringify(cacheValue, null, 2), "utf8");

  return cacheValue;
}

export async function readCachedMaintenance() {
  if (maintenanceMemoryCache && Date.now() - maintenanceMemoryCache.loadedAt < CACHE_MEMORY_TTL_MS) {
    return maintenanceMemoryCache.value;
  }

  try {
    const file = await readFile(maintenanceCacheFilePath, "utf8");
    const parsed = JSON.parse(file) as MaintenanceCache;
    maintenanceMemoryCache = {
      value: parsed,
      loadedAt: Date.now()
    };
    return parsed;
  } catch {
    return null;
  }
}

export async function reportMaintenanceTicket(input: {
  residentEmail: string;
  residentName: string;
  branch: string;
  location: string;
  issue: string;
  machineDevice?: string;
}) {
  const ticketId = `TKT${Date.now()}`;
  const now = new Date();
  
  const entry: Record<string, string> = {
    [MAINTENANCE_TICKET_ID_COLUMN]: ticketId,
    [MAINTENANCE_RESIDENT_EMAIL_COLUMN]: input.residentEmail.trim().toLowerCase(),
    [MAINTENANCE_RESIDENT_NAME_COLUMN]: input.residentName.trim(),
    [MAINTENANCE_BRANCH_COLUMN]: input.branch,
    [MAINTENANCE_LOCATION_COLUMN]: input.location.trim(),
    [MAINTENANCE_DEVICE_COLUMN]: input.machineDevice?.trim() || "",
    [MAINTENANCE_ISSUE_COLUMN]: input.issue.trim(),
    [MAINTENANCE_REPORTED_AT_COLUMN]: now.toISOString(),
    [MAINTENANCE_STATUS_COLUMN]: "REPORTED"
  };

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${maintenanceSheetName}!A:AMJ`
  });
  const values = response.data.values ?? [];
  if (values.length === 0) {
    throw new Error("The maintenance sheet is empty");
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const row = headers.map((header) => entry[header] ?? "");

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${maintenanceSheetName}!A:AMJ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });

  await syncMaintenanceFromSheet();

  // Award 5000 coins for reporting
  try {
    const clients = await getManagerClients();
    const client = clients.find(c => c.email.toLowerCase() === input.residentEmail.toLowerCase());
    if (client) {
      await managerAdjustCoins({
        maHd: client.maHd,
        delta: 5000,
        reason: `Maintenance Reward (TKT: ${ticketId})`,
        operator: "SYSTEM"
      });
    }
  } catch (error) {
    console.error("[reportMaintenanceTicket] Failed to award coins", error);
  }

  return { ok: true, ticketId };
}

export async function updateMaintenanceTicket(ticketId: string, values: Record<string, string>) {
  await updateSheetRowColumns({
    range: `${maintenanceSheetName}!A:AMJ`,
    rowLabel: "maintenance",
    values,
    syncAfterUpdate: syncMaintenanceFromSheet,
    findRow: (headers, row) => {
      const mapped = mapRow(headers, row);
      return (mapped[MAINTENANCE_TICKET_ID_COLUMN] ?? "").trim() === ticketId.trim();
    }
  });

  return { ok: true };
}

export async function syncClientsFromSheet() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AMJ`
  });

  const values = response.data.values ?? [];
  if (values.length === 0) {
    const emptyPayload: ClientCache = {
      syncedAt: new Date().toISOString(),
      rows: []
    };
    await writeCachedJsonFile(cacheFilePath, emptyPayload);
    clientsMemoryCache = setMemoryCache(emptyPayload);
    return emptyPayload;
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rows = values
    .slice(1)
    .map((row) => mapRow(headers, row.map((value) => String(value))))
    .filter((row) => row[CONTRACT_CODE_COLUMN]);

  const memberColumnIndex = headers.findIndex((header) => header === COINS_MEMBER_COLUMN);
  if (memberColumnIndex !== -1) {
    const coinsHistory = (await readCoinsSheetRows()) || [];
    const updateData = [];
    for (const [index, row] of rows.entries()) {
      const email = row[EMAIL_COLUMN];
      const previousMonthEarnings = calculatePreviousMonthEarnings(coinsHistory, email);

      const calculatedMember = calculateLiveCozoroMember({
        branchId: getClientBranchValue(row),
        totalAccumulatedCoins: row["Tổng Coins tích luỹ"],
        recordedMember: row[COINS_MEMBER_COLUMN],
        previousMonthEarnings
      });
      const currentMember = (row[COINS_MEMBER_COLUMN] ?? "").trim() || "Standard";

      if (currentMember !== calculatedMember) {
        updateData.push({
          range: `${sheetName}!${toSheetColumn(memberColumnIndex + 1)}${index + 2}`,
          values: [[calculatedMember]]
        });
        row[COINS_MEMBER_COLUMN] = calculatedMember;
      }
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updateData
        }
      });
    }
  }

  const activeRows = rows.filter(isActiveClient);

  const payload: ClientCache = {
    syncedAt: new Date().toISOString(),
    rows: activeRows
  };

  await writeCachedJsonFile(cacheFilePath, payload);
  clientsMemoryCache = setMemoryCache(payload);
  return payload;
}

export async function upsertPaidGuestBookingClient(input: PaidGuestBookingClientInput) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const bookingId = input.bookingId.trim();
  const normalizedEmail = input.guestEmail.trim().toLowerCase();
  const contractCode = `SHORTTERM-${bookingId}`;

  if (!bookingId) {
    throw new Error("Booking id is required.");
  }

  if (!normalizedEmail) {
    throw new Error("Guest email is required.");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AMJ`
  });

  const sheetValues = response.data.values ?? [];
  if (sheetValues.length === 0) {
    throw new Error("The Google Sheet is empty");
  }

  const headers = (sheetValues[0] ?? []).map((value) => normalizeHeader(String(value)));
  const existingRowIndex = sheetValues.findIndex((row, index) => {
    if (index === 0) {
      return false;
    }

    const mappedRow = mapRow(headers, row.map((value) => String(value)));
    return mappedRow[CONTRACT_CODE_COLUMN]?.trim() === contractCode;
  });

  const existingRow =
    existingRowIndex === -1
      ? ({} as ClientRow)
      : mapRow(headers, (sheetValues[existingRowIndex] ?? []).map((value) => String(value)));

  const currentTimestamp = new Date().toISOString();
  const nextContractCode =
    String(existingRow[CONTRACT_CODE_COLUMN] ?? "").trim() || contractCode;

  const nextRow: Record<string, string> = {
    ...existingRow,
    [COINS_TIMESTAMP_COLUMN]: String(existingRow[COINS_TIMESTAMP_COLUMN] ?? "").trim() || currentTimestamp,
    [HIDDEN_EMAIL_COLUMN]: normalizedEmail,
    [EMAIL_COLUMN]: normalizedEmail,
    [CLIENT_NAME_COLUMN]: input.guestName.trim(),
    [CLIENT_GENDER_COLUMN]:
      mapBioSexToVietnamese(input.bioSex) || String(existingRow[CLIENT_GENDER_COLUMN] ?? "").trim(),
    [CLIENT_BRANCH_COLUMN]: input.branchId === "D7" ? "7" : "2",
    [CLIENT_PHONE_COLUMN]: input.guestPhone.trim(),
    [CLIENT_BED_COLUMN]: String(input.bedNumber),
    [ACTIVE_STAYING_COLUMN]: "1",
    [CLIENT_CONTRACT_START_COLUMN]: formatClientContractDate(input.checkIn),
    [CLIENT_CONTRACT_END_COLUMN]: formatClientContractDate(input.checkOut),
    [CONTRACT_CODE_COLUMN]: nextContractCode,
    [CLIENT_SHORT_TERM_FEE_COLUMN]: String(input.pricingTotal),
    [CLIENT_SHORT_TERM_FREE_COLUMN]: "FALSE",
    [CLIENT_CURRENT_COINS_COLUMN]: String(existingRow[CLIENT_CURRENT_COINS_COLUMN] ?? "").trim() || "0",
    [CLIENT_TOTAL_COINS_COLUMN]: String(existingRow[CLIENT_TOTAL_COINS_COLUMN] ?? "").trim() || "0",
    [COINS_MEMBER_COLUMN]: String(existingRow[COINS_MEMBER_COLUMN] ?? "").trim() || "Standard",
    [CLIENT_NOTE_COLUMN]:
      input.notes?.trim() ||
      String(existingRow[CLIENT_NOTE_COLUMN] ?? "").trim() ||
      `Imported from guest-booking-standalone after Stripe payment | Booking ID: ${bookingId}`
  };

  const orderedRow = headers.map((header) => nextRow[header] ?? "");

  if (existingRowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:AMJ`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [orderedRow]
      }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${existingRowIndex + 1}:AMJ${existingRowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [orderedRow]
      }
    });
  }

  return syncClientsFromSheet();
}

export async function syncCoinsFromSheet() {
  const rows = await readCoinsSheetRows();

  const payload: CoinsCache = {
    syncedAt: new Date().toISOString(),
    rows
  };

  await writeCachedJsonFile(coinsCacheFilePath, payload);
  coinsMemoryCache = setMemoryCache(payload);
  return payload;
}

export async function syncPaymentsFromSheet() {
  const rows = await readPaymentsSheetRows();

  const payload: PaymentsCache = {
    syncedAt: new Date().toISOString(),
    rows
  };

  await writeCachedJsonFile(paymentsCacheFilePath, payload);
  paymentsMemoryCache = setMemoryCache(payload);
  return payload;
}

export async function syncFinesFromSheet() {
  const rows = await readFinesSheetRows();

  const payload: FinesCache = {
    syncedAt: new Date().toISOString(),
    rows
  };

  await writeCachedJsonFile(finesCacheFilePath, payload);
  finesMemoryCache = setMemoryCache(payload);
  return payload;
}

export async function readCachedClients() {
  const payload = await readCachedJsonFile<ClientCache>(cacheFilePath, clientsMemoryCache);
  if (payload) {
    clientsMemoryCache = setMemoryCache(payload);
  }
  return payload;
}

export async function readCachedCoins() {
  const payload = await readCachedJsonFile<CoinsCache>(coinsCacheFilePath, coinsMemoryCache);
  if (payload) {
    coinsMemoryCache = setMemoryCache(payload);
  }
  return payload;
}

export async function readCachedPayments() {
  const payload = await readCachedJsonFile<PaymentsCache>(paymentsCacheFilePath, paymentsMemoryCache);
  if (payload) {
    paymentsMemoryCache = setMemoryCache(payload);
  }
  return payload;
}

export async function readCachedFines() {
  const payload = await readCachedJsonFile<FinesCache>(finesCacheFilePath, finesMemoryCache);
  if (payload) {
    finesMemoryCache = setMemoryCache(payload);
  }
  return payload;
}

async function readCleaningCalendarCache() {
  const payload = await readCachedJsonFile<CleaningCalendarCache>(
    cleaningCalendarCacheFilePath,
    cleaningCalendarMemoryCache
  );
  if (payload) {
    cleaningCalendarMemoryCache = setMemoryCache(payload);
  }
  return payload;
}

function sanitizeManagerClientRow(row: ClientRow): ManagerSafeClient {
  const hiddenFields = new Set([
    "Số điện thoại liên hệ",
    "Äá»‹a chá»‰ thÆ°á»ng trÃº",
    "Sá»‘ Ä‘iá»‡n thoáº¡i ngÆ°á»i thÃ¢n (liÃªn há»‡ khi cáº§n)",
    "Äá»‹a chá»‰ email - Hidden"
  ]);

  const sanitizedRow = Object.fromEntries(
    Object.entries(row).filter(([key]) => !hiddenFields.has(key))
  );

  return {
    maHd: row[CONTRACT_CODE_COLUMN] ?? "",
    email: row[EMAIL_COLUMN] ?? "",
    name: row[CLIENT_NAME_COLUMN] ?? "",
      branch: getClientBranchValue(row),
    bed: row[CLIENT_BED_COLUMN] ?? "",
    gender: row["Giới tính"] ?? "",
    activeStay: row[ACTIVE_STAYING_COLUMN] ?? "",
    currentCoins: row[CLIENT_CURRENT_COINS_COLUMN] ?? "",
    totalCoins: row["Tổng Coins tích luỹ"] ?? "",
    recordedMember: row["Cozoro Member"] ?? "",
    row: sanitizedRow
  };
}

export async function getManagerClients() {
  const cache = (await readCachedClients()) ?? (await syncClientsFromSheet());
  return cache.rows
    .filter((row) => row[EMAIL_COLUMN]?.trim())
    .map((row) => sanitizeManagerClientRow(row))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

async function writeCleaningCalendarCache(events: CleaningCalendarEvent[]) {
  const payload: CleaningCalendarCache = {
    syncedAt: new Date().toISOString(),
    events
  };

  await writeCachedJsonFile(cleaningCalendarCacheFilePath, payload);
  cleaningCalendarMemoryCache = setMemoryCache(payload);
  return payload;
}

async function upsertCleaningCalendarCacheEvent(event: CleaningCalendarEvent) {
  const cache = await readCleaningCalendarCache();
  const nextEvents = (cache?.events ?? []).filter(
    (entry: CleaningCalendarEvent) => !(entry.id === event.id && entry.calendarId === event.calendarId)
  );
  nextEvents.push(event);
  nextEvents.sort((left: CleaningCalendarEvent, right: CleaningCalendarEvent) => left.start.localeCompare(right.start));
  await writeCleaningCalendarCache(nextEvents);
}

function isFreshCache(syncedAt: string) {
  const syncedTime = new Date(syncedAt).getTime();
  return !Number.isNaN(syncedTime) && Date.now() - syncedTime < calendarCacheTtlMs;
}

async function fetchCleaningCalendarEventsFromGoogle(options?: { forceRefresh?: boolean }) {
  const configuredCalendars = getConfiguredCleaningCalendars();

  const results = await Promise.all(
    configuredCalendars.map(async (definition) => {
      const [calendarMetadata, rawEvents] = await Promise.all([
        getCalendarMetadata(definition.calendarId, options),
        listCalendarEvents(definition.calendarId, options)
      ]);

      const calendarSummary = calendarMetadata.summary ?? definition.title;

      return rawEvents
        .map((event) => {
          const description = event.description ?? "";
          const summary = event.summary ?? definition.title;
          const extractedEmail =
            extractFieldFromDescription(description, "Email") ??
            (event.attendees ?? [])
              .map((attendee) => attendee.email?.trim().toLowerCase() ?? "")
              .find(Boolean) ??
            parseEmailFromText(summary) ??
            parseEmailFromText(description);

          return {
            id: event.id ?? "",
            calendarId: definition.calendarId,
            calendarSummary,
            summary,
            description,
            status: event.status ?? "confirmed",
            start: event.start?.dateTime ?? event.start?.date ?? "",
            end: event.end?.dateTime ?? event.end?.date ?? "",
            htmlLink: event.htmlLink ?? "",
            taskType: definition.type,
            branchId: definition.branchId,
            floor: definition.floor,
            userEmail: extractedEmail ?? null,
            userName: extractFieldFromDescription(description, "User")
          } as CleaningCalendarEvent;
        })
        .filter((event) => event.id && event.start);
    })
  );

  return results.flat().sort((left, right) => left.start.localeCompare(right.start));
}

export async function syncCleaningCalendarsToLocalCache(options?: { forceRefresh?: boolean }) {
  const events = await fetchCleaningCalendarEventsFromGoogle(options);
  await writeCleaningCalendarCache(events);
  return events;
}

async function readOrSyncCleaningCalendarCache() {
  const cache = await readCleaningCalendarCache();
  if (cache?.events?.length && isFreshCache(cache.syncedAt)) {
    return cache.events;
  }

  try {
    return await syncCleaningCalendarsToLocalCache();
  } catch (error) {
    if (cache?.events?.length) {
      return cache.events;
    }
    throw error;
  }
}

export async function getActiveClientByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cache = await readCachedClients();
  const sourceRows = cache?.rows ?? [];

  return (
    sourceRows.find(
      (row) => row[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail && isActiveClient(row)
    ) ?? null
  );
}

export async function getCoinsForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cache = await readCachedCoins();
  const rows = cache?.rows ?? [];

  return rows
    .filter((row) => row[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail)
    .map((row) => ({
      row,
      parsedTimestamp: parseSheetTimestamp(row[COINS_TIMESTAMP_COLUMN] ?? "")
    }))
    .sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp);
    });
}

export async function getPaymentsForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cache = (await readCachedPayments()) ?? (await syncPaymentsFromSheet());
  const rows = cache.rows ?? [];

  return rows
    .filter((row) => row[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail)
    .map((row) => ({
      row,
      parsedTimestamp: parseSheetTimestamp(row[PAYMENT_TIMESTAMP_COLUMN] ?? "")
    }))
    .sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp);
    });
}

export async function getFinesForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cache = (await readCachedFines()) ?? (await syncFinesFromSheet());
  const rows = cache.rows ?? [];
  const client = await getActiveClientByEmail(normalizedEmail);
  const currentCoins =
    Number.parseInt(String(client?.["Cozoro coins hiện có"] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
  const recordedMember = (client?.["Cozoro Member"] ?? "").trim() || "Standard";
  const multiplier = getFineCoinMultiplier(recordedMember);

  return rows
    .filter((row) => row[FINE_EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail)
    .map((row) => ({
      row,
      parsedTimestamp: parseSheetTimestamp(row[FINE_TIMESTAMP_COLUMN] ?? ""),
      parsedDueDate: parseSheetTimestamp(row[FINE_DUE_COLUMN] ?? ""),
      coinPayment: {
        coinCost: Math.ceil(parseLooseInteger(row[FINE_AMOUNT_COLUMN]) * multiplier),
        currentCoins,
        canPay:
          !isFineMarkedPaid(row[FINE_STATUS_COLUMN] ?? "") &&
          currentCoins >= Math.ceil(parseLooseInteger(row[FINE_AMOUNT_COLUMN]) * multiplier),
        recordedMember,
        multiplier,
        isPaid: isFineMarkedPaid(row[FINE_STATUS_COLUMN] ?? "")
      }
    }))
    .sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp);
    });
}

export async function getManagerFines() {
  const cache = (await readCachedFines()) ?? (await syncFinesFromSheet());
  const clientCache = (await readCachedClients()) ?? (await syncClientsFromSheet());
  const clientByEmail = new Map(
    clientCache.rows.map((row) => [row[EMAIL_COLUMN]?.trim().toLowerCase() ?? "", row] as const)
  );

  return cache.rows
    .map((row) => {
      const email = row[FINE_EMAIL_COLUMN]?.trim().toLowerCase() ?? "";
      const client = clientByEmail.get(email);
      const recordedMember = (row[COINS_MEMBER_COLUMN] ?? client?.["Cozoro Member"] ?? "").trim() || "Standard";
      const currentCoins =
        Number.parseInt(
          String(row[COINS_CURRENT_BALANCE_COLUMN] ?? client?.["Cozoro coins hiện có"] ?? "0").replace(/[^0-9-]/g, ""),
          10
        ) || 0;
      const multiplier = getFineCoinMultiplier(recordedMember);

      return {
        row,
        parsedTimestamp: parseSheetTimestamp(row[FINE_TIMESTAMP_COLUMN] ?? ""),
        parsedDueDate: parseSheetTimestamp(row[FINE_DUE_COLUMN] ?? ""),
        coinPayment: {
          coinCost: Math.ceil(parseLooseInteger(row[FINE_AMOUNT_COLUMN]) * multiplier),
          currentCoins,
          canPay: !isFineMarkedPaid(row[FINE_STATUS_COLUMN] ?? "") && currentCoins >= Math.ceil(parseLooseInteger(row[FINE_AMOUNT_COLUMN]) * multiplier),
          recordedMember,
          multiplier,
          isPaid: isFineMarkedPaid(row[FINE_STATUS_COLUMN] ?? "")
        }
      } as FineEntry;
    })
    .sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp);
    });
}

export async function payFineByCoins(input: {
  email: string;
  timestamp: string;
  content: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const client = await getActiveClientByEmail(normalizedEmail);
  if (!client) {
    throw new Error("No active client found for that email");
  }

  const entries = await getFinesForEmail(normalizedEmail);
  const fineEntry = entries.find(
    (entry) =>
      (entry.row[FINE_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim() &&
      (entry.row[FINE_CONTENT_COLUMN] ?? "").trim() === input.content.trim()
  );

  if (!fineEntry) {
    throw new Error("The fine entry could not be found.");
  }

  if (fineEntry.coinPayment.isPaid) {
    throw new Error("This fine has already been paid.");
  }

  if (!fineEntry.coinPayment.canPay) {
    throw new Error("Not enough coins to pay this fine.");
  }

  const nextCoinsBalance = Math.max(0, fineEntry.coinPayment.currentCoins - fineEntry.coinPayment.coinCost);

  await appendCoinsSheetRow({
    [COINS_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(new Date()),
    [CONTRACT_CODE_COLUMN]: client[CONTRACT_CODE_COLUMN] ?? "",
    ["Chi nhánh Cozoro dorm"]: normalizeClientBranch(client["Chi nhánh Cozoro dorm"] ?? "").replace("D", ""),
    [EMAIL_COLUMN]: normalizedEmail,
    [CLIENT_NAME_COLUMN]: client[CLIENT_NAME_COLUMN] ?? "",
    [CLIENT_BED_COLUMN]: client[CLIENT_BED_COLUMN] ?? "",
    [COINS_BALANCE_COLUMN]: String(-fineEntry.coinPayment.coinCost),
    [COINS_EVENT_COLUMN]: fineEntry.row[FINE_CONTENT_COLUMN] || "Hóa đơn nội quy",
    [COINS_OPERATOR_COLUMN]: "",
    [COINS_MEMBER_COLUMN]: fineEntry.coinPayment.recordedMember,
    [COINS_CURRENT_BALANCE_COLUMN]: String(nextCoinsBalance),
    [COINS_TRANSACTION_CODE_COLUMN]: `FineCoins${Date.now()}${normalizedEmail}`
  });

  if (client[CONTRACT_CODE_COLUMN]) {
    await updateClientColumns(client[CONTRACT_CODE_COLUMN], {
      [CLIENT_CURRENT_COINS_COLUMN]: String(nextCoinsBalance)
    });
  }

  await updateFineSheetCell({
    email: normalizedEmail,
    timestamp: input.timestamp,
    content: input.content,
    column: FINE_STATUS_COLUMN,
    value: "Đã thanh toán bằng coins"
  });

  return {
    ok: true,
    coinCost: fineEntry.coinPayment.coinCost,
    currentCoins: nextCoinsBalance
  };
}

export async function disputeFine(input: {
  email: string;
  timestamp: string;
  content: string;
  disputeText: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const client = await getActiveClientByEmail(normalizedEmail);
  if (!client) {
    throw new Error("No active client found for that email");
  }

  const disputeText = input.disputeText.trim();
  if (!disputeText) {
    throw new Error("A dispute message is required.");
  }

  await updateFineSheetCell({
    email: normalizedEmail,
    timestamp: input.timestamp,
    content: input.content,
    column: FINE_DISPUTE_COLUMN,
    value: disputeText
  });

  return {
    ok: true,
    disputeText
  };
}

export async function managerAdjustCoins(input: {
  maHd: string;
  delta: number;
  reason: string;
  operator: string;
}) {
  const managerClients = await getManagerClients();
  const client = managerClients.find((entry) => entry.maHd === input.maHd);

  if (!client) {
    throw new Error("Client could not be found for this coin adjustment.");
  }

  const delta = Math.trunc(input.delta);
  if (!delta) {
    throw new Error("Coin adjustment must be greater than 0 or less than 0.");
  }

  const currentCoins = parseLooseInteger(client.currentCoins);
  const totalCoins = parseLooseInteger(client.totalCoins);
  const coinsAddedThisMonth = parseLooseInteger(client.row["Coins được cộng tháng này"]);
  const coinsUsedThisMonth = parseLooseInteger(client.row["Cozoro coins sử dụng tháng này"]);
  const nextCoins = currentCoins + delta;
  const nextTotalCoins = delta > 0 ? totalCoins + delta : totalCoins;

  const coinsHistory = (await readCoinsSheetRows()) || [];
  const previousMonthEarnings = calculatePreviousMonthEarnings(coinsHistory, client.email);

  const nextCozoroMember = calculateLiveCozoroMember({
    branchId: client.branch,
    totalAccumulatedCoins: String(nextTotalCoins),
    recordedMember: client.recordedMember,
    previousMonthEarnings
  });

  if (nextCoins < 0) {
    throw new Error("This adjustment would make the client's coin balance negative.");
  }

  const now = new Date();
  await appendCoinsSheetRow({
    [COINS_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(now),
    [CONTRACT_CODE_COLUMN]: client.maHd,
    ["Chi nhánh Cozoro dorm"]: normalizeClientBranch(client.branch).replace("D", ""),
    [EMAIL_COLUMN]: client.email,
    [CLIENT_NAME_COLUMN]: client.name,
    [CLIENT_BED_COLUMN]: client.bed,
    [COINS_BALANCE_COLUMN]: String(delta),
    [COINS_EVENT_COLUMN]: input.reason.trim(),
    [COINS_OPERATOR_COLUMN]: input.operator.trim(),
    [COINS_MEMBER_COLUMN]: nextCozoroMember,
    [COINS_CURRENT_BALANCE_COLUMN]: String(nextCoins),
    [COINS_TRANSACTION_CODE_COLUMN]: `ManagerCoins${Date.now()}${client.email.trim().toLowerCase()}`
  });

  await updateClientColumns(client.maHd, {
    [CLIENT_CURRENT_COINS_COLUMN]: String(nextCoins),
    ["Tổng Coins tích luỹ"]: String(nextTotalCoins),
    ["Coins được cộng tháng này"]: String(delta > 0 ? coinsAddedThisMonth + delta : coinsAddedThisMonth),
    ["Cozoro coins sử dụng tháng này"]: String(
      delta < 0 ? coinsUsedThisMonth + Math.abs(delta) : coinsUsedThisMonth
    ),
    [COINS_MEMBER_COLUMN]: nextCozoroMember
  });

  return {
    ok: true,
    currentCoins: nextCoins
  };
}

export async function managerCreatePaymentReceipt(input: {
  maHd: string;
  amount: number;
  purpose: string;
  details?: string;
  payer?: string;
  receiver?: string;
  branch?: string;
  recipientEmail?: string;
  memberTier?: string;
  currentCoins?: string;
  discountAmount?: number;
  discountCondition?: string;
}) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const managerClients = await getManagerClients();
  const client = managerClients.find((entry) => entry.maHd === input.maHd);

  if (!client) {
    throw new Error("Client could not be found for this payment receipt.");
  }

  const amount = Math.max(0, Math.trunc(input.amount));
  if (!amount) {
    throw new Error("Payment amount must be greater than 0.");
  }

  await appendPaymentSheetRow({
    [PAYMENT_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(new Date()),
    [CONTRACT_CODE_COLUMN]: client.maHd,
    [EMAIL_COLUMN]: client.email,
    [CLIENT_NAME_COLUMN]: client.name,
    [CLIENT_BED_COLUMN]: client.bed,
    [PAYMENT_AMOUNT_COLUMN]: String(amount),
    [PAYMENT_PURPOSE_COLUMN]: input.purpose.trim(),
    [PAYMENT_DETAILS_COLUMN]: input.details?.trim() ?? "",
    [PAYMENT_PAYER_COLUMN]: input.payer?.trim() || client.name || client.email,
    [PAYMENT_RECEIVER_COLUMN]: input.receiver?.trim() ?? "",
    ["Chi nhánh Dorm"]: input.branch?.trim() ?? client.branch ?? "",
    ["Địa chỉ email người nhận"]: input.recipientEmail?.trim() ?? client.email,
    ["Cozoro Member"]: input.memberTier?.trim() ?? client.recordedMember ?? "",
    ["Số Coins hiện có"]: input.currentCoins?.trim() ?? String(client.currentCoins ?? ""),
    ["Số tiền hưởng ưu đãi"]: input.discountAmount != null ? String(input.discountAmount) : "",
    ["Điều kiện hưởng ưu đãi"]: input.discountCondition?.trim() ?? ""
  });

  return {
    ok: true
  };
}

export async function upgradeCozoroMemberByCoins(input: {
  email: string;
  targetMember: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const targetTier = getCozoroMemberTier(input.targetMember);

  if (!targetTier) {
    throw new Error("The requested Cozoro Member is not available for upgrade.");
  }

  const managerClients = await getManagerClients();
  const client = managerClients.find((entry) => entry.email.trim().toLowerCase() === normalizedEmail);

  if (!client) {
    throw new Error("Client could not be found for this Cozoro Member upgrade.");
  }

  const coinsHistory = (await readCoinsSheetRows()) || [];
  const previousMonthEarnings = calculatePreviousMonthEarnings(coinsHistory, client.email);

  const currentMember = calculateLiveCozoroMember({
    branchId: client.branch,
    totalAccumulatedCoins: client.totalCoins,
    recordedMember: client.recordedMember,
    previousMonthEarnings
  });
  const currentTierIndex = getCozoroMemberTierIndex(currentMember);
  const targetTierIndex = getCozoroMemberTierIndex(targetTier.name);

  if (targetTierIndex <= currentTierIndex) {
    throw new Error("You can only upgrade to a higher Cozoro Member.");
  }

  const upgradeCost = targetTier.upgradeCoins;
  const currentCoins = parseLooseInteger(client.currentCoins);
  const coinsUsedThisMonth = parseLooseInteger(client.row["Cozoro coins sử dụng tháng này"]);
  const nextCoins = currentCoins - upgradeCost;

  if (nextCoins < 0) {
    throw new Error("Not enough coins to upgrade this Cozoro Member.");
  }

  const now = new Date();
  await appendCoinsSheetRow({
    [COINS_TIMESTAMP_COLUMN]: formatCoinsSheetTimestamp(now),
    [CONTRACT_CODE_COLUMN]: client.maHd,
    ["Chi nhánh Cozoro dorm"]: normalizeClientBranch(client.branch).replace("D", ""),
    [EMAIL_COLUMN]: client.email,
    [CLIENT_NAME_COLUMN]: client.name,
    [CLIENT_BED_COLUMN]: client.bed,
    [COINS_BALANCE_COLUMN]: String(-upgradeCost),
    [COINS_EVENT_COLUMN]: `Upgrade to ${targetTier.name}`,
    [COINS_OPERATOR_COLUMN]: "",
    [COINS_MEMBER_COLUMN]: targetTier.name,
    [COINS_CURRENT_BALANCE_COLUMN]: String(nextCoins),
    [COINS_TRANSACTION_CODE_COLUMN]: `MemberUpgrade${Date.now()}${normalizedEmail}`
  });

  await updateClientColumns(client.maHd, {
    [CLIENT_CURRENT_COINS_COLUMN]: String(nextCoins),
    ["Cozoro coins sử dụng tháng này"]: String(coinsUsedThisMonth + upgradeCost),
    [COINS_MEMBER_COLUMN]: targetTier.name
  });

  return {
    ok: true,
    currentCoins: nextCoins,
    upgradedTo: targetTier.name,
    upgradeCost
  };
}

export async function managerCreateFine(input: {
  maHd: string;
  amount: number;
  content: string;
  description?: string;
  location?: string;
  dueDate?: string;
  image?: string;
  operator: string;
}) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const managerClients = await getManagerClients();
  const client = managerClients.find((entry) => entry.maHd === input.maHd);

  if (!client) {
    throw new Error("Client could not be found for this fine.");
  }

  const amount = Math.max(0, Math.trunc(input.amount));
  if (!amount) {
    throw new Error("Fine amount must be greater than 0.");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${finesSheetName}!A:AMJ`
  });
  const values = response.data.values ?? [];

  if (values.length === 0) {
    throw new Error("The fines sheet is empty");
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const now = new Date();
  const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const row = headers.map((header) => {
    switch (header) {
      case FINE_TIMESTAMP_COLUMN:
        return formatCoinsSheetTimestamp(now);
      case FINE_CREATED_AT_COLUMN:
        return formatCoinsSheetTimestamp(now);
      case FINE_CREATED_YEAR_COLUMN:
        return String(now.getFullYear());
      case FINE_CREATED_MONTH_COLUMN:
        return String(now.getMonth() + 1);
      case FINE_EMAIL_COLUMN:
        return client.email;
      case FINE_BRANCH_COLUMN:
        return normalizeClientBranch(client.branch).replace("D", "");
      case FINE_NAME_COLUMN:
        return client.name;
      case FINE_BED_COLUMN:
        return client.bed;
        case FINE_DUE_COLUMN:
          return Number.isNaN(dueDate.getTime()) ? "" : formatSheetDate(dueDate);
      case FINE_CREATOR_COLUMN:
        return input.operator.trim();
      case FINE_LOCATION_COLUMN:
        return input.location?.trim() ?? "";
      case FINE_CONTENT_COLUMN:
        return input.content.trim();
        case FINE_DESCRIPTION_COLUMN:
          return input.description?.trim() ?? "";
        case FINE_IMAGE_COLUMN:
          return input.image?.trim() ?? "";
      case FINE_AMOUNT_COLUMN:
        return String(amount);
      case FINE_STATUS_COLUMN:
        return "CHƯA";
      case CONTRACT_CODE_COLUMN:
        return client.maHd;
      case COINS_MEMBER_COLUMN:
        return client.recordedMember;
      case COINS_CURRENT_BALANCE_COLUMN:
        return client.currentCoins;
      case COINS_TRANSACTION_CODE_COLUMN:
        return "";
      case "Thanh toán bằng coins":
        return "";
      case FINE_DISPUTE_COLUMN:
        return "";
      default:
        return "";
    }
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${finesSheetName}!A:AMJ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });

  await syncFinesFromSheet();
  return {
    ok: true
  };
}

function sanitizeDriveFileNamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function getDriveFileExtension(mimeType: string, fileName: string) {
  const existingExtensionMatch = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/i);
  if (existingExtensionMatch) {
    return existingExtensionMatch[1];
  }

  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

export async function uploadFineImageToDrive(input: {
  maHd: string;
  clientName: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}) {
  const drive = await getAuthorizedDriveClient();
  const buffer = Buffer.from(input.base64Data, "base64");

  if (!buffer.length) {
    throw new Error("The uploaded image is empty.");
  }

  const safeClientName = sanitizeDriveFileNamePart(input.clientName || input.maHd || "client");
  const safeContract = sanitizeDriveFileNamePart(input.maHd || "unknown-contract");
  const extension = getDriveFileExtension(input.mimeType, input.fileName);
  const driveFileName = `fine-${safeContract}-${safeClientName}-${Date.now()}.${extension}`;

  const createResponse = await drive.files.create({
    requestBody: {
      name: driveFileName,
      mimeType: input.mimeType,
      parents: finesDriveFolderId ? [finesDriveFolderId] : undefined,
      description: `Fine evidence uploaded by ${input.uploadedBy.trim() || "staff"} for ${input.maHd}`
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(buffer)
    },
    fields: "id,name,webViewLink,webContentLink"
  });

  const fileId = createResponse.data.id;
  if (!fileId) {
    throw new Error("Google Drive did not return a file id.");
  }

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone"
    }
  });

  const metadata = await drive.files.get({
    fileId,
    fields: "id,name,webViewLink,webContentLink"
  });

  return {
    ok: true,
    fileId,
    fileName: metadata.data.name ?? driveFileName,
    url:
      metadata.data.webViewLink ??
      metadata.data.webContentLink ??
      `https://drive.google.com/file/d/${fileId}/view`
  };
}

export async function createAutomaticFineForEmail(input: {
  email: string;
  amount: number;
  content: string;
  description?: string;
  location?: string;
  dueDate?: string;
  operator?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const managerClients = await getManagerClients();
  const client = managerClients.find((entry) => entry.email.trim().toLowerCase() === normalizedEmail);

  if (!client) {
    throw new Error("Client could not be found for this fine.");
  }

  return managerCreateFine({
    maHd: client.maHd,
    amount: input.amount,
    content: input.content,
    description: input.description,
    location: input.location,
    dueDate: input.dueDate,
    operator: input.operator?.trim() || "Cleaning schedule system"
  });
}

export async function managerResolveFineDispute(input: {
  email: string;
  timestamp: string;
  content: string;
  decision: "KEEP_FINE" | "CANCEL_FINE";
  note?: string;
  operator: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const fines = await getManagerFines();
  const fine = fines.find(
    (entry) =>
      (entry.row[FINE_EMAIL_COLUMN] ?? "").trim().toLowerCase() === normalizedEmail &&
      (entry.row[FINE_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim() &&
      (entry.row[FINE_CONTENT_COLUMN] ?? "").trim() === input.content.trim()
  );

  if (!fine) {
    throw new Error("The disputed fine could not be found.");
  }

  const existingDispute = (fine.row[FINE_DISPUTE_COLUMN] ?? "").trim();
  const resolutionNote = input.note?.trim();
  const responseLabel =
    input.decision === "CANCEL_FINE"
      ? `Manager resolution (${input.operator.trim()}): Fine cancelled`
      : `Manager resolution (${input.operator.trim()}): Dispute rejected`;
  const disputeValue = [existingDispute, responseLabel, resolutionNote].filter(Boolean).join("\n");

  await updateFineSheetCell({
    email: normalizedEmail,
    timestamp: input.timestamp,
    content: input.content,
    column: FINE_DISPUTE_COLUMN,
    value: disputeValue
  });

  await updateFineSheetCell({
    email: normalizedEmail,
    timestamp: input.timestamp,
    content: input.content,
    column: FINE_STATUS_COLUMN,
    value: input.decision === "CANCEL_FINE" ? "ÄÃƒ Há»¦Y SAU KHIáº¾U Náº I" : "KHIáº¾U Náº I KHÃ”NG ÄÆ¯á»¢C DUYá»†T"
  });

  return {
    ok: true
  };
}

function formatCoinsSheetTimestamp(value: Date) {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

function formatSheetDate(value: Date) {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  return `${day}/${month}/${year}`;
}

function getLaundryCoinEventLabel(machine: LaundryMachine) {
  if (machine.type === "DRYER") {
    return `Trừ Coins sấy`;
  }
  return `Trừ Coins giặt`;
}

function getLaundryCoinTransactionCode(machine: LaundryMachine, start: Date, email: string) {
  const action = machine.type === "DRYER" ? "Say" : "Giat";
  const branch = machine.branchId;
  const month = start.getMonth() + 1;
  const year = start.getFullYear();
  return `Coins${action}${branch}T${month}${year}${email.trim().toLowerCase()}`;
}

async function appendCoinsSheetRow(entry: Record<string, string>) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${coinsSheetName}!A:AMJ`
  });
  const values = response.data.values ?? [];
  if (values.length === 0) {
    throw new Error("The coins sheet is empty");
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const row = headers.map((header) => entry[header] ?? "");

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${coinsSheetName}!A:AMJ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });

  await syncCoinsFromSheet();
}

async function appendPaymentSheetRow(entry: Record<string, string>) {
  if (!paymentsSpreadsheetId) {
    throw new Error("GOOGLE_PAYMENT_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: paymentsSpreadsheetId,
    range: `${paymentsSheetName}!A:AMJ`
  });
  const values = response.data.values ?? [];
  if (values.length === 0) {
    throw new Error("The payments sheet is empty");
  }

  const headers = (values[0] ?? []).map((value) => normalizeHeader(String(value)));
  const row = headers.map((header) => entry[header] ?? "");

  await sheets.spreadsheets.values.append({
    spreadsheetId: paymentsSpreadsheetId,
    range: `${paymentsSheetName}!A:AMJ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });

  await syncPaymentsFromSheet();
}

async function updateSheetRowColumns(input: {
  range: string;
  rowLabel: string;
  syncAfterUpdate: () => Promise<unknown>;
  values: Record<string, string>;
  findRow: (headers: string[], row: string[], index: number) => boolean;
  targetSpreadsheetId?: string;
}) {
  const targetId = input.targetSpreadsheetId ?? spreadsheetId;
  if (!targetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const updates = Object.entries(input.values);
  if (updates.length === 0) {
    throw new Error("No values were provided for update.");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: targetId,
    range: input.range
  });
  const sheetValues = response.data.values ?? [];

  if (sheetValues.length === 0) {
    throw new Error(`The ${input.rowLabel} sheet is empty`);
  }

  const headers = (sheetValues[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rowIndex = sheetValues.findIndex((row, index) =>
    index > 0 && input.findRow(headers, row.map((value) => String(value)), index)
  );

  if (rowIndex === -1) {
    throw new Error(`The ${input.rowLabel} entry could not be found`);
  }

  for (const [column, value] of updates) {
    const columnIndex = headers.findIndex((header) => header === column);

    if (columnIndex === -1) {
      throw new Error(`Column "${column}" was not found in the ${input.rowLabel} sheet`);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: targetId,
      range: `${input.range.split("!")[0]}!${columnIndexToLetter(columnIndex)}${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[value]]
      }
    });
  }

  await input.syncAfterUpdate();
}

export async function updateCoinSheetEntry(input: {
  email: string;
  timestamp: string;
  transactionCode?: string;
  values: Record<string, string>;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();

  await updateSheetRowColumns({
    range: `${coinsSheetName}!A:AMJ`,
    rowLabel: "coins",
    values: input.values,
    syncAfterUpdate: syncCoinsFromSheet,
    findRow: (headers, row) => {
      const mappedRow = mapRow(headers, row) as unknown as CoinRow;
      const matchesEmail = mappedRow[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail;
      const matchesTimestamp = (mappedRow[COINS_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim();
      const matchesTransactionCode = input.transactionCode?.trim()
        ? (mappedRow[COINS_TRANSACTION_CODE_COLUMN] ?? "").trim() === input.transactionCode.trim()
        : true;

      return matchesEmail && matchesTimestamp && matchesTransactionCode;
    }
  });

  return {
    ok: true
  };
}

export async function updatePaymentSheetEntry(input: {
  email: string;
  timestamp: string;
  amount?: string;
  purpose?: string;
  values: Record<string, string>;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();

  await updateSheetRowColumns({
    range: `${paymentsSheetName}!A:AMJ`,
    rowLabel: "payments",
    values: input.values,
    syncAfterUpdate: syncPaymentsFromSheet,
    targetSpreadsheetId: paymentsSpreadsheetId,
    findRow: (headers, row) => {
      const mappedRow = mapRow(headers, row) as unknown as PaymentRow;
      const matchesEmail = mappedRow[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail;
      const matchesTimestamp = (mappedRow[PAYMENT_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim();
      const matchesAmount = input.amount?.trim() ? (mappedRow[PAYMENT_AMOUNT_COLUMN] ?? "").trim() === input.amount.trim() : true;
      const matchesPurpose = input.purpose?.trim()
        ? (mappedRow[PAYMENT_PURPOSE_COLUMN] ?? "").trim() === input.purpose.trim()
        : true;

      return matchesEmail && matchesTimestamp && matchesAmount && matchesPurpose;
    }
  });

  return {
    ok: true
  };
}

export async function updateFineSheetEntry(input: {
  email: string;
  timestamp: string;
  content: string;
  values: Record<string, string>;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();

  await updateSheetRowColumns({
    range: `${finesSheetName}!A:AMJ`,
    rowLabel: "fines",
    values: input.values,
    syncAfterUpdate: syncFinesFromSheet,
    findRow: (headers, row) => {
      const mappedRow = mapRow(headers, row) as unknown as FineRow;
      return (
        mappedRow[FINE_EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail &&
        (mappedRow[FINE_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim() &&
        (mappedRow[FINE_CONTENT_COLUMN] ?? "").trim() === input.content.trim()
      );
    }
  });

  return {
    ok: true
  };
}

export async function updateLaundryBookingEntry(input: {
  calendarId: string;
  eventId: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
}) {
  const start = new Date(input.start);
  const end = new Date(input.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new Error("Laundry booking updates require valid start and end times.");
  }

  const calendar = await getAuthorizedCalendarClient();
  const existing = await calendar.events.get({
    calendarId: input.calendarId,
    eventId: input.eventId
  });

  await calendar.events.update({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      ...existing.data,
      summary: input.summary.trim(),
      description: input.description,
      location: input.location,
      start: {
        dateTime: start.toISOString(),
        timeZone: COZORO_TIMEZONE
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: COZORO_TIMEZONE
      }
    }
  });

  invalidateLaundryCalendar(input.calendarId);

  return {
    ok: true
  };
}

async function updateFineSheetCell(input: {
  email: string;
  timestamp: string;
  content: string;
  column: string;
  value: string;
}) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${finesSheetName}!A:AMJ`
  });

  const sheetValues = response.data.values ?? [];
  if (sheetValues.length === 0) {
    throw new Error("The fines sheet is empty");
  }

  const headers = (sheetValues[0] ?? []).map((value) => normalizeHeader(String(value)));
  const columnIndex = headers.findIndex((header) => header === input.column);
  if (columnIndex === -1) {
    throw new Error("The requested fine column was not found");
  }

  const rowIndex = sheetValues.findIndex((row, index) => {
    if (index === 0) {
      return false;
    }
    const mappedRow = mapRow(headers, row.map((value) => String(value))) as unknown as FineRow;
    return (
      mappedRow[FINE_EMAIL_COLUMN]?.trim().toLowerCase() === input.email.trim().toLowerCase() &&
      (mappedRow[FINE_TIMESTAMP_COLUMN] ?? "").trim() === input.timestamp.trim() &&
      (mappedRow[FINE_CONTENT_COLUMN] ?? "").trim() === input.content.trim()
    );
  });

  if (rowIndex === -1) {
    throw new Error("The fine entry could not be found in the fines sheet");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${finesSheetName}!${columnIndexToLetter(columnIndex)}${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[input.value]]
    }
  });

  await syncFinesFromSheet();
}

export async function updateClientColumns(maHd: string, values: Record<string, string>) {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const updates = Object.entries(values).filter(([column]) => !blockedClientUpdateColumns.has(column));

  if (updates.length === 0) {
    throw new Error("No allowed columns were provided for update");
  }

  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AMJ`
  });

  const sheetValues = response.data.values ?? [];
  if (sheetValues.length === 0) {
    throw new Error("The Google Sheet is empty");
  }

  const headers = (sheetValues[0] ?? []).map((value) => normalizeHeader(String(value)));
  const rowIndex = sheetValues.findIndex((row, index) => {
    if (index === 0) {
      return false;
    }

    const mappedRow = mapRow(headers, row.map((value) => String(value)));
    return mappedRow[CONTRACT_CODE_COLUMN] === maHd;
  });

  if (rowIndex === -1) {
    throw new Error("Client row not found in Google Sheet");
  }

  for (const [column, value] of updates) {
    const columnIndex = headers.findIndex((header) => header === column);

    if (columnIndex === -1) {
      throw new Error(`Column "${column}" was not found in the Google Sheet`);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${toSheetColumn(columnIndex + 1)}${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[value]]
      }
    });
  }

  return syncClientsFromSheet();
}

function toSheetColumn(index: number) {
  let current = index;
  let column = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    current = Math.floor((current - 1) / 26);
  }

  return column;
}

export function startClientSyncInterval() {
  if (process.env.ENABLE_GOOGLE_SYNC_INTERVAL !== "true") {
    return;
  }

  const hasCredentials =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    process.env.GOOGLE_CLIENT_SECRET !== "REPLACE_WITH_YOUR_CLIENT_SECRET";

  if (!hasCredentials) {
    console.warn("Google Sheets sync skipped because OAuth credentials are not configured.");
    return;
  }

  void syncClientsFromSheet().catch((error) => {
    console.warn("Initial Google Sheets sync skipped:", error instanceof Error ? error.message : error);
  });
  void syncCoinsFromSheet().catch((error) => {
    console.warn("Initial Google Coins sync skipped:", error instanceof Error ? error.message : error);
  });

  const timer = setInterval(() => {
    void syncClientsFromSheet().catch((error) => {
      console.warn("Scheduled Google Sheets sync failed:", error instanceof Error ? error.message : error);
    });
    void syncCoinsFromSheet().catch((error) => {
      console.warn("Scheduled Google Coins sync failed:", error instanceof Error ? error.message : error);
    });
  }, syncIntervalMs);
  timer.unref();
}

export function startMaintenanceSyncInterval() {
  if (process.env.ENABLE_MAINTENANCE_SYNC !== "true") {
    return;
  }

  const hasCredentials =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    process.env.GOOGLE_CLIENT_SECRET !== "REPLACE_WITH_YOUR_CLIENT_SECRET";

  if (!hasCredentials) {
    console.warn("Maintenance sync skipped because OAuth credentials are not configured.");
    return;
  }

  void syncMaintenanceFromSheet().catch((error) => {
    console.warn("Initial Maintenance sync failed:", error instanceof Error ? error.message : error);
  });

  const timer = setInterval(() => {
    void syncMaintenanceFromSheet().catch((error) => {
      console.warn("Scheduled Maintenance sync failed:", error instanceof Error ? error.message : error);
    });
  }, syncIntervalMs);
  timer.unref();
}

export function startLaundryCalendarCacheInterval() {
  if (process.env.ENABLE_LAUNDRY_CACHE_WARMER !== "true") {
    return;
  }

  const hasCredentials =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    process.env.GOOGLE_CLIENT_SECRET !== "REPLACE_WITH_YOUR_CLIENT_SECRET";

  if (!hasCredentials) {
    console.warn("Google Calendar cache warm-up skipped because OAuth credentials are not configured.");
    return;
  }

  void warmLaundryCalendarCache().catch((error) => {
    console.warn("Initial laundry calendar cache warm-up skipped:", error instanceof Error ? error.message : error);
  });

  const timer = setInterval(() => {
    void warmLaundryCalendarCache().catch((error) => {
      console.warn("Scheduled laundry calendar cache warm-up failed:", error instanceof Error ? error.message : error);
    });
  }, calendarCacheTtlMs);
  timer.unref();
}

export function startCleaningCalendarCacheInterval() {
  if (process.env.ENABLE_CLEANING_CALENDAR_WARMER !== "true") {
    return;
  }

  const hasCredentials =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    process.env.GOOGLE_CLIENT_SECRET !== "REPLACE_WITH_YOUR_CLIENT_SECRET";

  if (!hasCredentials) {
    console.warn("Cleaning calendar cache warm-up skipped because OAuth credentials are not configured.");
    return;
  }

  void syncCleaningCalendarsToLocalCache({ forceRefresh: true }).catch((error) => {
    console.warn("Initial cleaning calendar cache warm-up skipped:", error instanceof Error ? error.message : error);
  });

  const timer = setInterval(() => {
    void syncCleaningCalendarsToLocalCache({ forceRefresh: true }).catch((error) => {
      console.warn("Scheduled cleaning calendar cache warm-up failed:", error instanceof Error ? error.message : error);
    });
  }, calendarCacheTtlMs);
  timer.unref();
}

export async function getActiveLaundryBooking(email: string) {
  const now = new Date();
  const bookings = await getLaundryBookingsForEmail(email);
  const sorted = [...bookings].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const active = sorted.find((b) => {
    const start = new Date(b.start);
    const graceStart = new Date(start.getTime() - 10 * 60000); // 10 mins early
    const graceEnd = new Date(start.getTime() + 20 * 60000);   // 20 mins after start
    return now >= graceStart && now <= graceEnd;
  });

  const next = sorted.find((b) => new Date(b.start) > now && b.id !== active?.id);

  return {
    active: active ?? null,
    next: next ?? null
  };
}

export async function extendClientContract(email: string, extensionMonths: number) {
  const normalizedEmail = email.trim().toLowerCase();
  
  const sheets = await getAuthorizedSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AMJ`
  });
  
  const values = response.data.values ?? [];
  if (values.length === 0) {
    throw new Error("Target sheet contains no data.");
  }
  
  const rawHeaders = (values[0] ?? []).map((value) => String(value));
  const headers = rawHeaders.map((value) => normalizeHeader(value));
  const activeColIndex = headers.indexOf(normalizeHeader(ACTIVE_STAYING_COLUMN));
  const startColIndex = headers.indexOf(normalizeHeader(CLIENT_CONTRACT_START_COLUMN));
  const endColIndex = headers.indexOf(normalizeHeader(CLIENT_CONTRACT_END_COLUMN));
  const timestampColIndex = headers.indexOf(normalizeHeader(COINS_TIMESTAMP_COLUMN));
  const durationColIndex = headers.indexOf(normalizeHeader("Thời hạn hợp đồng (tháng)"));
  
  if (activeColIndex === -1 || startColIndex === -1 || endColIndex === -1) {
    throw new Error("Missing required columns for contract extension in Google Sheets.");
  }
  
  let targetRowIndex = -1;
  let targetRowData: string[] = [];
  
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const mapped = mapRow(headers, row.map(v => String(v)));
    if (mapped[EMAIL_COLUMN]?.trim().toLowerCase() === normalizedEmail && isActiveClient(mapped)) {
      targetRowIndex = i + 1; // Google sheets uses 1-based indexing for rows
      targetRowData = row.map(v => String(v));
      break;
    }
  }
  
  if (targetRowIndex === -1) {
    throw new Error("Could not find an active client record to extend.");
  }
  
  // 1. Mark current row as inactive (-1)
  const activeColLetter = columnIndexToLetter(activeColIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${activeColLetter}${targetRowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["-1"]] }
  });

  await syncClientsFromSheet();

  // Clear AutoCrat metadata from the copied row data so it doesn't clutter the sheet
  const autocratColumns = [
    "Merged Doc ID - HĐ",
    "Merged Doc URL - HĐ",
    "Link to merged Doc - HĐ",
    "Document Merge Status - HĐ"
  ];
  autocratColumns.forEach(col => {
    const idx = headers.indexOf(normalizeHeader(col));
    if (idx !== -1) targetRowData[idx] = "";
  });
  
  // 2. Prepare new row data
  const oldEndDateStr = targetRowData[endColIndex] ?? "";
  let oldEndDate: Date;
  if (oldEndDateStr.includes("/")) {
    const [d, m, y] = oldEndDateStr.split("/");
    oldEndDate = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    oldEndDate = new Date();
  }
  if (Number.isNaN(oldEndDate.getTime())) {
    oldEndDate = new Date();
  }
  
  const newEndDate = new Date(oldEndDate);
  newEndDate.setMonth(newEndDate.getMonth() + extensionMonths);
  
  const newStartDate = new Date(oldEndDate);
  newStartDate.setDate(newStartDate.getDate() + 1);
  
  const formatDate = (date: Date) => {
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
  };

  const formatTimestamp = (date: Date) => {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
  };

  const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbyykY6OqeAaILbv4yiG8y5ZBMV5Z-cwP8Pn2cYAtBd_uvojZoYS4y_uk76UknpX8Bk/exec";

  const payload: Record<string, any> = {};
  headers.forEach((header, index) => {
    // Normalize key to match Apps Script: lowercase, no spaces
    const norm = header.toString().toLowerCase().trim().replace(/ /g, '');
    let value = targetRowData[index] ?? "";

    // Priority 1: Current Submission Timestamp
    if (timestampColIndex === index) {
      value = formatTimestamp(new Date());
    }
    // Priority 2: Calculated Extension Fields
    else if (index === activeColIndex) {
      value = ""; // Initial Null/Empty string to trigger Apps Script email
    } else if (index === startColIndex) {
      value = formatDate(newStartDate);
    } else if (index === endColIndex) {
      value = formatDate(newEndDate);
    } else if (index === durationColIndex) {
      value = String(extensionMonths);
    } else if (header === normalizeHeader("Tôi đã đọc, đồng ý và tuân thủ nội quy cozoro dorm")) {
      value = "Có";
    }

    payload[norm] = value;
  });

  console.log(`[ContractExtension] Sending data to Bridge Script for ${email}...`);
  
  let rowIndex: number | null = null;
  try {
    const bridgeResponse = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(payload)
    });

    const result = await bridgeResponse.json() as any;
    if (result.success) {
      rowIndex = result.rowIndex;
      console.log(`[ContractExtension] Bridge success! Row ${rowIndex} created for ${email}. Email sent.`);
    } else {
      console.error(`[ContractExtension] Bridge reported error:`, result.error);
      throw new Error(result.error || "Bridge script failed");
    }
  } catch (err) {
    console.error(`[ContractExtension] Failed to communicate with Bridge Script:`, err);
    throw new Error("Could not connect to contract generation service.");
  }

  // Background activation logic:
  // If we have the rowIndex, we use it. Otherwise, we don't proceed with activation.
  if (rowIndex) {
    const activationDelayMs = 15 * 1000; // 15 Seconds
    setTimeout(async () => {
      try {
        console.log(`[ContractExtension] Activating row ${rowIndex} for ${email} after 15s...`);
        const authSheets = await getAuthorizedSheetsClient();
        const activeIdx = headers.indexOf(normalizeHeader(ACTIVE_STAYING_COLUMN));
        const activeColLetter = columnIndexToLetter(activeIdx);

        await authSheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!${activeColLetter}${rowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["1"]] }
        });
        
        console.log(`[ContractExtension] Success: Activated row ${rowIndex} for ${email}. Refreshing cache...`);
        await syncClientsFromSheet();
      } catch (err) {
        console.error(`[ContractExtension] Error during background activation for ${email}:`, err);
      }
    }, activationDelayMs);
  }
  
  clientsMemoryCache = null;
}

