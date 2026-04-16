import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getUserAcControllerContext, listActiveEmailsForAcRoom } from "./ac-controller.js";
import { COZORO_TIMEZONE } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const comfortFilePath = path.join(cacheDirPath, "ac-comfort-votes.json");

export type ComfortVote = "HOT" | "COLD";

type RoomVoteEntry = {
  votes: Record<string, ComfortVote>;
  updatedAt: string;
};

export type AcComfortAlert = {
  id: string;
  roomId: string;
  roomLabel: string;
  branchId: "D2" | "D7";
  complaint: ComfortVote;
  createdAt: string;
  occupantCount: number;
  voteCount: number;
  resolved: boolean;
};

type ComfortFile = {
  rooms: Record<string, RoomVoteEntry>;
  alerts: AcComfortAlert[];
};

async function ensureComfortFile(): Promise<ComfortFile> {
  await mkdir(path.dirname(comfortFilePath), { recursive: true });
  try {
    const raw = await readFile(comfortFilePath, "utf8");
    const data = JSON.parse(raw) as ComfortFile;
    if (!data.rooms || typeof data.rooms !== "object") data.rooms = {};
    if (!Array.isArray(data.alerts)) data.alerts = [];
    return data;
  } catch {
    const empty: ComfortFile = { rooms: {}, alerts: [] };
    await writeFile(comfortFilePath, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

async function writeComfortFile(data: ComfortFile) {
  await mkdir(path.dirname(comfortFilePath), { recursive: true });
  await writeFile(comfortFilePath, JSON.stringify(data, null, 2), "utf8");
}

/** Strict majority of all occupants: count > N/2 */
function hasMajority(count: number, occupantCount: number) {
  if (occupantCount <= 0) return false;
  return count * 2 > occupantCount;
}

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function hasRecentUnresolvedAlert(alerts: AcComfortAlert[], roomId: string, now: number) {
  return alerts.some(
    (a) =>
      a.roomId === roomId &&
      !a.resolved &&
      new Date(a.createdAt).getTime() > now - ALERT_COOLDOWN_MS
  );
}

function pruneVotesForOccupants(votes: Record<string, ComfortVote>, occupants: Set<string>) {
  const next: Record<string, ComfortVote> = {};
  for (const email of Object.keys(votes)) {
    if (occupants.has(email)) {
      next[email] = votes[email]!;
    }
  }
  return next;
}

export type AcComfortPublicStatus = {
  roomId: string | null;
  roomLabel: string | null;
  occupantCount: number;
  hotCount: number;
  coldCount: number;
  myVote: ComfortVote | null;
  majorityHot: boolean;
  majorityCold: boolean;
};

export async function getAcComfortPublicStatus(email: string): Promise<AcComfortPublicStatus | null> {
  const ctx = await getUserAcControllerContext(email);
  if (!ctx.room) {
    return null;
  }

  const roomId = ctx.room.id;
  const occupants = await listActiveEmailsForAcRoom(roomId);
  const occupantSet = new Set(occupants);
  const file = await ensureComfortFile();
  const raw = file.rooms[roomId] ?? { votes: {}, updatedAt: new Date().toISOString() };
  const pruned = pruneVotesForOccupants(raw.votes, occupantSet);
  if (JSON.stringify(pruned) !== JSON.stringify(raw.votes)) {
    file.rooms[roomId] = { votes: pruned, updatedAt: new Date().toISOString() };
    await writeComfortFile(file);
  }
  const entry = { votes: pruned, updatedAt: raw.updatedAt };

  const normalizedEmail = email.trim().toLowerCase();
  let hotCount = 0;
  let coldCount = 0;
  for (const em of occupants) {
    const v = entry.votes[em];
    if (v === "HOT") hotCount += 1;
    if (v === "COLD") coldCount += 1;
  }

  const n = occupants.length;
  return {
    roomId,
    roomLabel: ctx.room.label,
    occupantCount: n,
    hotCount,
    coldCount,
    myVote: entry.votes[normalizedEmail] ?? null,
    majorityHot: hasMajority(hotCount, n),
    majorityCold: hasMajority(coldCount, n)
  };
}

export async function submitAcComfortVote(input: { email: string; vote: ComfortVote }) {
  const vote = input.vote;
  if (vote !== "HOT" && vote !== "COLD") {
    throw new Error("vote must be HOT or COLD");
  }

  const ctx = await getUserAcControllerContext(input.email);
  if (!ctx.room) {
    throw new Error("No AC room mapping is configured for this user");
  }

  const roomId = ctx.room.id;
  const occupants = await listActiveEmailsForAcRoom(roomId);
  const occupantSet = new Set(occupants);
  const normalizedEmail = input.email.trim().toLowerCase();

  if (!occupantSet.has(normalizedEmail)) {
    throw new Error("Your account is not listed in this room occupancy");
  }

  const file = await ensureComfortFile();
  const prev = file.rooms[roomId] ?? { votes: {}, updatedAt: new Date().toISOString() };
  const votes = pruneVotesForOccupants(prev.votes, occupantSet);
  votes[normalizedEmail] = vote;

  file.rooms[roomId] = {
    votes,
    updatedAt: new Date().toISOString()
  };

  let hotCount = 0;
  let coldCount = 0;
  for (const em of occupants) {
    const v = votes[em];
    if (v === "HOT") hotCount += 1;
    if (v === "COLD") coldCount += 1;
  }

  const n = occupants.length;
  const majorityHot = hasMajority(hotCount, n);
  const majorityCold = hasMajority(coldCount, n);

  const now = Date.now();
  let newAlert: AcComfortAlert | null = null;
  if (majorityHot && !majorityCold) {
    newAlert = {
      id: `ac-comfort-${randomUUID()}`,
      roomId,
      roomLabel: ctx.room.label,
      branchId: ctx.branchId,
      complaint: "HOT",
      createdAt: new Date().toISOString(),
      occupantCount: n,
      voteCount: hotCount,
      resolved: false
    };
  } else if (majorityCold && !majorityHot) {
    newAlert = {
      id: `ac-comfort-${randomUUID()}`,
      roomId,
      roomLabel: ctx.room.label,
      branchId: ctx.branchId,
      complaint: "COLD",
      createdAt: new Date().toISOString(),
      occupantCount: n,
      voteCount: coldCount,
      resolved: false
    };
  }
  let didCreateAlert = false;
  if (newAlert && !hasRecentUnresolvedAlert(file.alerts, roomId, now)) {
    file.alerts.push(newAlert);
    didCreateAlert = true;
  }

  await writeComfortFile(file);

  return {
    ok: true as const,
    roomId,
    roomLabel: ctx.room.label,
    occupantCount: n,
    hotCount,
    coldCount,
    myVote: vote,
    majorityHot,
    majorityCold,
    didCreateAlert
  };
}

export async function loadOpenAcComfortAlertsForStaff(): Promise<AcComfortAlert[]> {
  const file = await ensureComfortFile();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return file.alerts.filter(
    (a) => !a.resolved && now - new Date(a.createdAt).getTime() < weekMs
  );
}

export async function dismissAcComfortAlert(input: { alertId: string }) {
  const file = await ensureComfortFile();
  const alert = file.alerts.find((a) => a.id === input.alertId);
  if (!alert) {
    throw new Error("Alert not found");
  }
  alert.resolved = true;
  await writeComfortFile(file);
  return { ok: true as const };
}
