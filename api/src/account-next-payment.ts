import { prisma } from "./prisma.js";
import {
  formatSheetDateDdMmYyyy,
  parseSheetDateDdMmYyyy,
  type PaymentPlanKind
} from "./next-payment-date.js";

export async function upsertAccountNextPayment(input: {
  email: string;
  nextPaymentDateDdMmYyyy: string;
  planKind?: PaymentPlanKind | null;
  sourceContractCode?: string | null;
  updatedBy?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const parsed = parseSheetDateDdMmYyyy(input.nextPaymentDateDdMmYyyy);
  if (!email || !parsed) {
    return null;
  }

  return prisma.accountNextPayment.upsert({
    where: { email },
    create: {
      email,
      nextPaymentDate: parsed,
      planKind: input.planKind ?? null,
      sourceContractCode: input.sourceContractCode?.trim() || null,
      updatedBy: input.updatedBy?.trim() || null
    },
    update: {
      nextPaymentDate: parsed,
      planKind: input.planKind ?? null,
      sourceContractCode: input.sourceContractCode?.trim() || null,
      updatedBy: input.updatedBy?.trim() || null
    }
  });
}

export async function getAccountNextPaymentDate(
  email: string
): Promise<{ nextPaymentDate: string; source: "db" } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = await prisma.accountNextPayment.findUnique({ where: { email: normalized } });
  if (!row?.nextPaymentDate) return null;
  return {
    nextPaymentDate: formatSheetDateDdMmYyyy(row.nextPaymentDate),
    source: "db"
  };
}
