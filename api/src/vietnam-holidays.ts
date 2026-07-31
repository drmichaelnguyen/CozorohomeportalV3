/**
 * Vietnam statutory public holidays for cleaning self-assign coin multipliers.
 * Dates follow Labour Code Art. 112 (+ Cultural Day from Decree 128/2025/ND-CP)
 * and official / commonly published observed days (in-lieu Mondays, Tet blocks).
 *
 * Keep in sync with portal/lib/vietnam-holidays.ts
 */

export type VietnamHoliday = {
  date: string; // YYYY-MM-DD
  nameEn: string;
  nameVi: string;
};

/** Curated public holiday dates (YYYY-MM-DD) including observed / in-lieu days. */
const HOLIDAY_ENTRIES: VietnamHoliday[] = [
  // 2025
  { date: "2025-01-01", nameEn: "New Year's Day", nameVi: "Tết Dương lịch" },
  { date: "2025-01-25", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-01-26", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-01-27", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-01-28", nameEn: "Lunar New Year", nameVi: "Mùng 1 Tết" },
  { date: "2025-01-29", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-01-30", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-01-31", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2025-04-07", nameEn: "Hung Kings Commemoration Day", nameVi: "Giỗ Tổ Hùng Vương" },
  { date: "2025-04-30", nameEn: "Reunification Day", nameVi: "Ngày Giải phóng miền Nam" },
  { date: "2025-05-01", nameEn: "International Labour Day", nameVi: "Ngày Quốc tế Lao động" },
  { date: "2025-05-02", nameEn: "Labour Day Holiday", nameVi: "Nghỉ bù Ngày Lao động" },
  { date: "2025-09-01", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2025-09-02", nameEn: "National Day", nameVi: "Quốc khánh" },
  { date: "2025-11-24", nameEn: "Vietnamese Cultural Day", nameVi: "Ngày Văn hóa dân tộc" },

  // 2026 (official MoHA Tet/National Day announcements + statutory dates)
  { date: "2026-01-01", nameEn: "New Year's Day", nameVi: "Tết Dương lịch" },
  { date: "2026-01-02", nameEn: "New Year Holiday", nameVi: "Nghỉ Tết Dương lịch" },
  { date: "2026-02-14", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-02-15", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-02-16", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-02-17", nameEn: "Lunar New Year", nameVi: "Mùng 1 Tết" },
  { date: "2026-02-18", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-02-19", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-02-20", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2026-04-26", nameEn: "Hung Kings Commemoration Day", nameVi: "Giỗ Tổ Hùng Vương" },
  { date: "2026-04-27", nameEn: "Hung Kings Holiday", nameVi: "Nghỉ bù Giỗ Tổ Hùng Vương" },
  { date: "2026-04-30", nameEn: "Reunification Day", nameVi: "Ngày Giải phóng miền Nam" },
  { date: "2026-05-01", nameEn: "International Labour Day", nameVi: "Ngày Quốc tế Lao động" },
  { date: "2026-08-29", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2026-08-30", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2026-08-31", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2026-09-01", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2026-09-02", nameEn: "National Day", nameVi: "Quốc khánh" },
  { date: "2026-11-24", nameEn: "Vietnamese Cultural Day", nameVi: "Ngày Văn hóa dân tộc" },

  // 2027
  { date: "2027-01-01", nameEn: "New Year's Day", nameVi: "Tết Dương lịch" },
  { date: "2027-02-05", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-02-06", nameEn: "Lunar New Year", nameVi: "Mùng 1 Tết" },
  { date: "2027-02-07", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-02-08", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-02-09", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-02-10", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-02-11", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2027-04-16", nameEn: "Hung Kings Commemoration Day", nameVi: "Giỗ Tổ Hùng Vương" },
  { date: "2027-04-30", nameEn: "Reunification Day", nameVi: "Ngày Giải phóng miền Nam" },
  { date: "2027-05-01", nameEn: "International Labour Day", nameVi: "Ngày Quốc tế Lao động" },
  { date: "2027-05-03", nameEn: "Labour Day Holiday", nameVi: "Nghỉ bù Ngày Lao động" },
  { date: "2027-09-02", nameEn: "National Day", nameVi: "Quốc khánh" },
  { date: "2027-09-03", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2027-11-24", nameEn: "Vietnamese Cultural Day", nameVi: "Ngày Văn hóa dân tộc" },

  // 2028
  { date: "2028-01-01", nameEn: "New Year's Day", nameVi: "Tết Dương lịch" },
  { date: "2028-01-03", nameEn: "New Year Holiday", nameVi: "Nghỉ bù Tết Dương lịch" },
  { date: "2028-01-26", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2028-01-27", nameEn: "Lunar New Year", nameVi: "Mùng 1 Tết" },
  { date: "2028-01-28", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2028-01-29", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2028-01-30", nameEn: "Tet Holiday", nameVi: "Nghỉ Tết Nguyên đán" },
  { date: "2028-04-04", nameEn: "Hung Kings Commemoration Day", nameVi: "Giỗ Tổ Hùng Vương" },
  { date: "2028-04-30", nameEn: "Reunification Day", nameVi: "Ngày Giải phóng miền Nam" },
  { date: "2028-05-01", nameEn: "International Labour Day", nameVi: "Ngày Quốc tế Lao động" },
  { date: "2028-05-02", nameEn: "Labour Day Holiday", nameVi: "Nghỉ bù Ngày Lao động" },
  { date: "2028-09-02", nameEn: "National Day", nameVi: "Quốc khánh" },
  { date: "2028-09-04", nameEn: "National Day Holiday", nameVi: "Nghỉ Quốc khánh" },
  { date: "2028-11-24", nameEn: "Vietnamese Cultural Day", nameVi: "Ngày Văn hóa dân tộc" }
];

const holidayByDate = new Map(HOLIDAY_ENTRIES.map((entry) => [entry.date, entry]));

function toDateKey(date: Date | string): string {
  if (typeof date === "string") {
    const match = date.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return toDateKey(parsed);
    }
    return "";
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  // Prefer UTC components when the date was built as UTC noon calendar date;
  // fall back to local components if UTC day looks wrong for local-normalized values.
  if (date.getUTCHours() === 12 || date.getUTCHours() === 0) {
    return `${year}-${month}-${day}`;
  }
  const ly = date.getFullYear();
  const lm = String(date.getMonth() + 1).padStart(2, "0");
  const ld = String(date.getDate()).padStart(2, "0");
  return `${ly}-${lm}-${ld}`;
}

export function listVietnamHolidays(fromYear?: number, toYear?: number): VietnamHoliday[] {
  if (fromYear == null && toYear == null) {
    return [...HOLIDAY_ENTRIES];
  }
  const start = fromYear ?? 2025;
  const end = toYear ?? start;
  return HOLIDAY_ENTRIES.filter((entry) => {
    const year = Number.parseInt(entry.date.slice(0, 4), 10);
    return year >= start && year <= end;
  });
}

export function getVietnamHoliday(date: Date | string): VietnamHoliday | null {
  const key = toDateKey(date);
  if (!key) return null;
  return holidayByDate.get(key) ?? null;
}

export function isVietnamNationalHoliday(date: Date | string): boolean {
  return getVietnamHoliday(date) != null;
}

export function isWeekendCalendarDate(date: Date | string): boolean {
  if (typeof date === "string") {
    const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const utc = new Date(
        Date.UTC(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10) - 1, Number.parseInt(match[3], 10), 12, 0, 0, 0)
      );
      const day = utc.getUTCDay();
      return day === 0 || day === 6;
    }
  }
  const key = toDateKey(date);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const utc = new Date(
    Date.UTC(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10) - 1, Number.parseInt(match[3], 10), 12, 0, 0, 0)
  );
  const day = utc.getUTCDay();
  return day === 0 || day === 6;
}
