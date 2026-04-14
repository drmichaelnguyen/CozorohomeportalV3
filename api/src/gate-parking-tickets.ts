import { COZORO_TIMEZONE } from "./google-sheets.js";
import { prisma } from "./prisma.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** YYYY-MM for rent roll-up, using the configured Cozoro business timezone. */
export function billingPeriodMonthForGateSession(sessionStart: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COZORO_TIMEZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(sessionStart);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  return `${y}-${m}`;
}

/** Sum unpaid gate parking tickets with period strictly before the billing month (YYYY-MM). */
export async function sumUnpaidGateParkingVndBeforeMonth(residentEmail: string, billingMonth: string): Promise<number> {
  const email = normalizeEmail(residentEmail);
  const agg = await prisma.gateParkingTicket.aggregate({
    where: {
      residentEmail: email,
      paidAt: null,
      periodMonth: { lt: billingMonth }
    },
    _sum: { amountVnd: true }
  });
  return agg._sum.amountVnd ?? 0;
}

/** Sum all unpaid gate parking tickets for a resident (any period). */
export async function sumAllUnpaidGateParkingVndForEmail(residentEmail: string): Promise<number> {
  const email = normalizeEmail(residentEmail);
  const agg = await prisma.gateParkingTicket.aggregate({
    where: { residentEmail: email, paidAt: null },
    _sum: { amountVnd: true }
  });
  return agg._sum.amountVnd ?? 0;
}

export async function markGateParkingTicketsPaidForBilling(billingMonth: string, residentEmail: string): Promise<number> {
  const email = normalizeEmail(residentEmail);
  const now = new Date();
  const result = await prisma.gateParkingTicket.updateMany({
    where: {
      residentEmail: email,
      paidAt: null,
      periodMonth: { lt: billingMonth }
    },
    data: { paidAt: now }
  });
  return result.count;
}
