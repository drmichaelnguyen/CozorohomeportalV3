import type { ClientRow } from "./google-sheets.js";

const PAYMENT_PLAN_COLUMN = "Bạn muốn thanh toán chi phí như thế nào?";
const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";
const CONTRACT_END_COLUMN = "Ngày hết hạn hợp đồng";
const MONTH_PAID_COLUMN = "Đã đóng phí tháng";

function parseSheetDate(value: string | null | undefined, endOfDay = false): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime()) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) {
    return direct;
  }

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) {
    return null;
  }

  const [, dayValue, monthValue, yearValue] = match;
  const year =
    Number.parseInt(yearValue, 10) < 100
      ? 2000 + Number.parseInt(yearValue, 10)
      : Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10) - 1;
  const day = Number.parseInt(dayValue, 10);
  const date = new Date(year, month, day, endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isOnPrepaidPaymentPlan(client: ClientRow | Record<string, string>): boolean {
  const raw = String(client[PAYMENT_PLAN_COLUMN] ?? "").toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  return (
    compact.includes("06thang") ||
    compact.includes("03thang") ||
    raw.includes("06 tháng") ||
    raw.includes("03 tháng") ||
    raw.includes("06 thang") ||
    raw.includes("03 thang")
  );
}

/** @deprecated Use isPrepaidRentCovered — kept as alias for existing imports. */
export function isPrepaidPackageCurrentlyActive(
  client: ClientRow | Record<string, string>,
  now = new Date()
): boolean {
  return isPrepaidRentCovered(client, now);
}

export function isPrepaidRentCovered(
  client: ClientRow | Record<string, string>,
  now = new Date()
): boolean {
  if (!isOnPrepaidPaymentPlan(client)) {
    return false;
  }

  const today = startOfDay(now);
  const packageExpiry = parseSheetDate(String(client[PACKAGE_EXPIRY_COLUMN] ?? ""));
  if (packageExpiry && startOfDay(packageExpiry).getTime() >= today.getTime()) {
    return true;
  }

  const contractEnd = parseSheetDate(String(client[CONTRACT_END_COLUMN] ?? ""), true);
  if (contractEnd && startOfDay(contractEnd).getTime() >= today.getTime()) {
    return true;
  }

  const monthPaid = String(client[MONTH_PAID_COLUMN] ?? "")
    .trim()
    .toUpperCase();
  if (monthPaid === "TRUE") {
    return true;
  }

  if (!packageExpiry && !contractEnd) {
    return true;
  }

  return false;
}
