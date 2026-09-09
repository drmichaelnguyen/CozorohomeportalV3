const vietnamDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** Cleaning availability stores calendar-day labels at UTC noon, not booking instants. */
export function getLaundryAwayDateRange(bookingStart: Date): { gte: Date; lt: Date } {
  if (!Number.isFinite(bookingStart.getTime())) throw new Error("Invalid booking start time");
  const parts = vietnamDate.formatToParts(bookingStart);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  // Select the stored Vietnam day label, rather than the UTC instants bounding
  // Vietnam midnight or the host's local day (which can still be yesterday).
  const gte = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  return { gte, lt: new Date(gte.getTime() + 86400000) };
}
