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

export type ReferralProgramSettings = {
  enabled: boolean;
  /** One-time discount applied to deposit (VND) for the new resident's first registration. */
  newRegistrantDiscountVnd: number;
  newRegistrantCoins: number;
  referrerCoins: number;
  headlineEn: string;
  headlineVi: string;
  detailsEn: string;
  detailsVi: string;
};

const DEFAULT_SETTINGS: ReferralProgramSettings = {
  enabled: true,
  newRegistrantDiscountVnd: 500_000,
  newRegistrantCoins: 10_000,
  referrerCoins: 15_000,
  headlineEn: "Refer a friend — rewards for both of you",
  headlineVi: "Giới thiệu bạn — ưu đãi cho cả hai",
  detailsEn:
    "Enter a current resident's referral code on registration. First-time contracts only; residents can refer unlimited friends.",
  detailsVi:
    "Nhập mã giới thiệu của cư dân đang ở khi đăng ký. Chỉ áp dụng hợp đồng lần đầu; cư dân giới thiệu không giới hạn số người."
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

export async function getReferralProgramSettings(): Promise<ReferralProgramSettings> {
  const s = await readSettings();
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    newRegistrantDiscountVnd: Math.max(0, Math.trunc(s.newRegistrantDiscountVnd ?? 0)),
    newRegistrantCoins: Math.max(0, Math.trunc(s.newRegistrantCoins ?? 0)),
    referrerCoins: Math.max(0, Math.trunc(s.referrerCoins ?? 0)),
    enabled: Boolean(s.enabled)
  };
}

export async function getReferralProgramPublicMarketing() {
  const s = await getReferralProgramSettings();
  return {
    enabled: s.enabled,
    newRegistrantDiscountVnd: s.newRegistrantDiscountVnd,
    newRegistrantCoins: s.newRegistrantCoins,
    referrerCoins: s.referrerCoins,
    headlineEn: s.headlineEn,
    headlineVi: s.headlineVi,
    detailsEn: s.detailsEn,
    detailsVi: s.detailsVi
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
    enabled: input.settings.enabled ?? current.enabled,
    headlineEn: input.settings.headlineEn ?? current.headlineEn,
    headlineVi: input.settings.headlineVi ?? current.headlineVi,
    detailsEn: input.settings.detailsEn ?? current.detailsEn,
    detailsVi: input.settings.detailsVi ?? current.detailsVi
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
    }
  | { ok: false; error: string };

/** Server-side validation for registration (do not trust client amounts). */
export async function resolveReferralForNewRegistration(input: {
  registrantEmail: string;
  referralCode?: string;
}): Promise<ReferralResolution> {
  const settings = await getReferralProgramSettings();
  const code = input.referralCode?.trim();

  if (!code) {
    return { ok: false, error: "no_code" };
  }

  if (!settings.enabled) {
    return { ok: false, error: "Referral program is not active." };
  }

  const cache = await readCachedClients();
  const rows = cache?.rows ?? [];
  const registrantEmail = input.registrantEmail.trim().toLowerCase();

  const anyRow = rows.some((row) => row[EMAIL_COLUMN]?.trim().toLowerCase() === registrantEmail);
  if (anyRow) {
    return { ok: false, error: "Referral rewards apply only to first-time registrations (this email already has a record)." };
  }

  const referrer = resolveReferrerFromCode(code, rows);
  if (!referrer) {
    return { ok: false, error: "Invalid referral code or referrer is not an active resident." };
  }

  if (referrer.email === registrantEmail) {
    return { ok: false, error: "You cannot use your own referral code." };
  }

  return {
    ok: true,
    discountVnd: settings.newRegistrantDiscountVnd,
    newUserCoins: settings.newRegistrantCoins,
    referrerCoins: settings.referrerCoins,
    referrer
  };
}
