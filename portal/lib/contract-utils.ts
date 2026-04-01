/**
 * Utility to check if a contract is expired based on the "Ngày hết hạn hợp đồng" string.
 * Format expected: "dd/mm/yyyy"
 */
export function isContractExpired(endDateStr: string | undefined | null): boolean {
  if (!endDateStr) return false;

  let end: Date;
  if (endDateStr.includes("/")) {
    const [d, m, y] = endDateStr.split("/");
    end = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    end = new Date(endDateStr);
  }

  if (Number.isNaN(end.getTime())) return false;

  // Set time to end of day to be fair
  end.setHours(23, 59, 59, 999);

  const now = new Date();
  return now > end;
}
