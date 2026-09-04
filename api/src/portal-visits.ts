import { prisma } from "./prisma.js";

const DEDUPE_WINDOW_MS = 20 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_PATH_LEN = 120;

export type RecordPortalVisitInput = {
  email: string;
  role?: string | null;
  path: string;
  branchId?: string | null;
  device?: string | null;
};

export type PortalVisitRow = {
  id: string;
  email: string;
  role: string | null;
  path: string;
  branchId: string | null;
  device: string | null;
  createdAt: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePath(value: string) {
  let path = String(value ?? "").trim();
  if (!path) return "/";
  // Drop query/hash; keep app route only.
  const q = path.indexOf("?");
  if (q >= 0) path = path.slice(0, q);
  const h = path.indexOf("#");
  if (h >= 0) path = path.slice(0, h);
  if (!path.startsWith("/")) path = `/${path}`;
  // Collapse manager workspace query-ish view segments already in path.
  if (path.length > MAX_PATH_LEN) path = path.slice(0, MAX_PATH_LEN);
  return path;
}

function normalizeDevice(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "mobile" || raw === "desktop" || raw === "tablet") return raw;
  return null;
}

function normalizeBranch(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "D2" || raw === "D7") return raw;
  if (raw === "2") return "D2";
  if (raw === "7") return "D7";
  return null;
}

/**
 * Record a portal screen visit. Dedupes the same email+path within ~20 minutes.
 */
export async function recordPortalVisit(input: RecordPortalVisitInput): Promise<{
  recorded: boolean;
  id?: string;
}> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("Valid email is required");
  }
  const path = normalizePath(input.path);
  const role = String(input.role ?? "").trim().toLowerCase() || null;
  const branchId = normalizeBranch(input.branchId);
  const device = normalizeDevice(input.device);

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await prisma.portalVisit.findFirst({
    where: {
      email,
      path,
      createdAt: { gte: since }
    },
    select: { id: true },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    return { recorded: false, id: existing.id };
  }

  const created = await prisma.portalVisit.create({
    data: {
      email,
      role,
      path,
      branchId,
      device
    },
    select: { id: true }
  });
  return { recorded: true, id: created.id };
}

export async function purgeOldPortalVisits(retentionDays = DEFAULT_RETENTION_DAYS): Promise<{ deleted: number }> {
  const days = Math.min(365, Math.max(7, Math.trunc(retentionDays) || DEFAULT_RETENTION_DAYS));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.portalVisit.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  return { deleted: result.count };
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getPortalVisitAnalytics(options?: { days?: number; recentLimit?: number }) {
  const days = Math.min(90, Math.max(1, Math.trunc(options?.days ?? 14) || 14));
  const recentLimit = Math.min(300, Math.max(20, Math.trunc(options?.recentLimit ?? 80) || 80));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const visits = await prisma.portalVisit.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      path: true,
      branchId: true,
      device: true,
      createdAt: true
    }
  });

  const uniqueVisitors = new Set(visits.map((v) => v.email));
  const byPath = new Map<string, number>();
  const byRole = new Map<string, number>();
  const byDay = new Map<string, { visits: number; visitors: Set<string> }>();
  const byEmail = new Map<string, { email: string; role: string | null; visits: number; lastAt: Date }>();

  for (const visit of visits) {
    byPath.set(visit.path, (byPath.get(visit.path) ?? 0) + 1);
    const roleKey = visit.role || "unknown";
    byRole.set(roleKey, (byRole.get(roleKey) ?? 0) + 1);

    const key = dayKey(visit.createdAt);
    const day = byDay.get(key) ?? { visits: 0, visitors: new Set<string>() };
    day.visits += 1;
    day.visitors.add(visit.email);
    byDay.set(key, day);

    const person = byEmail.get(visit.email);
    if (!person) {
      byEmail.set(visit.email, {
        email: visit.email,
        role: visit.role,
        visits: 1,
        lastAt: visit.createdAt
      });
    } else {
      person.visits += 1;
      if (visit.createdAt > person.lastAt) {
        person.lastAt = visit.createdAt;
        if (visit.role) person.role = visit.role;
      }
    }
  }

  const topPaths = [...byPath.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const roleCounts = [...byRole.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);

  const daily = [...byDay.entries()]
    .map(([day, value]) => ({
      day,
      visits: value.visits,
      uniqueVisitors: value.visitors.size
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const topUsers = [...byEmail.values()]
    .sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return b.lastAt.getTime() - a.lastAt.getTime();
    })
    .slice(0, 40)
    .map((row) => ({
      email: row.email,
      role: row.role,
      visits: row.visits,
      lastAt: row.lastAt.toISOString()
    }));

  const recent: PortalVisitRow[] = visits.slice(0, recentLimit).map((visit) => ({
    id: visit.id,
    email: visit.email,
    role: visit.role,
    path: visit.path,
    branchId: visit.branchId,
    device: visit.device,
    createdAt: visit.createdAt.toISOString()
  }));

  return {
    days,
    since: since.toISOString(),
    generatedAt: new Date().toISOString(),
    totals: {
      visits: visits.length,
      uniqueVisitors: uniqueVisitors.size
    },
    daily,
    topPaths,
    roleCounts,
    topUsers,
    recent
  };
}
