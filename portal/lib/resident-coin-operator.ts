/**
 * Resident-facing label for the coins sheet "Người thao tác" column.
 * Managers still see the raw value in manager UI; residents only see
 * a generic automated label or "Cozoro" for staff-driven adjustments.
 */
const AUTOMATED_OPERATORS_NORMALIZED = new Set([
  "system",
  "system_cancel",
  "cozoro bee",
  "cleaning system",
  "hệ thống"
]);

export function formatResidentCoinsOperatorLabel(
  rawOperator: string | undefined,
  residentEmail: string,
  language: "en" | "vi"
): string {
  const raw = (rawOperator ?? "").trim();
  const norm = raw.normalize("NFC").toLowerCase();
  const residentNorm = residentEmail.trim().toLowerCase();

  const automated = language === "vi" ? "Tự động" : "Automated";

  if (!raw) {
    return automated;
  }
  if (norm === residentNorm) {
    return automated;
  }
  if (AUTOMATED_OPERATORS_NORMALIZED.has(norm)) {
    return automated;
  }
  return "Cozoro";
}
