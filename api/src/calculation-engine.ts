import {
  ClientRow,
  getLaundryBookingsForEmail,
  getFinesForEmail,
  getFineAmountVndFromEntry,
  laundryMachines,
  getLaundryAllowance,
  parseCurrentCozoroCoinsFromClientRow,
  LaundryCalendarEvent,
  FineEntry
} from "./google-sheets.js";
import { sumUnpaidGateParkingVndBeforeMonth } from "./gate-parking-tickets.js";

/**
 * Cozoro Payment Calculation Engine (v3.1.0)
 * Centralizes logic for rent, surcharges, discounts, and tiered coin conversion.
 */

export const RENT_COIN_RATES: Record<string, number> = {
  Elite: 1.0,
  Diamond: 0.9,
  Platinum: 0.8,
  Gold: 0.7,
  Silver: 0.6
};

export const FINE_VND_PER_COIN: Record<string, number> = {
  Elite: 2.0,
  Diamond: 1.9,
  Platinum: 1.8,
  Gold: 1.7,
  Silver: 1.6
};

export const PARKING_PRICES = {
  MOTORBIKE: 200000,
  BICYCLE: 100000
};

export const LAUNDRY_CASH_PRICE = 7000;

export interface RentBreakdown {
  email: string;
  month: string;
  baseRent: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate: number;
  monthlyAdjustmentVnd: number;
  professionalDiscountVnd: number;
  planDiscountVnd: number;
  managerDiscountVnd: number;
  parkingFeeVnd: number;
  gateParkingFeeVnd: number;
  laundryFeeVnd: number;
  finesVnd: number;
  totalBeforeCoinsVnd: number;
  /** Max VND that can be covered by coins this month (10% of full bill before coin credit). */
  maxCoinUsageVnd: number;
  recommendedCoinUsage: number;
  recommendedCoinValueVnd: number;
  finalTotalVnd: number;
  /** Member tier: VND value per 1 Cozoro Coin when applied toward rent. */
  coinRateVndPerCoin: number;
  /** Sheet roster balance at calculation time. */
  currentCoinsBalance: number;
  details: {
    durationMonths: number;
    professionalStatus: string;
    workplace: string;
    memberTier: string;
    parkingCount: { motorbikes: number; bicycles: number };
    laundryCount: { free: number; coins: number; cash: number };
    unpaidFinesCount: number;
    /** Calendar month whose cash laundry usage is included in laundryFeeVnd (previous month vs. billing targetMonth). */
    billingPrevMonth: string;
  };
}

export interface RentCalculationOptions {
  managerDiscountVnd?: number;
  shortTermSurchargeRate?: number | null;
  parkingFeeVnd?: number | null;
  gateParkingFeeVnd?: number | null;
  /**
   * When true, apply automatic coin credit up to the 10% cap (resident opted in for this month).
   * When false/omitted, no coin amount is deducted from the bill unless `committedRentCoinRedemption` is set (resident already exchanged coins).
   */
  applyCoinsTowardRent?: boolean;
  /** Locked redemption after resident confirms coin exchange (coins already deducted from sheet). */
  committedRentCoinRedemption?: { coinsUsed: number; valueVnd: number } | null;
}

function parseVndAmount(value: unknown): number {
  const digits = String(value ?? "").replace(/[^0-9-]/g, "");
  if (!digits || digits === "-") {
    return 0;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Maximize VND credit from whole coins without exceeding `maxCreditVnd`. */
function computeRentCoinRedemptionCoins(params: {
  maxCreditVnd: number;
  coinRateVndPerCoin: number;
  currentCoinsBalance: number;
}): { coinsUsed: number; coinValueVnd: number } {
  const { coinRateVndPerCoin, currentCoinsBalance } = params;
  const maxCreditVnd = Math.max(0, Math.round(params.maxCreditVnd));
  if (maxCreditVnd <= 0 || !Number.isFinite(coinRateVndPerCoin) || coinRateVndPerCoin <= 0 || currentCoinsBalance <= 0) {
    return { coinsUsed: 0, coinValueVnd: 0 };
  }
  let coinsUsed = Math.min(
    Math.max(0, Math.trunc(currentCoinsBalance)),
    Math.floor(maxCreditVnd / coinRateVndPerCoin + 1e-9)
  );
  let coinValueVnd = Math.round(coinsUsed * coinRateVndPerCoin);
  while (coinsUsed > 0 && coinValueVnd > maxCreditVnd) {
    coinsUsed -= 1;
    coinValueVnd = Math.round(coinsUsed * coinRateVndPerCoin);
  }
  return { coinsUsed, coinValueVnd };
}

/** Previous calendar month (YYYY-MM) relative to billing month. */
export function billingPrevMonth(billingMonth: string): string {
  const [y, m] = billingMonth.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return billingMonth;
  }
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Calculates the tenure surcharge rate based on contract duration.
 * 1-3 months: +12%
 * 4-5 months: +8%
 * 6+ months: 0%
 */
export function getTenureSurchargeRate(durationMonths: number): number {
  if (durationMonths >= 1 && durationMonths <= 3) return 0.12;
  if (durationMonths >= 4 && durationMonths <= 5) return 0.08;
  return 0;
}

/** Ignore absurd sheet parses (e.g. digit-stripping long prose). Typical monthly line items stay well under this. */
const MONTHLY_ADJUSTMENT_VND_ABS_CAP = 1_000_000_000;

function getMonthlyAdjustmentVnd(client: ClientRow): number {
  // NOTE: Do not read `Khoản ưu đãi và chi phí tăng thêm nếu có` here — registration writes free-text
  // `additionalTerms` into that column (google-sheets append). `parseVndAmount` would strip all non-digits
  // from the paragraph and produce a bogus multi-trillion "surcharge".
  const rawValue =
    client["Ưu đãi tháng"] ||
    client["Uu dai thang"] ||
    client["Khoản ưu đãi và chi phí tăng thêm"] ||
    "";
  const v = parseVndAmount(rawValue);
  if (!Number.isFinite(v) || Math.abs(v) > MONTHLY_ADJUSTMENT_VND_ABS_CAP) {
    return 0;
  }
  return v;
}

/**
 * Main calculation engine for rent breakdown.
 */
export async function calculateRentBreakdown(
  client: ClientRow,
  targetMonth: string, // Format: "YYYY-MM"
  options: RentCalculationOptions = {}
): Promise<RentBreakdown> {
  const managerDiscountVnd = Number(options.managerDiscountVnd ?? 0);
  const emailRaw = (client["Địa chỉ email"] ?? "").trim();
  /** Fines, laundry, gate tickets, and coins are matched by normalized email — not MÃ HD. */
  const email = emailRaw.toLowerCase();
  const memberTier = client["Cozoro Member"] || "Silver";
  const baseRentRaw = parseVndAmount(client["Số tiền chia sẻ mỗi tháng"]);
  const durationMonths = parseInt(String(client["Thời hạn hợp đồng (tháng)"] || "0"), 10);
  const paymentPlan = client["Bạn muốn thanh toán chi phí như thế nào?"] || "";

  // 1. Tenure Surcharge
  const surchargeRate =
    typeof options.shortTermSurchargeRate === "number" && Number.isFinite(options.shortTermSurchargeRate)
      ? options.shortTermSurchargeRate
      : getTenureSurchargeRate(durationMonths);
  const tenureSurchargeVnd = Math.round(baseRentRaw * surchargeRate);

  // 2. Monthly adjustment from dedicated sheet column.
  // Negative = discount, positive = surcharge.
  const monthlyAdjustmentVnd = getMonthlyAdjustmentVnd(client);
  const professionalDiscountVnd = monthlyAdjustmentVnd < 0 ? Math.abs(monthlyAdjustmentVnd) : 0;
  const monthlyAdjustmentSurchargeVnd = monthlyAdjustmentVnd > 0 ? monthlyAdjustmentVnd : 0;

  // 3. Plan Discounts
  let planDiscountVnd = 0;
  if (paymentPlan.includes("03 tháng")) {
    // Plan 3 months: subtract 500,000 VND total
    // We assume this is spread or applied to the first month of the package.
    // However, the rule says "3-month plan: subtract 500,000 VND total".
    // I'll apply it if the current month is the start of the period or just subtract it from the monthly calculation?
    // User said "subtract 500,000 VND total" for 3-month plan.
    // For simplicity, I'll apply it to every month if it's meant to be a monthly discount? 
    // No, "total" usually means once per period.
    // I'll check if the client notes mention "Giảm 500k".
  const notes = String(
    client["Ưu đãi tháng"] ||
    client["Uu dai thang"] ||
    client["Khoản ưu đãi và chi phí tăng thêm nếu có"] ||
    client["Khoản ưu đãi và chi phí tăng thêm"] ||
    ""
  ).toLowerCase();
    if (notes.includes("giảm 500k")) {
       planDiscountVnd = 500000;
    }
  }

  // 6+1 plan: one month free (base rent for ONE month is zero)
  let effectiveBaseRent = baseRentRaw;
  if (paymentPlan.includes("06 tháng")) {
    const notes = String(client["Chú thích"] || "").toLowerCase();
    if (notes.includes("6+1") || notes.includes("6t +1t")) {
      // Check if this month is the "free" month. 
      // This requires knowing the last payment date or start date.
      // For now, I'll provide a flag if base rent is 0.
      // Actually, many 6+1 clients have "Phí ở đóng mỗi tháng": "0" in the sheet when they are in the free period.
      if (parseInt(String(client["Phí ở đóng mỗi tháng"] || "1"), 10) === 0) {
        effectiveBaseRent = 0;
      }
    }
  }

  // 4. Parking Fee
  // Motorbike: 200k, Bicycle: 100k
  // We'll look at "Biển số xe máy" or specific parking columns if available.
  // Many rows have "Phí gởi xe" already. I'll use that if present, otherwise calculate.
  let parkingFeeVnd =
    typeof options.parkingFeeVnd === "number" && Number.isFinite(options.parkingFeeVnd)
      ? options.parkingFeeVnd
      : parseVndAmount(client["Phí gởi xe"]);
  let motorbikes = 0;
  let bicycles = 0;
  if (typeof options.parkingFeeVnd !== "number" && parkingFeeVnd === 0) {
    if (client["Biển số xe máy đăng ký gởi xe"]) {
      motorbikes = 1;
      parkingFeeVnd = PARKING_PRICES.MOTORBIKE;
    }
  }

  const ticketGateVnd = await sumUnpaidGateParkingVndBeforeMonth(email, targetMonth);
  let gateParkingFeeVnd =
    typeof options.gateParkingFeeVnd === "number" && Number.isFinite(options.gateParkingFeeVnd)
      ? options.gateParkingFeeVnd
      : ticketGateVnd;

  const prevMonth = billingPrevMonth(targetMonth);

  // 5. Laundry fee — cash usage for the **previous** calendar month (rolled into this bill)
  const bookings = await getLaundryBookingsForEmail(email);
  const monthBookings = bookings.filter((b: LaundryCalendarEvent) => b.start.startsWith(prevMonth));
  
  // Get Allowance
  const branchId = (client["Chi nhánh Cozoro dorm"] || "").includes("7") ? "D7" : "D2";
  const allowance = await getLaundryAllowance(client, branchId);
  
  let freeRemaining = allowance.baseFreeUsesPerMonth + allowance.bonusWasherUsesPerMonth + allowance.bonusDryerUsesPerMonth;
  let laundryCashCount = 0;
  let laundryCoinCount = 0;
  let laundryFreeCount = 0;

  for (const booking of monthBookings) {
    if (booking.description.toUpperCase().includes("FREE_LAUNDRY")) {
      laundryFreeCount++;
    } else if (booking.description.toUpperCase().includes("COINS")) {
      laundryCoinCount++;
    } else if (booking.description.toUpperCase().includes("CASH")) {
      laundryCashCount++;
    } else {
      // Unmarked: apply optimization logic
      if (freeRemaining > 0) {
        laundryFreeCount++;
        freeRemaining--;
      } else {
        // Prefer coins if balance > 7000? 
        // We'll assume cash for simplicity in the "breakdown" unless coins are explicitly used.
        laundryCashCount++;
      }
    }
  }
  const laundryFeeVnd = laundryCashCount * LAUNDRY_CASH_PRICE;

  // 6. Fines
  const fines = await getFinesForEmail(email);
  const unpaidFines = fines.filter((f: FineEntry) => !f.coinPayment.isPaid);
  // Sum sheet VND for unpaid fines (matches portal / account unpaid fine total). Do not use coinCost×multiplier here — that double-counts tier and is not VND.
  const finesVnd = unpaidFines.reduce((sum: number, f: FineEntry) => sum + getFineAmountVndFromEntry(f), 0);

  // 7. Total Before Coins
  const rentWithSurcharges = effectiveBaseRent + tenureSurchargeVnd;
  const totalDiscounts = professionalDiscountVnd + planDiscountVnd + managerDiscountVnd;
  
  const totalBeforeCoinsVnd = Math.max(
    0,
    rentWithSurcharges +
      monthlyAdjustmentSurchargeVnd -
      totalDiscounts +
      parkingFeeVnd +
      gateParkingFeeVnd +
      laundryFeeVnd +
      finesVnd
  );

  // 8. Coin usage — up to 10% of the **full** bill (before coin credit), tier VND-per-coin rate, whole coins only.
  const maxAllowedFromCoinsVnd = Math.round(totalBeforeCoinsVnd * 0.1);
  const coinRateVndPerCoin = RENT_COIN_RATES[memberTier] || 0.6;
  const currentCoinsBalance = parseCurrentCozoroCoinsFromClientRow(client);

  const committed = options.committedRentCoinRedemption;
  const hasCommitted =
    committed &&
    Number.isFinite(committed.coinsUsed) &&
    committed.coinsUsed > 0 &&
    Number.isFinite(committed.valueVnd) &&
    committed.valueVnd > 0;

  const useCoinCredit = options.applyCoinsTowardRent === true || Boolean(hasCommitted);

  let recommendedCoinValueVnd = 0;
  let recommendedCoinUsage = 0;
  if (hasCommitted) {
    recommendedCoinUsage = Math.trunc(committed!.coinsUsed);
    recommendedCoinValueVnd = Math.round(committed!.valueVnd);
  } else if (useCoinCredit) {
    const dyn = computeRentCoinRedemptionCoins({
      maxCreditVnd: maxAllowedFromCoinsVnd,
      coinRateVndPerCoin,
      currentCoinsBalance
    });
    recommendedCoinUsage = dyn.coinsUsed;
    recommendedCoinValueVnd = dyn.coinValueVnd;
  }

  const finalTotalVnd = totalBeforeCoinsVnd - recommendedCoinValueVnd;

  return {
    email: emailRaw,
    month: targetMonth,
    baseRent: effectiveBaseRent,
    tenureSurchargeVnd,
    tenureSurchargeRate: surchargeRate,
    monthlyAdjustmentVnd,
    professionalDiscountVnd,
    planDiscountVnd,
    managerDiscountVnd,
    parkingFeeVnd,
    gateParkingFeeVnd,
    laundryFeeVnd,
    finesVnd,
    totalBeforeCoinsVnd,
    maxCoinUsageVnd: maxAllowedFromCoinsVnd,
    recommendedCoinUsage,
    recommendedCoinValueVnd: useCoinCredit ? recommendedCoinValueVnd : 0,
    finalTotalVnd: Math.max(0, finalTotalVnd),
    coinRateVndPerCoin,
    currentCoinsBalance,
    details: {
      durationMonths,
      professionalStatus:
        client["Ưu đãi tháng"] ||
        client["Uu dai thang"] ||
        client["Khoản ưu đãi và chi phí tăng thêm"] ||
        client["Khoản ưu đãi và chi phí tăng thêm nếu có"] ||
        "",
      workplace: "",
      memberTier,
      parkingCount: { motorbikes, bicycles },
      laundryCount: { free: laundryFreeCount, coins: laundryCoinCount, cash: laundryCashCount },
      unpaidFinesCount: unpaidFines.length,
      billingPrevMonth: prevMonth
    }
  };
}

/** Sheet-derived monthly recurring charges (same rules as monthly rent engine, excluding coins / gate / laundry / fines / multi-month frequency lump). */
export type RecurringMonthlyRentComponents = {
  baseRentVnd: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate: number;
  monthlyAdjustmentSurchargeVnd: number;
  professionalDiscountVnd: number;
  parkingFeeVnd: number;
  recurringMonthlyVnd: number;
};

export function computeRecurringMonthlyRentComponentsFromSheet(client: ClientRow): RecurringMonthlyRentComponents {
  const baseRentVnd = parseVndAmount(client["Số tiền chia sẻ mỗi tháng"]);
  const durationMonths = parseInt(String(client["Thời hạn hợp đồng (tháng)"] || "0"), 10);
  const tenureSurchargeRate = getTenureSurchargeRate(durationMonths);
  const tenureSurchargeVnd = Math.round(baseRentVnd * tenureSurchargeRate);
  const monthlyAdjustmentVnd = getMonthlyAdjustmentVnd(client);
  const professionalDiscountVnd = monthlyAdjustmentVnd < 0 ? Math.abs(monthlyAdjustmentVnd) : 0;
  const monthlyAdjustmentSurchargeVnd = monthlyAdjustmentVnd > 0 ? monthlyAdjustmentVnd : 0;
  let parkingFeeVnd = parseVndAmount(client["Phí gởi xe"]);
  if (parkingFeeVnd === 0 && client["Biển số xe máy đăng ký gởi xe"]) {
    parkingFeeVnd = PARKING_PRICES.MOTORBIKE;
  }
  const recurringMonthlyVnd = Math.max(
    0,
    baseRentVnd +
      tenureSurchargeVnd +
      monthlyAdjustmentSurchargeVnd -
      professionalDiscountVnd +
      parkingFeeVnd
  );
  return {
    baseRentVnd,
    tenureSurchargeVnd,
    tenureSurchargeRate,
    monthlyAdjustmentSurchargeVnd,
    professionalDiscountVnd,
    parkingFeeVnd,
    recurringMonthlyVnd
  };
}

/**
 * Monthly rent-related sheet charges only (share rent, tenure surcharge, monthly adjustment, parking).
 * Omits plan-frequency lump discounts, laundry, fines, and gate tickets — used to build prepaid package totals.
 */
export function computeRecurringMonthlyRentVndFromSheet(client: ClientRow): number {
  return computeRecurringMonthlyRentComponentsFromSheet(client).recurringMonthlyVnd;
}

export type PrepaidNextPaymentEstimate = {
  planMonths: 3 | 6;
  /** Months of recurring multiplied before plan discount (6+1 sheet plan = 7 × recurring − 1 month free). */
  packageGrossMonths: number;
  recurringMonthlyVnd: number;
  /** Rent + surcharges + parking per month (no deposit); mirrors monthly bill line items from the sheet. */
  recurringComponents: RecurringMonthlyRentComponents;
  frequencyDiscountVnd: number;
  /** recurringMonthly × packageGrossMonths − frequencyDiscount */
  packageRecurringSubtotalVnd: number;
  laundryFeeVnd: number;
  /** Cash laundry loads counted toward laundryFeeVnd for this estimate */
  laundryCashUses: number;
  finesVnd: number;
  gateParkingFeeVnd: number;
  /** Fines + cash laundry (billing rules) + gate — owed anytime, included in estimatedTotalVnd */
  midCyclePayablesVnd: number;
  estimatedTotalVnd: number;
  /** Present when API merges a manager-confirmed `PrepaidPackageBilling` row */
  engineEstimatedTotalVnd?: number;
  managerPackageNote?: string | null;
  prepaidManagerConfirmed?: boolean;
  billingMonth: string;
  laundryBillingPrevMonth: string;
};

/**
 * Rough next lump-sum when the prepaid package renews: gross months × recurring (from sheet today) minus the same
 * frequency discount as registration (500k for 3 months; for 6+1 plan: 7 × recurring − 1 full month free),
 * plus laundry (previous calendar month vs billing month), gate tickets, and unpaid fines as of the engine.
 */
export async function computePrepaidNextPaymentEstimate(
  client: ClientRow,
  billingMonthYyyyMm: string
): Promise<PrepaidNextPaymentEstimate | null> {
  const paymentPlan = String(client["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
  const planMonths: 3 | 6 | null = paymentPlan.includes("06 tháng")
    ? 6
    : paymentPlan.includes("03 tháng")
      ? 3
      : null;
  if (!planMonths) {
    return null;
  }

  const recurringComponents = computeRecurringMonthlyRentComponentsFromSheet(client);
  const recurringMonthlyVnd = recurringComponents.recurringMonthlyVnd;
  /** Sheet “06 tháng” = pay for 6 effective months over 7 covered months → bill 7× recurring − 1 month free. */
  const packageGrossMonths = planMonths === 6 ? 7 : planMonths;
  const frequencyDiscountVnd = planMonths === 3 ? 500_000 : recurringMonthlyVnd;
  const packageRecurringSubtotalVnd = Math.max(0, recurringMonthlyVnd * packageGrossMonths - frequencyDiscountVnd);

  const bd = await calculateRentBreakdown(client, billingMonthYyyyMm, { applyCoinsTowardRent: false });
  const laundryFeeVnd = bd.laundryFeeVnd;
  const finesVnd = bd.finesVnd;
  const gateParkingFeeVnd = bd.gateParkingFeeVnd;
  const midCyclePayablesVnd = laundryFeeVnd + finesVnd + gateParkingFeeVnd;
  const estimatedTotalVnd = Math.max(0, packageRecurringSubtotalVnd + midCyclePayablesVnd);
  const laundryCashUses = bd.details.laundryCount?.cash ?? 0;

  return {
    planMonths,
    packageGrossMonths,
    recurringMonthlyVnd,
    recurringComponents,
    frequencyDiscountVnd,
    packageRecurringSubtotalVnd,
    laundryFeeVnd,
    laundryCashUses,
    finesVnd,
    gateParkingFeeVnd,
    midCyclePayablesVnd,
    estimatedTotalVnd,
    billingMonth: billingMonthYyyyMm,
    laundryBillingPrevMonth: bd.details.billingPrevMonth
  };
}
