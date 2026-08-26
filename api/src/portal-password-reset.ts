import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sendGmailReceipt } from "./google-sheets.js";
import { upsertStoredPassword } from "./portal-auth.js";
import { resolvePortalLogin } from "./staff-access.js";

const resetFilePath = path.join(process.cwd(), "data", "portal-password-resets.json");
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_ATTEMPTS = 6;
const RESET_MIN_REQUEST_INTERVAL_MS = 60 * 1000;
const RESET_MAX_PER_EMAIL_PER_HOUR = 3;
const RESET_MAX_PER_EMAIL_PER_DAY = 10;
const RESET_MAX_PER_IP_PER_HOUR = 20;

type PendingReset = {
  email: string;
  requestId: string;
  salt: string;
  codeHash: string;
  expiresAt: string;
  attemptsRemaining: number;
};

type ResetRequest = {
  email: string;
  ip: string;
  requestedAt: string;
};

type PasswordResetFile = {
  pending: PendingReset[];
  requests: ResetRequest[];
};

let resetFileQueue: Promise<void> = Promise.resolve();

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeIp(value: string) {
  return value.split(",")[0]?.trim().toLowerCase() || "unknown";
}

function hashResetCode(code: string, salt: string) {
  return scryptSync(code, salt, 32);
}

function statusError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

async function readResetFile(): Promise<PasswordResetFile> {
  try {
    const rawValue = await readFile(resetFilePath, "utf8");
    const parsed = JSON.parse(rawValue) as Partial<PasswordResetFile>;
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : []
    };
  } catch {
    return { pending: [], requests: [] };
  }
}

async function writeResetFile(file: PasswordResetFile) {
  await mkdir(path.dirname(resetFilePath), { recursive: true });
  await writeFile(resetFilePath, JSON.stringify(file, null, 2), "utf8");
}

async function withResetFileLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = resetFileQueue;
  let release = () => {};
  resetFileQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function pruneResetFile(file: PasswordResetFile, nowMs: number) {
  file.pending = file.pending.filter((entry) => new Date(entry.expiresAt).getTime() > nowMs);
  file.requests = file.requests.filter(
    (entry) => new Date(entry.requestedAt).getTime() > nowMs - 24 * 60 * 60 * 1000
  );
}

async function consumeResetRequestLimit(email: string, ip: string) {
  await withResetFileLock(async () => {
    const file = await readResetFile();
    const nowMs = Date.now();
    pruneResetFile(file, nowMs);

    const emailRequests = file.requests.filter((entry) => entry.email === email);
    const lastRequestMs = Math.max(
      0,
      ...emailRequests.map((entry) => new Date(entry.requestedAt).getTime())
    );
    const emailHourlyCount = emailRequests.filter(
      (entry) => new Date(entry.requestedAt).getTime() > nowMs - 60 * 60 * 1000
    ).length;
    const ipHourlyCount = file.requests.filter(
      (entry) => entry.ip === ip && new Date(entry.requestedAt).getTime() > nowMs - 60 * 60 * 1000
    ).length;

    if (lastRequestMs && nowMs - lastRequestMs < RESET_MIN_REQUEST_INTERVAL_MS) {
      throw statusError("Please wait 1 minute before requesting another code.", 429);
    }
    if (emailHourlyCount >= RESET_MAX_PER_EMAIL_PER_HOUR) {
      throw statusError("Too many reset codes requested for this email. Please try again later.", 429);
    }
    if (emailRequests.length >= RESET_MAX_PER_EMAIL_PER_DAY) {
      throw statusError("This email has reached the daily reset limit. Please try again tomorrow.", 429);
    }
    if (ipHourlyCount >= RESET_MAX_PER_IP_PER_HOUR) {
      throw statusError("Too many reset requests from this network. Please try again later.", 429);
    }

    file.requests.push({ email, ip, requestedAt: new Date(nowMs).toISOString() });
    await writeResetFile(file);
  });
}

async function savePendingReset(email: string, code: string) {
  const requestId = randomBytes(16).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

  await withResetFileLock(async () => {
    const file = await readResetFile();
    pruneResetFile(file, Date.now());
    file.pending = file.pending.filter((entry) => entry.email !== email);
    file.pending.push({
      email,
      requestId,
      salt,
      codeHash: hashResetCode(code, salt).toString("hex"),
      expiresAt,
      attemptsRemaining: RESET_CODE_ATTEMPTS
    });
    await writeResetFile(file);
  });

  return requestId;
}

async function removePendingReset(email: string, requestId: string) {
  await withResetFileLock(async () => {
    const file = await readResetFile();
    file.pending = file.pending.filter(
      (entry) => entry.email !== email || entry.requestId !== requestId
    );
    await writeResetFile(file);
  });
}

async function consumeValidResetCode(email: string, code: string) {
  await withResetFileLock(async () => {
    const file = await readResetFile();
    pruneResetFile(file, Date.now());
    const pending = file.pending.find((entry) => entry.email === email);

    if (!pending) {
      await writeResetFile(file);
      throw statusError("The reset code is invalid or expired.", 400);
    }

    const incomingHash = hashResetCode(code, pending.salt);
    const storedHash = Buffer.from(pending.codeHash, "hex");
    const matches = incomingHash.length === storedHash.length && timingSafeEqual(incomingHash, storedHash);

    if (!matches) {
      pending.attemptsRemaining -= 1;
      if (pending.attemptsRemaining <= 0) {
        file.pending = file.pending.filter((entry) => entry !== pending);
      }
      await writeResetFile(file);
      throw statusError("The reset code is invalid or expired.", 400);
    }

    // Consume the code before changing the password so concurrent submissions cannot reuse it.
    file.pending = file.pending.filter((entry) => entry !== pending);
    await writeResetFile(file);
  });
}

export async function requestPortalPasswordReset(input: { email: string; ip: string }) {
  const email = normalizeEmail(input.email);
  const ip = normalizeIp(input.ip);

  if (!email) {
    throw statusError("A valid email is required.", 400);
  }

  // Apply the same limits to registered and unregistered addresses so the response
  // cannot be used to discover which emails have portal access.
  await consumeResetRequestLimit(email, ip);

  const resolution = await resolvePortalLogin(email);
  if (!resolution.allowed) {
    return { ok: true };
  }

  const code = String(randomInt(100000, 1_000_000));
  const requestId = await savePendingReset(email, code);

  try {
    await sendGmailReceipt({
      to: email,
      subject: "[CozoroHome] Password reset code",
      body: [
        `Your CozoroHome password reset code is: ${code}`,
        "Mã đặt lại mật khẩu CozoroHome của bạn ở trên.",
        "",
        "This code expires in 10 minutes and can only be used once.",
        "Mã này hết hạn sau 10 phút và chỉ có thể sử dụng một lần.",
        "",
        "If you did not request a password reset, you can ignore this email.",
        "Nếu bạn không yêu cầu đặt lại mật khẩu, bạn có thể bỏ qua email này."
      ].join("\n")
    });
  } catch (error) {
    await removePendingReset(email, requestId);
    console.error("[portal-password-reset] Unable to deliver reset email", error);
  }

  return { ok: true };
}

export async function confirmPortalPasswordReset(input: {
  email: string;
  code: string;
  newPassword: string;
}) {
  const email = normalizeEmail(input.email);
  const code = input.code.trim();
  const newPassword = input.newPassword.trim();

  if (!/^\d{6}$/.test(code)) {
    throw statusError("The reset code is invalid or expired.", 400);
  }
  if (newPassword.length < 8) {
    throw statusError("New password must be at least 8 characters long.", 400);
  }

  await consumeValidResetCode(email, code);

  const resolution = await resolvePortalLogin(email);
  if (!resolution.allowed) {
    throw statusError("The reset code is invalid or expired.", 400);
  }

  await upsertStoredPassword(email, newPassword, { mustChangePassword: false });
  return { ok: true };
}

