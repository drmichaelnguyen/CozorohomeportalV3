import { parseContractEndDate, parseVietnamDate } from "./contract-utils";

const PAYMENT_PLAN_COLUMN = "Bạn muốn thanh toán chi phí như thế nào?";
const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";
const CONTRACT_END_COLUMN = "Ngày hết hạn hợp đồng";
const MONTH_PAID_COLUMN = "Đã đóng phí tháng";

export function isOnPrepaidPaymentPlan(row: Record<string, unknown> | undefined): boolean {
  const raw = String(row?.[PAYMENT_PLAN_COLUMN] ?? "").toLowerCase();
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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * True when a 3/6-month resident's package rent is covered (no monthly rent due).
 * Uses package expiry first; falls back to contract end or sheet paid flag when expiry
 * is missing or stale (e.g. set to payment date instead of package end).
 */
export function isPrepaidRentCovered(row: Record<string, unknown> | undefined, now = new Date()): boolean {
  if (!row || !isOnPrepaidPaymentPlan(row)) {
    return false;
  }

  const today = startOfDay(now);
  const packageExpiry = parseVietnamDate(String(row[PACKAGE_EXPIRY_COLUMN] ?? ""));
  if (packageExpiry && startOfDay(packageExpiry).getTime() >= today.getTime()) {
    return true;
  }

  const contractEnd = parseContractEndDate(String(row[CONTRACT_END_COLUMN] ?? ""));
  if (contractEnd && startOfDay(contractEnd).getTime() >= today.getTime()) {
    return true;
  }

  const monthPaid = String(row[MONTH_PAID_COLUMN] ?? "")
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

export function prepaidPlanType(row: Record<string, unknown> | undefined): "monthly" | "3month" | "6month" {
  const raw = String(row?.[PAYMENT_PLAN_COLUMN] ?? "").toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  if (compact.includes("06thang") || raw.includes("06 tháng") || raw.includes("06 thang")) {
    return "6month";
  }
  if (compact.includes("03thang") || raw.includes("03 tháng") || raw.includes("03 thang")) {
    return "3month";
  }
  return "monthly";
}
