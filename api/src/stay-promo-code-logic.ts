/**
 * Pure stay-promo rules: normalize codes, eligibility helpers, and benefit math.
 * Deposit is never discounted.
 */

export type StayPromoTerm = "LONG_TERM" | "SHORT_TERM";
export type StayPromoScope = StayPromoTerm | "BOTH";
export type StayPromoBenefit = "FIXED_VND" | "PERCENT_OFF" | "WAIVE_UNITS";

export type AllowedBed = { branchId: string; bedNumber: number };

export function normalizePromoCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function isValidPromoCodeFormat(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code);
}

export function parseAllowedBedsJson(raw: string | null | undefined): AllowedBed[] | null {
  if (raw == null || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const beds: AllowedBed[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const branchId = String((item as { branchId?: unknown }).branchId ?? "")
        .trim()
        .toUpperCase();
      const bedNumber = Number((item as { bedNumber?: unknown }).bedNumber);
      if (!branchId || !Number.isFinite(bedNumber) || bedNumber < 1) continue;
      beds.push({ branchId, bedNumber: Math.round(bedNumber) });
    }
    return beds.length ? beds : null;
  } catch {
    return null;
  }
}

export function serializeAllowedBeds(beds: AllowedBed[] | null | undefined): string | null {
  if (!beds || beds.length === 0) return null;
  const cleaned = beds
    .map((b) => ({
      branchId: String(b.branchId ?? "")
        .trim()
        .toUpperCase(),
      bedNumber: Math.round(Number(b.bedNumber))
    }))
    .filter((b) => b.branchId && Number.isFinite(b.bedNumber) && b.bedNumber >= 1);
  if (!cleaned.length) return null;
  return JSON.stringify(cleaned);
}

export function termMatchesScope(scope: StayPromoScope, term: StayPromoTerm): boolean {
  return scope === "BOTH" || scope === term;
}

export function bedAllowed(
  allowedBeds: AllowedBed[] | null | undefined,
  branchId: string | null | undefined,
  bedNumber: number | null | undefined
): boolean {
  if (!allowedBeds || allowedBeds.length === 0) return true;
  const branch = String(branchId ?? "")
    .trim()
    .toUpperCase();
  const bed = Math.round(Number(bedNumber));
  if (!branch || !Number.isFinite(bed) || bed < 1) return false;
  return allowedBeds.some((entry) => entry.branchId === branch && entry.bedNumber === bed);
}

/** Sum of the N lowest positive nightly rates (waive N nights). */
export function computeShortTermWaiveUnitsDiscount(nightlyRates: number[], units: number): number {
  const n = Math.max(0, Math.round(Number(units) || 0));
  if (n <= 0) return 0;
  const rates = nightlyRates
    .map((rate) => Number(rate))
    .filter((rate) => Number.isFinite(rate) && rate > 0)
    .sort((a, b) => a - b);
  if (!rates.length) return 0;
  return Math.round(rates.slice(0, n).reduce((sum, rate) => sum + rate, 0));
}

export function computeLongTermWaiveUnitsDiscount(input: {
  monthlyRentVnd: number;
  units: number;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
}): number {
  const rent = Math.max(0, Math.round(Number(input.monthlyRentVnd) || 0));
  const units = Math.max(0, Math.round(Number(input.units) || 0));
  if (!rent || !units) return 0;
  const raw = rent * units;
  if (input.firstPaymentSubtotalVnd == null || input.firstPaymentSubtotalVnd === undefined) {
    return raw;
  }
  const subtotal = Math.max(0, Math.round(Number(input.firstPaymentSubtotalVnd) || 0));
  const deposit = Math.max(0, Math.round(Number(input.depositVnd) || 0));
  const other = Math.max(0, Math.round(Number(input.otherDiscountVnd) || 0));
  const rentPortion = Math.max(0, subtotal - deposit - other);
  return Math.min(raw, rentPortion);
}

export function computeFixedVndDiscount(amountVnd: number, capVnd: number): number {
  const amount = Math.max(0, Math.round(Number(amountVnd) || 0));
  const cap = Math.max(0, Math.round(Number(capVnd) || 0));
  return Math.min(amount, cap);
}

export function computePercentOffDiscount(percentOff: number, baseVnd: number, capVnd?: number | null): number {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percentOff) || 0)));
  const base = Math.max(0, Math.round(Number(baseVnd) || 0));
  const raw = Math.round((base * pct) / 100);
  if (capVnd == null || capVnd === undefined) return raw;
  return Math.min(raw, Math.max(0, Math.round(Number(capVnd) || 0)));
}

/** Cap available for short-term stay credit (pre-deposit subtotal after other stay discounts). */
export function shortTermDiscountCap(staySubtotalVnd: number, otherDiscountVnd = 0): number {
  return Math.max(0, Math.round(Number(staySubtotalVnd) || 0) - Math.max(0, Math.round(Number(otherDiscountVnd) || 0)));
}

/** Cap available for long-term first-payment rent credit (excludes deposit). */
export function longTermDiscountCap(input: {
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
  monthlyRentVnd?: number | null;
}): number {
  if (input.firstPaymentSubtotalVnd == null || input.firstPaymentSubtotalVnd === undefined) {
    return Math.max(0, Math.round(Number(input.monthlyRentVnd) || 0));
  }
  const subtotal = Math.max(0, Math.round(Number(input.firstPaymentSubtotalVnd) || 0));
  const deposit = Math.max(0, Math.round(Number(input.depositVnd) || 0));
  const other = Math.max(0, Math.round(Number(input.otherDiscountVnd) || 0));
  return Math.max(0, subtotal - deposit - other);
}

export function computePromoDiscountVnd(input: {
  benefitType: StayPromoBenefit;
  amountVnd?: number | null;
  percentOff?: number | null;
  benefitUnits?: number | null;
  termType: StayPromoTerm;
  nightlyRates?: number[];
  staySubtotalVnd?: number | null;
  monthlyRentVnd?: number | null;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
}): number {
  if (input.termType === "SHORT_TERM") {
    const cap = shortTermDiscountCap(input.staySubtotalVnd ?? 0, input.otherDiscountVnd ?? 0);
    if (cap <= 0) return 0;
    if (input.benefitType === "FIXED_VND") {
      return computeFixedVndDiscount(input.amountVnd ?? 0, cap);
    }
    if (input.benefitType === "PERCENT_OFF") {
      return computePercentOffDiscount(input.percentOff ?? 0, cap, cap);
    }
    const waiver = computeShortTermWaiveUnitsDiscount(input.nightlyRates ?? [], input.benefitUnits ?? 1);
    return Math.min(waiver, cap);
  }

  const rent = Math.max(0, Math.round(Number(input.monthlyRentVnd) || 0));
  const cap = longTermDiscountCap({
    firstPaymentSubtotalVnd: input.firstPaymentSubtotalVnd,
    depositVnd: input.depositVnd,
    otherDiscountVnd: input.otherDiscountVnd,
    monthlyRentVnd: rent
  });
  if (cap <= 0) return 0;
  if (input.benefitType === "FIXED_VND") {
    return computeFixedVndDiscount(input.amountVnd ?? 0, cap);
  }
  if (input.benefitType === "PERCENT_OFF") {
    return computePercentOffDiscount(input.percentOff ?? 0, rent || cap, cap);
  }
  return computeLongTermWaiveUnitsDiscount({
    monthlyRentVnd: rent,
    units: input.benefitUnits ?? 1,
    firstPaymentSubtotalVnd: input.firstPaymentSubtotalVnd,
    depositVnd: input.depositVnd,
    otherDiscountVnd: input.otherDiscountVnd
  });
}
