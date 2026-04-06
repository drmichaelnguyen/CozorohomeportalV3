export function parseVietnamDate(
  value: string | undefined | null,
  options?: { endOfDay?: boolean }
): Date | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  let parsed: Date;

  if (match) {
    const [, dayValue, monthValue, yearValue] = match;
    const year = Number(yearValue) < 100 ? 2000 + Number(yearValue) : Number(yearValue);
    parsed = new Date(year, Number(monthValue) - 1, Number(dayValue));
  } else {
    parsed = new Date(trimmed);
  }

  if (Number.isNaN(parsed.getTime())) return null;

  if (options?.endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

export function parseContractEndDate(endDateStr: string | undefined | null): Date | null {
  return parseVietnamDate(endDateStr, { endOfDay: true });
}

/**
 * Returns the number of whole days remaining until the contract end date.
 * Negative = already expired by that many days.
 * Returns null if the date is unparseable.
 */
export function daysUntilContractEnd(endDateStr: string | undefined | null): number | null {
  const end = parseContractEndDate(endDateStr);
  if (!end) return null;
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Utility to check if a contract is expired based on the "Ngày hết hạn hợp đồng" string.
 * Format expected: "dd/mm/yyyy"
 */
export function isContractExpired(endDateStr: string | undefined | null): boolean {
  const days = daysUntilContractEnd(endDateStr);
  if (days === null) return false;
  return days < 0;
}
