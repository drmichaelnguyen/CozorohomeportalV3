import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isBranchAutomationDisabled } from "./branch-closure.js";
import { appendControllerHistoryEntry } from "./controller-history.js";
import { getActiveClientByEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const cookerStateFilePath = path.join(cacheDirPath, "cooker-state.json");

const DEFAULT_MAX_ON_MINUTES = 60;
const MAX_HISTORY = 200;

export type CookerBranchId = "D2" | "D7";
export type CookerNumber = 1 | 2;

export type CookerDevice = {
  id: string;
  label: string;
  number: CookerNumber;
  branchId: CookerBranchId;
};

export type CookerSession = {
  id: string;
  deviceId: string;
  cookerNumber: CookerNumber;
  branchId: CookerBranchId;
  startedAt: string;
  startedByEmail: string;
  startedByName: string;
  lastRequestedAction: "ON" | "OFF";
  lastRequestedAt: string;
  inspection: string;
  endedAt: string | null;
  endedByEmail: string | null;
  endedByName: string | null;
  closedReason?: "manual" | "timeout" | "staff" | null;
};

type CookerStateFile = {
  currentByDeviceId: Partial<Record<string, CookerSession | null>>;
  lastByDeviceId: Partial<Record<string, CookerSession | null>>;
  history: CookerSession[];
};

export type CookerUnitStatus = {
  cooker: {
    id: string;
    label: string;
    number: CookerNumber;
    iftttConfigured: boolean;
  };
  inUse: boolean;
  availableNow: boolean;
  isMine: boolean;
  autoOffAt: string | null;
  currentUse: CookerSession | null;
  lastUse: CookerSession | null;
};

export type UserCookerContext = {
  email: string;
  name: string;
  branchId: CookerBranchId;
  eligible: boolean;
  maxOnMinutes: number;
  cookers: CookerUnitStatus[];
};

const COOKER_DEVICES: CookerDevice[] = [
  { id: "d7-cooker-1", label: "Cooker 1", number: 1, branchId: "D7" },
  { id: "d7-cooker-2", label: "Cooker 2", number: 2, branchId: "D7" },
  { id: "d2-cooker-1", label: "Cooker 1", number: 1, branchId: "D2" },
  { id: "d2-cooker-2", label: "Cooker 2", number: 2, branchId: "D2" }
];

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

function emptyState(): CookerStateFile {
  return {
    currentByDeviceId: {},
    lastByDeviceId: {},
    history: []
  };
}

function normalizeSession(raw: Partial<CookerSession> & Record<string, unknown>): CookerSession {
  return {
    id: String(raw.id || randomUUID()),
    deviceId: String(raw.deviceId || ""),
    cookerNumber: (raw.cookerNumber === 2 ? 2 : 1) as CookerNumber,
    branchId: raw.branchId === "D2" ? "D2" : "D7",
    startedAt: String(raw.startedAt || ""),
    startedByEmail: String(raw.startedByEmail || ""),
    startedByName: String(raw.startedByName || raw.startedByEmail || ""),
    lastRequestedAction: raw.lastRequestedAction === "OFF" ? "OFF" : "ON",
    lastRequestedAt: String(raw.lastRequestedAt || raw.startedAt || ""),
    inspection: String(raw.inspection || ""),
    endedAt: raw.endedAt ? String(raw.endedAt) : null,
    endedByEmail: raw.endedByEmail ? String(raw.endedByEmail) : null,
    endedByName: raw.endedByName ? String(raw.endedByName) : null,
    closedReason: raw.closedReason === "timeout" || raw.closedReason === "staff" || raw.closedReason === "manual" ? raw.closedReason : null
  };
}

function migrateLegacyState(raw: Record<string, unknown>): CookerStateFile {
  const currentByDeviceId: CookerStateFile["currentByDeviceId"] = {};
  const lastByDeviceId: CookerStateFile["lastByDeviceId"] = {};

  if (raw.currentByDeviceId && typeof raw.currentByDeviceId === "object") {
    for (const [deviceId, session] of Object.entries(raw.currentByDeviceId as Record<string, unknown>)) {
      currentByDeviceId[deviceId] = session && typeof session === "object" ? normalizeSession(session as CookerSession) : null;
    }
    for (const [deviceId, session] of Object.entries((raw.lastByDeviceId as Record<string, unknown>) || {})) {
      lastByDeviceId[deviceId] = session && typeof session === "object" ? normalizeSession(session as CookerSession) : null;
    }
    return {
      currentByDeviceId,
      lastByDeviceId,
      history: Array.isArray(raw.history)
        ? (raw.history as Record<string, unknown>[]).map((session) => normalizeSession(session as CookerSession))
        : []
    };
  }

  const currentByBranch = (raw.currentByBranch ?? {}) as Partial<Record<CookerBranchId, Record<string, unknown>>>;
  const lastByBranch = (raw.lastByBranch ?? {}) as Partial<Record<CookerBranchId, Record<string, unknown>>>;
  for (const branch of ["D7", "D2"] as CookerBranchId[]) {
    const deviceId = `${branch.toLowerCase()}-cooker-1`;
    const current = currentByBranch[branch];
    if (current) {
      currentByDeviceId[deviceId] = normalizeSession({ ...current, deviceId, cookerNumber: 1, branchId: branch });
    }
    const last = lastByBranch[branch];
    if (last) {
      lastByDeviceId[deviceId] = normalizeSession({ ...last, deviceId, cookerNumber: 1, branchId: branch });
    }
  }

  return {
    currentByDeviceId,
    lastByDeviceId,
    history: Array.isArray(raw.history)
      ? (raw.history as Record<string, unknown>[]).map((session) =>
          normalizeSession({
            ...session,
            deviceId: String(session.deviceId || `${String(session.branchId || "d7").toLowerCase()}-cooker-1`),
            cookerNumber: session.cookerNumber === 2 ? 2 : 1
          })
        )
      : []
  };
}

async function readStateFile() {
  const raw = await ensureJsonFile<Record<string, unknown>>(cookerStateFilePath, emptyState());
  return migrateLegacyState(raw);
}

async function writeStateFile(state: CookerStateFile) {
  await mkdir(path.dirname(cookerStateFilePath), { recursive: true });
  await writeFile(cookerStateFilePath, JSON.stringify(state, null, 2), "utf8");
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

function normalizeBranch(value: string): CookerBranchId {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7";
  }
  return "D2";
}

export function getCookerMaxOnMinutes() {
  const parsed = Number.parseInt(process.env.COOKER_MAX_ON_MINUTES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ON_MINUTES;
}

function cookerDevicesForBranch(branchId: CookerBranchId) {
  return COOKER_DEVICES.filter((device) => device.branchId === branchId);
}

function findCookerDevice(machineId: string) {
  return COOKER_DEVICES.find((device) => device.id === machineId) ?? null;
}

function envEventName(device: CookerDevice, action: "ON" | "OFF") {
  const numbered = action === "ON"
    ? `COOKER_${device.branchId}_${device.number}_IFTTT_ON_EVENT`
    : `COOKER_${device.branchId}_${device.number}_IFTTT_OFF_EVENT`;
  const fallback = action === "ON"
    ? `COOKER_${device.branchId}_IFTTT_ON_EVENT`
    : `COOKER_${device.branchId}_IFTTT_OFF_EVENT`;
  return process.env[numbered]?.trim() || (device.number === 1 ? process.env[fallback]?.trim() || "" : "");
}

export function isCookerIftttConfigured(device: CookerDevice) {
  return Boolean(envEventName(device, "ON") && envEventName(device, "OFF"));
}

function buildWebhookUrl(eventName: string) {
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();
  if (!key) {
    throw new Error("IFTTT webhook key is not configured");
  }
  return `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName.trim())}/json/with/key/${encodeURIComponent(key)}`;
}

async function triggerCookerIfttt(device: CookerDevice, action: "ON" | "OFF", value3: string) {
  const eventName = envEventName(device, action);
  if (!eventName || !process.env.IFTTT_WEBHOOK_KEY?.trim()) {
    return { configured: false as const };
  }

  const response = await fetch(buildWebhookUrl(eventName), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      value1: device.label,
      value2: device.branchId,
      value3: value3 || action
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "IFTTT cooker request failed");
  }

  return { configured: true as const };
}

function sessionActive(session: CookerSession | null | undefined) {
  return Boolean(session && session.lastRequestedAction === "ON" && !session.endedAt);
}

function autoOffAt(session: CookerSession | null | undefined) {
  if (!sessionActive(session) || !session) {
    return null;
  }
  const startedAtMs = new Date(session.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return null;
  }
  return new Date(startedAtMs + getCookerMaxOnMinutes() * 60 * 1000).toISOString();
}

function sessionOverdue(session: CookerSession | null | undefined, now = Date.now()) {
  const deadline = autoOffAt(session);
  if (!deadline) {
    return false;
  }
  return new Date(deadline).getTime() <= now;
}

function rememberSession(state: CookerStateFile, session: CookerSession) {
  state.lastByDeviceId[session.deviceId] = session;
  state.history = [session, ...state.history.filter((entry) => entry.id !== session.id)].slice(0, MAX_HISTORY);
}

function buildUnitStatus(device: CookerDevice, state: CookerStateFile, email: string): CookerUnitStatus {
  const current = state.currentByDeviceId[device.id] ?? null;
  const last = state.lastByDeviceId[device.id] ?? null;
  const inUse = sessionActive(current);
  const isMine = Boolean(inUse && current && normalizeEmail(current.startedByEmail) === email);
  return {
    cooker: {
      id: device.id,
      label: device.label,
      number: device.number,
      iftttConfigured: isCookerIftttConfigured(device)
    },
    inUse,
    availableNow: !inUse,
    isMine,
    autoOffAt: autoOffAt(current),
    currentUse: inUse ? current : null,
    lastUse: last
  };
}

export async function listCookerDevices() {
  const state = await readStateFile();
  return COOKER_DEVICES.filter((device) => !isBranchAutomationDisabled(device.branchId)).map((device) => {
    const current = state.currentByDeviceId[device.id] ?? null;
    const last = state.lastByDeviceId[device.id] ?? null;
    return {
      ...device,
      iftttConfigured: isCookerIftttConfigured(device),
      lastRequestedAction: current?.lastRequestedAction ?? last?.lastRequestedAction ?? null,
      lastRequestedAt: current?.lastRequestedAt ?? last?.lastRequestedAt ?? null
    };
  });
}

export async function getUserCookerContext(email: string): Promise<UserCookerContext> {
  const normalizedEmail = normalizeEmail(email);
  const client = await getActiveClientByEmail(normalizedEmail);
  if (!client) {
    throw new Error("No active client found for that email");
  }

  const branchId = normalizeBranch(
    getClientValue(client, ["Chi nhánh Cozoro dorm", "Chi nhÃ¡nh Cozoro dorm"])
  );
  const clientName = getClientValue(client, ["Tên", "TÃªn"]);
  const eligible = !isBranchAutomationDisabled(branchId) && cookerDevicesForBranch(branchId).length > 0;
  const state = await readStateFile();
  const cookers = eligible
    ? cookerDevicesForBranch(branchId).map((device) => buildUnitStatus(device, state, normalizedEmail))
    : [];

  return {
    email: normalizedEmail,
    name: clientName.trim(),
    branchId,
    eligible,
    maxOnMinutes: getCookerMaxOnMinutes(),
    cookers
  };
}

function requireDeviceForResident(context: UserCookerContext, machineId: string) {
  if (!context.eligible) {
    throw new Error("The cooker is not available for this account.");
  }
  const device = findCookerDevice(machineId);
  if (!device || device.branchId !== context.branchId) {
    throw new Error("Unknown cooker.");
  }
  const unit = context.cookers.find((entry) => entry.cooker.id === machineId);
  if (!unit) {
    throw new Error("Unknown cooker.");
  }
  return { device, unit };
}

export async function startCookerUse(input: { email: string; machineId: string; inspection: string }) {
  const inspection = input.inspection.trim();
  if (!inspection) {
    throw new Error("Please inspect the cooker before turning it on.");
  }

  const context = await getUserCookerContext(input.email);
  const { device, unit } = requireDeviceForResident(context, input.machineId);
  if (unit.inUse && unit.isMine) {
    throw new Error(`${device.label} is already on. It will turn off automatically after ${context.maxOnMinutes} minutes.`);
  }
  if (unit.inUse && !unit.isMine) {
    throw new Error(
      `${device.label} is in use until ${unit.autoOffAt ? new Date(unit.autoOffAt).toISOString() : "the current session ends"}.`
    );
  }

  const startedAt = new Date();
  const session: CookerSession = {
    id: randomUUID(),
    deviceId: device.id,
    cookerNumber: device.number,
    branchId: device.branchId,
    startedAt: startedAt.toISOString(),
    startedByEmail: context.email,
    startedByName: context.name || context.email,
    lastRequestedAction: "ON",
    lastRequestedAt: startedAt.toISOString(),
    inspection,
    endedAt: null,
    endedByEmail: null,
    endedByName: null,
    closedReason: null
  };

  await triggerCookerIfttt(device, "ON", context.email);

  const state = await readStateFile();
  state.currentByDeviceId[device.id] = session;
  rememberSession(state, session);
  await writeStateFile(state);

  return { ok: true as const, session, cooker: { id: device.id, label: device.label, number: device.number } };
}

export async function stopCookerUse(input: { email: string; machineId: string }) {
  const context = await getUserCookerContext(input.email);
  const { device, unit } = requireDeviceForResident(context, input.machineId);
  const current = unit.currentUse;
  if (!current || !unit.inUse) {
    throw new Error(`${device.label} is not currently on.`);
  }
  if (!unit.isMine) {
    throw new Error(`Only the resident who turned ${device.label} on can turn it off.`);
  }

  const endedAt = new Date().toISOString();
  const nextSession: CookerSession = {
    ...current,
    lastRequestedAction: "OFF",
    lastRequestedAt: endedAt,
    endedAt,
    endedByEmail: context.email,
    endedByName: context.name || context.email,
    closedReason: "manual"
  };

  await triggerCookerIfttt(device, "OFF", context.email);

  const state = await readStateFile();
  state.currentByDeviceId[device.id] = null;
  rememberSession(state, nextSession);
  await writeStateFile(state);

  return { ok: true as const, session: nextSession, cooker: { id: device.id, label: device.label, number: device.number } };
}

export async function sendManagerCookerCommand(input: { machineId: string; action: "ON" | "OFF"; actorEmail?: string }) {
  const device = findCookerDevice(input.machineId);
  if (!device) {
    throw new Error("Cooker mapping not found");
  }
  if (isBranchAutomationDisabled(device.branchId)) {
    throw new Error("This cooker is not available.");
  }

  const now = new Date().toISOString();
  const state = await readStateFile();
  const current = state.currentByDeviceId[device.id] ?? null;

  await triggerCookerIfttt(device, input.action, input.actorEmail?.trim() || "manager");

  if (input.action === "ON") {
    const session: CookerSession =
      current && sessionActive(current)
        ? { ...current, lastRequestedAction: "ON", lastRequestedAt: now }
        : {
            id: randomUUID(),
            deviceId: device.id,
            cookerNumber: device.number,
            branchId: device.branchId,
            startedAt: now,
            startedByEmail: normalizeEmail(input.actorEmail || "manager"),
            startedByName: "Manager",
            lastRequestedAction: "ON",
            lastRequestedAt: now,
            inspection: "Staff override",
            endedAt: null,
            endedByEmail: null,
            endedByName: null,
            closedReason: null
          };
    state.currentByDeviceId[device.id] = session;
    rememberSession(state, session);
  } else if (current && !current.endedAt) {
    const closed: CookerSession = {
      ...current,
      lastRequestedAction: "OFF",
      lastRequestedAt: now,
      endedAt: now,
      endedByEmail: normalizeEmail(input.actorEmail || "manager"),
      endedByName: "Manager",
      closedReason: "staff"
    };
    state.currentByDeviceId[device.id] = null;
    rememberSession(state, closed);
  } else {
    const last = state.lastByDeviceId[device.id];
    if (last) {
      rememberSession(state, { ...last, lastRequestedAction: "OFF", lastRequestedAt: now });
    }
    state.currentByDeviceId[device.id] = null;
  }

  await writeStateFile(state);
  return {
    ok: true as const,
    cooker: { id: device.id, label: device.label, number: device.number, branchId: device.branchId },
    action: input.action,
    requestedAt: now
  };
}

export async function listCookerUsageForStaff(limit = 40) {
  const state = await readStateFile();
  const byId = new Map<string, CookerSession>();
  for (const session of state.history) {
    byId.set(session.id, session);
  }
  for (const session of Object.values(state.lastByDeviceId)) {
    if (session) {
      byId.set(session.id, session);
    }
  }
  for (const session of Object.values(state.currentByDeviceId)) {
    if (session) {
      byId.set(session.id, session);
    }
  }

  const sessions = [...byId.values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, Math.max(1, Math.min(limit, 80)))
    .map((session) => {
      const device = findCookerDevice(session.deviceId);
      return {
        sessionId: session.id,
        deviceId: session.deviceId,
        cookerLabel: device?.label || session.deviceId,
        cookerNumber: session.cookerNumber,
        branchId: session.branchId,
        startedAt: session.startedAt,
        startedByEmail: session.startedByEmail,
        startedByName: session.startedByName,
        endedAt: session.endedAt,
        inspection: session.inspection || "",
        inUse: sessionActive(session),
        autoOffAt: autoOffAt(session),
        closedReason: session.closedReason ?? null
      };
    });

  return { maxOnMinutes: getCookerMaxOnMinutes(), sessions };
}

export async function sweepExpiredCookerSessions() {
  const state = await readStateFile();
  const now = Date.now();
  const results: Array<{ sessionId: string; deviceId: string }> = [];

  for (const device of COOKER_DEVICES) {
    if (isBranchAutomationDisabled(device.branchId)) {
      continue;
    }
    const current = state.currentByDeviceId[device.id] ?? null;
    if (!sessionActive(current) || !current || !sessionOverdue(current, now)) {
      continue;
    }

    try {
      await triggerCookerIfttt(device, "OFF", current.startedByEmail);
    } catch (error) {
      console.error(`[cooker] auto-off webhook failed for ${device.id}`, error);
    }

    const endedAt = new Date().toISOString();
    const closed: CookerSession = {
      ...current,
      lastRequestedAction: "OFF",
      lastRequestedAt: endedAt,
      endedAt,
      endedByEmail: "system",
      endedByName: "Cooker controller",
      closedReason: "timeout"
    };
    state.currentByDeviceId[device.id] = null;
    rememberSession(state, closed);
    results.push({ sessionId: current.id, deviceId: device.id });

    void appendControllerHistoryEntry({
      actorRole: "resident",
      actorEmail: current.startedByEmail,
      actorName: current.startedByName || current.startedByEmail,
      deviceType: "cooker",
      deviceId: device.id,
      deviceLabel: device.label,
      branchId: device.branchId,
      action: "OFF",
      details: `auto-off after ${getCookerMaxOnMinutes()} minutes`,
      timestamp: endedAt
    }).catch((error) => {
      console.error("[cooker] auto-off history log failed", error);
    });
  }

  if (results.length > 0) {
    await writeStateFile(state);
  }

  return { checked: COOKER_DEVICES.length, closed: results.length, results };
}
