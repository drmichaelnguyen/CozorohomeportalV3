import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getActiveClientByEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const airFryerStateFilePath = path.join(cacheDirPath, "airfryer-state.json");
const AIRFRYER_BRANCH = "D7";
const AIRFRYER_COOLDOWN_MINUTES = Number(process.env.AIRFRYER_D7_COOLDOWN_MINUTES ?? 65);

type AirFryerUsageRecord = {
  startedAt: string;
  availableAt: string;
  startedByEmail: string;
  startedByName: string;
  inspection?: string;
};

type AirFryerStateFile = {
  currentUse: AirFryerUsageRecord | null;
  lastUse: AirFryerUsageRecord | null;
};

export type UserAirFryerContext = {
  email: string;
  name: string;
  branchId: string;
  eligible: boolean;
  cooldownMinutes: number;
  status: {
    inUse: boolean;
    availableNow: boolean;
    availableAt: string | null;
    currentUse: AirFryerUsageRecord | null;
    lastUse: AirFryerUsageRecord | null;
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
  return ensureJsonFile<AirFryerStateFile>(airFryerStateFilePath, {
    currentUse: null,
    lastUse: null
  });
}

async function writeStateFile(state: AirFryerStateFile) {
  await mkdir(path.dirname(airFryerStateFilePath), { recursive: true });
  await writeFile(airFryerStateFilePath, JSON.stringify(state, null, 2), "utf8");
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

function getCurrentUseIfActive(state: AirFryerStateFile) {
  if (!state.currentUse) {
    return null;
  }

  const availableAtMs = new Date(state.currentUse.availableAt).getTime();
  if (Number.isNaN(availableAtMs) || availableAtMs <= Date.now()) {
    return null;
  }

  return state.currentUse;
}

function buildWebhookUrl(eventName: string) {
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();

  if (!key) {
    throw new Error("IFTTT webhook key is not configured");
  }

  return `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName.trim())}/json/with/key/${encodeURIComponent(key)}`;
}

async function triggerIftttEvent(record: AirFryerUsageRecord) {
  const eventName = process.env.AIRFRYER_D7_IFTTT_EVENT?.trim();

  if (!eventName) {
    return {
      configured: false
    };
  }

  const response = await fetch(buildWebhookUrl(eventName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      value1: process.env.AIRFRYER_D7_IFTTT_VALUE1?.trim() || `${record.startedByName} (${record.inspection || "No inspection"})`,
      value2: process.env.AIRFRYER_D7_IFTTT_VALUE2?.trim() || AIRFRYER_BRANCH,
      value3: process.env.AIRFRYER_D7_IFTTT_VALUE3?.trim() || record.startedByEmail
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "IFTTT request failed");
  }

  return {
    configured: true
  };
}

export async function getUserAirFryerContext(email: string): Promise<UserAirFryerContext> {
  const normalizedEmail = normalizeEmail(email);
  const client = await getActiveClientByEmail(normalizedEmail);

  if (!client) {
    throw new Error("No active client found for that email");
  }

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
    eligible: branchId === AIRFRYER_BRANCH,
    cooldownMinutes: AIRFRYER_COOLDOWN_MINUTES,
    status: {
      inUse: Boolean(activeUse),
      availableNow: !activeUse,
      availableAt: activeUse?.availableAt ?? null,
      currentUse: activeUse,
      lastUse: state.lastUse
    }
  };
}

export async function startAirFryerUse(input: { email: string; inspection: string }) {
  const context = await getUserAirFryerContext(input.email);

  if (!context.eligible) {
    throw new Error("This air fryer is only available for D7 users.");
  }

  if (context.status.currentUse) {
    const startedBySameUser =
      normalizeEmail(context.status.currentUse.startedByEmail) === normalizeEmail(context.email);
    throw new Error(
      startedBySameUser
        ? "You already started the air fryer cooldown window."
        : `The air fryer is in use until ${context.status.currentUse.availableAt}.`
    );
  }

  const startedAt = new Date();
  const availableAt = new Date(startedAt.getTime() + AIRFRYER_COOLDOWN_MINUTES * 60 * 1000);
  const nextUse: AirFryerUsageRecord & { inspection?: string } = {
    startedAt: startedAt.toISOString(),
    availableAt: availableAt.toISOString(),
    startedByEmail: context.email,
    startedByName: context.name || context.email,
    inspection: input.inspection
  };

  await triggerIftttEvent(nextUse);

  const nextState: AirFryerStateFile = {
    currentUse: nextUse,
    lastUse: nextUse
  };
  await writeStateFile(nextState);

  return {
    ok: true,
    usage: nextUse,
    cooldownMinutes: AIRFRYER_COOLDOWN_MINUTES
  };
}
