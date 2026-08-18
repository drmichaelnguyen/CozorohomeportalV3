import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isBranchAutomationDisabled } from "./branch-closure.js";
import { compressFineEvidence } from "./fine-evidence-compress.js";
import {
  COZORO_TIMEZONE,
  createAutomaticFineForEmail,
  getActiveClientByEmail,
  getManagerClients,
  managerCreateFine,
  sendFineTicketEmail,
  sendGmailReceipt,
  uploadFineImageToDrive
} from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const cookerStateFilePath = path.join(cacheDirPath, "cooker-state.json");
const cookerPhotosDirPath = path.join(cacheDirPath, "cooker-photos");

const PHOTO_RETENTION_DAYS = 60;
const DEFAULT_MAX_ON_MINUTES = 30;
const DEFAULT_LEFT_ON_FINE_VND = 50_000;
const MAX_HISTORY = 200;
export const COOKER_SESSION_MINUTES = 30;
export const COOKER_RESERVE_MAX_ADVANCE_DAYS = 3;
export const COOKER_RESERVE_MAX_SESSIONS_PER_DAY = 2;
const LEFTOVER_REMINDER_LIMIT = 2;

export type CookerBranchId = "D2" | "D7";
export type CookerNumber = 1 | 2;
export type CookerPhotoKind = "cooker" | "kitchen" | "cleaned";

export type CookerDevice = {
  id: string;
  label: string;
  number: CookerNumber;
  branchId: CookerBranchId;
};

export type CookerPhotoRecord = {
  fileName: string;
  kind: CookerPhotoKind;
  uploadedAt: string;
  uploadedByEmail: string;
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
  onPhotos: CookerPhotoRecord[];
  endedAt: string | null;
  endedByEmail: string | null;
  endedByName: string | null;
  offPhotos: CookerPhotoRecord[];
  leftoverFineIssuedAt: string | null;
  leftoverFineAmount: number | null;
  leftoverWarningOnly?: boolean;
  reservationId?: string | null;
  closedReason?: "checkout" | "takeover" | "timeout" | null;
};

export type CookerReservation = {
  id: string;
  deviceId: string;
  cookerNumber: CookerNumber;
  branchId: CookerBranchId;
  email: string;
  name: string;
  startAt: string;
  endAt: string;
  status: "booked" | "checked_in" | "checked_out" | "expired" | "cancelled";
  createdAt: string;
};

export type CookerLeftoverNotice = {
  id: string;
  email: string;
  cookerLabel: string;
  createdAt: string;
  strike: number;
  fined: boolean;
  amount: number | null;
  reason: "takeover" | "timeout" | "manual";
};

type CookerStateFile = {
  currentByDeviceId: Partial<Record<string, CookerSession | null>>;
  lastByDeviceId: Partial<Record<string, CookerSession | null>>;
  history: CookerSession[];
  reservations: CookerReservation[];
  leftoverStrikesByEmail: Record<string, number>;
  leftoverNotices: CookerLeftoverNotice[];
};

export type CookerPhotoInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
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
  overdue: boolean;
  turnOffDeadlineAt: string | null;
  currentUse: CookerSession | null;
  lastUse: CookerSession | null;
  activeReservation: CookerReservation | null;
  reservedByMe: boolean;
  reservedByOther: boolean;
  canWalkUp: boolean;
  canTakeOver: boolean;
};

export type UserCookerContext = {
  email: string;
  name: string;
  branchId: CookerBranchId;
  eligible: boolean;
  maxOnMinutes: number;
  leftoverFineVnd: number;
  leftoverStrikes: number;
  sessionMinutes: number;
  reserveMaxAdvanceDays: number;
  reserveMaxSessionsPerDay: number;
  myReservations: CookerReservation[];
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
    history: [],
    reservations: [],
    leftoverStrikesByEmail: {},
    leftoverNotices: []
  };
}

function withBookingFields(state: Omit<CookerStateFile, "reservations" | "leftoverStrikesByEmail" | "leftoverNotices"> & Partial<CookerStateFile>): CookerStateFile {
  return {
    ...state,
    reservations: Array.isArray(state.reservations) ? state.reservations : [],
    leftoverStrikesByEmail: state.leftoverStrikesByEmail && typeof state.leftoverStrikesByEmail === "object" ? state.leftoverStrikesByEmail : {},
    leftoverNotices: Array.isArray(state.leftoverNotices) ? state.leftoverNotices : []
  };
}

function migrateLegacyState(raw: Record<string, unknown>): CookerStateFile {
  if (raw.currentByDeviceId && typeof raw.currentByDeviceId === "object") {
    return withBookingFields({
      currentByDeviceId: (raw.currentByDeviceId as CookerStateFile["currentByDeviceId"]) ?? {},
      lastByDeviceId: (raw.lastByDeviceId as CookerStateFile["lastByDeviceId"]) ?? {},
      history: Array.isArray(raw.history) ? (raw.history as CookerSession[]) : [],
      reservations: raw.reservations as CookerReservation[] | undefined,
      leftoverStrikesByEmail: raw.leftoverStrikesByEmail as Record<string, number> | undefined,
      leftoverNotices: raw.leftoverNotices as CookerLeftoverNotice[] | undefined
    });
  }

  const currentByBranch = (raw.currentByBranch ?? {}) as Partial<Record<CookerBranchId, CookerSession | null>>;
  const lastByBranch = (raw.lastByBranch ?? {}) as Partial<Record<CookerBranchId, CookerSession | null>>;
  const currentByDeviceId: CookerStateFile["currentByDeviceId"] = {};
  const lastByDeviceId: CookerStateFile["lastByDeviceId"] = {};

  for (const branch of ["D7", "D2"] as CookerBranchId[]) {
    const deviceId = `${branch.toLowerCase()}-cooker-1`;
    const current = currentByBranch[branch];
    if (current) {
      currentByDeviceId[deviceId] = { ...current, deviceId, cookerNumber: 1, branchId: branch };
    }
    const last = lastByBranch[branch];
    if (last) {
      lastByDeviceId[deviceId] = { ...last, deviceId, cookerNumber: 1, branchId: branch };
    }
  }

  return withBookingFields({
    currentByDeviceId,
    lastByDeviceId,
    history: Array.isArray(raw.history)
      ? (raw.history as CookerSession[]).map((session) => ({
          ...session,
          deviceId: session.deviceId || `${session.branchId.toLowerCase()}-cooker-1`,
          cookerNumber: session.cookerNumber || 1
        }))
      : [],
    reservations: raw.reservations as CookerReservation[] | undefined,
    leftoverStrikesByEmail: raw.leftoverStrikesByEmail as Record<string, number> | undefined,
    leftoverNotices: raw.leftoverNotices as CookerLeftoverNotice[] | undefined
  });
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

export function getCookerLeftOnFineVnd() {
  const parsed = Number.parseInt(process.env.COOKER_LEFT_ON_FINE_VND ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_LEFT_ON_FINE_VND;
  }
  return Math.trunc(parsed);
}

function dateKeyInCozoro(value: string | Date) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: COZORO_TIMEZONE });
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function isOpenReservation(reservation: CookerReservation) {
  return reservation.status === "booked" || reservation.status === "checked_in";
}

function expireStaleReservations(state: CookerStateFile, now = Date.now()) {
  for (const reservation of state.reservations) {
    if (reservation.status === "booked" && new Date(reservation.endAt).getTime() <= now) {
      reservation.status = "expired";
    }
  }
}

function activeReservationsForDevice(state: CookerStateFile, deviceId: string, now = Date.now()) {
  expireStaleReservations(state, now);
  return state.reservations.filter(
    (reservation) => reservation.deviceId === deviceId && isOpenReservation(reservation)
  );
}

function reservationCovering(state: CookerStateFile, deviceId: string, atMs = Date.now()) {
  return (
    activeReservationsForDevice(state, deviceId, atMs).find((reservation) => {
      const start = new Date(reservation.startAt).getTime();
      const end = new Date(reservation.endAt).getTime();
      return atMs >= start && atMs < end;
    }) ?? null
  );
}

function reservationBlockingWalkUp(state: CookerStateFile, deviceId: string, email: string, now = Date.now()) {
  const windowEnd = now + COOKER_SESSION_MINUTES * 60 * 1000;
  return (
    activeReservationsForDevice(state, deviceId, now).find((reservation) => {
      if (normalizeEmail(reservation.email) === email) {
        return false;
      }
      return intervalsOverlap(now, windowEnd, new Date(reservation.startAt).getTime(), new Date(reservation.endAt).getTime());
    }) ?? null
  );
}

function myOpenReservationNow(state: CookerStateFile, deviceId: string, email: string, now = Date.now()) {
  const current = reservationCovering(state, deviceId, now);
  if (current && normalizeEmail(current.email) === email) {
    return current;
  }
  return null;
}

function countUserSessionsOnDay(state: CookerStateFile, email: string, dayKey: string) {
  const normalized = normalizeEmail(email);
  return state.reservations.filter((reservation) => {
    if (normalizeEmail(reservation.email) !== normalized) {
      return false;
    }
    if (reservation.status === "cancelled") {
      return false;
    }
    return dateKeyInCozoro(reservation.startAt) === dayKey;
  }).length;
}

function findSessionById(state: CookerStateFile, sessionId: string) {
  for (const session of Object.values(state.currentByDeviceId)) {
    if (session?.id === sessionId) {
      return session;
    }
  }
  for (const session of Object.values(state.lastByDeviceId)) {
    if (session?.id === sessionId) {
      return session;
    }
  }
  return state.history.find((session) => session.id === sessionId) ?? null;
}

function patchSessionInState(state: CookerStateFile, sessionId: string, patch: Partial<CookerSession>) {
  const apply = (session: CookerSession | null | undefined) =>
    session && session.id === sessionId ? { ...session, ...patch } : session;
  for (const deviceId of Object.keys(state.currentByDeviceId)) {
    const next = apply(state.currentByDeviceId[deviceId] ?? null);
    if (next !== undefined) {
      state.currentByDeviceId[deviceId] = next ?? null;
    }
  }
  for (const deviceId of Object.keys(state.lastByDeviceId)) {
    const next = apply(state.lastByDeviceId[deviceId] ?? null);
    if (next !== undefined) {
      state.lastByDeviceId[deviceId] = next ?? null;
    }
  }
  state.history = state.history.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
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
  state.lastByDeviceId[session.deviceId] = session;
  state.history = [session, ...state.history.filter((entry) => entry.id !== session.id)].slice(0, MAX_HISTORY);
}

function buildUnitStatus(device: CookerDevice, state: CookerStateFile, email: string): CookerUnitStatus {
  const current = state.currentByDeviceId[device.id] ?? null;
  const last = state.lastByDeviceId[device.id] ?? null;
  const inUse = Boolean(current && current.lastRequestedAction === "ON" && !current.endedAt);
  const activeReservation = reservationCovering(state, device.id);
  const reservedByMe = Boolean(activeReservation && normalizeEmail(activeReservation.email) === email);
  const reservedByOther = Boolean(activeReservation && !reservedByMe);
  const blocking = reservationBlockingWalkUp(state, device.id, email);
  const isMine = Boolean(inUse && current && normalizeEmail(current.startedByEmail) === email);
  return {
    cooker: {
      id: device.id,
      label: device.label,
      number: device.number,
      iftttConfigured: isCookerIftttConfigured(device)
    },
    inUse,
    availableNow: !inUse && !reservedByOther && !blocking,
    isMine,
    overdue: sessionOverdue(current),
    turnOffDeadlineAt: turnOffDeadlineAt(current),
    currentUse: inUse ? current : null,
    lastUse: last,
    activeReservation,
    reservedByMe,
    reservedByOther,
    canWalkUp: !inUse && !reservedByOther && !blocking,
    canTakeOver: inUse && !isMine
  };
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

  const branchId = normalizeBranch(getClientValue(client, ["Chi nhánh Cozoro dorm", "Chi nhÃ¡nh Cozoro dorm"]));
  const clientName = getClientValue(client, ["Tên", "TÃªn", "Họ và tên"]);
  const eligible = !isBranchAutomationDisabled(branchId) && cookerDevicesForBranch(branchId).length > 0;
  const state = await readStateFile();
  expireStaleReservations(state);
  const cookers = eligible
    ? cookerDevicesForBranch(branchId).map((device) => buildUnitStatus(device, state, normalizedEmail))
    : [];
  const myReservations = state.reservations
    .filter(
      (reservation) =>
        normalizeEmail(reservation.email) === normalizedEmail &&
        isOpenReservation(reservation) &&
        new Date(reservation.endAt).getTime() > Date.now()
    )
    .sort((left, right) => left.startAt.localeCompare(right.startAt));

  return {
    email: normalizedEmail,
    name: clientName.trim(),
    branchId,
    eligible,
    maxOnMinutes: getCookerMaxOnMinutes(),
    leftoverFineVnd: getCookerLeftOnFineVnd(),
    leftoverStrikes: state.leftoverStrikesByEmail[normalizedEmail] ?? 0,
    sessionMinutes: COOKER_SESSION_MINUTES,
    reserveMaxAdvanceDays: COOKER_RESERVE_MAX_ADVANCE_DAYS,
    reserveMaxSessionsPerDay: COOKER_RESERVE_MAX_SESSIONS_PER_DAY,
    myReservations,
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

export async function startCookerUse(input: {
  email: string;
  machineId: string;
  cookerPhoto: CookerPhotoInput;
  kitchenPhoto: CookerPhotoInput;
  confirmUnused?: boolean;
}) {
  const context = await getUserCookerContext(input.email);
  const { device } = requireDeviceForResident(context, input.machineId);
  const state = await readStateFile();
  expireStaleReservations(state);
  const current = state.currentByDeviceId[device.id] ?? null;
  const inUse = Boolean(current && current.lastRequestedAction === "ON" && !current.endedAt);
  const isMine = Boolean(inUse && current && normalizeEmail(current.startedByEmail) === context.email);
  const myReservation = myOpenReservationNow(state, device.id, context.email);
  const covering = reservationCovering(state, device.id);
  const reservedByOther = Boolean(covering && normalizeEmail(covering.email) !== context.email);
  const blocking = reservationBlockingWalkUp(state, device.id, context.email);

  if (inUse && isMine) {
    throw new Error(`You already turned ${device.label} on. Take a cleaned photo to turn it off.`);
  }

  if (inUse && !isMine) {
    if (!input.confirmUnused) {
      throw new Error(
        `${device.label} shows an active session for ${current?.startedByName || "another resident"}. Confirm nobody is using it to start a safety takeover.`
      );
    }
    if (reservedByOther) {
      throw new Error(
        `${device.label} is reserved by ${covering?.name || covering?.email}. Wait for that slot to end.`
      );
    }
    if (!myReservation && blocking) {
      throw new Error(`${device.label} is reserved by ${blocking.name || blocking.email} until ${blocking.endAt}.`);
    }
    if (current) {
      try {
        await triggerCookerIfttt(device, "OFF", current.startedByEmail);
      } catch (error) {
        console.error(`[cooker] takeover OFF webhook failed for ${device.id}`, error);
      }
      const closedAt = new Date().toISOString();
      const leftover = await applyLeftoverConsequence(state, current, device, "takeover");
      if (current.reservationId) {
        const leftoverReservation = state.reservations.find((entry) => entry.id === current.reservationId);
        if (leftoverReservation && isOpenReservation(leftoverReservation)) {
          leftoverReservation.status = "checked_out";
        }
      }
      const closed: CookerSession = {
        ...current,
        lastRequestedAction: "OFF",
        lastRequestedAt: closedAt,
        endedAt: closedAt,
        endedByEmail: context.email,
        endedByName: context.name || context.email,
        leftoverFineIssuedAt: leftover.recordedAt,
        leftoverFineAmount: leftover.amount,
        leftoverWarningOnly: leftover.warningOnly,
        closedReason: "takeover"
      };
      state.currentByDeviceId[device.id] = null;
      rememberSession(state, closed);
    }
  } else if (reservedByOther) {
    throw new Error(`${device.label} is reserved by ${covering?.name || covering?.email} until ${covering?.endAt}.`);
  } else if (!myReservation && blocking) {
    throw new Error(`${device.label} is reserved by ${blocking.name || blocking.email} until ${blocking.endAt}.`);
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
    onPhotos: [],
    endedAt: null,
    endedByEmail: null,
    endedByName: null,
    offPhotos: [],
    leftoverFineIssuedAt: null,
    leftoverFineAmount: null,
    reservationId: myReservation?.id ?? null,
    closedReason: null
  };

  const cookerPhoto = await savePhoto(input.cookerPhoto, "cooker", session.id, context.email);
  const kitchenPhoto = await savePhoto(input.kitchenPhoto, "kitchen", session.id, context.email);
  session.onPhotos = [cookerPhoto, kitchenPhoto];

  await triggerCookerIfttt(device, "ON", context.email);

  if (myReservation) {
    myReservation.status = "checked_in";
  }

  state.currentByDeviceId[device.id] = session;
  rememberSession(state, session);
  await writeStateFile(state);
  void purgeExpiredCookerPhotos().catch((error) => {
    console.warn("[cooker] photo purge failed", error);
  });

  return { ok: true as const, session, cooker: { id: device.id, label: device.label, number: device.number } };
}

export async function stopCookerUse(input: { email: string; machineId: string; cleanedPhoto: CookerPhotoInput }) {
  const context = await getUserCookerContext(input.email);
  const { device, unit } = requireDeviceForResident(context, input.machineId);
  const current = unit.currentUse;
  if (!current || !unit.inUse) {
    throw new Error(`${device.label} is not currently on.`);
  }
  if (!unit.isMine) {
    throw new Error(`Only the resident who turned ${device.label} on can turn it off and upload the cleaned photo.`);
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
    offPhotos: [...current.offPhotos, cleanedPhoto],
    closedReason: "checkout"
  };

  await triggerCookerIfttt(device, "OFF", context.email);

  const state = await readStateFile();
  if (current.reservationId) {
    const reservation = state.reservations.find((entry) => entry.id === current.reservationId);
    if (reservation && (reservation.status === "booked" || reservation.status === "checked_in")) {
      reservation.status = "checked_out";
    }
  }
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
      current && current.lastRequestedAction === "ON" && !current.endedAt
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
            onPhotos: [],
            endedAt: null,
            endedByEmail: null,
            endedByName: null,
            offPhotos: [],
            leftoverFineIssuedAt: null,
            leftoverFineAmount: null
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
      endedByName: "Manager"
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
    ...Object.values(state.currentByDeviceId),
    ...Object.values(state.lastByDeviceId),
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

async function applyLeftoverConsequence(
  state: CookerStateFile,
  session: CookerSession,
  device: CookerDevice,
  reason: "takeover" | "timeout" | "manual"
) {
  const email = normalizeEmail(session.startedByEmail);
  const nextStrike = (state.leftoverStrikesByEmail[email] ?? 0) + 1;
  state.leftoverStrikesByEmail[email] = nextStrike;
  const warningOnly = nextStrike <= LEFTOVER_REMINDER_LIMIT;
  const recordedAt = new Date().toISOString();
  let amount: number | null = null;
  let fined = false;

  if (!warningOnly) {
    try {
      const fine = await issueLeftoverFine(session, device.label);
      fined = fine.issued;
      amount = fine.amount;
    } catch (error) {
      console.error(`[cooker] leftover fine failed for ${email}`, error);
    }
  } else {
    try {
      await sendGmailReceipt({
        to: email,
        subject: `[Cozoro Home] Cooker left on reminder / Nhắc nhở quên tắt bếp (${nextStrike}/${LEFTOVER_REMINDER_LIMIT})`,
        body: [
          `Dear ${session.startedByName || email},`,
          "",
          `For safety, ${device.label} was recorded as left on (${reason}).`,
          `This is reminder ${nextStrike} of ${LEFTOVER_REMINDER_LIMIT}. The next time this happens, a fine ticket may be issued.`,
          "",
          `Quý khách thân mến,`,
          `Vì an toàn, ${device.label} được ghi nhận là quên tắt (${reason}).`,
          `Đây là nhắc nhở ${nextStrike}/${LEFTOVER_REMINDER_LIMIT}. Lần sau có thể bị lập phiếu phạt.`
        ].join("\n")
      });
    } catch (error) {
      console.error("[cooker] leftover reminder email failed", error);
    }
  }

  state.leftoverNotices.unshift({
    id: randomUUID(),
    email,
    cookerLabel: device.label,
    createdAt: recordedAt,
    strike: nextStrike,
    fined,
    amount,
    reason
  });
  state.leftoverNotices = state.leftoverNotices.slice(0, 200);

  return { recordedAt, warningOnly, amount, fined, strike: nextStrike };
}

async function issueLeftoverFine(session: CookerSession, cookerLabel: string) {
  const amount = getCookerLeftOnFineVnd();
  if (amount <= 0) {
    return { issued: false as const, amount: 0 };
  }

  const content = `Forgot to turn off ${cookerLabel}`;
  const description = `${cookerLabel} (${session.branchId}) left ON. Safety ticket after more than ${LEFTOVER_REMINDER_LIMIT} leftover incidents. Session ${session.id} started ${session.startedAt}.`;
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

export async function listCookerLeftoverNoticesForEmail(email: string) {
  const state = await readStateFile();
  const normalized = normalizeEmail(email);
  return state.leftoverNotices.filter((notice) => notice.email === normalized).slice(0, 10);
}

function sessionPhotos(session: CookerSession) {
  return [...(session.onPhotos ?? []), ...(session.offPhotos ?? [])];
}

export async function listCookerInspectionsForStaff(limit = 40) {
  const state = await readStateFile();
  expireStaleReservations(state);
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

  const inspections = [...byId.values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, Math.max(1, Math.min(limit, 80)))
    .map((session) => {
      const device = findCookerDevice(session.deviceId);
      const inUse = Boolean(session.lastRequestedAction === "ON" && !session.endedAt);
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
        inUse,
        overdue: sessionOverdue(session),
        leftoverStrikes: state.leftoverStrikesByEmail[normalizeEmail(session.startedByEmail)] ?? 0,
        leftoverFineIssued: Boolean(session.leftoverFineAmount),
        leftoverWarningOnly: Boolean(session.leftoverWarningOnly),
        leftoverTicketed: Boolean(session.leftoverFineIssuedAt),
        closedReason: session.closedReason ?? null,
        photos: sessionPhotos(session)
      };
    });

  return {
    leftoverFineVnd: getCookerLeftOnFineVnd(),
    leftoverReminderLimit: LEFTOVER_REMINDER_LIMIT,
    inspections
  };
}

async function attachCookerPhotosToFine(session: CookerSession, maHd: string, uploadedBy: string) {
  const attachments: Array<{ url: string; fileName: string; mimeType: string; downloadUrl: string }> = [];
  for (const photo of sessionPhotos(session)) {
    try {
      const buffer = await readFile(path.join(cookerPhotosDirPath, path.basename(photo.fileName)));
      const uploaded = await uploadFineImageToDrive({
        maHd,
        clientName: session.startedByName || session.startedByEmail,
        uploadedBy,
        fileName: photo.fileName,
        mimeType: "image/jpeg",
        base64Data: buffer.toString("base64")
      });
      attachments.push({
        url: uploaded.url,
        fileName: uploaded.fileName || photo.fileName,
        mimeType: uploaded.mimeType || "image/jpeg",
        downloadUrl: uploaded.downloadUrl
      });
    } catch (error) {
      console.error(`[cooker] staff fine photo attach failed for ${photo.fileName}`, error);
    }
  }
  return attachments;
}

export async function issueStaffCookerInspectionTicket(input: {
  actorEmail: string;
  sessionId: string;
  action: "reminder" | "fine";
  amount?: number;
  note?: string;
}) {
  const state = await readStateFile();
  const session = findSessionById(state, input.sessionId);
  if (!session) {
    throw new Error("Cooker inspection session not found.");
  }
  const device = findCookerDevice(session.deviceId);
  if (!device) {
    throw new Error("Unknown cooker.");
  }
  const email = normalizeEmail(session.startedByEmail);
  const alreadyTicketed = Boolean(session.leftoverFineIssuedAt);
  if (input.action === "fine" && session.leftoverFineAmount) {
    throw new Error("This cooker session already has a leftover-on fine.");
  }
  if (input.action === "reminder" && alreadyTicketed) {
    throw new Error("This cooker session already has a leftover-on reminder or fine.");
  }

  if (!alreadyTicketed) {
    state.leftoverStrikesByEmail[email] = (state.leftoverStrikesByEmail[email] ?? 0) + 1;
  }
  const strike = state.leftoverStrikesByEmail[email] ?? 1;
  const recordedAt = new Date().toISOString();
  const staffNote = input.note?.trim() || "";
  const cookerLabel = device.label;

  if (input.action === "reminder") {
    try {
      await sendGmailReceipt({
        to: email,
        subject: `[Cozoro Home] Cooker inspection reminder / Nhắc nhở kiểm tra bếp (${strike}/${LEFTOVER_REMINDER_LIMIT})`,
        body: [
          `Dear ${session.startedByName || email},`,
          "",
          `Staff inspected kitchen photos for ${cookerLabel}.`,
          "For safety, this is a reminder to turn the cooker off and leave the kitchen clean.",
          `This is reminder ${strike} of ${LEFTOVER_REMINDER_LIMIT}. A later leftover-on incident can become a fine.`,
          staffNote ? `Staff note: ${staffNote}` : "",
          "",
          `Quý khách thân mến,`,
          `Nhân viên đã kiểm tra ảnh nhà bếp cho ${cookerLabel}.`,
          "Vì an toàn, đây là nhắc nhở tắt bếp và dọn sạch.",
          `Đây là nhắc nhở ${strike}/${LEFTOVER_REMINDER_LIMIT}. Lần sau có thể bị lập phiếu phạt.`,
          staffNote ? `Ghi chú: ${staffNote}` : ""
        ]
          .filter((line) => line !== "")
          .join("\n")
      });
    } catch (error) {
      console.error("[cooker] staff reminder email failed", error);
    }

    state.leftoverNotices.unshift({
      id: randomUUID(),
      email,
      cookerLabel,
      createdAt: recordedAt,
      strike,
      fined: false,
      amount: null,
      reason: "manual"
    });
    state.leftoverNotices = state.leftoverNotices.slice(0, 200);
    patchSessionInState(state, session.id, {
      leftoverFineIssuedAt: recordedAt,
      leftoverFineAmount: null,
      leftoverWarningOnly: true
    });
    await writeStateFile(state);
    return { ok: true as const, action: "reminder" as const, strike, fined: false, amount: null };
  }

  const clients = await getManagerClients();
  const client = clients.find((entry) => entry.email.trim().toLowerCase() === email);
  if (!client) {
    throw new Error("Client could not be found for this cooker fine.");
  }
  const amount = Math.max(1, Math.trunc(input.amount ?? getCookerLeftOnFineVnd()));
  const content = `Forgot to turn off ${cookerLabel}`;
  const description = [
    `${cookerLabel} (${session.branchId}) leftover-on after staff photo inspection.`,
    `Session ${session.id} started ${session.startedAt} by ${session.startedByName || email}.`,
    staffNote ? `Staff note: ${staffNote}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const attachments = await attachCookerPhotosToFine(session, client.maHd, input.actorEmail);
  const result = await managerCreateFine({
    maHd: client.maHd,
    amount,
    content,
    description,
    location: `Kitchen ${session.branchId}`,
    operator: input.actorEmail.trim() || "Cooker inspection",
    image: attachments[0]?.url,
    attachments
  });
  try {
    await sendFineTicketEmail({
      to: result.clientEmail,
      clientName: result.clientName,
      amountVnd: result.amount,
      content: result.content,
      description: result.description,
      location: result.location,
      dueDate: result.dueDate,
      eventAt: result.eventAt,
      operator: input.actorEmail,
      attachments: result.attachments
    });
  } catch (error) {
    console.error("[cooker] staff inspection fine email failed", error);
  }

  state.leftoverNotices.unshift({
    id: randomUUID(),
    email,
    cookerLabel,
    createdAt: recordedAt,
    strike,
    fined: true,
    amount,
    reason: "manual"
  });
  state.leftoverNotices = state.leftoverNotices.slice(0, 200);
  patchSessionInState(state, session.id, {
    leftoverFineIssuedAt: recordedAt,
    leftoverFineAmount: amount,
    leftoverWarningOnly: false
  });
  await writeStateFile(state);
  return { ok: true as const, action: "fine" as const, strike, fined: true, amount };
}

export async function createCookerReservation(input: { email: string; machineId: string; startAt: string }) {
  const context = await getUserCookerContext(input.email);
  const { device } = requireDeviceForResident(context, input.machineId);
  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Reservation start time is invalid.");
  }
  const now = Date.now();
  if (start.getTime() < now - 60 * 1000) {
    throw new Error("Reservations cannot start in the past.");
  }
  const maxStart = now + COOKER_RESERVE_MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
  if (start.getTime() > maxStart) {
    throw new Error(`Reservations can be made at most ${COOKER_RESERVE_MAX_ADVANCE_DAYS} days in advance.`);
  }
  const end = new Date(start.getTime() + COOKER_SESSION_MINUTES * 60 * 1000);
  const state = await readStateFile();
  expireStaleReservations(state, now);
  const dayKey = dateKeyInCozoro(start);
  if (countUserSessionsOnDay(state, context.email, dayKey) >= COOKER_RESERVE_MAX_SESSIONS_PER_DAY) {
    throw new Error(`You can reserve at most ${COOKER_RESERVE_MAX_SESSIONS_PER_DAY} cooker sessions (1 hour) per day.`);
  }
  const overlap = state.reservations.find((reservation) => {
    if (!isOpenReservation(reservation)) {
      return false;
    }
    const sameDevice = reservation.deviceId === device.id;
    const sameUser = normalizeEmail(reservation.email) === context.email;
    if (!sameDevice && !sameUser) {
      return false;
    }
    return intervalsOverlap(
      start.getTime(),
      end.getTime(),
      new Date(reservation.startAt).getTime(),
      new Date(reservation.endAt).getTime()
    );
  });
  if (overlap) {
    throw new Error("That cooker time overlaps another reservation.");
  }

  const reservation: CookerReservation = {
    id: randomUUID(),
    deviceId: device.id,
    cookerNumber: device.number,
    branchId: device.branchId,
    email: context.email,
    name: context.name || context.email,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    status: "booked",
    createdAt: new Date().toISOString()
  };
  state.reservations.push(reservation);
  await writeStateFile(state);
  return { ok: true as const, reservation };
}

export async function cancelCookerReservation(input: { email: string; reservationId: string }) {
  const context = await getUserCookerContext(input.email);
  const state = await readStateFile();
  const reservation = state.reservations.find((entry) => entry.id === input.reservationId);
  if (!reservation) {
    throw new Error("Reservation not found.");
  }
  if (normalizeEmail(reservation.email) !== context.email) {
    throw new Error("You can only cancel your own cooker reservation.");
  }
  if (reservation.status === "checked_in") {
    throw new Error("This reservation is already in use. Turn the cooker off to check out.");
  }
  if (!isOpenReservation(reservation)) {
    throw new Error("This reservation is no longer active.");
  }
  reservation.status = "cancelled";
  await writeStateFile(state);
  return { ok: true as const, reservation };
}

export async function sweepForgottenCookerSessions() {
  await purgeExpiredCookerPhotos().catch((error) => {
    console.warn("[cooker] photo purge failed", error);
  });

  const state = await readStateFile();
  const now = Date.now();
  expireStaleReservations(state, now);
  const results: Array<{ sessionId: string; deviceId: string; fined: boolean }> = [];

  for (const device of COOKER_DEVICES) {
    if (isBranchAutomationDisabled(device.branchId)) {
      continue;
    }
    const current = state.currentByDeviceId[device.id] ?? null;
    if (!current || current.lastRequestedAction !== "ON" || current.endedAt) {
      continue;
    }
    if (!sessionOverdue(current, now)) {
      continue;
    }

    try {
      await triggerCookerIfttt(device, "OFF", current.startedByEmail);
    } catch (error) {
      console.error(`[cooker] leftover OFF webhook failed for ${device.id}`, error);
    }

    const leftover = current.leftoverFineIssuedAt
      ? {
          recordedAt: current.leftoverFineIssuedAt,
          warningOnly: Boolean(current.leftoverWarningOnly),
          amount: current.leftoverFineAmount,
          fined: Boolean(current.leftoverFineAmount)
        }
      : await applyLeftoverConsequence(state, current, device, "timeout");
    const endedAt = new Date().toISOString();
    if (current.reservationId) {
      const reservation = state.reservations.find((entry) => entry.id === current.reservationId);
      if (reservation && isOpenReservation(reservation)) {
        reservation.status = "expired";
      }
    }
    const closed: CookerSession = {
      ...current,
      lastRequestedAction: "OFF",
      lastRequestedAt: endedAt,
      endedAt,
      endedByEmail: "system",
      endedByName: "Cooker controller",
      leftoverFineIssuedAt: leftover.recordedAt,
      leftoverFineAmount: leftover.amount,
      leftoverWarningOnly: leftover.warningOnly,
      closedReason: "timeout"
    };
    state.currentByDeviceId[device.id] = null;
    rememberSession(state, closed);
    results.push({ sessionId: current.id, deviceId: device.id, fined: leftover.fined });
  }

  if (results.length > 0) {
    await writeStateFile(state);
  } else {
    await writeStateFile(state);
  }

  return { checked: COOKER_DEVICES.length, closed: results.length, results };
}
