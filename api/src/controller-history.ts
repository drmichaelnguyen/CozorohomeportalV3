import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const cacheDirPath = path.join(process.cwd(), "data");
const controllerHistoryFilePath = path.join(cacheDirPath, "controller-history.json");
const MAX_HISTORY_ENTRIES = 500;

export type ControllerHistoryEntry = {
  id: string;
  timestamp: string;
  actorRole: "manager" | "resident";
  actorEmail: string | null;
  actorName: string;
  deviceType: "ac" | "laundry" | "airfryer" | "microwave";
  deviceId: string;
  deviceLabel: string;
  branchId: string;
  action: string;
  details?: string;
};

type ControllerHistoryFile = {
  entries: ControllerHistoryEntry[];
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

async function readHistoryFile() {
  return ensureJsonFile<ControllerHistoryFile>(controllerHistoryFilePath, { entries: [] });
}

async function writeHistoryFile(file: ControllerHistoryFile) {
  await mkdir(path.dirname(controllerHistoryFilePath), { recursive: true });
  await writeFile(controllerHistoryFilePath, JSON.stringify(file, null, 2), "utf8");
}

export async function appendControllerHistoryEntry(
  entry: Omit<ControllerHistoryEntry, "id" | "timestamp"> & { timestamp?: string }
) {
  const file = await readHistoryFile();
  const nextEntry: ControllerHistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    actorRole: entry.actorRole,
    actorEmail: entry.actorEmail,
    actorName: entry.actorName,
    deviceType: entry.deviceType,
    deviceId: entry.deviceId,
    deviceLabel: entry.deviceLabel,
    branchId: entry.branchId,
    action: entry.action,
    details: entry.details
  };

  file.entries.unshift(nextEntry);
  file.entries = file.entries.slice(0, MAX_HISTORY_ENTRIES);
  await writeHistoryFile(file);
  return nextEntry;
}

export async function listControllerHistory(limit = 50) {
  const file = await readHistoryFile();
  return file.entries.slice(0, Math.max(1, Math.min(limit, MAX_HISTORY_ENTRIES)));
}
