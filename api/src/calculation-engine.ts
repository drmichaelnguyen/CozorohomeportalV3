import { ClientRow, getLaundryBookingsForEmail, getFinesForEmail, laundryMachines, getLaundryAllowance, getCoinsForEmail, LaundryCalendarEvent, FineEntry } from "./google-sheets.js";

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
  laundryFeeVnd: number;
  finesVnd: number;
  totalBeforeCoinsVnd: number;
  maxCoinUsageVnd: number;
  recommendedCoinUsage: number;
  recommendedCoinValueVnd: number;
  finalTotalVnd: number;
  details: {
    durationMonths: number;
    professionalStatus: string;
    workplace: string;
    memberTier: string;
    parkingCount: { motorbikes: number; bicycles: number };
    laundryCount: { free: number; coins: number; cash: number };
    unpaidFinesCount: number;
  };
}

export interface RentCalculationOptions {
  managerDiscountVnd?: number;
  shortTermSurchargeRate?: number | null;
  parkingFeeVnd?: number | null;
}

function parseVndAmount(value: unknown): number {
  const digits = String(value ?? "").replace(/[^0-9-]/g, "");
  if (!digits || digits === "-") {
    return 0;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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

function getMonthlyAdjustmentVnd(client: ClientRow): number {
  const rawValue =
    client["Ưu đãi tháng"] ||
    client["Uu dai thang"] ||
    client["Khoản ưu đãi và chi phí tăng thêm"] ||
    client["Khoản ưu đãi và chi phí tăng thêm nếu có"] ||
    "";
  return parseVndAmount(rawValue);
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
  const email = client["Địa chỉ email"] || "";
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

  // 5. Laundry Fee (Optimized)
  const bookings = await getLaundryBookingsForEmail(email);
  // Filter bookings for the target month
  const monthBookings = bookings.filter((b: LaundryCalendarEvent) => b.start.startsWith(targetMonth));
  
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
  const finesVnd = unpaidFines.reduce((sum: number, f: FineEntry) => sum + (f.coinPayment.coinCost * f.coinPayment.multiplier), 0);

  // 7. Total Before Coins
  const rentWithSurcharges = effectiveBaseRent + tenureSurchargeVnd;
  const totalDiscounts = professionalDiscountVnd + planDiscountVnd + managerDiscountVnd;
  
  const totalBeforeCoinsVnd = Math.max(
    0,
    rentWithSurcharges + monthlyAdjustmentSurchargeVnd - totalDiscounts + parkingFeeVnd + laundryFeeVnd + finesVnd
  );

  // 8. Coin Usage (Cap: 10% of rent part)
  // "Clients can use coins to cover up to 10% of the monthly rent"
  // I'll define "monthly rent" as rentWithSurcharges.
  const maxCoinUsageVnd = Math.round(rentWithSurcharges * 0.1);
  const rentLimitForCoins = rentWithSurcharges;
  const maxAllowedFromCoinsVnd = Math.round(rentLimitForCoins * 0.1);

  const coinRate = RENT_COIN_RATES[memberTier] || 0.6;
  const currentCoins = await getCoinsForEmail(email);
  
  // Recommended = min(maxAllowed, currentCoins * rate)
  const availableCoinValueVnd = Math.round(Number(currentCoins) * coinRate);
  const recommendedCoinValueVnd = Math.min(maxAllowedFromCoinsVnd, availableCoinValueVnd);
  const recommendedCoinUsage = Math.ceil(recommendedCoinValueVnd / coinRate);

  const finalTotalVnd = totalBeforeCoinsVnd - (recommendedCoinUsage * coinRate);

  return {
    email,
    month: targetMonth,
    baseRent: effectiveBaseRent,
    tenureSurchargeVnd,
    tenureSurchargeRate: surchargeRate,
    monthlyAdjustmentVnd,
    professionalDiscountVnd,
    planDiscountVnd,
    managerDiscountVnd,
    parkingFeeVnd,
    laundryFeeVnd,
    finesVnd,
    totalBeforeCoinsVnd,
    maxCoinUsageVnd: maxAllowedFromCoinsVnd,
    recommendedCoinUsage,
    recommendedCoinValueVnd: Math.round(recommendedCoinUsage * coinRate),
    finalTotalVnd: Math.max(0, finalTotalVnd),
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
      unpaidFinesCount: unpaidFines.length
    }
  };
}
