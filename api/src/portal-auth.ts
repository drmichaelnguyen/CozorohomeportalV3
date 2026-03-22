import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { getActiveClientByEmail } from "./google-sheets.js";
import { assertCanResetPortalPassword, resolvePortalLogin } from "./staff-access.js";

const authFilePath = path.join(process.cwd(), "data", "portal-auth.json");

type PortalAuthRecord = {
  email: string;
  salt: string;
  passwordHash: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
};

type PortalAuthFile = {
  records: PortalAuthRecord[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findClientPhoneNumber(row: Record<string, string>) {
  const phoneEntry = Object.entries(row).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }

    const normalizedKey = normalizeLookupKey(key);
    return (
      normalizedKey.includes("sodienthoailienhe") ||
      normalizedKey.includes("dienthoai") ||
      normalizedKey.includes("phone") ||
      normalizedKey.includes("lienhe")
    );
  });

  return String(phoneEntry?.[1] ?? "").replace(/\D+/g, "");
}

async function getClientDefaultPassword(email: string) {
  const client = await getActiveClientByEmail(email);
  if (!client) {
    throw new Error("Active client information could not be found for this account.");
  }

  const phoneNumber = findClientPhoneNumber(client);

  if (!phoneNumber) {
    throw new Error("This client is missing phone data needed to build the default password.");
  }

  return phoneNumber;
}

async function ensureAuthFile() {
  await mkdir(path.dirname(authFilePath), { recursive: true });

  try {
    const rawValue = await readFile(authFilePath, "utf8");
    const parsed = JSON.parse(rawValue) as PortalAuthFile;
    if (!Array.isArray(parsed.records)) {
      return { records: [] };
    }

    return {
      records: parsed.records.map((record) => ({
        ...record,
        mustChangePassword: record.mustChangePassword !== false
      }))
    };
  } catch {
    const fallback: PortalAuthFile = { records: [] };
    await writeFile(authFilePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeAuthFile(file: PortalAuthFile) {
  await mkdir(path.dirname(authFilePath), { recursive: true });
  await writeFile(authFilePath, JSON.stringify(file, null, 2), "utf8");
}

async function upsertStoredPassword(email: string, nextPassword: string, options?: { mustChangePassword?: boolean }) {
  const authFile = await ensureAuthFile();
  const existingRecord = authFile.records.find((record) => normalizeEmail(record.email) === email) ?? null;
  const now = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(nextPassword, salt);
  const mustChangePassword = options?.mustChangePassword ?? false;

  if (existingRecord) {
    existingRecord.salt = salt;
    existingRecord.passwordHash = passwordHash;
    existingRecord.mustChangePassword = mustChangePassword;
    existingRecord.updatedAt = now;
  } else {
    authFile.records.push({
      email,
      salt,
      passwordHash,
      mustChangePassword,
      createdAt: now,
      updatedAt: now
    });
  }

  await writeAuthFile(authFile);
}

export async function setPortalPassword(input: {
  email: string;
  password: string;
  mustChangePassword?: boolean;
}) {
  const email = normalizeEmail(input.email);
  const password = input.password.trim();

  if (!email) {
    throw new Error("A valid email is required.");
  }

  if (!password) {
    throw new Error("A password is required.");
  }

  await upsertStoredPassword(email, password, {
    mustChangePassword: input.mustChangePassword ?? true
  });

  return { ok: true };
}

export async function loginWithPortalPassword(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const password = input.password.trim();

  if (!email) {
    throw new Error("A valid email is required.");
  }

  if (!password) {
    throw new Error("A password is required.");
  }

  const resolution = await resolvePortalLogin(email);
  if (!resolution.allowed || !resolution.role || !resolution.source) {
    throw new Error("Only active users or approved app management emails can log in.");
  }

  const authFile = await ensureAuthFile();
  const existingRecord = authFile.records.find((record) => normalizeEmail(record.email) === email) ?? null;

  if (!existingRecord) {
    let passwordToStore = password;

    if (resolution.source === "client") {
      passwordToStore = await getClientDefaultPassword(email);
      if (password !== passwordToStore) {
        throw new Error("Incorrect password. Use your phone number for the first login.");
      }
    }

    const now = new Date().toISOString();
    const salt = randomBytes(16).toString("hex");
    authFile.records.push({
      email,
      salt,
      passwordHash: hashPassword(passwordToStore, salt),
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now
    });
    await writeAuthFile(authFile);

    return {
      ...resolution,
      createdPassword: true,
      mustChangePassword: true
    };
  }

  const incomingHash = Buffer.from(hashPassword(password, existingRecord.salt), "hex");
  const storedHash = Buffer.from(existingRecord.passwordHash, "hex");
  const matches =
    incomingHash.length === storedHash.length && timingSafeEqual(incomingHash, storedHash);

  if (!matches && resolution.source === "client") {
    const defaultPassword = await getClientDefaultPassword(email);
    if (password === defaultPassword) {
      await upsertStoredPassword(email, defaultPassword);

      return {
        ...resolution,
        createdPassword: false,
        mustChangePassword: existingRecord.mustChangePassword
      };
    }
  }

  if (!matches) {
    throw new Error("Incorrect password for this email.");
  }

  return {
    ...resolution,
    createdPassword: false,
    mustChangePassword: existingRecord.mustChangePassword
  };
}

export async function changePortalPassword(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
}) {
  const email = normalizeEmail(input.email);
  const currentPassword = input.currentPassword.trim();
  const newPassword = input.newPassword.trim();

  if (!email) {
    throw new Error("A valid email is required.");
  }

  if (!currentPassword || !newPassword) {
    throw new Error("Current and new passwords are required.");
  }

  if (newPassword.length < 4) {
    throw new Error("New password must be at least 4 characters long.");
  }

  await loginWithPortalPassword({
    email,
    password: currentPassword
  });

  await upsertStoredPassword(email, newPassword, { mustChangePassword: false });

  return {
    ok: true
  };
}

export async function adminSetPortalPassword(input: {
  actorEmail: string;
  targetEmail: string;
  newPassword: string;
}) {
  const actorEmail = normalizeEmail(input.actorEmail);
  const targetEmail = normalizeEmail(input.targetEmail);
  const newPassword = input.newPassword.trim();

  if (!actorEmail || !targetEmail) {
    throw new Error("Actor and target emails are required.");
  }

  if (newPassword.length < 4) {
    throw new Error("New password must be at least 4 characters long.");
  }

  await assertCanResetPortalPassword({
    actorEmail,
    targetEmail
  });

  await upsertStoredPassword(targetEmail, newPassword, { mustChangePassword: true });

  return {
    ok: true
  };
}
