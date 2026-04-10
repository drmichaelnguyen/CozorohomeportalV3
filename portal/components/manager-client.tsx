"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { parseVietnamDate } from "../lib/contract-utils";
import { AdminCleaningClient } from "./admin-cleaning-client";
import { ManagerSupportInbox } from "./manager-support-inbox";
import { LaundryScheduleManager } from "./laundry-schedule-manager";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import Link from "next/link";
import { InlineHelp } from "./inline-help";


type StaffRole = "manager" | "owner" | "app_admin" | "mechanic";
type StatsTab = "laundry" | "coins" | "payments" | "fines";
type ClientAction = "call" | "sms" | "email" | "message" | "fine" | "coins" | "payment" | "password" | "remove" | "";
type CoinEntryMode = "add" | "use";
type ManagerView = "overview" | "client_list" | "owners_employees" | "support_chat" | "feedbacks" | "admin_cleaning" | "scheduling" | "controller" | "short_term" | "settings";
type StatSummaryItem = {
  label: string;
  value: string;
  tone?: "default" | "positive" | "warning";
};

type ManagerClientRecord = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  gender: string;
  activeStay: string;
  currentCoins: string;
  totalCoins: string;
  recordedMember: string;
  row: Record<string, any>;
};

type SmartDevice = {
  id: string;
  label: string;
  branchId: string;
  lastRequestedAction?: string;
};

type ControllerHistoryEntry = {
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

type BranchLayoutRoom = {
  room: string;
  floor: string;
  startBed: number;
  endBed: number;
  bunkCount: number;
};

type CoinEntry = { row: Record<string, string>; parsedTimestamp: string | null };
type PaymentEntry = { row: Record<string, string>; parsedTimestamp: string | null };
type PaymentCachePayload = { syncedAt?: string; rows?: Record<string, string>[]; error?: string };
type ClientChatMessage = {
  id: string;
  senderEmail: string;
  senderName: string | null;
  senderRole: "RESIDENT" | "MANAGER" | "OWNER";
  body: string;
  createdAt: string;
};
type MaintenanceTicket = {
  id: string;
  residentEmail: string;
  residentName: string;
  branch: string;
  location: string;
  device: string;
  issue: string;
  reportedAt: string;
  status: "REPORTED" | "ASSIGNED" | "SOLVED" | "CLOSED";
  mechanicEmail?: string | null;
  solvedAt?: string | null;
  repairTimeMinutes?: number | null;
  satisfaction?: "SATISFIED" | "UNSATISFIED" | null;
  feedback?: string | null;
};
type FineEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
};
type DuplicateEntry = { email: string; name: string; rows: Array<{ maHd: string; submissionTimestamp: string; contractStart: string; contractEnd: string; activeStay: string; bed: string; branch: string }> };
type LaundryEntry = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
};
type StaffEntry = {
  email: string;
  role: StaffRole;
  name?: string;
  addedBy: string;
  permissions?: ManagerPermissionsState;
};
type AccountLockOverride = {
  email: string;
  unlocked: boolean;
  note?: string;
  updatedAt: string;
  updatedBy: string;
};
type FeedbackEntry = {
  fileName: string;
  email: string;
  page: string;
  message: string;
  createdAt: string;
};

const PAYMENT_COMPACT_COLUMNS = [
  "Chi nhánh Dorm",
  "DẤU THỜI GIAN",
  "Địa chỉ email",
  "Số giường",
  "NGƯỜI NHẬN TIỀN",
  "NGƯỜI ĐÓNG TIỀN",
  "SỐ TIỀN",
  "MỤC ĐÍCH",
  "MỤC ĐÍCH - GHI RÕ",
  "Địa chỉ email người nhận"
] as const;

const MANAGER_FUNCTION_HELP = {
  contractStatus:
    "Contract Status lets a manager see whether the resident is active, terminated, or already checked out.\n\nThis aligns with Cozorohome policy by making termination and check-out steps explicit before access or deposit decisions are changed.",
  monthlyRent:
    "Monthly Rent shows the current month's breakdown, lets the manager adjust approved inputs, and creates the receipt.\n\nThis aligns with Cozorohome policy by keeping the final receipt based on the sheet-backed rent calculation and recording the paid status when the receipt is created.",
  featureLock:
    "Feature Lock controls whether the resident follows the normal automatic restriction rules or has a temporary manager override.\n\nThis aligns with Cozorohome policy by keeping overdue-rent and expired-contract restrictions automatic unless a manager intentionally unlocks access.",
  clientActions:
    "Client Actions are the manager-side tools for calling, messaging, fines, coins, password support, and receipt creation.\n\nThis aligns with Cozorohome policy by keeping resident support actions inside tracked manager workflows instead of unrecorded side actions."
} as const;

type RentBreakdown = {
  email: string;
  month: string;
  baseRent: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate: number;
  monthlyAdjustmentVnd: number;
  professionalDiscountVnd: number;
  planDiscountVnd: number;
  managerDiscountVnd: number;
  parkingFeeVnd: number;
  laundryFeeVnd: number;
  finesVnd: number;
  totalBeforeCoinsVnd: number;
  maxCoinUsageVnd: number;
  recommendedCoinUsage: number;
  recommendedCoinValueVnd: number;
  finalTotalVnd: number;
  details: {
    durationMonths: number;
    professionalStatus: string;
    workplace: string;
    memberTier: string;
    parkingCount: { motorbikes: number; bicycles: number };
    laundryCount: { free: number; coins: number; cash: number };
    unpaidFinesCount: number;
  };
};

function normalizeRentBreakdown(input: Partial<RentBreakdown> | null | undefined): RentBreakdown | null {
  if (!input) {
    return null;
  }

  return {
    email: input.email ?? "",
    month: input.month ?? "",
    baseRent: Number(input.baseRent ?? 0),
    tenureSurchargeVnd: Number(input.tenureSurchargeVnd ?? 0),
    tenureSurchargeRate: Number(input.tenureSurchargeRate ?? 0),
    monthlyAdjustmentVnd: Number(input.monthlyAdjustmentVnd ?? 0),
    professionalDiscountVnd: Number(input.professionalDiscountVnd ?? 0),
    planDiscountVnd: Number(input.planDiscountVnd ?? 0),
    managerDiscountVnd: Number(input.managerDiscountVnd ?? 0),
    parkingFeeVnd: Number(input.parkingFeeVnd ?? 0),
    laundryFeeVnd: Number(input.laundryFeeVnd ?? 0),
    finesVnd: Number(input.finesVnd ?? 0),
    totalBeforeCoinsVnd: Number(input.totalBeforeCoinsVnd ?? 0),
    maxCoinUsageVnd: Number(input.maxCoinUsageVnd ?? 0),
    recommendedCoinUsage: Number(input.recommendedCoinUsage ?? 0),
    recommendedCoinValueVnd: Number(input.recommendedCoinValueVnd ?? 0),
    finalTotalVnd: Number(input.finalTotalVnd ?? 0),
    details: {
      durationMonths: Number(input.details?.durationMonths ?? 0),
      professionalStatus: input.details?.professionalStatus ?? "",
      workplace: input.details?.workplace ?? "",
      memberTier: input.details?.memberTier ?? "",
      parkingCount: {
        motorbikes: Number(input.details?.parkingCount?.motorbikes ?? 0),
        bicycles: Number(input.details?.parkingCount?.bicycles ?? 0)
      },
      laundryCount: {
        free: Number(input.details?.laundryCount?.free ?? 0),
        coins: Number(input.details?.laundryCount?.coins ?? 0),
        cash: Number(input.details?.laundryCount?.cash ?? 0)
      },
      unpaidFinesCount: Number(input.details?.unpaidFinesCount ?? 0)
    }
  };
}

function formatPercentInput(rate: number | null | undefined): string {
  return String(Math.round(Number(rate ?? 0) * 10000) / 100);
}

type WorkspacePayload = {
  client: ManagerClientRecord;
  stats: {
    laundry: LaundryEntry[];
    coins: CoinEntry[];
    payments: PaymentEntry[];
    fines: FineEntry[];
  };
};

const HIDDEN_CLIENT_COLUMNS = new Set(["Địa chỉ email - Hidden"]);

const COIN_EVENT_OPTIONS = [
  "Laundry reward",
  "Cleaning reward",
  "Referral reward",
  "Manual bonus",
  "Laundry usage",
  "Fine payment",
  "Member upgrade",
  "Manual deduction"
];

const BRANCH_LAYOUTS: Record<"D2" | "D7", BranchLayoutRoom[]> = {
  D2: [
    { room: "1", floor: "D2", startBed: 1, endBed: 9, bunkCount: 3 },
    { room: "2", floor: "D2", startBed: 10, endBed: 15, bunkCount: 2 },
    { room: "3", floor: "D2", startBed: 16, endBed: 21, bunkCount: 2 }
  ],
  D7: [
    { room: "1.1", floor: "Floor 1", startBed: 1, endBed: 9, bunkCount: 3 },
    { room: "1.2", floor: "Floor 1", startBed: 10, endBed: 15, bunkCount: 2 },
    { room: "1.3", floor: "Floor 1", startBed: 16, endBed: 24, bunkCount: 3 },
    { room: "2.1", floor: "Floor 2", startBed: 25, endBed: 33, bunkCount: 3 },
    { room: "2.2", floor: "Floor 2", startBed: 34, endBed: 39, bunkCount: 2 },
    { room: "2.3", floor: "Floor 2", startBed: 40, endBed: 48, bunkCount: 3 },
    { room: "3.1", floor: "Floor 3", startBed: 49, endBed: 57, bunkCount: 3 },
    { room: "3.2", floor: "Floor 3", startBed: 58, endBed: 63, bunkCount: 2 }
  ]
};

function getLastName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toDateTimeLocalValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function makeKey(parts: Array<string | null | undefined>) {
  return parts.map((part) => String(part ?? "")).join("::");
}

function normalizeLookupValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findRowValue(row: Record<string, string>, fragments: string[]) {
  const match = Object.entries(row).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }
    const normalizedKey = normalizeLookupValue(key);
    return fragments.every((fragment) => normalizedKey.includes(fragment));
  });
  return String(match?.[1] ?? "").trim();
}

function getPaymentRowValue(row: Record<string, string>, column: (typeof PAYMENT_COMPACT_COLUMNS)[number]) {
  switch (column) {
    case "Địa chỉ email":
      return String(row.EMAIL ?? row["Địa chỉ email"] ?? "").trim();
    case "Số giường":
      return String(row["Số giường"] ?? row.BED ?? "").trim();
    default:
      return String(row[column] ?? "").trim();
  }
}

function parseLooseNumber(value: string | null | undefined) {
  const cleaned = String(value ?? "").replace(/[^\d-]/g, "");
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCurrency(value: number) {
  return `${formatNumber(value)} VND`;
}

function parseLooseDate(value: string | null | undefined): Date | null {
  return parseVietnamDate(String(value ?? ""));
}

function getAutomaticFeatureLockStatus(client: ManagerClientRecord | null) {
  if (!client) {
    return { isBlocked: false, reason: "", kind: "" as "" | "contract" | "rent" };
  }

  const now = new Date();
  const msPerDay = 86400000;
  const blockGraceDays = 5;
  const contractEnd = parseLooseDate(client.row?.["Ngày hết hạn hợp đồng"]);
  const paymentExpiry = parseLooseDate(client.row?.["Ngày hết hạn gói đã thanh toán"]);

  if (contractEnd) {
    const diffDays = (now.getTime() - contractEnd.getTime()) / msPerDay;
    if (diffDays > blockGraceDays) {
      return {
        isBlocked: true,
        reason: `Contract expired ${Math.floor(diffDays)} days ago`,
        kind: "contract" as const
      };
    }
  }

  if (paymentExpiry) {
    const diffDays = (now.getTime() - paymentExpiry.getTime()) / msPerDay;
    if (diffDays > blockGraceDays) {
      return {
        isBlocked: true,
        reason: `Rent overdue ${Math.floor(diffDays)} days`,
        kind: "rent" as const
      };
    }
  }

  return { isBlocked: false, reason: "", kind: "" as const };
}

type DataCategory = "clients" | "fines" | "payments" | "cleaning" | "laundry" | "support" | "coins" | "stats";

type ManagerPermissionsState = {
  branches: string[];
  data: Partial<Record<DataCategory, { read: boolean; write: boolean }>>;
};

const DATA_CATEGORIES: { key: DataCategory; label: string; hasWrite: boolean }[] = [
  { key: "clients",  label: "Clients",           hasWrite: true  },
  { key: "fines",    label: "Fines",              hasWrite: true  },
  { key: "payments", label: "Payments",           hasWrite: true  },
  { key: "cleaning", label: "Cleaning schedule",  hasWrite: true  },
  { key: "laundry",  label: "Laundry",            hasWrite: true  },
  { key: "support",  label: "Support / Messages", hasWrite: true  },
  { key: "coins",    label: "Coins",              hasWrite: true  },
  { key: "stats",    label: "Statistics",         hasWrite: false },
];
const KNOWN_BRANCHES = ["D2", "D7"];

type ShortTermConfig = {
  bedPricing: Record<string, Record<string, number>>;
  discounts: {
    weekly:  { enabled: boolean; minNights: number; percent: number };
    monthly: { enabled: boolean; minNights: number; percent: number };
  };
  minimumStay: number;
  updatedAt: string;
  updatedBy: string;
};

const ST_D2_BEDS = Array.from({ length: 21 }, (_, i) => String(i + 1));
const ST_D7_BEDS = Array.from({ length: 63 }, (_, i) => String(i + 1));

type StandaloneBooking = {
  id: string;
  guestName: string;
  email: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  pricing: { nights: number; nightlyRate: number; total: number; cleaningFee?: number };
  source?: string;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  mainAppImported?: boolean;
  mainAppBranch?: string;
  mainAppBed?: string;
  createdAt: string;
};

type PaymentPlanSummary = {
  planLabel: string;           // "Monthly" | "3-month" | "6-month"
  planType: "monthly" | "3month" | "6month";
  packageExpiry: Date | null;  // for prepaid plans
  nextPaymentDate: Date;
  isDue: boolean;              // overdue or no payment recorded this month
};

function derivePaymentPlanSummary(row: Record<string, string>, rentPaidStatus: boolean | null): PaymentPlanSummary {
  const planRaw = String(row["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
  const expiryRaw = row["Ngày hết hạn gói đã thanh toán"] ?? "";
  const packageExpiry = parseLooseDate(expiryRaw);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let planType: PaymentPlanSummary["planType"] = "monthly";
  let planLabel = "Monthly";
  if (planRaw.includes("06 tháng")) { planType = "6month"; planLabel = "6-month plan"; }
  else if (planRaw.includes("03 tháng")) { planType = "3month"; planLabel = "3-month plan"; }

  let nextPaymentDate: Date;
  if (planType !== "monthly" && packageExpiry) {
    nextPaymentDate = packageExpiry;
  } else {
    nextPaymentDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  let isDue = false;
  if (planType === "monthly") {
    // Due if today is past the 1st and not marked paid
    isDue = rentPaidStatus === false;
  } else if (packageExpiry) {
    isDue = packageExpiry.getTime() < now.getTime();
  }

  return { planLabel, planType, packageExpiry, nextPaymentDate, isDue };
}

function summarizeLaundry(entries: LaundryEntry[], t: (key: string, fallback?: string) => string): StatSummaryItem[] {
  const now = Date.now();
  const upcoming = entries.filter((entry) => new Date(entry.start).getTime() > now).length;
  const completed = entries.filter((entry) => new Date(entry.end).getTime() <= now).length;
  const nextBooking = entries
    .filter((entry) => new Date(entry.start).getTime() > now)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())[0];

  return [
    { label: t("totalBookings", "Total bookings"), value: formatNumber(entries.length) },
    { label: t("upcoming", "Upcoming"), value: formatNumber(upcoming), tone: upcoming > 0 ? "positive" : "default" },
    { label: t("completed", "Completed"), value: formatNumber(completed) },
    { label: t("nextBooking", "Next booking"), value: nextBooking ? formatDateTime(nextBooking.start) : t("noUpcomingBooking", "No upcoming booking"), tone: nextBooking ? "warning" : "default" }
  ];
}

function summarizeCoins(entries: CoinEntry[], client: ManagerClientRecord | null, t: (key: string, fallback?: string) => string): StatSummaryItem[] {
  const deltas = entries.map((entry) =>
    parseLooseNumber(findRowValue(entry.row, ["coins"]) || entry.row.COINS || entry.row["COINS"])
  );
  const earned = deltas.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const spent = Math.abs(deltas.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  return [
    { label: t("currentBalance", "Current balance"), value: formatNumber(parseLooseNumber(client?.currentCoins != null ? String(client.currentCoins) : null)), tone: "positive" },
    { label: t("lifetimeCoins", "Lifetime coins"), value: formatNumber(parseLooseNumber(client?.totalCoins != null ? String(client.totalCoins) : null)) },
    { label: t("coinsAdded", "Coins added"), value: formatNumber(earned) },
    { label: t("coinsUsed", "Coins used"), value: formatNumber(spent), tone: spent > 0 ? "warning" : "default" }
  ];
}

function summarizePayments(entries: PaymentEntry[], t: (key: string, fallback?: string) => string): StatSummaryItem[] {
  const amounts = entries.map((entry) =>
    parseLooseNumber(findRowValue(entry.row, ["sotien"]) || findRowValue(entry.row, ["amount"]))
  );
  const totalPaid = amounts.reduce((sum, value) => sum + value, 0);
  const latestPayment = entries[0]?.parsedTimestamp ?? null;

  return [
    { label: t("paymentCount", "Payment count"), value: formatNumber(entries.length) },
    { label: t("totalPaid", "Total paid"), value: formatCurrency(totalPaid), tone: "positive" },
    { label: t("averagePayment", "Average payment"), value: entries.length ? formatCurrency(Math.round(totalPaid / entries.length)) : formatCurrency(0) },
    { label: t("latestPayment", "Latest payment"), value: latestPayment ? formatDateTime(latestPayment) : t("noPaymentsYet", "No payments yet") }
  ];
}

function summarizeFines(entries: FineEntry[], t: (key: string, fallback?: string) => string): StatSummaryItem[] {
  const amounts = entries.map((entry) =>
    parseLooseNumber(findRowValue(entry.row, ["chiphi"]) || findRowValue(entry.row, ["amount"]))
  );
  const unpaidCount = entries.filter((entry) => {
    const status = (findRowValue(entry.row, ["dathanhtoan"]) || findRowValue(entry.row, ["status"]) || "").toLowerCase();
    return status ? !(status.includes("yes") || status.includes("paid") || status.includes("roi") || status.includes("rồi")) : true;
  }).length;
  const totalFine = amounts.reduce((sum, value) => sum + value, 0);
  const nextDue = entries
    .filter((entry) => entry.parsedDueDate)
    .sort((left, right) => new Date(left.parsedDueDate ?? "").getTime() - new Date(right.parsedDueDate ?? "").getTime())[0];

  return [
    { label: t("fineCount", "Fine count"), value: formatNumber(entries.length) },
    { label: t("unpaidFines", "Unpaid fines"), value: formatNumber(unpaidCount), tone: unpaidCount > 0 ? "warning" : "default" },
    { label: t("totalFineValue", "Total fine value"), value: formatCurrency(totalFine) },
    { label: t("nearestDueDate", "Nearest due date"), value: nextDue?.parsedDueDate ? formatDateTime(nextDue.parsedDueDate) : t("noDueDate", "No due date"), tone: nextDue?.parsedDueDate ? "warning" : "default" }
  ];
}

function getSummaryItems(tab: StatsTab, workspace: WorkspacePayload | null, t: (key: string, fallback?: string) => string): StatSummaryItem[] {
  if (!workspace) {
    return [];
  }

  if (tab === "laundry") {
    return summarizeLaundry(workspace.stats.laundry, t);
  }
  if (tab === "coins") {
    return summarizeCoins(workspace.stats.coins, workspace.client, t);
  }
  if (tab === "payments") {
    return summarizePayments(workspace.stats.payments, t);
  }
  return summarizeFines(workspace.stats.fines, t);
}

function normalizeBranchLabel(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7")) {
    return "D7";
  }
  if (normalized === "2" || normalized === "D2" || normalized.includes("D2")) {
    return "D2";
  }
  return value.trim() || "Unknown";
}

function findConfiguredRoom(branch: string, bedValue: string) {
  const normalizedBranch = normalizeBranchLabel(branch);
  const branchLayout =
    normalizedBranch === "D2" || normalizedBranch === "D7" ? BRANCH_LAYOUTS[normalizedBranch] : null;
  const bedNumber = parseBedNumber(bedValue);

  if (!branchLayout || !bedNumber) {
    return null;
  }

  return branchLayout.find((room) => bedNumber >= room.startBed && bedNumber <= room.endBed) ?? null;
}

function resolveClientRoom(client: ManagerClientRecord) {
  const configuredRoom = findConfiguredRoom(client.branch, client.bed);
  if (configuredRoom) {
    return configuredRoom.room;
  }

  const roomEntry = Object.entries(client.row).find(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    return (
      (normalizedKey.includes("room") ||
        normalizedKey.includes("phong") ||
        normalizedKey.includes("phòng") ||
        normalizedKey.includes("so phong") ||
        normalizedKey.includes("số phòng")) &&
      String(value ?? "").trim()
    );
  });

  if (roomEntry) {
    return String(roomEntry[1]).trim();
  }

  const bed = Number.parseInt(client.bed, 10);
  if (Number.isFinite(bed) && bed > 0) {
    return `Bed ${bed}`;
  }

  return "Unassigned";
}

function getClientPhone(client: ManagerClientRecord | null) {
  if (!client) {
    return "";
  }

  const phoneEntry = Object.entries(client.row).find(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    return (
      (normalizedKey.includes("phone") ||
        normalizedKey.includes("điện thoại") ||
        normalizedKey.includes("dien thoai") ||
        normalizedKey.includes("liên hệ") ||
        normalizedKey.includes("lien he")) &&
      String(value ?? "").trim()
    );
  });

  return String(phoneEntry?.[1] ?? "").trim();
}

function toPhoneHref(phone: string) {
  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function toSmsHref(phone: string) {
  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `sms:${normalized}` : "";
}

function parseBedNumber(value: string) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function deriveRoomFloor(room: string) {
  const configuredRoom = [...BRANCH_LAYOUTS.D2, ...BRANCH_LAYOUTS.D7].find((entry) => entry.room === room.trim());
  if (configuredRoom) {
    return configuredRoom.floor;
  }

  const normalized = room.trim();
  const match = normalized.match(/(\d{3,4})/);
  if (match) {
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric >= 100) {
      return `Floor ${String(numeric)[0]}`;
    }
  }

  const explicitFloor = normalized.match(/floor\s*([0-9]+)/i);
  if (explicitFloor) {
    return `Floor ${explicitFloor[1]}`;
  }

  return "Floor ?";
}

function buildBunkDiagram(clients: ManagerClientRecord[]) {
  const stacks = new Map<number, Partial<Record<1 | 2 | 3, ManagerClientRecord>>>();
  const unassigned: ManagerClientRecord[] = [];

  for (const client of clients) {
    const bedNumber = parseBedNumber(client.bed);
    if (!bedNumber) {
      unassigned.push(client);
      continue;
    }

    const stackNumber = Math.floor((bedNumber - 1) / 3) + 1;
    const level = (((bedNumber - 1) % 3) + 1) as 1 | 2 | 3;
    if (!stacks.has(stackNumber)) {
      stacks.set(stackNumber, {});
    }
    stacks.get(stackNumber)![level] = client;
  }

  return {
    stacks: Array.from(stacks.entries()).sort((left, right) => left[0] - right[0]),
    unassigned
  };
}

function buildRoomDiagram(room: BranchLayoutRoom, clients: ManagerClientRecord[]) {
  const bedAssignments = new Map<number, ManagerClientRecord>();
  const unassigned: ManagerClientRecord[] = [];

  for (const client of clients) {
    const bedNumber = parseBedNumber(client.bed);
    if (!bedNumber || bedNumber < room.startBed || bedNumber > room.endBed) {
      unassigned.push(client);
      continue;
    }
    bedAssignments.set(bedNumber, client);
  }

  const bunks = Array.from({ length: room.bunkCount }, (_, bunkIndex) => {
    const stackStartBed = room.startBed + bunkIndex * 3;
    const levels = [3, 2, 1].map((level) => {
      const bedNumber = stackStartBed + (level - 1);
      return {
        level,
        bedNumber,
        client: bedAssignments.get(bedNumber) ?? null
      };
    });

    return {
      bunkNumber: bunkIndex + 1,
      levels
    };
  });

  return {
    bunks,
    unassigned
  };
}

function fineFieldLabels(language: "en" | "vi") {
  if (language === "vi") {
    return {
      dueDate: "HẠN THANH TOÁN",
      location: "VỊ TRÍ PHÁT HIỆN VI PHẠM",
      content: "NỘI DUNG VI PHẠM",
      description: "MÔ TẢ VI PHẠM",
      image: "HÌNH ẢNH",
      amount: "CHI PHÍ THANH TOÁN CHO VI PHẠM",
      imagePlaceholder: "Dán liên kết hình ảnh",
      submit: "Tạo phiếu phạt"
    };
  }

  return {
    dueDate: "Payment Due Date",
    location: "Violation Location",
    content: "Violation Content",
    description: "Violation Description",
    image: "Image",
    amount: "Violation Payment Cost",
    imagePlaceholder: "Paste image URL",
    submit: "Create fine ticket"
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function chatRoleLabel(role: ClientChatMessage["senderRole"]) {
  if (role === "OWNER") {
    return "Owner";
  }
  if (role === "MANAGER") {
    return "Staff";
  }
  return "Resident";
}


export function ManagerClient({ initialView = "overview" }: { initialView?: ManagerView }) {

  const { language, setLanguage, t } = usePortalLanguage();
  const { sessionEmail, sessionRole } = usePortalSession();
  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isStaffSession = Boolean(sessionRole && sessionRole !== "user" && normalizedEmail);
  const isOwnerSession = sessionRole === "owner";
  const isAppAdminSession = sessionRole === "app_admin";
  const canManageOwnersEmployees = isOwnerSession || isAppAdminSession;
  const canCreatePaymentReceipt =
    sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin";

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [clients, setClients] = useState<ManagerClientRecord[]>([]);
  const [selectedMaHd, setSelectedMaHd] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [search, setSearch] = useState("");
  const [inactiveClients, setInactiveClients] = useState<ManagerClientRecord[]>([]);
  const [inactiveClientsLoading, setInactiveClientsLoading] = useState(false);
  const [duplicateClients, setDuplicateClients] = useState<DuplicateEntry[]>([]);
  const [settingInactive, setSettingInactive] = useState<Record<string, boolean>>({});
  const [inactiveBranchFilter, setInactiveBranchFilter] = useState("");
  const [inactiveYearFilter, setInactiveYearFilter] = useState("");
  const [inactiveSearch, setInactiveSearch] = useState("");
  const [expandedInactiveEmail, setExpandedInactiveEmail] = useState<string | null>(null);
  const [expandedInactiveBed, setExpandedInactiveBed] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [isEditingClientProfile, setIsEditingClientProfile] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>("laundry");
  const [rentPaidStatus, setRentPaidStatus] = useState<boolean | null>(null);
  const [rentPaidMonth, setRentPaidMonth] = useState("");
  const [rentPaidLoading, setRentPaidLoading] = useState(false);
  const [rentSectionCollapsed, setRentSectionCollapsed] = useState(false);
  const [infoRentBreakdown, setInfoRentBreakdown] = useState<RentBreakdown | null>(null);
  const [infoManagerDiscount, setInfoManagerDiscount] = useState("0");
  const [infoShortTermSurchargeRate, setInfoShortTermSurchargeRate] = useState("0");
  const [infoParkingFee, setInfoParkingFee] = useState("0");
  const [infoRentCalculating, setInfoRentCalculating] = useState(false);
  const [clientNewPassword, setClientNewPassword] = useState("");
  const [clientPasswordLoading, setClientPasswordLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [clientChatMessages, setClientChatMessages] = useState<ClientChatMessage[]>([]);
  const [clientChatLoading, setClientChatLoading] = useState(false);
  const [coinAmount, setCoinAmount] = useState("1000");
  const [coinReason, setCoinReason] = useState(COIN_EVENT_OPTIONS[0]);
  const [coinEntryMode, setCoinEntryMode] = useState<CoinEntryMode>("add");
  const [fineAmount, setFineAmount] = useState("30000");
  const [fineContent, setFineContent] = useState("");
  const [fineDescription, setFineDescription] = useState("");
  const [fineLocation, setFineLocation] = useState("");
  const [fineDueDate, setFineDueDate] = useState("");
  const [fineImage, setFineImage] = useState("");
  const [fineImageUploading, setFineImageUploading] = useState(false);
  const [fineImageFileName, setFineImageFileName] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("1000000");
  const [paymentPurpose, setPaymentPurpose] = useState("");
  const [paymentPurposeInput, setPaymentPurposeInput] = useState("");
  const [paymentPurposeSelections, setPaymentPurposeSelections] = useState<string[]>([]);
  const [paymentPurposeOpen, setPaymentPurposeOpen] = useState(false);
  const [paymentPurposeRows, setPaymentPurposeRows] = useState<Record<string, string>[]>([]);
  const [paymentDetails, setPaymentDetails] = useState("");
  const [paymentPayer, setPaymentPayer] = useState("");
  const [paymentBranch, setPaymentBranch] = useState("");
  const [paymentRecipientEmail, setPaymentRecipientEmail] = useState("");
  const [paymentMemberTier, setPaymentMemberTier] = useState("");
  const [paymentCurrentCoins, setPaymentCurrentCoins] = useState("");
  const [paymentDiscountAmount, setPaymentDiscountAmount] = useState("");
  const [paymentDiscountCondition, setPaymentDiscountCondition] = useState("");
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [showStaffList, setShowStaffList] = useState(false);
  const [removeConfirmEntry, setRemoveConfirmEntry] = useState<StaffEntry | null>(null);
  const [removeConfirmPassword, setRemoveConfirmPassword] = useState("");
  const [removeConfirmError, setRemoveConfirmError] = useState("");
  const [removeConfirmLoading, setRemoveConfirmLoading] = useState(false);
  const [accountLockOverride, setAccountLockOverride] = useState<AccountLockOverride | null>(null);
  const [accountLockOverrideLoading, setAccountLockOverrideLoading] = useState(false);
  // Short-term portal state
  const [stExpanded, setStExpanded] = useState<Record<string, boolean>>({});
  const [stConfig, setStConfig] = useState<ShortTermConfig | null>(null);
  const [stConfigLoading, setStConfigLoading] = useState(false);
  const [stConfigSaving, setStConfigSaving] = useState(false);
  const [stGuests, setStGuests] = useState<{ current: ManagerClientRecord[]; past: ManagerClientRecord[] } | null>(null);
  const [stGuestsLoading, setStGuestsLoading] = useState(false);
  const [stEditBedPricing, setStEditBedPricing] = useState<Record<string, Record<string, number>>>({});
  const [stPendingBookings, setStPendingBookings] = useState<StandaloneBooking[] | null>(null);
  const [stPendingLoading, setStPendingLoading] = useState(false);
  const [stConfirmDialog, setStConfirmDialog] = useState<{ booking: StandaloneBooking; branch: "D2" | "D7"; bed: string; saving: boolean; result: string } | null>(null);
  const [stAddDialog, setStAddDialog] = useState<{
    guestName: string; email: string; phone: string;
    checkIn: string; checkOut: string; branch: "D2" | "D7"; bed: string;
    totalAmount: string; paymentStatus: string; source: string; notes: string;
    saving: boolean; result: string;
  } | null>(null);
  // Unified pricing state
  type PricingBedOverride = {
    id: number; branchId: string; bedNumber: number; termType: "long_term" | "short_term";
    monthlyPrice: number | null; deposit: number | null; nightlyPrice: number | null;
    updatedBy: string; updatedAt: string; createdAt: string;
  };
  type PricingDiscount = {
    id: string; termType: "long_term" | "short_term"; label: string; labelVi: string;
    description: string; descriptionVi: string;
    amountVnd: number | null; percentOff: number | null; minNights: number | null;
    durationMonths: number | null; eligibility: Array<{ type: string; values?: string[]; value?: number }>;
    selectionMode: "manual" | "automatic";
    stackMode: "stackable" | "exclusive";
    enabled: boolean; updatedBy: string; updatedAt: string;
  };
  type BranchPricingSettings = {
    branchId: string; cleaningOptOutFeeVnd: number; parkingFeeVnd: number; updatedBy: string; updatedAt: string;
  };
  type BedParkingFeeOverride = {
    id: number; branchId: string; bedNumber: number; parkingFeeVnd: number; updatedBy: string; updatedAt: string;
  };
  const [pricingData, setPricingData] = useState<{
    bedOverrides: PricingBedOverride[];
    discounts: PricingDiscount[];
    branchSettings: BranchPricingSettings[];
    parkingOverrides: BedParkingFeeOverride[];
  } | null>(null);
  const [pricingConfigLoading, setPricingConfigLoading] = useState(false);
  const [pricingSettingsTab, setPricingSettingsTab] = useState<"long_term" | "short_term" | "staff">("long_term");
  const [bedPricingExpanded, setBedPricingExpanded] = useState(false);
  const [branchSettingsEdit, setBranchSettingsEdit] = useState<{
    branchId: string; cleaningOptOutFeeVnd: string; parkingFeeVnd: string; saving: boolean; result: string;
  } | null>(null);
  const [parkingBedEdit, setParkingBedEdit] = useState<{
    branchId: string; bedNumber: string; parkingFeeVnd: string; saving: boolean; result: string;
  } | null>(null);
  // "per_bed" = click individual beds | "by_room" = branch → floor → room → tier | "by_branch" = branch → tier only
  const [pricingDiagramMode, setPricingDiagramMode] = useState<"per_bed" | "by_room" | "by_branch">("per_bed");
  const [bulkTierEdit, setBulkTierEdit] = useState<{
    branchId: string; floor?: string; room?: string; tier: "top" | "middle" | "bottom" | "all";
    monthlyPrice: string; saving: boolean; result: string;
  } | null>(null);
  const [bedOverrideEdit, setBedOverrideEdit] = useState<{
    id?: number; branchId: string; bedNumber: string; termType: "long_term" | "short_term";
    monthlyPrice: string; deposit: string; nightlyPrice: string; saving: boolean; result: string;
  } | null>(null);
  const [discountEdit, setDiscountEdit] = useState<{
    id: string; termType: "long_term" | "short_term"; label: string; labelVi: string;
    description: string; descriptionVi: string;
    amountVnd: string; percentOff: string; minNights: string; durationMonths: string;
    eligibility: Array<{ type: string; values: string; value: string }>;
    selectionMode: "manual" | "automatic";
    stackMode: "stackable" | "exclusive";
    enabled: boolean; saving: boolean; result: string;
  } | null>(null);
  const [terminateDialog, setTerminateDialog] = useState(false);
  const [terminateNote, setTerminateNote] = useState("");
  const [terminateLoading, setTerminateLoading] = useState(false);
  const [terminationStatus, setTerminationStatus] = useState<{ maHd: string; terminatedAt: string; checkOut: { submittedAt: string } | null } | null | "loading">("loading");
  const [permissionsEntry, setPermissionsEntry] = useState<StaffEntry | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<ManagerPermissionsState | null>(null);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [selfDisplayName, setSelfDisplayName] = useState("");
  const [selfDisplayNameSaving, setSelfDisplayNameSaving] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>("manager");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [activeAction, setActiveAction] = useState<ClientAction>("");
  const [showAllStatsEntries, setShowAllStatsEntries] = useState(false);
  const [showClientDetails, setShowClientDetails] = useState(false);
  const [activeManagerView, setActiveManagerView] = useState<ManagerView>(initialView);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // v3.1.0 Rent States
  const [rentPaymentMode, setRentPaymentMode] = useState<"simple" | "rent">("rent");
  const [rentBreakdown, setRentBreakdown] = useState<RentBreakdown | null>(null);
  const [calculatingRent, setCalculatingRent] = useState(false);
  const [managerDiscountInput, setManagerDiscountInput] = useState("0");
  const [shortTermSurchargeRateInput, setShortTermSurchargeRateInput] = useState("0");
  const [parkingFeeInput, setParkingFeeInput] = useState("0");
  const [targetMonthInput, setTargetMonthInput] = useState(new Date().toISOString().slice(0, 7));
  
  // New subtab states
  const [schedulingTab, setSchedulingTab] = useState<"cleaning" | "laundry">("cleaning");
  const [clientListMode, setClientListMode] = useState<"diagram" | "table">("diagram");
  const [supportFilterBranch, setSupportFilterBranch] = useState("");
  const [supportSortBy, setSupportSortBy] = useState<"newest" | "oldest_unanswered">("newest");
  const [acRooms, setAcRooms] = useState<any[]>([]);
  const [laundryMachines, setLaundryMachines] = useState<any[]>([]);
  const [airfryers, setAirfryers] = useState<SmartDevice[]>([]);
  const [controllerLoading, setControllerLoading] = useState(false);
  const [showControllerHistory, setShowControllerHistory] = useState(false);
  const [controllerHistoryLoading, setControllerHistoryLoading] = useState(false);
  const [controllerHistory, setControllerHistory] = useState<ControllerHistoryEntry[]>([]);
  const [controllerActionPending, setControllerActionPending] = useState<Record<string, string>>({});
  const [controllerActionFeedback, setControllerActionFeedback] = useState<Record<string, { tone: "success" | "error"; message: string }>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [supportSubTab, setSupportSubTab] = useState<"messages" | "feedbacks" | "maintenance">("messages");
  const [clientSubTab, setClientSubTab] = useState<"list" | "details">("list");
  const [clientTermTab, setClientTermTab] = useState<"long_term" | "short_term" | "inactive">(
    initialView === "short_term" ? "short_term" : "long_term"
  );
  const [stPricingBranch, setStPricingBranch] = useState<"D2" | "D7">("D2");
  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceSort, setMaintenanceSort] = useState<{ field: keyof MaintenanceTicket; direction: "asc" | "desc" }>({
    field: "reportedAt",
    direction: "desc"
  });

  const loadMaintenanceTickets = async () => {
    setMaintenanceLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/staff/maintenance/tickets`);
      if (!response.ok) throw new Error("Failed to load maintenance tickets");
      const data = await response.json();
      const activeOnly = (data.tickets || []).filter((t: any) => t.status === "REPORTED" || t.status === "ASSIGNED");
      setMaintenanceTickets(activeOnly);
    } catch (err) {
      console.error(err);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const resolveMaintenanceTicket = async (ticketId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/staff/maintenance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          status: "SOLVED",
          solvedAt: new Date().toISOString()
        })
      });
      if (response.ok) {
        await loadMaintenanceTickets();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sortedMaintenanceTickets = useMemo(() => {
    return [...maintenanceTickets].sort((a, b) => {
      const aValue = (a[maintenanceSort.field] || "").toString();
      const bValue = (b[maintenanceSort.field] || "").toString();
      if (aValue < bValue) return maintenanceSort.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return maintenanceSort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [maintenanceTickets, maintenanceSort]);

  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return clients;
    }
    return clients.filter((client) =>
      [client.name, client.email, client.branch, client.bed, client.maHd]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [clients, search]);
  // Inactive clients (moved out = "0", left = "-1")
  const inactiveBranches = useMemo(() => {
    const raw = [...new Set(inactiveClients.map((c) => String(c.branch ?? "").trim()).filter(Boolean))];
    return raw.sort();
  }, [inactiveClients]);
  const inactiveYears = useMemo(() => {
    const years = new Set<string>();
    for (const c of inactiveClients) {
      const dateStr = String(c.row?.["Ngày bắt đầu hợp đồng"] ?? c.row?.["Ngày hết hạn hợp đồng"] ?? "");
      const match = dateStr.match(/(\d{4})/);
      if (match) years.add(match[1]);
    }
    return [...years].sort().reverse();
  }, [inactiveClients]);
  const filteredInactiveClients = useMemo(() => {
    let result = inactiveClients;
    if (inactiveBranchFilter) {
      result = result.filter((c) => String(c.branch ?? "").trim() === inactiveBranchFilter);
    }
    if (inactiveYearFilter) {
      result = result.filter((c) => {
        const dateStr = String(c.row?.["Ngày bắt đầu hợp đồng"] ?? c.row?.["Ngày hết hạn hợp đồng"] ?? "");
        return dateStr.includes(inactiveYearFilter);
      });
    }
    if (inactiveSearch.trim()) {
      const kw = inactiveSearch.trim().toLowerCase();
      result = result.filter((c) =>
        [c.name, c.email, c.maHd, c.branch, c.bed].join(" ").toLowerCase().includes(kw)
      );
    }
    return result;
  }, [inactiveClients, inactiveBranchFilter, inactiveYearFilter, inactiveSearch]);

  type InactivePerson = { email: string; name: string; contracts: ManagerClientRecord[] };
  type InactiveBed = { bed: string; bedNum: number; people: InactivePerson[] };
  type InactiveRoom = { room: string; beds: InactiveBed[] };
  type InactiveBranch = { branch: string; rooms: InactiveRoom[] };

  // Group filtered inactive clients: Branch → Room → Bed → People (by email)
  const groupedInactiveClients = useMemo((): InactiveBranch[] => {
    // Step 1: collect all contracts into bed buckets keyed by "branch|bed"
    type BedKey = string;
    const bedMap = new Map<BedKey, Map<string, InactivePerson>>();
    const bedMeta = new Map<BedKey, { branch: string; bed: string; bedNum: number }>();

    for (const c of filteredInactiveClients) {
      const branch = String(c.branch ?? "").trim() || "Unknown";
      const bed = String(c.bed ?? "").trim() || "?";
      const bedNum = parseInt(bed, 10) || 0;
      const bk: BedKey = `${branch}|${bed}`;
      if (!bedMap.has(bk)) {
        bedMap.set(bk, new Map());
        bedMeta.set(bk, { branch, bed, bedNum });
      }
      const personKey = (c.email || c.maHd).toLowerCase();
      const personMap = bedMap.get(bk)!;
      if (!personMap.has(personKey)) personMap.set(personKey, { email: c.email, name: c.name, contracts: [] });
      personMap.get(personKey)!.contracts.push(c);
    }

    // Sort each person's contracts newest-first
    for (const personMap of bedMap.values()) {
      for (const person of personMap.values()) {
        person.contracts.sort((a, b) =>
          String(b.row?.["Ngày bắt đầu hợp đồng"] ?? "").localeCompare(String(a.row?.["Ngày bắt đầu hợp đồng"] ?? ""))
        );
      }
    }

    // Step 2: group beds into rooms using BRANCH_LAYOUTS for D2/D7; fallback for others
    const branchMap = new Map<string, Map<string, InactiveBed[]>>();
    for (const [bk, personMap] of bedMap) {
      const meta = bedMeta.get(bk)!;
      const { branch, bed, bedNum } = meta;
      if (!branchMap.has(branch)) branchMap.set(branch, new Map());
      const roomMap = branchMap.get(branch)!;

      // Determine room label
      let roomLabel = "Other";
      const layout = BRANCH_LAYOUTS[branch as "D2" | "D7"];
      if (layout) {
        const found = layout.find(r => bedNum >= r.startBed && bedNum <= r.endBed);
        if (found) roomLabel = `Room ${found.room}`;
      }

      if (!roomMap.has(roomLabel)) roomMap.set(roomLabel, []);
      roomMap.get(roomLabel)!.push({
        bed,
        bedNum,
        people: [...personMap.values()]
      });
    }

    // Step 3: sort and flatten into array
    return [...branchMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([branch, roomMap]) => ({
        branch,
        rooms: [...roomMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([room, beds]) => ({
            room,
            beds: beds.sort((a, b) => a.bedNum - b.bedNum)
          }))
      }));
  }, [filteredInactiveClients]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.maHd === selectedMaHd)
      ?? inactiveClients.find((client) => client.maHd === selectedMaHd)
      ?? null,
    [clients, inactiveClients, selectedMaHd]
  );
  const fineLabels = fineFieldLabels(language);
  const fineUiText = {
    suggestionPlaceholder: t("suggestionPlaceholder", "Search previous entries or type a new value"),
    uploadHint: t("uploadHint", "Take a picture or upload an image from phone or computer"),
    uploading: t("uploading", "Uploading image..."),
    uploaded: t("uploaded", "Image uploaded to Google Drive"),
    removeImage: t("removeImage", "Remove image")
  };

  const quickNav = useMemo(() => {
    const branches = new Map<string, Map<string, ManagerClientRecord[]>>();

    for (const client of clients) {
      const branch = normalizeBranchLabel(client.branch);
      const room = resolveClientRoom(client);
      if (!branches.has(branch)) {
        branches.set(branch, new Map());
      }
      const rooms = branches.get(branch)!;
      if (!rooms.has(room)) {
        rooms.set(room, []);
      }
      rooms.get(room)!.push(client);
    }

    return Array.from(branches.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([branch, rooms]) => ({
        branch,
        rooms: Array.from(rooms.entries())
          .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
          .map(([room, roomClients]) => ({
            room,
            clients: [...roomClients].sort((left, right) =>
              (left.name || left.email).localeCompare(right.name || right.email, undefined, { sensitivity: "base" })
            )
          }))
      }));
  }, [clients]);

  const filteredQuickNav = useMemo(() => {
    const keyword = roomFilter.trim().toLowerCase();
    if (!keyword) {
      return quickNav;
    }

    return quickNav
      .map((entry) => ({
        ...entry,
        rooms: entry.rooms.filter((roomEntry) => roomEntry.room.toLowerCase().includes(keyword))
      }))
      .filter((entry) => entry.rooms.length > 0);
  }, [quickNav, roomFilter]);

  const visibleRooms =
    filteredQuickNav.find((entry) => entry.branch === selectedBranch)?.rooms ?? [];

  const visibleRoomClients =
    visibleRooms.find((entry) => entry.room === selectedRoom)?.clients ?? [];
  const summaryItems = useMemo(() => getSummaryItems(activeTab, workspace, t), [activeTab, workspace, t]);
  const roomDiagram = useMemo(() => buildBunkDiagram(visibleRoomClients), [visibleRoomClients]);
  const coinEventSuggestions = useMemo(() => {
    const historicalEvents =
      workspace?.stats.coins
        .map((entry) => findRowValue(entry.row, ["sukien"]) || findRowValue(entry.row, ["event"]))
        .filter((value): value is string => Boolean(value && value.trim())) ?? [];

    return Array.from(new Set([...COIN_EVENT_OPTIONS, ...historicalEvents])).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [workspace]);
  const filteredCoinEventSuggestions = useMemo(() => {
    const keyword = coinReason.trim().toLowerCase();
    if (!keyword) {
      return coinEventSuggestions;
    }
    return coinEventSuggestions.filter((option) => option.toLowerCase().includes(keyword));
  }, [coinEventSuggestions, coinReason]);
  const fineLocationSuggestions = useMemo(() => {
    const historicalLocations =
      workspace?.stats.fines
        .map(
          (entry) =>
            findRowValue(entry.row, ["vitriphathien"]) ||
            findRowValue(entry.row, ["violation", "location"]) ||
            findRowValue(entry.row, ["location"])
        )
        .filter((value): value is string => Boolean(value && value.trim())) ?? [];

    return Array.from(new Set(historicalLocations)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [workspace]);
  const filteredFineLocationSuggestions = useMemo(() => {
    const keyword = fineLocation.trim().toLowerCase();
    if (!keyword) {
      return fineLocationSuggestions;
    }
    return fineLocationSuggestions.filter((option) => option.toLowerCase().includes(keyword));
  }, [fineLocation, fineLocationSuggestions]);
  const fineContentSuggestions = useMemo(() => {
    const historicalContent =
      workspace?.stats.fines
        .map(
          (entry) =>
            findRowValue(entry.row, ["noidungvipham"]) ||
            findRowValue(entry.row, ["violation", "content"]) ||
            findRowValue(entry.row, ["content"])
        )
        .filter((value): value is string => Boolean(value && value.trim())) ?? [];

    return Array.from(new Set(historicalContent)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [workspace]);
  const filteredFineContentSuggestions = useMemo(() => {
    const keyword = fineContent.trim().toLowerCase();
    if (!keyword) {
      return fineContentSuggestions;
    }
    return fineContentSuggestions.filter((option) => option.toLowerCase().includes(keyword));
  }, [fineContent, fineContentSuggestions]);
  const paymentPurposeSuggestions = useMemo(() => {
    const historicalPurposes =
      paymentPurposeRows
        .map(
          (row) =>
            String(
              (
                row["MỤC ĐÍCH"] ??
                row["MUC DICH"] ??
                row["Mục đích"] ??
                findRowValue(row, ["mucdich"])
              ) || ""
            ).trim()
        )
        .flatMap((value) =>
          String(value ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        ) ?? [];

    return Array.from(new Set(historicalPurposes)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [paymentPurposeRows]);
  const filteredPaymentPurposeSuggestions = useMemo(() => {
    const keyword = paymentPurposeInput.trim().toLowerCase();
    const availableOptions = paymentPurposeSuggestions.filter(
      (option) => !paymentPurposeSelections.some((selected) => selected.toLowerCase() === option.toLowerCase())
    );
    if (!keyword) {
      return availableOptions;
    }
    return availableOptions.filter((option) => option.toLowerCase().includes(keyword));
  }, [paymentPurposeInput, paymentPurposeSelections, paymentPurposeSuggestions]);
  const selectedBranchRooms = quickNav.find((entry) => entry.branch === selectedBranch)?.rooms ?? [];
  const branchOverviewGroups = useMemo(() => {
    const branchLayouts =
      selectedBranch === "D2" || selectedBranch === "D7" ? BRANCH_LAYOUTS[selectedBranch] : [];

    const rooms = branchLayouts.map((layoutRoom) => {
      const roomClients = clients.filter(
        (client) =>
          normalizeBranchLabel(client.branch) === selectedBranch &&
          resolveClientRoom(client) === layoutRoom.room
      );

      return {
        room: layoutRoom.room,
        clients: roomClients,
        floor: layoutRoom.floor,
        bunkCount: layoutRoom.bunkCount,
        startBed: layoutRoom.startBed,
        endBed: layoutRoom.endBed,
        diagram: buildRoomDiagram(layoutRoom, roomClients)
      };
    });

    if (selectedBranch === "D7") {
      const floors = new Map<string, typeof rooms>();
      for (const room of rooms) {
        if (!floors.has(room.floor)) {
          floors.set(room.floor, []);
        }
        floors.get(room.floor)!.push(room);
      }

      return Array.from(floors.entries()).map(([floor, floorRooms]) => ({
        label: floor,
        rooms: floorRooms
      }));
    }

    return [
      {
        label: selectedBranch || t("rooms"),
        rooms
      }
    ];
  }, [clients, selectedBranch]);
  const overviewStats = useMemo(() => {
    const branchCount = quickNav.length;
    const overviewRooms = branchOverviewGroups.flatMap((group) => group.rooms);
    const floors = new Set(overviewRooms.map((room) => room.floor));
    const totalBeds = overviewRooms.reduce((sum, room) => sum + room.clients.length, 0);

    return [
      { label: t("branches"), value: formatNumber(branchCount) },
      { label: selectedBranch === "D7" ? t("floors") : t("rooms"), value: formatNumber(selectedBranch === "D7" ? floors.size : overviewRooms.length) },
      { label: selectedBranch === "D7" ? t("rooms") : t("occupiedBeds"), value: formatNumber(selectedBranch === "D7" ? overviewRooms.length : totalBeds) },
      { label: t("clients"), value: formatNumber(selectedBranch ? totalBeds : clients.length) }
    ];
  }, [branchOverviewGroups, clients.length, quickNav.length, selectedBranch]);

  const duplicateEmailSet = useMemo(() => new Set(duplicateClients.map((d) => d.email.toLowerCase())), [duplicateClients]);
  const selectedClientDuplicate = useMemo(
    () => duplicateClients.find((d) => d.email.toLowerCase() === selectedClient?.email?.toLowerCase()) ?? null,
    [duplicateClients, selectedClient]
  );

  const selectedClientPhone = getClientPhone(selectedClient);
  const selectedClientTelHref = toPhoneHref(selectedClientPhone);
  const selectedClientSmsHref = toSmsHref(selectedClientPhone);



  useEffect(() => {
    // Don't auto-override the branch when the user has explicitly chosen "inactive"
    if (selectedBranch === "inactive") return;

    if (filteredQuickNav.length === 0) {
      if (selectedBranch) {
        setSelectedBranch("");
      }
      if (selectedRoom) {
        setSelectedRoom("");
      }
      return;
    }

    const selectedClientBranch = selectedClient ? normalizeBranchLabel(selectedClient.branch) : "";
    const selectedClientRoom = selectedClient ? resolveClientRoom(selectedClient) : "";
    const preferSelectedClientContext = activeManagerView === "client_list";

    const nextBranch =
      (preferSelectedClientContext &&
        selectedClientBranch &&
        filteredQuickNav.some((entry) => entry.branch === selectedClientBranch) &&
        selectedClientBranch) ||
      (selectedBranch && filteredQuickNav.some((entry) => entry.branch === selectedBranch) && selectedBranch) ||
      filteredQuickNav[0]?.branch ||
      "";

    if (nextBranch !== selectedBranch) {
      setSelectedBranch(nextBranch);
    }

    const roomsForBranch = filteredQuickNav.find((entry) => entry.branch === nextBranch)?.rooms ?? [];
    const nextRoom =
      (preferSelectedClientContext &&
        selectedClientRoom &&
        roomsForBranch.some((entry) => entry.room === selectedClientRoom) &&
        selectedClientRoom) ||
      (selectedRoom && roomsForBranch.some((entry) => entry.room === selectedRoom) && selectedRoom) ||
      roomsForBranch[0]?.room ||
      "";

    if (nextRoom !== selectedRoom) {
      setSelectedRoom(nextRoom);
    }
  }, [activeManagerView, filteredQuickNav, selectedBranch, selectedClient, selectedRoom]);

  function fillClientForm(client: ManagerClientRecord | null) {
    if (!client) {
      setClientForm({});
      setIsEditingClientProfile(false);
      return;
    }
    setClientForm(
      Object.fromEntries(
        Object.entries(client.row).filter(([field]) => !HIDDEN_CLIENT_COLUMNS.has(field))
      )
    );
    setIsEditingClientProfile(false);
  }

  async function loadClients(syncFirst = false) {
    if (!isStaffSession) {
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      if (syncFirst) {
        await Promise.all([
          fetch(`${API_BASE_URL}/clients/sync`, { method: "POST" }),
          fetch(`${API_BASE_URL}/coins/sync`, { method: "POST" }),
          fetch(`${API_BASE_URL}/payments/sync`, { method: "POST" }),
          fetch(`${API_BASE_URL}/fines/sync`, { method: "POST" })
        ]);
      }
      const response = await fetch(`${API_BASE_URL}/staff/clients?actorEmail=${encodeURIComponent(normalizedEmail)}`);
      const data = (await response.json()) as { clients?: ManagerClientRecord[]; error?: string };
      if (!response.ok) {
        setStatus(data.error ?? t("unableToLoadClients"));
        return;
      }
      const nextClients = data.clients ?? [];
      setClients(nextClients);
      // Only update selection state if there was a previously-selected client.
      // Re-find it in the refreshed list to get updated data.
      // If nothing was selected before, leave the panel blank.
      if (selectedMaHd) {
        const nextSelected = nextClients.find((client) => client.maHd === selectedMaHd) ?? null;
        setSelectedMaHd(nextSelected?.maHd ?? "");
        fillClientForm(nextSelected);
      }
      setStatus(syncFirst ? t("clientDataRefreshed") : t("clientListLoaded"));
      // Reload duplicates after client sync
      loadDuplicateClients();
    } catch {
      setStatus(t("unableToLoadClients"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDuplicateClients() {
    try {
      const res = await fetch(`${API_BASE_URL}/staff/clients/duplicates?actorEmail=${encodeURIComponent(normalizedEmail)}`);
      const data = (await res.json()) as { duplicates?: DuplicateEntry[] };
      setDuplicateClients(data.duplicates ?? []);
    } catch {
      setDuplicateClients([]);
    }
  }

  async function markContractInactive(maHd: string) {
    setSettingInactive((prev) => ({ ...prev, [maHd]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/staff/clients/set-inactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, maHd })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to mark contract as inactive");
        return;
      }
      // Reload clients and duplicates
      await loadClients(true);
    } catch {
      alert("Failed to mark contract as inactive");
    } finally {
      setSettingInactive((prev) => ({ ...prev, [maHd]: false }));
    }
  }

  async function loadInactiveClients() {
    if (!isStaffSession || inactiveClientsLoading) return;
    setInactiveClientsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/staff/inactive-clients?actorEmail=${encodeURIComponent(normalizedEmail)}`);
      const data = (await res.json()) as { clients?: ManagerClientRecord[] };
      setInactiveClients(data.clients ?? []);
    } catch {
      setInactiveClients([]);
    } finally {
      setInactiveClientsLoading(false);
    }
  }

  async function loadPaymentPurposeRows() {
    if (!isStaffSession) {
      return;
    }
    try {
      let response = await fetch(`${API_BASE_URL}/payments/cache`);
      let data = (await response.json()) as PaymentCachePayload;
      if (!response.ok || !(data.rows ?? []).length) {
        await fetch(`${API_BASE_URL}/payments/sync`, { method: "POST" });
        response = await fetch(`${API_BASE_URL}/payments/cache`);
        data = (await response.json()) as PaymentCachePayload;
      }
      if (!response.ok) {
        setPaymentPurposeRows([]);
        return;
      }
      setPaymentPurposeRows(data.rows ?? []);
    } catch {
      setPaymentPurposeRows([]);
    }
  }

  async function loadAccountLockOverride(email: string) {
    if (!email.trim()) {
      setAccountLockOverride(null);
      return;
    }
    setAccountLockOverrideLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/account-lock-override?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      const data = (await response.json()) as { override?: AccountLockOverride | null };
      if (!response.ok) {
        setAccountLockOverride(null);
        return;
      }
      setAccountLockOverride(data.override ?? null);
    } catch {
      setAccountLockOverride(null);
    } finally {
      setAccountLockOverrideLoading(false);
    }
  }

  function updateClientStayStatus(client: ManagerClientRecord, value: string, successMessage = "Stay status updated") {
    setLoading(true);
    void postJson(
      `${API_BASE_URL}/staff/client-sheet-update`,
      { actorEmail: normalizedEmail, maHd: client.maHd, values: { "Hiện còn ở": value } },
      successMessage,
      async () => {
        await loadClients(false);
      }
    ).finally(() => setLoading(false));
  }

  async function loadWorkspace(tab: StatsTab, maHd = selectedMaHd) {
    if (!maHd || !isStaffSession) {
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/staff/client-workspace?actorEmail=${encodeURIComponent(normalizedEmail)}&maHd=${encodeURIComponent(maHd)}`
      );
      const data = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? t("unableToLoadWorkspace"));
        return;
      }
      setWorkspace(data);
      setActiveTab(tab);
      setStatus(t("loadedTabFor").replace("{tab}", tab).replace("{name}", data.client.name || data.client.email));
    } catch {
      setStatus(t("unableToLoadWorkspace"));
    } finally {
      setLoading(false);
    }
  }

  async function loadRentPaidStatus(clientEmail: string) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setRentPaidMonth(month);
    setRentPaidStatus(null);
    setInfoRentBreakdown(null);
    setInfoManagerDiscount("0");
    setInfoShortTermSurchargeRate("0");
    setInfoParkingFee("0");
    try {
      const [statusResponse, breakdownResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/manager/rent-paid-status?actorEmail=${encodeURIComponent(normalizedEmail)}&email=${encodeURIComponent(clientEmail)}&month=${month}`),
        fetch(`${API_BASE_URL}/calculate-rent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: clientEmail, targetMonth: month, managerDiscountVnd: 0 })
        })
      ]);
      if (statusResponse.ok) {
        const data = (await statusResponse.json()) as { isPaid: boolean };
        setRentPaidStatus(data.isPaid);
      }
      if (breakdownResponse.ok) {
        const data = normalizeRentBreakdown((await breakdownResponse.json()) as Partial<RentBreakdown>);
        setInfoRentBreakdown(data);
        setInfoManagerDiscount(String(data?.managerDiscountVnd || 0));
        setInfoShortTermSurchargeRate(formatPercentInput(data?.tenureSurchargeRate));
        setInfoParkingFee(String(data?.parkingFeeVnd || 0));
      }
    } catch {
      // ignore
    }
  }

  async function recalcInfoBreakdown(clientEmail: string, discount: string, surchargeRatePercent: string, parkingFee: string) {
    setInfoRentCalculating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/calculate-rent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: clientEmail,
          targetMonth: rentPaidMonth,
          managerDiscountVnd: Number(discount) || 0,
          shortTermSurchargeRate: (Number(surchargeRatePercent) || 0) / 100,
          parkingFeeVnd: Number(parkingFee) || 0
        })
      });
      if (response.ok) {
        const data = normalizeRentBreakdown((await response.json()) as Partial<RentBreakdown>);
        setInfoRentBreakdown(data);
        setInfoShortTermSurchargeRate(formatPercentInput(data?.tenureSurchargeRate));
        setInfoParkingFee(String(data?.parkingFeeVnd || 0));
      }
    } catch {
      // ignore
    } finally {
      setInfoRentCalculating(false);
    }
  }

  async function toggleRentPaidStatus(clientEmail: string, newValue: boolean) {
    setRentPaidLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/manager/rent-paid-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, email: clientEmail, month: rentPaidMonth, isPaid: newValue })
      });
      if (response.ok) {
        const data = (await response.json()) as { isPaid: boolean };
        setRentPaidStatus(data.isPaid);
      }
    } catch {
      // ignore
    } finally {
      setRentPaidLoading(false);
    }
  }

  async function submitRentReceipt(options: {
    client: ManagerClientRecord;
    breakdown: RentBreakdown;
    targetMonth: string;
    managerDiscount: string;
    shortTermSurchargeRate: string;
    parkingFee: string;
    payerName?: string;
    closePaymentPanel?: boolean;
  }) {
    const payerName = (options.payerName ?? "").trim() || options.client.name || options.client.email;

    setLoading(true);
    try {
      const receiptResponse = await fetch(`${API_BASE_URL}/pay-rent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: options.client.email,
          targetMonth: options.targetMonth,
          managerDiscountVnd: Number(options.managerDiscount) || 0,
          shortTermSurchargeRate: (Number(options.shortTermSurchargeRate) || 0) / 100,
          parkingFeeVnd: Number(options.parkingFee) || 0,
          coinUsage: options.breakdown.recommendedCoinUsage,
          payerName,
          receiverName: selfDisplayName || normalizedEmail,
          recipientEmail: normalizedEmail,
          branch: paymentBranch || options.client.branch || "",
          memberTier: paymentMemberTier || options.client.recordedMember || "",
          currentCoins: paymentCurrentCoins || options.client.currentCoins || "",
          discountAmount:
            options.breakdown.professionalDiscountVnd +
            options.breakdown.planDiscountVnd +
            options.breakdown.managerDiscountVnd,
          discountCondition: `Rent payment ${options.targetMonth}`
        })
      });

      const receiptPayload = (await receiptResponse.json().catch(() => null)) as { error?: string } | null;
      if (!receiptResponse.ok) {
        throw new Error(receiptPayload?.error ?? "Payment recording failed");
      }

      const paidStatusResponse = await fetch(`${API_BASE_URL}/manager/rent-paid-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          email: options.client.email,
          month: options.targetMonth,
          isPaid: true
        })
      });

      const paidStatusPayload = (await paidStatusResponse.json().catch(() => null)) as { error?: string; isPaid?: boolean } | null;
      if (!paidStatusResponse.ok) {
        throw new Error(paidStatusPayload?.error ?? "Receipt was created, but the paid status could not be updated.");
      }

      setRentPaidStatus(true);
      setRentSectionCollapsed(true);
      if (options.closePaymentPanel) {
        setActiveAction("");
        setRentBreakdown(null);
      }
      await loadWorkspace("payments", options.client.maHd);
      alert("Payment recorded, receipt sent via Gmail, and monthly rent marked as paid.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadTeam() {
    if (!isStaffSession) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/staff-access?email=${encodeURIComponent(normalizedEmail)}`);
    const data = (await response.json()) as { staff?: StaffEntry[]; error?: string };
    if (response.ok) {
      setStaffEntries(data.staff ?? []);
      const myEntry = (data.staff ?? []).find((s) => s.email.trim().toLowerCase() === normalizedEmail);
      if (myEntry?.name) setSelfDisplayName(myEntry.name);
    } else {
      setStatus(data.error ?? t("unableToLoadTeam"));
    }
  }

  async function loadPermissions(entry: StaffEntry) {
    const res = await fetch(`${API_BASE_URL}/staff-access/permissions?actorEmail=${encodeURIComponent(normalizedEmail)}&targetEmail=${encodeURIComponent(entry.email)}`);
    const data = (await res.json()) as { permissions?: ManagerPermissionsState };
    const perms = data.permissions ?? { branches: [], data: {} };
    setEditingPermissions(perms);
    setPermissionsEntry(entry);
  }

  async function loadPricingConfig() {
    setPricingConfigLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/manager/pricing?actorEmail=${encodeURIComponent(normalizedEmail)}`);
      const data = await res.json() as {
        bedOverrides?: PricingBedOverride[];
        discounts?: PricingDiscount[];
        branchSettings?: BranchPricingSettings[];
        parkingOverrides?: BedParkingFeeOverride[];
      };
      if (res.ok) setPricingData({
        bedOverrides: data.bedOverrides ?? [],
        discounts: data.discounts ?? [],
        branchSettings: data.branchSettings ?? [],
        parkingOverrides: data.parkingOverrides ?? []
      });
    } finally {
      setPricingConfigLoading(false);
    }
  }

  function getBedTierInLayout(branchId: "D2" | "D7", bedNumber: number): "top" | "middle" | "bottom" {
    const room = BRANCH_LAYOUTS[branchId].find((r) => bedNumber >= r.startBed && bedNumber <= r.endBed);
    if (!room) return "top";
    const tierIdx = (bedNumber - room.startBed) % room.bunkCount;
    if (room.bunkCount === 3) return (["top", "middle", "bottom"] as const)[tierIdx];
    return (["top", "bottom"] as const)[tierIdx];
  }

  async function saveBulkTierPrices(branchId: string, floor: string | undefined, room: string | undefined, tier: string, monthlyPrice: number | null) {
    // Collect matching bed numbers
    const allRooms = BRANCH_LAYOUTS[branchId as "D2" | "D7"] ?? [];
    const targetRooms = allRooms.filter((r) => {
      if (room) return r.room === room;
      if (floor) return r.floor === floor;
      return true;
    });
    const bedNumbers: number[] = [];
    for (const r of targetRooms) {
      for (let b = r.startBed; b <= r.endBed; b++) {
        const t = getBedTierInLayout(branchId as "D2" | "D7", b);
        if (tier === "all" || t === tier) bedNumbers.push(b);
      }
    }
    // Save each bed sequentially
    const results = await Promise.all(bedNumbers.map((bedNumber) =>
      fetch(`${API_BASE_URL}/manager/pricing/beds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, branchId, bedNumber, termType: "long_term", monthlyPrice, deposit: monthlyPrice })
      }).then((r) => r.json())
    ));
    // Merge all returned rows into pricingData
    const newRows: PricingBedOverride[] = results.flatMap((d) => d.row ? [d.row as PricingBedOverride] : []);
    if (newRows.length > 0) {
      setPricingData((prev) => {
        if (!prev) return prev;
        const merged = [...prev.bedOverrides.filter((x) => !newRows.some((r) => r.id === x.id)), ...newRows];
        return { ...prev, bedOverrides: merged };
      });
    }
  }

  useEffect(() => {
    if (!isStaffSession) {
      setClients([]);
      setWorkspace(null);
      setStaffEntries([]);
      setPaymentPurposeRows([]);
      return;
    }
    void loadClients(false);
    void loadPaymentPurposeRows();
    if (isStaffSession) {
      void loadTeam();
    }
  }, [isStaffSession, normalizedEmail]);

  useEffect(() => {
    setActiveAction("");
    setFineImage("");
    setFineImageFileName("");
    setPaymentPurpose("");
    setPaymentPurposeInput("");
    setPaymentPurposeSelections([]);
    setPaymentPurposeOpen(false);
    setPaymentDiscountAmount("");
    setPaymentDiscountCondition("");
    const client = clients.find((c) => c.maHd === selectedMaHd) ?? null;
    setPaymentBranch(client ? normalizeBranchLabel(client.branch) : "");
    setPaymentRecipientEmail(normalizedEmail);
    setPaymentMemberTier(client?.recordedMember ?? "");
    setPaymentCurrentCoins(client?.currentCoins ?? "");
  }, [selectedMaHd, clients, normalizedEmail]);

  useEffect(() => {
    if (!selectedClient?.email) {
      setAccountLockOverride(null);
      return;
    }
    void loadAccountLockOverride(selectedClient.email);
  }, [selectedClient?.email]);

  useEffect(() => {
    if (activeAction === "message" && selectedClient?.email) {
      void loadClientChat(selectedClient.email);
    }
  }, [activeAction, selectedClient?.email]);

  useEffect(() => {
    setRentSectionCollapsed(rentPaidStatus === true);
  }, [rentPaidStatus, selectedMaHd]);

  useEffect(() => {
    if (activeAction === "payment" && infoRentBreakdown && !rentBreakdown) {
      setTargetMonthInput(rentPaidMonth || new Date().toISOString().slice(0, 7));
      setManagerDiscountInput(infoManagerDiscount);
      setShortTermSurchargeRateInput(infoShortTermSurchargeRate);
      setParkingFeeInput(infoParkingFee);
    }
  }, [activeAction, infoManagerDiscount, infoParkingFee, infoRentBreakdown, infoShortTermSurchargeRate, rentBreakdown, rentPaidMonth]);

  useEffect(() => {
    if (activeManagerView === "feedbacks") {
      void loadFeedbacks();
    }
    if (activeManagerView === "settings") {
      void loadPricingConfig();
    }
  }, [activeManagerView]);

  useEffect(() => {
    setActiveManagerView(initialView);
  }, [initialView]);

  useEffect(() => {
    setShowAllStatsEntries(false);
  }, [activeTab, selectedMaHd, workspace]);

  useEffect(() => {
    setShowClientDetails(false);
  }, [selectedMaHd]);

  useEffect(() => {
    if (selectedClient?.email) {
      void loadRentPaidStatus(selectedClient.email);
    } else {
      setRentPaidStatus(null);
      setRentPaidMonth("");
      setRentSectionCollapsed(false);
      setInfoRentBreakdown(null);
      setInfoManagerDiscount("0");
      setInfoShortTermSurchargeRate("0");
      setInfoParkingFee("0");
      setManagerDiscountInput("0");
      setShortTermSurchargeRateInput("0");
      setParkingFeeInput("0");
      setRentBreakdown(null);
    }
    if (selectedClient?.maHd) {
      setTerminationStatus("loading");
      fetch(`${API_BASE_URL}/manager/termination-status?actorEmail=${encodeURIComponent(normalizedEmail)}&maHd=${encodeURIComponent(selectedClient.maHd)}`)
        .then((r) => r.json())
        .then((d: { record?: { maHd: string; terminatedAt: string; checkOut: { submittedAt: string } | null } | null }) => setTerminationStatus(d.record ?? null))
        .catch(() => setTerminationStatus(null));
    } else {
      setTerminationStatus(null);
    }
  }, [selectedMaHd]);

  const fetchDevices = useCallback(async () => {
    setControllerLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/manager/controller/devices`);
      if (response.ok) {
        const data = await response.json();
        setAcRooms(data.acRooms || []);
        setLaundryMachines(data.laundry || []);
        setAirfryers(data.airfryers || []);
      }
    } catch (err) {
      console.error("Failed to fetch devices", err);
    } finally {
      setControllerLoading(false);
    }
  }, []);

  const fetchControllerHistory = useCallback(async () => {
    setControllerHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/manager/controller/history?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setControllerHistory(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch controller history", err);
    } finally {
      setControllerHistoryLoading(false);
    }
  }, []);

  const setControllerFeedback = useCallback(
    (key: string, feedback: { tone: "success" | "error"; message: string }) => {
      setControllerActionFeedback((current) => ({ ...current, [key]: feedback }));
      window.setTimeout(() => {
        setControllerActionFeedback((current) => {
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      }, 4000);
    },
    []
  );

  const handleAcControl = async (roomId: string, action: "ON" | "OFF") => {
    const actionKey = `ac:${roomId}`;
    if (!window.confirm(t("manualOverrideWarning").replace("{id}", `${roomId} ${action}`))) {
      return;
    }

    setControllerActionPending((current) => ({ ...current, [actionKey]: action }));
    try {
      const response = await fetch(`${API_BASE_URL}/controller/ac/rooms/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, action })
      });
      if (response.ok) {
        void fetchDevices();
        if (showControllerHistory) {
          void fetchControllerHistory();
        }
        setControllerFeedback(actionKey, {
          tone: "success",
          message: `${roomId} ${action} sent successfully.`
        });
      } else {
        const data = await response.json();
        setControllerFeedback(actionKey, {
          tone: "error",
          message: data.error || t("failedControlAc")
        });
      }
    } catch (err) {
      setControllerFeedback(actionKey, {
        tone: "error",
        message: t("networkErrorAc")
      });
    } finally {
      setControllerActionPending((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleMachineTrigger = async (machineId: string, deviceType: "laundry" | "airfryer") => {
    const actionKey = `${deviceType}:${machineId}`;
    // AntiGravity: Manager manual override warning
    if (!window.confirm(t("manualOverrideWarning").replace("{id}", machineId))) {
      return;
    }
    setControllerActionPending((current) => ({ ...current, [actionKey]: "TRIGGER" }));
    try {
      const endpoint = deviceType === "laundry"
        ? `${API_BASE_URL}/manager/controller/laundry/trigger`
        : `${API_BASE_URL}/manager/controller/airfryer/trigger`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId })
      });
      if (response.ok) {
        setControllerFeedback(actionKey, {
          tone: "success",
          message: t("triggeredSuccess").replace("{id}", machineId)
        });
        if (showControllerHistory) {
          void fetchControllerHistory();
        }
      } else {
        const data = await response.json();
        setControllerFeedback(actionKey, {
          tone: "error",
          message: data.error || t("failedToTrigger").replace("{type}", deviceType)
        });
      }
    } catch (err) {
      setControllerFeedback(actionKey, {
        tone: "error",
        message: t("networkErrorTrigger").replace("{type}", deviceType)
      });
    } finally {
      setControllerActionPending((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  useEffect(() => {
    if (activeManagerView === "controller") {
      void fetchDevices();
    }
  }, [activeManagerView, fetchDevices]);

  useEffect(() => {
    if (activeManagerView === "controller" && showControllerHistory) {
      void fetchControllerHistory();
    }
  }, [activeManagerView, showControllerHistory, fetchControllerHistory]);

  async function postJson(url: string, body: Record<string, unknown>, successMessage: string, after?: () => Promise<void>) {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? t("requestFailed"));
        return;
      }
      if (after) {
        await after();
      }
      setEditingId("");
      setEditValues({});
      setStatus(successMessage);
    } catch {
      setStatus(t("requestFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadClientChat(residentEmail = selectedClient?.email ?? "") {
    if (!residentEmail || !isStaffSession) {
      setClientChatMessages([]);
      return;
    }

    setClientChatLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/staff/support/conversation?actorEmail=${encodeURIComponent(normalizedEmail)}&residentEmail=${encodeURIComponent(residentEmail)}`
      );
      const data = (await response.json()) as { messages?: ClientChatMessage[]; error?: string };
      if (!response.ok) {
        setStatus(data.error ?? t("unableToLoadChat"));
        return;
      }
      setClientChatMessages(data.messages ?? []);
    } catch {
      setStatus(t("unableToLoadChat"));
    } finally {
      setClientChatLoading(false);
    }
  }

  async function loadFeedbacks() {
    setFeedbackLoading(true);
    try {
      const response = await fetch("/api/feedback");
      const data = (await response.json()) as { entries?: FeedbackEntry[]; error?: string };
      if (!response.ok) {
        setStatus(data.error ?? t("unableToLoadFeedbacks"));
        return;
      }
      setFeedbackEntries(data.entries ?? []);
    } catch {
      setStatus(t("unableToLoadFeedbacks"));
    } finally {
      setFeedbackLoading(false);
    }
  }

  const fetchUnreadCounts = useCallback(async () => {
    if (!isStaffSession) return;
    try {
      const response = await fetch(`${API_BASE_URL}/manager/support/unread-counts?operatorEmail=${encodeURIComponent(normalizedEmail)}`);
      if (response.ok) {
        const data = await response.json();
        setUnreadCounts(data.unreadCounts || {});
      }
    } catch (err) {
      console.error("Failed to fetch unread counts", err);
    }
  }, [isStaffSession, normalizedEmail]);

  useEffect(() => {
    void fetchUnreadCounts();
    const interval = setInterval(() => void fetchUnreadCounts(), 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCounts]);

  async function uploadFineImage(file: File) {
    if (!selectedClient || !normalizedEmail) {
      return;
    }

    setFineImageUploading(true);
    setStatus("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : dataUrl;
      const response = await fetch(`${API_BASE_URL}/staff/fines/upload-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          maHd: selectedClient.maHd,
          clientName: selectedClient.name || selectedClient.email,
          fileName: file.name || `fine-${selectedClient.maHd}.jpg`,
          mimeType: file.type || "image/jpeg",
          dataBase64: base64Data
        })
      });
      const data = (await response.json()) as { url?: string; fileName?: string; error?: string };
      if (!response.ok || !data.url) {
        setStatus(data.error ?? t("unableToUploadFineImage"));
        return;
      }

      setFineImage(data.url);
      setFineImageFileName(data.fileName ?? file.name);
      setStatus(t("fineImageUploaded"));
    } catch {
      setStatus(t("unableToUploadFineImage"));
    } finally {
      setFineImageUploading(false);
    }
  }

  function syncPaymentPurposeSelection(nextSelections: string[]) {
    const normalizedSelections = Array.from(
      new Set(nextSelections.map((value) => value.trim()).filter(Boolean))
    );
    setPaymentPurposeSelections(normalizedSelections);
    setPaymentPurpose(normalizedSelections.join(", "));
  }

  function addPaymentPurposeOption(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (paymentPurposeSelections.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
      setPaymentPurposeInput("");
      return;
    }

    syncPaymentPurposeSelection([...paymentPurposeSelections, trimmed]);
    setPaymentPurposeInput("");
    setPaymentPurposeOpen(false);
  }

  if (!isStaffSession) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t("cozoroSide")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("staffLoginRequired")}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{t("managementWorkspace")}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {t("managementWorkspaceDesc")}
              </p>
            </div>
          <button
            type="button"
            onClick={() => void loadClients(true)}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
          >
            {t("refreshData")}
          </button>
        </div>
        {status ? <p className="mt-4 text-sm text-slate-700">{status}</p> : null}
      </section>

      {(activeManagerView === "client_list" || activeManagerView === "overview" || activeManagerView === "short_term") ? (
        <section className="space-y-6">
          {/* Sub-tab Switcher */}
          <div className="flex border-b border-slate-200 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setClientSubTab("list")}
              className={`whitespace-nowrap px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all border-b-2 ${
                clientSubTab === "list"
                  ? "border-sky-500 text-sky-600"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {t("browseList")}
            </button>
            {selectedMaHd && (
              <button
                type="button"
                onClick={() => setClientSubTab("details")}
                className={`whitespace-nowrap px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all border-b-2 ${
                  clientSubTab === "details"
                    ? "border-sky-500 text-sky-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {t("clientDetailsTab")}
              </button>
            )}
          </div>

          {clientSubTab === "list" ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
          {/* Term tabs */}
          <div className="flex gap-1 mb-4">
            <button
              type="button"
              onClick={() => setClientTermTab("long_term")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold border transition-colors ${clientTermTab === "long_term" ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600 hover:border-slate-500"}`}
            >
              Long term
            </button>
            <button
              type="button"
              onClick={() => setClientTermTab("short_term")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold border transition-colors ${clientTermTab === "short_term" ? "bg-violet-600 text-white border-violet-600" : "border-slate-300 text-slate-600 hover:border-slate-500"}`}
            >
              Hostel
            </button>
            <button
              type="button"
              onClick={() => { setClientTermTab("inactive"); void loadInactiveClients(); }}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold border transition-colors ${clientTermTab === "inactive" ? "bg-slate-500 text-white border-slate-500" : "border-slate-300 text-slate-600 hover:border-slate-500"}`}
            >
              Inactive
            </button>
          </div>
          {clientTermTab === "long_term" && (<>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedBranch("D2")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedBranch === "D2" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                }`}
              >
                {t("branchD2")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedBranch("D7")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedBranch === "D7" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                }`}
              >
                {t("branchD7")}
              </button>
              <Link
                href="/support?newGroup=true"
                className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition-all hover:bg-sky-100"
              >
                {t("newGroupMessage")}
              </Link>
            </div>
            {selectedBranch !== "inactive" && (
              <div className="flex rounded-xl bg-slate-100 p-1 shadow-inner">
                <button
                  type="button"
                  onClick={() => setClientListMode("diagram")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                    clientListMode === "diagram" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t("diagram")}
                </button>
                <button
                  type="button"
                  onClick={() => setClientListMode("table")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                    clientListMode === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t("table")}
                </button>
              </div>
            )}
          </div>

          {clientListMode === "diagram" ? (
            <section className="space-y-8">
              {branchOverviewGroups.map((group) => (
                <div key={group.label} className="space-y-4">
                  <div className="text-sm font-bold uppercase tracking-widest text-slate-400">{group.label}</div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {group.rooms.map((room) => {
                      const roomGroupId = `ROOM_${selectedBranch}_${room.room}`;
                      const roomUnread = unreadCounts[roomGroupId] || 0;
                      const pendingClients = room.clients.filter((client) => String(client.activeStay ?? "").trim() === "");
                      return (
                        <div key={room.room} className={`relative rounded-2xl border bg-white p-3 shadow-sm transition-all hover:shadow-md ${roomUnread > 0 ? "border-sky-300 ring-1 ring-sky-300" : "border-slate-200"}`}>
                          {roomUnread > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                              {roomUnread}
                            </span>
                          )}
                          <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                            <span className="text-sm font-bold text-slate-900">{t("roomLabel")} {room.room}</span>
                            <div className="flex items-center gap-2">
                              {pendingClients.length > 0 ? (
                                <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-semibold text-pink-700">
                                  {pendingClients.length} pending
                                </span>
                              ) : null}
                              <span className="text-[10px] font-medium text-slate-500">{room.clients.length} {t("bedsLabel")}</span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {room.diagram.bunks.map((bunk) => (
                              <div key={bunk.bunkNumber} className="flex flex-col gap-1 w-14 p-1 rounded-lg border border-slate-100 bg-slate-50/20">
                                {bunk.levels.map((slot) => {
                                  const client = slot.client;
                                  const isSelected = client?.maHd === selectedMaHd;
                                  const isDuplicate = client ? duplicateEmailSet.has(client.email.toLowerCase()) : false;
                                  return (
                                    <button
                                      key={slot.bedNumber}
                                      type="button"
                                      onClick={() => {
                                        setSelectedMaHd(client?.maHd ?? "");
                                        if (client) {
                                          fillClientForm(client);
                                          setClientSubTab("details");
                                        }
                                      }}
                                      className={`relative flex h-8 items-center justify-center rounded-md border text-[10px] font-bold ${
                                        isSelected
                                          ? "border-sky-500 bg-sky-500 text-white z-10 scale-105"
                                          : isDuplicate
                                            ? "border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-300"
                                            : client && String(client.activeStay ?? "").trim() === ""
                                              ? "border-pink-300 bg-pink-50 text-pink-700"
                                              : client
                                                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                                : "border-dashed border-slate-200 bg-slate-25 text-slate-300"
                                      }`}
                                      title={client ? `${client.name} (${t("bedLabel")} ${slot.bedNumber})${isDuplicate ? " ⚠ Duplicate active contract" : String(client.activeStay ?? "").trim() === "" ? " — new registration, status not set" : ""}` : `${t("bedLabel")} ${slot.bedNumber} (${t("emptyLabel")})`}
                                    >
                                      {isDuplicate && !isSelected && (
                                        <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-400 text-[5px] font-black text-white leading-none">!</span>
                                      )}
                                      {client && (
                                        <span className={`absolute left-0.5 top-0.5 text-[7px] leading-none ${isDuplicate ? "text-amber-600/70" : String(client.activeStay ?? "").trim() === "" ? "text-pink-500/70" : "text-emerald-600/70"}`}>
                                          {slot.bedNumber}
                                        </span>
                                      )}
                                      {client ? getLastName(client.name) : slot.bedNumber}
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                          {pendingClients.length > 0 ? (
                            <div className="mt-3 space-y-2 rounded-xl border border-pink-200 bg-pink-50 p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-pink-700">
                                Pending For Add
                              </div>
                              {pendingClients.map((client) => (
                                <div key={client.maHd} className="rounded-lg border border-pink-100 bg-white p-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedMaHd(client.maHd);
                                      fillClientForm(client);
                                      setClientSubTab("details");
                                    }}
                                    className="w-full text-left"
                                  >
                                    <div className="text-sm font-medium text-slate-900">{client.name}</div>
                                    <div className="text-xs text-slate-500">
                                      {client.email}
                                      {client.bed ? ` • Bed ${client.bed}` : ""}
                                    </div>
                                  </button>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => updateClientStayStatus(client, "1", "Pending resident marked as staying")}
                                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      Set 1
                                    </button>
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => updateClientStayStatus(client, "0", "Pending resident marked as moved out")}
                                      className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
                                    >
                                      Set 0
                                    </button>
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => updateClientStayStatus(client, "-1", "Pending resident marked as removed")}
                                      className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                                    >
                                      Set -1
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : (

            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {[t("tableHeaderName"), t("branch"), t("roomLabel"), t("bedLabel"), t("tableHeaderContract"), t("tableHeaderPhone"), t("coins"), t("tableHeaderStatus")].map((header) => (
                        <th key={header} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredClients
                      .filter(c => !selectedBranch || normalizeBranchLabel(c.branch) === selectedBranch)
                      .map((client) => (
                        <tr
                          key={client.maHd}
                          onClick={() => {
                            setSelectedMaHd(client.maHd);
                            fillClientForm(client);
                            setClientSubTab("details");
                          }}
                          className={`cursor-pointer transition-colors hover:bg-slate-50 ${selectedMaHd === client.maHd ? "bg-sky-50" : ""}`}
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">{client.name}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{client.branch}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{resolveClientRoom(client)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{client.bed}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-mono text-slate-500">{client.maHd}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{getClientPhone(client)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-emerald-600">{client.currentCoins}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs">
                             <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 font-medium">{t("activeStatus")}</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          </>)}
          {clientTermTab === "inactive" && (
            <section className="space-y-5">
              {inactiveClientsLoading ? (
                <p className="text-sm text-slate-500">Loading inactive clients…</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={inactiveSearch}
                    onChange={(e) => setInactiveSearch(e.target.value)}
                    placeholder={t("searchPlaceholder", "Search by name, email, contract code…")}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  {inactiveBranches.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setInactiveBranchFilter("")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${!inactiveBranchFilter ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-600"}`}>
                        All branches
                      </button>
                      {inactiveBranches.map((b) => (
                        <button key={b} type="button" onClick={() => setInactiveBranchFilter(b === inactiveBranchFilter ? "" : b)}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${inactiveBranchFilter === b ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-600"}`}>
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
                  {inactiveYears.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setInactiveYearFilter("")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${!inactiveYearFilter ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-600"}`}>
                        All years
                      </button>
                      {inactiveYears.map((y) => (
                        <button key={y} type="button" onClick={() => setInactiveYearFilter(y === inactiveYearFilter ? "" : y)}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${inactiveYearFilter === y ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-600"}`}>
                          {y}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    {filteredInactiveClients.length} contracts
                    {inactiveBranchFilter || inactiveYearFilter || inactiveSearch ? ` (filtered from ${inactiveClients.length})` : ""}
                  </div>
                  {groupedInactiveClients.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500">
                      {inactiveClients.length === 0 ? "No inactive clients found." : "No clients match the current filters."}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {groupedInactiveClients.map((branchGroup) => (
                        <div key={branchGroup.branch}>
                          {/* Branch header */}
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                            Branch {branchGroup.branch}
                          </div>
                          <div className="space-y-2">
                            {branchGroup.rooms.map((roomGroup) => (
                              <div key={roomGroup.room} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                                {/* Room header */}
                                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                  {roomGroup.room}
                                </div>
                                {/* Beds */}
                                <div className="divide-y divide-slate-100">
                                  {roomGroup.beds.map((bedGroup) => {
                                    const bedKey = `${branchGroup.branch}|${bedGroup.bed}`;
                                    const isBedExpanded = expandedInactiveBed === bedKey;
                                    const totalContracts = bedGroup.people.reduce((s, p) => s + p.contracts.length, 0);
                                    return (
                                      <div key={bedGroup.bed}>
                                        {/* Bed row — click to expand */}
                                        <button
                                          type="button"
                                          onClick={() => setExpandedInactiveBed(isBedExpanded ? null : bedKey)}
                                          className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700 min-w-[3rem] text-center">
                                              Bed {bedGroup.bed}
                                            </span>
                                            <span className="text-sm text-slate-600">
                                              {bedGroup.people.length} {bedGroup.people.length === 1 ? "person" : "people"}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-xs text-slate-400">{totalContracts} contract{totalContracts !== 1 ? "s" : ""}</span>
                                            <span className="text-slate-400 text-sm">{isBedExpanded ? "▲" : "▼"}</span>
                                          </div>
                                        </button>
                                        {/* People in this bed */}
                                        {isBedExpanded && (
                                          <div className="border-t border-slate-100 bg-slate-50/50">
                                            {bedGroup.people.map((person) => {
                                              const personKey = (person.email || (person.contracts[0]?.maHd ?? "")).toLowerCase();
                                              const isPersonExpanded = expandedInactiveEmail === personKey;
                                              return (
                                                <div key={personKey} className="border-b border-slate-100 last:border-0">
                                                  {/* Person row */}
                                                  <button
                                                    type="button"
                                                    onClick={() => setExpandedInactiveEmail(isPersonExpanded ? null : personKey)}
                                                    className="w-full text-left px-5 py-2.5 flex items-center justify-between gap-2 hover:bg-white/70 transition-colors"
                                                  >
                                                    <div>
                                                      <div className="text-sm font-medium text-slate-800">{person.name || person.email}</div>
                                                      <div className="text-xs text-slate-400">{person.email}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                      {person.contracts.length > 1 && (
                                                        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                                          {person.contracts.length} contracts
                                                        </span>
                                                      )}
                                                      <span className="text-slate-400 text-xs">{isPersonExpanded ? "▲" : "▼"}</span>
                                                    </div>
                                                  </button>
                                                  {/* Contracts for this person */}
                                                  {isPersonExpanded && (
                                                    <div className="divide-y divide-slate-100 bg-white">
                                                      {person.contracts.map((c) => {
                                                        const isSelected = c.maHd === selectedMaHd;
                                                        const startDate = String(c.row?.["Ngày bắt đầu hợp đồng"] ?? "");
                                                        const endDate = String(c.row?.["Ngày hết hạn hợp đồng"] ?? "");
                                                        return (
                                                          <button
                                                            key={c.maHd}
                                                            type="button"
                                                            onClick={() => { setSelectedMaHd(c.maHd); fillClientForm(c); setClientSubTab("details"); }}
                                                            className={`w-full text-left px-6 py-2.5 transition-colors hover:bg-sky-50 ${isSelected ? "bg-sky-50 border-l-2 border-sky-400" : ""}`}
                                                          >
                                                            <div className="flex items-center justify-between gap-2">
                                                              <div>
                                                                <div className="text-xs font-mono text-slate-600">{c.maHd}</div>
                                                                {(startDate || endDate) && (
                                                                  <div className="text-xs text-slate-400">{startDate || "?"} → {endDate || "?"}</div>
                                                                )}
                                                              </div>
                                                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold flex-shrink-0 ${c.activeStay === "-1" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                                                                {c.activeStay === "-1" ? "Left" : "Moved out"}
                                                              </span>
                                                            </div>
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {clientTermTab === "short_term" && (() => {
            function stToggle(key: string) {
              setStExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
            }
            async function stLoadConfig() {
              if (stConfig || stConfigLoading) return;
              setStConfigLoading(true);
              try {
                const res = await fetch(`${API_BASE_URL}/manager/short-term/config?actorEmail=${encodeURIComponent(normalizedEmail)}`);
                const data = (await res.json()) as ShortTermConfig;
                setStConfig(data);
                setStEditBedPricing(data.bedPricing ?? {});
              } catch { /* ignore */ } finally { setStConfigLoading(false); }
            }
            async function stLoadGuests() {
              if (stGuests || stGuestsLoading) return;
              setStGuestsLoading(true);
              try {
                const res = await fetch(`${API_BASE_URL}/manager/short-term/guests?actorEmail=${encodeURIComponent(normalizedEmail)}`);
                const data = (await res.json()) as { current: ManagerClientRecord[]; past: ManagerClientRecord[] };
                setStGuests(data);
              } catch { /* ignore */ } finally { setStGuestsLoading(false); }
            }
            async function stLoadPending() {
              if (stPendingBookings || stPendingLoading) return;
              setStPendingLoading(true);
              try {
                const res = await fetch(`${API_BASE_URL}/manager/short-term/pending-bookings?actorEmail=${encodeURIComponent(normalizedEmail)}`);
                const data = (await res.json()) as { bookings: StandaloneBooking[] };
                setStPendingBookings(data.bookings ?? []);
              } catch { setStPendingBookings([]); } finally { setStPendingLoading(false); }
            }
            async function stSaveConfig(patch: Partial<Omit<ShortTermConfig, "updatedAt" | "updatedBy">>) {
              setStConfigSaving(true);
              try {
                const res = await fetch(`${API_BASE_URL}/manager/short-term/config`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ actorEmail: normalizedEmail, ...patch })
                });
                const data = (await res.json()) as ShortTermConfig;
                setStConfig(data);
                setStEditBedPricing(data.bedPricing ?? {});
                setStatus("Short-term config saved.");
              } catch { setStatus("Failed to save config."); } finally { setStConfigSaving(false); }
            }
            function StSection({ id, title, badge, onOpen, children }: { id: string; title: string; badge?: string | number; onOpen?: () => void; children: React.ReactNode }) {
              const open = Boolean(stExpanded[id]);
              return (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { stToggle(id); if (!open && onOpen) onOpen(); }}
                    className="flex w-full items-center justify-between px-5 py-4 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{title}</span>
                      {badge !== undefined && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">{badge}</span>
                      )}
                    </div>
                    <span className="text-slate-400 text-sm">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && <div className="border-t border-slate-100 px-5 py-4">{children}</div>}
                </div>
              );
            }

            return (
              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Hostel Portal</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Manage hostel guests (hostel.cozorohome.com, Booking.com, Airbnb, direct), pricing, and discount rules.</p>
                </div>

                {/* Add hostel guest button */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setStAddDialog({
                      guestName: "", email: "", phone: "", checkIn: "", checkOut: "",
                      branch: "D7", bed: "", totalAmount: "", paymentStatus: "paid",
                      source: "direct", notes: "", saving: false, result: ""
                    })}
                    className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    + Add hostel guest
                  </button>
                </div>

                {/* Pending bookings from hostel site */}
                <StSection id="pending" title="Pending bookings (from hostel site)"
                  badge={stPendingBookings?.length ?? undefined}
                  onOpen={() => { void stLoadPending(); }}>
                  {stPendingLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : !stPendingBookings?.length ? (
                    <p className="text-sm text-slate-500">No pending bookings waiting to be imported.</p>
                  ) : (
                    <div className="space-y-3">
                      {stPendingBookings.map((b) => (
                        <div key={b.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900 text-sm">{b.guestName}</div>
                              <div className="text-xs text-slate-500">{b.email} · {b.phone}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{b.checkIn} → {b.checkOut} · {b.pricing.nights} night{b.pricing.nights !== 1 ? "s" : ""}</div>
                              <div className="text-xs text-slate-400">Total: {b.pricing.total.toLocaleString()} · {b.paymentStatus} · {b.status}{b.source ? ` · ${b.source}` : ""}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setStConfirmDialog({ booking: b, branch: "D2", bed: "1", saving: false, result: "" })}
                              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 whitespace-nowrap"
                            >
                              Confirm &amp; Import
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </StSection>

                {/* Current hostel guests */}
                <StSection id="current" title="Current hostel guests" badge={stGuests?.current.length}
                  onOpen={() => { void stLoadGuests(); }}>
                  {stGuestsLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : !stGuests?.current.length ? (
                    <p className="text-sm text-slate-500">No guests currently checked in.</p>
                  ) : (
                    <div className="space-y-2">
                      {stGuests.current.map((g) => (
                        <div key={g.maHd} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3">
                          <div>
                            <div className="font-medium text-slate-900 text-sm">{g.name}</div>
                            <div className="text-xs text-slate-500">{g.maHd} · Branch {g.branch} · Bed {g.bed}</div>
                            <div className="text-xs text-slate-400">
                              {String(g.row?.["Ngày bắt đầu hợp đồng"] ?? "")} → {String(g.row?.["Ngày hết hạn hợp đồng"] ?? "")}
                            </div>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Active</span>
                        </div>
                      ))}
                    </div>
                  )}
                </StSection>

                {/* Past hostel guests */}
                <StSection id="past" title="Past hostel guests" badge={stGuests?.past.length}
                  onOpen={() => { void stLoadGuests(); }}>
                  {stGuestsLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : !stGuests?.past.length ? (
                    <p className="text-sm text-slate-500">No past short-stay records found.</p>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {stGuests.past.map((g) => (
                        <div key={g.maHd} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3">
                          <div>
                            <div className="font-medium text-slate-900 text-sm">{g.name}</div>
                            <div className="text-xs text-slate-500">{g.maHd} · Branch {g.branch} · Bed {g.bed}</div>
                            <div className="text-xs text-slate-400">
                              {String(g.row?.["Ngày bắt đầu hợp đồng"] ?? "")} → {String(g.row?.["Ngày hết hạn hợp đồng"] ?? "")}
                            </div>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Checked out</span>
                        </div>
                      ))}
                    </div>
                  )}
                </StSection>

                {/* Bed pricing */}
                <StSection id="pricing" title="Bed pricing (nightly rate ₫)" onOpen={() => { void stLoadConfig(); }}>
                  {stConfigLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : (
                    <div className="space-y-4">
                      {/* Branch selector */}
                      <div className="flex gap-2">
                        {(["D2", "D7"] as const).map((br) => (
                          <button key={br} type="button"
                            onClick={() => setStPricingBranch(br)}
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${stPricingBranch === br ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"}`}
                          >{br}</button>
                        ))}
                      </div>

                      {/* Diagram */}
                      {(() => {
                        const rooms = BRANCH_LAYOUTS[stPricingBranch] ?? [];
                        const floorMap = new Map<string, typeof rooms>();
                        for (const room of rooms) {
                          if (!floorMap.has(room.floor)) floorMap.set(room.floor, []);
                          floorMap.get(room.floor)!.push(room);
                        }
                        return (
                          <div className="space-y-5">
                            {[...floorMap.entries()].map(([floor, floorRooms]) => (
                              <div key={floor}>
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{floor}</div>
                                <div className="flex flex-wrap gap-3">
                                  {floorRooms.map((room) => {
                                    const bunks = Array.from({ length: room.bunkCount }, (_, bi) => {
                                      const startBed = room.startBed + bi * 3;
                                      return [startBed, startBed + 1, startBed + 2].filter(b => b <= room.endBed);
                                    });
                                    return (
                                      <div key={room.room} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                                        <div className="text-[10px] font-semibold text-slate-500 mb-2 text-center">Room {room.room}</div>
                                        <div className="flex gap-1.5">
                                          {bunks.map((bunkBeds, bi) => (
                                            <div key={bi} className="flex flex-col gap-1">
                                              {bunkBeds.map((bedNum) => {
                                                const level = ((bedNum - 1) % 3) + 1;
                                                const levelLabel = level === 1 ? "T" : level === 2 ? "M" : "B";
                                                const isTop = level === 1;
                                                const defaultPrice = isTop ? 150000 : 250000;
                                                const currentVal = stEditBedPricing[stPricingBranch]?.[String(bedNum)];
                                                const displayVal = currentVal !== undefined ? currentVal : defaultPrice;
                                                return (
                                                  <div key={bedNum} className={`rounded-lg border p-1.5 w-16 ${isTop ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
                                                    <div className="flex items-center justify-between mb-0.5">
                                                      <span className={`text-[9px] font-bold ${isTop ? "text-sky-600" : "text-slate-400"}`}>{levelLabel}</span>
                                                      <span className="text-[9px] text-slate-500">#{bedNum}</span>
                                                    </div>
                                                    <input
                                                      type="number"
                                                      min={0}
                                                      step={10000}
                                                      value={displayVal}
                                                      onChange={(e) => setStEditBedPricing((prev) => ({
                                                        ...prev,
                                                        [stPricingBranch]: { ...(prev[stPricingBranch] ?? {}), [String(bedNum)]: Number(e.target.value) }
                                                      }))}
                                                      className="w-full rounded border border-slate-200 px-1 py-0.5 text-center text-[10px] focus:border-sky-400 focus:outline-none bg-transparent"
                                                    />
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={stConfigSaving}
                          onClick={() => void stSaveConfig({ bedPricing: stEditBedPricing })}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {stConfigSaving ? "Saving…" : "Save bed prices"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const defaults: Record<string, Record<string, number>> = {};
                            for (const br of ["D2", "D7"] as const) {
                              defaults[br] = {};
                              for (const room of BRANCH_LAYOUTS[br]) {
                                for (let b = room.startBed; b <= room.endBed; b++) {
                                  const level = ((b - 1) % 3) + 1;
                                  defaults[br][String(b)] = level === 1 ? 150000 : 250000;
                                }
                              }
                            }
                            setStEditBedPricing(defaults);
                          }}
                          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Reset to defaults
                        </button>
                      </div>
                    </div>
                  )}
                </StSection>

                {/* Discounts */}
                <StSection id="discounts" title="Discounts" onOpen={() => { void stLoadConfig(); }}>
                  {stConfigLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : stConfig ? (
                    <div className="space-y-4">
                      {(["weekly", "monthly"] as const).map((type) => {
                        const rule = stConfig.discounts[type];
                        return (
                          <div key={type} className="rounded-xl border border-slate-200 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-slate-900 capitalize">{type} discount</span>
                              <button
                                type="button"
                                onClick={() => void stSaveConfig({
                                  discounts: { ...stConfig.discounts, [type]: { ...rule, enabled: !rule.enabled } }
                                })}
                                className={`relative inline-flex h-6 w-10 rounded-full transition-colors ${rule.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
                              >
                                <span className={`inline-block h-4 w-4 m-1 rounded-full bg-white shadow transition-transform ${rule.enabled ? "translate-x-4" : "translate-x-0"}`} />
                              </button>
                            </div>
                            <div className="flex gap-3">
                              <label className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-slate-500">Min nights</span>
                                <input
                                  type="number" min={1} value={rule.minNights}
                                  onChange={(e) => setStConfig({ ...stConfig, discounts: { ...stConfig.discounts, [type]: { ...rule, minNights: Number(e.target.value) } } })}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm w-full focus:outline-none focus:border-sky-400"
                                />
                              </label>
                              <label className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-slate-500">Discount %</span>
                                <input
                                  type="number" min={0} max={100} value={rule.percent}
                                  onChange={(e) => setStConfig({ ...stConfig, discounts: { ...stConfig.discounts, [type]: { ...rule, percent: Number(e.target.value) } } })}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm w-full focus:outline-none focus:border-sky-400"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        type="button" disabled={stConfigSaving}
                        onClick={() => void stSaveConfig({ discounts: stConfig.discounts })}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {stConfigSaving ? "Saving…" : "Save discounts"}
                      </button>
                    </div>
                  ) : null}
                </StSection>

                {/* Minimum stay */}
                <StSection id="minstay" title="Minimum stay requirement" onOpen={() => { void stLoadConfig(); }}>
                  {stConfigLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : stConfig ? (
                    <div className="flex items-center gap-4">
                      <input
                        type="number" min={1}
                        value={stConfig.minimumStay}
                        onChange={(e) => setStConfig({ ...stConfig, minimumStay: Number(e.target.value) })}
                        className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      />
                      <span className="text-sm text-slate-600">nights minimum</span>
                      <button
                        type="button" disabled={stConfigSaving}
                        onClick={() => void stSaveConfig({ minimumStay: stConfig.minimumStay })}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {stConfigSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  ) : null}
                </StSection>

                {stConfig?.updatedAt && stConfig.updatedAt !== new Date(0).toISOString() && (
                  <p className="text-xs text-slate-400 text-right">
                    Last updated {new Date(stConfig.updatedAt).toLocaleString()} by {stConfig.updatedBy}
                  </p>
                )}
              </section>
            );
          })()}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {false ? <section /> : null}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("selectedClient")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedClient ? `${selectedClient.name || selectedClient.email} • ${selectedClient.maHd}` : t("chooseClientPrompt")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setShowClientDetails((current) => !current)}
                  disabled={!selectedClient}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {showClientDetails ? t("hideDetails") : t("showDetails")}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingClientProfile(true)}
                  disabled={loading || !selectedClient || isEditingClientProfile}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("editProfile")}
                </button>
                {selectedClient && (
                  <>
                    <Link
                      href={`/support?tab=room&groupId=ROOM_${normalizeBranchLabel(selectedClient.branch)}_${resolveClientRoom(selectedClient)}`}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
                    >
                      {t("messageRoom")}
                    </Link>
                    <Link
                      href={`/support?tab=branch&groupId=BRANCH_${normalizeBranchLabel(selectedClient.branch)}`}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      {t("messageBranch")}
                    </Link>
                  </>
                )}

                <button
                  type="button"
                  onClick={() =>

                    void postJson(
                      `${API_BASE_URL}/staff/client-sheet-update`,
                      { actorEmail: normalizedEmail, maHd: selectedClient?.maHd ?? "", values: clientForm },
                      t("clientProfileUpdated"),
                      async () => {
                        await loadClients(false);
                      }
                    )
                  }
                  disabled={loading || !selectedClient || !isEditingClientProfile}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {t("submitProfileChanges")}
                </button>
                <button
                  type="button"
                  onClick={() => fillClientForm(selectedClient)}
                  disabled={loading || !selectedClient || !isEditingClientProfile}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("cancelEdit")}
                </button>
              </div>
            </div>

            {selectedClient ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("tableHeaderContract")}</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.maHd || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("branch")}</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.branch || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("roomLabel")} / {t("bedLabel")}</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{resolveClientRoom(selectedClient)} / {selectedClient.bed || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("coins")}</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.currentCoins || "0"} {t("categoryCoinsCurrent")}</div>
                    <div className="mt-1 text-sm text-slate-600">{selectedClient.totalCoins || "0"} {t("categoryCoinsLifetime")}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("emailLabel")}</div>
                    <div className="mt-2 text-sm text-slate-800">{selectedClient.email || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("phone")}</div>
                    <div className="mt-2 text-sm text-slate-800">{selectedClientPhone || "-"}</div>
                  </div>
                </div>

                {(() => {
                  const ps = derivePaymentPlanSummary(selectedClient.row ?? {}, rentPaidStatus);
                  const expiryStr = ps.packageExpiry
                    ? ps.packageExpiry.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                    : null;
                  const nextStr = ps.nextPaymentDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                  return (
                    <div className={`rounded-2xl border p-4 ${ps.isDue ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Plan</div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              ps.planType === "monthly" ? "bg-sky-100 text-sky-800" :
                              ps.planType === "3month" ? "bg-violet-100 text-violet-800" :
                              "bg-emerald-100 text-emerald-800"
                            }`}>{ps.planLabel}</span>
                            {ps.isDue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                Payment due
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          {expiryStr && (
                            <div className="text-xs text-slate-500">
                              Package expires: <span className="font-semibold text-slate-700">{expiryStr}</span>
                            </div>
                          )}
                          <div className={`text-xs ${ps.isDue ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                            {ps.isDue ? "Overdue since" : "Next payment:"}{" "}
                            <span className="font-semibold">{nextStr}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {selectedClientDuplicate && (() => {
                  // Parse dd/mm/yyyy hh:mm:ss → Date for sorting
                  function parseTs(ts: string): number {
                    const m = ts.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
                    if (!m) return 0;
                    return new Date(`${m[3]}-${m[2]!.padStart(2,"0")}-${m[1]!.padStart(2,"0")}T${m[4]!.padStart(2,"0")}:${m[5]}:${m[6]}`).getTime() || 0;
                  }
                  const sortedRows = [...selectedClientDuplicate.rows].sort((a, b) => parseTs(b.submissionTimestamp) - parseTs(a.submissionTimestamp));
                  const latestTs = sortedRows[0]?.submissionTimestamp ?? "";
                  return (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-white">!</span>
                        <div className="text-sm font-semibold text-amber-900">Duplicate Active Contract Detected</div>
                      </div>
                      <p className="text-xs text-amber-800">This client has <strong>{selectedClientDuplicate.rows.length} active rows</strong> in the sheet. The app uses the one with the latest <em>DẤU THỜI GIAN</em> (submission timestamp) automatically. Mark old rows inactive to fix this.</p>
                      <div className="space-y-2">
                        {sortedRows.map((row) => {
                          const isLatest = row.submissionTimestamp === latestTs;
                          return (
                            <div key={row.maHd || row.submissionTimestamp} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${isLatest ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-white"}`}>
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-800">
                                  {row.maHd || <span className="italic text-slate-400">no contract code</span>}
                                  {isLatest && <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-white">USING THIS</span>}
                                </div>
                                {row.submissionTimestamp && <div className="text-slate-400">Submitted: {row.submissionTimestamp}</div>}
                                <div className="text-slate-500">{row.branch} · Bed {row.bed} · {row.contractStart} → {row.contractEnd}</div>
                                <div className="text-slate-500">Status: <span className={row.activeStay === "1" ? "text-emerald-700 font-semibold" : "text-slate-500"}>{row.activeStay || "not set"}</span></div>
                              </div>
                              {!isLatest && row.maHd && (
                                <button
                                  type="button"
                                  disabled={!!settingInactive[row.maHd]}
                                  onClick={() => markContractInactive(row.maHd)}
                                  className="ml-3 flex-shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  {settingInactive[row.maHd] ? "Saving…" : "Mark Inactive (−1)"}
                                </button>
                              )}
                              {!isLatest && !row.maHd && (
                                <span className="ml-3 text-[10px] text-slate-400 italic">No MÃ HD — fix manually in sheet</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {(() => {
                  const stay = String(selectedClient.activeStay ?? "").trim();
                  const isUnset = stay === "";
                  const isStaying = stay === "1";
                  const isMovedOut = stay === "0";
                  const isLeft = stay === "-1";
                  const stayLabel = isUnset
                    ? "Not set — new registration"
                    : isStaying
                      ? "Currently staying"
                      : isMovedOut
                        ? "Moved out (0)"
                        : "Left / removed (−1)";
                  const stayColor = isUnset ? "text-pink-700" : isStaying ? "text-emerald-700" : "text-rose-700";
                  const borderColor = isUnset ? "border-pink-300 bg-pink-50" : "border-slate-200 bg-slate-50";

                  return (
                    <div className={`rounded-2xl border p-4 ${borderColor}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stay Status</div>
                          <div className={`mt-1 text-sm font-medium ${stayColor}`}>{stayLabel}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={loading || isStaying}
                            onClick={() => updateClientStayStatus(selectedClient!, "1")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${isStaying ? "bg-emerald-600 text-white" : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"} disabled:opacity-50`}
                          >
                            Staying (1)
                          </button>
                          <button
                            type="button"
                            disabled={loading || isMovedOut}
                            onClick={() => updateClientStayStatus(selectedClient!, "0")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${isMovedOut ? "bg-slate-500 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"} disabled:opacity-50`}
                          >
                            Moved out (0)
                          </button>
                          <button
                            type="button"
                            disabled={loading || isLeft}
                            onClick={() => updateClientStayStatus(selectedClient!, "-1")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${isLeft ? "bg-rose-600 text-white" : "border border-rose-300 text-rose-700 hover:bg-rose-50"} disabled:opacity-50`}
                          >
                            Left (−1)
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Contract Termination — hidden for inactive clients */}
                {selectedClient && selectedClient.activeStay !== "0" && selectedClient.activeStay !== "-1" && (() => {
                  const isTerminated = terminationStatus && terminationStatus !== "loading";
                  const checkedOut = isTerminated && (terminationStatus as { checkOut: { submittedAt: string } | null }).checkOut;
                  return (
                    <div className={`rounded-2xl border p-4 ${isTerminated ? (checkedOut ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50") : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contract Status</div>
                            <InlineHelp
                              label="How contract status works"
                              title="Contract Status"
                              body={MANAGER_FUNCTION_HELP.contractStatus}
                            />
                          </div>
                          <div className={`mt-1 text-sm font-medium ${isTerminated ? (checkedOut ? "text-emerald-700" : "text-rose-700") : "text-slate-700"}`}>
                            {terminationStatus === "loading"
                              ? "Loading…"
                              : checkedOut
                                ? `Checked out — ${new Date((terminationStatus as { checkOut: { submittedAt: string } }).checkOut.submittedAt).toLocaleDateString()}`
                                : isTerminated
                                  ? "Terminated — check-out pending"
                                  : "Active"}
                          </div>
                          {isTerminated && !checkedOut && (terminationStatus as { terminatedAt: string }).terminatedAt && (
                            <div className="mt-0.5 text-xs text-rose-600">
                              Terminated {new Date((terminationStatus as { terminatedAt: string }).terminatedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        {!isTerminated && terminationStatus !== "loading" && (
                          <button
                            type="button"
                            onClick={() => { setTerminateNote(""); setTerminateDialog(true); }}
                            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Terminate contract
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Terminate contract confirmation dialog */}
                {terminateDialog && selectedClient && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl space-y-4">
                      <h3 className="font-semibold text-slate-900">Terminate contract?</h3>
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 space-y-1">
                        <p className="font-semibold">⚠️ Important — deposit policy</p>
                        <p>The client must find a replacement tenant to continue their contract. If they cannot find one, <strong>the deposit is not guaranteed to be refunded</strong>.</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">Deposit note (shown to client)</label>
                        <textarea
                          value={terminateNote}
                          onChange={(e) => setTerminateNote(e.target.value)}
                          rows={2}
                          placeholder="e.g. No replacement found — deposit at risk"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setTerminateDialog(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700">Cancel</button>
                        <button
                          type="button"
                          disabled={terminateLoading}
                          onClick={async () => {
                            setTerminateLoading(true);
                            try {
                              const res = await fetch(`${API_BASE_URL}/manager/terminate-contract`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  actorEmail: normalizedEmail,
                                  maHd: selectedClient.maHd,
                                  email: selectedClient.email,
                                  name: selectedClient.name,
                                  branch: selectedClient.branch,
                                  bed: selectedClient.bed,
                                  depositNote: terminateNote.trim() || "Client must find a replacement. Deposit refund not guaranteed if no replacement is found."
                                })
                              });
                              const data = (await res.json()) as { ok?: boolean; record?: { maHd: string; terminatedAt: string; checkOut: null }; error?: string };
                              if (!res.ok) throw new Error(data.error ?? "Failed");
                              setTerminationStatus(data.record ?? null);
                              setTerminateDialog(false);
                              setStatus("Contract terminated. Client will see the check-out button on their dashboard.");
                            } catch (err) {
                              setStatus(err instanceof Error ? err.message : "Failed to terminate contract");
                            } finally {
                              setTerminateLoading(false);
                            }
                          }}
                          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {terminateLoading ? "Processing…" : "Confirm termination"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {selectedClient && (() => {
                  const paymentPlan = String(selectedClient.row?.["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
                  const isOnPrepaidPlan = paymentPlan.includes("03 tháng") || paymentPlan.includes("06 tháng");
                  if (isOnPrepaidPlan) return null;
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Rent</div>
                            <InlineHelp
                              label="How monthly rent works"
                              title="Monthly Rent"
                              body={MANAGER_FUNCTION_HELP.monthlyRent}
                            />
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-slate-700">{rentPaidMonth || "This month"}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRentSectionCollapsed((current) => !current)}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white"
                          >
                            {rentSectionCollapsed ? "Expand" : "Collapse"}
                          </button>
                          <span className={`text-xs font-semibold ${rentPaidStatus ? "text-emerald-600" : "text-amber-600"}`}>
                            {rentPaidStatus === null ? "—" : rentPaidStatus ? "Paid" : "Unpaid"}
                          </span>
                          <button
                            type="button"
                            disabled={rentPaidLoading || rentPaidStatus === null}
                            onClick={() => selectedClient && void toggleRentPaidStatus(selectedClient.email, !rentPaidStatus)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${rentPaidStatus ? "bg-emerald-500" : "bg-slate-300"}`}
                          >
                            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${rentPaidStatus ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                        </div>
                      </div>

                      {rentSectionCollapsed ? (
                        <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">
                          {rentPaidStatus ? "Monthly rent details are collapsed because this month is marked paid." : "Monthly rent details are collapsed."}
                        </p>
                      ) : infoRentCalculating ? (
                        <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">Calculating…</p>
                      ) : infoRentBreakdown ? (
                        <div className="space-y-1.5 border-t border-slate-200 pt-3 text-sm">
                          {[
                            { label: "Base rent", value: infoRentBreakdown.baseRent ?? 0, color: "" },
                            ...((infoRentBreakdown.tenureSurchargeVnd ?? 0) > 0 ? [{ label: `Short-term surcharge (+${((infoRentBreakdown.tenureSurchargeRate ?? 0) * 100).toFixed(0)}%)`, value: infoRentBreakdown.tenureSurchargeVnd ?? 0, color: "text-amber-600" }] : []),
                            ...((infoRentBreakdown.monthlyAdjustmentVnd ?? 0) > 0 ? [{ label: "Monthly adjustment surcharge", value: infoRentBreakdown.monthlyAdjustmentVnd ?? 0, color: "text-amber-600" }] : []),
                            ...((infoRentBreakdown.professionalDiscountVnd ?? 0) > 0 ? [{ label: "Monthly adjustment discount", value: -(infoRentBreakdown.professionalDiscountVnd ?? 0), color: "text-emerald-600" }] : []),
                            ...((infoRentBreakdown.planDiscountVnd ?? 0) > 0 ? [{ label: "Plan discount", value: -(infoRentBreakdown.planDiscountVnd ?? 0), color: "text-emerald-600" }] : []),
                            ...((infoRentBreakdown.managerDiscountVnd ?? 0) > 0 ? [{ label: "Manager discount", value: -(infoRentBreakdown.managerDiscountVnd ?? 0), color: "text-emerald-600" }] : []),
                            { label: "Parking", value: infoRentBreakdown.parkingFeeVnd ?? 0, color: "" },
                            { label: `Laundry (${infoRentBreakdown.details?.laundryCount?.cash ?? 0} washes)`, value: infoRentBreakdown.laundryFeeVnd ?? 0, color: "" },
                            { label: `Fines (${infoRentBreakdown.details?.unpaidFinesCount ?? 0} unpaid)`, value: infoRentBreakdown.finesVnd ?? 0, color: "" },
                          ].filter(item => item.value !== 0).map((item) => (
                            <div key={item.label} className={`flex justify-between ${item.color || "text-slate-700"}`}>
                              <span>{item.label}</span>
                              <span className="font-medium">{item.value < 0 ? "−" : ""}{Math.abs(item.value).toLocaleString()} ₫</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between border-t border-slate-200 pt-2 gap-2">
                            <span className="font-bold text-slate-900">Total due</span>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{(infoRentBreakdown.totalBeforeCoinsVnd ?? 0).toLocaleString()} ₫</span>
                              {canCreatePaymentReceipt && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!window.confirm(`Create a rent receipt for ${rentPaidMonth || "this month"}?`)) {
                                      return;
                                    }
                                    if (!selectedClient || !infoRentBreakdown) {
                                      return;
                                    }
                                    void submitRentReceipt({
                                      client: selectedClient,
                                      breakdown: infoRentBreakdown,
                                      targetMonth: rentPaidMonth,
                                      managerDiscount: infoManagerDiscount,
                                      shortTermSurchargeRate: infoShortTermSurchargeRate,
                                      parkingFee: infoParkingFee,
                                      payerName: selectedClient.name
                                    });
                                  }}
                                  disabled={loading || !selectedClient || !infoRentBreakdown}
                                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  Create Receipt
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">No breakdown available</p>
                      )}

                      {!rentSectionCollapsed ? (
                      <div className="grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Manager discount (₫)</label>
                          <input
                            type="number"
                            value={infoManagerDiscount}
                            onChange={(e) => setInfoManagerDiscount(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            min="0"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Short-term surcharge (%)</label>
                          <input
                            type="number"
                            value={infoShortTermSurchargeRate}
                            onChange={(e) => setInfoShortTermSurchargeRate(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            min="0"
                            step="0.01"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Parking fee (₫)</label>
                          <input
                            type="number"
                            value={infoParkingFee}
                            onChange={(e) => setInfoParkingFee(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            min="0"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={infoRentCalculating || !selectedClient}
                          onClick={() => void recalcInfoBreakdown(selectedClient.email, infoManagerDiscount, infoShortTermSurchargeRate, infoParkingFee)}
                          className="self-end rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {infoRentCalculating ? "…" : "Recalc"}
                        </button>
                      </div>
                      ) : null}
                    </div>
                  );
                })()}

                {showClientDetails || isEditingClientProfile ? (
                  <div className="grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                    {Object.keys(clientForm).map((field) => (
                      <label key={field} className="block text-sm font-medium text-slate-700">
                        {field}
                        <input
                          type="text"
                          value={clientForm[field] ?? ""}
                          onChange={(event) => setClientForm((current) => ({ ...current, [field]: event.target.value }))}
                          readOnly={!isEditingClientProfile}
                          className={`mt-1 w-full rounded-lg px-3 py-2 ${
                            isEditingClientProfile
                              ? "border border-slate-300 bg-white"
                              : "border border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{t("clientActions")}</h2>
                  <InlineHelp
                    label="How client actions work"
                    title="Client Actions"
                    body={MANAGER_FUNCTION_HELP.clientActions}
                  />
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {t("chooseActionPrompt")}
                </p>
              </div>
              <div className="text-sm text-slate-600">
                <div>Email: {selectedClient?.email || "-"}</div>
                <div>Phone: {selectedClientPhone || "-"}</div>
              </div>
	            </div>
	              <div className="mt-4 flex flex-wrap gap-3">
                  {(() => {
                    const autoLock = selectedClient ? getAutomaticFeatureLockStatus(selectedClient) : null;
                    const isUnlocked = accountLockOverride?.unlocked === true;
                    const canToggle = !!selectedClient?.email && (sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin");
                    const isUnavailable = !autoLock || (!autoLock.isBlocked && !isUnlocked);
                    const label = accountLockOverrideLoading
                      ? "Loading…"
                      : isUnlocked
                        ? "Feature Lock: Off"
                        : autoLock?.isBlocked
                          ? "Feature Lock: On"
                          : "Feature Lock";

                    return (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedClient?.email || !autoLock || isUnavailable) return;
                            void postJson(
                              `${API_BASE_URL}/manager/account-lock-override`,
                              {
                                actorEmail: normalizedEmail,
                                targetEmail: selectedClient.email,
                                unlocked: !isUnlocked,
                                note: !isUnlocked ? "Manual unlock for overdue rent or expired contract restrictions." : ""
                              },
                              !isUnlocked ? "Account functions unlocked." : "Account returned to automatic lock rules.",
                              async () => {
                                await loadAccountLockOverride(selectedClient.email);
                              }
                            );
                          }}
                          disabled={!canToggle || accountLockOverrideLoading || !selectedClient?.email || isUnavailable}
                          className={`rounded-lg px-4 py-2 text-sm font-medium ${
                            isUnlocked
                              ? "border border-amber-300 text-amber-700"
                              : autoLock?.isBlocked
                                ? "bg-rose-600 text-white"
                                : "border border-slate-300 text-slate-400"
                          } disabled:opacity-60`}
                          title={
                            autoLock?.isBlocked
                              ? isUnlocked
                                ? `Override by ${accountLockOverride?.updatedBy ?? "manager"}`
                                : autoLock.reason
                              : "Laundry booking and controller access follow the normal automatic rules."
                          }
                        >
                          {label}
                        </button>
                        <InlineHelp
                          label="How feature lock works"
                          title="Feature Lock"
                          body={MANAGER_FUNCTION_HELP.featureLock}
                        />
                      </div>
                    );
                  })()}
                  {[
                    ["call", t("callClient")],
                    ["sms", t("textClient")],
                    ["email", t("emailClient")],
                    ["message", t("openChat")],
                    ["fine", t("newFineTicket")],
                  ["coins", t("newCoinsEntry")],
                  ["password", t("changePassword", "Change password")],
                  ...(canCreatePaymentReceipt ? ([["payment", t("newPaymentReceipt")]] as const) : [])
                ].map(([value, label]) => (
                  <button
                  key={value}
                  type="button"
                  onClick={() => setActiveAction((current) => (current === value ? "" : (value as ClientAction)))}
                  disabled={!selectedClient}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    activeAction === value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700"
                  } disabled:opacity-60`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeAction ? (
              <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {activeAction === "call"
                        ? t("callClient")
                        : activeAction === "sms"
                          ? t("textClient")
                          : activeAction === "email"
                            ? t("emailClient")
                            : activeAction === "message"
                              ? t("clientChatTitle")
                              : activeAction === "payment"
                                  ? t("createPaymentReceipt")
                                : activeAction === "fine"
                                  ? t("createFineTicket")
                                  : activeAction === "password"
                                    ? t("changePassword", "Change password")
                                    : t("createCoinsEntry")}
                    </h3>
                    <InlineHelp
                      label="How client actions work"
                      title="Client Actions"
                      body={MANAGER_FUNCTION_HELP.clientActions}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveAction("")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("closeLabel")}
                  </button>
                </div>

                {activeAction === "call" ? (
                  <div className="mt-4 space-y-4">
                    <input
                      type="text"
                      value={selectedClientPhone}
                      readOnly
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                    <a
                      href={selectedClientTelHref || "#"}
                      className={`inline-flex rounded-lg px-4 py-2 text-sm font-medium ${
                        selectedClientTelHref
                          ? "bg-emerald-600 text-white"
                          : "cursor-not-allowed border border-slate-300 text-slate-400"
                      }`}
                      aria-disabled={!selectedClientTelHref}
                      onClick={(event) => {
                        if (!selectedClientTelHref) {
                          event.preventDefault();
                        }
                      }}
                    >
                      {t("startCall")}
                    </a>
                  </div>
                ) : null}

                {activeAction === "sms" ? (
                  <div className="mt-4 space-y-4">
                    <input
                      type="text"
                      value={selectedClientPhone}
                      readOnly
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                    <a
                      href={selectedClientSmsHref || "#"}
                      className={`inline-flex rounded-lg px-4 py-2 text-sm font-medium ${
                        selectedClientSmsHref
                          ? "border border-slate-300 bg-white text-slate-700"
                          : "cursor-not-allowed border border-slate-300 text-slate-400"
                      }`}
                      aria-disabled={!selectedClientSmsHref}
                      onClick={(event) => {
                        if (!selectedClientSmsHref) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Open text
                    </a>
                  </div>
                ) : null}

                {activeAction === "email" ? (
                  <div className="mt-4 space-y-4">
                    <input
                      type="text"
                      value={selectedClient?.email ?? ""}
                      readOnly
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                    <a
                      href={selectedClient?.email ? `mailto:${selectedClient.email}` : "#"}
                      className={`inline-flex rounded-lg px-4 py-2 text-sm font-medium ${
                        selectedClient?.email
                          ? "border border-slate-300 bg-white text-slate-700"
                          : "cursor-not-allowed border border-slate-300 text-slate-400"
                      }`}
                      aria-disabled={!selectedClient?.email}
                      onClick={(event) => {
                        if (!selectedClient?.email) {
                          event.preventDefault();
                        }
                      }}
                    >
                      {t("openEmail")}
                    </a>
                  </div>
                ) : null}

                {activeAction === "message" ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-600">
                        {t("conversationWith").replace("{name}", selectedClient?.name || selectedClient?.email || t("userViewShort"))}
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadClientChat()}
                        disabled={clientChatLoading || !selectedClient}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {t("refreshChat")}
                      </button>
                    </div>
                    <div className="max-h-80 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
                      {clientChatMessages.length ? (
                        clientChatMessages.map((message) => {
                          const isResident = message.senderRole === "RESIDENT";
                          return (
                            <div
                              key={message.id}
                              className={`flex ${isResident ? "justify-start" : "justify-end"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                                  isResident
                                    ? "bg-slate-100 text-slate-900"
                                    : "bg-slate-900 text-white"
                                }`}
                              >
                                <div className={`text-xs font-semibold ${isResident ? "text-slate-500" : "text-slate-200"}`}>
                                  {chatRoleLabel(message.senderRole)} · {message.senderName?.trim() || message.senderEmail}
                                </div>
                                <div className="mt-1 whitespace-pre-wrap">{message.body}</div>
                                <div className={`mt-2 text-xs ${isResident ? "text-slate-500" : "text-slate-300"}`}>
                                  {formatDateTime(message.createdAt)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-slate-500">
                          {clientChatLoading ? t("loadingChat") : t("noChatMessagesStarted")}
                        </div>
                      )}
                    </div>
                    <textarea
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"
                      placeholder={t("replyPlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/staff/support/messages`,
                          { operatorEmail: normalizedEmail, residentEmail: selectedClient?.email ?? "", body: messageDraft.trim() },
                          "Message sent.",
                          async () => {
                            setMessageDraft("");
                            await loadClientChat(selectedClient?.email ?? "");
                          }
                        )
                      }
                      disabled={loading || !selectedClient || !messageDraft.trim()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Send reply
                    </button>
                  </div>
                ) : null}

                {activeAction === "payment" ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex gap-2 rounded-2xl bg-slate-200/50 p-1">
                      <button
                        type="button"
                        onClick={() => setRentPaymentMode("rent")}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                          rentPaymentMode === "rent" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {t("rentCalculation")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRentPaymentMode("simple")}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                          rentPaymentMode === "simple" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {t("simpleReceipt")}
                      </button>
                    </div>

                    {rentPaymentMode === "rent" ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            {t("targetMonth")}
                            <input
                              type="month"
                              value={targetMonthInput}
                              onChange={(e) => setTargetMonthInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            {t("managerDiscountVnd")}
                            <input
                              type="number"
                              value={managerDiscountInput}
                              onChange={(e) => setManagerDiscountInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            Short-term surcharge (%)
                            <input
                              type="number"
                              value={shortTermSurchargeRateInput}
                              onChange={(e) => setShortTermSurchargeRateInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                              min="0"
                              step="0.01"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Parking fee (₫)
                            <input
                              type="number"
                              value={parkingFeeInput}
                              onChange={(e) => setParkingFeeInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                              min="0"
                            />
                          </label>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            setCalculatingRent(true);
                            try {
                              const response = await fetch(`${API_BASE_URL}/calculate-rent`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  email: selectedClient?.email,
                                  targetMonth: targetMonthInput,
                                  managerDiscountVnd: Number(managerDiscountInput),
                                  shortTermSurchargeRate: (Number(shortTermSurchargeRateInput) || 0) / 100,
                                  parkingFeeVnd: Number(parkingFeeInput) || 0
                                })
                              });
                              if (!response.ok) throw new Error(t("requestFailed"));
                              const data = normalizeRentBreakdown((await response.json()) as Partial<RentBreakdown>);
                              setRentBreakdown(data);
                            } catch (err) {
                              alert(err instanceof Error ? err.message : t("requestFailed"));
                            } finally {
                              setCalculatingRent(false);
                            }
                          }}
                          disabled={calculatingRent || !selectedClient}
                          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
                        >
                          {calculatingRent ? t("calculating") : t("calculateRentBreakdown")}
                        </button>

                        {rentBreakdown ? (
                          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-900">{t("breakdownFor").replace("{month}", rentBreakdown.month)}</h4>
                            
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-slate-600">{t("baseRent")}</span>
                                <span className="font-medium">{rentBreakdown.baseRent.toLocaleString()} VND</span>
                              </div>
                              
                              {rentBreakdown.tenureSurchargeVnd > 0 && (
                                <div className="flex justify-between text-amber-600">
                                  <span>{t("tenureSurcharge")} ({rentBreakdown.tenureSurchargeRate * 100}%)</span>
                                  <span>+{rentBreakdown.tenureSurchargeVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.monthlyAdjustmentVnd > 0 && (
                                <div className="flex justify-between text-amber-600">
                                  <span>Monthly adjustment surcharge</span>
                                  <span>+{rentBreakdown.monthlyAdjustmentVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.professionalDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>Monthly adjustment discount</span>
                                  <span>-{rentBreakdown.professionalDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.planDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>{t("planDiscount")}</span>
                                  <span>-{rentBreakdown.planDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.managerDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>{t("managerDiscount")}</span>
                                  <span>-{rentBreakdown.managerDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              <div className="flex justify-between">
                                <span className="text-slate-600">{t("parkingFee")}</span>
                                <span className="font-medium">{rentBreakdown.parkingFeeVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between">
                                <span className="text-slate-600">{t("laundryFeeLabel").replace("{count}", String(rentBreakdown.details?.laundryCount?.cash ?? 0))}</span>
                                <span className="font-medium">{rentBreakdown.laundryFeeVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between">
                                <span className="text-slate-600">{t("unpaidFinesLabel")}</span>
                                <span className="font-medium">{rentBreakdown.finesVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="my-2 border-t border-slate-100 pt-2 font-bold flex justify-between">
                                <span>{t("subtotal")}</span>
                                <span>{rentBreakdown.totalBeforeCoinsVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between text-sky-600">
                                <span>{t("coinUsageLabel").replace("{count}", String(rentBreakdown.recommendedCoinUsage ?? 0))}</span>
                                <span>-{rentBreakdown.recommendedCoinValueVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="my-2 rounded-xl bg-slate-900 p-4 text-white flex justify-between items-center">
                                <span className="text-xs uppercase tracking-wider opacity-70 font-bold">{t("totalDue")}</span>
                                <span className="text-xl font-bold">{rentBreakdown.finalTotalVnd.toLocaleString()} VND</span>
                              </div>
                            </div>

                            <div className="space-y-3 pt-3">
                              <label className="block text-sm font-medium text-slate-700">
                                {t("payerName")}
                                <input
                                  type="text"
                                  value={paymentPayer}
                                  onChange={(e) => setPaymentPayer(e.target.value)}
                                  placeholder={selectedClient?.name || ""}
                                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                              </label>

                              <button
                                type="button"
                                onClick={() => {
                                  if (!selectedClient || !rentBreakdown) {
                                    return;
                                  }
                                  void submitRentReceipt({
                                    client: selectedClient,
                                    breakdown: rentBreakdown,
                                    targetMonth: targetMonthInput,
                                    managerDiscount: managerDiscountInput,
                                    shortTermSurchargeRate: shortTermSurchargeRateInput,
                                    parkingFee: parkingFeeInput,
                                    payerName: paymentPayer || selectedClient.name,
                                    closePaymentPanel: true
                                  });
                                }}
                                disabled={loading || !selectedClient || !rentBreakdown}
                                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-700 shadow-lg shadow-emerald-200"
                              >
                                {loading ? "Processing..." : "Confirm & Send Receipt"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                          BIEN NHAN columns below match the Google Sheet. Some values are filled automatically from the selected client and manager account.
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            Chi nhánh Dorm
                            <input
                              type="text"
                              value={paymentBranch}
                              onChange={(event) => setPaymentBranch(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Dấu thời gian
                            <input
                              type="text"
                              value="Auto when saved"
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            Địa chỉ email
                            <input
                              type="text"
                              value={selectedClient?.email ?? ""}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Số giường
                            <input
                              type="text"
                              value={selectedClient?.bed ?? ""}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            NGƯỜI NHẬN TIỀN
                            <input
                              type="text"
                              value={selfDisplayName || normalizedEmail}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            NGƯỜI ĐÓNG TIỀN
                            <input
                              type="text"
                              value={paymentPayer}
                              onChange={(event) => setPaymentPayer(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                              placeholder={selectedClient?.name || selectedClient?.email || ""}
                            />
                          </label>
                        </div>
                        <label className="block text-sm font-medium text-slate-700">
                          SỐ TIỀN
                          <input type="number" min="1" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                        </label>
                        <div className="block text-sm font-medium text-slate-700">
                          MỤC ĐÍCH
                          <div className="relative mt-2 rounded-2xl border border-slate-300 bg-white p-3">
                            <div className="flex flex-wrap gap-2">
                              {paymentPurposeSelections.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() =>
                                    syncPaymentPurposeSelection(
                                      paymentPurposeSelections.filter((selection) => selection.toLowerCase() !== option.toLowerCase())
                                    )
                                  }
                                  className="rounded-full border border-sky-400 bg-sky-500 px-3 py-1 text-xs font-medium text-white transition-colors"
                                >
                                  {option} ×
                                </button>
                              ))}
                              <input
                                type="text"
                                value={paymentPurposeInput}
                                onFocus={() => {
                                  setPaymentPurposeOpen(true);
                                  if (!paymentPurposeRows.length) {
                                    void loadPaymentPurposeRows();
                                  }
                                }}
                                onChange={(event) => {
                                  setPaymentPurposeInput(event.target.value);
                                  setPaymentPurposeOpen(true);
                                }}
                                onBlur={() => {
                                  window.setTimeout(() => setPaymentPurposeOpen(false), 150);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === ",") {
                                    event.preventDefault();
                                    const exactMatch = filteredPaymentPurposeSuggestions.find(
                                      (option) => option.toLowerCase() === paymentPurposeInput.trim().toLowerCase()
                                    );
                                    addPaymentPurposeOption(exactMatch ?? paymentPurposeInput);
                                  }
                                  if (event.key === "Backspace" && !paymentPurposeInput.trim() && paymentPurposeSelections.length > 0) {
                                    event.preventDefault();
                                    syncPaymentPurposeSelection(paymentPurposeSelections.slice(0, -1));
                                  }
                                }}
                                className="min-w-[14rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
                                placeholder={paymentPurposeSelections.length ? "Search or type new" : "Select existing or type new"}
                              />
                            </div>
                            {paymentPurposeOpen ? (
                              <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                                {paymentPurposeInput.trim() && !paymentPurposeSuggestions.some((option) => option.toLowerCase() === paymentPurposeInput.trim().toLowerCase()) ? (
                                  <button
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => addPaymentPurposeOption(paymentPurposeInput)}
                                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-sky-50"
                                  >
                                    <span>{paymentPurposeInput.trim()}</span>
                                    <span className="text-xs text-sky-600">Add new</span>
                                  </button>
                                ) : null}
                                {filteredPaymentPurposeSuggestions.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => addPaymentPurposeOption(option)}
                                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                  >
                                    <span>{option}</span>
                                    <span className="text-xs text-slate-400">Select</span>
                                  </button>
                                ))}
                                {!filteredPaymentPurposeSuggestions.length && !paymentPurposeInput.trim() ? (
                                  <div className="px-3 py-2 text-sm text-slate-400">No existing values yet</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <label className="block text-sm font-medium text-slate-700">
                          MỤC ĐÍCH - GHI RÕ
                          <textarea value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} rows={2} className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Cozoro Member
                            <input
                              type="text"
                              value={paymentMemberTier}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Số Coins hiện có
                            <input type="text" value={paymentCurrentCoins} onChange={(event) => setPaymentCurrentCoins(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Địa chỉ email người nhận
                            <input
                              type="text"
                              value={paymentRecipientEmail}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Số tiền hưởng ưu đãi
                            <input type="number" min="0" value={paymentDiscountAmount} onChange={(event) => setPaymentDiscountAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="0" />
                          </label>
                        </div>
                        <label className="block text-sm font-medium text-slate-700">
                          Điều kiện hưởng ưu đãi
                          <input type="text" value={paymentDiscountCondition} onChange={(event) => setPaymentDiscountCondition(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="VD: Member Gold" />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const effectivePurposes = paymentPurposeSelections.length > 0
                              ? paymentPurposeSelections
                              : paymentPurposeInput.trim()
                                ? [paymentPurposeInput.trim()]
                                : [];
                            if (!effectivePurposes.length) return;
                            void postJson(
                              `${API_BASE_URL}/manager/payments/create`,
                              {
                                actorEmail: normalizedEmail,
                                maHd: selectedClient?.maHd ?? "",
                                amount: Number(paymentAmount),
                                purpose: effectivePurposes.join(", "),
                                details: paymentDetails,
                                payer: paymentPayer,
                                branch: paymentBranch,
                                recipientEmail: paymentRecipientEmail,
                                memberTier: paymentMemberTier,
                                currentCoins: paymentCurrentCoins,
                                discountAmount: paymentDiscountAmount ? Number(paymentDiscountAmount) : undefined,
                                discountCondition: paymentDiscountCondition
                              },
                              t("paymentReceiptCreated"),
                              async () => {
                                if (selectedClient) await loadWorkspace("payments", selectedClient.maHd);
                                await loadPaymentPurposeRows();
                                setPaymentPurpose("");
                                setPaymentPurposeInput("");
                                syncPaymentPurposeSelection([]);
                                setPaymentPurposeOpen(false);
                              }
                            );
                          }}
                          disabled={loading || !selectedClient || !canCreatePaymentReceipt || !Number(paymentAmount) || (!paymentPurposeSelections.length && !paymentPurposeInput.trim())}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {t("createPaymentReceipt")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {activeAction === "fine" ? (
                  <div className="mt-4 space-y-3">
                    <label className="block text-sm font-medium text-slate-700">
                      {fineLabels.dueDate}
                      <input type="date" value={fineDueDate} onChange={(event) => setFineDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      {fineLabels.location}
                      <input
                        type="text"
                        list="fine-location-options"
                        value={fineLocation}
                        onChange={(event) => setFineLocation(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        placeholder={fineUiText.suggestionPlaceholder}
                      />
                      <datalist id="fine-location-options">
                        {fineLocationSuggestions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                    {filteredFineLocationSuggestions.length ? (
                      <div className="flex flex-wrap gap-2">
                        {filteredFineLocationSuggestions.slice(0, 8).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setFineLocation(option)}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <label className="block text-sm font-medium text-slate-700">
                      {fineLabels.content}
                      <input
                        type="text"
                        list="fine-content-options"
                        value={fineContent}
                        onChange={(event) => setFineContent(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        placeholder={fineUiText.suggestionPlaceholder}
                      />
                      <datalist id="fine-content-options">
                        {fineContentSuggestions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                    {filteredFineContentSuggestions.length ? (
                      <div className="flex flex-wrap gap-2">
                        {filteredFineContentSuggestions.slice(0, 8).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setFineContent(option)}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <label className="block text-sm font-medium text-slate-700">
                      {fineLabels.description}
                      <textarea value={fineDescription} onChange={(event) => setFineDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                    </label>
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{fineLabels.image}</p>
                        <p className="mt-1 text-xs text-slate-500">{fineUiText.uploadHint}</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={fineImageUploading || loading || !selectedClient}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadFineImage(file);
                          }
                          event.currentTarget.value = "";
                        }}
                        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                      />
                      {fineImageUploading ? <p className="text-sm text-slate-600">{fineUiText.uploading}</p> : null}
                      {fineImage ? (
                        <div className="space-y-2 rounded-2xl border border-emerald-200 bg-white p-3">
                          <p className="text-sm text-emerald-700">{fineUiText.uploaded}</p>
                          {fineImageFileName ? <p className="text-xs text-slate-500">{fineImageFileName}</p> : null}
                          <a href={fineImage} target="_blank" rel="noreferrer" className="text-sm font-medium text-sky-700 underline">
                            {fineImage}
                          </a>
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setFineImage("");
                                setFineImageFileName("");
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            >
                              {fineUiText.removeImage}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <label className="block text-sm font-medium text-slate-700">
                      {fineLabels.amount}
                      <input type="number" min="1" value={fineAmount} onChange={(event) => setFineAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/manager/fines`,
                          { maHd: selectedClient?.maHd ?? "", amount: Number(fineAmount), content: fineContent, description: fineDescription, location: fineLocation, dueDate: fineDueDate || undefined, image: fineImage, operator: normalizedEmail },
                          t("fineTicketCreated"),
                          async () => {
                            if (selectedClient) await loadWorkspace("fines", selectedClient.maHd);
                            setFineContent("");
                            setFineDescription("");
                            setFineLocation("");
                            setFineDueDate("");
                            setFineImage("");
                            setFineImageFileName("");
                          }
                        )
                      }
                      disabled={loading || fineImageUploading || !selectedClient || !fineContent.trim()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {fineLabels.submit}
                    </button>
                  </div>
                ) : null}

                {activeAction === "coins" ? (
                  <div className="mt-4 space-y-3">
                    <select value={coinEntryMode} onChange={(event) => setCoinEntryMode(event.target.value as CoinEntryMode)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                      <option value="add">{t("addingCoins")}</option>
                      <option value="use">{t("usingCoins")}</option>
                    </select>
                    <label className="block text-sm font-medium text-slate-700">
                      {t("searchCreateEvent")}
                      <input
                        type="text"
                        list="coin-event-options"
                        value={coinReason}
                        onChange={(event) => setCoinReason(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        placeholder={t("searchEventsPlaceholder")}
                      />
                    </label>
                    <datalist id="coin-event-options">
                      {coinEventSuggestions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("previousEntriesHeader")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {filteredCoinEventSuggestions.length ? (
                          filteredCoinEventSuggestions.slice(0, 16).map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setCoinReason(option)}
                              className={`rounded-full px-3 py-1 text-xs ${
                                coinReason === option
                                  ? "bg-slate-900 text-white"
                                  : "border border-slate-300 bg-white text-slate-700"
                              }`}
                            >
                              {option}
                            </button>
                          ))
                        ) : (
                          <div className="text-sm text-slate-500">
                            {t("noMatchFoundCreate")}
                          </div>
                        )}
                      </div>
                    </div>
                    <input type="number" min="1" value={coinAmount} onChange={(event) => setCoinAmount(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder={t("coinsAmountPlaceholder")} />
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/manager/coins/adjust`,
                          { maHd: selectedClient?.maHd ?? "", delta: Math.abs(Number(coinAmount)) * (coinEntryMode === "use" ? -1 : 1), reason: coinReason, operator: normalizedEmail },
                          t("coinsEntryCreated"),
                          async () => {
                            await loadClients(true);
                            if (selectedClient) await loadWorkspace("coins", selectedClient.maHd);
                          }
                        )
                      }
                      disabled={loading || !selectedClient || !Number(coinAmount) || !coinReason.trim()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                    {t("createCoinsEntry")}
                  </button>
                </div>
              ) : null}

              {activeAction === "password" ? (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">
                      {t("newPassword", "New password")}
                    </label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="text"
                        value={clientNewPassword}
                        onChange={(event) => setClientNewPassword(event.target.value)}
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        placeholder={t("mustBe4Chars", "Must be at least 4 characters")}
                      />
                      {selectedClientPhone && (
                        <button
                          type="button"
                          onClick={() => setClientNewPassword(selectedClientPhone.replace(/\D/g, ""))}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          title="Reset to phone number (default)"
                        >
                          Use phone
                        </button>
                      )}
                    </div>
                    {selectedClientPhone && (
                      <p className="mt-1 text-xs text-slate-400">Default: {selectedClientPhone.replace(/\D/g, "")}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setClientPasswordLoading(true);
                      void postJson(
                        `${API_BASE_URL}/auth/admin-set-password`,
                        { actorEmail: normalizedEmail, targetEmail: selectedClient?.email ?? "", newPassword: clientNewPassword },
                        t("passwordUpdated", "Password updated successfully"),
                        async () => {
                          setClientNewPassword("");
                          setActiveAction("");
                          setClientPasswordLoading(false);
                        }
                      ).catch(() => setClientPasswordLoading(false));
                    }}
                    disabled={loading || clientPasswordLoading || !selectedClient || clientNewPassword.length < 4}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-emerald-200 shadow-md hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {clientPasswordLoading ? "Saving..." : t("changePassword", "Change password")}
                  </button>
                </div>
              ) : null}

              {activeAction === "remove" ? (
                <div className="mt-4 space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-rose-100 p-1 text-rose-600">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-4 w-4">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-rose-900">{t("removeResident")}</p>
                      <p className="text-xs font-medium text-rose-700 leading-relaxed">
                        {t("confirmRemoveResident")}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLoading(true);
                        void postJson(
                          `${API_BASE_URL}/staff/client-sheet-update`,
                          {
                            actorEmail: normalizedEmail,
                            maHd: selectedClient?.maHd ?? "",
                            values: { "Hiện còn ở": "-1" }
                          },
                          t("residentRemoved"),
                          async () => {
                            setActiveAction("");
                            await loadClients(true);
                            setSelectedMaHd("");
                          }
                        ).finally(() => setLoading(false));
                      }}
                      disabled={loading || !selectedClient}
                      className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white shadow-md shadow-rose-200 hover:bg-rose-700 disabled:opacity-60"
                    >
                      {loading ? "Removing..." : t("removeLabel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAction("")}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("clientStatistics")}</h2>
                <p className="mt-1 text-sm text-slate-600">{t("clientStatsDesc")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["laundry", "coins", "payments", "fines"] as StatsTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => void loadWorkspace(tab)}
                    disabled={loading || !selectedClient}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      activeTab === tab && workspace ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                    } disabled:opacity-60`}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {!workspace ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                {t("statsSelectPrompt")}
              </div>
            ) : null}

            {workspace ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {summaryItems.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</div>
                      <div
                        className={`mt-2 text-lg font-semibold ${
                          item.tone === "positive"
                            ? "text-emerald-600"
                            : item.tone === "warning"
                              ? "text-amber-600"
                              : "text-slate-900"
                        }`}
                      >
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm text-slate-500">
                    {activeTab === "laundry"
                      ? `${workspace.stats.laundry.length} laundry entries`
                      : activeTab === "coins"
                        ? `${workspace.stats.coins.length} coin entries`
                        : activeTab === "payments"
                          ? `${workspace.stats.payments.length} payment entries`
                          : `${workspace.stats.fines.length} fine entries`}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllStatsEntries((current) => !current)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    {showAllStatsEntries ? t("hideDetails") : t("showDetails")}
                  </button>
                </div>
              </div>
            ) : null}

            {workspace && showAllStatsEntries && activeTab === "laundry" ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="max-h-[32rem] overflow-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">{language === "vi" ? "Tên đặt lịch" : "Name"}</th>
                        <th className="px-4 py-3 font-medium">{language === "vi" ? "Bắt đầu" : "Start"}</th>
                        <th className="px-4 py-3 font-medium">{language === "vi" ? "Kết thúc" : "End"}</th>
                        <th className="px-4 py-3 font-medium">{language === "vi" ? "Máy" : "Machine"}</th>
                        <th className="px-4 py-3 font-medium">{t("clientActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {workspace.stats.laundry.map((entry) => {
                        const key = makeKey([entry.calendarId, entry.id]);
                        return (
                          <tr key={key} className="align-middle">
                            <td className="px-4 py-3 text-slate-900">{entry.summary}</td>
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDateTime(entry.start)}</td>
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDateTime(entry.end)}</td>
                            <td className="px-4 py-3 text-slate-700">{entry.calendarSummary || entry.location || "-"}</td>
                            <td className="px-4 py-3">
                              {confirmDeleteId === `laundry:${key}` ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-red-600 font-medium">Remove?</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteId("");
                                      void postJson(
                                        `${API_BASE_URL}/staff/laundry/delete`,
                                        { actorEmail: normalizedEmail, calendarId: entry.calendarId, eventId: entry.id },
                                        "Laundry entry removed.",
                                        async () => { if (selectedClient) await loadWorkspace("laundry", selectedClient.maHd); }
                                      );
                                    }}
                                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
                                  >
                                    Yes
                                  </button>
                                  <button type="button" onClick={() => setConfirmDeleteId("")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700">No</button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => { setEditingId(`laundry:${key}`); setEditValues({ summary: entry.summary, description: entry.description, location: entry.location, start: toDateTimeLocalValue(entry.start), end: toDateTimeLocalValue(entry.end) }); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">{t("editProfile")}</button>
                                  <button type="button" onClick={() => setConfirmDeleteId(`laundry:${key}`)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Remove</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {workspace.stats.laundry.map((entry) => {
                  const key = makeKey([entry.calendarId, entry.id]);
                  const isEditing = editingId === `laundry:${key}`;
                  return isEditing ? (
                    <div key={`edit-${key}`} className="mt-4 rounded-2xl border border-slate-200 p-4">
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-slate-700">{language === "vi" ? "Tên đặt lịch" : "Name"}
                          <input type="text" value={editValues.summary ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, summary: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">{language === "vi" ? "Bắt đầu" : "Start"}
                          <input type="datetime-local" value={editValues.start ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, start: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">{language === "vi" ? "Kết thúc" : "End"}
                          <input type="datetime-local" value={editValues.end ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, end: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                        </label>
                        <div className="flex gap-3">
                          <button type="button" onClick={() => void postJson(`${API_BASE_URL}/staff/laundry/update`, { actorEmail: normalizedEmail, calendarId: entry.calendarId, eventId: entry.id, summary: editValues.summary ?? "", description: editValues.description ?? "", location: editValues.location ?? "", start: new Date(editValues.start ?? "").toISOString(), end: new Date(editValues.end ?? "").toISOString() }, "Laundry entry updated.", async () => { if (selectedClient) await loadWorkspace("laundry", selectedClient.maHd); })} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{t("saveLabel")}</button>
                          <button type="button" onClick={() => setEditingId("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">{t("cancelEdit")}</button>
                        </div>
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            ) : null}

            {workspace && showAllStatsEntries && activeTab !== "laundry" ? (
              <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-600">
                  {t("compactPanelDesc")}
                </div>
                <div className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        {activeTab === "payments" ? (
                          PAYMENT_COMPACT_COLUMNS.map((column) => (
                            <th key={column} className="px-4 py-3 font-medium whitespace-nowrap">{column}</th>
                          ))
                        ) : (
                          <>
                            <th className="px-4 py-3 font-medium">{t("whenLabel")}</th>
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Nội dung vi phạm" : "Violation") : `${t("detailLabel")} 1`}</th>
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Người lập phiếu" : "Created by") : `${t("detailLabel")} 2`}</th>
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Chi phí" : "Amount") : `${t("detailLabel")} 3`}</th>
                          </>
                        )}
                        <th className="px-4 py-3 font-medium">{t("clientActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {(activeTab === "coins" ? workspace.stats.coins : activeTab === "payments" ? workspace.stats.payments : workspace.stats.fines).map((entry) => {
                        const key = makeKey(Object.values(entry.row).slice(0, 4));
                        const preview = Object.entries(entry.row).filter(([, value]) => String(value ?? "").trim()).slice(0, 4);
                        const fineContent = activeTab === "fines" ? findRowValue(entry.row, ["noidungvipham"]) : null;
                        const fineCreator = activeTab === "fines" ? findRowValue(entry.row, ["nguoilapphieu"]) : null;
                        const fineAmount = activeTab === "fines" ? findRowValue(entry.row, ["chiphi"]) : null;
                        return (
                          <tr key={`table:${key}`} className="align-top">
                            {activeTab === "payments" ? (
                              PAYMENT_COMPACT_COLUMNS.map((column) => {
                                const value = getPaymentRowValue(entry.row, column);
                                const renderedValue = column === "SỐ TIỀN" && value
                                  ? `${parseLooseNumber(value).toLocaleString()} ₫`
                                  : value || "-";
                                return (
                                  <td key={`${key}:${column}`} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                                    {renderedValue}
                                  </td>
                                );
                              })
                            ) : (
                              <>
                                <td className="px-4 py-3 text-slate-700">{formatDateTime(entry.parsedTimestamp)}</td>
                                <td className="px-4 py-3 text-slate-700">{activeTab === "fines" ? (fineContent || "-") : preview[1] ? `${preview[1][0]}: ${preview[1][1]}` : "-"}</td>
                                <td className="px-4 py-3 text-slate-700">{activeTab === "fines" ? (fineCreator || "-") : preview[2] ? `${preview[2][0]}: ${preview[2][1]}` : "-"}</td>
                                <td className="px-4 py-3 text-slate-700">{activeTab === "fines" ? (fineAmount ? `${Number(fineAmount).toLocaleString()} ₫` : "-") : preview[3] ? `${preview[3][0]}: ${preview[3][1]}` : "-"}</td>
                              </>
                            )}
                            <td className="px-4 py-3">
                              {confirmDeleteId === `${activeTab}:${key}` ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-red-600 font-medium">Remove?</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteId("");
                                      void postJson(
                                        `${API_BASE_URL}${activeTab === "coins" ? "/staff/coins/delete" : activeTab === "payments" ? "/staff/payments/delete" : "/staff/fines/delete"}`,
                                        activeTab === "coins"
                                          ? { actorEmail: normalizedEmail, email: selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", transactionCode: entry.row["Mã giao dịch"] ?? "" }
                                          : activeTab === "payments"
                                            ? { actorEmail: normalizedEmail, email: selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", amount: entry.row["SỐ TIỀN"] ?? "", purpose: entry.row["MỤC ĐÍCH"] ?? "" }
                                            : { actorEmail: normalizedEmail, email: entry.row.EMAIL ?? selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", content: entry.row["NỘI DUNG VI PHẠM"] ?? "" },
                                        `${activeTab[0].toUpperCase() + activeTab.slice(1)} entry removed.`,
                                        async () => { if (selectedClient) await loadWorkspace(activeTab, selectedClient.maHd); }
                                      );
                                    }}
                                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
                                  >
                                    Yes
                                  </button>
                                  <button type="button" onClick={() => setConfirmDeleteId("")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700">No</button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => { setEditingId(`${activeTab}:${key}`); setEditValues(entry.row); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Edit</button>
                                  <button type="button" onClick={() => setConfirmDeleteId(`${activeTab}:${key}`)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Remove</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
                {(activeTab === "coins" ? workspace.stats.coins : activeTab === "payments" ? workspace.stats.payments : workspace.stats.fines).map((entry) => {
                  const key = makeKey(Object.values(entry.row).slice(0, 4));
                  const isEditing = editingId === `${activeTab}:${key}`;
                  return (
                    <div key={key} className={isEditing ? "rounded-2xl border border-slate-200 p-4" : "hidden"}>
                      {isEditing ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {Object.keys(editValues).map((field) => (
                            <label key={field} className="block text-sm font-medium text-slate-700">
                              {field}
                              <input type="text" value={editValues[field] ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                            </label>
                          ))}
                          <div className="md:col-span-2 flex gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                void postJson(
                                  `${API_BASE_URL}${activeTab === "coins" ? "/staff/coins/update" : activeTab === "payments" ? "/staff/payments/update" : "/staff/fines/update"}`,
                                  activeTab === "coins"
                                    ? { actorEmail: normalizedEmail, email: selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", transactionCode: entry.row["Mã giao dịch"] ?? "", values: editValues }
                                    : activeTab === "payments"
                                      ? { actorEmail: normalizedEmail, email: selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", amount: entry.row["SỐ TIỀN"] ?? "", purpose: entry.row["MỤC ĐÍCH"] ?? "", values: editValues }
                                      : { actorEmail: normalizedEmail, email: entry.row.EMAIL ?? selectedClient?.email ?? "", timestamp: entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "", content: entry.row["NỘI DUNG VI PHẠM"] ?? "", values: editValues },
                                  `${activeTab[0].toUpperCase() + activeTab.slice(1)} entry updated.`,
                                  async () => {
                                    if (selectedClient) await loadWorkspace(activeTab, selectedClient.maHd);
                                  }
                                )
                              }
                              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                            >
                              Save
                            </button>
                            <button type="button" onClick={() => setEditingId("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="text-sm text-slate-700">
                            {Object.entries(entry.row).filter(([, value]) => String(value ?? "").trim()).slice(0, 6).map(([label, value]) => (
                              <div key={label}>
                                <span className="font-medium text-slate-900">{label}:</span> {value}
                              </div>
                            ))}
                            {activeTab === "fines" && (() => {
                              const creator = findRowValue(entry.row, ["nguoilapphieu"]);
                              return creator ? (
                                <div>
                                  <span className="font-medium text-slate-900">{language === "vi" ? "Người lập phiếu" : "Created by"}:</span> {creator}
                                </div>
                              ) : null;
                            })()}
                          </div>
                          <button type="button" onClick={() => { setEditingId(`${activeTab}:${key}`); setEditValues(entry.row); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Edit</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

        </div>
      )}
    </section>
      ) : null}

      {activeManagerView === "settings" ? (
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Pricing</h2>
                <p className="mt-1 text-sm text-slate-500">Manage bed prices and discount rules for long-term residents and short-term guests.</p>
              </div>
              <button type="button" onClick={() => void loadPricingConfig()} disabled={pricingConfigLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50">
                {pricingConfigLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(["long_term", "short_term", "staff"] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setPricingSettingsTab(tab)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${pricingSettingsTab === tab ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                  {tab === "long_term" ? "Long-term" : tab === "short_term" ? "Short-term" : "Staff Accounts"}
                </button>
              ))}
            </div>
          </div>

          {/* ── Long-term tab: bed price diagram + discounts ── */}
          {(pricingSettingsTab === "long_term") ? (
            <section className="space-y-5">
              {!canManageOwnersEmployees ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-slate-500">Pricing editing is restricted to owners and app admins.</p>
                </div>
              ) : (
                <>
                  {/* ── Branch pricing settings (cleaning opt-out fee, parking fee) ── */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Branch Fee Settings</h3>
                      <p className="mt-1 text-sm text-slate-500">Set the cleaning opt-out fee (monthly surcharge for residents who pay instead of doing cleaning duty) and the default parking fee per branch. Per-bed parking overrides can be set in the bed diagram below.</p>
                    </div>
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(["D2", "D7"] as const).map((branchId) => {
                          const settings = (pricingData?.branchSettings ?? []).find((s) => s.branchId === branchId) ?? { branchId, cleaningOptOutFeeVnd: 100000, parkingFeeVnd: 0, updatedBy: "", updatedAt: "" };
                          const isEditing = branchSettingsEdit?.branchId === branchId;
                          return (
                            <div key={branchId} className={`rounded-2xl border p-4 space-y-3 ${isEditing ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-800">{branchId}</p>
                                {!isEditing && (
                                  <button type="button" onClick={() => setBranchSettingsEdit({ branchId, cleaningOptOutFeeVnd: String(settings.cleaningOptOutFeeVnd), parkingFeeVnd: String(settings.parkingFeeVnd), saving: false, result: "" })}
                                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white">Edit</button>
                                )}
                              </div>
                              {isEditing ? (
                                <div className="space-y-3">
                                  <label className="space-y-1 block">
                                    <span className="text-xs font-medium text-slate-700">Cleaning opt-out fee (VND/month)</span>
                                    <input type="number" min={0} value={branchSettingsEdit!.cleaningOptOutFeeVnd}
                                      onChange={(e) => setBranchSettingsEdit({ ...branchSettingsEdit!, cleaningOptOutFeeVnd: e.target.value })}
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                                  </label>
                                  <label className="space-y-1 block">
                                    <span className="text-xs font-medium text-slate-700">Default parking fee (VND/month)</span>
                                    <input type="number" min={0} value={branchSettingsEdit!.parkingFeeVnd}
                                      onChange={(e) => setBranchSettingsEdit({ ...branchSettingsEdit!, parkingFeeVnd: e.target.value })}
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                                  </label>
                                  {branchSettingsEdit!.result ? <p className={`text-sm font-medium ${branchSettingsEdit!.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{branchSettingsEdit!.result}</p> : null}
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setBranchSettingsEdit(null)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Cancel</button>
                                    <button type="button" disabled={branchSettingsEdit!.saving} onClick={async () => {
                                      setBranchSettingsEdit({ ...branchSettingsEdit!, saving: true, result: "" });
                                      try {
                                        const res = await fetch(`${API_BASE_URL}/manager/pricing/branch-settings`, {
                                          method: "PUT", headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ actorEmail: normalizedEmail, branchId, cleaningOptOutFeeVnd: Number(branchSettingsEdit!.cleaningOptOutFeeVnd) || 0, parkingFeeVnd: Number(branchSettingsEdit!.parkingFeeVnd) || 0 })
                                        });
                                        const data = await res.json() as { ok?: boolean; row?: BranchPricingSettings; error?: string };
                                        if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
                                        if (data.row) setPricingData((prev) => prev ? { ...prev, branchSettings: [...(prev.branchSettings ?? []).filter((s) => s.branchId !== branchId), data.row!] } : prev);
                                        setBranchSettingsEdit({ ...branchSettingsEdit!, saving: false, result: "✓ Saved" });
                                        setTimeout(() => setBranchSettingsEdit(null), 1500);
                                      } catch (err) { setBranchSettingsEdit({ ...branchSettingsEdit!, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                                    }} className="rounded-xl bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{branchSettingsEdit!.saving ? "Saving…" : "Save"}</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1 text-sm text-slate-600">
                                  <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Cleaning opt-out fee</span><span className="font-semibold">{settings.cleaningOptOutFeeVnd.toLocaleString("vi-VN")} ₫/mo</span></div>
                                  <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Default parking fee</span><span className="font-semibold">{settings.parkingFeeVnd.toLocaleString("vi-VN")} ₫/mo</span></div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bed pricing diagram (collapsible) ── */}
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <button type="button" onClick={() => setBedPricingExpanded((v) => !v)}
                      className="flex w-full items-center justify-between px-6 py-5 text-left hover:bg-slate-50 transition-colors">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">Bed Prices (Monthly)</h3>
                        <p className="mt-0.5 text-sm text-slate-500">Click to expand and edit individual bed prices or bulk-set by tier.</p>
                      </div>
                      <span className="text-slate-400 text-xl">{bedPricingExpanded ? "▲" : "▼"}</span>
                    </button>
                    {bedPricingExpanded && (
                    <div className="border-t border-slate-100 p-5 space-y-5">
                  {/* Mode selector */}
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-sm font-medium text-slate-700 mr-1">Edit mode:</span>
                      {([
                        { key: "by_branch", label: "By branch + tier", desc: "Set one price for all beds of a tier across an entire branch" },
                        { key: "by_room", label: "By room + tier", desc: "Set price for all beds of a tier within a specific room" },
                        { key: "per_bed", label: "Per bed", desc: "Click any individual bed to set its exact price" }
                      ] as const).map(({ key, label, desc }) => (
                        <button key={key} type="button" onClick={() => { setPricingDiagramMode(key); setBulkTierEdit(null); setBedOverrideEdit(null); }}
                          title={desc}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${pricingDiagramMode === key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {pricingDiagramMode === "by_branch" && "Set one price for all beds of a tier (Top/Middle/Bottom) across an entire branch at once."}
                      {pricingDiagramMode === "by_room" && "Set a price for all beds of a tier within a specific room."}
                      {pricingDiagramMode === "per_bed" && "Click any individual bed cell to view or set its price. Teal = has override, grey = using sheet value."}
                    </p>
                  </div>

                  {/* ── By-branch bulk mode ── */}
                  {pricingDiagramMode === "by_branch" ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-base font-semibold text-slate-900">Set price by branch + tier</h3>
                      <p className="text-sm text-slate-500">Select a branch and bunk level to set the same price for all matching beds.</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(["D2", "D7"] as const).map((branchId) => (
                          <div key={branchId} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                            <p className="text-sm font-semibold text-slate-800">{branchId}</p>
                            <div className="grid grid-cols-3 gap-2">
                              {(["top", "middle", "bottom"] as const).map((tier) => {
                                const isEditing = bulkTierEdit?.branchId === branchId && bulkTierEdit?.tier === tier && !bulkTierEdit?.floor;
                                // Count how many beds of this tier have overrides
                                const matchingBeds = BRANCH_LAYOUTS[branchId].flatMap((r) => {
                                  const beds = [];
                                  for (let b = r.startBed; b <= r.endBed; b++) {
                                    if (getBedTierInLayout(branchId, b) === tier) beds.push(b);
                                  }
                                  return beds;
                                });
                                const overrideCount = matchingBeds.filter((b) => (pricingData?.bedOverrides ?? []).some((o) => o.termType === "long_term" && o.branchId === branchId && o.bedNumber === b && o.monthlyPrice != null)).length;
                                return (
                                  <button key={tier} type="button"
                                    onClick={() => setBulkTierEdit({ branchId, tier, monthlyPrice: "", saving: false, result: "" })}
                                    className={`rounded-xl border px-3 py-2 text-center transition-colors ${isEditing ? "border-teal-500 bg-teal-100 ring-1 ring-teal-400" : overrideCount > 0 ? "border-teal-200 bg-teal-50 hover:bg-teal-100" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}>
                                    <div className="text-xs font-bold text-slate-500">{tier.charAt(0).toUpperCase()}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{overrideCount}/{matchingBeds.length} set</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {bulkTierEdit && !bulkTierEdit.floor ? (
                        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-3">
                          <p className="text-sm font-semibold text-teal-900">
                            Set price — {bulkTierEdit.branchId} · All {bulkTierEdit.tier} beds
                          </p>
                          <div className="flex items-end gap-3 flex-wrap">
                            <label className="space-y-1 flex-1 min-w-[140px]">
                              <span className="text-xs font-medium text-slate-700">Monthly price (VND)</span>
                              <input type="number" min={0} value={bulkTierEdit.monthlyPrice}
                                onChange={(e) => setBulkTierEdit({ ...bulkTierEdit, monthlyPrice: e.target.value })}
                                placeholder="blank = reset to sheet" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                            </label>
                          </div>
                          {bulkTierEdit.result ? <p className={`text-sm font-medium ${bulkTierEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bulkTierEdit.result}</p> : null}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setBulkTierEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                            <button type="button" disabled={bulkTierEdit.saving} onClick={async () => {
                              setBulkTierEdit({ ...bulkTierEdit, saving: true, result: "" });
                              try {
                                const price = bulkTierEdit.monthlyPrice ? Number(bulkTierEdit.monthlyPrice) : null;
                                await saveBulkTierPrices(bulkTierEdit.branchId, undefined, undefined, bulkTierEdit.tier, price);
                                setBulkTierEdit({ ...bulkTierEdit, saving: false, result: `✓ Saved all ${bulkTierEdit.tier} beds in ${bulkTierEdit.branchId}` });
                              } catch (err) { setBulkTierEdit({ ...bulkTierEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                            }} className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bulkTierEdit.saving ? "Saving…" : "Apply to all matching beds"}</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── By-room bulk mode ── */}
                  {pricingDiagramMode === "by_room" ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
                      <h3 className="text-base font-semibold text-slate-900">Set price by room + tier</h3>
                      {(["D2", "D7"] as const).map((branchId) => {
                        // Group rooms by floor
                        const floors = [...new Set(BRANCH_LAYOUTS[branchId].map((r) => r.floor))];
                        return (
                          <div key={branchId} className="space-y-3">
                            <p className="text-sm font-bold text-slate-700">{branchId}</p>
                            {floors.map((floor) => (
                              <div key={floor}>
                                <p className="text-xs text-slate-500 font-medium mb-1.5">{floor}</p>
                                <div className="flex flex-wrap gap-2">
                                  {BRANCH_LAYOUTS[branchId].filter((r) => r.floor === floor).map((room) => {
                                    const tiers = room.bunkCount === 3 ? (["top", "middle", "bottom"] as const) : (["top", "bottom"] as const);
                                    return (
                                      <div key={room.room} className="rounded-xl border border-slate-200 p-2.5 space-y-1.5 bg-slate-50">
                                        <p className="text-[10px] font-semibold text-slate-500 text-center">Room {room.room}</p>
                                        <div className="flex flex-col gap-1">
                                          {tiers.map((tier) => {
                                            const isEditing = bulkTierEdit?.branchId === branchId && bulkTierEdit?.room === room.room && bulkTierEdit?.tier === tier;
                                            const matchingBeds: number[] = [];
                                            for (let b = room.startBed; b <= room.endBed; b++) {
                                              if (getBedTierInLayout(branchId, b) === tier) matchingBeds.push(b);
                                            }
                                            const overrideCount = matchingBeds.filter((b) => (pricingData?.bedOverrides ?? []).some((o) => o.termType === "long_term" && o.branchId === branchId && o.bedNumber === b && o.monthlyPrice != null)).length;
                                            return (
                                              <button key={tier} type="button"
                                                onClick={() => setBulkTierEdit({ branchId, floor: room.floor, room: room.room, tier, monthlyPrice: "", saving: false, result: "" })}
                                                className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors flex items-center justify-between gap-1 ${isEditing ? "border-teal-500 bg-teal-100" : overrideCount > 0 ? "border-teal-200 bg-teal-50 hover:bg-teal-100" : "border-slate-200 bg-white hover:bg-slate-100"}`}>
                                                <span className="text-slate-600">{tier.charAt(0).toUpperCase()}</span>
                                                <span className="text-slate-400">{overrideCount}/{matchingBeds.length}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                      {bulkTierEdit?.room ? (
                        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-3">
                          <p className="text-sm font-semibold text-teal-900">
                            Set price — {bulkTierEdit.branchId} Room {bulkTierEdit.room} · {bulkTierEdit.tier} beds
                          </p>
                          <div className="flex items-end gap-3 flex-wrap">
                            <label className="space-y-1 flex-1 min-w-[140px]">
                              <span className="text-xs font-medium text-slate-700">Monthly price (VND)</span>
                              <input type="number" min={0} value={bulkTierEdit.monthlyPrice}
                                onChange={(e) => setBulkTierEdit({ ...bulkTierEdit, monthlyPrice: e.target.value })}
                                placeholder="blank = reset to sheet" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                            </label>
                          </div>
                          {bulkTierEdit.result ? <p className={`text-sm font-medium ${bulkTierEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bulkTierEdit.result}</p> : null}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setBulkTierEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                            <button type="button" disabled={bulkTierEdit.saving} onClick={async () => {
                              setBulkTierEdit({ ...bulkTierEdit, saving: true, result: "" });
                              try {
                                const price = bulkTierEdit.monthlyPrice ? Number(bulkTierEdit.monthlyPrice) : null;
                                await saveBulkTierPrices(bulkTierEdit.branchId, bulkTierEdit.floor, bulkTierEdit.room, bulkTierEdit.tier, price);
                                setBulkTierEdit({ ...bulkTierEdit, saving: false, result: `✓ Saved ${bulkTierEdit.tier} beds in room ${bulkTierEdit.room}` });
                              } catch (err) { setBulkTierEdit({ ...bulkTierEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                            }} className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bulkTierEdit.saving ? "Saving…" : "Apply to room"}</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── Per-bed diagram (existing) ── */}
                  {pricingDiagramMode === "per_bed" ? (["D2", "D7"] as const).map((branchId) => (
                    <div key={branchId} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{branchId} — Monthly Bed Prices</h3>
                        <p className="mt-1 text-sm text-slate-500">Click a bed to override its price. Deposit is automatically set equal to the monthly price. Beds without an override use the price from resident history.</p>
                      </div>
                      {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                        <div className="space-y-4">
                          {BRANCH_LAYOUTS[branchId].map((room) => {
                            const bedNumbers = Array.from({ length: room.endBed - room.startBed + 1 }, (_, i) => room.startBed + i);
                            const ltOverrides = pricingData?.bedOverrides.filter((b) => b.termType === "long_term" && b.branchId === branchId) ?? [];
                            // Group beds into bunks (columns of bunkCount tiers each)
                            const bunks: number[][] = [];
                            for (let i = 0; i < bedNumbers.length; i += room.bunkCount) {
                              bunks.push(bedNumbers.slice(i, i + room.bunkCount));
                            }
                            const tierLabels = room.bunkCount === 3 ? ["T", "M", "B"] : ["T", "B"];
                            return (
                              <div key={room.room}>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Room {room.room} · {room.floor}</p>
                                <div className="flex flex-wrap gap-2">
                                  {bunks.map((bunk, bunkIdx) => (
                                    <div key={bunkIdx} className="flex flex-col gap-1">
                                      {bunk.map((bedNum, tierIdx) => {
                                        const override = ltOverrides.find((b) => b.bedNumber === bedNum);
                                        const hasOverride = override?.monthlyPrice != null;
                                        const isEditing = bedOverrideEdit?.termType === "long_term" && bedOverrideEdit.branchId === branchId && bedOverrideEdit.bedNumber === String(bedNum);
                                        return (
                                          <button
                                            key={bedNum}
                                            type="button"
                                            onClick={() => setBedOverrideEdit({ id: override?.id, branchId, bedNumber: String(bedNum), termType: "long_term", monthlyPrice: String(override?.monthlyPrice ?? ""), deposit: "", nightlyPrice: "", saving: false, result: "" })}
                                            className={`w-20 rounded-lg border px-1.5 py-1 text-center transition-colors ${isEditing ? "border-teal-500 bg-teal-100 ring-1 ring-teal-400" : hasOverride ? "border-teal-300 bg-teal-50 hover:bg-teal-100" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-[10px] font-bold text-slate-400">{tierLabels[tierIdx]}</span>
                                              <span className="text-[10px] font-semibold text-slate-600">#{bedNum}</span>
                                            </div>
                                            <div className="text-[10px] leading-tight mt-0.5 text-center truncate">
                                              {hasOverride
                                                ? <span className="font-semibold text-teal-700">{((override!.monthlyPrice! / 1_000_000)).toFixed(1)}M</span>
                                                : <span className="text-slate-400">sheet</span>}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          {/* Edit panel — shown inline when a bed is selected */}
                          {bedOverrideEdit?.termType === "long_term" && bedOverrideEdit.branchId === branchId ? (
                            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-3">
                              <p className="text-sm font-semibold text-teal-900">
                                {branchId} Bed #{bedOverrideEdit.bedNumber}
                                {(() => {
                                  const bedNum = Number(bedOverrideEdit.bedNumber);
                                  const room = BRANCH_LAYOUTS[branchId].find((r) => bedNum >= r.startBed && bedNum <= r.endBed);
                                  if (!room) return null;
                                  const posInRoom = bedNum - room.startBed;
                                  const tierIdx = posInRoom % room.bunkCount;
                                  const tierLabel = room.bunkCount === 3 ? ["Top", "Middle", "Bottom"][tierIdx] : ["Top", "Bottom"][tierIdx];
                                  return <span className="ml-2 font-normal text-teal-700">· Room {room.room} · {tierLabel} bunk</span>;
                                })()}
                              </p>
                              <div className="flex items-end gap-3 flex-wrap">
                                <label className="space-y-1 flex-1 min-w-[140px]">
                                  <span className="text-xs font-medium text-slate-700">Monthly price (VND)</span>
                                  <input
                                    type="number" min={0}
                                    value={bedOverrideEdit.monthlyPrice}
                                    onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, monthlyPrice: e.target.value })}
                                    placeholder="blank = use sheet"
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                                  />
                                </label>
                                <p className="text-xs text-slate-500 pb-2">Deposit = monthly price (set automatically)</p>
                              </div>
                              {/* Per-bed parking fee override */}
                              {(() => {
                                const bedNum = Number(bedOverrideEdit.bedNumber);
                                const existingPark = (pricingData?.parkingOverrides ?? []).find((p) => p.branchId === branchId && p.bedNumber === bedNum);
                                const isEditingParking = parkingBedEdit?.branchId === branchId && parkingBedEdit?.bedNumber === bedOverrideEdit.bedNumber;
                                return (
                                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-semibold text-amber-800">Parking fee override for this bed</span>
                                      {existingPark && !isEditingParking && <span className="text-xs font-semibold text-amber-700">{existingPark.parkingFeeVnd.toLocaleString("vi-VN")} ₫/mo</span>}
                                      {!isEditingParking && (
                                        <button type="button" onClick={() => setParkingBedEdit({ branchId, bedNumber: bedOverrideEdit.bedNumber, parkingFeeVnd: String(existingPark?.parkingFeeVnd ?? ""), saving: false, result: "" })}
                                          className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                                          {existingPark ? "Edit" : "Set override"}
                                        </button>
                                      )}
                                    </div>
                                    {!existingPark && !isEditingParking && <p className="text-xs text-amber-600">Using branch default. Set an override to give this bed a different parking rate.</p>}
                                    {isEditingParking && (
                                      <div className="space-y-2">
                                        <input type="number" min={0} value={parkingBedEdit!.parkingFeeVnd}
                                          onChange={(e) => setParkingBedEdit({ ...parkingBedEdit!, parkingFeeVnd: e.target.value })}
                                          placeholder="Parking fee VND/month"
                                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
                                        {parkingBedEdit!.result ? <p className={`text-xs font-medium ${parkingBedEdit!.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{parkingBedEdit!.result}</p> : null}
                                        <div className="flex gap-2 flex-wrap">
                                          <button type="button" onClick={() => setParkingBedEdit(null)} className="rounded-xl border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700">Cancel</button>
                                          {existingPark && <button type="button" onClick={async () => {
                                            const res = await fetch(`${API_BASE_URL}/manager/pricing/parking-beds?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=${branchId}&bedNumber=${bedNum}`, { method: "DELETE" });
                                            if (res.ok) { setPricingData((prev) => prev ? { ...prev, parkingOverrides: prev.parkingOverrides.filter((p) => !(p.branchId === branchId && p.bedNumber === bedNum)) } : prev); setParkingBedEdit(null); }
                                          }} className="rounded-xl border border-rose-200 px-3 py-1 text-xs font-medium text-rose-600">Remove override</button>}
                                          <button type="button" disabled={parkingBedEdit!.saving} onClick={async () => {
                                            setParkingBedEdit({ ...parkingBedEdit!, saving: true, result: "" });
                                            try {
                                              const res = await fetch(`${API_BASE_URL}/manager/pricing/parking-beds`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, branchId, bedNumber: bedNum, parkingFeeVnd: Number(parkingBedEdit!.parkingFeeVnd) || 0 }) });
                                              const data = await res.json() as { ok?: boolean; row?: BedParkingFeeOverride; error?: string };
                                              if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
                                              if (data.row) setPricingData((prev) => prev ? { ...prev, parkingOverrides: [...(prev.parkingOverrides ?? []).filter((p) => !(p.branchId === branchId && p.bedNumber === bedNum)), data.row!] } : prev);
                                              setParkingBedEdit({ ...parkingBedEdit!, saving: false, result: "✓ Saved" });
                                              setTimeout(() => setParkingBedEdit(null), 1500);
                                            } catch (err) { setParkingBedEdit({ ...parkingBedEdit!, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                                          }} className="rounded-xl bg-amber-600 px-4 py-1 text-xs font-semibold text-white disabled:opacity-50">{parkingBedEdit!.saving ? "Saving…" : "Save"}</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {bedOverrideEdit.result ? <p className={`text-sm font-medium ${bedOverrideEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bedOverrideEdit.result}</p> : null}
                              <div className="flex gap-2 flex-wrap">
                                <button type="button" onClick={() => setBedOverrideEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                                {(pricingData?.bedOverrides ?? []).some((b) => b.termType === "long_term" && b.branchId === branchId && b.bedNumber === Number(bedOverrideEdit.bedNumber)) && (
                                  <button type="button" onClick={async () => {
                                    if (!window.confirm(`Remove override for ${branchId} Bed #${bedOverrideEdit.bedNumber}?`)) return;
                                    const res = await fetch(`${API_BASE_URL}/manager/pricing/beds?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=${branchId}&bedNumber=${bedOverrideEdit.bedNumber}&termType=long_term`, { method: "DELETE" });
                                    if (res.ok) { setPricingData((prev) => prev ? { ...prev, bedOverrides: prev.bedOverrides.filter((x) => !(x.termType === "long_term" && x.branchId === branchId && x.bedNumber === Number(bedOverrideEdit.bedNumber))) } : prev); setBedOverrideEdit(null); }
                                  }} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600">Reset to sheet</button>
                                )}
                                <button type="button" disabled={bedOverrideEdit.saving} onClick={async () => {
                                  setBedOverrideEdit({ ...bedOverrideEdit, saving: true, result: "" });
                                  try {
                                    const monthlyPrice = bedOverrideEdit.monthlyPrice ? Number(bedOverrideEdit.monthlyPrice) : null;
                                    const res = await fetch(`${API_BASE_URL}/manager/pricing/beds`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, branchId, bedNumber: Number(bedOverrideEdit.bedNumber), termType: "long_term", monthlyPrice, deposit: monthlyPrice }) });
                                    const data = (await res.json()) as { ok?: boolean; row?: PricingBedOverride; error?: string };
                                    if (!res.ok) throw new Error(data.error ?? "Failed");
                                    if (data.row) setPricingData((prev) => prev ? { ...prev, bedOverrides: [...prev.bedOverrides.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                    setBedOverrideEdit(null);
                                  } catch (err) { setBedOverrideEdit({ ...bedOverrideEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                                }} className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bedOverrideEdit.saving ? "Saving…" : "Save price"}</button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )) : null}
                  </div>
                  )}
                  </div>

                  {/* ── Long-term discounts ── */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Registration Discounts</h3>
                      <p className="mt-1 text-sm text-slate-500">Shown on the registration form. All eligibility rules must match for the discount to apply.</p>
                    </div>
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                      <>
                        {(pricingData?.discounts ?? []).filter((d) => d.termType === "long_term").length > 0 ? (
                          <div className="space-y-3">
                            {(pricingData?.discounts ?? []).filter((d) => d.termType === "long_term").map((d) => (
                              <div key={d.id} className={`rounded-2xl border p-4 space-y-2 ${d.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <span className="font-semibold text-slate-900 text-sm">{d.label}</span>
                                    {!d.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500">Disabled</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setDiscountEdit({ id: d.id, termType: "long_term", label: d.label, labelVi: d.labelVi ?? "", description: d.description, descriptionVi: d.descriptionVi ?? "", amountVnd: String(d.amountVnd ?? ""), percentOff: "", minNights: "", durationMonths: d.durationMonths != null ? String(d.durationMonths) : "", eligibility: d.eligibility.map((e) => ({ type: e.type, values: "values" in e ? ((e as { values: string[] }).values ?? []).join(", ") : "", value: "value" in e ? String((e as { value: number }).value) : "" })), selectionMode: d.selectionMode ?? "manual", stackMode: d.stackMode ?? "stackable", enabled: d.enabled, saving: false, result: "" })}
                                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Edit</button>
                                    <button type="button" onClick={async () => {
                                      if (!window.confirm(`Delete "${d.label}"?`)) return;
                                      const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts/${encodeURIComponent(d.id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`, { method: "DELETE" });
                                      if (res.ok) setPricingData((prev) => prev ? { ...prev, discounts: prev.discounts.filter((x) => x.id !== d.id) } : prev);
                                    }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">Delete</button>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-500">{d.description}</p>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {d.amountVnd != null && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 font-medium">−{d.amountVnd.toLocaleString("vi-VN")} ₫/month</span>}
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{d.durationMonths != null ? `${d.durationMonths} months` : "Entire contract"}</span>
                                  <span className={`rounded-full px-2.5 py-1 font-medium ${d.stackMode === "exclusive" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{d.stackMode === "exclusive" ? "Exclusive" : "Stackable"}</span>
                                  {d.eligibility.map((e, i) => (
                                    <span key={i} className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                                      {e.type === "status" ? `Status: ${"values" in e ? ((e as { values: string[] }).values ?? []).join(" / ") : ""}` :
                                       e.type === "minMonths" ? `Min ${"value" in e ? (e as { value: number }).value : "?"} months` :
                                       e.type === "referral" ? "Has referral" :
                                       e.type === "bedTier" ? `Bed tier: ${"values" in e ? ((e as { values: string[] }).values ?? []).join("/") : ""}` :
                                       e.type === "gender" ? `Gender: ${"values" in e ? ((e as { values: string[] }).values ?? []).join("/") : ""}` :
                                       e.type === "occupation" ? `Occupation: ${"values" in e ? ((e as { values: string[] }).values ?? []).join(", ") : ""}` : e.type}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">No long-term discounts configured.</p>}
                        {discountEdit?.termType === "long_term" ? (
                          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 space-y-4">
                            <p className="text-sm font-semibold text-sky-900">{discountEdit.id && (pricingData?.discounts ?? []).some((d) => d.id === discountEdit.id) ? "Edit discount" : "New long-term discount"}</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Label (English)</span>
                                <input value={discountEdit.label} onChange={(e) => setDiscountEdit({ ...discountEdit, label: e.target.value })} placeholder="e.g. Student discount" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Label (Vietnamese)</span>
                                <input value={discountEdit.labelVi} onChange={(e) => setDiscountEdit({ ...discountEdit, labelVi: e.target.value })} placeholder="e.g. Giảm giá sinh viên" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Description (English)</span>
                                <input value={discountEdit.description} onChange={(e) => setDiscountEdit({ ...discountEdit, description: e.target.value })} placeholder="e.g. For university students" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Description (Vietnamese)</span>
                                <input value={discountEdit.descriptionVi} onChange={(e) => setDiscountEdit({ ...discountEdit, descriptionVi: e.target.value })} placeholder="e.g. Dành cho sinh viên đại học" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Monthly discount (VND)</span>
                                <input type="number" min={0} value={discountEdit.amountVnd} onChange={(e) => setDiscountEdit({ ...discountEdit, amountVnd: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Duration months (blank = entire contract)</span>
                                <input type="number" min={1} value={discountEdit.durationMonths} onChange={(e) => setDiscountEdit({ ...discountEdit, durationMonths: e.target.value })} placeholder="Blank = whole contract" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Selection rule</span>
                                <select value={discountEdit.selectionMode} onChange={(e) => setDiscountEdit({ ...discountEdit, selectionMode: e.target.value as "manual" | "automatic" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                  <option value="manual">Resident must select</option>
                                  <option value="automatic">Auto apply when eligible</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Stacking rule</span>
                                <select value={discountEdit.stackMode} onChange={(e) => setDiscountEdit({ ...discountEdit, stackMode: e.target.value as "stackable" | "exclusive" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                  <option value="stackable">Stackable</option>
                                  <option value="exclusive">Exclusive</option>
                                </select>
                              </label>
                              <div className="sm:col-span-2 space-y-2">
                                <span className="text-xs font-medium text-slate-700 block">Eligibility rules (ALL must match)</span>
                                {discountEdit.eligibility.map((rule, idx) => (
                                  <div key={idx} className="flex gap-2 items-start flex-wrap">
                                    <select value={rule.type} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { type: e.target.value, values: "", value: "" }; setDiscountEdit({ ...discountEdit, eligibility: u }); }}
                                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                      <option value="status">Resident status</option>
                                      <option value="minMonths">Min contract months</option>
                                      <option value="referral">Has referral</option>
                                      <option value="bedTier">Bed tier (T/M/B)</option>
                                      <option value="gender">Gender</option>
                                      <option value="occupation">Occupation</option>
                                    </select>
                                    {rule.type === "status" && <input value={rule.values} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { ...u[idx], values: e.target.value }; setDiscountEdit({ ...discountEdit, eligibility: u }); }} placeholder="Sinh vien, Hoc sinh" className="flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />}
                                    {rule.type === "minMonths" && <input type="number" min={1} value={rule.value} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { ...u[idx], value: e.target.value }; setDiscountEdit({ ...discountEdit, eligibility: u }); }} placeholder="e.g. 6" className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />}
                                    {rule.type === "bedTier" && (
                                      <div className="flex gap-2">
                                        {(["top", "middle", "bottom"] as const).map((tier) => (
                                          <label key={tier} className="flex items-center gap-1 text-sm">
                                            <input type="checkbox" checked={(rule.values ?? "").split(",").map((v) => v.trim()).includes(tier)}
                                              onChange={(e) => { const u = [...discountEdit.eligibility]; const cur = (u[idx].values ?? "").split(",").map((v) => v.trim()).filter(Boolean); u[idx] = { ...u[idx], values: (e.target.checked ? [...cur, tier] : cur.filter((v) => v !== tier)).join(", ") }; setDiscountEdit({ ...discountEdit, eligibility: u }); }}
                                              className="h-4 w-4 rounded border-slate-300" />
                                            {tier.charAt(0).toUpperCase() + tier.slice(1)}
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                    {rule.type === "gender" && (
                                      <div className="flex gap-3">
                                        {(["male", "female"] as const).map((g) => (
                                          <label key={g} className="flex items-center gap-1 text-sm">
                                            <input type="checkbox" checked={(rule.values ?? "").split(",").map((v) => v.trim()).includes(g)}
                                              onChange={(e) => { const u = [...discountEdit.eligibility]; const cur = (u[idx].values ?? "").split(",").map((v) => v.trim()).filter(Boolean); u[idx] = { ...u[idx], values: (e.target.checked ? [...cur, g] : cur.filter((v) => v !== g)).join(", ") }; setDiscountEdit({ ...discountEdit, eligibility: u }); }}
                                              className="h-4 w-4 rounded border-slate-300" />
                                            {g.charAt(0).toUpperCase() + g.slice(1)}
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                    {rule.type === "occupation" && <input value={rule.values} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { ...u[idx], values: e.target.value }; setDiscountEdit({ ...discountEdit, eligibility: u }); }} placeholder="e.g. Doctor, Engineer, Nurse" className="flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />}
                                    <button type="button" onClick={() => setDiscountEdit({ ...discountEdit, eligibility: discountEdit.eligibility.filter((_, i) => i !== idx) })} className="rounded-xl border border-rose-200 px-3 py-2 text-xs text-rose-600 self-start mt-0.5">✕</button>
                                  </div>
                                ))}
                                <button type="button" onClick={() => setDiscountEdit({ ...discountEdit, eligibility: [...discountEdit.eligibility, { type: "status", values: "", value: "" }] })}
                                  className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-sky-400">+ Add rule</button>
                              </div>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={discountEdit.enabled} onChange={(e) => setDiscountEdit({ ...discountEdit, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
                                <span className="text-sm text-slate-700">Enabled (visible on registration form)</span>
                              </label>
                            </div>
                            {discountEdit.result ? <p className={`text-sm font-medium ${discountEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{discountEdit.result}</p> : null}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setDiscountEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                              <button type="button" disabled={discountEdit.saving || !discountEdit.label} onClick={async () => {
                                setDiscountEdit({ ...discountEdit, saving: true, result: "" });
                                try {
                                  const eligibility = discountEdit.eligibility.filter((r) => r.type).map((r) => {
                                    if (r.type === "status") return { type: "status", values: r.values.split(",").map((v) => v.trim()).filter(Boolean) };
                                    if (r.type === "minMonths") return { type: "minMonths", value: Number(r.value) || 1 };
                                    if (r.type === "referral") return { type: "referral" };
                                    if (r.type === "bedTier") return { type: "bedTier", values: r.values.split(",").map((v) => v.trim()).filter(Boolean) };
                                    if (r.type === "gender") return { type: "gender", values: r.values.split(",").map((v) => v.trim()).filter(Boolean) };
                                    if (r.type === "occupation") return { type: "occupation", values: r.values.split(",").map((v) => v.trim()).filter(Boolean) };
                                    return { type: r.type };
                                  });
                                  const id = discountEdit.id || `lt_${Date.now()}`;
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, discount: { id, termType: "long_term", label: discountEdit.label, labelVi: discountEdit.labelVi, description: discountEdit.description, descriptionVi: discountEdit.descriptionVi, amountVnd: Number(discountEdit.amountVnd) || 0, percentOff: null, minNights: null, durationMonths: discountEdit.durationMonths ? Number(discountEdit.durationMonths) : null, eligibility, selectionMode: discountEdit.selectionMode, stackMode: discountEdit.stackMode, enabled: discountEdit.enabled } }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingDiscount; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, discounts: [...prev.discounts.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setDiscountEdit(null);
                                } catch (err) { setDiscountEdit({ ...discountEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{discountEdit.saving ? "Saving…" : "Save discount"}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setDiscountEdit({ id: "", termType: "long_term", label: "", labelVi: "", description: "", descriptionVi: "", amountVnd: "0", percentOff: "", minNights: "", durationMonths: "", eligibility: [], selectionMode: "manual", stackMode: "stackable", enabled: true, saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-sky-400 hover:text-sky-700">+ Add discount</button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {/* ── Short-term tab: nightly bed prices + stay discounts ── */}
          {(pricingSettingsTab === "short_term") ? (
            <section className="space-y-5">
              {!canManageOwnersEmployees ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-slate-500">Pricing editing is restricted to owners and app admins.</p>
                </div>
              ) : (
                <>
                  {/* Short-term nightly bed overrides */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Nightly Bed Prices</h3>
                      <p className="mt-1 text-sm text-slate-500">Override the nightly rate for a specific bed. Falls back to the short-term config default if not set.</p>
                    </div>
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                      <>
                        {(pricingData?.bedOverrides ?? []).filter((b) => b.termType === "short_term").length > 0 ? (
                          <div className="space-y-2">
                            {(pricingData?.bedOverrides ?? []).filter((b) => b.termType === "short_term").map((b) => (
                              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-sm">
                                  <span className="font-semibold text-slate-900">{b.branchId} Bed {b.bedNumber}</span>
                                  <span className="ml-3 text-slate-500">{b.nightlyPrice != null ? `${b.nightlyPrice.toLocaleString("vi-VN")} ₫/night` : "config default"}</span>
                                  <span className="ml-2 text-xs text-slate-400">by {b.updatedBy}</span>
                                </div>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setBedOverrideEdit({ id: b.id, branchId: b.branchId, bedNumber: String(b.bedNumber), termType: "short_term", monthlyPrice: "", deposit: "", nightlyPrice: String(b.nightlyPrice ?? ""), saving: false, result: "" })}
                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Edit</button>
                                  <button type="button" onClick={async () => {
                                    if (!window.confirm(`Remove nightly override for ${b.branchId} Bed ${b.bedNumber}?`)) return;
                                    const res = await fetch(`${API_BASE_URL}/manager/pricing/beds?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=${b.branchId}&bedNumber=${b.bedNumber}&termType=short_term`, { method: "DELETE" });
                                    if (res.ok) setPricingData((prev) => prev ? { ...prev, bedOverrides: prev.bedOverrides.filter((x) => x.id !== b.id) } : prev);
                                  }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">Remove</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">No nightly overrides — using config defaults.</p>}
                        {bedOverrideEdit?.termType === "short_term" ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 space-y-4">
                            <p className="text-sm font-semibold text-violet-900">{bedOverrideEdit.id ? "Edit" : "Add"} nightly price</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Branch</span>
                                <select value={bedOverrideEdit.branchId} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, branchId: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="D2">D2</option><option value="D7">D7</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Bed number</span>
                                <input type="number" min={1} value={bedOverrideEdit.bedNumber} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, bedNumber: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Nightly price (VND)</span>
                                <input type="number" min={0} value={bedOverrideEdit.nightlyPrice} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, nightlyPrice: e.target.value })} placeholder="e.g. 150000" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                            </div>
                            {bedOverrideEdit.result ? <p className={`text-sm font-medium ${bedOverrideEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bedOverrideEdit.result}</p> : null}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setBedOverrideEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                              <button type="button" disabled={bedOverrideEdit.saving} onClick={async () => {
                                setBedOverrideEdit({ ...bedOverrideEdit, saving: true, result: "" });
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/beds`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, branchId: bedOverrideEdit.branchId, bedNumber: Number(bedOverrideEdit.bedNumber), termType: "short_term", nightlyPrice: bedOverrideEdit.nightlyPrice ? Number(bedOverrideEdit.nightlyPrice) : null }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingBedOverride; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, bedOverrides: [...prev.bedOverrides.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setBedOverrideEdit(null);
                                } catch (err) { setBedOverrideEdit({ ...bedOverrideEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bedOverrideEdit.saving ? "Saving…" : "Save"}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setBedOverrideEdit({ branchId: "D2", bedNumber: "", termType: "short_term", monthlyPrice: "", deposit: "", nightlyPrice: "", saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700">+ Add nightly price override</button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Short-term stay discounts */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Stay Discounts</h3>
                      <p className="mt-1 text-sm text-slate-500">Automatic percent discounts for guests who stay longer (e.g. weekly, monthly).</p>
                    </div>
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                      <>
                        {(pricingData?.discounts ?? []).filter((d) => d.termType === "short_term").length > 0 ? (
                          <div className="space-y-3">
                            {(pricingData?.discounts ?? []).filter((d) => d.termType === "short_term").map((d) => (
                              <div key={d.id} className={`rounded-2xl border p-4 space-y-2 ${d.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <span className="font-semibold text-slate-900 text-sm">{d.label}</span>
                                    {!d.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500">Disabled</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setDiscountEdit({ id: d.id, termType: "short_term", label: d.label, labelVi: d.labelVi ?? "", description: d.description, descriptionVi: d.descriptionVi ?? "", amountVnd: "", percentOff: String(d.percentOff ?? ""), minNights: String(d.minNights ?? ""), durationMonths: "", eligibility: [], selectionMode: d.selectionMode ?? "automatic", stackMode: d.stackMode ?? "stackable", enabled: d.enabled, saving: false, result: "" })}
                                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Edit</button>
                                    <button type="button" onClick={async () => {
                                      if (!window.confirm(`Delete "${d.label}"?`)) return;
                                      const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts/${encodeURIComponent(d.id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`, { method: "DELETE" });
                                      if (res.ok) setPricingData((prev) => prev ? { ...prev, discounts: prev.discounts.filter((x) => x.id !== d.id) } : prev);
                                    }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">Delete</button>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-500">{d.description}</p>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {d.percentOff != null && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-700 font-medium">{d.percentOff}% off</span>}
                                  {d.minNights != null && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Min {d.minNights} nights</span>}
                                  <span className={`rounded-full px-2.5 py-1 font-medium ${d.stackMode === "exclusive" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{d.stackMode === "exclusive" ? "Exclusive" : "Stackable"}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">No short-term discounts configured.</p>}
                        {discountEdit?.termType === "short_term" ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 space-y-4">
                            <p className="text-sm font-semibold text-violet-900">{discountEdit.id && (pricingData?.discounts ?? []).some((d) => d.id === discountEdit.id) ? "Edit stay discount" : "New stay discount"}</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-slate-700">Label</span>
                                <input value={discountEdit.label} onChange={(e) => setDiscountEdit({ ...discountEdit, label: e.target.value })} placeholder="e.g. Weekly discount" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-slate-700">Description</span>
                                <input value={discountEdit.description} onChange={(e) => setDiscountEdit({ ...discountEdit, description: e.target.value })} placeholder="e.g. Stays of 7+ nights get 10% off" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Discount % (0–100)</span>
                                <input type="number" min={0} max={100} value={discountEdit.percentOff} onChange={(e) => setDiscountEdit({ ...discountEdit, percentOff: e.target.value })} placeholder="e.g. 10" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Minimum nights</span>
                                <input type="number" min={1} value={discountEdit.minNights} onChange={(e) => setDiscountEdit({ ...discountEdit, minNights: e.target.value })} placeholder="e.g. 7" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Selection rule</span>
                                <select value={discountEdit.selectionMode} onChange={(e) => setDiscountEdit({ ...discountEdit, selectionMode: e.target.value as "manual" | "automatic" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="manual">Guest must select</option>
                                  <option value="automatic">Auto apply when eligible</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">Stacking rule</span>
                                <select value={discountEdit.stackMode} onChange={(e) => setDiscountEdit({ ...discountEdit, stackMode: e.target.value as "stackable" | "exclusive" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="stackable">Stackable</option>
                                  <option value="exclusive">Exclusive</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-2 sm:col-span-2">
                                <input type="checkbox" checked={discountEdit.enabled} onChange={(e) => setDiscountEdit({ ...discountEdit, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-violet-600" />
                                <span className="text-sm text-slate-700">Enabled</span>
                              </label>
                            </div>
                            {discountEdit.result ? <p className={`text-sm font-medium ${discountEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{discountEdit.result}</p> : null}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setDiscountEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
                              <button type="button" disabled={discountEdit.saving || !discountEdit.label} onClick={async () => {
                                setDiscountEdit({ ...discountEdit, saving: true, result: "" });
                                try {
                                  const id = discountEdit.id || `st_${Date.now()}`;
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, discount: { id, termType: "short_term", label: discountEdit.label, labelVi: discountEdit.labelVi, description: discountEdit.description, descriptionVi: discountEdit.descriptionVi, amountVnd: null, percentOff: Number(discountEdit.percentOff) || 0, minNights: Number(discountEdit.minNights) || 1, durationMonths: null, eligibility: [], stackMode: discountEdit.stackMode, enabled: discountEdit.enabled } }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingDiscount; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, discounts: [...prev.discounts.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setDiscountEdit(null);
                                } catch (err) { setDiscountEdit({ ...discountEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{discountEdit.saving ? "Saving…" : "Save discount"}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setDiscountEdit({ id: "", termType: "short_term", label: "", labelVi: "", description: "", descriptionVi: "", amountVnd: "", percentOff: "10", minNights: "7", durationMonths: "", eligibility: [], stackMode: "stackable", enabled: true, saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700">+ Add stay discount</button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {/* ── Staff tab ── */}
          {pricingSettingsTab === "staff" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{t("ownersEmployees")}</h3>
                  <p className="mt-1 text-sm text-slate-600">{t("ownersEmployeesDesc")}</p>
                </div>
                <button type="button" onClick={() => void loadTeam()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">{t("refreshAccounts")}</button>
              </div>
              <div className="mt-4">
                <p className="text-sm text-slate-500">
                  Staff account management is available in the{" "}
                  <button type="button" onClick={() => setActiveManagerView("owners_employees")} className="font-medium text-sky-600 underline underline-offset-2">Staff Accounts view</button>.
                </p>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {activeManagerView === "owners_employees" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("ownersEmployees")}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {t("ownersEmployeesDesc")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadTeam()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              {t("refreshAccounts")}
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              {t("languagePreference")}
            </h3>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                {t("chooseDisplayLanguage")}
              </p>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="en">{t("english", "English")}</option>
                <option value="vi">{t("vietnamese", "Vietnamese")}</option>
              </select>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              {t("yourDisplayName")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {t("displayNameDesc")}
            </p>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={selfDisplayName}
                onChange={(e) => setSelfDisplayName(e.target.value)}
                placeholder={normalizedEmail}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                type="button"
                disabled={selfDisplayNameSaving || !selfDisplayName.trim()}
                onClick={async () => {
                  setSelfDisplayNameSaving(true);
                  try {
                    const res = await fetch(`${API_BASE_URL}/staff-access/self`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ actorEmail: normalizedEmail, name: selfDisplayName.trim() })
                    });
                    const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
                    if (!res.ok) throw new Error(data.error ?? t("requestFailed"));
                    setStatus(t("displayNamesSaved"));
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : "Failed to save display name");
                  } finally {
                    setSelfDisplayNameSaving(false);
                  }
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {selfDisplayNameSaving ? t("calculating") : t("saveLabel")}
              </button>
            </div>
          </div>

          {canManageOwnersEmployees ? (
            <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">{t("createUpdateAccess")}</div>
                <p className="mt-1 text-sm text-slate-600">
                  {t("promoteManagerPrompt")}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedClient?.email) {
                      setNewStaffEmail(selectedClient.email);
                      setNewStaffRole("manager");
                    }
                  }}
                  disabled={!selectedClient?.email}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("makeClientManager")}
                </button>
                {selectedClient?.email ? (
                  <div className="text-sm text-slate-600">
                    {t("selectedClientEmail").replace("{email}", selectedClient.email)}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-5">
                <input
                  type="email"
                  value={newStaffEmail}
                  onChange={(event) => setNewStaffEmail(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="team@example.com"
                />
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(event) => setNewStaffName(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={t("yourDisplayName")}
                />
                <select
                  value={newStaffRole}
                  onChange={(event) => setNewStaffRole(event.target.value as StaffRole)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="manager">Manager</option>
                  <option value="mechanic">Mechanic</option>
                  {isAppAdminSession ? <option value="owner">Owner</option> : null}
                </select>
                <input
                  type="password"
                  value={newStaffPassword}
                  onChange={(event) => setNewStaffPassword(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Starter password"
                />
                <button
                  type="button"
                  onClick={() =>
                    void postJson(
                      `${API_BASE_URL}/staff-access`,
                      {
                        actorEmail: normalizedEmail,
                        targetEmail: newStaffEmail,
                        name: newStaffName.trim() || undefined,
                        role: newStaffRole,
                        password: newStaffPassword.trim() || undefined
                      },
                      t("accountAccessUpdated"),
                      async () => {
                        await loadTeam();
                        setNewStaffEmail("");
                        setNewStaffName("");
                        setNewStaffRole("manager");
                        setNewStaffPassword("");
                      }
                    )
                  }
                  disabled={!newStaffEmail.trim()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {t("saveAccount")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {t("managersViewOnly")}
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowStaffList((v) => !v)}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
            >
              <span>{showStaffList ? "▲" : "▼"}</span>
              {showStaffList ? t("hideTeamList", "Hide team list") : t("showTeamList", "Show team list")}
              {staffEntries.length > 0 && (
                <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {staffEntries.length}
                </span>
              )}
            </button>

            {showStaffList && (
              <div className="mt-4 space-y-3">
                {staffEntries.length ? (
                  staffEntries.map((entry) => {
                    const isOwnerEntry = entry.role === "owner" || entry.role === "app_admin";
                    const canRemoveThis = canManageOwnersEmployees && !isOwnerEntry;
                    return (
                      <div
                        key={entry.email}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4"
                      >
                        <div>
                          <div className="font-medium text-slate-900">
                            {entry.name ? `${entry.name} — ` : ""}{entry.email}
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            {t("roleLabel")}: {entry.role} | {t("addedByLabel")}: {entry.addedBy || "system"}
                          </div>
                        </div>

                        {canManageOwnersEmployees ? (
                          <div className="flex flex-wrap gap-3">
                            <select
                              value={entry.role}
                              onChange={(event) =>
                                void postJson(
                                  `${API_BASE_URL}/staff-access`,
                                  {
                                    actorEmail: normalizedEmail,
                                    targetEmail: entry.email,
                                    role: event.target.value as StaffRole
                                  },
                                  "Account role updated.",
                                  loadTeam
                                )
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            >
                              <option value="manager">Manager</option>
                              <option value="mechanic">Mechanic</option>
                              {isAppAdminSession ? <option value="owner">Owner</option> : null}
                              <option value="app_admin" disabled>
                                App admin
                              </option>
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                setRemoveConfirmEntry(entry);
                                setRemoveConfirmPassword("");
                                setRemoveConfirmError("");
                              }}
                              disabled={!canRemoveThis}
                              title={isOwnerEntry ? t("cannotRemoveOwner", "Managers cannot remove owner accounts") : undefined}
                              className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t("removeLabel")}
                            </button>
                            {/* Permissions button — owner/admin sees it for others; anyone sees it for self */}
                            {(isOwnerSession || isAppAdminSession || entry.email === normalizedEmail) && (
                              <button
                                type="button"
                                onClick={() => void loadPermissions(entry)}
                                className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100"
                              >
                                {entry.email === normalizedEmail ? "My permissions" : "⚙ Permissions"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            {entry.email === normalizedEmail && (
                              <button
                                type="button"
                                onClick={() => void loadPermissions(entry)}
                                className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100"
                              >
                                My permissions
                              </button>
                            )}
                            <div className="text-sm text-slate-500 self-center">{t("viewOnly")}</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    {t("noAccountsAdded")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Remove confirmation dialog */}
          {removeConfirmEntry && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
                <h3 className="text-base font-semibold text-slate-900">
                  {t("confirmRemoveTitle", "Remove account?")}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {t("confirmRemoveDesc", "You are about to remove access for")}:{" "}
                  <span className="font-medium text-slate-900">
                    {removeConfirmEntry.name ? `${removeConfirmEntry.name} (${removeConfirmEntry.email})` : removeConfirmEntry.email}
                  </span>
                </p>
                <p className="mt-3 text-sm text-slate-600">
                  {t("confirmRemovePasswordPrompt", "Enter your password to confirm:")}
                </p>
                <input
                  type="password"
                  value={removeConfirmPassword}
                  onChange={(e) => {
                    setRemoveConfirmPassword(e.target.value);
                    setRemoveConfirmError("");
                  }}
                  placeholder={t("passwordPlaceholder", "Your password")}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                {removeConfirmError && (
                  <p className="mt-2 text-sm text-rose-600">{removeConfirmError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRemoveConfirmEntry(null)}
                    className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700"
                  >
                    {t("cancelLabel", "Cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={!removeConfirmPassword.trim() || removeConfirmLoading}
                    onClick={async () => {
                      setRemoveConfirmLoading(true);
                      setRemoveConfirmError("");
                      try {
                        // Verify password via login endpoint
                        const verifyRes = await fetch(`${API_BASE_URL}/auth/login`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email: normalizedEmail, password: removeConfirmPassword.trim() })
                        });
                        if (!verifyRes.ok) {
                          setRemoveConfirmError(t("incorrectPassword", "Incorrect password. Please try again."));
                          setRemoveConfirmLoading(false);
                          return;
                        }
                        await fetch(`${API_BASE_URL}/staff-access`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ actorEmail: normalizedEmail, targetEmail: removeConfirmEntry.email })
                        });
                        setRemoveConfirmEntry(null);
                        await loadTeam();
                      } catch {
                        setRemoveConfirmError(t("requestFailed", "Request failed. Please try again."));
                      } finally {
                        setRemoveConfirmLoading(false);
                      }
                    }}
                    className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {removeConfirmLoading ? t("calculating") : t("confirmRemoveBtn", "Remove account")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Permissions modal */}
          {permissionsEntry && editingPermissions && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
              <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white shadow-xl flex flex-col max-h-[90vh]">
                {/* Sticky header */}
                <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {permissionsEntry.email === normalizedEmail ? "My Permissions" : `Permissions — ${permissionsEntry.name ?? permissionsEntry.email}`}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">{permissionsEntry.email}</p>
                  </div>
                  <button type="button" onClick={() => { setPermissionsEntry(null); setEditingPermissions(null); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {/* Branch access */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Branch access</div>
                    <div className="flex flex-wrap gap-2">
                      {KNOWN_BRANCHES.map(b => {
                        const isActive = editingPermissions.branches.length === 0 || editingPermissions.branches.includes(b);
                        const canEdit = (isOwnerSession || isAppAdminSession) && permissionsEntry.email !== normalizedEmail;
                        return (
                          <button
                            key={b}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              if (!canEdit) return;
                              const current = editingPermissions.branches.length === 0 ? KNOWN_BRANCHES : [...editingPermissions.branches];
                              const next = current.includes(b) ? current.filter(x => x !== b) : [...current, b];
                              setEditingPermissions({ ...editingPermissions, branches: next.length === KNOWN_BRANCHES.length ? [] : next });
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-semibold border ${isActive ? "bg-sky-600 text-white border-sky-600" : "border-slate-300 text-slate-500"} disabled:cursor-default`}
                          >
                            {b}
                          </button>
                        );
                      })}
                      {editingPermissions.branches.length === 0 && (
                        <span className="text-xs text-slate-500 self-center">All branches</span>
                      )}
                    </div>
                  </div>

                  {/* Data permissions grid */}
                  <div className="mt-5">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data type</div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 text-center">Read</div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 text-center">Write</div>
                      {DATA_CATEGORIES.map(({ key, label, hasWrite }) => {
                        const perm = editingPermissions.data[key] ?? { read: false, write: false };
                        const canEdit = (isOwnerSession || isAppAdminSession) && permissionsEntry.email !== normalizedEmail;
                        const toggle = (field: "read" | "write") => {
                          if (!canEdit) return;
                          const cur = editingPermissions.data[key] ?? { read: false, write: false };
                          const next = { ...cur, [field]: !cur[field] };
                          if (field === "write" && next.write) next.read = true;
                          if (field === "read" && !next.read) next.write = false;
                          setEditingPermissions({ ...editingPermissions, data: { ...editingPermissions.data, [key]: next } });
                        };
                        return (
                          <>
                            <div key={`${key}-label`} className="text-sm text-slate-700">{label}</div>
                            <div key={`${key}-read`} className="flex justify-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => toggle("read")}
                                className={`h-5 w-5 rounded border-2 flex items-center justify-center ${perm.read ? "border-emerald-500 bg-emerald-500" : "border-slate-300"} disabled:cursor-default`}
                              >
                                {perm.read && <span className="text-white text-[10px] font-bold">✓</span>}
                              </button>
                            </div>
                            <div key={`${key}-write`} className="flex justify-center">
                              {hasWrite ? (
                                <button
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => toggle("write")}
                                  className={`h-5 w-5 rounded border-2 flex items-center justify-center ${perm.write ? "border-sky-500 bg-sky-500" : "border-slate-300"} disabled:cursor-default`}
                                >
                                  {perm.write && <span className="text-white text-[10px] font-bold">✓</span>}
                                </button>
                              ) : (
                                <span className="text-slate-300 text-xs">—</span>
                              )}
                            </div>
                          </>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Sticky footer */}
                <div className="flex gap-2 justify-end px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-3xl">
                  <button type="button" onClick={() => { setPermissionsEntry(null); setEditingPermissions(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
                    {(isOwnerSession || isAppAdminSession) && permissionsEntry.email !== normalizedEmail ? "Cancel" : "Close"}
                  </button>
                  {(isOwnerSession || isAppAdminSession) && permissionsEntry.email !== normalizedEmail && (
                    <button
                      type="button"
                      disabled={permissionsSaving}
                      onClick={async () => {
                        setPermissionsSaving(true);
                        try {
                          const res = await fetch(`${API_BASE_URL}/staff-access/permissions`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ actorEmail: normalizedEmail, targetEmail: permissionsEntry.email, permissions: editingPermissions })
                          });
                          const data = (await res.json()) as { ok?: boolean; error?: string };
                          if (!res.ok) throw new Error(data.error ?? "Failed to save");
                          setPermissionsEntry(null);
                          setEditingPermissions(null);
                        } catch (err) {
                          setStatus(err instanceof Error ? err.message : "Failed to save permissions");
                        } finally {
                          setPermissionsSaving(false);
                        }
                      }}
                      className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {permissionsSaving ? "Saving…" : "Save permissions"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeManagerView === "support_chat" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-3 rounded-full border border-slate-100 bg-white p-1 shadow-sm w-fit">
            <button
              type="button"
              onClick={() => setSupportSubTab("messages")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                supportSubTab === "messages"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Messages
            </button>
            <button
              type="button"
              onClick={() => {
                setSupportSubTab("feedbacks");
                void loadFeedbacks();
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                supportSubTab === "feedbacks"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Feedbacks
            </button>
          </div>

          {supportSubTab === "messages" ? (
            <ManagerSupportInbox operatorEmail={normalizedEmail} enabled={isStaffSession} />
          ) : supportSubTab === "feedbacks" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("residentFeedbacks")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("reviewNotesDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadFeedbacks()}
                  disabled={feedbackLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-6 space-y-3">
                {feedbackEntries.length ? (
                  feedbackEntries.map((entry) => (
                    <div key={entry.fileName} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-900">{entry.email}</div>
                          <div className="mt-1 text-sm text-slate-600">
                            {entry.page} | {entry.createdAt ? formatDateTime(entry.createdAt) : "Unknown time"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{entry.message || "-"}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    {feedbackLoading ? "Loading feedbacks..." : "No feedbacks yet."}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Maintenance Tickets</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Manage active malfunction and maintenance reports.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadMaintenanceTickets()}
                  disabled={maintenanceLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'reportedAt', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        Time {maintenanceSort.field === 'reportedAt' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'residentName', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        Resident {maintenanceSort.field === 'residentName' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'location', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        Location {maintenanceSort.field === 'location' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'device', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        Machine {maintenanceSort.field === 'device' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2">Issue</th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'status', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        Status {maintenanceSort.field === 'status' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sortedMaintenanceTickets.length ? (
                      sortedMaintenanceTickets.map((ticket) => (
                        <tr key={ticket.id} className="group hover:bg-slate-50 transition-colors">
                          <td className="py-4 px-2 whitespace-nowrap text-slate-500">
                            {formatDateTime(ticket.reportedAt)}
                          </td>
                          <td className="py-4 px-2">
                            <div className="font-medium text-slate-900">{ticket.residentName}</div>
                            <div className="text-[10px] text-slate-500">{ticket.residentEmail}</div>
                          </td>
                          <td className="py-4 px-2 font-medium text-slate-700">{ticket.location}</td>
                          <td className="py-4 px-2 text-slate-600 font-medium">{ticket.device || "-"}</td>
                          <td className="py-4 px-2 text-slate-600 max-w-xs truncate" title={ticket.issue}>{ticket.issue}</td>
                          <td className="py-4 px-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              ticket.status === 'REPORTED' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                            }`}>
                              {ticket.status}
                            </span>
                          </td>
                          <td className="py-4 px-2 text-right">
                            <button
                                onClick={() => resolveMaintenanceTicket(ticket.id)}
                                className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-all opacity-0 group-hover:opacity-100"
                            >
                                Resolve
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500 italic">
                          {maintenanceLoading ? "Loading tickets..." : "No active maintenance tickets."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      ) : null}


      {activeManagerView === "scheduling" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setSchedulingTab("cleaning")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                schedulingTab === "cleaning"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
            >
              Cleaning schedule
            </button>
            <button
              type="button"
              onClick={() => setSchedulingTab("laundry")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                schedulingTab === "laundry"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
            >
              Laundry schedule
            </button>
          </div>

          {schedulingTab === "cleaning" ? (
            <AdminCleaningClient />
          ) : (
            <LaundryScheduleManager actorEmail={normalizedEmail} />
          )}
        </section>
      ) : null}

      {activeManagerView === "controller" ? (
        <section className="space-y-6 pb-20">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Real-time Device Control</h2>
                <p className="mt-1 text-sm text-slate-500">Centralized override for all IoT devices across branches.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowControllerHistory((current) => !current)}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {showControllerHistory ? "Hide Controller History" : "View Controller History"}
                </button>
                <button 
                  onClick={() => void fetchDevices()} 
                  className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                  title="Refresh Status"
                >
                  <svg className={`h-5 w-5 ${controllerLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="space-y-8">
              {/* Branch D7 - AC Units */}
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="h-px w-8 bg-slate-200"></span>
                  Branch D7 - Air Conditioning
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {acRooms.filter(r => r.branchId === "D7").map(room => (
                    <div key={room.id} className="group relative rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:bg-white hover:shadow-md">
                      {(() => {
                        const actionKey = `ac:${room.id}`;
                        const pendingAction = controllerActionPending[actionKey];
                        const feedback = controllerActionFeedback[actionKey];
                        return (
                          <>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-slate-900">{room.label}</div>
                          <div className="text-[10px] text-slate-400 font-medium">IoT ID: {room.id}</div>
                        </div>
                        <div className={`h-2.5 w-2.5 rounded-full ${room.lastRequestedAction === "ON" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300"}`}></div>
                      </div>
                      
                      <div className="mt-4 flex gap-2">
                        <button 
                          onClick={() => handleAcControl(room.id, "ON")}
                          disabled={Boolean(pendingAction)}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "ON" ? "bg-emerald-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600"}`}
                        >
                          {pendingAction === "ON" ? "SENDING..." : "ON"}
                        </button>
                        <button 
                          onClick={() => handleAcControl(room.id, "OFF")}
                          disabled={Boolean(pendingAction)}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "OFF" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}
                        >
                          {pendingAction === "OFF" ? "SENDING..." : "OFF"}
                        </button>
                      </div>
                      {feedback ? (
                        <div className={`mt-3 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                          {feedback.message}
                        </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Branch D2 - AC Units */}
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="h-px w-8 bg-slate-200"></span>
                  Branch D2 - Air Conditioning
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {acRooms.filter(r => r.branchId === "D2").map(room => (
                    <div key={room.id} className="group relative rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:bg-white hover:shadow-md">
                      {(() => {
                        const actionKey = `ac:${room.id}`;
                        const pendingAction = controllerActionPending[actionKey];
                        const feedback = controllerActionFeedback[actionKey];
                        return (
                          <>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-slate-900">{room.label}</div>
                          <div className="text-[10px] text-slate-400 font-medium">IoT ID: {room.id}</div>
                        </div>
                        <div className={`h-2.5 w-2.5 rounded-full ${room.lastRequestedAction === "ON" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300"}`}></div>
                      </div>
                      
                      <div className="mt-4 flex gap-2">
                        <button 
                          onClick={() => handleAcControl(room.id, "ON")}
                          disabled={Boolean(pendingAction)}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "ON" ? "bg-emerald-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600"}`}
                        >
                          {pendingAction === "ON" ? "SENDING..." : "ON"}
                        </button>
                        <button 
                          onClick={() => handleAcControl(room.id, "OFF")}
                          disabled={Boolean(pendingAction)}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "OFF" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}
                        >
                          {pendingAction === "OFF" ? "SENDING..." : "OFF"}
                        </button>
                      </div>
                      {feedback ? (
                        <div className={`mt-3 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                          {feedback.message}
                        </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Other Smart Devices */}
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="h-px w-8 bg-slate-200"></span>
                  Smart Appliances & Laundry
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                   {/* Airfryers */}
                   {airfryers.map(af => (
                     <div key={af.id} className="rounded-2xl border border-amber-100 bg-amber-50/30 p-4">
                        {(() => {
                          const actionKey = `airfryer:${af.id}`;
                          const pendingAction = controllerActionPending[actionKey];
                          const feedback = controllerActionFeedback[actionKey];
                          return (
                            <>
                        <div className="font-bold text-amber-900">{af.label}</div>
                        <div className="text-[10px] text-amber-500 font-bold uppercase mt-0.5">Branch {af.branchId} Appliance</div>
                        <button 
                          onClick={() => handleMachineTrigger(af.id, "airfryer")}
                          disabled={Boolean(pendingAction)}
                          className="mt-4 w-full rounded-xl bg-amber-600 py-2.5 text-xs font-black text-white shadow-lg shadow-amber-200 hover:bg-amber-700 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {pendingAction ? "TRIGGERING..." : `TRIGGER ${af.label.toUpperCase()}`}
                        </button>
                        {feedback ? (
                          <div className={`mt-3 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                            {feedback.message}
                          </div>
                        ) : null}
                            </>
                          );
                        })()}
                     </div>
                   ))}

                   {/* Laundry Machines */}
                   {laundryMachines.map(machine => (
                    <div key={machine.id} className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                      {(() => {
                        const actionKey = `laundry:${machine.id}`;
                        const pendingAction = controllerActionPending[actionKey];
                        const feedback = controllerActionFeedback[actionKey];
                        return (
                          <>
                      <div className="font-bold text-sky-900">{machine.label}</div>
                      <div className="text-[10px] text-sky-400 font-bold uppercase mt-0.5">Branch {machine.branchId} Unit</div>
                      <button 
                        onClick={() => handleMachineTrigger(machine.id, "laundry")}
                        disabled={Boolean(pendingAction)}
                        className="mt-4 w-full rounded-xl bg-sky-600 py-2.5 text-xs font-black text-white shadow-lg shadow-sky-200 hover:bg-sky-700 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingAction ? "TRIGGERING..." : `TRIGGER ${machine.label.toUpperCase()}`}
                      </button>
                      {feedback ? (
                        <div className={`mt-3 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                          {feedback.message}
                        </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                   ))}
                </div>
              </div>
            </div>
          </section>

          {showControllerHistory ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Controller History</h2>
                  <p className="mt-1 text-sm text-slate-500">Recent AC, laundry, airfryer, and microwave actions across the app.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchControllerHistory()}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Refresh History
                </button>
              </div>

              {controllerHistoryLoading ? (
                <div className="mt-6 text-sm text-slate-500">Loading controller history...</div>
              ) : controllerHistory.length === 0 ? (
                <div className="mt-6 text-sm text-slate-500">No controller actions have been logged yet.</div>
              ) : (
                <div className="mt-6 space-y-3">
                  {controllerHistory.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-2 rounded-2xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-slate-900">{entry.deviceLabel}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {entry.branchId} · {entry.deviceType.toUpperCase()} · {entry.action} · {entry.actorRole === "manager" ? "Manager" : entry.actorName}
                        </div>
                        {entry.details ? (
                          <div className="mt-1 text-xs text-slate-400">{entry.details}</div>
                        ) : null}
                      </div>
                      <div className="text-sm font-medium text-slate-600">{formatDateTime(entry.timestamp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

        </section>
      ) : null}

      {/* Short-term booking confirm & import dialog */}
      {stConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Confirm & Import Booking</h3>
              <p className="mt-1 text-xs text-slate-500">{stConfirmDialog.booking.guestName} · {stConfirmDialog.booking.email}</p>
              <p className="text-xs text-slate-500">{stConfirmDialog.booking.checkIn} → {stConfirmDialog.booking.checkOut}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Branch</label>
                <div className="flex gap-2">
                  {(["D2", "D7"] as const).map((br) => (
                    <button key={br} type="button"
                      onClick={() => setStConfirmDialog({ ...stConfirmDialog, branch: br })}
                      className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${stConfirmDialog.branch === br ? "bg-sky-600 text-white border-sky-600" : "border-slate-300 text-slate-600"}`}
                    >{br}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bed number</label>
                <input
                  type="number" min={1}
                  value={stConfirmDialog.bed}
                  onChange={(e) => setStConfirmDialog({ ...stConfirmDialog, bed: e.target.value })}
                  className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                  placeholder="e.g. 5"
                />
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                This will create a portal account for the guest. Their initial password will be their phone number. They must change it on first login.
              </div>
              {stConfirmDialog.result && (
                <div className={`rounded-xl p-3 text-xs font-medium ${stConfirmDialog.result.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {stConfirmDialog.result}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-3xl">
              <button type="button"
                onClick={() => setStConfirmDialog(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
              >Cancel</button>
              <button type="button"
                disabled={stConfirmDialog.saving || !stConfirmDialog.bed}
                onClick={async () => {
                  setStConfirmDialog({ ...stConfirmDialog, saving: true, result: "" });
                  try {
                    const res = await fetch(`${API_BASE_URL}/manager/short-term/bookings/${encodeURIComponent(stConfirmDialog.booking.id)}/confirm`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ actorEmail: normalizedEmail, branch: stConfirmDialog.branch, bed: stConfirmDialog.bed })
                    });
                    const data = (await res.json()) as { ok?: boolean; error?: string; contractCode?: string; initialPassword?: string };
                    if (!res.ok) throw new Error(data.error ?? "Failed to import");
                    setStConfirmDialog({ ...stConfirmDialog, saving: false, result: `✓ Imported as ${data.contractCode ?? ""}. Initial password: ${data.initialPassword ?? "phone number"}` });
                    // Refresh pending bookings
                    setStPendingBookings(null);
                    void (async () => {
                      setStPendingLoading(true);
                      try {
                        const r = await fetch(`${API_BASE_URL}/manager/short-term/pending-bookings?actorEmail=${encodeURIComponent(normalizedEmail)}`);
                        const d = (await r.json()) as { bookings: StandaloneBooking[] };
                        setStPendingBookings(d.bookings ?? []);
                      } finally { setStPendingLoading(false); }
                    })();
                  } catch (err) {
                    setStConfirmDialog({ ...stConfirmDialog, saving: false, result: err instanceof Error ? err.message : "Failed to import" });
                  }
                }}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {stConfirmDialog.saving ? "Importing…" : "Confirm & Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add hostel guest dialog */}
      {stAddDialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Add hostel guest</h3>
              <p className="mt-1 text-xs text-slate-500">Manually add a guest from Booking.com, Airbnb, or direct booking.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Guest name</label>
                  <input type="text" value={stAddDialog.guestName} onChange={(e) => setStAddDialog({ ...stAddDialog, guestName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="Full name" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                  <input type="email" value={stAddDialog.email} onChange={(e) => setStAddDialog({ ...stAddDialog, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="guest@email.com" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
                  <input type="text" inputMode="tel" value={stAddDialog.phone} onChange={(e) => setStAddDialog({ ...stAddDialog, phone: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 0901234567" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Check-in</label>
                  <input type="date" value={stAddDialog.checkIn} onChange={(e) => setStAddDialog({ ...stAddDialog, checkIn: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out</label>
                  <input type="date" value={stAddDialog.checkOut} onChange={(e) => setStAddDialog({ ...stAddDialog, checkOut: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Branch</label>
                  <div className="flex gap-2">
                    {(["D2", "D7"] as const).map((br) => (
                      <button key={br} type="button" onClick={() => setStAddDialog({ ...stAddDialog, branch: br })}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${stAddDialog.branch === br ? "bg-sky-600 text-white border-sky-600" : "border-slate-300 text-slate-600"}`}
                      >{br}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Bed number</label>
                  <input type="number" min={1} value={stAddDialog.bed} onChange={(e) => setStAddDialog({ ...stAddDialog, bed: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 5" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Total price (₫)</label>
                  <input type="number" min={0} value={stAddDialog.totalAmount} onChange={(e) => setStAddDialog({ ...stAddDialog, totalAmount: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 1500000" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Payment</label>
                  <select value={stAddDialog.paymentStatus} onChange={(e) => setStAddDialog({ ...stAddDialog, paymentStatus: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none bg-white">
                    <option value="paid">Paid</option>
                    <option value="cash">Cash</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Source</label>
                  <select value={stAddDialog.source} onChange={(e) => setStAddDialog({ ...stAddDialog, source: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none bg-white">
                    <option value="direct">Direct</option>
                    <option value="booking.com">Booking.com</option>
                    <option value="airbnb">Airbnb</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notes (optional)</label>
                  <textarea value={stAddDialog.notes} onChange={(e) => setStAddDialog({ ...stAddDialog, notes: e.target.value })}
                    rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="Any extra info" />
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                A portal account will be created for the guest. Initial password = phone digits. They must change it on first login.
              </div>
              {stAddDialog.result && (
                <div className={`rounded-xl p-3 text-xs font-medium ${stAddDialog.result.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {stAddDialog.result}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
              <button type="button" onClick={() => setStAddDialog(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
              <button type="button"
                disabled={stAddDialog.saving || !stAddDialog.guestName || !stAddDialog.email || !stAddDialog.checkIn || !stAddDialog.checkOut || !stAddDialog.bed}
                onClick={async () => {
                  setStAddDialog({ ...stAddDialog, saving: true, result: "" });
                  try {
                    const res = await fetch(`${API_BASE_URL}/manager/short-term/bookings`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        actorEmail: normalizedEmail,
                        guestName: stAddDialog.guestName,
                        email: stAddDialog.email,
                        phone: stAddDialog.phone,
                        checkIn: stAddDialog.checkIn,
                        checkOut: stAddDialog.checkOut,
                        branch: stAddDialog.branch,
                        bed: stAddDialog.bed,
                        totalAmount: stAddDialog.totalAmount,
                        paymentStatus: stAddDialog.paymentStatus,
                        source: stAddDialog.source,
                        notes: stAddDialog.notes,
                      })
                    });
                    const data = (await res.json()) as { ok?: boolean; error?: string; contractCode?: string; initialPassword?: string };
                    if (!res.ok) throw new Error(data.error ?? "Failed");
                    setStAddDialog({ ...stAddDialog, saving: false, result: `✓ Added as ${data.contractCode ?? ""}. Initial password: ${data.initialPassword ?? "phone digits"}` });
                    setStGuests(null);
                  } catch (err) {
                    setStAddDialog({ ...stAddDialog, saving: false, result: err instanceof Error ? err.message : "Failed to add guest" });
                  }
                }}
                className="flex-1 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {stAddDialog.saving ? "Adding…" : "Add guest"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
