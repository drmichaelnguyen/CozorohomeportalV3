import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCachedClients, syncClientsFromSheet } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";

const cacheDirPath = path.join(process.cwd(), "data");
const settingsFilePath = path.join(cacheDirPath, "prospect-assistant-settings.json");
const ACTIVE_STAYING_COLUMN = "Hiện còn ở";
const CLIENT_NAME_COLUMN = "Tên";

type ProspectAssistantSettings = {
  referralDiscountVnd: number;
};

type BranchLayoutRoom = {
  room: string;
  floor: string;
  startBed: number;
  endBed: number;
};

const DEFAULT_SETTINGS: ProspectAssistantSettings = {
  referralDiscountVnd: 2_000_000
};

const BRANCH_LAYOUTS: Record<"D2" | "D7", BranchLayoutRoom[]> = {
  D2: [
    { room: "1", floor: "D2", startBed: 1, endBed: 9 },
    { room: "2", floor: "D2", startBed: 10, endBed: 15 },
    { room: "3", floor: "D2", startBed: 16, endBed: 21 }
  ],
  D7: [
    { room: "1.1", floor: "Floor 1", startBed: 1, endBed: 9 },
    { room: "1.2", floor: "Floor 1", startBed: 10, endBed: 15 },
    { room: "1.3", floor: "Floor 1", startBed: 16, endBed: 24 },
    { room: "2.1", floor: "Floor 2", startBed: 25, endBed: 33 },
    { room: "2.2", floor: "Floor 2", startBed: 34, endBed: 39 },
    { room: "2.3", floor: "Floor 2", startBed: 40, endBed: 48 },
    { room: "3.1", floor: "Floor 3", startBed: 49, endBed: 57 },
    { room: "3.2", floor: "Floor 3", startBed: 58, endBed: 63 }
  ]
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

function normalizeLookupValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeName(value: string) {
  return normalizeLookupValue(value);
}

function normalizePhone(value: string) {
  return String(value ?? "").replace(/\D+/g, "");
}

function parseBedNumber(value: string) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeClientBranch(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");

  if (!normalized) {
    return "D2" as const;
  }

  if (normalized === "2" || normalized === "D2" || normalized.includes("D2")) {
    return "D2" as const;
  }

  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7" as const;
  }

  return "D2" as const;
}

function getClientBranchValue(row: Record<string, string>) {
  const directKeys = [
    "Chi nhánh Cozoro dorm",
    "Chi nhÃ¡nh Cozoro dorm",
    "Chi nh?nh Cozoro dorm",
    "CHI NHÁNH DORM",
    "CHI NHANH DORM"
  ];

  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const branchEntry = Object.entries(row).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }

    const normalizedKey = normalizeLookupValue(key);
    return (
      normalizedKey.includes("chinhanhcozorodorm") ||
      (normalizedKey.includes("chinhanh") && normalizedKey.includes("dorm")) ||
      normalizedKey.includes("branch")
    );
  });

  return String(branchEntry?.[1] ?? "").trim();
}

function getClientPhoneValue(row: Record<string, string>) {
  const directKeys = [
    "Số điện thoại liên hệ",
    "Sá»‘ Ä‘iá»‡n thoáº¡i liÃªn há»‡",
    "Số điện thoại",
    "Phone",
    "PHONE"
  ];

  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const phoneEntry = Object.entries(row).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }

    const normalizedKey = normalizeLookupValue(key);
    return normalizedKey.includes("dienthoai") || normalizedKey.includes("phone");
  });

  return String(phoneEntry?.[1] ?? "").trim();
}

async function readSettings() {
  return ensureJsonFile<ProspectAssistantSettings>(settingsFilePath, DEFAULT_SETTINGS);
}

async function writeSettings(settings: ProspectAssistantSettings) {
  await mkdir(path.dirname(settingsFilePath), { recursive: true });
  await writeFile(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

async function getClientCache() {
  return (await readCachedClients()) ?? (await syncClientsFromSheet());
}

export async function getProspectAssistantPublicSettings() {
  const settings = await readSettings();
  return {
    referralDiscountVnd: settings.referralDiscountVnd
  };
}

export async function updateProspectAssistantSettings(input: {
  actorEmail: string;
  referralDiscountVnd: number;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can update prospect assistant settings."
  );

  const nextSettings: ProspectAssistantSettings = {
    referralDiscountVnd: Math.max(0, Math.trunc(input.referralDiscountVnd))
  };

  await writeSettings(nextSettings);
  return nextSettings;
}

export async function checkProspectReferralEligibility(input: {
  referrerName: string;
  referrerPhone: string;
}) {
  const [settings, cache] = await Promise.all([readSettings(), getClientCache()]);
  const normalizedName = normalizeName(input.referrerName);
  const normalizedPhone = normalizePhone(input.referrerPhone);

  const eligible = cache.rows.some((row) => {
    if (String(row[ACTIVE_STAYING_COLUMN] ?? "").trim() !== "1") {
      return false;
    }

    const rowName = normalizeName(row[CLIENT_NAME_COLUMN] ?? "");
    const rowPhone = normalizePhone(getClientPhoneValue(row));

    return Boolean(normalizedName && normalizedPhone && rowName === normalizedName && rowPhone === normalizedPhone);
  });

  return {
    eligible,
    referralDiscountVnd: settings.referralDiscountVnd,
    message: eligible
      ? "Eligible for referral discount."
      : "Not eligible for referral discount."
  };
}

export async function getProspectBedAvailability() {
  const cache = await getClientCache();
  const occupiedByBranch = {
    D2: new Set<number>(),
    D7: new Set<number>()
  };

  for (const row of cache.rows) {
    if (String(row[ACTIVE_STAYING_COLUMN] ?? "").trim() !== "1") {
      continue;
    }

    const branchId = normalizeClientBranch(getClientBranchValue(row));
    const bedNumber = parseBedNumber(row["số giường"] ?? "");
    if (!bedNumber) {
      continue;
    }

    occupiedByBranch[branchId].add(bedNumber);
  }

  const branches = (Object.entries(BRANCH_LAYOUTS) as Array<["D2" | "D7", BranchLayoutRoom[]]>).map(
    ([branchId, rooms]) => {
      const roomSummaries = rooms.map((room) => {
        const totalBedNumbers = Array.from(
          { length: room.endBed - room.startBed + 1 },
          (_, index) => room.startBed + index
        );
        const availableBedNumbers = totalBedNumbers.filter(
          (bedNumber) => !occupiedByBranch[branchId].has(bedNumber)
        );

        return {
          room: room.room,
          floor: room.floor,
          totalBeds: totalBedNumbers.length,
          occupiedBeds: totalBedNumbers.length - availableBedNumbers.length,
          availableBeds: availableBedNumbers.length,
          availableBedNumbers
        };
      });

      const totalBeds = roomSummaries.reduce((sum, room) => sum + room.totalBeds, 0);
      const availableBeds = roomSummaries.reduce((sum, room) => sum + room.availableBeds, 0);

      return {
        branchId,
        totalBeds,
        occupiedBeds: totalBeds - availableBeds,
        availableBeds,
        rooms: roomSummaries.filter((room) => room.availableBeds > 0)
      };
    }
  );

  return {
    syncedAt: cache.syncedAt,
    branches
  };
}
