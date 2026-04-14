export type RentBreakdownPayload = {
  baseRent: number;
  parkingFeeVnd: number;
  gateParkingFeeVnd?: number;
  laundryFeeVnd: number;
  finesVnd: number;
  /** Bill total before applying Cozoro Coin credit toward rent */
  totalBeforeCoinsVnd?: number;
  /** Coins applied toward this bill (VND equivalent at member tier rate) */
  recommendedCoinValueVnd?: number;
  /** Raw coin count applied toward rent */
  recommendedCoinUsage?: number;
  finalTotalVnd: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate?: number;
  monthlyAdjustmentVnd?: number;
  professionalDiscountVnd: number;
  planDiscountVnd: number;
  managerDiscountVnd: number;
  details?: {
    laundryCount?: { cash?: number };
    billingPrevMonth?: string;
  };
};

/** Sheet-derived recurring lines (same as engine monthly rent from sheet, no deposit). */
export type PrepaidRecurringComponentsPayload = {
  baseRentVnd: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate: number;
  monthlyAdjustmentSurchargeVnd: number;
  professionalDiscountVnd: number;
  parkingFeeVnd: number;
  recurringMonthlyVnd: number;
};

/** Server estimate for the next multi-month package renewal (sheet + engine as of billing month). */
export type PrepaidNextPaymentEstimatePayload = {
  planMonths: 3 | 6;
  recurringMonthlyVnd: number;
  /** Present on current API; omitted on very old snapshots only. */
  recurringComponents?: PrepaidRecurringComponentsPayload;
  frequencyDiscountVnd: number;
  packageRecurringSubtotalVnd: number;
  laundryFeeVnd: number;
  laundryCashUses?: number;
  finesVnd: number;
  gateParkingFeeVnd: number;
  /** Unpaid fines + laundry + gate per engine (current billing month) */
  midCyclePayablesVnd?: number;
  estimatedTotalVnd: number;
  /** When manager confirmed a custom package total, engine lump-sum before override. */
  engineEstimatedTotalVnd?: number;
  managerPackageNote?: string | null;
  prepaidManagerConfirmed?: boolean;
  billingMonth: string;
  laundryBillingPrevMonth: string;
};

export type RentPaidStatusPayload = {
  email?: string;
  month: string;
  isPaid: boolean;
  /** Resident opt-in: apply coins toward this month’s bill (capped in engine). */
  applyCoinsTowardRent?: boolean;
  onPrepaidPlan: boolean;
  /** Present when `onPrepaidPlan` — rough next lump-sum at package renewal. */
  prepaidNextPaymentEstimate?: PrepaidNextPaymentEstimatePayload | null;
  breakdown: RentBreakdownPayload | null;
  blockingRentDuePopupEnabled?: boolean;
};

export function formatBillingMonthLabel(month: string, language: "en" | "vi"): string {
  const [y, m] = month.split("-").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return month;
  }
  return new Date(y, m - 1, 1).toLocaleDateString(language === "vi" ? "vi-VN" : "en-US", {
    month: "long",
    year: "numeric"
  });
}
