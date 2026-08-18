import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isBranchAutomationDisabled } from "./branch-closure.js";
import { compressFineEvidence } from "./fine-evidence-compress.js";
import { createAutomaticFineForEmail, getActiveClientByEmail, sendFineTicketEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const cookerStateFilePath = path.join(cacheDirPath, "cooker-state.json");
const cookerPhotosDirPath = path.join(cacheDirPath, "cooker-photos");

const PHOTO_RETENTION_DAYS = 60;
const DEFAULT_MAX_ON_MINUTES = 90;
const DEFAULT_LEFT_ON_FINE_VND = 50_000;
const MAX_HISTORY = 200;

export type CookerBranchId = "D2" | "D7";
export type CookerPhotoKind = "cooker" | "kitchen" | "cleaned";

export type CookerPhotoRecord = {
  fileName: string;
  kind: CookerPhotoKind;
  uploadedAt: string;
  uploadedByEmail: string;
};

export type CookerSession = {
  id: string;
  branchId: CookerBranchId;
  startedAt: string;
  startedByEmail: string;
  startedByName: string;
  lastRequestedAction: "ON" | "OFF";
  lastRequestedAt: string;
  onPhotos: CookerPhotoRecord[];
  endedAt: string | null;
  endedByEmail: string | null;
  endedByName: string | null;
  offPhotos: CookerPhotoRecord[];
  leftoverFineIssuedAt: string | null;
  leftoverFineAmount: number | null;
};

type CookerStateFile = {
  currentByBranch: Partial<Record<CookerBranchId, CookerSession | null>>;
  lastByBranch: Partial<Record<CookerBranchId, CookerSession | null>>;
  history: CookerSession[];
};

export type CookerPhotoInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type UserCookerContext = {
  email: string;
  name: string;
  branchId: CookerBranchId;
  eligible: boolean;
  cooker: {
    id: string;
    label: string;
    iftttConfigured: boolean;
    maxOnMinutes: number;
    leftoverFineVnd: number;
  } | null;
  status: {
    inUse: boolean;
    availableNow: boolean;
    isMine: boolean;
    overdue: boolean;
    turnOffDeadlineAt: string | null;
    currentUse: CookerSession | null;
    lastUse: CookerSession | null;
  };
};

const COOKER_DEVICES: Array<{ id: string; label: string; branchId: CookerBranchId }> = [
  { id: "d7-cooker", label: "Cooker D7", branchId: "D7" },
  { id: "d2-cooker", label: "Cooker D2", branchId: "D2" }
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
  return { currentByBranch: {}, lastByBranch: {}, history: [] };
}

async function readStateFile() {
  return ensureJsonFile<CookerStateFile>(cookerStateFilePath, emptyState());
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

export function getCookerLeftOnFineVnd() {
  const parsed = Number.parseInt(process.env.COOKER_LEFT_ON_FINE_VND ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_LEFT_ON_FINE_VND;
  }
  return Math.trunc(parsed);
}

function cookerDeviceForBranch(branchId: CookerBranchId) {
  return COOKER_DEVICES.find((device) => device.branchId === branchId) ?? null;
}

function envEventName(branchId: CookerBranchId, action: "ON" | "OFF") {
  const key = action === "ON" ? `COOKER_${branchId}_IFTTT_ON_EVENT` : `COOKER_${branchId}_IFTTT_OFF_EVENT`;
  return process.env[key]?.trim() || "";
}

export function isCookerIftttConfigured(branchId: CookerBranchId) {
  return Boolean(envEventName(branchId, "ON") && envEventName(branchId, "OFF"));
}

function buildWebhookUrl(eventName: string) {
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();
  if (!key) {
    throw new Error("IFTTT webhook key is not configured");
  }
  return `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName.trim())}/json/with/key/${encodeURIComponent(key)}`;
}

async function triggerCookerIfttt(branchId: CookerBranchId, action: "ON" | "OFF", value3: string) {
  const eventName = envEventName(branchId, action);
  if (!eventName) {
    return { configured: false as const };
  }
  if (!process.env.IFTTT_WEBHOOK_KEY?.trim()) {
    return { configured: false as const };
  }

  const device = cookerDeviceForBranch(branchId);
  const response = await fetch(buildWebhookUrl(eventName), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      value1: device?.label ?? `Cooker ${branchId}`,
      value2: branchId,
      value3: value3 || action
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "IFTTT cooker request failed");
  }

  return { configured: true as const };
}

function sessionOverdue(session: CookerSession | null | undefined, now = Date.now()) {
  if (!session || session.lastRequestedAction !== "ON" || session.endedAt) {
    return false;
  }
  const startedAtMs = new Date(session.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return false;
  }
  return now - startedAtMs >= getCookerMaxOnMinutes() * 60 * 1000;
}

function turnOffDeadlineAt(session: CookerSession | null | undefined) {
  if (!session || session.lastRequestedAction !== "ON" || session.endedAt) {
    return null;
  }
  const startedAtMs = new Date(session.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return null;
  }
  return new Date(startedAtMs + getCookerMaxOnMinutes() * 60 * 1000).toISOString();
}

function rememberSession(state: CookerStateFile, session: CookerSession) {
  state.lastByBranch[session.branchId] = session;
  state.history = [session, ...state.history.filter((entry) => entry.id !== session.id)].slice(0, MAX_HISTORY);
}

async function savePhoto(input: CookerPhotoInput, kind: CookerPhotoKind, sessionId: string, email: string): Promise<CookerPhotoRecord> {
  const raw = Buffer.from(input.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!raw.length) {
    throw new Error("The uploaded cooker photo is empty.");
  }
  if (raw.byteLength > 12 * 1024 * 1024) {
    throw new Error("Each cooker photo must be 12 MB or smaller before compression.");
  }

  const compressed = await compressFineEvidence(raw, input.mimeType || "image/jpeg", input.fileName || `${kind}.jpg`);
  await mkdir(cookerPhotosDirPath, { recursive: true });
  const fileName = `cooker-${sessionId}-${kind}-${randomUUID()}.jpg`;
  await writeFile(path.join(cookerPhotosDirPath, fileName), compressed.buffer);

  return {
    fileName,
    kind,
    uploadedAt: new Date().toISOString(),
    uploadedByEmail: normalizeEmail(email)
  };
}

export async function purgeExpiredCookerPhotos(now = Date.now()) {
  const cutoff = now - PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await mkdir(cookerPhotosDirPath, { recursive: true });

  let names: string[] = [];
  try {
    names = await readdir(cookerPhotosDirPath);
  } catch {
    return { deleted: 0 };
  }

  let deleted = 0;
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
      continue;
    }
    const filePath = path.join(cookerPhotosDirPath, name);
    try {
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) {
        await unlink(filePath);
        deleted += 1;
      }
    } catch {
      // ignore missing files
    }
  }

  const state = await readStateFile();
  const before = state.history.length;
  state.history = state.history.filter((session) => {
    const stamp = new Date(session.endedAt || session.startedAt).getTime();
    return Number.isNaN(stamp) || stamp >= cutoff;
  });
  if (state.history.length !== before) {
    await writeStateFile(state);
  }

  return { deleted };
}

export async function listCookerDevices() {
  const state = await readStateFile();
  return COOKER_DEVICES.filter((device) => !isBranchAutomationDisabled(device.branchId)).map((device) => {
    const current = state.currentByBranch[device.branchId] ?? null;
    return {
      ...device,
      iftttConfigured: isCookerIftttConfigured(device.branchId),
      lastRequestedAction: current?.lastRequestedAction ?? state.lastByBranch[device.branchId]?.lastRequestedAction ?? null,
      lastRequestedAt: current?.lastRequestedAt ?? state.lastByBranch[device.branchId]?.lastRequestedAt ?? null
    };
  });
}

export async function getUserCookerContext(email: string): Promise<UserCookerContext> {
  const normalizedEmail = normalizeEmail(email);
  const client = await getActiveClientByEmail(normalizedEmail);
  if (!client) {
    throw new Error("No active client found for that email");
  }

  const branchId = normalizeBranch(getClientValue(client, ["Chi nhánh Cozoro dorm", "Chi nhÃ¡nh Cozoro dorm"]));
  const clientName = getClientValue(client, ["Tên", "TÃªn", "Họ và tên"]);
  const device = cookerDeviceForBranch(branchId);
  const eligible = Boolean(device) && !isBranchAutomationDisabled(branchId);
  const state = await readStateFile();
  const current = eligible ? state.currentByBranch[branchId] ?? null : null;
  const last = eligible ? state.lastByBranch[branchId] ?? null : null;
  const inUse = Boolean(current && current.lastRequestedAction === "ON" && !current.endedAt);

  return {
    email: normalizedEmail,
    name: clientName.trim(),
    branchId,
    eligible,
    cooker: eligible && device
      ? {
          id: device.id,
          label: device.label,
          iftttConfigured: isCookerIftttConfigured(branchId),
          maxOnMinutes: getCookerMaxOnMinutes(),
          leftoverFineVnd: getCookerLeftOnFineVnd()
        }
      : null,
    status: {
      inUse,
      availableNow: eligible && !inUse,
      isMine: Boolean(inUse && current && normalizeEmail(current.startedByEmail) === normalizedEmail),
      overdue: sessionOverdue(current),
      turnOffDeadlineAt: turnOffDeadlineAt(current),
      currentUse: inUse ? current : null,
      lastUse: last
    }
  };
}

async function requireResidentContext(email: string) {
  const context = await getUserCookerContext(email);
  if (!context.eligible || !context.cooker) {
    throw new Error("The cooker is not available for this account.");
  }
  return context;
}

export async function startCookerUse(input: {
  email: string;
  cookerPhoto: CookerPhotoInput;
  kitchenPhoto: CookerPhotoInput;
}) {
  const context = await requireResidentContext(input.email);
  if (context.status.inUse) {
    throw new Error(
      context.status.isMine
        ? "You already turned the cooker on. Take a cleaned photo to turn it off."
        : `The cooker is in use by ${context.status.currentUse?.startedByName || "another resident"}.`
    );
  }

  const startedAt = new Date();
  const session: CookerSession = {
    id: randomUUID(),
    branchId: context.branchId,
    startedAt: startedAt.toISOString(),
    startedByEmail: context.email,
    startedByName: context.name || context.email,
    lastRequestedAction: "ON",
    lastRequestedAt: startedAt.toISOString(),
    onPhotos: [],
    endedAt: null,
    endedByEmail: null,
    endedByName: null,
    offPhotos: [],
    leftoverFineIssuedAt: null,
    leftoverFineAmount: null
  };

  const cookerPhoto = await savePhoto(input.cookerPhoto, "cooker", session.id, context.email);
  const kitchenPhoto = await savePhoto(input.kitchenPhoto, "kitchen", session.id, context.email);
  session.onPhotos = [cookerPhoto, kitchenPhoto];

  await triggerCookerIfttt(context.branchId, "ON", context.email);

  const state = await readStateFile();
  state.currentByBranch[context.branchId] = session;
  rememberSession(state, session);
  await writeStateFile(state);
  void purgeExpiredCookerPhotos().catch((error) => {
    console.warn("[cooker] photo purge failed", error);
  });

  return { ok: true as const, session };
}

export async function stopCookerUse(input: { email: string; cleanedPhoto: CookerPhotoInput }) {
  const context = await requireResidentContext(input.email);
  const current = context.status.currentUse;
  if (!current || !context.status.inUse) {
    throw new Error("The cooker is not currently on.");
  }
  if (!context.status.isMine) {
    throw new Error("Only the resident who turned the cooker on can turn it off and upload the cleaned photo.");
  }

  const cleanedPhoto = await savePhoto(input.cleanedPhoto, "cleaned", current.id, context.email);
  const endedAt = new Date().toISOString();
  const nextSession: CookerSession = {
    ...current,
    lastRequestedAction: "OFF",
    lastRequestedAt: endedAt,
    endedAt,
    endedByEmail: context.email,
    endedByName: context.name || context.email,
    offPhotos: [...current.offPhotos, cleanedPhoto]
  };

  await triggerCookerIfttt(context.branchId, "OFF", context.email);

  const state = await readStateFile();
  state.currentByBranch[context.branchId] = null;
  rememberSession(state, nextSession);
  await writeStateFile(state);

  return { ok: true as const, session: nextSession };
}

export async function sendManagerCookerCommand(input: { machineId: string; action: "ON" | "OFF"; actorEmail?: string }) {
  const device = COOKER_DEVICES.find((entry) => entry.id === input.machineId);
  if (!device) {
    throw new Error("Cooker mapping not found");
  }
  if (isBranchAutomationDisabled(device.branchId)) {
    throw new Error("This cooker is not available.");
  }

  const now = new Date().toISOString();
  const state = await readStateFile();
  const current = state.currentByBranch[device.branchId] ?? null;

  await triggerCookerIfttt(device.branchId, input.action, input.actorEmail?.trim() || "manager");

  if (input.action === "ON") {
    const session: CookerSession = current && current.lastRequestedAction === "ON" && !current.endedAt
      ? { ...current, lastRequestedAction: "ON", lastRequestedAt: now }
      : {
          id: randomUUID(),
          branchId: device.branchId,
          startedAt: now,
          startedByEmail: normalizeEmail(input.actorEmail || "manager"),
          startedByName: "Manager",
          lastRequestedAction: "ON",
          lastRequestedAt: now,
          onPhotos: [],
          endedAt: null,
          endedByEmail: null,
          endedByName: null,
          offPhotos: [],
          leftoverFineIssuedAt: null,
          leftoverFineAmount: null
        };
    state.currentByBranch[device.branchId] = session;
    rememberSession(state, session);
  } else {
    if (current && !current.endedAt) {
      const closed: CookerSession = {
        ...current,
        lastRequestedAction: "OFF",
        lastRequestedAt: now,
        endedAt: now,
        endedByEmail: normalizeEmail(input.actorEmail || "manager"),
        endedByName: "Manager"
      };
      state.currentByBranch[device.branchId] = null;
      rememberSession(state, closed);
    } else {
      const last = state.lastByBranch[device.branchId];
      if (last) {
        rememberSession(state, { ...last, lastRequestedAction: "OFF", lastRequestedAt: now });
      }
      state.currentByBranch[device.branchId] = null;
    }
  }

  await writeStateFile(state);
  return {
    ok: true as const,
    cooker: { id: device.id, label: device.label, branchId: device.branchId },
    action: input.action,
    requestedAt: now
  };
}

export async function getCookerPhotoAbsolutePath(fileName: string) {
  const safe = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe || safe !== path.basename(fileName)) {
    throw new Error("Invalid cooker photo name.");
  }
  const absolutePath = path.join(cookerPhotosDirPath, safe);
  await readFile(absolutePath);
  return { absolutePath, mimeType: "image/jpeg" as const, fileName: safe };
}

export async function canViewCookerPhoto(fileName: string, viewerEmail: string) {
  const normalized = normalizeEmail(viewerEmail);
  const state = await readStateFile();
  const sessions = [
    ...Object.values(state.currentByBranch),
    ...Object.values(state.lastByBranch),
    ...state.history
  ].filter((session): session is CookerSession => Boolean(session));

  for (const session of sessions) {
    const photos = [...session.onPhotos, ...session.offPhotos];
    if (photos.some((photo) => photo.fileName === fileName)) {
      return (
        normalizeEmail(session.startedByEmail) === normalized ||
        normalizeEmail(session.endedByEmail || "") === normalized ||
        photos.some((photo) => normalizeEmail(photo.uploadedByEmail) === normalized)
      );
    }
  }
  return false;
}

async function issueLeftoverFine(session: CookerSession) {
  const amount = getCookerLeftOnFineVnd();
  if (amount <= 0) {
    return { issued: false as const, amount: 0 };
  }

  const content = "Forgot to turn off the cooker";
  const description = `Cooker ${session.branchId} left ON after ${getCookerMaxOnMinutes()} minutes. Session ${session.id} started ${session.startedAt}.`;
  const result = await createAutomaticFineForEmail({
    email: session.startedByEmail,
    amount,
    content,
    description,
    location: `Kitchen ${session.branchId}`,
    operator: "Cooker controller"
  });

  try {
    await sendFineTicketEmail({
      to: session.startedByEmail,
      clientName: session.startedByName || session.startedByEmail,
      amountVnd: amount,
      content,
      description,
      location: `Kitchen ${session.branchId}`,
      operator: "Cooker controller"
    });
  } catch (error) {
    console.error("[cooker] leftover fine email failed", error);
  }

  return { issued: true as const, amount, result };
}

export async function sweepForgottenCookerSessions() {
  await purgeExpiredCookerPhotos().catch((error) => {
    console.warn("[cooker] photo purge failed", error);
  });

  const state = await readStateFile();
  const now = Date.now();
  const results: Array<{ sessionId: string; branchId: CookerBranchId; fined: boolean }> = [];

  for (const device of COOKER_DEVICES) {
    if (isBranchAutomationDisabled(device.branchId)) {
      continue;
    }
    const current = state.currentByBranch[device.branchId] ?? null;
    if (!current || current.lastRequestedAction !== "ON" || current.endedAt) {
      continue;
    }
    if (!sessionOverdue(current, now)) {
      continue;
    }
    if (current.leftoverFineIssuedAt) {
      continue;
    }

    try {
      await triggerCookerIfttt(device.branchId, "OFF", current.startedByEmail);
    } catch (error) {
      console.error(`[cooker] leftover OFF webhook failed for ${device.branchId}`, error);
    }

    let fined = false;
    let amount: number | null = null;
    let fineIssuedAt: string | null = null;
    try {
      const fine = await issueLeftoverFine(current);
      fined = fine.issued;
      amount = fine.amount;
      if (fine.issued || fine.amount <= 0) {
        fineIssuedAt = new Date().toISOString();
      }
    } catch (error) {
      console.error(`[cooker] leftover fine failed for ${current.startedByEmail}`, error);
    }

    const endedAt = new Date().toISOString();
    const closed: CookerSession = {
      ...current,
      lastRequestedAction: "OFF",
      lastRequestedAt: endedAt,
      endedAt,
      endedByEmail: "system",
      endedByName: "Cooker controller",
      leftoverFineIssuedAt: fineIssuedAt,
      leftoverFineAmount: amount
    };
    state.currentByBranch[device.branchId] = null;
    rememberSession(state, closed);
    results.push({ sessionId: current.id, branchId: device.branchId, fined });
  }

  for (const session of state.history) {
    if (session.endedByEmail !== "system" || session.leftoverFineIssuedAt || getCookerLeftOnFineVnd() <= 0) {
      continue;
    }
    try {
      const fine = await issueLeftoverFine(session);
      session.leftoverFineIssuedAt = new Date().toISOString();
      session.leftoverFineAmount = fine.amount;
      rememberSession(state, session);
      results.push({ sessionId: session.id, branchId: session.branchId, fined: fine.issued });
    } catch (error) {
      console.error(`[cooker] leftover fine retry failed for ${session.startedByEmail}`, error);
    }
  }

  if (results.length > 0) {
    await writeStateFile(state);
  }

  return { checked: COOKER_DEVICES.length, closed: results.length, results };
}
