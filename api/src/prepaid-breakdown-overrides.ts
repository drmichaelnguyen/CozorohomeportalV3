import type { PrepaidNextPaymentEstimate } from "./calculation-engine.js";

/** Owner-adjustable lines only (not sheet-derived recurring components or plan gross/discount). */
export type PrepaidBreakdownOverrides = Partial<{
  packageRecurringSubtotalVnd: number;
  laundryFeeVnd: number;
  finesVnd: number;
  gateParkingFeeVnd: number;
}>;

function pickNonNegInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Parse JSON / request body into a partial override map; returns null if nothing valid. */
export function sanitizePrepaidBreakdownOverrides(raw: unknown): PrepaidBreakdownOverrides | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const out: PrepaidBreakdownOverrides = {};
  const pkg = pickNonNegInt(o.packageRecurringSubtotalVnd);
  const laundry = pickNonNegInt(o.laundryFeeVnd);
  const fines = pickNonNegInt(o.finesVnd);
  const gate = pickNonNegInt(o.gateParkingFeeVnd);
  if (pkg !== undefined) out.packageRecurringSubtotalVnd = pkg;
  if (laundry !== undefined) out.laundryFeeVnd = laundry;
  if (fines !== undefined) out.finesVnd = fines;
  if (gate !== undefined) out.gateParkingFeeVnd = gate;
  return Object.keys(out).length > 0 ? out : null;
}

export function hasPrepaidBreakdownOverrides(overrides: PrepaidBreakdownOverrides | null | undefined): boolean {
  return Boolean(overrides && Object.keys(overrides).length > 0);
}

export function applyPrepaidBreakdownOverridesToEstimate(
  est: PrepaidNextPaymentEstimate,
  overrides: PrepaidBreakdownOverrides | null | undefined
): PrepaidNextPaymentEstimate & { breakdownHasOwnerOverrides?: boolean } {
  if (!hasPrepaidBreakdownOverrides(overrides)) {
    return { ...est, breakdownHasOwnerOverrides: false };
  }
  const o = overrides!;
  const packageRecurringSubtotalVnd =
    o.packageRecurringSubtotalVnd !== undefined ? o.packageRecurringSubtotalVnd : est.packageRecurringSubtotalVnd;
  const laundryFeeVnd = o.laundryFeeVnd !== undefined ? o.laundryFeeVnd : est.laundryFeeVnd;
  const finesVnd = o.finesVnd !== undefined ? o.finesVnd : est.finesVnd;
  const gateParkingFeeVnd = o.gateParkingFeeVnd !== undefined ? o.gateParkingFeeVnd : est.gateParkingFeeVnd;
  const midCyclePayablesVnd = laundryFeeVnd + finesVnd + gateParkingFeeVnd;
  const estimatedTotalVnd = Math.max(0, packageRecurringSubtotalVnd + midCyclePayablesVnd);
  return {
    ...est,
    packageRecurringSubtotalVnd,
    laundryFeeVnd,
    finesVnd,
    gateParkingFeeVnd,
    midCyclePayablesVnd,
    estimatedTotalVnd,
    breakdownHasOwnerOverrides: true
  };
}
