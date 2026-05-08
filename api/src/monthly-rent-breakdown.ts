import type { MonthlyRentStatus } from "@prisma/client";
import type { ClientRow } from "./google-sheets.js";
import { prisma } from "./prisma.js";
import { calculateRentBreakdown, type RentCalculationOptions, type RentBreakdown } from "./calculation-engine.js";
import { getMonthlyRentBreakdownOverride } from "./monthly-rent-breakdown-overrides.js";

/**
 * Loads `MonthlyRentStatus` and runs `calculateRentBreakdown` with the same coin rules as the resident portal:
 * opt-in from DB, or locked redemption after the resident confirms a coin exchange.
 */
export async function calculateRentBreakdownForBillingMonth(
  client: ClientRow,
  targetMonth: string,
  calculationOptions: RentCalculationOptions = {}
): Promise<{ breakdown: RentBreakdown; record: MonthlyRentStatus | null }> {
  const emailKey = String(client["Địa chỉ email"] ?? "")
    .trim()
    .toLowerCase();
  const record = await prisma.monthlyRentStatus.findUnique({
    where: { email_month: { email: emailKey, month: targetMonth } }
  });

  const committed =
    record?.rentCoinRedeemCoins != null &&
    record.rentCoinRedeemCoins > 0 &&
    record.rentCoinRedeemValueVnd != null &&
    record.rentCoinRedeemValueVnd > 0
      ? { coinsUsed: record.rentCoinRedeemCoins, valueVnd: record.rentCoinRedeemValueVnd }
      : undefined;

  const applyCoins = Boolean(committed) || record?.applyCoinsTowardRent === true;

  const breakdown = await calculateRentBreakdown(client, targetMonth, {
    ...calculationOptions,
    applyCoinsTowardRent: applyCoins,
    committedRentCoinRedemption: committed ?? null
  });
  const overrideEntry = await getMonthlyRentBreakdownOverride(emailKey, targetMonth);
  if (overrideEntry?.overrides && Object.keys(overrideEntry.overrides).length > 0) {
    const manual = overrideEntry.overrides;
    const calculatedLines = {
      baseRent: breakdown.baseRent,
      tenureSurchargeVnd: breakdown.tenureSurchargeVnd,
      monthlyAdjustmentSurchargeVnd: Math.max(0, breakdown.monthlyAdjustmentVnd),
      professionalDiscountVnd: breakdown.professionalDiscountVnd,
      planDiscountVnd: breakdown.planDiscountVnd,
      managerDiscountVnd: breakdown.managerDiscountVnd,
      parkingFeeVnd: breakdown.parkingFeeVnd,
      gateParkingFeeVnd: breakdown.gateParkingFeeVnd,
      laundryFeeVnd: breakdown.laundryFeeVnd,
      finesVnd: breakdown.finesVnd
    };
    const baseRent = manual.baseRent ?? breakdown.baseRent;
    const tenureSurchargeVnd = manual.tenureSurchargeVnd ?? breakdown.tenureSurchargeVnd;
    const monthlyAdjustmentSurchargeVnd = manual.monthlyAdjustmentSurchargeVnd ?? Math.max(0, breakdown.monthlyAdjustmentVnd);
    const professionalDiscountVnd = manual.professionalDiscountVnd ?? breakdown.professionalDiscountVnd;
    const planDiscountVnd = manual.planDiscountVnd ?? breakdown.planDiscountVnd;
    const managerDiscountVnd = manual.managerDiscountVnd ?? breakdown.managerDiscountVnd;
    const parkingFeeVnd = manual.parkingFeeVnd ?? breakdown.parkingFeeVnd;
    const gateParkingFeeVnd = manual.gateParkingFeeVnd ?? breakdown.gateParkingFeeVnd;
    const laundryFeeVnd = manual.laundryFeeVnd ?? breakdown.laundryFeeVnd;
    const finesVnd = manual.finesVnd ?? breakdown.finesVnd;
    const totalBeforeCoinsVnd = Math.max(
      0,
      baseRent +
        tenureSurchargeVnd +
        monthlyAdjustmentSurchargeVnd -
        professionalDiscountVnd -
        planDiscountVnd -
        managerDiscountVnd +
        parkingFeeVnd +
        gateParkingFeeVnd +
        laundryFeeVnd +
        finesVnd
    );
    const maxCoinUsageVnd = Math.round(totalBeforeCoinsVnd * 0.1);
    const coinRateVndPerCoin = breakdown.coinRateVndPerCoin ?? 0;
    const maxCoinsByCredit = coinRateVndPerCoin > 0 ? Math.floor(maxCoinUsageVnd / coinRateVndPerCoin + 1e-9) : 0;
    const maxCoinsByBalance = Number.isFinite(breakdown.currentCoinsBalance)
      ? Math.max(0, Math.trunc(breakdown.currentCoinsBalance))
      : 0;
    const maxCoinsAllowed = Math.max(0, Math.min(maxCoinsByCredit, maxCoinsByBalance));
    const requestedCoins = Math.max(0, Math.trunc(breakdown.recommendedCoinUsage ?? 0));
    const recommendedCoinUsage = Math.min(requestedCoins, maxCoinsAllowed);
    const recommendedCoinValueVnd = breakdown.recommendedCoinUsage > 0
      ? Math.min(maxCoinUsageVnd, Math.round(recommendedCoinUsage * coinRateVndPerCoin))
      : 0;
    breakdown.baseRent = baseRent;
    breakdown.tenureSurchargeVnd = tenureSurchargeVnd;
    breakdown.monthlyAdjustmentVnd = monthlyAdjustmentSurchargeVnd - professionalDiscountVnd;
    breakdown.professionalDiscountVnd = professionalDiscountVnd;
    breakdown.planDiscountVnd = planDiscountVnd;
    breakdown.managerDiscountVnd = managerDiscountVnd;
    breakdown.parkingFeeVnd = parkingFeeVnd;
    breakdown.gateParkingFeeVnd = gateParkingFeeVnd;
    breakdown.laundryFeeVnd = laundryFeeVnd;
    breakdown.finesVnd = finesVnd;
    breakdown.totalBeforeCoinsVnd = totalBeforeCoinsVnd;
    breakdown.maxCoinUsageVnd = maxCoinUsageVnd;
    breakdown.recommendedCoinUsage = recommendedCoinUsage;
    breakdown.recommendedCoinValueVnd = recommendedCoinValueVnd;
    breakdown.finalTotalVnd = Math.max(0, totalBeforeCoinsVnd - recommendedCoinValueVnd);
    breakdown.details.manualOverrides = manual;
    breakdown.details.calculatedLines = calculatedLines;
  }

  return { breakdown, record };
}
