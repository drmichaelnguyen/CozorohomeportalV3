import type { MonthlyRentStatus } from "@prisma/client";
import type { ClientRow } from "./google-sheets.js";
import { prisma } from "./prisma.js";
import { calculateRentBreakdown, type RentCalculationOptions, type RentBreakdown } from "./calculation-engine.js";

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

  return { breakdown, record };
}
