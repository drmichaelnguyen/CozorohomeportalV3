export const COZORO_DATE_LOCALE = "vi-VN";
export const COZORO_TIME_ZONE = "Asia/Ho_Chi_Minh";

export function formatCozoroDate(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  if (value == null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString(COZORO_DATE_LOCALE, {
    timeZone: COZORO_TIME_ZONE,
    ...options
  });
}

export function formatCozoroDateTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  if (value == null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(COZORO_DATE_LOCALE, {
    timeZone: COZORO_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
    ...options
  });
}

export function formatCozoroMonth(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  return formatCozoroDate(value, {
    month: "long",
    year: "numeric",
    ...options
  });
}
