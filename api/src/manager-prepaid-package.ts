import { computePrepaidNextPaymentEstimate } from "./calculation-engine.js";
import { sendGmailReceipt } from "./google-sheets.js";
import type { ClientRow } from "./google-sheets.js";
import {
  applyPrepaidBreakdownOverridesToEstimate,
  sanitizePrepaidBreakdownOverrides,
  type PrepaidBreakdownOverrides
} from "./prepaid-breakdown-overrides.js";
import { Prisma } from "@prisma/client";

import { prisma } from "./prisma.js";
import { requirePortalRole } from "./staff-access.js";
import { clearResidentNotificationCacheForEmail } from "./support.js";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isPrepaidClientRow(row: Record<string, string>) {
  const plan = String(row["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
  return plan.includes("03 tháng") || plan.includes("06 tháng");
}

export async function managerGetPrepaidPackageBilling(input: {
  actorEmail: string;
  clientEmail: string;
  billingMonth: string;
  clientRow: ClientRow;
}) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const email = normalizeEmail(input.clientEmail);
  if (!isPrepaidClientRow(input.clientRow as Record<string, string>)) {
    return { error: "Client is not on a multi-month prepaid plan." };
  }
  const estimate = await computePrepaidNextPaymentEstimate(input.clientRow, input.billingMonth);
  if (!estimate) {
    return { error: "Could not compute prepaid estimate for this client." };
  }
  const billing = await prisma.prepaidPackageBilling.findUnique({
    where: { residentEmail_billingMonth: { residentEmail: email, billingMonth: input.billingMonth } }
  });
  const rawOverrides = billing?.breakdownOverrides as PrepaidBreakdownOverrides | null | undefined;
  const mergedEstimate = applyPrepaidBreakdownOverridesToEstimate(estimate, rawOverrides ?? null);
  return { estimate: mergedEstimate, engineEstimate: estimate, billing };
}

export async function managerUpsertPrepaidPackageBilling(input: {
  actorEmail: string;
  clientEmail: string;
  billingMonth: string;
  clientRow: ClientRow;
  managerPackageTotalVnd: number;
  managerNote?: string | null;
  /** Owner / app_admin only; omit to leave existing overrides unchanged. */
  breakdownOverrides?: unknown;
  /** When true with owner role, clears stored breakdown overrides. */
  clearBreakdownOverrides?: boolean;
}) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const email = normalizeEmail(input.clientEmail);
  if (!isPrepaidClientRow(input.clientRow as Record<string, string>)) {
    return { error: "Client is not on a multi-month prepaid plan." };
  }
  const total = Math.round(Number(input.managerPackageTotalVnd));
  if (!Number.isFinite(total) || total < 0) {
    return { error: "managerPackageTotalVnd must be a non-negative number." };
  }
  const estimate = await computePrepaidNextPaymentEstimate(input.clientRow, input.billingMonth);
  if (!estimate) {
    return { error: "Could not compute prepaid estimate for this client." };
  }
  const snapshot = estimate as unknown as object;

  type BreakdownPatch = PrepaidBreakdownOverrides | null | "__keep__";
  let breakdownPatch: BreakdownPatch = "__keep__";
  if (input.clearBreakdownOverrides === true) {
    await requirePortalRole(
      normalizeEmail(input.actorEmail),
      ["owner", "app_admin"],
      "Only owners can clear package breakdown overrides."
    );
    breakdownPatch = null;
  } else if (input.breakdownOverrides !== undefined) {
    await requirePortalRole(
      normalizeEmail(input.actorEmail),
      ["owner", "app_admin"],
      "Only owners can edit package breakdown lines."
    );
    breakdownPatch = sanitizePrepaidBreakdownOverrides(input.breakdownOverrides);
  }

  const breakdownForPrisma =
    breakdownPatch === "__keep__"
      ? undefined
      : breakdownPatch === null
        ? Prisma.DbNull
        : (breakdownPatch as Prisma.InputJsonValue);

  const billing = await prisma.prepaidPackageBilling.upsert({
    where: { residentEmail_billingMonth: { residentEmail: email, billingMonth: input.billingMonth } },
    create: {
      residentEmail: email,
      billingMonth: input.billingMonth,
      calculatedSnapshot: snapshot,
      ...(breakdownPatch !== "__keep__" ? { breakdownOverrides: breakdownForPrisma } : {}),
      managerPackageTotalVnd: total,
      managerNote: input.managerNote?.trim() || null,
      confirmed: false,
      confirmedBy: null,
      confirmedAt: null
    },
    update: {
      calculatedSnapshot: snapshot,
      ...(breakdownPatch !== "__keep__" ? { breakdownOverrides: breakdownForPrisma } : {}),
      managerPackageTotalVnd: total,
      managerNote: input.managerNote?.trim() || null,
      confirmed: false,
      confirmedBy: null,
      confirmedAt: null
    }
  });

  const storedOverrides = billing.breakdownOverrides as PrepaidBreakdownOverrides | null | undefined;
  const mergedEstimate = applyPrepaidBreakdownOverridesToEstimate(estimate, storedOverrides ?? null);
  return { billing, estimate: mergedEstimate, engineEstimate: estimate };
}

export async function managerConfirmPrepaidPackageBilling(input: {
  actorEmail: string;
  clientEmail: string;
  billingMonth: string;
}) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const email = normalizeEmail(input.clientEmail);
  const billing = await prisma.prepaidPackageBilling.findUnique({
    where: { residentEmail_billingMonth: { residentEmail: email, billingMonth: input.billingMonth } }
  });
  if (!billing) {
    return { error: "Save a draft calculation first." };
  }
  const updated = await prisma.prepaidPackageBilling.update({
    where: { id: billing.id },
    data: {
      confirmed: true,
      confirmedAt: new Date(),
      confirmedBy: normalizeEmail(input.actorEmail)
    }
  });
  clearResidentNotificationCacheForEmail(email);
  return { billing: updated };
}

export async function managerNotifyPrepaidPackageBilling(input: {
  actorEmail: string;
  clientEmail: string;
  billingMonth: string;
  clientName?: string;
  notifyApp: boolean;
  notifyEmail: boolean;
}) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const email = normalizeEmail(input.clientEmail);
  const billing = await prisma.prepaidPackageBilling.findUnique({
    where: { residentEmail_billingMonth: { residentEmail: email, billingMonth: input.billingMonth } }
  });
  if (!billing || !billing.confirmed) {
    return { error: "Confirm the package billing before sending notifications." };
  }

  const now = new Date();
  const name = input.clientName?.trim() || email;

  if (input.notifyEmail) {
    const amountStr = billing.managerPackageTotalVnd.toLocaleString("vi-VN");
    const subject = "Cozoro Home — multi-month package payment";
    const body = [
      `Hello ${name},`,
      "",
      `Your manager has confirmed your next multi-month package payment amount: ${amountStr} ₫ (billing month ${input.billingMonth}).`,
      billing.managerNote ? `\nNote from manager:\n${billing.managerNote}\n` : "",
      "Please open the Cozoro Home portal (Payments / Next payment) for details.",
      "",
      "— Cozoro Home"
    ]
      .filter(Boolean)
      .join("\n");
    await sendGmailReceipt({ to: email, subject, body });
  }

  await prisma.prepaidPackageBilling.update({
    where: { id: billing.id },
    data: {
      ...(input.notifyApp ? { lastAppNotifyAt: now } : {}),
      ...(input.notifyEmail ? { lastEmailNotifyAt: now } : {})
    }
  });

  if (input.notifyApp) {
    clearResidentNotificationCacheForEmail(email);
  }

  const fresh = await prisma.prepaidPackageBilling.findUnique({ where: { id: billing.id } });
  return { billing: fresh };
}

export async function getConfirmedPrepaidBillingForResident(email: string, billingMonth: string) {
  return prisma.prepaidPackageBilling.findFirst({
    where: {
      residentEmail: normalizeEmail(email),
      billingMonth,
      confirmed: true
    }
  });
}
