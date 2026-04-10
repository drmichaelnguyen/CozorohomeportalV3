import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCachedClients, syncClientsFromSheet } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";
import { getBedOverrides, getBedParkingFeeOverrides, getBranchPricingSettings } from "./pricing-config.js";

const cacheDirPath = path.join(process.cwd(), "data");
const settingsFilePath = path.join(cacheDirPath, "prospect-assistant-settings.json");
const ACTIVE_STAYING_COLUMN = "Hiện còn ở";
const CLIENT_NAME_COLUMN = "Tên";
const CLIENT_GENDER_COLUMN = "Giới tính";
const CLIENT_BED_COLUMN = "số giường";
const CLIENT_BRANCH_COLUMN = "Chi nhánh Cozoro dorm";
const CLIENT_PHONE_COLUMN = "Số điện thoại liên hệ";
const CLIENT_CONTRACT_START_COLUMN = "Ngày bắt đầu hợp đồng";
const CLIENT_CONTRACT_END_COLUMN = "Ngày hết hạn hợp đồng";
const CLIENT_MONTHLY_SHARE_COLUMN = "Số tiền chia sẻ mỗi tháng";
const CLIENT_MONTHLY_FEE_COLUMN = "Phí ở đóng mỗi tháng";
const CLIENT_DEPOSIT_COLUMN = "Số tiền cọc";

type ProspectAssistantSettings = {
  referralDiscountVnd: number;
};

type BranchLayoutRoom = {
  room: string;
  floor: string;
  startBed: number;
  endBed: number;
};

type BranchId = keyof typeof BRANCH_LAYOUTS;
type ProspectSex = "male" | "female";

type BedAvailabilityRecord = {
  bedNumber: number;
  status: "available_now" | "available_soon";
  availableOn: string;
  pricing: {
    monthlyPrice: number;
    deposit: number;
    parkingFeeVnd: number;
    cleaningOptOutFeeVnd: number;
  };
};

type Reservation = {
  branchId: BranchId;
  room: string;
  bedNumber: number;
  sex: ProspectSex | null;
  startDate: Date | null;
  endDate: Date | null;
};

type PriceStats = {
  perBed: Record<BranchId, Map<number, { monthlyPrice: number; deposit: number }>>;
  perBranch: Record<BranchId, { monthlyPrice: number; deposit: number }>;
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

function parseMoney(value: string) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

function normalizeSex(value: string): ProspectSex | null {
  const normalized = normalizeLookupValue(value);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("nu") || normalized.includes("female")) {
    return "female";
  }

  if (normalized.includes("nam") || normalized.includes("male")) {
    return "male";
  }

  return null;
}

function parseVietnamDate(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const [, dayValue, monthValue, yearValue] = match;
    const year = Number(yearValue) < 100 ? 2000 + Number(yearValue) : Number(yearValue);
    const parsed = new Date(year, Number(monthValue) - 1, Number(dayValue), 12, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setHours(12, 0, 0, 0);
  return parsed;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next;
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(left: Date, right: Date) {
  return toIsoDate(left) === toIsoDate(right);
}

function getClientBranchValue(row: Record<string, string>) {
  const directValue = String(row[CLIENT_BRANCH_COLUMN] ?? "").trim();
  if (directValue) {
    return directValue;
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
  const directValue = String(row[CLIENT_PHONE_COLUMN] ?? "").trim();
  if (directValue) {
    return directValue;
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

function getRoomForBed(branchId: BranchId, bedNumber: number) {
  return BRANCH_LAYOUTS[branchId].find((room) => bedNumber >= room.startBed && bedNumber <= room.endBed) ?? null;
}

function isReservationActiveOnDate(reservation: Reservation, day: Date) {
  if (reservation.startDate && day < reservation.startDate) {
    return false;
  }

  if (reservation.endDate && day > reservation.endDate) {
    return false;
  }

  return true;
}

function pickMostCommonValue(counter: Map<number, number>) {
  let winningValue = 0;
  let winningCount = -1;

  for (const [value, count] of counter.entries()) {
    if (count > winningCount || (count === winningCount && value > winningValue)) {
      winningValue = value;
      winningCount = count;
    }
  }

  return winningValue;
}

function buildPriceStats(rows: Record<string, string>[]) {
  const branchMonthlyCounters: Record<BranchId, Map<number, number>> = {
    D2: new Map<number, number>(),
    D7: new Map<number, number>()
  };
  const branchDepositCounters: Record<BranchId, Map<number, number>> = {
    D2: new Map<number, number>(),
    D7: new Map<number, number>()
  };
  const bedMonthlyCounters: Record<BranchId, Map<number, Map<number, number>>> = {
    D2: new Map<number, Map<number, number>>(),
    D7: new Map<number, Map<number, number>>()
  };
  const bedDepositCounters: Record<BranchId, Map<number, Map<number, number>>> = {
    D2: new Map<number, Map<number, number>>(),
    D7: new Map<number, Map<number, number>>()
  };

  for (const row of rows) {
    const branchId = normalizeClientBranch(getClientBranchValue(row));
    const bedNumber = parseBedNumber(String(row[CLIENT_BED_COLUMN] ?? ""));
    const monthlyPrice =
      parseMoney(String(row[CLIENT_MONTHLY_SHARE_COLUMN] ?? "")) ||
      parseMoney(String(row[CLIENT_MONTHLY_FEE_COLUMN] ?? ""));
    const deposit = parseMoney(String(row[CLIENT_DEPOSIT_COLUMN] ?? ""));

    if (monthlyPrice > 0) {
      branchMonthlyCounters[branchId].set(monthlyPrice, (branchMonthlyCounters[branchId].get(monthlyPrice) ?? 0) + 1);
      if (bedNumber) {
        const perBedCounter = bedMonthlyCounters[branchId].get(bedNumber) ?? new Map<number, number>();
        perBedCounter.set(monthlyPrice, (perBedCounter.get(monthlyPrice) ?? 0) + 1);
        bedMonthlyCounters[branchId].set(bedNumber, perBedCounter);
      }
    }

    if (deposit > 0) {
      branchDepositCounters[branchId].set(deposit, (branchDepositCounters[branchId].get(deposit) ?? 0) + 1);
      if (bedNumber) {
        const perBedCounter = bedDepositCounters[branchId].get(bedNumber) ?? new Map<number, number>();
        perBedCounter.set(deposit, (perBedCounter.get(deposit) ?? 0) + 1);
        bedDepositCounters[branchId].set(bedNumber, perBedCounter);
      }
    }
  }

  const perBranch: Record<BranchId, { monthlyPrice: number; deposit: number }> = {
    D2: {
      monthlyPrice: pickMostCommonValue(branchMonthlyCounters.D2),
      deposit: pickMostCommonValue(branchDepositCounters.D2)
    },
    D7: {
      monthlyPrice: pickMostCommonValue(branchMonthlyCounters.D7),
      deposit: pickMostCommonValue(branchDepositCounters.D7)
    }
  };

  const perBed: Record<BranchId, Map<number, { monthlyPrice: number; deposit: number }>> = {
    D2: new Map<number, { monthlyPrice: number; deposit: number }>(),
    D7: new Map<number, { monthlyPrice: number; deposit: number }>()
  };

  (Object.keys(BRANCH_LAYOUTS) as BranchId[]).forEach((branchId) => {
    const knownBeds = new Set<number>([
      ...bedMonthlyCounters[branchId].keys(),
      ...bedDepositCounters[branchId].keys()
    ]);

    for (const bedNumber of knownBeds) {
      perBed[branchId].set(bedNumber, {
        monthlyPrice:
          pickMostCommonValue(bedMonthlyCounters[branchId].get(bedNumber) ?? new Map<number, number>()) ||
          perBranch[branchId].monthlyPrice,
        deposit:
          pickMostCommonValue(bedDepositCounters[branchId].get(bedNumber) ?? new Map<number, number>()) ||
          perBranch[branchId].deposit
      });
    }
  });

  return {
    perBed,
    perBranch
  } satisfies PriceStats;
}

function buildReservations(rows: Record<string, string>[]) {
  return rows.flatMap((row) => {
    if (String(row[ACTIVE_STAYING_COLUMN] ?? "").trim() !== "1") {
      return [];
    }

    const branchId = normalizeClientBranch(getClientBranchValue(row));
    const bedNumber = parseBedNumber(String(row[CLIENT_BED_COLUMN] ?? ""));
    if (!bedNumber) {
      return [];
    }

    const room = getRoomForBed(branchId, bedNumber);
    if (!room) {
      return [];
    }

    return [
      {
        branchId,
        room: room.room,
        bedNumber,
        sex: normalizeSex(String(row[CLIENT_GENDER_COLUMN] ?? "")),
        startDate: parseVietnamDate(String(row[CLIENT_CONTRACT_START_COLUMN] ?? "")),
        endDate: parseVietnamDate(String(row[CLIENT_CONTRACT_END_COLUMN] ?? ""))
      } satisfies Reservation
    ];
  });
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
    message: eligible ? "Eligible for referral discount." : "Not eligible for referral discount."
  };
}

export async function getProspectBedAvailability(input: {
  branchId: BranchId;
  sex: ProspectSex;
}) {
  const [cache, overrideRows, parkingOverrides, branchSettings] = await Promise.all([
    getClientCache(),
    getBedOverrides("long_term"),
    getBedParkingFeeOverrides(input.branchId),
    getBranchPricingSettings(input.branchId)
  ]);
  const reservations = buildReservations(cache.rows);
  const pricing = buildPriceStats(cache.rows);
  // Build a lookup: bedNumber → override
  const bedOverrideMap = new Map(
    overrideRows
      .filter((r) => r.branchId === input.branchId)
      .map((r) => [r.bedNumber, r])
  );
  const parkingOverrideMap = new Map(parkingOverrides.map((r) => [r.bedNumber, r.parkingFeeVnd]));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const windowEnd = addDays(today, 30);
  const branchRooms = BRANCH_LAYOUTS[input.branchId];

  const rooms = branchRooms
    .map((room) => {
      const roomReservations = reservations.filter(
        (reservation) => reservation.branchId === input.branchId && reservation.room === room.room
      );
      const totalBedNumbers = Array.from(
        { length: room.endBed - room.startBed + 1 },
        (_, index) => room.startBed + index
      );

      const beds = totalBedNumbers.flatMap((bedNumber) => {
        let firstAvailableDate: Date | null = null;

        for (
          let day = new Date(today);
          day <= windowEnd;
          day = addDays(day, 1)
        ) {
          const roomOccupants = roomReservations.filter((reservation) => isReservationActiveOnDate(reservation, day));
          const bedIsOccupied = roomOccupants.some((reservation) => reservation.bedNumber === bedNumber);
          if (bedIsOccupied) {
            continue;
          }

          const hasOppositeSexOccupant = roomOccupants.some(
            (reservation) => reservation.sex != null && reservation.sex !== input.sex
          );
          if (hasOppositeSexOccupant) {
            continue;
          }

          firstAvailableDate = new Date(day);
          break;
        }

        if (!firstAvailableDate) {
          return [];
        }

        const sheetPrice = pricing.perBed[input.branchId].get(bedNumber) ?? pricing.perBranch[input.branchId];
        const override = bedOverrideMap.get(bedNumber);
        const price = {
          monthlyPrice: override?.monthlyPrice ?? sheetPrice.monthlyPrice,
          deposit: override?.deposit ?? sheetPrice.deposit
        };

        return [
          {
            bedNumber,
            status: isSameDay(firstAvailableDate, today) ? "available_now" : "available_soon",
            availableOn: toIsoDate(firstAvailableDate),
            pricing: {
              monthlyPrice: price.monthlyPrice,
              deposit: price.deposit,
              parkingFeeVnd: parkingOverrideMap.has(bedNumber)
                ? parkingOverrideMap.get(bedNumber)!
                : branchSettings.parkingFeeVnd,
              cleaningOptOutFeeVnd: branchSettings.cleaningOptOutFeeVnd
            }
          } satisfies BedAvailabilityRecord
        ];
      });

      return {
        room: room.room,
        floor: room.floor,
        totalBeds: totalBedNumbers.length,
        beds
      };
    })
    .filter((room) => room.beds.length > 0);

  return {
    syncedAt: cache.syncedAt,
    branchId: input.branchId,
    sex: input.sex,
    availableBeds: rooms.reduce((sum, room) => sum + room.beds.length, 0),
    pricingDefaults: pricing.perBranch[input.branchId],
    rooms
  };
}
