import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { google } from "googleapis";

import { getActiveClientByEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const staffAccessFilePath = path.join(cacheDirPath, "portal-staff-access.json");
const DEFAULT_APP_ADMIN_EMAILS = (
  process.env.PORTAL_APP_ADMIN_EMAILS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [
    "cozorohome@gmail.com"
  ]
).map((email) => email.toLowerCase());
const DEFAULT_OWNER_EMAILS = (
  process.env.PORTAL_OWNER_EMAILS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [
    "dr.trongto@gmail.com"
  ]
).map((email) => email.toLowerCase());
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const googlePortalAuthClient = googleClientId ? new google.auth.OAuth2(googleClientId) : null;

export type StaffRole = "manager" | "owner" | "app_admin" | "mechanic";

export const ALL_DATA_CATEGORIES = [
  "clients",
  "fines",
  "payments",
  "cleaning",
  "laundry",
  "support",
  "coins",
  "stats"
] as const;

export type DataCategory = (typeof ALL_DATA_CATEGORIES)[number];

export type ManagerPermissions = {
  branches: string[];  // e.g. ["D2", "D7"] — empty means access to all
  data: Partial<Record<DataCategory, { read: boolean; write: boolean }>>;
};

type StaffAccessEntry = {
  email: string;
  role: StaffRole;
  name?: string;
  addedAt: string;
  addedBy: string;
  permissions?: ManagerPermissions;
};

type StaffAccessFile = {
  staff: StaffAccessEntry[];
};

export type PortalLoginRole = "user" | StaffRole;

export function getGooglePortalClientConfig() {
  return {
    enabled: Boolean(googleClientId),
    clientId: googleClientId || null
  };
}

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeStaffRole(role: string | undefined, email: string): StaffRole {
  if (role === "app_admin" || role === "owner" || role === "manager" || role === "mechanic") {
    return role;
  }

  if (role === "cozoro") {
    return DEFAULT_APP_ADMIN_EMAILS.includes(email) ? "app_admin" : "manager";
  }

  return DEFAULT_APP_ADMIN_EMAILS.includes(email) ? "app_admin" : "manager";
}

function getRoleRank(role: StaffRole) {
  if (role === "app_admin") {
    return 3;
  }

  if (role === "owner") {
    return 2;
  }

  return 1;
}

function mergeDefaultStaff(entries: StaffAccessEntry[]) {
  const existing = new Map(
    entries.map((entry) => {
      const normalizedEmail = normalizeEmail(entry.email);
      return [
        normalizedEmail,
        {
          ...entry,
          email: normalizedEmail,
          role: normalizeStaffRole(entry.role, normalizedEmail)
        }
      ] as const;
    })
  );

  for (const adminEmail of DEFAULT_APP_ADMIN_EMAILS) {
    const normalized = normalizeEmail(adminEmail);
    const existingEntry = existing.get(normalized);
    if (!existingEntry) {
      existing.set(normalized, {
        email: normalized,
        role: "app_admin",
        addedAt: new Date(0).toISOString(),
        addedBy: "system"
      });
      continue;
    }

    if (existingEntry.role !== "app_admin") {
      existing.set(normalized, {
        ...existingEntry,
        role: "app_admin"
      });
    }
  }

  for (const ownerEmail of DEFAULT_OWNER_EMAILS) {
    const normalized = normalizeEmail(ownerEmail);
    const existingEntry = existing.get(normalized);
    if (!existingEntry) {
      existing.set(normalized, {
        email: normalized,
        role: "owner",
        addedAt: new Date(0).toISOString(),
        addedBy: "system"
      });
      continue;
    }

    if (existingEntry.role !== "app_admin" && existingEntry.role !== "owner") {
      existing.set(normalized, {
        ...existingEntry,
        role: "owner"
      });
    }
  }

  return Array.from(existing.values()).sort((left, right) => {
    const roleRankDifference = getRoleRank(right.role) - getRoleRank(left.role);
    if (roleRankDifference !== 0) {
      return roleRankDifference;
    }

    return left.email.localeCompare(right.email);
  });
}

async function readStaffAccessFile() {
  const file = await ensureJsonFile<StaffAccessFile>(staffAccessFilePath, { staff: [] });
  const mergedStaff = mergeDefaultStaff(file.staff ?? []);

  if (mergedStaff.length !== (file.staff ?? []).length || mergedStaff.some((entry, index) => file.staff?.[index]?.role !== entry.role || file.staff?.[index]?.email !== entry.email)) {
    await writeFile(staffAccessFilePath, JSON.stringify({ staff: mergedStaff }, null, 2), "utf8");
  }

  return { staff: mergedStaff } satisfies StaffAccessFile;
}

async function writeStaffAccessFile(file: StaffAccessFile) {
  await mkdir(path.dirname(staffAccessFilePath), { recursive: true });
  await writeFile(staffAccessFilePath, JSON.stringify({ staff: mergeDefaultStaff(file.staff) }, null, 2), "utf8");
}

async function getStaffEntryByEmail(email: string) {
  const file = await readStaffAccessFile();
  return file.staff.find((entry) => normalizeEmail(entry.email) === normalizeEmail(email)) ?? null;
}

export async function resolvePortalLogin(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const [client, staffEntry] = await Promise.all([
    getActiveClientByEmail(normalizedEmail),
    getStaffEntryByEmail(normalizedEmail)
  ]);

  if (staffEntry) {
    return {
      allowed: true,
      email: normalizedEmail,
      role: staffEntry.role as PortalLoginRole,
      source: "staff" as const
    };
  }

  if (client) {
    return {
      allowed: true,
      email: normalizedEmail,
      role: "user" as PortalLoginRole,
      source: "client" as const
    };
  }

  return {
    allowed: false,
    email: normalizedEmail,
    role: null,
    source: null
  };
}

export async function resolveGooglePortalLogin(idToken: string) {
  if (!googlePortalAuthClient || !googleClientId) {
    throw new Error("Google sign-in is not configured on the API.");
  }

  const ticket = await googlePortalAuthClient.verifyIdToken({
    idToken,
    audience: googleClientId
  });
  const payload = ticket.getPayload();
  const email = payload?.email;

  if (!email) {
    throw new Error("Your Google account email could not be verified.");
  }

  const verifiedEmail = normalizeEmail(email);

  if (payload.email_verified !== true || !verifiedEmail) {
    throw new Error("Your Google account email could not be verified.");
  }

  return resolvePortalLogin(verifiedEmail);
}

export async function listStaffAccess(actorEmail: string) {
  await requirePortalRole(
    actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can view app management accounts."
  );

  const file = await readStaffAccessFile();
  return file.staff;
}

export async function requirePortalManager(actorEmail: string) {
  return requirePortalRole(
    actorEmail,
    ["manager", "owner", "app_admin"],
    "Only app admins, owners, or managers can access this area."
  );
}

export async function assertCanManageStaffAccess(input: {
  actorEmail: string;
  targetEmail: string;
  nextRole: StaffRole;
}) {
  const actor = await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only app admins or owners can update app management roles."
  );
  const targetEmail = normalizeEmail(input.targetEmail);
  const target = await resolvePortalLogin(targetEmail);
  const targetRole = target.role;

  if (!targetEmail) {
    throw new Error("A target email is required.");
  }

  if (actor.email === targetEmail) {
    throw new Error("Use another account to change your own management role.");
  }

  if (actor.role === "owner") {
    if (input.nextRole !== "manager") {
      throw new Error("Owners can only create or update manager accounts.");
    }

    if (targetRole === "owner" || targetRole === "app_admin") {
      throw new Error("Owners cannot update app admin or owner accounts.");
    }
  }

  if (actor.role === "app_admin" && input.nextRole === "app_admin") {
    throw new Error("Create additional app admins directly in configuration.");
  }

  return {
    actor,
    target,
    targetEmail
  };
}

export async function assertCanRemoveStaffAccess(input: {
  actorEmail: string;
  targetEmail: string;
}) {
  const actor = await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only app admins or owners can remove app management roles."
  );
  const targetEmail = normalizeEmail(input.targetEmail);
  const target = await resolvePortalLogin(targetEmail);

  if (!targetEmail) {
    throw new Error("A target email is required.");
  }

  if (actor.email === targetEmail) {
    throw new Error("Use another account to remove your own management role.");
  }

  if (actor.role === "owner" && (target.role === "owner" || target.role === "app_admin")) {
    throw new Error("Owners cannot remove app admin or owner accounts.");
  }

  if (target.role === "app_admin") {
    throw new Error("App admin access is managed through configuration.");
  }

  return {
    actor,
    targetEmail
  };
}

export async function assertCanResetPortalPassword(input: {
  actorEmail: string;
  targetEmail: string;
}) {
  const actor = await requirePortalRole(
    input.actorEmail,
    ["manager", "owner", "app_admin"],
    "Only app admins, owners, or managers can reset other users' passwords."
  );
  const targetEmail = normalizeEmail(input.targetEmail);

  if (!targetEmail) {
    throw new Error("A target email is required.");
  }

  if (actor.email === targetEmail) {
    throw new Error("Use Change Password to update your own password.");
  }

  const target = await resolvePortalLogin(targetEmail);
  if (!target.allowed || !target.role) {
    throw new Error("Only active users or approved app management emails can receive a portal password.");
  }

  if (target.role === "app_admin") {
    throw new Error("App admin passwords can only be changed by the app admin account directly.");
  }

  if (actor.role === "manager" && target.role !== "user") {
    throw new Error("Managers can only reset passwords for residents.");
  }

  if (actor.role === "owner" && target.role === "owner") {
    throw new Error("Owners cannot reset other owner passwords.");
  }

  return {
    actor,
    target
  };
}

export async function requirePortalRole(
  actorEmail: string,
  allowedRoles: StaffRole[],
  errorMessage = "You do not have permission to access this area."
) {
  const actor = await resolvePortalLogin(actorEmail);

  if (!actor.allowed || !actor.role || actor.role === "user" || !allowedRoles.includes(actor.role)) {
    throw new Error(errorMessage);
  }

  return {
    ...actor,
    role: actor.role
  };
}

export async function upsertStaffAccess(input: {
  actorEmail: string;
  targetEmail: string;
  role: StaffRole;
  name?: string;
}) {
  const { targetEmail: normalizedTargetEmail } = await assertCanManageStaffAccess({
    actorEmail: input.actorEmail,
    targetEmail: input.targetEmail,
    nextRole: input.role
  });

  const file = await readStaffAccessFile();
  const existingIndex = file.staff.findIndex((entry) => normalizeEmail(entry.email) === normalizedTargetEmail);
  const nextEntry: StaffAccessEntry = {
    email: normalizedTargetEmail,
    role: input.role,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    addedAt: new Date().toISOString(),
    addedBy: normalizeEmail(input.actorEmail)
  };

  if (existingIndex >= 0) {
    file.staff[existingIndex] = {
      ...file.staff[existingIndex],
      role: input.role,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      addedAt: nextEntry.addedAt,
      addedBy: nextEntry.addedBy
    };
  } else {
    file.staff.push(nextEntry);
  }

  await writeStaffAccessFile(file);

  return {
    ok: true,
    staff: (await readStaffAccessFile()).staff
  };
}

export async function getStaffName(email: string): Promise<string | null> {
  const file = await readStaffAccessFile();
  const entry = file.staff.find((s) => normalizeEmail(s.email) === normalizeEmail(email));
  return entry?.name?.trim() || null;
}

export async function updateSelfName(actorEmail: string, name: string): Promise<{ ok: boolean; name: string }> {
  const normalized = normalizeEmail(actorEmail);
  const file = await readStaffAccessFile();
  const found = file.staff.some((s) => normalizeEmail(s.email) === normalized);
  if (!found) {
    throw new Error("Your account was not found in staff access.");
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Display name cannot be empty.");
  }
  const updatedStaff = file.staff.map((s) =>
    normalizeEmail(s.email) === normalized ? { ...s, name: trimmed } : s
  );
  await writeStaffAccessFile({ staff: updatedStaff });
  return { ok: true, name: trimmed };
}

export async function removeStaffAccess(input: {
  actorEmail: string;
  targetEmail: string;
}) {
  const { targetEmail: normalizedTargetEmail } = await assertCanRemoveStaffAccess(input);

  const file = await readStaffAccessFile();
  const nextStaff = file.staff.filter((entry) => normalizeEmail(entry.email) !== normalizedTargetEmail);

  await writeStaffAccessFile({ staff: nextStaff });

  return {
    ok: true,
    staff: (await readStaffAccessFile()).staff
  };
}

export async function getManagerPermissions(actorEmail: string, targetEmail: string): Promise<ManagerPermissions> {
  const normalized = normalizeEmail(actorEmail);
  const target = normalizeEmail(targetEmail);
  // Owner/app_admin can view any; manager can only view their own
  const actor = await resolvePortalLogin(normalized);
  if (!actor.allowed || !actor.role || actor.role === "user") {
    throw new Error("You do not have permission to view manager permissions.");
  }
  if (actor.role === "manager" && normalized !== target) {
    throw new Error("Managers can only view their own permissions.");
  }
  const file = await readStaffAccessFile();
  const entry = file.staff.find(s => normalizeEmail(s.email) === target);
  return entry?.permissions ?? { branches: [], data: {} };
}

export async function setManagerPermissions(actorEmail: string, targetEmail: string, permissions: ManagerPermissions): Promise<void> {
  // Only owner or app_admin can set permissions
  const actor = await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners or app admins can set manager permissions.");
  const target = normalizeEmail(targetEmail);
  const file = await readStaffAccessFile();
  const idx = file.staff.findIndex(s => normalizeEmail(s.email) === target);
  if (idx === -1) {
    throw new Error("Staff member not found.");
  }
  // Owner cannot set permissions on other owner or app_admin
  if (actor.role === "owner") {
    const targetEntry = file.staff[idx];
    if (targetEntry.role === "owner" || targetEntry.role === "app_admin") {
      throw new Error("Owners cannot edit permissions for owner or app_admin accounts.");
    }
  }
  file.staff[idx] = { ...file.staff[idx], permissions };
  await writeStaffAccessFile(file);
}
