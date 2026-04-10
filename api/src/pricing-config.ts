import { requirePortalRole } from "./staff-access.js";
import { prisma } from "./prisma.js";
import {
  readDiscountsFromSheet,
  queueDiscountUpsert,
  queueDiscountDelete,
  type SheetDiscount
} from "./google-sheets.js";

export type TermType = "long_term" | "short_term";

export type EligibilityRule =
  | { type: "status"; values: string[] }
  | { type: "minMonths"; value: number }
  | { type: "referral" }
  | { type: "bedTier"; values: Array<"top" | "middle" | "bottom"> }
  | { type: "gender"; values: Array<"male" | "female"> }
  | { type: "occupation"; values: string[] };

export type BedPriceOverride = {
  id: number;
  branchId: string;
  bedNumber: number;
  termType: TermType;
  monthlyPrice: number | null;
  deposit: number | null;
  nightlyPrice: number | null;
  updatedBy: string;
  updatedAt: Date;
  createdAt: Date;
};

export type PricingDiscount = {
  id: string;
  termType: TermType;
  label: string;
  labelVi: string;
  description: string;
  descriptionVi: string;
  amountVnd: number | null;
  percentOff: number | null;
  minNights: number | null;
  durationMonths: number | null;
  eligibility: EligibilityRule[];
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
};

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function getBedOverrides(termType?: TermType): Promise<BedPriceOverride[]> {
  const rows = await prisma.bedPriceOverride.findMany({
    where: termType ? { termType } : undefined,
    orderBy: [{ branchId: "asc" }, { bedNumber: "asc" }]
  });
  return rows.map((r) => ({ ...r, termType: r.termType as TermType }));
}

function sheetDiscountToPricingDiscount(d: SheetDiscount): PricingDiscount {
  return {
    id: d.id,
    termType: d.termType,
    label: d.label,
    labelVi: d.labelVi,
    description: d.description,
    descriptionVi: d.descriptionVi,
    amountVnd: d.amountVnd,
    percentOff: d.percentOff,
    minNights: d.minNights,
    durationMonths: d.durationMonths,
    eligibility: (d.eligibility as EligibilityRule[]) ?? [],
    enabled: d.enabled,
    updatedBy: d.updatedBy,
    updatedAt: d.updatedAt,
  };
}

export async function getDiscounts(termType?: TermType, enabledOnly = false): Promise<PricingDiscount[]> {
  const rows = await readDiscountsFromSheet();
  return rows
    .filter((r) => (!termType || r.termType === termType) && (!enabledOnly || r.enabled))
    .map(sheetDiscountToPricingDiscount);
}

// Resolve long-term bed price (merges override over sheet fallback)
export async function resolveLongTermBedPricing(
  branchId: string,
  bedNumber: number,
  sheetFallback: { monthlyPrice: number; deposit: number }
): Promise<{ monthlyPrice: number; deposit: number }> {
  const override = await prisma.bedPriceOverride.findUnique({
    where: { branchId_bedNumber_termType: { branchId, bedNumber, termType: "long_term" } }
  });
  return {
    monthlyPrice: override?.monthlyPrice ?? sheetFallback.monthlyPrice,
    deposit: override?.deposit ?? sheetFallback.deposit
  };
}

// Resolve short-term nightly price for a bed
export async function resolveNightlyPrice(
  branchId: string,
  bedNumber: number,
  fallback: number
): Promise<number> {
  const override = await prisma.bedPriceOverride.findUnique({
    where: { branchId_bedNumber_termType: { branchId, bedNumber, termType: "short_term" } }
  });
  return override?.nightlyPrice ?? fallback;
}

// ── Write helpers (owner/app_admin only) ─────────────────────────────────────

export async function upsertBedOverride(
  actorEmail: string,
  input: {
    branchId: string;
    bedNumber: number;
    termType: TermType;
    monthlyPrice?: number | null;
    deposit?: number | null;
    nightlyPrice?: number | null;
  }
): Promise<BedPriceOverride> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can edit bed pricing.");
  const row = await prisma.bedPriceOverride.upsert({
    where: { branchId_bedNumber_termType: { branchId: input.branchId, bedNumber: input.bedNumber, termType: input.termType } },
    create: {
      branchId: input.branchId,
      bedNumber: input.bedNumber,
      termType: input.termType,
      monthlyPrice: input.monthlyPrice ?? null,
      deposit: input.deposit ?? null,
      nightlyPrice: input.nightlyPrice ?? null,
      updatedBy: actorEmail.trim().toLowerCase()
    },
    update: {
      monthlyPrice: input.monthlyPrice ?? null,
      deposit: input.deposit ?? null,
      nightlyPrice: input.nightlyPrice ?? null,
      updatedBy: actorEmail.trim().toLowerCase()
    }
  });
  return { ...row, termType: row.termType as TermType };
}

export async function deleteBedOverride(
  actorEmail: string,
  branchId: string,
  bedNumber: number,
  termType: TermType
): Promise<void> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can edit bed pricing.");
  await prisma.bedPriceOverride.deleteMany({
    where: { branchId, bedNumber, termType }
  });
}

export async function upsertDiscount(
  actorEmail: string,
  input: Omit<PricingDiscount, "updatedAt" | "updatedBy">
): Promise<PricingDiscount> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can manage discounts.");
  const sheetRow: SheetDiscount = {
    id: input.id,
    termType: input.termType,
    label: input.label,
    labelVi: input.labelVi,
    description: input.description,
    descriptionVi: input.descriptionVi,
    amountVnd: input.amountVnd ?? null,
    percentOff: input.percentOff ?? null,
    minNights: input.minNights ?? null,
    durationMonths: input.durationMonths ?? null,
    eligibility: input.eligibility as object[],
    enabled: input.enabled,
    updatedBy: actorEmail.trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
  queueDiscountUpsert(sheetRow, actorEmail);
  return sheetDiscountToPricingDiscount(sheetRow);
}

export async function deleteDiscount(
  actorEmail: string,
  discountId: string
): Promise<void> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can delete discounts.");
  queueDiscountDelete(discountId);
}
