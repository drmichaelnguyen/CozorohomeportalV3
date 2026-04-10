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
  selectionMode: "manual" | "automatic";
  stackMode: "stackable" | "exclusive";
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
    selectionMode: d.selectionMode ?? (d.termType === "short_term" ? "automatic" : "manual"),
    stackMode: d.stackMode ?? "stackable",
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
    selectionMode: input.selectionMode ?? (input.termType === "short_term" ? "automatic" : "manual"),
    stackMode: input.stackMode ?? "stackable",
    enabled: input.enabled,
    updatedBy: actorEmail.trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
  queueDiscountUpsert(sheetRow, actorEmail);
  return sheetDiscountToPricingDiscount(sheetRow);
}

// ── Branch pricing settings ────────────────────────────────────────────────────

export type BranchPricingSettings = {
  branchId: string;
  cleaningOptOutFeeVnd: number;
  parkingFeeVnd: number;
  updatedBy: string;
  updatedAt: Date;
};

export type BedParkingFeeOverride = {
  id: number;
  branchId: string;
  bedNumber: number;
  parkingFeeVnd: number;
  updatedBy: string;
  updatedAt: Date;
};

const BRANCH_DEFAULTS: BranchPricingSettings = {
  branchId: "",
  cleaningOptOutFeeVnd: 100000,
  parkingFeeVnd: 0,
  updatedBy: "system",
  updatedAt: new Date(0)
};

export async function getBranchPricingSettings(branchId: string): Promise<BranchPricingSettings> {
  const row = await prisma.branchPricingSettings.findUnique({ where: { branchId } });
  if (!row) return { ...BRANCH_DEFAULTS, branchId };
  return { branchId: row.branchId, cleaningOptOutFeeVnd: row.cleaningOptOutFeeVnd, parkingFeeVnd: row.parkingFeeVnd, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function getAllBranchPricingSettings(): Promise<BranchPricingSettings[]> {
  const rows = await prisma.branchPricingSettings.findMany();
  // Ensure both branches are represented
  const branches = ["D2", "D7"];
  return branches.map((branchId) => {
    const row = rows.find((r) => r.branchId === branchId);
    if (!row) return { ...BRANCH_DEFAULTS, branchId };
    return { branchId: row.branchId, cleaningOptOutFeeVnd: row.cleaningOptOutFeeVnd, parkingFeeVnd: row.parkingFeeVnd, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
  });
}

export async function upsertBranchPricingSettings(
  actorEmail: string,
  input: { branchId: string; cleaningOptOutFeeVnd?: number; parkingFeeVnd?: number }
): Promise<BranchPricingSettings> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can edit branch pricing settings.");
  const row = await prisma.branchPricingSettings.upsert({
    where: { branchId: input.branchId },
    create: {
      branchId: input.branchId,
      cleaningOptOutFeeVnd: input.cleaningOptOutFeeVnd ?? 100000,
      parkingFeeVnd: input.parkingFeeVnd ?? 0,
      updatedBy: actorEmail.trim().toLowerCase()
    },
    update: {
      ...(input.cleaningOptOutFeeVnd != null ? { cleaningOptOutFeeVnd: input.cleaningOptOutFeeVnd } : {}),
      ...(input.parkingFeeVnd != null ? { parkingFeeVnd: input.parkingFeeVnd } : {}),
      updatedBy: actorEmail.trim().toLowerCase()
    }
  });
  return { branchId: row.branchId, cleaningOptOutFeeVnd: row.cleaningOptOutFeeVnd, parkingFeeVnd: row.parkingFeeVnd, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function getBedParkingFeeOverrides(branchId?: string): Promise<BedParkingFeeOverride[]> {
  const rows = await prisma.bedParkingFeeOverride.findMany({
    where: branchId ? { branchId } : undefined,
    orderBy: [{ branchId: "asc" }, { bedNumber: "asc" }]
  });
  return rows.map((r) => ({ id: r.id, branchId: r.branchId, bedNumber: r.bedNumber, parkingFeeVnd: r.parkingFeeVnd, updatedBy: r.updatedBy, updatedAt: r.updatedAt }));
}

export async function upsertBedParkingFeeOverride(
  actorEmail: string,
  input: { branchId: string; bedNumber: number; parkingFeeVnd: number }
): Promise<BedParkingFeeOverride> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can edit parking fees.");
  const row = await prisma.bedParkingFeeOverride.upsert({
    where: { branchId_bedNumber: { branchId: input.branchId, bedNumber: input.bedNumber } },
    create: { branchId: input.branchId, bedNumber: input.bedNumber, parkingFeeVnd: input.parkingFeeVnd, updatedBy: actorEmail.trim().toLowerCase() },
    update: { parkingFeeVnd: input.parkingFeeVnd, updatedBy: actorEmail.trim().toLowerCase() }
  });
  return { id: row.id, branchId: row.branchId, bedNumber: row.bedNumber, parkingFeeVnd: row.parkingFeeVnd, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function deleteBedParkingFeeOverride(
  actorEmail: string,
  branchId: string,
  bedNumber: number
): Promise<void> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can edit parking fees.");
  await prisma.bedParkingFeeOverride.deleteMany({ where: { branchId, bedNumber } });
}

// Resolve parking fee for a specific bed (bed override > branch default > 0)
export async function resolveParkingFee(branchId: string, bedNumber: number): Promise<number> {
  const [bedOverride, branchSettings] = await Promise.all([
    prisma.bedParkingFeeOverride.findUnique({ where: { branchId_bedNumber: { branchId, bedNumber } } }),
    prisma.branchPricingSettings.findUnique({ where: { branchId } })
  ]);
  if (bedOverride) return bedOverride.parkingFeeVnd;
  return branchSettings?.parkingFeeVnd ?? 0;
}

export async function deleteDiscount(
  actorEmail: string,
  discountId: string
): Promise<void> {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can delete discounts.");
  queueDiscountDelete(discountId);
}
