import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getActiveClientByEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const microwaveStateFilePath = path.join(cacheDirPath, "microwave-state.json");
const MICROWAVE_BRANCH = "D2";
const MICROWAVE_COOLDOWN_MINUTES = 5;

type MicrowaveUsageRecord = {
  startedAt: string;
  availableAt: string;
  startedByEmail: string;
  startedByName: string;
  inspection: string;
};

type MicrowaveStateFile = {
  currentUse: MicrowaveUsageRecord | null;
  lastUse: MicrowaveUsageRecord | null;
};

export type UserMicrowaveContext = {
  email: string;
  name: string;
  branchId: string;
  eligible: boolean;
  cooldownMinutes: number;
  status: {
    inUse: boolean;
    availableNow: boolean;
    availableAt: string | null;
    currentUse: MicrowaveUsageRecord | null;
    lastUse: MicrowaveUsageRecord | null;
  };
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

async function readStateFile() {
  return ensureJsonFile<MicrowaveStateFile>(microwaveStateFilePath, {
    currentUse: null,
    lastUse: null
  });
}

async function writeStateFile(state: MicrowaveStateFile) {
  await mkdir(path.dirname(microwaveStateFilePath), { recursive: true });
  await writeFile(microwaveStateFilePath, JSON.stringify(state, null, 2), "utf8");
}

function getClientValue(client: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = client[alias];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeBranch(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7";
  }
  return "D2";
}

function getCurrentUseIfActive(state: MicrowaveStateFile) {
  if (!state.currentUse) return null;
  const availableAtMs = new Date(state.currentUse.availableAt).getTime();
  if (Number.isNaN(availableAtMs) || availableAtMs <= Date.now()) return null;
  return state.currentUse;
}

export async function getUserMicrowaveContext(email: string): Promise<UserMicrowaveContext> {
  const normalizedEmail = normalizeEmail(email);
  const client = await getActiveClientByEmail(normalizedEmail);

  if (!client) throw new Error("No active client found for that email");

  const state = await readStateFile();
  const activeUse = getCurrentUseIfActive(state);
  const branchId = normalizeBranch(
    getClientValue(client, ["Chi nhánh Cozoro dorm", "Chi nhÃ¡nh Cozoro dorm"])
  );
  const clientName = getClientValue(client, ["Tên", "TÃªn"]);

  if (!activeUse && state.currentUse) {
    state.currentUse = null;
    await writeStateFile(state);
  }

  return {
    email: normalizedEmail,
    name: clientName.trim(),
    branchId,
    eligible: branchId === MICROWAVE_BRANCH,
    cooldownMinutes: MICROWAVE_COOLDOWN_MINUTES,
    status: {
      inUse: Boolean(activeUse),
      availableNow: !activeUse,
      availableAt: activeUse?.availableAt ?? null,
      currentUse: activeUse,
      lastUse: state.lastUse
    }
  };
}

export async function startMicrowaveUse(input: { email: string; inspection: string }) {
  const context = await getUserMicrowaveContext(input.email);

  if (!context.eligible) {
    throw new Error("This microwave is only available for D2 users.");
  }

  if (context.status.currentUse) {
    const startedBySameUser =
      normalizeEmail(context.status.currentUse.startedByEmail) === normalizeEmail(context.email);
    throw new Error(
      startedBySameUser
        ? "You already started the microwave."
        : `The microwave is in use until ${context.status.currentUse.availableAt}.`
    );
  }

  const startedAt = new Date();
  const availableAt = new Date(startedAt.getTime() + MICROWAVE_COOLDOWN_MINUTES * 60 * 1000);
  const nextUse: MicrowaveUsageRecord = {
    startedAt: startedAt.toISOString(),
    availableAt: availableAt.toISOString(),
    startedByEmail: context.email,
    startedByName: context.name || context.email,
    inspection: input.inspection
  };

  const nextState: MicrowaveStateFile = {
    currentUse: nextUse,
    lastUse: nextUse
  };
  await writeStateFile(nextState);

  return {
    ok: true,
    usage: nextUse,
    cooldownMinutes: MICROWAVE_COOLDOWN_MINUTES
  };
}
