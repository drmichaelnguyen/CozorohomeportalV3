const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs/promises");
const { promisify } = require("util");
const { randomUUID, randomBytes, createHash, scrypt: scryptCallback, timingSafeEqual } = require("crypto");
const mysql = require("mysql2/promise");
const Stripe = require("stripe");
const heicConvert = require("heic-convert");
const sharp = require("sharp");
const {
  isBranchClosedForNewRegistrations,
  getBranchRegistrationClosedError,
  getD2ClosureNotice,
  D2_NEW_REGISTRATION_CLOSED,
  D2_PERMANENT_CLOSURE_DATE
} = require("./branch-closure");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 3100);
const SITE_TITLE = process.env.SITE_TITLE || "CozoroHome Guest Booking";
const DEFAULT_BRANCH = normalizeBranch(process.env.DEFAULT_BRANCH || "D7");
const CLIENT_CACHE_PATH = path.resolve(__dirname, process.env.CLIENT_CACHE_PATH || "../api/data/clients-cache.json");
const BOOKING_TABLE_NAME = process.env.BOOKING_TABLE_NAME || "guest_stay_bookings";
const DATABASE_URL = process.env.DATABASE_URL || "";
const SITE_URL = process.env.SITE_URL || process.env.ONLINE_URL || `http://localhost:${PORT}`;
const MAIN_APP_API_URL = String(process.env.MAIN_APP_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const MAIN_APP_API_KEY = String(process.env.INTERNAL_API_KEY || process.env.MAIN_APP_API_KEY || "").trim();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const ID_PHOTO_DIR = path.resolve(__dirname, "data", "id-photos");
const FACE_CAPTURE_DIR = path.resolve(__dirname, "data", "face-captures");
const GALLERY_SOURCE_DIR = path.resolve(__dirname, "cozoroimages");
const DEPOSIT_AMOUNT = 1000000;
const FACE_CAPTURE_WINDOW_HOURS = 48;
const BIO_SEX_RULES = {
  female: new Set(["Floor 1", "Floor 3"]),
  male: new Set(["Floor 2"])
};
const BRANCH_LAYOUTS = {
  D2: [
    { roomCode: "1", floorLabel: "D2", startBed: 1, endBed: 9 },
    { roomCode: "2", floorLabel: "D2", startBed: 10, endBed: 15 },
    { roomCode: "3", floorLabel: "D2", startBed: 16, endBed: 21 }
  ],
  D7: [
    { roomCode: "1.1", floorLabel: "Floor 1", startBed: 1, endBed: 9 },
    { roomCode: "1.2", floorLabel: "Floor 1", startBed: 10, endBed: 15 },
    { roomCode: "1.3", floorLabel: "Floor 1", startBed: 16, endBed: 24 },
    { roomCode: "2.1", floorLabel: "Floor 2", startBed: 25, endBed: 33 },
    { roomCode: "2.2", floorLabel: "Floor 2", startBed: 34, endBed: 39 },
    { roomCode: "2.3", floorLabel: "Floor 2", startBed: 40, endBed: 48 },
    { roomCode: "3.1", floorLabel: "Floor 3", startBed: 49, endBed: 57 },
    { roomCode: "3.2", floorLabel: "Floor 3", startBed: 58, endBed: 63 }
  ]
};

const BRANCH_DETAILS = {
  D2: {
    shortAddress: "491 Hau Giang, Ward 11, District 6",
    fullAddress: "491 Hau Giang, Ward 11, District 6"
  },
  D7: {
    shortAddress: "7a/19 Thanh Thai, Ward 14, District 10, Ho Chi Minh City",
    fullAddress: "7a/19/28 Thanh Thai, Ward 14, district 10. The alley next to CashFlow Coffee"
  }
};

const DEFAULT_SHORT_TERM_CONFIG = {
  currency: "VND",
  fallbackNightlyPrice: 221425,
  bedPricing: {},
  bedPricingByDate: {},
  discounts: {
    weekly: { enabled: true, minNights: 7, percent: 10 },
    monthly: { enabled: true, minNights: 30, percent: 20 }
  },
  minimumStay: 1
};
const SHORT_TERM_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedShortTermConfig = null;
let cachedShortTermConfigAt = 0;
let cachedGalleryManifest = null;
let cachedGalleryManifestAt = 0;
const GALLERY_MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
const galleryImageCache = new Map();
const GALLERY_MAX_WIDTH = 1600;
const GALLERY_JPEG_QUALITY = 78;
const GUEST_AUTH_PATH = path.resolve(__dirname, "data", "guest-auth.json");
const GUEST_ACCOUNT_PATH = path.resolve(__dirname, "data", "guest-accounts.json");
const RECENT_GUEST_PROFILE_PATH = path.resolve(__dirname, "data", "recent-guest-profiles.json");
const GUEST_AUTH_CODE_TTL_MS = 15 * 60 * 1000;
const GUEST_AUTH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const GUEST_ACCOUNT_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const RECENT_GUEST_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FULL_REFUND_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const CANCELLABLE_REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;
const NON_REFUNDABLE_EXTRA_DISCOUNT_PERCENT = 10;
const scrypt = promisify(scryptCallback);

let pool = null;

function normalizeDiscountRule(rule, fallback) {
  const candidate = rule && typeof rule === "object" ? rule : {};
  const minNights = Number(candidate.minNights);
  const percent = Number(candidate.percent);

  return {
    enabled: candidate.enabled === undefined ? fallback.enabled : Boolean(candidate.enabled),
    minNights: Number.isFinite(minNights) && minNights > 0 ? Math.floor(minNights) : fallback.minNights,
    percent: Number.isFinite(percent) && percent >= 0 ? percent : fallback.percent
  };
}

function normalizeShortTermConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const bedPricing = source.bedPricing && typeof source.bedPricing === "object" ? source.bedPricing : {};
  const bedPricingByDate = source.bedPricingByDate && typeof source.bedPricingByDate === "object" ? source.bedPricingByDate : {};
  const discounts = source.discounts && typeof source.discounts === "object" ? source.discounts : {};
  const minimumStay = Number(source.minimumStay);

  return {
    currency: DEFAULT_SHORT_TERM_CONFIG.currency,
    fallbackNightlyPrice: DEFAULT_SHORT_TERM_CONFIG.fallbackNightlyPrice,
    bedPricing,
    bedPricingByDate,
    discounts: {
      weekly: normalizeDiscountRule(discounts.weekly, DEFAULT_SHORT_TERM_CONFIG.discounts.weekly),
      monthly: normalizeDiscountRule(discounts.monthly, DEFAULT_SHORT_TERM_CONFIG.discounts.monthly)
    },
    minimumStay: Number.isFinite(minimumStay) && minimumStay > 0 ? Math.floor(minimumStay) : DEFAULT_SHORT_TERM_CONFIG.minimumStay
  };
}

function normalizeGalleryBranch(branchId) {
  const normalized = normalizeBranch(branchId);
  return normalized === "D2" || normalized === "D7" ? normalized : null;
}

function isSupportedGalleryFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(ext);
}

function isHeicGalleryFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

function buildGalleryBranchDescription(branchId) {
  if (branchId === "D2") {
    return "D2 shared living with bright bunk-bed rooms, lockers, and roomy common spaces.";
  }

  return "D7 hostel-style living with smart door lock entry, camera security, kitchen access, laundry, and app controls.";
}

async function listGalleryImages(branchId) {
  const normalizedBranch = normalizeGalleryBranch(branchId);
  if (!normalizedBranch) {
    return [];
  }

  const branchDir = path.join(GALLERY_SOURCE_DIR, normalizedBranch);
  let entries = [];
  try {
    entries = await fs.readdir(branchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && isSupportedGalleryFile(entry.name) && !/-Michael’s Mac/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

async function getGalleryManifest() {
  const now = Date.now();
  if (cachedGalleryManifest && now - cachedGalleryManifestAt < GALLERY_MANIFEST_CACHE_TTL_MS) {
    return cachedGalleryManifest;
  }

  const branches = await Promise.all(["D2", "D7"].map(async (branchId) => {
    const files = await listGalleryImages(branchId);
    const images = files.map((fileName, index) => ({
      fileName,
      src: `/api/gallery-image/${encodeURIComponent(branchId)}/${encodeURIComponent(fileName)}`,
      alt: `${branchId} gallery image ${index + 1}`,
      title: `${branchId} photo ${index + 1}`
    }));

    return {
      branchId,
      title: branchId === "D2" ? "D2 shared living" : "D7 hostel stay",
      description: buildGalleryBranchDescription(branchId),
      images
    };
  }));

  cachedGalleryManifest = { branches };
  cachedGalleryManifestAt = now;
  return cachedGalleryManifest;
}

async function getGalleryImageBuffer(branchId, fileName) {
  const normalizedBranch = normalizeGalleryBranch(branchId);
  if (!normalizedBranch || !fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("Invalid gallery image path.");
  }

  const sourcePath = path.join(GALLERY_SOURCE_DIR, normalizedBranch, fileName);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    throw new Error("Gallery image not found.");
  }

  const cacheKey = `${sourcePath}:${stat.mtimeMs}`;
  if (galleryImageCache.has(cacheKey)) {
    return galleryImageCache.get(cacheKey);
  }

  const inputBuffer = await fs.readFile(sourcePath);
  const ext = path.extname(fileName).toLowerCase();
  const resizedBuffer = isHeicGalleryFile(fileName)
    ? Buffer.from(await heicConvert({ buffer: inputBuffer, format: "JPEG", quality: 0.88 }))
    : await sharp(inputBuffer)
        .rotate()
        .resize({ width: GALLERY_MAX_WIDTH, withoutEnlargement: true })
        .toBuffer();

  const resizePipeline = sharp(resizedBuffer).rotate().resize({ width: GALLERY_MAX_WIDTH, withoutEnlargement: true });
  const payload = {
    buffer: await (async () => {
      if (isHeicGalleryFile(fileName) || ext === ".jpg" || ext === ".jpeg" || ext === "") {
        return resizePipeline.jpeg({ quality: GALLERY_JPEG_QUALITY, mozjpeg: true }).toBuffer();
      }

      if (ext === ".png") {
        return resizePipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      }

      if (ext === ".webp") {
        return resizePipeline.webp({ quality: 80 }).toBuffer();
      }

      return resizePipeline.jpeg({ quality: GALLERY_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    })(),
    contentType: isHeicGalleryFile(fileName) || ext === ".jpg" || ext === ".jpeg" || ext === ""
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg"
  };
  galleryImageCache.set(cacheKey, payload);
  return payload;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCancellationPolicy(value) {
  return String(value || "").trim().toLowerCase() === "non_refundable" ? "non_refundable" : "cancellable";
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function getCancellationPolicyDiscountPercent(policy) {
  return normalizeCancellationPolicy(policy) === "non_refundable" ? NON_REFUNDABLE_EXTRA_DISCOUNT_PERCENT : 0;
}

function hashValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function createGuestAuthCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createGuestAuthToken() {
  return randomBytes(24).toString("hex");
}

function createGuestSessionToken() {
  return randomBytes(32).toString("hex");
}

async function readGuestAccountFile() {
  try {
    const raw = await fs.readFile(GUEST_ACCOUNT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  } catch {
    return { accounts: [], sessions: [] };
  }
}

async function writeGuestAccountFile(file) {
  await fs.mkdir(path.dirname(GUEST_ACCOUNT_PATH), { recursive: true });
  await fs.writeFile(GUEST_ACCOUNT_PATH, JSON.stringify(file, null, 2), "utf8");
}

async function readRecentGuestProfileFile() {
  try {
    const raw = await fs.readFile(RECENT_GUEST_PROFILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : []
    };
  } catch {
    return { profiles: [] };
  }
}

async function writeRecentGuestProfileFile(file) {
  await fs.mkdir(path.dirname(RECENT_GUEST_PROFILE_PATH), { recursive: true });
  await fs.writeFile(RECENT_GUEST_PROFILE_PATH, JSON.stringify(file, null, 2), "utf8");
}

function getRequesterIp(req) {
  const forwardedFor = String(req.get("x-forwarded-for") || "").trim();
  const candidate = forwardedFor ? forwardedFor.split(",")[0].trim() : (req.ip || req.socket?.remoteAddress || "");
  return String(candidate || "").replace(/^::ffff:/, "").trim() || "unknown";
}

function normalizeRecentGuestProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  const isVietnamese = normalizeBoolean(source.isVietnamese);
  const bioSex = normalizeBioSex(source.bioSex || "");
  const branchId = normalizeBranchChoice(source.branchId);
  const guestName = String(source.guestName || "").trim();
  const guestEmail = normalizeEmail(source.guestEmail || "");
  const guestPhone = String(source.guestPhone || "").trim();
  const notes = String(source.notes || "").trim();
  const cancellationPolicy = normalizeCancellationPolicy(source.cancellationPolicy);

  return {
    guestName,
    guestEmail,
    guestPhone,
    notes,
    isVietnamese,
    bioSex,
    branchId,
    cancellationPolicy
  };
}

function hasMeaningfulRecentGuestProfile(profile) {
  return Boolean(
    profile &&
    (
      profile.guestName ||
      profile.guestEmail ||
      profile.guestPhone ||
      profile.notes ||
      profile.bioSex ||
      profile.branchId ||
      profile.isVietnamese ||
      profile.cancellationPolicy
    )
  );
}

async function getRecentGuestProfile(req) {
  const file = await readRecentGuestProfileFile();
  const now = Date.now();
  const key = hashValue(getRequesterIp(req));
  const activeProfiles = file.profiles.filter((entry) => new Date(entry.expiresAt).getTime() > now);

  if (activeProfiles.length !== file.profiles.length) {
    await writeRecentGuestProfileFile({ profiles: activeProfiles });
  }

  return activeProfiles.find((entry) => entry.key === key) || null;
}

async function saveRecentGuestProfile(req, input) {
  const profile = normalizeRecentGuestProfile(input);
  const file = await readRecentGuestProfileFile();
  const now = Date.now();
  const key = hashValue(getRequesterIp(req));
  const activeProfiles = file.profiles.filter((entry) => entry.key !== key && new Date(entry.expiresAt).getTime() > now);

  if (!hasMeaningfulRecentGuestProfile(profile)) {
    await writeRecentGuestProfileFile({ profiles: activeProfiles });
    return null;
  }

  const expiresAt = new Date(now + RECENT_GUEST_PROFILE_TTL_MS).toISOString();
  const entry = {
    key,
    profile,
    updatedAt: new Date(now).toISOString(),
    expiresAt
  };

  activeProfiles.push(entry);
  await writeRecentGuestProfileFile({ profiles: activeProfiles });
  return entry;
}

async function hashGuestPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return {
    salt,
    hash: Buffer.from(derivedKey).toString("hex")
  };
}

async function verifyGuestPassword(password, salt, expectedHash) {
  const derivedKey = await scrypt(password, salt, 64);
  const actualHash = Buffer.from(derivedKey);
  const targetHash = Buffer.from(expectedHash, "hex");
  if (actualHash.length !== targetHash.length) {
    return false;
  }
  return timingSafeEqual(actualHash, targetHash);
}

async function getGuestAccountByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const accountFile = await readGuestAccountFile();
  return accountFile.accounts.find((entry) => normalizeEmail(entry.email) === normalizedEmail) || null;
}

async function createGuestAccount(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const secret = String(password || "");
  if (!normalizedEmail || !secret) {
    throw new Error("email and password are required.");
  }

  if (secret.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const accountFile = await readGuestAccountFile();
  const now = Date.now();
  const existing = accountFile.accounts.find((entry) => normalizeEmail(entry.email) === normalizedEmail);
  if (existing) {
    throw new Error("An account already exists for this email. Please log in with your password.");
  }

  const passwordData = await hashGuestPassword(secret);
  const token = createGuestSessionToken();
  accountFile.accounts.push({
    email: normalizedEmail,
    passwordSalt: passwordData.salt,
    passwordHash: passwordData.hash,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    lastLoginAt: new Date(now).toISOString()
  });
  accountFile.sessions = accountFile.sessions.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  accountFile.sessions.push({
    email: normalizedEmail,
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_ACCOUNT_SESSION_TTL_MS).toISOString()
  });
  await writeGuestAccountFile(accountFile);
  return { email: normalizedEmail, token };
}

async function loginGuestAccount(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const secret = String(password || "");
  if (!normalizedEmail || !secret) {
    throw new Error("email and password are required.");
  }

  const accountFile = await readGuestAccountFile();
  const account = accountFile.accounts.find((entry) => normalizeEmail(entry.email) === normalizedEmail);
  if (!account) {
    throw new Error("No account found for that email. Please create one first.");
  }

  const valid = await verifyGuestPassword(secret, account.passwordSalt, account.passwordHash);
  if (!valid) {
    throw new Error("Incorrect password.");
  }

  const now = Date.now();
  account.updatedAt = new Date(now).toISOString();
  account.lastLoginAt = new Date(now).toISOString();
  accountFile.sessions = accountFile.sessions.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  const token = createGuestSessionToken();
  accountFile.sessions.push({
    email: normalizedEmail,
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_ACCOUNT_SESSION_TTL_MS).toISOString()
  });
  await writeGuestAccountFile(accountFile);
  return { email: normalizedEmail, token };
}

async function validateGuestAccountSession(email, token) {
  const normalizedEmail = normalizeEmail(email);
  const sessionToken = String(token || "").trim();
  if (!normalizedEmail || !sessionToken) {
    return false;
  }

  const accountFile = await readGuestAccountFile();
  const now = Date.now();
  return Boolean(accountFile.sessions.find(
    (entry) =>
      normalizeEmail(entry.email) === normalizedEmail &&
      entry.token === sessionToken &&
      new Date(entry.expiresAt).getTime() > now
  ));
}

async function readGuestAuthFile() {
  try {
    const raw = await fs.readFile(GUEST_AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      verified: Array.isArray(parsed.verified) ? parsed.verified : []
    };
  } catch {
    return { pending: [], verified: [] };
  }
}

async function writeGuestAuthFile(file) {
  await fs.mkdir(path.dirname(GUEST_AUTH_PATH), { recursive: true });
  await fs.writeFile(GUEST_AUTH_PATH, JSON.stringify(file, null, 2), "utf8");
}

async function sendGuestAuthCodeEmail(email, code, trapValue = "") {
  const response = await fetch(`${MAIN_APP_API_URL}/internal/guest-auth/send-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MAIN_APP_API_KEY ? { "x-internal-api-key": MAIN_APP_API_KEY } : {})
    },
    body: JSON.stringify({
      email,
      code,
      siteTitle: SITE_TITLE,
      website: trapValue
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Unable to send verification email (${response.status}): ${payload}`);
  }
}

async function issueGuestAuthCode(email, trapValue = "") {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("A valid email is required.");
  }

  if (String(trapValue || "").trim()) {
    return { ok: true, skipped: true };
  }

  const authFile = await readGuestAuthFile();
  const code = createGuestAuthCode();
  const now = Date.now();
  authFile.pending = authFile.pending.filter((entry) => normalizeEmail(entry.email) !== normalizedEmail);
  authFile.pending.push({
    email: normalizedEmail,
    codeHash: hashValue(code),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_AUTH_CODE_TTL_MS).toISOString()
  });
  await writeGuestAuthFile(authFile);
  await sendGuestAuthCodeEmail(normalizedEmail, code, trapValue);
  return { ok: true };
}

async function verifyGuestAuthCode(email, code) {
  const normalizedEmail = normalizeEmail(email);
  const authCode = String(code || "").trim();

  if (!normalizedEmail || !authCode) {
    throw new Error("Email and verification code are required.");
  }

  const authFile = await readGuestAuthFile();
  const now = Date.now();
  authFile.pending = authFile.pending.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  const pendingEntry = authFile.pending.find((entry) => normalizeEmail(entry.email) === normalizedEmail);

  if (!pendingEntry || pendingEntry.codeHash !== hashValue(authCode)) {
    await writeGuestAuthFile(authFile);
    throw new Error("Invalid or expired verification code.");
  }

  authFile.pending = authFile.pending.filter((entry) => entry !== pendingEntry);
  const token = createGuestAuthToken();
  authFile.verified = authFile.verified.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  authFile.verified.push({
    email: normalizedEmail,
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_AUTH_TOKEN_TTL_MS).toISOString()
  });
  await writeGuestAuthFile(authFile);
  return { ok: true, token, email: normalizedEmail };
}

async function requireVerifiedGuest(email, token) {
  const normalizedEmail = normalizeEmail(email);
  const authToken = String(token || "").trim();

  if (!normalizedEmail || !authToken) {
    throw new Error("Account sign-in is required before booking.");
  }

  if (await validateGuestAccountSession(normalizedEmail, authToken)) {
    return { email: normalizedEmail, type: "account-session" };
  }
  throw new Error("Please sign in with your account password before booking.");
}

async function requireVerifiedEmailToken(email, token) {
  const normalizedEmail = normalizeEmail(email);
  const authToken = String(token || "").trim();

  if (!normalizedEmail || !authToken) {
    throw new Error("Email verification is required.");
  }

  const authFile = await readGuestAuthFile();
  const now = Date.now();
  const verified = authFile.verified.find(
    (entry) =>
      normalizeEmail(entry.email) === normalizedEmail &&
      entry.token === authToken &&
      new Date(entry.expiresAt).getTime() > now
  );

  if (!verified) {
    throw new Error("Please verify your email before creating an account.");
  }

  return { ...verified, type: "email-verification" };
}

function listStayDateKeys(checkIn, checkOut) {
  const { start, end } = ensureValidDateRange(checkIn, checkOut);
  const keys = [];
  for (let cursor = new Date(start.getTime()); cursor < end; cursor = new Date(cursor.getTime() + 86400000)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function getBedPricingEntry(config, branchId, bedNumber, dateKey = "") {
  const datePricing = dateKey
    ? config?.bedPricingByDate?.[branchId]?.[dateKey]
    : null;
  const dateValues = datePricing ? [datePricing[String(bedNumber)], datePricing[Number(bedNumber)], datePricing[bedNumber]] : [];
  for (const value of dateValues) {
    const nightlyPrice = Number(value);
    if (Number.isFinite(nightlyPrice) && nightlyPrice > 0) {
      return { nightlyPrice, source: `configured:${dateKey}` };
    }
  }

  const branchPricing = config?.bedPricing?.[branchId] || {};
  const values = [branchPricing[String(bedNumber)], branchPricing[Number(bedNumber)], branchPricing[bedNumber]];

  for (const value of values) {
    const nightlyPrice = Number(value);
    if (Number.isFinite(nightlyPrice) && nightlyPrice > 0) {
      return { nightlyPrice, source: "configured" };
    }
  }

  return { nightlyPrice: DEFAULT_SHORT_TERM_CONFIG.fallbackNightlyPrice, source: "fallback" };
}

function getNightlyPricesForStay(config, branchId, bedNumber, checkIn, checkOut) {
  const dates = listStayDateKeys(checkIn, checkOut);
  return dates.map((dateKey) => {
    const entry = getBedPricingEntry(config, branchId, bedNumber, dateKey);
    return { date: dateKey, nightlyPrice: entry.nightlyPrice, source: entry.source };
  });
}

async function getShortTermPricingConfig({ refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && cachedShortTermConfig && now - cachedShortTermConfigAt < SHORT_TERM_CONFIG_CACHE_TTL_MS) {
    return cachedShortTermConfig;
  }

  try {
    const response = await fetch(`${MAIN_APP_API_URL}/api/public/short-term-config`);
    if (!response.ok) {
      throw new Error(`Main app returned ${response.status}`);
    }
    const payload = await response.json();
    cachedShortTermConfig = normalizeShortTermConfig(payload);
    cachedShortTermConfigAt = now;
    return cachedShortTermConfig;
  } catch (error) {
    if (cachedShortTermConfig) {
      return cachedShortTermConfig;
    }
    cachedShortTermConfig = normalizeShortTermConfig(DEFAULT_SHORT_TERM_CONFIG);
    cachedShortTermConfigAt = now;
    return cachedShortTermConfig;
  }
}

/** Pro-rated hostel referral discount from main Cozoro API (requires MAIN_APP_API_URL). */
async function fetchHostelReferralQuote(code, nights) {
  const trimmed = String(code || "").trim();
  if (!trimmed) {
    return null;
  }
  const response = await fetch(`${MAIN_APP_API_URL}/api/public/referral/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: trimmed,
      product: "hostel",
      nights: Math.max(0, Math.floor(Number(nights) || 0))
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Referral quote failed.");
  }
  if (!data.ok) {
    throw new Error(data.error || "Invalid referral code.");
  }
  return data;
}

function calculatePricing(nights, nightlyPrice, pricingConfig, options = {}) {
  const normalizedNights = Number(nights);
  const stayNights = Number.isFinite(normalizedNights) && normalizedNights > 0 ? Math.floor(normalizedNights) : 0;
  const nightlyRate = Number(nightlyPrice);
  const nightlyRates = Array.isArray(options.nightlyPrices)
    ? options.nightlyPrices.map((rate) => Number(rate)).filter((rate) => Number.isFinite(rate) && rate > 0)
    : [];
  const config = normalizeShortTermConfig(pricingConfig || DEFAULT_SHORT_TERM_CONFIG);
  const cancellationPolicy = normalizeCancellationPolicy(options.cancellationPolicy);

  if ((!Number.isFinite(nightlyRate) || nightlyRate <= 0) && nightlyRates.length === 0) {
    throw new Error("Nightly price is not configured for the selected bed.");
  }

  if (stayNights < config.minimumStay) {
    throw new Error(`Minimum stay is ${config.minimumStay} nights.`);
  }

  const weeklyRule = config.discounts.weekly;
  const monthlyRule = config.discounts.monthly;
  let discountRule = null;

  if (monthlyRule.enabled && stayNights >= monthlyRule.minNights) {
    discountRule = monthlyRule;
  } else if (weeklyRule.enabled && stayNights >= weeklyRule.minNights) {
    discountRule = weeklyRule;
  }

  const effectiveNightlyRates = nightlyRates.length > 0 ? nightlyRates : Array.from({ length: stayNights }, () => nightlyRate);
  const subtotal = effectiveNightlyRates.reduce((sum, rate) => sum + rate, 0);
  const stayDiscountPercent = discountRule ? Number(discountRule.percent) || 0 : 0;
  const stayDiscountAmount = Math.round(subtotal * (stayDiscountPercent / 100));
  const cancellationDiscountPercent = getCancellationPolicyDiscountPercent(cancellationPolicy);
  const cancellationDiscountAmount = Math.round(subtotal * (cancellationDiscountPercent / 100));
  const discountPercent = stayDiscountPercent + cancellationDiscountPercent;
  const discountAmount = stayDiscountAmount + cancellationDiscountAmount;
  const depositAmount = DEPOSIT_AMOUNT;
  const stayTotal = subtotal - discountAmount;
  const nightlyRateAverage = stayNights > 0 ? Math.round(subtotal / stayNights) : nightlyRate;

  return {
    currency: config.currency,
    nightlyRate: nightlyRateAverage,
    nights: stayNights,
    cancellationPolicy,
    stayDiscountPercent,
    stayDiscountAmount,
    cancellationDiscountPercent,
    cancellationDiscountAmount,
    discountPercent,
    subtotal,
    discountAmount,
    depositAmount,
    stayTotal,
    total: stayTotal + depositAmount,
    minimumStay: config.minimumStay,
    discountType: discountRule === monthlyRule ? "monthly" : discountRule === weeklyRule ? "weekly" : "",
    nightlyPrices: effectiveNightlyRates
  };
}

function buildStoredPricingFromBooking(booking, pricingConfig) {
  const config = normalizeShortTermConfig(pricingConfig || DEFAULT_SHORT_TERM_CONFIG);
  const nights = Number(booking.nights) || nightsBetween(
    new Date(booking.check_in).toISOString().slice(0, 10),
    new Date(booking.check_out).toISOString().slice(0, 10)
  );
  const nightlyRate = Number(booking.nightly_rate);
  const subtotal = Number(booking.subtotal_amount);
  const discountPercent = Number(booking.discount_percent);
  const discountAmount = Number(booking.discount_amount);
  const depositAmount = Number(booking.deposit_amount);
  const total = Number(booking.total_amount);
  const stayDiscountPercent = Number(booking.stay_discount_percent);
  const stayDiscountAmount = Number(booking.stay_discount_amount);
  const cancellationDiscountPercent = Number(booking.cancellation_discount_percent);
  const cancellationDiscountAmount = Number(booking.cancellation_discount_amount);
  const cancellationPolicy = normalizeCancellationPolicy(booking.cancellation_policy);

  if (
    Number.isFinite(nightlyRate) && nightlyRate > 0 &&
    Number.isFinite(subtotal) && subtotal > 0 &&
    Number.isFinite(discountAmount) &&
    Number.isFinite(depositAmount) &&
    Number.isFinite(total) && total > 0
  ) {
    return {
      currency: (booking.currency || config.currency).toUpperCase(),
      nightlyRate,
      nights,
      cancellationPolicy,
      stayDiscountPercent: Number.isFinite(stayDiscountPercent) ? stayDiscountPercent : 0,
      stayDiscountAmount: Number.isFinite(stayDiscountAmount) ? stayDiscountAmount : 0,
      cancellationDiscountPercent: Number.isFinite(cancellationDiscountPercent) ? cancellationDiscountPercent : getCancellationPolicyDiscountPercent(cancellationPolicy),
      cancellationDiscountAmount: Number.isFinite(cancellationDiscountAmount) ? cancellationDiscountAmount : 0,
      discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
      subtotal,
      discountAmount,
      depositAmount,
      stayTotal: total - depositAmount,
      total,
      minimumStay: config.minimumStay,
      discountType: Number(discountPercent) === config.discounts.monthly.percent ? "monthly" : Number(discountPercent) === config.discounts.weekly.percent ? "weekly" : ""
    };
  }

  const bedPricing = getBedPricingEntry(config, booking.branch_id, booking.bed_number);
  return calculatePricing(nights, bedPricing.nightlyPrice, config, { cancellationPolicy });
}

function describeCancellationPolicy(policy) {
  return normalizeCancellationPolicy(policy) === "non_refundable"
    ? "Non-refundable stay rate with extra 10% stay discount. If cancelled, only the deposit is refunded after the 24-hour grace period."
    : "Cancellable stay. Full refund within 24 hours of booking, or until 48 hours before check-in. After that, only the deposit is refunded.";
}

function getBookingCancellationTerms(booking, pricingConfig = null, now = Date.now()) {
  const currentTime = Number.isFinite(now) ? now : Date.now();
  const pricing = buildStoredPricingFromBooking(booking, pricingConfig || DEFAULT_SHORT_TERM_CONFIG);
  const cancellationPolicy = normalizeCancellationPolicy(booking.cancellation_policy || pricing.cancellationPolicy);
  const createdAt = new Date(booking.created_at || Date.now()).getTime();
  const checkInAt = new Date(booking.check_in).getTime();
  const withinGracePeriod = Number.isFinite(createdAt) && currentTime <= createdAt + FULL_REFUND_GRACE_PERIOD_MS;
  const beforeCheckIn = Number.isFinite(checkInAt) && currentTime < checkInAt;
  const cancellableDeadlineAt = Number.isFinite(checkInAt)
    ? new Date(checkInAt - CANCELLABLE_REFUND_WINDOW_MS).toISOString()
    : null;
  const meetsCancellableWindow = Number.isFinite(checkInAt) && currentTime <= (checkInAt - CANCELLABLE_REFUND_WINDOW_MS);
  const depositRefundAmount = Number(pricing.depositAmount) || DEPOSIT_AMOUNT;
  const fullRefundAmount = Number(pricing.total) || 0;

  let refundType = "deposit_only";
  let refundableAmount = depositRefundAmount;
  let message = "Deposit refund only.";

  if (!beforeCheckIn) {
    refundType = "none";
    refundableAmount = 0;
    message = "Online cancellation is only available before check-in.";
  } else if (withinGracePeriod) {
    refundType = "full";
    refundableAmount = fullRefundAmount;
    message = "Full refund available within 24 hours of booking.";
  } else if (cancellationPolicy === "cancellable" && meetsCancellableWindow) {
    refundType = "full";
    refundableAmount = fullRefundAmount;
    message = "Full refund available because this cancellable booking is still at least 48 hours before check-in.";
  } else if (cancellationPolicy === "non_refundable") {
    refundType = "deposit_only";
    refundableAmount = depositRefundAmount;
    message = "This non-refundable booking returns the deposit only after the 24-hour grace period.";
  } else {
    refundType = "deposit_only";
    refundableAmount = depositRefundAmount;
    message = "This cancellable booking is inside the 48-hour check-in window, so only the deposit is refunded.";
  }

  return {
    cancellationPolicy,
    refundableAmount: Math.max(0, refundableAmount),
    refundType,
    withinGracePeriod,
    beforeCheckIn,
    cancellableDeadlineAt,
    message
  };
}

async function getBookingPaymentIntentId(booking) {
  if (booking.stripe_payment_intent_id) {
    return String(booking.stripe_payment_intent_id);
  }

  if (!stripe || !booking.stripe_session_id) {
    return "";
  }

  const session = await stripe.checkout.sessions.retrieve(String(booking.stripe_session_id));
  return session && session.payment_intent ? String(session.payment_intent) : "";
}

async function processBookingRefund(booking, amount) {
  const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!normalizedAmount) {
    return { refundId: "", paymentIntentId: "", amount: 0, status: "not_required" };
  }

  if (!stripe) {
    throw new Error("Stripe is not configured yet.");
  }

  const paymentIntentId = await getBookingPaymentIntentId(booking);
  if (!paymentIntentId) {
    throw new Error("Stripe payment intent was not found for this booking.");
  }

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: normalizedAmount,
    reason: "requested_by_customer",
    metadata: {
      bookingId: String(booking.id || "")
    }
  });

  return {
    refundId: String(refund.id || ""),
    paymentIntentId,
    amount: normalizedAmount,
    status: String(refund.status || "pending")
  };
}

async function finalizeStripeCheckoutSession(session) {
  const bookingId = session.metadata ? String(session.metadata.bookingId || "") : "";
  const sessionAction = session.metadata ? String(session.metadata.action || "booking_create") : "booking_create";
  if (!bookingId) {
    throw new Error("Booking not found for this payment session.");
  }

  const connectionPool = await getPool();
  const [rows] = await connectionPool.query(
    `
      SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, face_capture_path, face_capture_file_name, face_capture_completed_at, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, referral_code, status, payment_status, amount_paid, currency, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
      FROM \`${BOOKING_TABLE_NAME}\`
      WHERE id = ?
      LIMIT 1
    `,
    [bookingId]
  );

  const booking = rows[0];
  if (!booking) {
    throw new Error("Booking record does not exist.");
  }

  const pricingConfig = await getShortTermPricingConfig();

  if (session.payment_status === "paid") {
    if (sessionAction === "booking_adjustment") {
      const pendingChange = parseBookingChangePayload(booking.pending_change_payload);
      if (!pendingChange || !pendingChange.checkIn || !pendingChange.checkOut || !pendingChange.pricing) {
        throw new Error("No pending booking change was found for this payment.");
      }

      await applyBookingChange(connectionPool, booking, pendingChange, {
        amountPaid: (Number(booking.amount_paid) || Number(booking.total_amount) || 0) + (session.amount_total || 0),
        refundedAmount: Number(booking.refunded_amount) || 0,
        paymentStatus: "paid",
        stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : booking.stripe_payment_intent_id,
        stripeSessionId: session.id
      });
    } else {
      await connectionPool.query(
        `
          UPDATE \`${BOOKING_TABLE_NAME}\`
          SET status = 'CONFIRMED',
              payment_status = 'paid',
              stripe_session_id = ?,
              stripe_payment_intent_id = ?,
              amount_paid = ?,
              currency = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [session.id, session.payment_intent ? String(session.payment_intent) : null, session.amount_total || 0, (session.currency || pricingConfig.currency).toLowerCase(), bookingId]
      );
    }
  }

  const [freshRows] = await connectionPool.query(
    `
      SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, face_capture_path, face_capture_file_name, face_capture_completed_at, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, referral_code, status, payment_status, amount_paid, currency, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
      FROM \`${BOOKING_TABLE_NAME}\`
      WHERE id = ?
      LIMIT 1
    `,
    [bookingId]
  );
  const latestBooking = freshRows[0];
  const pricing = buildStoredPricingFromBooking(latestBooking, pricingConfig);

  if (session.payment_status === "paid") {
    await syncPaidGuestBookingToMainApp({
      bookingId: latestBooking.id,
      guestEmail: latestBooking.guest_email,
      guestName: latestBooking.guest_name,
      guestPhone: latestBooking.guest_phone || "",
      bioSex: latestBooking.bio_sex || "",
      branchId: latestBooking.branch_id,
      bedNumber: latestBooking.bed_number,
      checkIn: new Date(latestBooking.check_in).toISOString().slice(0, 10),
      checkOut: new Date(latestBooking.check_out).toISOString().slice(0, 10),
      notes: latestBooking.notes || "",
      pricing,
      isVietnamese: Boolean(Number(latestBooking.is_vietnamese)),
      idPhotoFileName: latestBooking.id_photo_path
        ? path.relative(path.resolve(__dirname, "data"), latestBooking.id_photo_path).replace(/\\/g, "/")
        : latestBooking.id_photo_file_name || "",
      referralCode: latestBooking.referral_code || "",
      applyReferralCoins: sessionAction !== "booking_adjustment",
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : "",
      stripeAmountPaid: Number(session.amount_total) || 0,
      stripePaymentAction: sessionAction
    });
  }

  return {
    action: sessionAction,
    booking: latestBooking,
    pricing
  };
}

function createBookingChangePayload(input) {
  return {
    guestPhone: String(input.guestPhone || "").trim(),
    notes: String(input.notes || "").trim(),
    checkIn: String(input.checkIn || "").trim(),
    checkOut: String(input.checkOut || "").trim(),
    nights: Number(input.nights) || 0,
    pricing: input.pricing || null,
    faceCaptureReset: Boolean(input.faceCaptureReset)
  };
}

function parseBookingChangePayload(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    return createBookingChangePayload(parsed);
  } catch {
    return null;
  }
}

async function applyBookingChange(connectionPool, booking, changePayload, options = {}) {
  const payload = createBookingChangePayload(changePayload || {});
  const pricing = payload.pricing || buildStoredPricingFromBooking(booking);
  const amountPaid = options.amountPaid === undefined ? Number(booking.amount_paid) || 0 : Number(options.amountPaid) || 0;
  const refundedAmount = options.refundedAmount === undefined ? Number(booking.refunded_amount) || 0 : Number(options.refundedAmount) || 0;
  const paymentStatus = options.paymentStatus || booking.payment_status || "";
  const stripePaymentIntentId = options.stripePaymentIntentId === undefined ? booking.stripe_payment_intent_id : options.stripePaymentIntentId;
  const stripeSessionId = options.stripeSessionId === undefined ? booking.stripe_session_id : options.stripeSessionId;

  await connectionPool.query(
    `
      UPDATE \`${BOOKING_TABLE_NAME}\`
      SET guest_phone = ?,
          notes = ?,
          check_in = ?,
          check_out = ?,
          nights = ?,
          nightly_rate = ?,
          subtotal_amount = ?,
          stay_discount_percent = ?,
          stay_discount_amount = ?,
          cancellation_policy = ?,
          cancellation_discount_percent = ?,
          cancellation_discount_amount = ?,
          discount_percent = ?,
          discount_amount = ?,
          deposit_amount = ?,
          total_amount = ?,
          amount_paid = ?,
          payment_status = ?,
          stripe_payment_intent_id = ?,
          stripe_session_id = ?,
          refunded_amount = ?,
          pending_change_payload = NULL,
          face_capture_path = ?,
          face_capture_file_name = ?,
          face_capture_completed_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      payload.guestPhone || booking.guest_phone || null,
      payload.notes,
      dateOnlyToUtc(payload.checkIn),
      dateOnlyToUtc(payload.checkOut),
      payload.nights,
      pricing.nightlyRate,
      pricing.subtotal,
      pricing.stayDiscountPercent || 0,
      pricing.stayDiscountAmount || 0,
      pricing.cancellationPolicy || normalizeCancellationPolicy(booking.cancellation_policy),
      pricing.cancellationDiscountPercent || 0,
      pricing.cancellationDiscountAmount || 0,
      pricing.discountPercent || 0,
      pricing.discountAmount || 0,
      pricing.depositAmount || DEPOSIT_AMOUNT,
      pricing.total,
      amountPaid,
      paymentStatus,
      stripePaymentIntentId || null,
      stripeSessionId || null,
      refundedAmount,
      payload.faceCaptureReset ? null : (booking.face_capture_path || null),
      payload.faceCaptureReset ? null : (booking.face_capture_file_name || null),
      payload.faceCaptureReset ? null : (booking.face_capture_completed_at || null),
      booking.id
    ]
  );
}

async function calculateBookingChange(booking, input, pricingConfig = null) {
  const config = pricingConfig || await getShortTermPricingConfig();
  const currentCheckIn = new Date(booking.check_in).toISOString().slice(0, 10);
  const currentCheckOut = new Date(booking.check_out).toISOString().slice(0, 10);
  const requestedCheckIn = String(input.checkIn || currentCheckIn).trim();
  const requestedCheckOut = String(input.checkOut || currentCheckOut).trim();
  const requestedNights = nightsBetween(requestedCheckIn, requestedCheckOut);
  const datesChanged = requestedCheckIn !== currentCheckIn || requestedCheckOut !== currentCheckOut;
  ensureValidDateRange(requestedCheckIn, requestedCheckOut);

  const currentPricing = buildStoredPricingFromBooking(booking, config);
  const nightlyPrices = getNightlyPricesForStay(config, booking.branch_id, booking.bed_number, requestedCheckIn, requestedCheckOut);
  const bedPricing = nightlyPrices[0]
    ? { nightlyPrice: nightlyPrices[0].nightlyPrice, source: nightlyPrices[0].source }
    : getBedPricingEntry(config, booking.branch_id, booking.bed_number);
  const requestedPricing = calculatePricing(
    requestedNights,
    bedPricing.nightlyPrice,
    config,
    { cancellationPolicy: booking.cancellation_policy, nightlyPrices: nightlyPrices.map((entry) => entry.nightlyPrice) }
  );
  const totalDifference = requestedPricing.total - currentPricing.total;
  const cancellationTerms = getBookingCancellationTerms(booking, config);

  let refundAmount = 0;
  let action = "even";
  let message = "Booking updated without a price change.";

  if (totalDifference > 0) {
    action = "pay_more";
    message = `Additional payment required: ${formatCurrencyVnd(totalDifference)}.`;
  } else if (totalDifference < 0) {
    action = "refund_less";
    if (cancellationTerms.refundType === "full") {
      refundAmount = Math.min(Math.abs(totalDifference), Number(booking.amount_paid) || Number(booking.total_amount) || 0);
      message = refundAmount > 0
        ? `Refund eligible: ${formatCurrencyVnd(refundAmount)}.`
        : "Price decreased, but no refundable amount was found.";
    } else {
      message = "Price decreased, but this policy window does not allow a stay-price refund.";
    }
  }

  return {
    currentCheckIn,
    currentCheckOut,
    requestedCheckIn,
    requestedCheckOut,
    requestedNights,
    datesChanged,
    currentPricing,
    requestedPricing,
    totalDifference,
    refundAmount,
    action,
    message,
    cancellationTerms,
    changePayload: createBookingChangePayload({
      guestPhone: String(input.guestPhone || booking.guest_phone || "").trim(),
      notes: String(input.notes || booking.notes || "").trim(),
      checkIn: requestedCheckIn,
      checkOut: requestedCheckOut,
      nights: requestedNights,
      pricing: requestedPricing,
      faceCaptureReset: datesChanged
    })
  };
}

function normalizeBranch(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7";
  }
  return "D2";
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getRowValue(row, matcher) {
  for (const [key, value] of Object.entries(row || {})) {
    if (matcher(normalizeKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
}

function getActiveStayValue(row) {
  return getRowValue(row, (key) => key.includes("hienconoo") || key.includes("hiencono") || key === "activeStay");
}

function getBedValue(row) {
  return getRowValue(row, (key) => key.includes("sogiuong") || key === "bed" || key.includes("bednumber"));
}

function getBranchValue(row) {
  return getRowValue(row, (key) => key.includes("chinhanhcozorodorm") || (key.includes("chinhanh") && key.includes("dorm")) || key === "branch");
}

function parseBedNumber(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateOnlyToUtc(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function nightsBetween(checkIn, checkOut) {
  const start = dateOnlyToUtc(checkIn);
  const end = dateOnlyToUtc(checkOut);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function ensureValidDateRange(checkIn, checkOut) {
  const start = dateOnlyToUtc(checkIn);
  const end = dateOnlyToUtc(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    throw new Error("Invalid check-in/check-out dates.");
  }
  return { start, end };
}

function assertBranchOpenForRegistration(branchId) {
  const error = getBranchRegistrationClosedError(branchId);
  if (error) {
    throw new Error(error);
  }
}

function getRoomLayoutForBed(branchId, bedNumber) {
  return BRANCH_LAYOUTS[branchId].find((room) => bedNumber >= room.startBed && bedNumber <= room.endBed) || null;
}

function normalizeBioSex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["female", "f", "woman", "girl"].includes(normalized)) {
    return "female";
  }
  if (["male", "m", "man", "boy"].includes(normalized)) {
    return "male";
  }
  return "";
}

function normalizeBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function normalizeBranchChoice(value) {
  const normalized = normalizeBranch(value);
  return normalized === "D2" || normalized === "D7" ? normalized : "D7";
}

function sanitizeFileNameSegment(value) {
  return String(value || "id-photo")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "id-photo";
}

function parseDataUrlFile(dataUrl) {
  const input = String(dataUrl || "").trim();
  const match = input.match(/^data:([^;]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("ID photo must be provided as a base64 data URL.");
  }

  const mimeType = match[1].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error("ID photo must be an image.");
  }

  const extensionMap = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  };

  const extension = extensionMap[mimeType] || "img";
  return {
    mimeType,
    extension,
    buffer: Buffer.from(match[2], "base64")
  };
}

async function saveIdentityPhoto({ bookingId, fileName, dataUrl }) {
  if (!dataUrl) {
    return null;
  }

  const parsed = parseDataUrlFile(dataUrl);
  await fs.mkdir(ID_PHOTO_DIR, { recursive: true });

  const safeBaseName = sanitizeFileNameSegment(fileName || "id-photo");
  const storedFileName = `${bookingId}_${randomUUID()}_${safeBaseName}.${parsed.extension}`;
  const storedPath = path.join(ID_PHOTO_DIR, storedFileName);

  await fs.writeFile(storedPath, parsed.buffer);

  return {
    fileName: storedFileName,
    filePath: storedPath,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length
  };
}

async function saveFaceCapture({ bookingId, dataUrl }) {
  if (!dataUrl) {
    return null;
  }

  const parsed = parseDataUrlFile(dataUrl);
  await fs.mkdir(FACE_CAPTURE_DIR, { recursive: true });

  const storedFileName = `${bookingId}_${randomUUID()}_face.${parsed.extension}`;
  const storedPath = path.join(FACE_CAPTURE_DIR, storedFileName);

  await fs.writeFile(storedPath, parsed.buffer);

  return {
    fileName: storedFileName,
    filePath: storedPath,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length
  };
}

function hoursUntilCheckIn(checkInValue) {
  const checkIn = dateOnlyToUtc(checkInValue);
  return (checkIn.getTime() - Date.now()) / 3600000;
}

function isFaceCaptureWindowOpen(checkInValue) {
  const remainingHours = hoursUntilCheckIn(checkInValue);
  return Number.isFinite(remainingHours) && remainingHours <= FACE_CAPTURE_WINDOW_HOURS && remainingHours >= 0;
}

function buildMainAppSyncNotes(input) {
  const notes = [];

  if (String(input.notes || "").trim()) {
    notes.push(String(input.notes).trim());
  }

  if (input.bookingId) {
    notes.push(`Booking ID: ${input.bookingId}`);
  }

  notes.push(input.isVietnamese ? "Nationality: Vietnamese" : "Nationality: non-Vietnamese");
  notes.push(`Branch address: ${BRANCH_DETAILS[input.branchId]?.fullAddress || input.branchId}`);

  if (input.idPhotoFileName) {
    notes.push(`ID photo stored locally: ${input.idPhotoFileName}`);
  }

  if (input.faceCaptureFileName) {
    notes.push(`Face capture stored locally: ${input.faceCaptureFileName}`);
  }

  return notes.join(" | ");
}

function getBranchAddressDetails(branchId) {
  return BRANCH_DETAILS[branchId] || {
    shortAddress: branchId,
    fullAddress: branchId
  };
}

function formatGuestBookingRecord(row) {
  const branchDetails = getBranchAddressDetails(row.branch_id);
  const pricingCurrency = DEFAULT_SHORT_TERM_CONFIG.currency.toLowerCase();
  const nightlyRate = Number(row.nightly_rate) || 0;
  const subtotal = Number(row.subtotal_amount) || 0;
  const discountPercent = Number(row.discount_percent) || 0;
  const discountAmount = Number(row.discount_amount) || 0;
  const depositAmount = Number(row.deposit_amount) || DEPOSIT_AMOUNT;
  const total = Number(row.total_amount) || Number(row.amount_paid) || 0;
  const cancellationPolicy = normalizeCancellationPolicy(row.cancellation_policy);
  const cancellationTerms = getBookingCancellationTerms(row);
  return {
    id: row.id,
    branchId: row.branch_id,
    roomCode: row.room_code,
    bedNumber: row.bed_number,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone || "",
    isVietnamese: Boolean(Number(row.is_vietnamese)),
    bioSex: row.bio_sex || "",
    checkIn: new Date(row.check_in).toISOString().slice(0, 10),
    checkOut: new Date(row.check_out).toISOString().slice(0, 10),
    nights: Number(row.nights) || nightsBetween(new Date(row.check_in).toISOString().slice(0, 10), new Date(row.check_out).toISOString().slice(0, 10)),
    notes: row.notes || "",
    status: row.status,
    paymentStatus: row.payment_status || "",
    cancellationPolicy,
    cancellationPolicyLabel: cancellationPolicy === "non_refundable" ? "Non-refundable" : "Cancellable",
    cancellationPolicyDescription: describeCancellationPolicy(cancellationPolicy),
    amountPaid: Number(row.amount_paid) || 0,
    refundedAmount: Number(row.refunded_amount) || 0,
    refundStatus: row.refund_status || "",
    cancelledAt: row.cancelled_at || null,
    currency: row.currency || pricingCurrency,
    faceCaptureCompleted: Boolean(row.face_capture_completed_at),
    faceCaptureOpen: isFaceCaptureWindowOpen(new Date(row.check_in).toISOString().slice(0, 10)),
    exactAddress: branchDetails.fullAddress,
    shortAddress: branchDetails.shortAddress,
    cancellationTerms,
    pricing: nightlyRate > 0 || subtotal > 0 || discountAmount > 0 || depositAmount > 0 || total > 0 ? {
      currency: (row.currency || pricingCurrency).toUpperCase(),
      nightlyRate,
      stayDiscountPercent: Number(row.stay_discount_percent) || 0,
      stayDiscountAmount: Number(row.stay_discount_amount) || 0,
      cancellationDiscountPercent: Number(row.cancellation_discount_percent) || 0,
      cancellationDiscountAmount: Number(row.cancellation_discount_amount) || 0,
      subtotal,
      discountPercent,
      discountAmount,
      depositAmount,
      total,
      stayTotal: total - depositAmount,
      cancellationPolicy
    } : null
  };
}

function getBookingFailureStatus(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Main app import failed") ? 502 : 400;
}

function isRoomAllowedForBioSex(branchId, room, bioSex) {
  if (branchId !== "D7") {
    return true;
  }

  const allowedFloors = BIO_SEX_RULES[bioSex];
  return Boolean(allowedFloors && allowedFloors.has(room.floorLabel));
}

function getBedLevelLabel(room, bedNumber) {
  const offset = bedNumber - room.startBed;
  const cycle = ["Bottom bed", "Middle bed", "Top bed"];
  return cycle[((offset % cycle.length) + cycle.length) % cycle.length];
}

async function syncPaidGuestBookingToMainApp(input) {
  const response = await fetch(`${MAIN_APP_API_URL}/internal/guest-bookings/import-paid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MAIN_APP_API_KEY ? { "x-internal-api-key": MAIN_APP_API_KEY } : {})
    },
    body: JSON.stringify({
      bookingId: String(input.bookingId || "").trim(),
      guestEmail: String(input.guestEmail || "").trim().toLowerCase(),
      guestName: input.guestName,
      guestPhone: input.guestPhone || "",
      bioSex: input.bioSex || "",
      branchId: input.branchId,
      bedNumber: Number(input.bedNumber),
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      pricingTotal: Number(input.pricing.total) || 0,
      notes: buildMainAppSyncNotes(input),
      referralCode: input.referralCode ? String(input.referralCode).trim() : undefined,
      applyReferralCoins: input.applyReferralCoins !== false,
      stripeSessionId: input.stripeSessionId ? String(input.stripeSessionId).trim() : undefined,
      stripePaymentIntentId: input.stripePaymentIntentId ? String(input.stripePaymentIntentId).trim() : undefined,
      stripeAmountPaid:
        input.stripeAmountPaid === undefined || input.stripeAmountPaid === null
          ? undefined
          : Number(input.stripeAmountPaid) || 0,
      stripePaymentAction: input.stripePaymentAction || undefined
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Main app import failed (${response.status}): ${payload}`);
  }
}

async function getPool() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = mysql.createPool(DATABASE_URL);
    await ensureBookingTable();
  }

  return pool;
}

async function ensureBookingTable() {
  const connectionPool = pool || mysql.createPool(DATABASE_URL);
  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS \`${BOOKING_TABLE_NAME}\` (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      branch_id VARCHAR(10) NOT NULL,
      room_code VARCHAR(20) NOT NULL,
      bed_number INT NOT NULL,
      guest_name VARCHAR(255) NOT NULL,
      guest_email VARCHAR(255) NOT NULL,
      guest_phone VARCHAR(100) NULL,
      is_vietnamese TINYINT(1) NOT NULL DEFAULT 0,
      bio_sex VARCHAR(20) NULL,
      id_photo_path VARCHAR(500) NULL,
      id_photo_file_name VARCHAR(255) NULL,
      face_capture_path VARCHAR(500) NULL,
      face_capture_file_name VARCHAR(255) NULL,
      face_capture_completed_at DATETIME NULL,
      check_in DATETIME NOT NULL,
      check_out DATETIME NOT NULL,
      nights INT NOT NULL,
      stay_discount_percent INT NULL,
      stay_discount_amount INT NULL,
      cancellation_policy VARCHAR(30) NOT NULL DEFAULT 'cancellable',
      cancellation_discount_percent INT NULL,
      cancellation_discount_amount INT NULL,
      notes TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
      payment_status VARCHAR(30) NULL,
      stripe_session_id VARCHAR(255) NULL,
      stripe_payment_intent_id VARCHAR(255) NULL,
      pending_change_payload LONGTEXT NULL,
      refunded_amount INT NULL,
      refund_status VARCHAR(30) NULL,
      refunded_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      amount_paid INT NULL,
      currency VARCHAR(10) NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'STANDALONE_WEB',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_branch_dates (branch_id, check_in, check_out),
      INDEX idx_branch_bed_dates (branch_id, bed_number, check_in, check_out),
      INDEX idx_guest_email_created (guest_email, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await connectionPool.query(`ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN is_vietnamese TINYINT(1) NOT NULL DEFAULT 0 AFTER guest_phone`);
  } catch (error) {
    if (!error || error.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }
  try {
    await connectionPool.query(`ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN bio_sex VARCHAR(20) NULL AFTER guest_phone`);
  } catch (error) {
    if (!error || error.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }
  for (const statement of [
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN id_photo_path VARCHAR(500) NULL AFTER bio_sex`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN id_photo_file_name VARCHAR(255) NULL AFTER id_photo_path`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN face_capture_path VARCHAR(500) NULL AFTER id_photo_file_name`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN face_capture_file_name VARCHAR(255) NULL AFTER face_capture_path`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN face_capture_completed_at DATETIME NULL AFTER face_capture_file_name`
  ]) {
    try {
      await connectionPool.query(statement);
    } catch (error) {
      if (!error || error.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
  for (const statement of [
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN nightly_rate INT NULL AFTER nights`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN subtotal_amount INT NULL AFTER nightly_rate`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN stay_discount_percent INT NULL AFTER subtotal_amount`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN stay_discount_amount INT NULL AFTER stay_discount_percent`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN cancellation_policy VARCHAR(30) NOT NULL DEFAULT 'cancellable' AFTER stay_discount_amount`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN cancellation_discount_percent INT NULL AFTER cancellation_policy`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN cancellation_discount_amount INT NULL AFTER cancellation_discount_percent`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN discount_percent INT NULL AFTER subtotal_amount`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN discount_amount INT NULL AFTER discount_percent`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN deposit_amount INT NULL AFTER discount_amount`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN total_amount INT NULL AFTER deposit_amount`
  ]) {
    try {
      await connectionPool.query(statement);
    } catch (error) {
      if (!error || error.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
  try {
    await connectionPool.query(
      `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN referral_code VARCHAR(64) NULL AFTER notes`
    );
  } catch (error) {
    if (!error || error.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }
  for (const statement of [
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN payment_status VARCHAR(30) NULL AFTER status`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN stripe_session_id VARCHAR(255) NULL AFTER payment_status`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL AFTER stripe_session_id`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN pending_change_payload LONGTEXT NULL AFTER stripe_payment_intent_id`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN refunded_amount INT NULL AFTER stripe_payment_intent_id`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN refund_status VARCHAR(30) NULL AFTER refunded_amount`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN refunded_at DATETIME NULL AFTER refund_status`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN cancelled_at DATETIME NULL AFTER refunded_at`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN amount_paid INT NULL AFTER stripe_session_id`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN currency VARCHAR(10) NULL AFTER amount_paid`
  ]) {
    try {
      await connectionPool.query(statement);
    } catch (error) {
      if (!error || error.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
  if (!pool) {
    await connectionPool.end();
  }
}

async function readClientCache() {
  try {
    const raw = await fs.readFile(CLIENT_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

async function getResidentOccupiedBeds(branchId) {
  const rows = await readClientCache();
  const occupied = new Set();

  for (const row of rows) {
    if (getActiveStayValue(row) !== "1") {
      continue;
    }

    if (normalizeBranch(getBranchValue(row)) !== branchId) {
      continue;
    }

    const bedNumber = parseBedNumber(getBedValue(row));
    if (bedNumber) {
      occupied.add(bedNumber);
    }
  }

  return occupied;
}

async function getOverlappingGuestBookings(branchId, checkIn, checkOut, excludeBookingId = "") {
  const { start, end } = ensureValidDateRange(checkIn, checkOut);
  const connectionPool = await getPool();
  const whereExclude = excludeBookingId ? "AND id <> ?" : "";
  const [rows] = await connectionPool.query(
    `
      SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, check_in, check_out, nights, notes, status
      FROM \`${BOOKING_TABLE_NAME}\`
      WHERE branch_id = ?
        AND status = 'CONFIRMED'
        AND check_in < ?
        AND check_out > ?
        ${whereExclude}
      ORDER BY room_code ASC, bed_number ASC
    `,
    excludeBookingId ? [branchId, end, start, excludeBookingId] : [branchId, end, start]
  );

  return rows;
}

async function buildAvailability(branchId, checkIn, checkOut, bioSex, excludeBookingId = "", pricingConfig = null) {
  const normalizedBioSex = normalizeBioSex(bioSex);
  if (branchId === "D7" && !normalizedBioSex) {
    throw new Error("Biological sex is required to view D7 availability.");
  }
  const nights = nightsBetween(checkIn, checkOut);
  const config = pricingConfig || await getShortTermPricingConfig();

  const [residentBeds, guestBookings] = await Promise.all([
    getResidentOccupiedBeds(branchId),
    getOverlappingGuestBookings(branchId, checkIn, checkOut, excludeBookingId)
  ]);

  const bookedBeds = new Map(guestBookings.map((booking) => [Number(booking.bed_number), booking]));
  const rooms = BRANCH_LAYOUTS[branchId]
    .filter((room) => isRoomAllowedForBioSex(branchId, room, normalizedBioSex))
    .map((room) => {
    const beds = Array.from({ length: room.endBed - room.startBed + 1 }, (_, index) => {
      const bedNumber = room.startBed + index;
      const guestBooking = bookedBeds.get(bedNumber) || null;
      const nightlyRates = getNightlyPricesForStay(config, branchId, bedNumber, checkIn, checkOut);
      const bedPricing = nightlyRates[0] ? { nightlyPrice: nightlyRates[0].nightlyPrice, source: nightlyRates[0].source } : getBedPricingEntry(config, branchId, bedNumber);
      let status = "available";

      if (residentBeds.has(bedNumber)) {
        status = "occupied_resident";
      } else if (guestBooking) {
        status = "occupied_booking";
      }

      return {
        bedNumber,
        bedLevel: getBedLevelLabel(room, bedNumber),
        status,
        bookingGuestName: guestBooking ? guestBooking.guest_name : null,
        nightlyPrice: bedPricing.nightlyPrice,
        nightlyPriceSource: bedPricing.source,
        nightlyPrices: nightlyRates
      };
    }).filter((bed) => bed.status === "available");

    return {
      roomCode: room.roomCode,
      floorLabel: room.floorLabel,
      beds
    };
  })
    .filter((room) => room.beds.length > 0);

  return {
    branchId,
    checkIn,
    checkOut,
    nights,
    bioSex: normalizedBioSex,
    pricing: {
      currency: config.currency,
      nights,
      minimumStay: config.minimumStay
    },
    rooms
  };
}

function createId() {
  return `stay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getRequestSiteUrl(req) {
  const origin = String(req.get("origin") || "").trim();
  return origin || SITE_URL;
}

function getGuestBookingSubmission(req) {
  const isVietnamese = normalizeBoolean(req.body.isVietnamese);
  const branchId = normalizeBranchChoice(req.body.branchId);
  const bedNumber = Number(req.body.bedNumber);
  const checkIn = String(req.body.checkIn || "");
  const checkOut = String(req.body.checkOut || "");
  const guestName = String(req.body.guestName || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestPhone = String(req.body.guestPhone || "").trim();
  const bioSex = branchId === "D7" ? normalizeBioSex(req.body.bioSex || "") : "";
  const notes = String(req.body.notes || "").trim();
  const idPhotoDataUrl = String(req.body.idPhotoDataUrl || "").trim();
  const idPhotoFileName = String(req.body.idPhotoFileName || "").trim();
  const guestAuthToken = String(req.body.guestAuthToken || "").trim();
  const cancellationPolicy = normalizeCancellationPolicy(req.body.cancellationPolicy);
  const referralCode = String(req.body.referralCode || "").trim();

  return {
    isVietnamese,
    branchId,
    bedNumber,
    checkIn,
    checkOut,
    guestName,
    guestEmail,
    guestPhone,
    bioSex,
    notes,
    idPhotoDataUrl,
    idPhotoFileName,
    guestAuthToken,
    cancellationPolicy,
    referralCode
  };
}

async function createPendingBooking(input, pricingConfig = null) {
  const connectionPool = await getPool();
  const { start, end } = ensureValidDateRange(input.checkIn, input.checkOut);
  const config = pricingConfig || await getShortTermPricingConfig();
  const nightlyPrices = getNightlyPricesForStay(config, input.branchId, input.bedNumber, input.checkIn, input.checkOut);
  const bedPricing = nightlyPrices[0]
    ? { nightlyPrice: nightlyPrices[0].nightlyPrice, source: nightlyPrices[0].source }
    : getBedPricingEntry(config, input.branchId, input.bedNumber);
  let pricing = calculatePricing(
    nightsBetween(input.checkIn, input.checkOut),
    bedPricing.nightlyPrice,
    config,
    { cancellationPolicy: input.cancellationPolicy, nightlyPrices: nightlyPrices.map((entry) => entry.nightlyPrice) }
  );
  let referralCodeStored = "";
  const referralRaw = typeof input.referralCode === "string" ? input.referralCode.trim() : "";
  if (referralRaw) {
    const quote = await fetchHostelReferralQuote(referralRaw, pricing.nights);
    const cut = Math.min(Math.max(0, quote.discountVnd || 0), Math.max(0, pricing.stayTotal));
    const nextStay = Math.max(0, pricing.stayTotal - cut);
    pricing = {
      ...pricing,
      referralDiscountAmount: cut,
      stayTotal: nextStay,
      total: nextStay + pricing.depositAmount,
      discountAmount: pricing.discountAmount + cut
    };
    referralCodeStored = referralRaw;
  }
  const id = createId();
  const idPhoto = input.isVietnamese
    ? await saveIdentityPhoto({
        bookingId: id,
        fileName: input.idPhotoFileName,
        dataUrl: input.idPhotoDataUrl
      })
    : null;

  const mergedNotes = [referralCodeStored ? `Referral code: ${referralCodeStored}` : "", input.notes || ""]
    .filter(Boolean)
    .join(" | ");

  await connectionPool.query(
    `
      INSERT INTO \`${BOOKING_TABLE_NAME}\`
      (id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, referral_code, status, payment_status, currency, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STANDALONE_WEB')
    `,
    [
      id,
      input.branchId,
      input.roomCode,
      input.bedNumber,
      input.guestName,
      input.guestEmail,
      input.guestPhone || null,
      input.isVietnamese ? 1 : 0,
      input.bioSex || null,
      idPhoto ? idPhoto.filePath : null,
      idPhoto ? idPhoto.fileName : null,
      start,
      end,
      pricing.nights,
      pricing.nightlyRate,
      pricing.subtotal,
      pricing.stayDiscountPercent,
      pricing.stayDiscountAmount,
      pricing.cancellationPolicy,
      pricing.cancellationDiscountPercent,
      pricing.cancellationDiscountAmount,
      pricing.discountPercent,
      pricing.discountAmount,
      pricing.depositAmount,
      pricing.total,
      mergedNotes || null,
      referralCodeStored || null,
      input.status || "PENDING_PAYMENT",
      input.paymentStatus === undefined ? "unpaid" : input.paymentStatus,
      pricing.currency.toLowerCase()
    ]
  );

  return {
    id,
    pricing,
    start,
    end,
    idPhoto,
    nightlyPriceSource: bedPricing.source,
    nightlyPrices: nightlyPrices.map((entry) => ({ date: entry.date, nightlyPrice: entry.nightlyPrice, source: entry.source })),
    referralCode: referralCodeStored
  };
}

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send("Stripe is not configured.");
  }

  try {
    const signature = req.get("stripe-signature") || "";
    const event = STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET)
      : JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "{}"));

    if (event.type === "checkout.session.completed") {
      await finalizeStripeCheckoutSession(event.data.object);
    }

    if (event.type === "charge.refunded" || event.type === "refund.updated") {
      const paymentIntentId =
        String(event.data.object.payment_intent || event.data.object.payment_intent_id || "").trim();
      if (paymentIntentId) {
        const connectionPool = await getPool();
        const [rows] = await connectionPool.query(
          `
            SELECT id, amount_paid, refunded_amount
            FROM \`${BOOKING_TABLE_NAME}\`
            WHERE stripe_payment_intent_id = ?
            LIMIT 1
          `,
          [paymentIntentId]
        );
        const booking = rows[0];
        if (booking) {
          const refundedAmount = Number(event.data.object.amount_refunded || event.data.object.amount || 0);
          const amountPaid = Number(booking.amount_paid) || 0;
          const paymentStatus = refundedAmount >= amountPaid && amountPaid > 0 ? "refunded" : refundedAmount > 0 ? "partially_refunded" : "paid";
          await connectionPool.query(
            `
              UPDATE \`${BOOKING_TABLE_NAME}\`
              SET refunded_amount = ?,
                  refund_status = ?,
                  refunded_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE refunded_at END,
                  payment_status = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
            [refundedAmount, String(event.data.object.status || "succeeded"), refundedAmount, paymentStatus, booking.id]
          );
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(400).send(error instanceof Error ? error.message : "Webhook error");
  }
});

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/referral-program", async (_req, res) => {
  try {
    const r = await fetch(`${MAIN_APP_API_URL}/api/public/referral-program`);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to load referral program"
    });
  }
});

app.get("/api/config", async (_req, res) => {
  const pricing = await getShortTermPricingConfig();
  res.json({
    siteTitle: SITE_TITLE,
    defaultBranch: DEFAULT_BRANCH,
    siteUrl: SITE_URL,
    stripeConfigured: Boolean(stripe),
    d2RegistrationClosed: D2_NEW_REGISTRATION_CLOSED,
    d2PermanentClosureDate: D2_PERMANENT_CLOSURE_DATE,
    closedBranches: D2_NEW_REGISTRATION_CLOSED ? ["D2"] : [],
    branchClosureNotice: getD2ClosureNotice("en"),
    branchClosureNoticeVi: getD2ClosureNotice("vi"),
    pricing: {
      currency: pricing.currency,
      bedPricing: pricing.bedPricing,
      bedPricingByDate: pricing.bedPricingByDate,
      discounts: pricing.discounts,
      minimumStay: pricing.minimumStay,
      cancellationPolicies: {
        cancellable: {
          code: "cancellable",
          label: "Cancellable",
          description: "Full refund within 24 hours of booking, or until 48 hours before check-in. After that, only the deposit is refunded."
        },
        nonRefundable: {
          code: "non_refundable",
          label: "Non-refundable",
          description: "Only the deposit is refunded after the 24-hour grace period, but you get an extra 10% discount on the stay."
        }
      },
      depositAmount: DEPOSIT_AMOUNT,
      fallbackNightlyPrice: DEFAULT_SHORT_TERM_CONFIG.fallbackNightlyPrice
    }
  });
});

app.get("/api/gallery", async (_req, res) => {
  try {
    const manifest = await getGalleryManifest();
    return res.json(manifest);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load gallery." });
  }
});

app.get("/api/recent-guest-profile", async (req, res) => {
  try {
    const entry = await getRecentGuestProfile(req);
    return res.json({ profile: entry ? entry.profile : null });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load recent guest profile." });
  }
});

app.post("/api/recent-guest-profile", async (req, res) => {
  try {
    const entry = await saveRecentGuestProfile(req, req.body || {});
    return res.json({ ok: true, profile: entry ? entry.profile : null });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to save recent guest profile." });
  }
});

app.get("/api/gallery-image/:branchId/:fileName", async (req, res) => {
  try {
    const image = await getGalleryImageBuffer(req.params.branchId, req.params.fileName);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type(image.contentType).send(image.buffer);
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : "Gallery image not found." });
  }
});

app.post("/api/guest-auth/request-code", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const trapValue = String(req.body.website || req.body.company || "").trim();
  if (!email) {
    return res.status(400).json({ error: "email is required." });
  }

  try {
    await issueGuestAuthCode(email, trapValue);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to send verification code." });
  }
});

app.post("/api/guest-auth/verify-code", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  if (!email || !code) {
    return res.status(400).json({ error: "email and code are required." });
  }

  try {
    const result = await verifyGuestAuthCode(email, code);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to verify code." });
  }
});

app.post("/api/guest-account/create", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const guestAuthToken = String(req.body.guestAuthToken || "").trim();

  if (!email || !password || !guestAuthToken) {
    return res.status(400).json({ error: "email, password, and guestAuthToken are required." });
  }

  try {
    await requireVerifiedEmailToken(email, guestAuthToken);
    const result = await createGuestAccount(email, password);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create account." });
  }
});

app.post("/api/guest-account/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  try {
    const result = await loginGuestAccount(email, password);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to sign in." });
  }
});

app.get("/api/availability", async (req, res) => {
  const branchId = normalizeBranchChoice(req.query.branchId || DEFAULT_BRANCH);
  const checkIn = String(req.query.checkIn || "");
  const checkOut = String(req.query.checkOut || "");
  const bioSex = String(req.query.bioSex || "");

  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: "checkIn and checkOut are required." });
  }

  if (isBranchClosedForNewRegistrations(branchId)) {
    return res.status(400).json({ error: getBranchRegistrationClosedError(branchId) });
  }

  try {
    const pricingConfig = await getShortTermPricingConfig();
    const availability = await buildAvailability(branchId, checkIn, checkOut, bioSex, "", pricingConfig);
    return res.json(availability);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load availability." });
  }
});

app.post("/api/bookings", async (req, res) => {
  const submission = getGuestBookingSubmission(req);

  if (!Number.isFinite(submission.bedNumber) || submission.bedNumber <= 0 || !submission.guestName || !submission.guestEmail || !submission.guestPhone || !submission.checkIn || !submission.checkOut || (submission.branchId === "D7" && !submission.bioSex) || !submission.guestAuthToken) {
    return res.status(400).json({ error: "Missing required booking fields." });
  }

  if (!submission.isVietnamese && submission.branchId === "D2") {
    return res.status(400).json({ error: "Foreign guests can book D7 only." });
  }

  if (isBranchClosedForNewRegistrations(submission.branchId)) {
    return res.status(400).json({ error: getBranchRegistrationClosedError(submission.branchId) });
  }

  try {
    ensureValidDateRange(submission.checkIn, submission.checkOut);
    const pricingConfig = await getShortTermPricingConfig();
    await requireVerifiedGuest(submission.guestEmail, submission.guestAuthToken);
    const room = getRoomLayoutForBed(submission.branchId, submission.bedNumber);

    if (!room) {
      throw new Error("Selected bed does not belong to a known room.");
    }

    if (!isRoomAllowedForBioSex(submission.branchId, room, submission.bioSex)) {
      throw new Error("That bed is not available for the selected biological sex.");
    }

    if (submission.branchId === "D2" && !submission.idPhotoDataUrl) {
      throw new Error("Vietnamese guests must upload a physical ID photo.");
    }

    const availability = await buildAvailability(submission.branchId, submission.checkIn, submission.checkOut, submission.bioSex, "", pricingConfig);
    const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
    const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === submission.bedNumber);

    if (!bedAvailability || bedAvailability.status !== "available") {
      throw new Error("That bed is no longer available for the selected dates.");
    }

    const booking = await createPendingBooking({
      branchId: submission.branchId,
      roomCode: room.roomCode,
      bedNumber: submission.bedNumber,
      guestName: submission.guestName,
      guestEmail: submission.guestEmail,
      guestPhone: submission.guestPhone,
      bioSex: submission.bioSex,
      isVietnamese: submission.isVietnamese,
      idPhotoDataUrl: submission.idPhotoDataUrl,
      idPhotoFileName: submission.idPhotoFileName,
      checkIn: submission.checkIn,
      checkOut: submission.checkOut,
      notes: submission.notes,
      cancellationPolicy: submission.cancellationPolicy,
      status: "CONFIRMED",
      paymentStatus: null,
      referralCode: submission.referralCode
    }, pricingConfig);

    await syncPaidGuestBookingToMainApp({
      bookingId: booking.id,
      guestEmail: submission.guestEmail,
      guestName: submission.guestName,
      guestPhone: submission.guestPhone,
      bioSex: submission.bioSex,
      branchId: submission.branchId,
      bedNumber: submission.bedNumber,
      checkIn: submission.checkIn,
      checkOut: submission.checkOut,
      pricing: booking.pricing,
      notes: submission.notes,
      isVietnamese: submission.isVietnamese,
      idPhotoFileName: booking.idPhoto
        ? path.relative(path.resolve(__dirname, "data"), booking.idPhoto.filePath).replace(/\\/g, "/")
        : "",
      referralCode: booking.referralCode || "",
      applyReferralCoins: true
    });

    return res.status(201).json({
      booking: {
        id: booking.id,
        branchId: submission.branchId,
        roomCode: room.roomCode,
        bedNumber: submission.bedNumber,
        guestName: submission.guestName,
        guestEmail: submission.guestEmail,
        bioSex: submission.bioSex,
        isVietnamese: submission.isVietnamese,
        checkIn: submission.checkIn,
        checkOut: submission.checkOut,
        pricing: booking.pricing
      },
      pricing: booking.pricing
    });
  } catch (error) {
    return res.status(getBookingFailureStatus(error)).json({ error: error instanceof Error ? error.message : "Unable to create booking." });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env." });
  }

  const submission = getGuestBookingSubmission(req);

  if (!Number.isFinite(submission.bedNumber) || submission.bedNumber <= 0 || !submission.guestName || !submission.guestEmail || !submission.guestPhone || !submission.checkIn || !submission.checkOut || (submission.branchId === "D7" && !submission.bioSex) || !submission.guestAuthToken) {
    return res.status(400).json({ error: "Missing required booking fields." });
  }

  if (!submission.isVietnamese && submission.branchId === "D2") {
    return res.status(400).json({ error: "Foreign guests can book D7 only." });
  }

  if (isBranchClosedForNewRegistrations(submission.branchId)) {
    return res.status(400).json({ error: getBranchRegistrationClosedError(submission.branchId) });
  }

  try {
    ensureValidDateRange(submission.checkIn, submission.checkOut);
    const pricingConfig = await getShortTermPricingConfig();
    await requireVerifiedGuest(submission.guestEmail, submission.guestAuthToken);
    const room = getRoomLayoutForBed(submission.branchId, submission.bedNumber);

    if (!room) {
      throw new Error("Selected bed does not belong to a known room.");
    }

    if (!isRoomAllowedForBioSex(submission.branchId, room, submission.bioSex)) {
      throw new Error("That bed is not available for the selected biological sex.");
    }

    if (submission.branchId === "D2" && !submission.idPhotoDataUrl) {
      throw new Error("Vietnamese guests must upload a physical ID photo.");
    }

    const availability = await buildAvailability(submission.branchId, submission.checkIn, submission.checkOut, submission.bioSex, "", pricingConfig);
    const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
    const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === submission.bedNumber);

    if (!bedAvailability || bedAvailability.status !== "available") {
      throw new Error("That bed is no longer available for the selected dates.");
    }

    const requestSiteUrl = getRequestSiteUrl(req);
    const pendingBooking = await createPendingBooking({
      branchId: submission.branchId,
      roomCode: room.roomCode,
      bedNumber: submission.bedNumber,
      guestName: submission.guestName,
      guestEmail: submission.guestEmail,
      guestPhone: submission.guestPhone,
      bioSex: submission.bioSex,
      isVietnamese: submission.isVietnamese,
      idPhotoDataUrl: submission.idPhotoDataUrl,
      idPhotoFileName: submission.idPhotoFileName,
      checkIn: submission.checkIn,
      checkOut: submission.checkOut,
      notes: submission.notes,
      cancellationPolicy: submission.cancellationPolicy,
      referralCode: submission.referralCode
    }, pricingConfig);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: submission.guestEmail,
      success_url: `${requestSiteUrl}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${requestSiteUrl}/?canceled=1`,
      metadata: { bookingId: pendingBooking.id },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pendingBooking.pricing.currency.toLowerCase(),
            unit_amount: pendingBooking.pricing.total - pendingBooking.pricing.depositAmount,
            product_data: {
              name: `${SITE_TITLE} - Room ${room.roomCode} Bed ${submission.bedNumber}`,
              description: `${submission.checkIn} to ${submission.checkOut} (${pendingBooking.pricing.nights} nights, ${getBedLevelLabel(room, submission.bedNumber)})`
            }
          }
        },
        {
          quantity: 1,
          price_data: {
            currency: pendingBooking.pricing.currency.toLowerCase(),
            unit_amount: pendingBooking.pricing.depositAmount,
            product_data: {
              name: `${SITE_TITLE} - Refundable damage deposit`,
              description: "Refunded within 5 to 10 days after check-out."
            }
          }
        }
      ]
    });

    const connectionPool = await getPool();
    await connectionPool.query(
      `
        UPDATE \`${BOOKING_TABLE_NAME}\`
        SET stripe_session_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [session.id, pendingBooking.id]
    );

    return res.status(201).json({
      mode: "card",
      checkoutUrl: session.url,
      bookingId: pendingBooking.id,
      pricing: pendingBooking.pricing
    });
  } catch (error) {
    if (error instanceof Error && error.message) {
      try {
        const connectionPool = await getPool();
        await connectionPool.query(
          `
            UPDATE \`${BOOKING_TABLE_NAME}\`
            SET status = 'PAYMENT_FAILED',
                payment_status = 'payment_failed',
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_email = ?
              AND check_in = ?
              AND check_out = ?
              AND status = 'PENDING_PAYMENT'
          `,
          [submission.guestEmail, dateOnlyToUtc(submission.checkIn), dateOnlyToUtc(submission.checkOut)]
        );
      } catch {
        // Best-effort cleanup only.
      }
    }
    return res.status(getBookingFailureStatus(error)).json({ error: error instanceof Error ? error.message : "Unable to start Stripe checkout." });
  }
});

app.get("/api/confirm-payment", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const sessionId = String(req.query.session_id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "session_id is required." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const result = await finalizeStripeCheckoutSession(session);
    const booking = result.booking;

    return res.json({
      paid: session.payment_status === "paid",
      action: result.action,
      booking: {
        id: booking.id,
        branchId: booking.branch_id,
        roomCode: booking.room_code,
        bedNumber: booking.bed_number,
        bioSex: booking.bio_sex,
        checkIn: new Date(booking.check_in).toISOString().slice(0, 10),
        checkOut: new Date(booking.check_out).toISOString().slice(0, 10),
        pricing: result.pricing
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to verify payment session.",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get("/api/guest-bookings", async (req, res) => {
  const guestEmail = String(req.query.email || "").trim().toLowerCase();
  const guestAuthToken = String(req.query.guestAuthToken || "").trim();
  if (!guestEmail || !guestAuthToken) {
    return res.status(400).json({ error: "email and guestAuthToken are required." });
  }

  const hasAccess = await validateGuestAccountSession(guestEmail, guestAuthToken);
  if (!hasAccess) {
    return res.status(403).json({ error: "Please sign in with your password to view bookings." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, status, payment_status, amount_paid, currency, face_capture_completed_at, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE guest_email = ?
        ORDER BY check_in DESC, created_at DESC
      `,
      [guestEmail]
    );

    return res.json({
      email: guestEmail,
      bookings: rows.map(formatGuestBookingRecord)
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load guest bookings.",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.post("/api/guest-bookings/:id/preview-change", async (req, res) => {
  const bookingId = String(req.params.id || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestAuthToken = String(req.body.guestAuthToken || "").trim();
  const guestPhone = String(req.body.guestPhone || "").trim();
  const notes = String(req.body.notes || "").trim();
  const checkIn = String(req.body.checkIn || "").trim();
  const checkOut = String(req.body.checkOut || "").trim();

  if (!bookingId || !guestEmail || !guestAuthToken) {
    return res.status(400).json({ error: "booking id, guestEmail, and guestAuthToken are required." });
  }

  const hasAccess = await validateGuestAccountSession(guestEmail, guestAuthToken);
  if (!hasAccess) {
    return res.status(403).json({ error: "Please sign in with your password to preview booking changes." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, face_capture_path, face_capture_file_name, face_capture_completed_at, check_in, check_out, nights, notes, status, payment_status, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, amount_paid, currency, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
          AND guest_email = ?
        LIMIT 1
      `,
      [bookingId, guestEmail]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking not found for that email." });
    }

    const room = getRoomLayoutForBed(booking.branch_id, booking.bed_number);
    if (!room) {
      throw new Error("Selected booking room is invalid.");
    }

    const change = await calculateBookingChange(booking, {
      guestPhone,
      notes,
      checkIn,
      checkOut
    });

    if (change.datesChanged) {
      const availability = await buildAvailability(
        booking.branch_id,
        change.requestedCheckIn,
        change.requestedCheckOut,
        booking.bio_sex || "",
        booking.id
      );
      const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
      const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === booking.bed_number);

      if (!bedAvailability || bedAvailability.status !== "available") {
        throw new Error("That bed is no longer available for the selected dates.");
      }
    }

    return res.json({
      preview: {
        action: change.action,
        message: change.message,
        totalDifference: change.totalDifference,
        refundAmount: change.refundAmount,
        currentPricing: change.currentPricing,
        requestedPricing: change.requestedPricing,
        cancellationTerms: change.cancellationTerms
      }
    });
  } catch (error) {
    return res.status(getBookingFailureStatus(error)).json({
      error: error instanceof Error ? error.message : "Unable to preview booking change."
    });
  }
});

app.patch("/api/guest-bookings/:id", async (req, res) => {
  const bookingId = String(req.params.id || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestAuthToken = String(req.body.guestAuthToken || "").trim();
  const guestPhone = String(req.body.guestPhone || "").trim();
  const notes = String(req.body.notes || "").trim();
  const checkIn = String(req.body.checkIn || "").trim();
  const checkOut = String(req.body.checkOut || "").trim();

  if (!bookingId || !guestEmail || !guestAuthToken) {
    return res.status(400).json({ error: "booking id, guestEmail, and guestAuthToken are required." });
  }

  const hasAccess = await validateGuestAccountSession(guestEmail, guestAuthToken);
  if (!hasAccess) {
    return res.status(403).json({ error: "Please sign in with your password to modify bookings." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, face_capture_path, face_capture_file_name, face_capture_completed_at, check_in, check_out, nights, notes, status, payment_status, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, amount_paid, currency, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
          AND guest_email = ?
        LIMIT 1
      `,
      [bookingId, guestEmail]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking not found for that email." });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ error: "This booking is already cancelled." });
    }

    const change = await calculateBookingChange(booking, {
      guestPhone,
      notes,
      checkIn,
      checkOut
    });
    const requestedCheckIn = change.requestedCheckIn;
    const requestedCheckOut = change.requestedCheckOut;
    const requestedNights = change.requestedNights;
    const datesChanged = change.datesChanged;

    const room = getRoomLayoutForBed(booking.branch_id, booking.bed_number);
    if (!room) {
      throw new Error("Selected booking room is invalid.");
    }

    if (datesChanged) {
      const availability = await buildAvailability(
        booking.branch_id,
        requestedCheckIn,
        requestedCheckOut,
        booking.bio_sex || "",
        booking.id
      );
      const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
      const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === booking.bed_number);

      if (!bedAvailability || bedAvailability.status !== "available") {
        throw new Error("That bed is no longer available for the selected dates.");
      }
    }

    const pricingConfig = await getShortTermPricingConfig();
    const requestedPricing = change.requestedPricing;
    const totalDifference = change.totalDifference;
    const changePayload = change.changePayload;

    if (totalDifference > 0 && (booking.payment_status === "paid" || booking.status === "CONFIRMED")) {
      const requestSiteUrl = getRequestSiteUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: guestEmail,
        success_url: `${requestSiteUrl}/manage-booking.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${requestSiteUrl}/manage-booking.html?booking_update_canceled=1`,
        metadata: {
          bookingId: booking.id,
          action: "booking_adjustment"
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: requestedPricing.currency.toLowerCase(),
              unit_amount: totalDifference,
              product_data: {
                name: `${SITE_TITLE} - Booking adjustment`,
                description: `${requestedCheckIn} to ${requestedCheckOut} (${requestedPricing.nights} nights)`
              }
            }
          }
        ]
      });

      await connectionPool.query(
        `
          UPDATE \`${BOOKING_TABLE_NAME}\`
          SET pending_change_payload = ?,
              stripe_session_id = ?,
              payment_status = 'adjustment_pending',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND guest_email = ?
        `,
        [JSON.stringify(changePayload), session.id, bookingId, guestEmail]
      );

      return res.json({
        requiresPayment: true,
        checkoutUrl: session.url,
        amountDue: totalDifference,
        message: `Your updated stay costs ${formatCurrencyVnd(requestedPricing.total)}. Please pay the difference of ${formatCurrencyVnd(totalDifference)} to confirm the change.`
      });
    }

    let refundedAmount = Number(booking.refunded_amount) || 0;
    let amountPaid = Number(booking.amount_paid) || Number(booking.total_amount) || 0;
    let paymentStatus = booking.payment_status || "";
    let adjustmentMessage = "Booking updated.";

    if (totalDifference < 0) {
      const decreaseAmount = Math.abs(totalDifference);
      const refundableDifference = Math.min(change.refundAmount, amountPaid);

      if (refundableDifference > 0) {
        const refundResult = await processBookingRefund(booking, refundableDifference);
        refundedAmount += refundResult.amount;
        amountPaid = Math.max(0, amountPaid - refundResult.amount);
        paymentStatus = refundResult.amount >= decreaseAmount ? "partially_refunded" : paymentStatus || "paid";
        adjustmentMessage = `Booking updated. Refund started for ${formatCurrencyVnd(refundResult.amount)}.`;
      } else {
        adjustmentMessage = `Booking updated. ${change.message}`;
      }
    }

    if (totalDifference === 0 && (booking.payment_status === "adjustment_pending")) {
      paymentStatus = "paid";
    }

    await applyBookingChange(connectionPool, booking, changePayload, {
      amountPaid,
      refundedAmount,
      paymentStatus
    });

    const [updatedRows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, referral_code, status, payment_status, amount_paid, currency, face_capture_completed_at, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
        LIMIT 1
      `,
      [bookingId]
    );

    const updatedBooking = updatedRows[0];
    if (updatedBooking && (booking.payment_status === "paid" || booking.status === "CONFIRMED")) {
      const pricingConfig = await getShortTermPricingConfig();
      await syncPaidGuestBookingToMainApp({
        bookingId: booking.id,
        guestEmail: updatedBooking.guest_email,
        guestName: updatedBooking.guest_name,
        guestPhone: updatedBooking.guest_phone || "",
        bioSex: updatedBooking.bio_sex || "",
        branchId: updatedBooking.branch_id,
        bedNumber: updatedBooking.bed_number,
        checkIn: new Date(updatedBooking.check_in).toISOString().slice(0, 10),
        checkOut: new Date(updatedBooking.check_out).toISOString().slice(0, 10),
        notes: updatedBooking.notes || "",
        pricing: buildStoredPricingFromBooking(updatedBooking, pricingConfig),
        isVietnamese: Boolean(Number(updatedBooking.is_vietnamese)),
        idPhotoFileName: booking.id_photo_path
          ? path.relative(path.resolve(__dirname, "data"), booking.id_photo_path).replace(/\\/g, "/")
          : booking.id_photo_file_name || "",
        referralCode: updatedBooking.referral_code || "",
        applyReferralCoins: false
      });
    }

    return res.json({
      booking: formatGuestBookingRecord(updatedRows[0]),
      message: adjustmentMessage,
      pricingDifference: totalDifference
    });
  } catch (error) {
    return res.status(getBookingFailureStatus(error)).json({
      error: error instanceof Error ? error.message : "Unable to update booking."
    });
  }
});

app.post("/api/guest-bookings/:id/cancel", async (req, res) => {
  const bookingId = String(req.params.id || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestAuthToken = String(req.body.guestAuthToken || "").trim();

  if (!bookingId || !guestEmail || !guestAuthToken) {
    return res.status(400).json({ error: "booking id, guestEmail, and guestAuthToken are required." });
  }

  const hasAccess = await validateGuestAccountSession(guestEmail, guestAuthToken);
  if (!hasAccess) {
    return res.status(403).json({ error: "Please sign in with your password to cancel bookings." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, id_photo_path, id_photo_file_name, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, status, payment_status, stripe_session_id, stripe_payment_intent_id, pending_change_payload, amount_paid, currency, created_at, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
          AND guest_email = ?
        LIMIT 1
      `,
      [bookingId, guestEmail]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking not found for that email." });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ error: "This booking is already cancelled." });
    }

    const pricingConfig = await getShortTermPricingConfig();
    const cancellationTerms = getBookingCancellationTerms(booking, pricingConfig);

    if (!cancellationTerms.beforeCheckIn) {
      return res.status(400).json({ error: cancellationTerms.message });
    }

    const amountPaid = Number(booking.amount_paid) || Number(booking.total_amount) || 0;
    let refundResult = {
      refundId: "",
      paymentIntentId: String(booking.stripe_payment_intent_id || ""),
      amount: 0,
      status: "not_required"
    };

    if ((booking.payment_status === "paid" || amountPaid > 0) && cancellationTerms.refundableAmount > 0) {
      refundResult = await processBookingRefund(booking, Math.min(amountPaid, cancellationTerms.refundableAmount));
    }

    let paymentStatus = booking.payment_status || "";
    if (booking.payment_status === "paid" || amountPaid > 0) {
      if (refundResult.amount >= amountPaid && amountPaid > 0) {
        paymentStatus = "refunded";
      } else if (refundResult.amount > 0) {
        paymentStatus = "partially_refunded";
      } else {
        paymentStatus = "cancelled_no_refund";
      }
    } else {
      paymentStatus = "cancelled";
    }

    await connectionPool.query(
      `
        UPDATE \`${BOOKING_TABLE_NAME}\`
        SET status = 'CANCELLED',
            payment_status = ?,
            stripe_payment_intent_id = ?,
            refunded_amount = ?,
            refund_status = ?,
            refunded_at = ?,
            cancelled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND guest_email = ?
      `,
      [
        paymentStatus,
        refundResult.paymentIntentId || booking.stripe_payment_intent_id || null,
        refundResult.amount || 0,
        refundResult.status || (refundResult.amount > 0 ? "succeeded" : "not_required"),
        refundResult.amount > 0 ? new Date() : null,
        bookingId,
        guestEmail
      ]
    );

    const [updatedRows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, is_vietnamese, bio_sex, check_in, check_out, nights, nightly_rate, subtotal_amount, stay_discount_percent, stay_discount_amount, cancellation_policy, cancellation_discount_percent, cancellation_discount_amount, discount_percent, discount_amount, deposit_amount, total_amount, notes, status, payment_status, amount_paid, currency, created_at, stripe_session_id, stripe_payment_intent_id, pending_change_payload, refunded_amount, refund_status, refunded_at, cancelled_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
        LIMIT 1
      `,
      [bookingId]
    );

    return res.json({
      booking: formatGuestBookingRecord(updatedRows[0]),
      refund: {
        amount: refundResult.amount,
        status: refundResult.status,
        type: cancellationTerms.refundType,
        message: cancellationTerms.message
      }
    });
  } catch (error) {
    return res.status(getBookingFailureStatus(error)).json({
      error: error instanceof Error ? error.message : "Unable to cancel booking."
    });
  }
});

app.get("/api/face-capture-status", async (req, res) => {
  const bookingId = String(req.query.booking_id || "").trim();
  if (!bookingId) {
    return res.status(400).json({ error: "booking_id is required." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, check_in, face_capture_path, face_capture_file_name, face_capture_completed_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
        LIMIT 1
      `,
      [bookingId]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking record does not exist." });
    }

    return res.json({
      bookingId: booking.id,
      branchId: booking.branch_id,
      roomCode: booking.room_code,
      bedNumber: booking.bed_number,
      guestName: booking.guest_name,
      checkIn: new Date(booking.check_in).toISOString().slice(0, 10),
      faceCaptureRequired: true,
      hoursUntilCheckIn: hoursUntilCheckIn(new Date(booking.check_in).toISOString().slice(0, 10)),
      faceCaptureOpen: isFaceCaptureWindowOpen(new Date(booking.check_in).toISOString().slice(0, 10)),
      faceCaptureCompleted: Boolean(booking.face_capture_completed_at),
      faceCaptureFileName: booking.face_capture_file_name || "",
      faceCaptureCompletedAt: booking.face_capture_completed_at || null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load face capture status.",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.post("/api/face-capture", async (req, res) => {
  const bookingId = String(req.body.bookingId || "").trim();
  const faceDataUrl = String(req.body.faceDataUrl || "").trim();
  const idHeldTogether = normalizeBoolean(req.body.idHeldTogether);

  if (!bookingId || !faceDataUrl || !idHeldTogether) {
    return res.status(400).json({ error: "bookingId, faceDataUrl, and ID-holding confirmation are required." });
  }

  try {
    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, guest_name, check_in, face_capture_completed_at
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
        LIMIT 1
      `,
      [bookingId]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking record does not exist." });
    }

    const checkInValue = new Date(booking.check_in).toISOString().slice(0, 10);
    if (!isFaceCaptureWindowOpen(checkInValue)) {
      return res.status(400).json({ error: "Face capture is only available within 48 hours before check-in." });
    }

    if (booking.face_capture_completed_at) {
      return res.status(400).json({ error: "Face capture was already completed for this booking." });
    }

    const capture = await saveFaceCapture({
      bookingId,
      dataUrl: faceDataUrl
    });

    await connectionPool.query(
      `
        UPDATE \`${BOOKING_TABLE_NAME}\`
        SET face_capture_path = ?,
            face_capture_file_name = ?,
            face_capture_completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [capture ? capture.filePath : null, capture ? capture.fileName : null, bookingId]
    );

    return res.status(201).json({
      ok: true,
      bookingId,
      storedFileName: capture ? capture.fileName : null
    });
  } catch (error) {
    return res.status(getBookingFailureStatus(error)).json({
      error: error instanceof Error ? error.message : "Unable to save face capture."
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  await ensureBookingTable();

  app.listen(PORT, () => {
    console.log(`${SITE_TITLE} listening on http://localhost:${PORT}`);
    console.log(`Using resident cache: ${CLIENT_CACHE_PATH}`);
    console.log(`Using booking table: ${BOOKING_TABLE_NAME}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start booking server:", error);
  process.exit(1);
});
