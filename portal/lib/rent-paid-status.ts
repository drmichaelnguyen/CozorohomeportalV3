export type RentBreakdownPayload = {
  baseRent: number;
  parkingFeeVnd: number;
  gateParkingFeeVnd?: number;
  laundryFeeVnd: number;
  finesVnd: number;
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

export type RentPaidStatusPayload = {
  email?: string;
  month: string;
  isPaid: boolean;
  onPrepaidPlan: boolean;
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
