import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requirePortalRole } from "./staff-access.js";

const overrideFilePath = path.join(process.cwd(), "data", "account-lock-overrides.json");

type AccountLockOverrideEntry = {
  email: string;
  unlocked: boolean;
  forceLocked?: boolean;
  note: string;
  updatedAt: string;
  updatedBy: string;
};

type AccountLockOverrideFile = {
  entries: AccountLockOverrideEntry[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function ensureOverrideFile() {
  await mkdir(path.dirname(overrideFilePath), { recursive: true });

  try {
    const raw = await readFile(overrideFilePath, "utf8");
    const parsed = JSON.parse(raw) as AccountLockOverrideFile;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    } satisfies AccountLockOverrideFile;
  } catch {
    const fallback: AccountLockOverrideFile = { entries: [] };
    await writeFile(overrideFilePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeOverrideFile(file: AccountLockOverrideFile) {
  await mkdir(path.dirname(overrideFilePath), { recursive: true });
  await writeFile(overrideFilePath, JSON.stringify(file, null, 2), "utf8");
}

export async function getAccountLockOverride(email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  const file = await ensureOverrideFile();
  return file.entries.find((entry) => normalizeEmail(entry.email) === normalizedEmail) ?? null;
}

export async function setAccountLockOverride(input: {
  actorEmail: string;
  targetEmail: string;
  unlocked?: boolean;
  forceLocked?: boolean;
  note?: string;
}) {
  const actor = await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can change account lock overrides."
  );

  const targetEmail = normalizeEmail(input.targetEmail);
  if (!targetEmail) {
    throw new Error("A target email is required.");
  }

  const file = await ensureOverrideFile();
  const existingIndex = file.entries.findIndex((entry) => normalizeEmail(entry.email) === targetEmail);
  const nextEntry: AccountLockOverrideEntry = {
    email: targetEmail,
    unlocked: input.unlocked === true,
    forceLocked: input.forceLocked === true,
    note: input.note?.trim() ?? "",
    updatedAt: new Date().toISOString(),
    updatedBy: actor.email
  };

  if (existingIndex >= 0) {
    file.entries[existingIndex] = nextEntry;
  } else {
    file.entries.push(nextEntry);
  }

  await writeOverrideFile(file);

  return {
    ok: true,
    override: nextEntry
  };
}
