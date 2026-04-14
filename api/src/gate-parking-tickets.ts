import { prisma } from "./prisma.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
