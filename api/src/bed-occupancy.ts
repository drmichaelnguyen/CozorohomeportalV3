import { getManagerClients } from "./google-sheets.js";
import { prisma } from "./prisma.js";

const INVENTORY = { D2: 21, D7: 63 } as const;

function vietnamCalendarParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) };
}

function canonicalBranch(value: unknown): keyof typeof INVENTORY | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (text.includes("7")) return "D7";
  if (text.includes("2")) return "D2";
  return null;
}

function parseBed(value: unknown): number | null {
  const bed = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(bed) && bed > 0 ? bed : null;
}

function isActive(value: unknown) {
  return String(value ?? "").trim() === "1";
}

export async function captureMonthlyBedOccupancy(now = new Date(), force = false) {
  const calendar = vietnamCalendarParts(now);
  if (!force && calendar.day < 15) return { captured: false, reason: "before_mid_month" as const };

  const month = `${calendar.year}-${String(calendar.month).padStart(2, "0")}`;
  const snapshotDate = new Date(Date.UTC(calendar.year, calendar.month - 1, 15, 12));
  const existing = await prisma.bedOccupancySnapshot.count({ where: { month } });
  if (!force && existing >= Object.keys(INVENTORY).length) {
    return { captured: false, reason: "already_captured" as const, month };
  }

  const clients = (await getManagerClients()).filter((client) => isActive(client.activeStay));
  const results = [];
  for (const branchId of Object.keys(INVENTORY) as Array<keyof typeof INVENTORY>) {
    const branchClients = clients.filter((client) => canonicalBranch(client.branch) === branchId);
    const occupied = new Set<number>();
    let unassignedUsers = 0;
    for (const client of branchClients) {
      const bed = parseBed(client.bed);
      if (bed != null && bed <= INVENTORY[branchId]) occupied.add(bed);
      else unassignedUsers++;
    }
    const occupiedBeds = occupied.size;
    results.push(await prisma.bedOccupancySnapshot.upsert({
      where: { month_branchId: { month, branchId } },
      create: {
        month,
        branchId,
        snapshotDate,
        totalBeds: INVENTORY[branchId],
        occupiedBeds,
        availableBeds: INVENTORY[branchId] - occupiedBeds,
        unassignedUsers
      },
      update: force ? {
        snapshotDate,
        totalBeds: INVENTORY[branchId],
        occupiedBeds,
        availableBeds: INVENTORY[branchId] - occupiedBeds,
        unassignedUsers,
        capturedAt: new Date()
      } : {}
    }));
  }
  return { captured: true, month, snapshots: results };
}

export async function getBedOccupancyHistory(months = 24) {
  const safeMonths = Math.min(120, Math.max(1, Math.trunc(months)));
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - safeMonths + 1, 1);
  from.setUTCHours(0, 0, 0, 0);
  const snapshots = await prisma.bedOccupancySnapshot.findMany({
    where: { snapshotDate: { gte: from } },
    orderBy: [{ snapshotDate: "asc" }, { branchId: "asc" }]
  });
  return { months: safeMonths, snapshots };
}
