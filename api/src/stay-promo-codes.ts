import {
  StayPromoBenefitType,
  StayPromoRedemptionTerm,
  StayPromoTermType,
  type StayPromoCode
} from "@prisma/client";
import { requirePortalRole } from "./staff-access.js";
import { logAction } from "./action-log.js";
import { prisma } from "./prisma.js";
import {
  bedAllowed,
  computePromoDiscountVnd,
  isValidPromoCodeFormat,
  normalizePromoCode,
  parseAllowedBedsJson,
  serializeAllowedBeds,
  termMatchesScope,
  type AllowedBed,
  type StayPromoBenefit,
  type StayPromoScope,
  type StayPromoTerm
} from "./stay-promo-code-logic.js";

export class StayPromoError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "StayPromoError";
    this.statusCode = statusCode;
  }
}

export type StayPromoCodeView = {
  id: string;
  code: string;
  label: string;
  labelVi: string | null;
  notes: string | null;
  termType: StayPromoScope;
  benefitType: StayPromoBenefit;
  amountVnd: number | null;
  percentOff: number | null;
  benefitUnits: number | null;
  maxUses: number;
  usedCount: number;
  minNights: number | null;
  minMonths: number | null;
  allowedBeds: AllowedBed[] | null;
  enabled: boolean;
  expiresAt: string | null;
  createdByEmail: string;
  updatedByEmail: string;
  createdAt: string;
  updatedAt: string;
};

function toView(row: StayPromoCode): StayPromoCodeView {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    labelVi: row.labelVi,
    notes: row.notes,
    termType: row.termType as StayPromoScope,
    benefitType: row.benefitType as StayPromoBenefit,
    amountVnd: row.amountVnd,
    percentOff: row.percentOff,
    benefitUnits: row.benefitUnits,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    minNights: row.minNights,
    minMonths: row.minMonths,
    allowedBeds: parseAllowedBedsJson(row.allowedBedsJson),
    enabled: row.enabled,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdByEmail: row.createdByEmail,
    updatedByEmail: row.updatedByEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function assertBenefitFields(input: {
  benefitType: StayPromoBenefit;
  amountVnd?: number | null;
  percentOff?: number | null;
  benefitUnits?: number | null;
}) {
  if (input.benefitType === "FIXED_VND") {
    const amount = Math.round(Number(input.amountVnd) || 0);
    if (amount < 1) throw new StayPromoError("Fixed VND promos need amountVnd ≥ 1.");
    return { amountVnd: amount, percentOff: null as number | null, benefitUnits: null as number | null };
  }
  if (input.benefitType === "PERCENT_OFF") {
    const percent = Math.round(Number(input.percentOff) || 0);
    if (percent < 1 || percent > 100) throw new StayPromoError("Percent-off promos need percentOff between 1 and 100.");
    return { amountVnd: null as number | null, percentOff: percent, benefitUnits: null as number | null };
  }
  const units = Math.round(Number(input.benefitUnits) || 0);
  if (units < 1) throw new StayPromoError("Waive-units promos need benefitUnits ≥ 1.");
  return { amountVnd: null as number | null, percentOff: null as number | null, benefitUnits: units };
}

export async function listStayPromoCodes(actorEmail: string): Promise<StayPromoCodeView[]> {
  await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Only staff can manage promo codes.");
  const rows = await prisma.stayPromoCode.findMany({ orderBy: [{ updatedAt: "desc" }] });
  return rows.map(toView);
}

export async function upsertStayPromoCode(
  actorEmail: string,
  input: {
    id?: string | null;
    code: string;
    label: string;
    labelVi?: string | null;
    notes?: string | null;
    termType: StayPromoScope;
    benefitType: StayPromoBenefit;
    amountVnd?: number | null;
    percentOff?: number | null;
    benefitUnits?: number | null;
    maxUses: number;
    minNights?: number | null;
    minMonths?: number | null;
    allowedBeds?: AllowedBed[] | null;
    enabled: boolean;
    expiresAt?: string | null;
  }
): Promise<StayPromoCodeView> {
  const email = (await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can manage promo codes.")).email;
  const code = normalizePromoCode(input.code);
  if (!isValidPromoCodeFormat(code)) {
    throw new StayPromoError("Promo code must be 3–32 characters (letters, numbers, _ or -).");
  }
  const label = String(input.label ?? "").trim();
  if (!label) throw new StayPromoError("Label is required.");
  const maxUses = Math.round(Number(input.maxUses) || 0);
  if (maxUses < 1) throw new StayPromoError("maxUses must be at least 1.");
  const benefit = assertBenefitFields(input);
  const minNights =
    input.minNights == null || input.minNights === undefined || String(input.minNights).trim() === ""
      ? null
      : Math.max(1, Math.round(Number(input.minNights) || 0));
  const minMonths =
    input.minMonths == null || input.minMonths === undefined || String(input.minMonths).trim() === ""
      ? null
      : Math.max(1, Math.round(Number(input.minMonths) || 0));
  let expiresAt: Date | null = null;
  if (input.expiresAt != null && String(input.expiresAt).trim()) {
    const parsed = new Date(String(input.expiresAt));
    if (Number.isNaN(parsed.getTime())) throw new StayPromoError("Invalid expiresAt.");
    expiresAt = parsed;
  }
  const allowedBedsJson = serializeAllowedBeds(input.allowedBeds ?? null);
  const termType = input.termType as StayPromoTermType;
  const benefitType = input.benefitType as StayPromoBenefitType;

  const existingByCode = await prisma.stayPromoCode.findUnique({ where: { code } });
  const id = String(input.id ?? "").trim();

  if (id) {
    const existing = await prisma.stayPromoCode.findUnique({ where: { id } });
    if (!existing) throw new StayPromoError("Promo code not found.", 404);
    if (existingByCode && existingByCode.id !== existing.id) {
      throw new StayPromoError("That promo code already exists.", 409);
    }
    if (maxUses < existing.usedCount) {
      throw new StayPromoError(`maxUses cannot be below current usedCount (${existing.usedCount}).`);
    }
    const row = await prisma.stayPromoCode.update({
      where: { id: existing.id },
      data: {
        code,
        label,
        labelVi: String(input.labelVi ?? "").trim() || null,
        notes: String(input.notes ?? "").trim() || null,
        termType,
        benefitType,
        ...benefit,
        maxUses,
        minNights,
        minMonths,
        allowedBedsJson,
        enabled: Boolean(input.enabled),
        expiresAt,
        updatedByEmail: email
      }
    });
    await logAction({
      actorEmail: email,
      actorRole: "owner",
      action: "promo_code.update",
      entityType: "StayPromoCode",
      entityId: row.id,
      entityLabel: row.code,
      details: `${row.termType}/${row.benefitType}; maxUses=${row.maxUses}; enabled=${row.enabled}`
    });
    return toView(row);
  }

  if (existingByCode) throw new StayPromoError("That promo code already exists.", 409);
  const row = await prisma.stayPromoCode.create({
    data: {
      code,
      label,
      labelVi: String(input.labelVi ?? "").trim() || null,
      notes: String(input.notes ?? "").trim() || null,
      termType,
      benefitType,
      ...benefit,
      maxUses,
      usedCount: 0,
      minNights,
      minMonths,
      allowedBedsJson,
      enabled: Boolean(input.enabled),
      expiresAt,
      createdByEmail: email,
      updatedByEmail: email
    }
  });
  await logAction({
    actorEmail: email,
    actorRole: "owner",
    action: "promo_code.create",
    entityType: "StayPromoCode",
    entityId: row.id,
    entityLabel: row.code,
    details: `${row.termType}/${row.benefitType}; maxUses=${row.maxUses}`
  });
  return toView(row);
}

export async function deleteStayPromoCode(actorEmail: string, id: string): Promise<{ ok: true; disabled?: boolean }> {
  const email = (await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can manage promo codes.")).email;
  const existing = await prisma.stayPromoCode.findUnique({ where: { id: String(id ?? "").trim() } });
  if (!existing) throw new StayPromoError("Promo code not found.", 404);
  if (existing.usedCount > 0) {
    const row = await prisma.stayPromoCode.update({
      where: { id: existing.id },
      data: { enabled: false, updatedByEmail: email }
    });
    await logAction({
      actorEmail: email,
      actorRole: "owner",
      action: "promo_code.disable",
      entityType: "StayPromoCode",
      entityId: row.id,
      entityLabel: row.code,
      details: "Soft-disabled because usedCount > 0"
    });
    return { ok: true, disabled: true };
  }
  await prisma.stayPromoCode.delete({ where: { id: existing.id } });
  await logAction({
    actorEmail: email,
    actorRole: "owner",
    action: "promo_code.delete",
    entityType: "StayPromoCode",
    entityId: existing.id,
    entityLabel: existing.code,
    details: "Hard-deleted unused promo"
  });
  return { ok: true };
}

type QuoteInput = {
  code: string;
  termType: StayPromoTerm;
  nights?: number | null;
  months?: number | null;
  branchId?: string | null;
  bedNumber?: number | null;
  nightlyRates?: number[];
  staySubtotalVnd?: number | null;
  monthlyRentVnd?: number | null;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
};

function assertEligible(row: StayPromoCode, input: QuoteInput) {
  if (!row.enabled) throw new StayPromoError("This promo code is disabled.");
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new StayPromoError("This promo code has expired.");
  }
  if (row.usedCount >= row.maxUses) {
    throw new StayPromoError("This promo code has no remaining uses.");
  }
  if (!termMatchesScope(row.termType as StayPromoScope, input.termType)) {
    throw new StayPromoError(
      input.termType === "SHORT_TERM"
        ? "This promo code is for long-term registration only."
        : "This promo code is for short-term hostel stays only."
    );
  }
  const allowedBeds = parseAllowedBedsJson(row.allowedBedsJson);
  if (!bedAllowed(allowedBeds, input.branchId, input.bedNumber)) {
    throw new StayPromoError("This promo code is not valid for the selected bed.");
  }
  if (input.termType === "SHORT_TERM" && row.minNights != null) {
    const nights = Math.round(Number(input.nights) || 0);
    if (nights < row.minNights) {
      throw new StayPromoError(`This promo requires at least ${row.minNights} nights.`);
    }
  }
  if (input.termType === "LONG_TERM" && row.minMonths != null) {
    const months = Math.round(Number(input.months) || 0);
    if (months < row.minMonths) {
      throw new StayPromoError(`This promo requires at least ${row.minMonths} months.`);
    }
  }
}

export async function quoteStayPromoCode(input: QuoteInput) {
  const code = normalizePromoCode(input.code);
  if (!isValidPromoCodeFormat(code)) throw new StayPromoError("Invalid promo code.");
  const row = await prisma.stayPromoCode.findUnique({ where: { code } });
  if (!row) throw new StayPromoError("This promo code is not available.");
  assertEligible(row, input);
  const discountVnd = computePromoDiscountVnd({
    benefitType: row.benefitType as StayPromoBenefit,
    amountVnd: row.amountVnd,
    percentOff: row.percentOff,
    benefitUnits: row.benefitUnits,
    termType: input.termType,
    nightlyRates: input.nightlyRates,
    staySubtotalVnd: input.staySubtotalVnd,
    monthlyRentVnd: input.monthlyRentVnd,
    firstPaymentSubtotalVnd: input.firstPaymentSubtotalVnd,
    depositVnd: input.depositVnd,
    otherDiscountVnd: input.otherDiscountVnd
  });
  return {
    ok: true as const,
    id: row.id,
    code: row.code,
    label: row.label,
    labelVi: row.labelVi,
    termType: row.termType as StayPromoScope,
    benefitType: row.benefitType as StayPromoBenefit,
    discountVnd,
    remainingUses: Math.max(0, row.maxUses - row.usedCount)
  };
}

export async function redeemStayPromoCode(
  input: QuoteInput & {
    email: string;
    redemptionRef: string;
    maxDiscountVnd?: number | null;
  }
) {
  const quoted = await quoteStayPromoCode(input);
  const cap =
    input.maxDiscountVnd == null || !Number.isFinite(input.maxDiscountVnd)
      ? quoted.discountVnd
      : Math.max(0, Math.round(input.maxDiscountVnd));
  const discountVnd = Math.min(quoted.discountVnd, cap);
  if (discountVnd <= 0) {
    throw new StayPromoError("This stay has no amount the promo can reduce.");
  }
  const email = input.email.trim().toLowerCase();
  const redemptionRef = input.redemptionRef.trim();
  if (!redemptionRef) throw new StayPromoError("A redemption reference is required.");
  const redemptionTerm =
    input.termType === "LONG_TERM" ? StayPromoRedemptionTerm.LONG_TERM : StayPromoRedemptionTerm.SHORT_TERM;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.stayPromoRedemption.findUnique({
      where: {
        promoCodeId_redemptionRef: {
          promoCodeId: quoted.id,
          redemptionRef
        }
      }
    });
    if (existing) {
      return {
        ok: true as const,
        code: existing.code,
        discountVnd: existing.discountVnd,
        alreadyRedeemed: true
      };
    }

    const row = await tx.stayPromoCode.findUnique({ where: { id: quoted.id } });
    if (!row) throw new StayPromoError("This promo code is not available.");
    if (!row.enabled) throw new StayPromoError("This promo code is disabled.");
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new StayPromoError("This promo code has expired.");
    }
    if (row.usedCount >= row.maxUses) {
      throw new StayPromoError("This promo code has no remaining uses.", 409);
    }

    const updated = await tx.stayPromoCode.updateMany({
      where: {
        id: row.id,
        enabled: true,
        usedCount: { lt: row.maxUses }
      },
      data: { usedCount: { increment: 1 } }
    });
    if (updated.count !== 1) {
      throw new StayPromoError("This promo code has no remaining uses.", 409);
    }

    await tx.stayPromoRedemption.create({
      data: {
        promoCodeId: row.id,
        code: row.code,
        email,
        termType: redemptionTerm,
        redemptionRef,
        discountVnd
      }
    });

    return { ok: true as const, code: row.code, discountVnd, alreadyRedeemed: false };
  });
}

export async function releaseStayPromoCode(input: { code: string; redemptionRef: string }) {
  const code = normalizePromoCode(input.code);
  const redemptionRef = input.redemptionRef.trim();
  if (!code || !redemptionRef) return { released: false };

  return prisma.$transaction(async (tx) => {
    const redemption = await tx.stayPromoRedemption.findFirst({
      where: { code, redemptionRef }
    });
    if (!redemption) return { released: false };
    await tx.stayPromoRedemption.delete({ where: { id: redemption.id } });
    await tx.stayPromoCode.updateMany({
      where: { id: redemption.promoCodeId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } }
    });
    return { released: true };
  });
}
