import type { PrepaidNextPaymentEstimatePayload } from "./rent-paid-status";

export type PrepaidBreakdownOverridesPayload = Partial<{
  packageRecurringSubtotalVnd: number;
  laundryFeeVnd: number;
  finesVnd: number;
  gateParkingFeeVnd: number;
}>;

export function hasPrepaidBreakdownOverridesPayload(
  o: PrepaidBreakdownOverridesPayload | null | undefined
): boolean {
  return Boolean(o && Object.keys(o).length > 0);
}

export function mergePrepaidEstimateWithOverrides(
  est: PrepaidNextPaymentEstimatePayload,
  overrides: PrepaidBreakdownOverridesPayload | null | undefined
): PrepaidNextPaymentEstimatePayload {
  if (!hasPrepaidBreakdownOverridesPayload(overrides)) {
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

export function suggestedTotalFromEstimate(est: PrepaidNextPaymentEstimatePayload): number {
  return Math.max(0, est.packageRecurringSubtotalVnd + (est.midCyclePayablesVnd ?? 0));
}
