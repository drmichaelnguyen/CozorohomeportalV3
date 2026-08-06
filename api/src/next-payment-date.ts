/**
 * Next payment date helpers for BIÊN NHẬN `next_payment_date` and resident account display.
 * Sheet values use dd/mm/yyyy.
 */

export const PAYMENT_NEXT_PAYMENT_DATE_COLUMN = "next_payment_date";

export type PaymentPlanKind = "monthly" | "3month" | "6month";

export function detectPaymentPlanKind(paymentPlanRaw: string | null | undefined): PaymentPlanKind {
  const raw = String(paymentPlanRaw ?? "").toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  if (compact.includes("06thang") || raw.includes("06 tháng") || raw.includes("06 thang")) {
    return "6month";
  }
  if (compact.includes("03thang") || raw.includes("03 tháng") || raw.includes("03 thang")) {
    return "3month";
  }
  return "monthly";
}

/** Months to add for prepaid package renewal (6-month plans bill as 6+1 → 7). */
export function planMonthsToAdd(planKind: PaymentPlanKind): number {
  if (planKind === "3month") return 3;
  if (planKind === "6month") return 7;
  return 0;
}

export function formatSheetDateDdMmYyyy(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  return `${day}/${month}/${year}`;
}

export function parseSheetDateDdMmYyyy(value: string | null | undefined): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const yearRaw = Number.parseInt(match[3], 10);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const parsed = new Date(year, month, day);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/** HTML date input (yyyy-mm-dd) ↔ Date */
export function formatHtmlDateInput(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  return `${year}-${month}-${day}`;
}

export function parseHtmlDateInput(value: string | null | undefined): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function firstOfNextMonth(from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addCalendarMonths(from: Date, months: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  d.setHours(0, 0, 0, 0);
  // Clamp overflow (e.g. Jan 31 + 1 month)
  if (d.getDate() !== from.getDate()) {
    d.setDate(0);
  }
  return d;
}

/**
 * Default next_payment_date when creating a rent / package receipt.
 * - monthly → 1st of next month
 * - 3-month plan → payment date + 3 months
 * - 6-month plan → payment date + 7 months (6+1)
 */
export function defaultNextPaymentDate(input: {
  paymentDate?: Date;
  planKind: PaymentPlanKind;
}): Date {
  const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date();
  paymentDate.setHours(0, 0, 0, 0);
  if (input.planKind === "monthly") {
    return firstOfNextMonth(paymentDate);
  }
  return addCalendarMonths(paymentDate, planMonthsToAdd(input.planKind));
}
