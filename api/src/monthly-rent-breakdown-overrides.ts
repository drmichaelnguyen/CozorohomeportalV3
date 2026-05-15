import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MonthlyRentBreakdownLineKey =
  | "baseRent"
  | "tenureSurchargeVnd"
  | "monthlyAdjustmentSurchargeVnd"
  | "professionalDiscountVnd"
  | "planDiscountVnd"
  | "managerDiscountVnd"
  | "parkingFeeVnd"
  | "gateParkingFeeVnd"
  | "laundryFeeVnd"
  | "finesVnd";

export type MonthlyRentBreakdownOverrides = Partial<Record<MonthlyRentBreakdownLineKey, number>>;

type OverrideEntry = {
  email: string;
  month: string;
  overrides: MonthlyRentBreakdownOverrides;
  updatedAt: string;
  updatedBy: string;
};

type OverrideFile = {
  entries: OverrideEntry[];
};

const filePath = path.join(process.cwd(), "data", "monthly-rent-breakdown-overrides.json");

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeMonth(month: string) {
  return month.trim();
}

function sanitizeNonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round(parsed));
}

export function sanitizeMonthlyRentBreakdownOverrides(input: unknown): MonthlyRentBreakdownOverrides {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const out: MonthlyRentBreakdownOverrides = {};
  const keys: MonthlyRentBreakdownLineKey[] = [
    "baseRent",
    "tenureSurchargeVnd",
    "monthlyAdjustmentSurchargeVnd",
    "professionalDiscountVnd",
    "planDiscountVnd",
    "managerDiscountVnd",
    "parkingFeeVnd",
    "gateParkingFeeVnd",
    "laundryFeeVnd",
    "finesVnd"
  ];
  for (const key of keys) {
    const value = sanitizeNonNegativeInt(source[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

async function readOverrideFile(): Promise<OverrideFile> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as OverrideFile;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    const fallback: OverrideFile = { entries: [] };
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeOverrideFile(file: OverrideFile) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
}

export async function getMonthlyRentBreakdownOverride(email: string, month: string) {
  const emailKey = normalizeEmail(email);
  const monthKey = normalizeMonth(month);
  if (!emailKey || !monthKey) return null;
  const file = await readOverrideFile();
  return (
    file.entries.find((entry) => normalizeEmail(entry.email) === emailKey && normalizeMonth(entry.month) === monthKey) ?? null
  );
}

export async function upsertMonthlyRentBreakdownOverride(input: {
  email: string;
  month: string;
  overrides: unknown;
  updatedBy: string;
}) {
  const emailKey = normalizeEmail(input.email);
  const monthKey = normalizeMonth(input.month);
  const sanitized = sanitizeMonthlyRentBreakdownOverrides(input.overrides);
  const file = await readOverrideFile();
  const idx = file.entries.findIndex(
    (entry) => normalizeEmail(entry.email) === emailKey && normalizeMonth(entry.month) === monthKey
  );
  const nextEntry: OverrideEntry = {
    email: emailKey,
    month: monthKey,
    overrides: sanitized,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeEmail(input.updatedBy)
  };
  if (idx >= 0) {
    file.entries[idx] = nextEntry;
  } else {
    file.entries.push(nextEntry);
  }
  await writeOverrideFile(file);
  return nextEntry;
}

export async function clearMonthlyRentBreakdownOverride(email: string, month: string) {
  const emailKey = normalizeEmail(email);
  const monthKey = normalizeMonth(month);
  const file = await readOverrideFile();
  file.entries = file.entries.filter(
    (entry) => !(normalizeEmail(entry.email) === emailKey && normalizeMonth(entry.month) === monthKey)
  );
  await writeOverrideFile(file);
  return { ok: true };
}
