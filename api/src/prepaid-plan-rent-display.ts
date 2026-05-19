import type { ClientRow } from "./google-sheets.js";

const PAYMENT_PLAN_COLUMN = "Bạn muốn thanh toán chi phí như thế nào?";
const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";

function parsePackageExpiryDate(value: string | null | undefined): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
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
  const date = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isOnPrepaidPaymentPlan(client: ClientRow | Record<string, string>): boolean {
  const paymentPlan = String(client[PAYMENT_PLAN_COLUMN] ?? "");
  return paymentPlan.includes("03 tháng") || paymentPlan.includes("06 tháng");
}

/** True when resident is on a 3/6-month plan and the paid package has not expired yet. */
export function isPrepaidPackageCurrentlyActive(
  client: ClientRow | Record<string, string>,
  now = new Date()
): boolean {
  if (!isOnPrepaidPaymentPlan(client)) {
    return false;
  }
  const expiry = parsePackageExpiryDate(String(client[PACKAGE_EXPIRY_COLUMN] ?? ""));
  if (!expiry) {
    // Align with resident rent status: prepaid plan without an expiry row still counts as package-paid.
    return true;
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const expDay = new Date(expiry);
  expDay.setHours(0, 0, 0, 0);
  return expDay.getTime() >= today.getTime();
}
