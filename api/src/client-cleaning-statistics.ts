import { prisma } from "./prisma.js";
import { getManagerClients } from "./google-sheets.js";
import { getManagerPermissions, requirePortalRole } from "./staff-access.js";

export async function getClientCleaningStatistics(input: {
  actorEmail: string; maHd: string; details?: boolean; offset?: number;
}) {
  const actor = await requirePortalRole(input.actorEmail, ["manager", "owner", "app_admin"], "Only staff can view client cleaning statistics.");
  const client = (await getManagerClients()).find(entry => entry.maHd === input.maHd);
  if (!client) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  const permissions = actor.role === "manager" ? await getManagerPermissions(actor.email, actor.email) : null;
  if (permissions?.data.cleaning && !permissions.data.cleaning.read) {
    throw Object.assign(new Error("Cleaning read permission is required."), { statusCode: 403 });
  }
  const normalizeBranch = (value: string) => `D${value.trim().toUpperCase().replace(/^D/, "")}`;
  const branches = permissions?.branches.map(normalizeBranch) ?? [];
  if (branches.length && !branches.includes(normalizeBranch(client.branch))) {
    throw Object.assign(new Error("This resident is outside your branch permissions."), { statusCode: 403 });
  }
  const where = {
    userEmail: client.email.trim().toLowerCase(),
    ...(branches.length ? { branchId: { in: branches } } : {})
  };
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  if (input.details) {
    const tasks = await prisma.cleaningTask.findMany({
      where, orderBy: [{ scheduledDate: "desc" }, { id: "asc" }], skip: offset, take: 26,
      select: {
        id: true, scheduledDate: true, type: true, branchId: true, floor: true, status: true,
        assignmentSource: true, isSelfAssigned: true, assignmentExplanation: true,
        assignedByName: true, rewardCoins: true, completedAt: true, auditorNote: true
      }
    });
    return { tasks: tasks.slice(0, 25), nextOffset: tasks.length > 25 ? offset + 25 : null };
  }
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const upcomingWhere = { ...where, status: "ASSIGNED" as const, scheduledDate: { gte: new Date(`${todayKey}T00:00:00.000Z`) } };
  const [statuses, sources, upcoming, next, exemption] = await Promise.all([
    prisma.cleaningTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.cleaningTask.groupBy({ by: ["assignmentSource", "isSelfAssigned"], where, _count: { _all: true } }),
    prisma.cleaningTask.count({ where: upcomingWhere }),
    prisma.cleaningTask.findFirst({ where: upcomingWhere, orderBy: { scheduledDate: "asc" }, select: { scheduledDate: true, type: true } }),
    prisma.cleaningAssignmentExemption.findUnique({ where: { userEmail: where.userEmail }, select: { exempt: true } })
  ]);
  const byStatus = Object.fromEntries(statuses.map(row => [row.status, row._count._all]));
  const bySource: Record<string, number> = { SELF: 0, SYSTEM: 0, MANAGER: 0, LEGACY: 0 };
  for (const row of sources) {
    const source = row.assignmentSource === "SELF" || row.isSelfAssigned ? "SELF" : row.assignmentSource ?? "LEGACY";
    bySource[source] = (bySource[source] ?? 0) + row._count._all;
  }
  return { summary: {
    total: statuses.reduce((sum, row) => sum + row._count._all, 0), byStatus, bySource,
    upcoming, next, automaticAssignmentExempt: exemption?.exempt ?? false
  } };
}
