import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { COZORO_TIMEZONE, getActiveClientByEmail } from "./google-sheets.js";

const cacheDirPath = path.join(process.cwd(), "data");
const devicesMapFilePath = path.join(cacheDirPath, "devices-map.json");
const acStateFilePath = path.join(cacheDirPath, "ac-state.json");

type DevicesMapFile = {
  acRooms: AcRoomConfig[];
  laundry: any[];
  airfryers: any[];
};

export type AcRoomConfig = {
  id: string;
  label: string;
  branchId: "D2" | "D7";
  beds: string[];
  roomCodes?: string[];
  contractCodes?: string[];
  iftttOnEvent: string;
  iftttOffEvent: string;
  iftttValue1?: string;
  iftttValue2?: string;
  iftttValue3?: string;
};

type AcStateEntry = {
  roomId: string;
  lastRequestedAction: "ON" | "OFF";
  lastRequestedAt: string;
};

type AcStateFile = {
  rooms: AcStateEntry[];
};

export type PrivilegedAcRoom = {
  id: string;
  label: string;
  branchId: "D2" | "D7";
  roomCodes: string[];
  beds: string[];
  iftttConfigured: boolean;
  lastRequestedAction: "ON" | "OFF" | null;
  lastRequestedAt: string | null;
};

export type UserAcControllerContext = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  bed: string;
  roomCode: string | null;
  contractCode: string;
  room: {
    id: string;
    label: string;
    iftttConfigured: boolean;
    lastRequestedAction: "ON" | "OFF" | null;
    lastRequestedAt: string | null;
  } | null;
  restrictions: {
    canTurnOnNow: boolean;
    turnOnBlockedReason: string | null;
    timeZone: string;
  };
  mappingHint: {
    branchId: "D2" | "D7";
    bed: string;
    roomCode: string;
    contractCode: string;
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

async function readDevicesMap() {
  return ensureJsonFile<DevicesMapFile>(devicesMapFilePath, { acRooms: [], laundry: [], airfryers: [] });
}

async function readStateFile() {
  return ensureJsonFile<AcStateFile>(acStateFilePath, { rooms: [] });
}

async function writeStateFile(state: AcStateFile) {
  await mkdir(path.dirname(acStateFilePath), { recursive: true });
  await writeFile(acStateFilePath, JSON.stringify(state, null, 2), "utf8");
}

function normalizeBranch(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7" as const;
  }
  return "D2" as const;
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function getCurrentTimePartsInCozoroTimeZone() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: COZORO_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "-1", 10);

  return {
    weekday,
    hour
  };
}

function getAcTurnOnRestriction() {
  const { weekday, hour } = getCurrentTimePartsInCozoroTimeZone();
  const isSunday = weekday.toLowerCase().startsWith("sun");
  const blocked = !isSunday && hour >= 7 && hour < 10;

  return {
    canTurnOnNow: !blocked,
    turnOnBlockedReason: blocked
      ? "Users cannot turn on the AC from 7:00 AM to 10:00 AM every day except Sunday."
      : null,
    timeZone: COZORO_TIMEZONE
  };
}

function parseBedNumber(value: string) {
  const numeric = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(numeric) ? null : numeric;
}

export function deriveRoomCode(branchId: "D2" | "D7", bedValue: string) {
  const bed = parseBedNumber(bedValue);

  if (!bed || bed <= 0) {
    return null;
  }

  if (branchId === "D2") {
    if (bed >= 1 && bed <= 9) {
      return "1";
    }
    if (bed >= 10 && bed <= 15) {
      return "2";
    }
    if (bed >= 16 && bed <= 21) {
      return "3";
    }
    return null;
  }

  if (bed >= 1 && bed <= 9) {
    return "1.1";
  }
  if (bed >= 10 && bed <= 15) {
    return "1.2";
  }
  if (bed >= 16 && bed <= 24) {
    return "1.3";
  }
  if (bed >= 25 && bed <= 33) {
    return "2.1";
  }
  if (bed >= 34 && bed <= 39) {
    return "2.2";
  }
  if (bed >= 40 && bed <= 48) {
    return "2.3";
  }
  if (bed >= 49 && bed <= 57) {
    return "3.1";
  }
  if (bed >= 58 && bed <= 63) {
    return "3.2";
  }

  return null;
}

function findRoomForClient(rooms: AcRoomConfig[], client: Record<string, string>) {
  const branchId = normalizeBranch(client["Chi nhánh Cozoro dorm"] ?? "");
  const bed = normalizeLookupValue(client["số giường"] ?? "");
  const contractCode = normalizeLookupValue(client["MÃ HD"] ?? "");
  const roomCode = deriveRoomCode(branchId, client["số giường"] ?? "");

  return (
    rooms.find((room) => {
      if (room.branchId !== branchId) {
        return false;
      }

      const matchesContract =
        (room.contractCodes ?? []).some((value) => normalizeLookupValue(value) === contractCode);

      if (matchesContract) {
        return true;
      }

      const matchesRoomCode =
        (room.roomCodes ?? []).some((value) => normalizeLookupValue(value) === normalizeLookupValue(roomCode ?? ""));

      if (matchesRoomCode) {
        return true;
      }

      return (room.beds ?? []).some((value) => normalizeLookupValue(value) === bed);
    }) ?? null
  );
}

function buildWebhookUrl(eventName: string) {
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();

  if (!key) {
    throw new Error("IFTTT webhook key is not configured");
  }

  return `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName.trim())}/json/with/key/${encodeURIComponent(key)}`;
}

async function triggerIftttEvent(room: AcRoomConfig, action: "ON" | "OFF") {
  const eventName = action === "ON" ? room.iftttOnEvent : room.iftttOffEvent;

  if (!eventName.trim()) {
    throw new Error("IFTTT event is not configured for this room");
  }

  const response = await fetch(buildWebhookUrl(eventName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      value1: room.iftttValue1 ?? room.label,
      value2: room.iftttValue2 ?? room.branchId,
      value3: room.iftttValue3 ?? action
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "IFTTT request failed");
  }
}

function getRoomState(state: AcStateFile, roomId: string) {
  return state.rooms.find((entry) => entry.roomId === roomId) ?? null;
}

export async function getUserAcControllerContext(email: string): Promise<UserAcControllerContext> {
  const normalizedEmail = email.trim().toLowerCase();
  const client = await getActiveClientByEmail(normalizedEmail);

  if (!client) {
    throw new Error("No active client found for that email");
  }

  const devicesMap = await readDevicesMap();
  const state = await readStateFile();
  const room = findRoomForClient(devicesMap.acRooms, client);
  const roomState = room ? getRoomState(state, room.id) : null;
  const branchId = normalizeBranch(client["Chi nhánh Cozoro dorm"] ?? "");
  const roomCode = deriveRoomCode(branchId, client["số giường"] ?? "");

  return {
    email: normalizedEmail,
    name: (client["Tên"] ?? "").trim(),
    branchId,
    bed: (client["số giường"] ?? "").trim(),
    roomCode,
    contractCode: (client["MÃ HD"] ?? "").trim(),
    room: room
      ? {
          id: room.id,
          label: room.label,
          iftttConfigured: Boolean(room.iftttOnEvent && room.iftttOffEvent),
          lastRequestedAction: roomState?.lastRequestedAction ?? null,
          lastRequestedAt: roomState?.lastRequestedAt ?? null
        }
      : null,
    restrictions: getAcTurnOnRestriction(),
    mappingHint: {
      branchId,
      bed: (client["số giường"] ?? "").trim(),
      roomCode: roomCode ?? "",
      contractCode: (client["MÃ HD"] ?? "").trim()
    }
  };
}

export async function sendAcCommand(input: { email: string; action: "ON" | "OFF" }) {
  if (input.action === "ON") {
    const restriction = getAcTurnOnRestriction();
    if (!restriction.canTurnOnNow) {
      throw new Error(restriction.turnOnBlockedReason ?? "AC turn-on is currently restricted");
    }
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  const client = await getActiveClientByEmail(normalizedEmail);

  if (!client) {
    throw new Error("No active client found for that email");
  }

  const devicesMap = await readDevicesMap();
  const room = findRoomForClient(devicesMap.acRooms, client);

  if (!room) {
    throw new Error("No AC room mapping is configured for this user");
  }

  await triggerIftttEvent(room, input.action);
  return saveRoomStateAndReturn(room, input.action);
}

async function saveRoomStateAndReturn(room: AcRoomConfig, action: "ON" | "OFF") {
  const state = await readStateFile();
  const nextEntry: AcStateEntry = {
    roomId: room.id,
    lastRequestedAction: action,
    lastRequestedAt: new Date().toISOString()
  };

  const existingIndex = state.rooms.findIndex((entry) => entry.roomId === room.id);
  if (existingIndex >= 0) {
    state.rooms[existingIndex] = nextEntry;
  } else {
    state.rooms.push(nextEntry);
  }
  await writeStateFile(state);

  return {
    ok: true,
    room: {
      id: room.id,
      label: room.label
    },
    action,
    requestedAt: nextEntry.lastRequestedAt
  };
}

export async function listPrivilegedAcRooms(): Promise<PrivilegedAcRoom[]> {
  const devicesMap = await readDevicesMap();
  const state = await readStateFile();

  return devicesMap.acRooms
    .map((room) => {
      const roomState = getRoomState(state, room.id);
      return {
        id: room.id,
        label: room.label,
        branchId: room.branchId,
        roomCodes: room.roomCodes ?? [],
        beds: room.beds,
        iftttConfigured: Boolean(room.iftttOnEvent && room.iftttOffEvent),
        lastRequestedAction: roomState?.lastRequestedAction ?? null,
        lastRequestedAt: roomState?.lastRequestedAt ?? null
      } satisfies PrivilegedAcRoom;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function sendAcCommandToRoom(input: { roomId: string; action: "ON" | "OFF" }) {
  const devicesMap = await readDevicesMap();
  const room = devicesMap.acRooms.find((entry) => entry.id === input.roomId) ?? null;

  if (!room) {
    throw new Error("Room mapping not found");
  }

  await triggerIftttEvent(room, input.action);

  return saveRoomStateAndReturn(room, input.action);
}

export async function listAllDevices() {
  return readDevicesMap();
}
