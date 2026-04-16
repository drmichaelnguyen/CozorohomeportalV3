import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ACTIVE_STAYING_COLUMN,
  CLIENT_NAME_COLUMN,
  CONTRACT_CODE_COLUMN,
  EMAIL_COLUMN,
  readCachedClients
} from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";

const cacheDirPath = path.join(process.cwd(), "data");
const settingsFilePath = path.join(cacheDirPath, "referral-program-settings.json");

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export type ReferralProduct = "long_term" | "hostel";

export type ReferralProgramSettings = {
  enabled: boolean;
  /**
   * Contract length (months) that qualifies for the **full** discount and coin amounts.
   * Shorter contracts are pro-rated: reward × (effectiveMonths / this value), capped at 100%.
   */
  fullOfferContractMonths: number;
  /** Long-term (dorm) registration at /register — one-time discount off first payment estimate. */
  newRegistrantDiscountVnd: number;
  newRegistrantCoins: number;
  referrerCoins: number;
  headlineEn: string;
  headlineVi: string;
  detailsEn: string;
  detailsVi: string;
  /** Short-term / hostel direct booking — separate amounts from long-term. */
  hostelEnabled: boolean;
  hostelNewRegistrantDiscountVnd: number;
  hostelNewRegistrantCoins: number;
  hostelReferrerCoins: number;
  hostelHeadlineEn: string;
  hostelHeadlineVi: string;
  hostelDetailsEn: string;
  hostelDetailsVi: string;
};

const DEFAULT_SETTINGS: ReferralProgramSettings = {
  enabled: true,
  fullOfferContractMonths: 6,
  newRegistrantDiscountVnd: 500_000,
  newRegistrantCoins: 10_000,
  referrerCoins: 15_000,
  headlineEn: "Refer a friend — rewards for both of you",
  headlineVi: "Giới thiệu bạn — ưu đãi cho cả hai",
  detailsEn:
    "Enter a current resident's referral code on registration. The full reward applies when the new contract length is at least the configured baseline (default 6 months); shorter contracts receive a proportional (pro-rated) discount and coins. First-time contracts only; residents can refer unlimited friends.",
  detailsVi:
    "Nhập mã giới thiệu của cư dân hiện tại khi đăng ký. Mức thưởng đủ khi thời hạn hợp đồng mới đạt số tháng cơ sở (mặc định 6 tháng); hợp đồng ngắn hơn được giảm và coin theo tỷ lệ. Chỉ hợp đồng lần đầu; cư dân giới thiệu không giới hạn số người.",
  hostelEnabled: true,
  hostelNewRegistrantDiscountVnd: 300_000,
  hostelNewRegistrantCoins: 5_000,
  hostelReferrerCoins: 8_000,
  hostelHeadlineEn: "Same referral code works for hostel / short stays",
  hostelHeadlineVi: "Mã giới thiệu dùng được cho đặt phòng hostel / lưu trú ngắn",
  hostelDetailsEn:
    "Friends can enter your code on hostel.cozorohome.com when booking a paid stay. Rewards are pro-rated by stay length versus the same baseline months (nights ÷ 30).",
  hostelDetailsVi:
    "Bạn bè nhập mã của bạn khi đặt phòng tại hostel.cozorohome.com. Ưu đãi được chia theo tỷ lệ độ dài lưu trú so với số tháng cơ sở (đêm ÷ 30)."
};

async function ensureJsonFile<T>(filePath: string, fallback: T) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const file = await readFile(filePath, "utf8");
    return JSON.parse(file) as T;
  } catch {
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function readSettings(): Promise<ReferralProgramSettings> {
  return ensureJsonFile<ReferralProgramSettings>(settingsFilePath, DEFAULT_SETTINGS);
}

async function writeSettings(settings: ReferralProgramSettings) {
  await mkdir(path.dirname(settingsFilePath), { recursive: true });
  await writeFile(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

function referralSecret() {
  return process.env.REFERRAL_CODE_SECRET || "cozoro-referral-dev-secret-change-in-production";
}

/** Stable referral code for a resident email (shown in portal + shared with friends). */
export function computeReferralCodeForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const h = createHmac("sha256", referralSecret()).update(normalized).digest();
  let num = 0n;
  for (let i = 0; i < 8; i++) {
    num = (num << 8n) + BigInt(h[i] ?? 0);
  }
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += CODE_ALPHABET[Number(num % 32n)] ?? "2";
    num /= 32n;
  }
  return `CZ${out}`;
}

function isCurrentlyStaying(row: Record<string, string>) {
  return String(row[ACTIVE_STAYING_COLUMN] ?? "").trim() === "1";
}

export type ResolvedReferrer = {
  email: string;
  maHd: string;
  name: string;
};

/** Resolve a referral code to an active resident row (currently staying). */
export function resolveReferrerFromCode(
  rawCode: string,
  rows: Array<Record<string, string>>
): ResolvedReferrer | null {
  const code = rawCode.trim();
  if (!code) {
    return null;
  }
  const upper = code.toUpperCase();

  for (const row of rows) {
    if (!isCurrentlyStaying(row)) {
      continue;
    }
    const email = row[EMAIL_COLUMN]?.trim().toLowerCase();
    if (!email) {
      continue;
    }
    const maHd = String(row[CONTRACT_CODE_COLUMN] ?? "").trim();
    if (maHd && (maHd === code || maHd.toUpperCase() === upper)) {
      return {
        email,
        maHd,
        name: String(row[CLIENT_NAME_COLUMN] ?? "").trim() || email
      };
    }
  }

  for (const row of rows) {
    if (!isCurrentlyStaying(row)) {
      continue;
    }
    const email = row[EMAIL_COLUMN]?.trim().toLowerCase();
    if (!email) {
      continue;
    }
    if (computeReferralCodeForEmail(email).toUpperCase() === upper) {
      return {
        email,
        maHd: String(row[CONTRACT_CODE_COLUMN] ?? "").trim(),
        name: String(row[CLIENT_NAME_COLUMN] ?? "").trim() || email
      };
    }
  }

  return null;
}

function clampBasisMonths(value: number) {
  return Math.min(36, Math.max(1, Math.trunc(value)));
}

/** Pro-rate full-offer amounts by effective contract length vs baseline months (cap at 100%). */
export function scaleReferralAmounts(params: {
  baseDiscountVnd: number;
  newUserCoins: number;
  referrerCoins: number;
  /** Effective contract months (e.g. long-term months, or nights/30 for hostel). */
  effectiveMonths: number;
  basisMonths: number;
}): { discountVnd: number; newUserCoins: number; referrerCoins: number; scale: number } {
  const basis = clampBasisMonths(params.basisMonths);
  const months = Math.max(0, params.effectiveMonths);
  const scale = Math.min(1, months / basis);
  const discountVnd = Math.floor(Math.max(0, params.baseDiscountVnd) * scale);
  const newUserCoins = Math.floor(Math.max(0, params.newUserCoins) * scale);
  const referrerCoins = Math.floor(Math.max(0, params.referrerCoins) * scale);
  return { discountVnd, newUserCoins, referrerCoins, scale };
}

export async function getReferralProgramSettings(): Promise<ReferralProgramSettings> {
  const s = await readSettings();
  const merged: ReferralProgramSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    fullOfferContractMonths: clampBasisMonths(s.fullOfferContractMonths ?? DEFAULT_SETTINGS.fullOfferContractMonths),
    newRegistrantDiscountVnd: Math.max(0, Math.trunc(s.newRegistrantDiscountVnd ?? 0)),
    newRegistrantCoins: Math.max(0, Math.trunc(s.newRegistrantCoins ?? 0)),
    referrerCoins: Math.max(0, Math.trunc(s.referrerCoins ?? 0)),
    hostelNewRegistrantDiscountVnd: Math.max(0, Math.trunc(s.hostelNewRegistrantDiscountVnd ?? DEFAULT_SETTINGS.hostelNewRegistrantDiscountVnd)),
    hostelNewRegistrantCoins: Math.max(0, Math.trunc(s.hostelNewRegistrantCoins ?? DEFAULT_SETTINGS.hostelNewRegistrantCoins)),
    hostelReferrerCoins: Math.max(0, Math.trunc(s.hostelReferrerCoins ?? DEFAULT_SETTINGS.hostelReferrerCoins)),
    enabled: Boolean(s.enabled),
    hostelEnabled: s.hostelEnabled !== undefined ? Boolean(s.hostelEnabled) : DEFAULT_SETTINGS.hostelEnabled,
    headlineEn: s.headlineEn ?? DEFAULT_SETTINGS.headlineEn,
    headlineVi: s.headlineVi ?? DEFAULT_SETTINGS.headlineVi,
    detailsEn: s.detailsEn ?? DEFAULT_SETTINGS.detailsEn,
    detailsVi: s.detailsVi ?? DEFAULT_SETTINGS.detailsVi,
    hostelHeadlineEn: s.hostelHeadlineEn ?? DEFAULT_SETTINGS.hostelHeadlineEn,
    hostelHeadlineVi: s.hostelHeadlineVi ?? DEFAULT_SETTINGS.hostelHeadlineVi,
    hostelDetailsEn: s.hostelDetailsEn ?? DEFAULT_SETTINGS.hostelDetailsEn,
    hostelDetailsVi: s.hostelDetailsVi ?? DEFAULT_SETTINGS.hostelDetailsVi
  };
  return merged;
}

export async function getReferralProgramPublicMarketing() {
  const s = await getReferralProgramSettings();
  return {
    enabled: s.enabled,
    fullOfferContractMonths: s.fullOfferContractMonths,
    newRegistrantDiscountVnd: s.newRegistrantDiscountVnd,
    newRegistrantCoins: s.newRegistrantCoins,
    referrerCoins: s.referrerCoins,
    headlineEn: s.headlineEn,
    headlineVi: s.headlineVi,
    detailsEn: s.detailsEn,
    detailsVi: s.detailsVi,
    hostelEnabled: s.hostelEnabled,
    hostelNewRegistrantDiscountVnd: s.hostelNewRegistrantDiscountVnd,
    hostelNewRegistrantCoins: s.hostelNewRegistrantCoins,
    hostelReferrerCoins: s.hostelReferrerCoins,
    hostelHeadlineEn: s.hostelHeadlineEn,
    hostelHeadlineVi: s.hostelHeadlineVi,
    hostelDetailsEn: s.hostelDetailsEn,
    hostelDetailsVi: s.hostelDetailsVi
  };
}

export async function updateReferralProgramSettings(input: {
  actorEmail: string;
  settings: Partial<ReferralProgramSettings>;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["manager", "owner", "app_admin"],
    "Only staff can update referral program settings."
  );

  const current = await getReferralProgramSettings();
  const next: ReferralProgramSettings = {
    ...current,
    ...input.settings,
    fullOfferContractMonths: clampBasisMonths(
      input.settings.fullOfferContractMonths ?? current.fullOfferContractMonths
    ),
    newRegistrantDiscountVnd: Math.max(
      0,
      Math.trunc(
        input.settings.newRegistrantDiscountVnd ?? current.newRegistrantDiscountVnd
      )
    ),
    newRegistrantCoins: Math.max(
      0,
      Math.trunc(input.settings.newRegistrantCoins ?? current.newRegistrantCoins)
    ),
    referrerCoins: Math.max(0, Math.trunc(input.settings.referrerCoins ?? current.referrerCoins)),
    hostelNewRegistrantDiscountVnd: Math.max(
      0,
      Math.trunc(input.settings.hostelNewRegistrantDiscountVnd ?? current.hostelNewRegistrantDiscountVnd)
    ),
    hostelNewRegistrantCoins: Math.max(
      0,
      Math.trunc(input.settings.hostelNewRegistrantCoins ?? current.hostelNewRegistrantCoins)
    ),
    hostelReferrerCoins: Math.max(
      0,
      Math.trunc(input.settings.hostelReferrerCoins ?? current.hostelReferrerCoins)
    ),
    enabled: input.settings.enabled ?? current.enabled,
    hostelEnabled: input.settings.hostelEnabled ?? current.hostelEnabled,
    headlineEn: input.settings.headlineEn ?? current.headlineEn,
    headlineVi: input.settings.headlineVi ?? current.headlineVi,
    detailsEn: input.settings.detailsEn ?? current.detailsEn,
    detailsVi: input.settings.detailsVi ?? current.detailsVi,
    hostelHeadlineEn: input.settings.hostelHeadlineEn ?? current.hostelHeadlineEn,
    hostelHeadlineVi: input.settings.hostelHeadlineVi ?? current.hostelHeadlineVi,
    hostelDetailsEn: input.settings.hostelDetailsEn ?? current.hostelDetailsEn,
    hostelDetailsVi: input.settings.hostelDetailsVi ?? current.hostelDetailsVi
  };

  await writeSettings(next);
  return next;
}

export type ReferralResolution =
  | {
      ok: true;
      discountVnd: number;
      newUserCoins: number;
      referrerCoins: number;
      referrer: ResolvedReferrer;
      scale: number;
      basisMonths: number;
      effectiveMonths: number;
    }
  | { ok: false; error: string };

async function coreReferralResolve(params: {
  registrantEmail: string;
  referralCode?: string;
  product: ReferralProduct;
  /** Long-term: integer months from contract. Hostel: nights/30. */
  effectiveMonths: number;
}): Promise<ReferralResolution> {
  const settings = await getReferralProgramSettings();
  const code = params.referralCode?.trim();

  if (!code) {
    return { ok: false, error: "no_code" };
  }

  if (!settings.enabled) {
    return { ok: false, error: "Referral program is not active." };
  }

  if (params.product === "hostel" && !settings.hostelEnabled) {
    return { ok: false, error: "Hostel referral rewards are not active." };
  }

  const cache = await readCachedClients();
  const rows = cache?.rows ?? [];
  const registrantEmail = params.registrantEmail.trim().toLowerCase();

  const anyRow = rows.some((row) => row[EMAIL_COLUMN]?.trim().toLowerCase() === registrantEmail);
  if (anyRow) {
    return {
      ok: false,
      error:
        "Referral rewards apply only to first-time registrations (this email already has a record)."
    };
  }

  const referrer = resolveReferrerFromCode(code, rows);
  if (!referrer) {
    return { ok: false, error: "Invalid referral code or referrer is not an active resident." };
  }

  if (referrer.email === registrantEmail) {
    return { ok: false, error: "You cannot use your own referral code." };
  }

  const basisMonths = settings.fullOfferContractMonths;
  const baseDiscount =
    params.product === "hostel" ? settings.hostelNewRegistrantDiscountVnd : settings.newRegistrantDiscountVnd;
  const baseNew = params.product === "hostel" ? settings.hostelNewRegistrantCoins : settings.newRegistrantCoins;
  const baseRef = params.product === "hostel" ? settings.hostelReferrerCoins : settings.referrerCoins;

  const scaled = scaleReferralAmounts({
    baseDiscountVnd: baseDiscount,
    newUserCoins: baseNew,
    referrerCoins: baseRef,
    effectiveMonths: params.effectiveMonths,
    basisMonths
  });

  return {
    ok: true,
    discountVnd: scaled.discountVnd,
    newUserCoins: scaled.newUserCoins,
    referrerCoins: scaled.referrerCoins,
    referrer,
    scale: scaled.scale,
    basisMonths,
    effectiveMonths: params.effectiveMonths
  };
}

/** Server-side validation for long-term /register (do not trust client amounts). */
export async function resolveReferralForNewRegistration(input: {
  registrantEmail: string;
  referralCode?: string;
  contractMonths: number;
}): Promise<ReferralResolution> {
  const months = Math.max(0, Number(input.contractMonths) || 0);
  return coreReferralResolve({
    registrantEmail: input.registrantEmail,
    referralCode: input.referralCode,
    product: "long_term",
    effectiveMonths: months
  });
}

/** Paid hostel / short-term import — effective length from nights (nights/30 months). */
export async function resolveReferralForHostelImport(input: {
  guestEmail: string;
  referralCode?: string;
  nights: number;
}): Promise<ReferralResolution> {
  const nights = Math.max(0, Math.floor(Number(input.nights) || 0));
  const effectiveMonths = nights / 30;
  return coreReferralResolve({
    registrantEmail: input.guestEmail,
    referralCode: input.referralCode,
    product: "hostel",
    effectiveMonths
  });
}

export type ReferralQuoteResult =
  | {
      ok: true;
      referrerNameHint: string;
      basisMonths: number;
      scale: number;
      effectiveMonths: number;
      discountVnd: number;
      newRegistrantCoins: number;
      referrerCoins: number;
    }
  | { ok: false; error: string };

/** Public quote for UI (validates code + active referrer; does not check registrant email). */
export async function quoteReferralOffer(input: {
  code: string;
  product: ReferralProduct;
  contractMonths?: number;
  nights?: number;
}): Promise<ReferralQuoteResult> {
  const settings = await getReferralProgramSettings();
  const code = input.code.trim();
  if (!code) {
    return { ok: false, error: "code is required" };
  }
  if (!settings.enabled) {
    return { ok: false, error: "Referral program is not active." };
  }
  if (input.product === "hostel" && !settings.hostelEnabled) {
    return { ok: false, error: "Hostel referral is not active." };
  }

  const cache = await readCachedClients();
  const referrer = resolveReferrerFromCode(code, cache?.rows ?? []);
  if (!referrer) {
    return { ok: false, error: "Invalid referral code or referrer is not an active resident." };
  }

  const basisMonths = settings.fullOfferContractMonths;
  let effectiveMonths = 0;
  if (input.product === "long_term") {
    effectiveMonths = Math.max(0, Number(input.contractMonths) || 0);
  } else {
    const nights = Math.max(0, Math.floor(Number(input.nights) || 0));
    effectiveMonths = nights / 30;
  }

  const baseDiscount =
    input.product === "hostel" ? settings.hostelNewRegistrantDiscountVnd : settings.newRegistrantDiscountVnd;
  const baseNew = input.product === "hostel" ? settings.hostelNewRegistrantCoins : settings.newRegistrantCoins;
  const baseRef = input.product === "hostel" ? settings.hostelReferrerCoins : settings.referrerCoins;

  const scaled = scaleReferralAmounts({
    baseDiscountVnd: baseDiscount,
    newUserCoins: baseNew,
    referrerCoins: baseRef,
    effectiveMonths,
    basisMonths
  });

  const name = referrer.name.trim();
  const referrerNameHint = name.length > 2 ? `${name.slice(0, 1)}***${name.slice(-1)}` : "***";

  return {
    ok: true,
    referrerNameHint,
    basisMonths,
    scale: scaled.scale,
    effectiveMonths,
    discountVnd: scaled.discountVnd,
    newRegistrantCoins: scaled.newUserCoins,
    referrerCoins: scaled.referrerCoins
  };
}
