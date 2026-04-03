function parseContractEndDate(endDateStr: string | undefined | null): Date | null {
  if (!endDateStr) return null;

  let end: Date;
  if (endDateStr.includes("/")) {
    const [d, m, y] = endDateStr.split("/");
    end = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    end = new Date(endDateStr);
  }

  if (Number.isNaN(end.getTime())) return null;

  end.setHours(23, 59, 59, 999);
  return end;
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
