"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import {
  hasPrepaidBreakdownOverridesPayload,
  mergePrepaidEstimateWithOverrides,
  suggestedTotalFromEstimate,
  type PrepaidBreakdownOverridesPayload
} from "../lib/prepaid-breakdown-overrides";
import { formatBillingMonthLabel, type PrepaidNextPaymentEstimatePayload } from "../lib/rent-paid-status";
import { parseVietnamDate } from "../lib/contract-utils";
import { formatCozoroDate, formatCozoroDateTime } from "../lib/date-format";
import { AdminCleaningClient } from "./admin-cleaning-client";
import { ManagerAiChat } from "./manager-ai-chat";
import { ManagerSupportInbox } from "./manager-support-inbox";
import { LaundryScheduleManager } from "./laundry-schedule-manager";
import { usePortalLanguage } from "./portal-language";
import { PrepaidPackageBreakdownRows } from "./next-payment-summary";
import { usePortalSession } from "./portal-session";
import { usePortalTheme } from "./portal-theme";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InlineHelp } from "./inline-help";
import { ManagerSettingsTools } from "./manager-settings-tools";
import { ManagerResidentGuidesEditor } from "./manager-resident-guides-editor";


type StaffRole = "manager" | "owner" | "app_admin" | "mechanic";
type StatsTab = "laundry" | "coins" | "payments" | "fines";
type ClientAction =
  | "call"
  | "sms"
  | "email"
  | "message"
  | "fine"
  | "coins"
  | "payment"
  | "reminder"
  | "password"
  | "gateParking"
  | "remove"
  | "";
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

type ContractApprovalSummary = {
  id: string;
  type: "registration" | "extension";
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  clientSignatureTimestamp?: string;
  fullName: string;
  email: string;
  branchId: string;
  bedNumber: number | null;
  contractMonths: number | null;
  contractStartDate: string;
  contractEndDate: string;
  previousContractEndDate?: string;
  contractCode?: string;
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
  senderRole: "RESIDENT" | "MANAGER" | "OWNER" | "ASSISTANT";
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
  coinPayment?: { isPaid: boolean };
};
type DuplicateEntry = { email: string; name: string; rows: Array<{ maHd: string; rowNumber?: number; submissionTimestamp: string; contractStart: string; contractEnd: string; activeStay: string; bed: string; branch: string }> };
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
  forceLocked?: boolean;
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

type FineAttachment = {
  url: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  evidenceKind: "image" | "video";
};

type PricingSettingsSectionKey =
  | "parking_tiers"
  | "branch_fees"
  | "resident_portal"
  | "bed_prices"
  | "long_term_discounts"
  | "nightly_bed_prices"
  | "stay_discounts"
  | "staff_accounts";

type ManagerSettingsMainSection = "pricing" | "resident_guides" | "tools";
type PricingSettingsSubTab = "long_term" | "short_term" | "referral" | "staff";
type ClientSubTab = "list" | "details" | "analytics";
type OwnerAnalyticsTab = "payments" | "coins" | "laundry" | "fines" | "cleaning" | "airfryer";
type PaymentAnalyticsChartView = "bar" | "donut";
type PaymentAnalyticsDimension = "receiver" | "branch" | "category" | "bed" | "year" | "month";
type PaymentAnalyticsPathItem = { dimension: PaymentAnalyticsDimension; value: string };
type PaymentAnalyticsGroup = {
  key: string;
  label: string;
  total: number;
  count: number;
  rows: Record<string, string>[];
};
function CollapsibleSettingsSection({
  title,
  description,
  expanded,
  onToggle,
  children
}: {
  title: string;
  description: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-600/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <span className="shrink-0 text-xl text-slate-400 dark:text-slate-500" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-slate-100 p-6 dark:border-slate-600/80">{children}</div>
      ) : null}
    </div>
  );
}

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

const PAYMENT_ANALYTICS_DIMENSIONS: Array<{ key: PaymentAnalyticsDimension; label: string }> = [
  { key: "receiver", label: "dimReceiver" },
  { key: "branch", label: "dimBranch" },
  { key: "category", label: "dimCategory" },
  { key: "bed", label: "dimBed" },
  { key: "year", label: "dimYear" },
  { key: "month", label: "dimMonth" }
];

const MANAGER_FUNCTION_HELP = {
  contractStatus: "helpContractStatus",
  monthlyRent: "helpMonthlyRent",
  featureLock: "helpFeatureLock",
  clientActions: "helpClientActions"
};

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
  gateParkingFeeVnd: number;
  laundryFeeVnd: number;
  finesVnd: number;
  totalBeforeCoinsVnd: number;
  maxCoinUsageVnd: number;
  recommendedCoinUsage: number;
  recommendedCoinValueVnd: number;
  finalTotalVnd: number;
  coinRateVndPerCoin: number;
  currentCoinsBalance: number;
  details: {
    durationMonths: number;
    professionalStatus: string;
    workplace: string;
    memberTier: string;
    parkingCount: { motorbikes: number; bicycles: number };
    laundryCount: { free: number; coins: number; cash: number };
    unpaidFinesCount: number;
    billingPrevMonth: string;
  };
};

type GateParkingTicketRow = {
  id: string;
  residentEmail: string;
  periodMonth: string;
  amountVnd: number;
  sessionStartAt: string | null;
  durationHours: number | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  paidAt: string | null;
};

function gateParkingDefaultDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${mi}`;
}

function formatGateSessionDisplay(iso: string | null | undefined, lang: "en" | "vi"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function formatGateDurationHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** Manager gate parking ticket: default bill = duration × this rate (VND/hour); amount remains editable. */
const GATE_PARKING_VND_PER_HOUR = 5000;

function gateParkingSuggestedAmountVnd(durationHours: number): number {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return 0;
  return Math.round(durationHours * GATE_PARKING_VND_PER_HOUR);
}

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
    gateParkingFeeVnd: Number(input.gateParkingFeeVnd ?? 0),
    laundryFeeVnd: Number(input.laundryFeeVnd ?? 0),
    finesVnd: Number(input.finesVnd ?? 0),
    totalBeforeCoinsVnd: Number(input.totalBeforeCoinsVnd ?? 0),
    maxCoinUsageVnd: Number(input.maxCoinUsageVnd ?? 0),
    recommendedCoinUsage: Number(input.recommendedCoinUsage ?? 0),
    recommendedCoinValueVnd: Number(input.recommendedCoinValueVnd ?? 0),
    finalTotalVnd: Number(input.finalTotalVnd ?? 0),
    coinRateVndPerCoin: Number(input.coinRateVndPerCoin ?? 0),
    currentCoinsBalance: Number(input.currentCoinsBalance ?? 0),
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
      unpaidFinesCount: Number(input.details?.unpaidFinesCount ?? 0),
      billingPrevMonth: input.details?.billingPrevMonth ?? ""
    }
  };
}

function formatPercentInput(rate: number | null | undefined): string {
  return String(Math.round(Number(rate ?? 0) * 10000) / 100);
}

function isClientOnPrepaidPlan(row: Record<string, unknown> | undefined): boolean {
  const plan = String(row?.["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
  return plan.includes("03 tháng") || plan.includes("06 tháng");
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
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function formatDateInputValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
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

/** Same identity fields as staff delete/update — do not use Object.values(row).slice(0,4); key order is not stable. */
function makeWorkspaceStatsEntryKey(tab: Exclude<StatsTab, "laundry">, entry: { row: Record<string, string> }) {
  const row = entry.row;
  const ts = String(row["DẤU THỜI GIAN"] ?? row["ĐẤU THỜI GIAN"] ?? "").trim();
  if (tab === "fines") {
    return makeKey([(row.EMAIL ?? "").trim().toLowerCase(), ts, String(row["NỘI DUNG VI PHẠM"] ?? "").trim()]);
  }
  if (tab === "coins") {
    return makeKey([ts, String(row["Mã giao dịch"] ?? "").trim()]);
  }
  return makeKey([ts, String(row["SỐ TIỀN"] ?? "").trim(), String(row["MỤC ĐÍCH"] ?? "").trim()]);
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

/** Sheet header for "ĐÃ THANH TOÁN?" — keys vary slightly by export; match by normalized letters. */
function findFinePaidStatusColumnKey(row: Record<string, string>): string | null {
  return (
    Object.keys(row).find((key) => {
      const nk = normalizeLookupValue(key);
      return nk.includes("thanhtoan") || (nk.includes("thanh") && nk.includes("toan"));
    }) ?? null
  );
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

function getPaymentAnalyticsTimestamp(row: Record<string, string>) {
  return (
    String(row["DẤU THỜI GIAN"] ?? "").trim() ||
    String(row["ĐẤU THỜI GIAN"] ?? "").trim() ||
    findRowValue(row, ["dauthoigian"]) ||
    findRowValue(row, ["timestamp"])
  );
}

function getPaymentAnalyticsField(row: Record<string, string>, dimension: PaymentAnalyticsDimension) {
  if (dimension === "receiver") {
    return (
      String(row["NGƯỜI NHẬN TIỀN"] ?? "").trim() ||
      findRowValue(row, ["nguoinhantien"]) ||
      findRowValue(row, ["receiver"]) ||
      "Unknown"
    );
  }
  if (dimension === "branch") {
    return normalizeBranchLabel(
      String(row["Chi nhánh Dorm"] ?? row["CHI NHÁNH DORM"] ?? "").trim() ||
        findRowValue(row, ["chinhanh"]) ||
        findRowValue(row, ["branch"]) ||
        "Unknown"
    );
  }
  if (dimension === "category") {
    return (
      String(row["MỤC ĐÍCH"] ?? "").trim() ||
      findRowValue(row, ["mucdich"]) ||
      findRowValue(row, ["category"]) ||
      "Uncategorized"
    );
  }
  if (dimension === "bed") {
    return (
      String(row["Số giường"] ?? row.BED ?? "").trim() ||
      findRowValue(row, ["sogiuong"]) ||
      findRowValue(row, ["bed"]) ||
      "Unknown"
    );
  }

  const timestamp = getPaymentAnalyticsTimestamp(row);
  const parsed = parseLooseDate(timestamp);
  if (!parsed) {
    return "Unknown";
  }
  if (dimension === "year") {
    return String(parsed.getFullYear());
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function getPaymentAnalyticsAmount(row: Record<string, string>) {
  return parseLooseNumber(
    String(row["SỐ TIỀN"] ?? "").trim() ||
      findRowValue(row, ["sotien"]) ||
      findRowValue(row, ["amount"])
  );
}

function filterPaymentRowsByPath(rows: Record<string, string>[], path: PaymentAnalyticsPathItem[]) {
  return rows.filter((row) =>
    path.every((item) => getPaymentAnalyticsField(row, item.dimension) === item.value)
  );
}

function groupPaymentAnalyticsRows(rows: Record<string, string>[], dimension: PaymentAnalyticsDimension) {
  const groups = new Map<string, PaymentAnalyticsGroup>();
  rows.forEach((row) => {
    const label = getPaymentAnalyticsField(row, dimension);
    const amount = getPaymentAnalyticsAmount(row);
    const existing = groups.get(label);
    if (existing) {
      existing.total += amount;
      existing.count += 1;
      existing.rows.push(row);
      return;
    }
    groups.set(label, { key: `${dimension}:${label}`, label, total: amount, count: 1, rows: [row] });
  });
  return Array.from(groups.values()).sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function describePaymentAnalyticsDimension(dimension: PaymentAnalyticsDimension, t: (key: string) => string) {
  const labelKey = PAYMENT_ANALYTICS_DIMENSIONS.find((item) => item.key === dimension)?.label ?? dimension;
  return t(labelKey);
}

function translateAnalyticsValue(value: string, t: (key: string) => string) {
  if (value === "Unknown") return t("unknownLabel");
  if (value === "System") return t("systemLabel");
  if (value === "Uncategorized") return t("uncategorizedLabel");
  return value;
}

function translateCoinEvent(event: string, t: (key: string) => string) {
  if (!event) return "-";
  const key = `coinEvent_${event.trim().replace(/ /g, "_")}`;
  // @ts-ignore
  return t(key) === key ? event : t(key);
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
  { key: "clients",  label: "clientsTab",           hasWrite: true  },
  { key: "fines",    label: "finesTab",             hasWrite: true  },
  { key: "payments", label: "paymentsTab",          hasWrite: true  },
  { key: "cleaning", label: "cleaningTab",          hasWrite: true  },
  { key: "laundry",  label: "laundryTab",           hasWrite: true  },
  { key: "support",  label: "supportTab",           hasWrite: true  },
  { key: "coins",    label: "coinsTab",             hasWrite: true  },
  { key: "stats",    label: "statsTab",             hasWrite: false },
];
const KNOWN_BRANCHES = ["D2", "D7"];

type ShortTermConfig = {
  bedPricing: Record<string, Record<string, number>>;
  bedPricingByDate: Record<string, Record<string, Record<string, number>>>;
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

function PaymentAnalyticsDashboard({
  rows,
  loading,
  onRefresh,
  t
}: {
  rows: Record<string, string>[];
  loading: boolean;
  onRefresh: () => void;
  t: (key: string, params?: any) => string;
}) {
  const [chartView, setChartView] = useState<PaymentAnalyticsChartView>("bar");
  const [groupOrder, setGroupOrder] = useState<PaymentAnalyticsDimension[]>([
    "receiver",
    "branch",
    "category",
    "bed",
    "year",
    "month"
  ]);
  const [path, setPath] = useState<PaymentAnalyticsPathItem[]>([]);
  const [draggedDimension, setDraggedDimension] = useState<PaymentAnalyticsDimension | null>(null);

  const scopedRows = useMemo(() => filterPaymentRowsByPath(rows, path), [path, rows]);
  const nextDimension = groupOrder[path.length] ?? null;
  const groups = useMemo(
    () => (nextDimension ? groupPaymentAnalyticsRows(scopedRows, nextDimension) : []),
    [nextDimension, scopedRows]
  );
  const totalRevenue = useMemo(
    () => scopedRows.reduce((sum, row) => sum + getPaymentAnalyticsAmount(row), 0),
    [scopedRows]
  );
  const maxGroupTotal = Math.max(1, ...groups.map((group) => group.total));
  const finalRows = !nextDimension;
  const chartTotal = groups.reduce((sum, group) => sum + group.total, 0) || 1;
  let donutOffset = 0;
  const availableDimensions = PAYMENT_ANALYTICS_DIMENSIONS.filter(
    (dimension) => !groupOrder.includes(dimension.key)
  );

  function resetPathForOrderChange() {
    setPath([]);
  }

  function moveGroupDimension(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= groupOrder.length || to >= groupOrder.length) {
      return;
    }
    const next = [...groupOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroupOrder(next);
    resetPathForOrderChange();
  }

  function removeGroupDimension(dimension: PaymentAnalyticsDimension) {
    setGroupOrder((current) => current.filter((item) => item !== dimension));
    resetPathForOrderChange();
  }

  function addGroupDimension(dimension: PaymentAnalyticsDimension) {
    setGroupOrder((current) => (current.includes(dimension) ? current : [...current, dimension]));
    resetPathForOrderChange();
  }

  function handleGroupDragStart(dimension: PaymentAnalyticsDimension) {
    setDraggedDimension(dimension);
  }

  function handleGroupDrop(target: PaymentAnalyticsDimension) {
    if (!draggedDimension) {
      return;
    }
    moveGroupDimension(groupOrder.indexOf(draggedDimension), groupOrder.indexOf(target));
    setDraggedDimension(null);
  }

  function handleGroupClick(group: PaymentAnalyticsGroup) {
    if (!nextDimension) {
      return;
    }
    setPath((current) => [...current, { dimension: nextDimension, value: group.label }]);
  }

  function renderMoveIcon(direction: "up" | "down") {
    return direction === "up" ? (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M10 4 5.25 8.75h9.5L10 4Z" fill="currentColor" />
        <path d="M10 4v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M10 16 14.75 11.25h-9.5L10 16Z" fill="currentColor" />
        <path d="M10 4v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  function renderTrashIcon() {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M7 3.75h6M4.5 6h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7.25 6.25h5.5l-.45 9a1 1 0 0 1-1 .95H8.7a1 1 0 0 1-1-.95l-.45-9Z" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8.5 9v4.5M11.5 9v4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  const visibleFinalRows = finalRows ? scopedRows : [];

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("paymentAnalyticsTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("paymentAnalyticsDesc")}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
        >
          {loading ? t("refreshing") : t("refreshWithLabel", { label: t("analyticsPaymentsTab").toLowerCase() })}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("revenueInView")}</div>
          <div className="mt-2 text-xl font-semibold text-emerald-700">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("paymentEntries")}</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{formatNumber(scopedRows.length)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsCurrentGroup")}</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            {nextDimension ? describePaymentAnalyticsDimension(nextDimension, t) : t("analyticsEntries")}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{t("analyticsGroupOrder")}</div>
            <div className="mt-1 text-xs text-slate-500">{t("analyticsGroupOrderDesc")}</div>
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {(["bar", "donut"] as PaymentAnalyticsChartView[]).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setChartView(view)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  chartView === view ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {view === "bar" ? t("analyticsBarChart") : t("analyticsDonutChart")}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {groupOrder.map((dimension, index) => (
              <div
                key={dimension}
                draggable
                onDragStart={() => handleGroupDragStart(dimension)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleGroupDrop(dimension)}
                onDragEnd={() => setDraggedDimension(null)}
                className={`flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm transition ${
                  draggedDimension === dimension ? "border-sky-300 opacity-60" : "border-slate-200"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-500 active:cursor-grabbing">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {describePaymentAnalyticsDimension(dimension, t)}
                  </div>
                  <div className="text-xs text-slate-500">{t("analyticsDragToReorder")}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveGroupDimension(index, index - 1)}
                    disabled={index === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label={t("analyticsMoveUp", { label: describePaymentAnalyticsDimension(dimension, t) })}
                    title={t("analyticsMoveUp", { label: describePaymentAnalyticsDimension(dimension, t) })}
                  >
                    {renderMoveIcon("up")}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveGroupDimension(index, index + 1)}
                    disabled={index === groupOrder.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label={t("analyticsMoveDown", { label: describePaymentAnalyticsDimension(dimension, t) })}
                    title={t("analyticsMoveDown", { label: describePaymentAnalyticsDimension(dimension, t) })}
                  >
                    {renderMoveIcon("down")}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeGroupDimension(dimension)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    aria-label={t("analyticsRemoveDim", { label: describePaymentAnalyticsDimension(dimension, t) })}
                    title={t("analyticsRemoveDim", { label: describePaymentAnalyticsDimension(dimension, t) })}
                  >
                    {renderTrashIcon()}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {availableDimensions.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsAddGroup")}</span>
              {availableDimensions.map((dimension) => (
                <button
                  key={dimension.key}
                  type="button"
                  onClick={() => addGroupDimension(dimension.key)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                >
                  + {dimension.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setPath([])}
          className={`rounded-full border px-3 py-1.5 font-medium ${
            path.length ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-500"
          }`}
        >
          {t("analyticsAllReceipts")}
        </button>
        {path.map((item, index) => (
          <button
            key={`${item.dimension}:${item.value}:${index}`}
            type="button"
            onClick={() => setPath(path.slice(0, index + 1))}
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-sky-900 hover:bg-sky-100"
          >
            {describePaymentAnalyticsDimension(item.dimension, t)}: {translateAnalyticsValue(item.value, t)}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          {t("analyticsEmptyPayment")}
        </div>
      ) : finalRows ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">{t("paymentEntries")}</h3>
            <button
              type="button"
              onClick={() => setPath(path.slice(0, -1))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              {t("analyticsBackToChart")}
            </button>
          </div>
          <div className="max-h-[34rem] overflow-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {PAYMENT_COMPACT_COLUMNS.map((column) => (
                    <th key={column} className="whitespace-nowrap px-4 py-3 font-semibold">
                      {t(({
                        "Chi nhánh Dorm": "colBranch",
                        "DẤU THỜI GIAN": "colWhen",
                        "Địa chỉ email": "emailLabel",
                        "Số giường": "colBed",
                        "NGƯỜI NHẬN TIỀN": "dimReceiver",
                        "NGƯỜI ĐÓNG TIỀN": "dimActor",
                        "SỐ TIỀN": "colAmount",
                        "MỤC ĐÍCH": "colContent",
                        "MỤC ĐÍCH - GHI RÕ": "colDetails"
                      } as Record<string, string>)[column] ?? column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {visibleFinalRows.map((row, index) => (
                  <tr key={`${getPaymentAnalyticsTimestamp(row)}:${index}`} className="align-top">
                    {PAYMENT_COMPACT_COLUMNS.map((column) => {
                      const value = getPaymentRowValue(row, column);
                      return (
                        <td key={`${column}:${index}`} className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {column === "SỐ TIỀN" && value ? formatCurrency(parseLooseNumber(value)) : value || "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {chartView === "bar" ? (
            <div className="space-y-3">
              {groups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => handleGroupClick(group)}
                  className="group grid w-full grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-3 text-left"
                >
                  <span className="truncate text-sm font-medium text-slate-700" title={translateAnalyticsValue(group.label, t)}>{translateAnalyticsValue(group.label, t)}</span>
                  <span className="relative h-11 overflow-hidden rounded-xl bg-slate-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded-xl bg-sky-500 transition-all group-hover:bg-sky-600"
                      style={{ width: `${Math.max(4, (group.total / maxGroupTotal) * 100)}%` }}
                    />
                    <span className="relative z-10 flex h-full items-center justify-between gap-3 px-3 text-sm font-semibold text-slate-900">
                      <span>{formatCurrency(group.total)}</span>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-slate-700">{t("analyticsEntriesWithCount", { count: group.count })}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
              <svg viewBox="0 0 240 240" className="mx-auto h-72 w-72 max-w-full" role="img" aria-label={t("paymentRevenueDonutChart", "Payment revenue donut chart")}>
                <circle cx="120" cy="120" r="78" fill="none" stroke="#e2e8f0" strokeWidth="42" />
                {groups.map((group, index) => {
                  const circumference = 2 * Math.PI * 78;
                  const dash = (group.total / chartTotal) * circumference;
                  const segmentOffset = donutOffset;
                  donutOffset += dash;
                  return (
                    <circle
                      key={group.key}
                      cx="120"
                      cy="120"
                      r="78"
                      fill="none"
                      stroke={["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ef4444", "#14b8a6", "#64748b"][index % 7]}
                      strokeWidth="42"
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-segmentOffset}
                      transform="rotate(-90 120 120)"
                      className="cursor-pointer opacity-90 hover:opacity-100"
                      onClick={() => handleGroupClick(group)}
                    >
                      <title>{`${translateAnalyticsValue(group.label, t)}: ${formatCurrency(group.total)}`}</title>
                    </circle>
                  );
                })}
                <text x="120" y="112" textAnchor="middle" className="fill-slate-500 text-[12px] font-semibold">{t("revenueLabel")}</text>
                <text x="120" y="132" textAnchor="middle" className="fill-slate-900 text-[14px] font-bold">{formatNumber(totalRevenue)}</text>
              </svg>
              <div className="grid content-start gap-2 sm:grid-cols-2">
                {groups.map((group, index) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => handleGroupClick(group)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-sky-300 hover:bg-sky-50"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: ["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ef4444", "#14b8a6", "#64748b"][index % 7] }}
                      />
                      <span className="truncate text-sm font-semibold text-slate-900">{translateAnalyticsValue(group.label, t)}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-emerald-700">{formatCurrency(group.total)}</div>
                    <div className="text-xs text-slate-500">{t("analyticsPaymentsWithCount", { count: group.count })}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type AnalyticsDimensionDefinition = {
  key: string;
  label: string;
};

type AnalyticsPathItem = {
  dimension: string;
  value: string;
};

type AnalyticsTableColumn = {
  key: string;
  label: string;
  getValue: (row: Record<string, string>) => string;
};

type GroupedAnalyticsConfig = {
  title: string;
  description: string;
  rows: Record<string, string>[];
  loading: boolean;
  onRefresh: () => void;
  metricLabel: string;
  metricMode: "sum" | "count";
  dimensions: AnalyticsDimensionDefinition[];
  defaultOrder: string[];
  allLabel: string;
  emptyMessage: string;
  tableTitle: string;
  tableColumns: AnalyticsTableColumn[];
  getField: (row: Record<string, string>, dimension: string) => string;
  getMetricValue?: (row: Record<string, string>) => number;
  formatMetricValue?: (value: number) => string;
};

function GroupedAnalyticsDashboard({
  title,
  description,
  rows,
  loading,
  onRefresh,
  metricLabel,
  metricMode,
  dimensions,
  defaultOrder,
  allLabel,
  emptyMessage,
  tableTitle,
  tableColumns,
  getField,
  getMetricValue,
  formatMetricValue,
  t
}: GroupedAnalyticsConfig & { t: (key: string, params?: any) => string }) {
  const [chartView, setChartView] = useState<PaymentAnalyticsChartView>("bar");
  const [groupOrder, setGroupOrder] = useState<string[]>(defaultOrder);
  const [path, setPath] = useState<AnalyticsPathItem[]>([]);
  const [draggedDimension, setDraggedDimension] = useState<string | null>(null);
  const defaultOrderKey = defaultOrder.join("::");

  useEffect(() => {
    setGroupOrder(defaultOrder);
    setPath([]);
  }, [defaultOrderKey]);

  const scopedRows = useMemo(() => filterAnalyticsRowsByPath(rows, path, getField), [getField, path, rows]);
  const nextDimension = groupOrder[path.length] ?? null;
  const groups = useMemo(
    () => (nextDimension ? groupAnalyticsRows(scopedRows, nextDimension, getField, metricMode, getMetricValue) : []),
    [getField, getMetricValue, metricMode, nextDimension, scopedRows]
  );
  const totalMetric = useMemo(
    () =>
      scopedRows.reduce(
        (sum, row) => sum + (metricMode === "count" ? 1 : getMetricValue?.(row) ?? 0),
        0
      ),
    [getMetricValue, metricMode, scopedRows]
  );
  const maxGroupTotal = Math.max(1, ...groups.map((group) => group.total));
  const finalRows = !nextDimension;
  const chartTotal = groups.reduce((sum, group) => sum + group.total, 0) || 1;
  let donutOffset = 0;
  const availableDimensions = dimensions.filter((dimension) => !groupOrder.includes(dimension.key));
  const metricFormatter = formatMetricValue ?? ((value: number) => formatNumber(value));

  function resetPathForOrderChange() {
    setPath([]);
  }

  function moveGroupDimension(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= groupOrder.length || to >= groupOrder.length) {
      return;
    }
    const next = [...groupOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroupOrder(next);
    resetPathForOrderChange();
  }

  function removeGroupDimension(dimension: string) {
    setGroupOrder((current) => current.filter((item) => item !== dimension));
    resetPathForOrderChange();
  }

  function addGroupDimension(dimension: string) {
    setGroupOrder((current) => (current.includes(dimension) ? current : [...current, dimension]));
    resetPathForOrderChange();
  }

  function handleGroupDragStart(dimension: string) {
    setDraggedDimension(dimension);
  }

  function handleGroupDrop(target: string) {
    if (!draggedDimension) {
      return;
    }
    moveGroupDimension(groupOrder.indexOf(draggedDimension), groupOrder.indexOf(target));
    setDraggedDimension(null);
  }

  function handleGroupClick(group: PaymentAnalyticsGroup) {
    if (!nextDimension) {
      return;
    }
    setPath((current) => [...current, { dimension: nextDimension, value: group.label }]);
  }

  function renderMoveIcon(direction: "up" | "down") {
    return direction === "up" ? (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M10 4 5.25 8.75h9.5L10 4Z" fill="currentColor" />
        <path d="M10 4v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M10 16 14.75 11.25h-9.5L10 16Z" fill="currentColor" />
        <path d="M10 4v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  function renderTrashIcon() {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M7 3.75h6M4.5 6h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7.25 6.25h5.5l-.45 9a1 1 0 0 1-1 .95H8.7a1 1 0 0 1-1-.95l-.45-9Z" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8.5 9v4.5M11.5 9v4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  const visibleFinalRows = finalRows ? scopedRows : [];

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
        >
          {loading ? t("refreshing") : t("refreshWithLabel", { label: title.toLowerCase() })}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsMetricInView", { label: metricLabel })}</div>
          <div className="mt-2 text-xl font-semibold text-emerald-700">{metricFormatter(totalMetric)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsEntries")}</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{formatNumber(scopedRows.length)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsCurrentGroup")}</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            {nextDimension ? dimensions.find((item) => item.key === nextDimension)?.label ?? nextDimension : allLabel}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{t("analyticsGroupOrder")}</div>
            <div className="mt-1 text-xs text-slate-500">{t("analyticsGroupOrderDesc")}</div>
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {(["bar", "donut"] as PaymentAnalyticsChartView[]).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setChartView(view)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  chartView === view ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {view === "bar" ? t("analyticsBarChart") : t("analyticsDonutChart")}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {groupOrder.map((dimension, index) => (
              <div
                key={dimension}
                draggable
                onDragStart={() => handleGroupDragStart(dimension)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleGroupDrop(dimension)}
                onDragEnd={() => setDraggedDimension(null)}
                className={`flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm transition ${
                  draggedDimension === dimension ? "border-sky-300 opacity-60" : "border-slate-200"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-500 active:cursor-grabbing">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {dimensions.find((item) => item.key === dimension)?.label ?? dimension}
                  </div>
                  <div className="text-xs text-slate-500">{t("analyticsDragToReorder")}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveGroupDimension(index, index - 1)}
                    disabled={index === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label={t("analyticsMoveUp", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                    title={t("analyticsMoveUp", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                  >
                    {renderMoveIcon("up")}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveGroupDimension(index, index + 1)}
                    disabled={index === groupOrder.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label={t("analyticsMoveDown", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                    title={t("analyticsMoveDown", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                  >
                    {renderMoveIcon("down")}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeGroupDimension(dimension)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    aria-label={t("analyticsRemoveDim", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                    title={t("analyticsRemoveDim", { label: dimensions.find((item) => item.key === dimension)?.label ?? dimension })}
                  >
                    {renderTrashIcon()}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {availableDimensions.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analyticsAddGroup")}</span>
              {availableDimensions.map((dimension) => (
                <button
                  key={dimension.key}
                  type="button"
                  onClick={() => addGroupDimension(dimension.key)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                >
                  + {dimension.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setPath([])}
          className={`rounded-full border px-3 py-1.5 font-medium ${
            path.length ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-500"
          }`}
        >
          {allLabel}
        </button>
        {path.map((item, index) => (
          <button
            key={`${item.dimension}:${item.value}:${index}`}
            type="button"
            onClick={() => setPath(path.slice(0, index + 1))}
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-sky-900 hover:bg-sky-100"
          >
            {(dimensions.find((dimension) => dimension.key === item.dimension)?.label ?? item.dimension)}: {translateAnalyticsValue(item.value, t)}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          {emptyMessage}
        </div>
      ) : finalRows ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">{tableTitle}</h3>
            <button
              type="button"
              onClick={() => setPath(path.slice(0, -1))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              {t("analyticsBackToChart")}
            </button>
          </div>
          <div className="max-h-[34rem] overflow-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {tableColumns.map((column) => (
                    <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {visibleFinalRows.map((row, index) => (
                  <tr key={`${index}`} className="align-top">
                    {tableColumns.map((column) => (
                      <td key={`${column.key}:${index}`} className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {column.getValue(row) || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {chartView === "bar" ? (
            <div className="space-y-3">
              {groups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => handleGroupClick(group)}
                  className="group grid w-full grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-3 text-left"
                >
                  <span className="truncate text-sm font-medium text-slate-700" title={group.label}>{group.label}</span>
                  <span className="relative h-11 overflow-hidden rounded-xl bg-slate-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded-xl bg-sky-500 transition-all group-hover:bg-sky-600"
                      style={{ width: `${Math.max(4, (group.total / maxGroupTotal) * 100)}%` }}
                    />
                    <span className="relative z-10 flex h-full items-center justify-between gap-3 px-3 text-sm font-semibold text-slate-900">
                      <span>{metricFormatter(group.total)}</span>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-slate-700">{t("analyticsEntriesWithCount", { count: group.count })}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
              <svg viewBox="0 0 240 240" className="mx-auto h-72 w-72 max-w-full" role="img" aria-label={t("donutChartWithTitle", { title })}>
                <circle cx="120" cy="120" r="78" fill="none" stroke="#e2e8f0" strokeWidth="42" />
                {groups.map((group, index) => {
                  const circumference = 2 * Math.PI * 78;
                  const dash = (group.total / chartTotal) * circumference;
                  const segmentOffset = donutOffset;
                  donutOffset += dash;
                  return (
                    <circle
                      key={group.key}
                      cx="120"
                      cy="120"
                      r="78"
                      fill="none"
                      stroke={["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ef4444", "#14b8a6", "#64748b"][index % 7]}
                      strokeWidth="42"
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-segmentOffset}
                      transform="rotate(-90 120 120)"
                      className="cursor-pointer opacity-90 hover:opacity-100"
                      onClick={() => handleGroupClick(group)}
                    >
                      <title>{`${translateAnalyticsValue(group.label, t)}: ${metricFormatter(group.total)}`}</title>
                    </circle>
                  );
                })}
                <text x="120" y="112" textAnchor="middle" className="fill-slate-500 text-[12px] font-semibold">{metricLabel}</text>
                <text x="120" y="132" textAnchor="middle" className="fill-slate-900 text-[14px] font-bold">{metricFormatter(totalMetric)}</text>
              </svg>
              <div className="grid content-start gap-2 sm:grid-cols-2">
                {groups.map((group, index) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => handleGroupClick(group)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-sky-300 hover:bg-sky-50"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: ["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ef4444", "#14b8a6", "#64748b"][index % 7] }}
                      />
                      <span className="truncate text-sm font-semibold text-slate-900">{translateAnalyticsValue(group.label, t)}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-emerald-700">{metricFormatter(group.total)}</div>
                    <div className="text-xs text-slate-500">{t("analyticsEntriesWithCount", { count: group.count })}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function filterAnalyticsRowsByPath(
  rows: Record<string, string>[],
  path: AnalyticsPathItem[],
  getField: (row: Record<string, string>, dimension: string) => string
) {
  return rows.filter((row) => path.every((item) => getField(row, item.dimension) === item.value));
}

function groupAnalyticsRows(
  rows: Record<string, string>[],
  dimension: string,
  getField: (row: Record<string, string>, dimension: string) => string,
  metricMode: "sum" | "count",
  getMetricValue?: (row: Record<string, string>) => number
) {
  const groups = new Map<string, PaymentAnalyticsGroup>();
  rows.forEach((row) => {
    const label = getField(row, dimension);
    const total = metricMode === "count" ? 1 : getMetricValue?.(row) ?? 0;
    const existing = groups.get(label);
    if (existing) {
      existing.total += total;
      existing.count += 1;
      existing.rows.push(row);
      return;
    }
    groups.set(label, { key: `${dimension}:${label}`, label, total, count: 1, rows: [row] });
  });
  return Array.from(groups.values()).sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function summarizeOwnerCoins(rows: Record<string, string>[], t: (key: string) => string): StatSummaryItem[] {
  const deltas = rows.map((row) =>
    parseLooseNumber(findRowValue(row, ["coins"]) || row.COINS || row["COINS"])
  );
  const earned = deltas.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const spent = Math.abs(deltas.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const latest = [...rows]
    .map((row) => getPaymentAnalyticsTimestamp(row))
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  return [
    { label: t("coinEntries"), value: formatNumber(rows.length) },
    { label: t("coinsAdded"), value: formatNumber(earned), tone: earned > 0 ? "positive" : "default" },
    { label: t("coinsUsed"), value: formatNumber(spent), tone: spent > 0 ? "warning" : "default" },
    { label: t("latestActivity"), value: latest ? formatDateTime(latest) : t("noCoinHistoryYet") }
  ];
}

function summarizeOwnerFines(rows: Record<string, string>[], t: (key: string) => string): StatSummaryItem[] {
  const amounts = rows.map((row) =>
    parseLooseNumber(findRowValue(row, ["chiphi"]) || findRowValue(row, ["amount"]))
  );
  const unpaidCount = rows.filter((row) => {
    const status = (findRowValue(row, ["dathanhtoan"]) || findRowValue(row, ["status"]) || "").toLowerCase();
    return status ? !(status.includes("yes") || status.includes("paid") || status.includes("roi") || status.includes("rồi")) : true;
  }).length;
  const latest = [...rows]
    .map((row) => getPaymentAnalyticsTimestamp(row))
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  return [
    { label: t("fineEntries"), value: formatNumber(rows.length) },
    { label: t("unpaidFines"), value: formatNumber(unpaidCount), tone: unpaidCount > 0 ? "warning" : "default" },
    { label: t("totalFineValue"), value: formatCurrency(amounts.reduce((sum, value) => sum + value, 0)) },
    { label: t("latestFine"), value: latest ? formatDateTime(latest) : t("noFineHistoryYet") }
  ];
}

function summarizeControllerUsage(entries: ControllerHistoryEntry[], deviceType: ControllerHistoryEntry["deviceType"], t: (key: string) => string): StatSummaryItem[] {
  const scoped = entries.filter((entry) => entry.deviceType === deviceType);
  const branchCounts = new Map<string, number>();
  scoped.forEach((entry) => {
    branchCounts.set(entry.branchId, (branchCounts.get(entry.branchId) ?? 0) + 1);
  });
  const topBranch = [...branchCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";

  return [
    { label: t("usageCount"), value: formatNumber(scoped.length) },
    { label: t("branches"), value: formatNumber(branchCounts.size) },
    { label: t("topBranch"), value: topBranch || t("noBranchYet") },
    { label: t("latestUse"), value: scoped[0]?.timestamp ? formatDateTime(scoped[0].timestamp) : t("noUsageYet") }
  ];
}

function OwnerAnalyticsDashboard({
  paymentRows,
  normalizedEmail,
  paymentLoading,
  onRefreshPayments
}: {
  paymentRows: Record<string, string>[];
  normalizedEmail: string;
  paymentLoading: boolean;
  onRefreshPayments: () => void;
}) {
  const { t } = usePortalLanguage();
  const [activeTab, setActiveTab] = useState<OwnerAnalyticsTab>("payments");
  const [coinsRows, setCoinsRows] = useState<Record<string, string>[]>([]);
  const [coinsLoading, setCoinsLoading] = useState(false);
  const [coinsLoaded, setCoinsLoaded] = useState(false);
  const [coinsError, setCoinsError] = useState("");
  const [finesRows, setFinesRows] = useState<Record<string, string>[]>([]);
  const [finesLoading, setFinesLoading] = useState(false);
  const [finesLoaded, setFinesLoaded] = useState(false);
  const [finesError, setFinesError] = useState("");
  const [controllerHistory, setControllerHistory] = useState<ControllerHistoryEntry[]>([]);
  const [controllerHistoryLoading, setControllerHistoryLoading] = useState(false);
  const [controllerHistoryLoaded, setControllerHistoryLoaded] = useState(false);
  const [controllerHistoryError, setControllerHistoryError] = useState("");
  const [laundryHistory, setLaundryHistory] = useState<LaundryEntry[]>([]);
  const [laundryHistoryLoading, setLaundryHistoryLoading] = useState(false);
  const [laundryHistoryLoaded, setLaundryHistoryLoaded] = useState(false);
  const [laundryHistoryError, setLaundryHistoryError] = useState("");
  const [cleaningTasks, setCleaningTasks] = useState<Record<string, string>[]>([]);
  const [cleaningLoading, setCleaningLoading] = useState(false);
  const [cleaningLoaded, setCleaningLoaded] = useState(false);
  const [cleaningError, setCleaningError] = useState("");

  const tabItems: Array<{ key: OwnerAnalyticsTab; label: string }> = [
    { key: "payments", label: t("analyticsPaymentsTab") },
    { key: "coins", label: t("analyticsCoinsTab") },
    { key: "laundry", label: t("analyticsLaundryTab") },
    { key: "fines", label: t("analyticsFineTab") },
    { key: "cleaning", label: t("analyticsCleaningTab") },
    { key: "airfryer", label: t("analyticsAirfryerTab") }
  ];

  const activeTabLabel = tabItems.find((item) => item.key === activeTab)?.label ?? t("analyticsTab", "Analytics");

  const loadCachedRows = useCallback(
    async (
      kind: "coins" | "fines",
      setRows: (rows: Record<string, string>[]) => void,
      setLoading: (loading: boolean) => void,
      setLoaded: (loaded: boolean) => void,
      setError: (error: string) => void
    ) => {
      setLoading(true);
      setError("");
      try {
        let response = await fetch(`${API_BASE_URL}/${kind}/cache`);
        let data = (await response.json()) as PaymentCachePayload;
        if (!response.ok || !(data.rows ?? []).length) {
          await fetch(`${API_BASE_URL}/${kind}/sync`, { method: "POST" });
          response = await fetch(`${API_BASE_URL}/${kind}/cache`);
          data = (await response.json()) as PaymentCachePayload;
        }
        if (!response.ok) {
          throw new Error(data.error ?? t("requestFailed", "Request failed. Please try again."));
        }
        setRows(data.rows ?? []);
        setLoaded(true);
      } catch (error) {
        setRows([]);
        setLoaded(true);
        setError(error instanceof Error ? error.message : t("requestFailed", "Request failed. Please try again."));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const loadControllerHistory = useCallback(async () => {
    setControllerHistoryLoading(true);
    setControllerHistoryError("");
    try {
      const response = await fetch(`${API_BASE_URL}/manager/controller/history?limit=500`);
      const data = (await response.json()) as { entries?: ControllerHistoryEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load controller history");
      }
      setControllerHistory(data.entries ?? []);
      setControllerHistoryLoaded(true);
    } catch (error) {
      setControllerHistory([]);
      setControllerHistoryLoaded(true);
      setControllerHistoryError(error instanceof Error ? error.message : t("errLoadController"));
    } finally {
      setControllerHistoryLoading(false);
    }
  }, []);

  const loadLaundryHistory = useCallback(async () => {
    setLaundryHistoryLoading(true);
    setLaundryHistoryError("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/laundry-calendars`);
      const data = (await response.json()) as {
        calendars?: Array<{
          events?: LaundryEntry[];
          error?: string;
        }>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load laundry history");
      }
      const now = Date.now();
      const entries = (data.calendars ?? [])
        .flatMap((calendar) => calendar.events ?? [])
        .filter((entry) => entry.id && entry.start && new Date(entry.start).getTime() <= now)
        .sort((left, right) => new Date(right.start).getTime() - new Date(left.start).getTime());
      setLaundryHistory(entries);
      setLaundryHistoryLoaded(true);
    } catch (error) {
      setLaundryHistory([]);
      setLaundryHistoryLoaded(true);
      setLaundryHistoryError(error instanceof Error ? error.message : t("errLoadLaundry"));
    } finally {
      setLaundryHistoryLoading(false);
    }
  }, []);

  const loadCleaningTasks = useCallback(async () => {
    setCleaningLoading(true);
    setCleaningError("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks`);
      const data = (await response.json()) as {
        tasks?: Array<{
          id: string;
          userEmail: string;
          userName?: string | null;
          branchId: string;
          type: string;
          status: string;
          scheduledDate: string;
          rewardCoins?: number;
          completedAt?: string | null;
          completionNote?: string | null;
          completionPhoto?: string | null;
          audits?: Array<{ createdAt?: string }>;
          auditorNote?: string | null;
        }>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? t("errLoadCleaning"));
      }
      const tasks = (data.tasks ?? []).map((task) => ({
        __timestamp: String(task.scheduledDate ?? ""),
        __branch: normalizeBranchLabel(task.branchId),
        __status: String(task.status ?? ""),
        __task: String(task.type ?? ""),
        __resident: String(task.userName ?? task.userEmail ?? ""),
        __detail:
          String(task.completionNote ?? task.auditorNote ?? task.completionPhoto ?? "").trim() ||
          `${String(task.rewardCoins ?? 0)} coins`,
        __reward: String(task.rewardCoins ?? 0),
        __completedAt: String(task.completedAt ?? ""),
        __audits: String(task.audits?.length ?? 0)
      }));
      setCleaningTasks(tasks);
      setCleaningLoaded(true);
    } catch (error) {
      setCleaningTasks([]);
      setCleaningLoaded(true);
      setCleaningError(error instanceof Error ? error.message : "Unable to load cleaning tasks");
    } finally {
      setCleaningLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "coins" && !coinsLoaded && !coinsLoading) {
      void loadCachedRows("coins", setCoinsRows, setCoinsLoading, setCoinsLoaded, setCoinsError);
    }
    if (activeTab === "fines" && !finesLoaded && !finesLoading) {
      void loadCachedRows("fines", setFinesRows, setFinesLoading, setFinesLoaded, setFinesError);
    }
    if (activeTab === "laundry" && !laundryHistoryLoaded && !laundryHistoryLoading) {
      void loadLaundryHistory();
    }
    if (activeTab === "airfryer" && !controllerHistoryLoaded && !controllerHistoryLoading) {
      void loadControllerHistory();
    }
    if (activeTab === "cleaning" && !cleaningLoaded && !cleaningLoading) {
      void loadCleaningTasks();
    }
  }, [
    activeTab,
    cleaningLoading,
    cleaningLoaded,
    coinsLoaded,
    coinsLoading,
    controllerHistoryLoaded,
    controllerHistoryLoading,
    finesLoaded,
    finesLoading,
    loadCachedRows,
    loadCleaningTasks,
    loadControllerHistory,
    loadLaundryHistory,
    laundryHistoryLoaded,
    laundryHistoryLoading
  ]);

  const coinsSummary = useMemo(() => summarizeOwnerCoins(coinsRows, t), [coinsRows, t]);
  const finesSummary = useMemo(() => summarizeOwnerFines(finesRows, t), [finesRows, t]);
  const coinsAnalyticsRows = useMemo(
    () =>
      [...coinsRows]
        .map((row) => ({
          ...row,
          __timestamp: getPaymentAnalyticsTimestamp(row),
          __branch: normalizeBranchLabel(findRowValue(row, ["chinhanh"]) || row["Chi nhánh Dorm"] || ""),
          __actor: findRowValue(row, ["nguoithaotac"]) || row["Người thao tác"] || t("systemLabel"),
          __event: findRowValue(row, ["sukien"]) || row["Sự kiện"] || "-",
          __amount: String(findRowValue(row, ["coins"]) || row.COINS || row["COINS"] || "0")
        }))
        .sort((left, right) => new Date(right.__timestamp).getTime() - new Date(left.__timestamp).getTime()),
    [coinsRows]
  );

  const finesAnalyticsRows = useMemo(
    () =>
      [...finesRows]
        .map((row) => ({
          ...row,
          __timestamp: getPaymentAnalyticsTimestamp(row),
          __branch: normalizeBranchLabel(findRowValue(row, ["chinhanh"]) || row["Chi nhánh Dorm"] || ""),
          __status: findRowValue(row, ["dathanhtoan"]) || findRowValue(row, ["status"]) || "-",
          __content: findRowValue(row, ["noidungvipham"]) || findRowValue(row, ["content"]) || "-",
          __amount: String(findRowValue(row, ["chiphi"]) || findRowValue(row, ["amount"]) || "0"),
          __due: findRowValue(row, ["duedate"]) || row["Ngày đến hạn"] || "-"
        }))
        .sort((left, right) => new Date(right.__timestamp).getTime() - new Date(left.__timestamp).getTime()),
    [finesRows]
  );

  const controllerAnalyticsRows = useMemo(
    () =>
      controllerHistory.map((entry) => ({
        __timestamp: entry.timestamp,
        __device: entry.deviceLabel,
        __branch: entry.branchId,
        __actor: entry.actorName || entry.actorEmail || t("unknownLabel"),
        __details: entry.details ?? entry.action,
        __deviceType: entry.deviceType
      })),
    [controllerHistory]
  );

  const laundryAnalyticsRows = useMemo(
    () =>
      laundryHistory
        .map((entry) => ({
          __timestamp: entry.start,
          __device: entry.calendarSummary || entry.summary || t("unknownLabel"),
          __branch: normalizeBranchLabel(
            extractLaundryBranch(entry.description) || extractLaundryBranch(entry.calendarSummary) || ""
          ),
          __actor: extractLaundryEmail(entry.summary) || extractLaundryEmail(entry.description) || t("unknownLabel"),
          __details:
            extractLaundryField(entry.description, "Payment method") ||
            extractLaundryField(entry.description, "Coin cost") ||
            entry.description ||
            entry.location ||
            "-"
        }))
        .sort((left, right) => new Date(right.__timestamp).getTime() - new Date(left.__timestamp).getTime()),
    [laundryHistory]
  );

  const airfryerAnalyticsRows = useMemo(
    () => controllerAnalyticsRows.filter((row) => row.__deviceType === "airfryer"),
    [controllerAnalyticsRows]
  );

  const cleaningAnalyticsRows = useMemo(
    () =>
      [...cleaningTasks].sort(
        (left, right) => new Date(right.__timestamp).getTime() - new Date(left.__timestamp).getTime()
      ),
    [cleaningTasks]
  );

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("ownerAnalyticsTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("ownerAnalyticsDesc")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (activeTab === "payments") {
              onRefreshPayments();
            } else if (activeTab === "coins") {
              void loadCachedRows("coins", setCoinsRows, setCoinsLoading, setCoinsLoaded, setCoinsError);
            } else if (activeTab === "fines") {
              void loadCachedRows("fines", setFinesRows, setFinesLoading, setFinesLoaded, setFinesError);
            } else if (activeTab === "laundry") {
              void loadLaundryHistory();
            } else if (activeTab === "airfryer") {
              void loadControllerHistory();
            } else {
              void loadCleaningTasks();
            }
          }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("refreshWithLabel", { label: activeTabLabel.toLowerCase() })}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        {tabItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActiveTab(item.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === item.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activeTab === "payments" ? (
        <PaymentAnalyticsDashboard rows={paymentRows} loading={paymentLoading} onRefresh={onRefreshPayments} t={t} />
      ) : activeTab === "coins" ? (
        <GroupedAnalyticsDashboard
          title={t("coinAnalyticsTitle")}
          description={t("coinAnalyticsDesc")}
          rows={coinsAnalyticsRows}
          loading={coinsLoading}
          onRefresh={() => void loadCachedRows("coins", setCoinsRows, setCoinsLoading, setCoinsLoaded, setCoinsError)}
          metricLabel={t("analyticsCoinsTab")}
          metricMode="sum"
          dimensions={[
            { key: "actor", label: t("dimActor") },
            { key: "branch", label: t("dimBranch") },
            { key: "event", label: t("dimEvent") },
            { key: "year", label: t("dimYear") },
            { key: "month", label: t("dimMonth") }
          ]}
          defaultOrder={["actor", "branch", "event", "year", "month"]}
          allLabel={t("analyticsAllCoinEntries")}
          emptyMessage={coinsError || t("analyticsEmptyCoin")}
          tableTitle={t("analyticsAllCoinEntries")}
          tableColumns={[
            { key: "when", label: t("colWhen"), getValue: (row) => formatDateTime(row.__timestamp) },
            { key: "coin", label: t("colCoin"), getValue: (row) => row.__amount || t("noValueLabel") },
            { key: "event", label: t("colEvent"), getValue: (row) => translateCoinEvent(row.__event, t) },
            { key: "actor", label: t("colActor"), getValue: (row) => row.__actor || t("noValueLabel") },
            { key: "branch", label: t("colBranch"), getValue: (row) => row.__branch || t("noValueLabel") }
          ]}
          getField={(row, dimension) => {
            if (dimension === "actor") return row.__actor || t("unknownLabel");
            if (dimension === "branch") return row.__branch || t("unknownLabel");
            if (dimension === "event") return row.__event || t("unknownLabel");
            if (dimension === "year" || dimension === "month") {
              const parsed = getPaymentAnalyticsTimestamp(row);
              const date = new Date(parsed);
              if (Number.isNaN(date.getTime())) return t("unknownLabel");
              if (dimension === "year") return String(date.getFullYear());
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            return findRowValue(row, [dimension]) || t("unknownLabel");
          }}
          getMetricValue={(row) => parseLooseNumber(row.__amount)}
          formatMetricValue={(value) => formatNumber(value)}
          t={t}
        />
      ) : activeTab === "fines" ? (
        <GroupedAnalyticsDashboard
          title={t("fineAnalyticsTitle")}
          description={t("fineAnalyticsDesc")}
          rows={finesAnalyticsRows}
          loading={finesLoading}
          onRefresh={() => void loadCachedRows("fines", setFinesRows, setFinesLoading, setFinesLoaded, setFinesError)}
          metricLabel={t("fineAnalyticsTitle")}
          metricMode="sum"
          dimensions={[
            { key: "branch", label: t("dimBranch") },
            { key: "status", label: t("dimStatus") },
            { key: "content", label: t("dimContent") },
            { key: "year", label: t("dimYear") },
            { key: "month", label: t("dimMonth") }
          ]}
          defaultOrder={["branch", "status", "content", "year", "month"]}
          allLabel={t("analyticsAllFineEntries")}
          emptyMessage={finesError || t("analyticsEmptyFine")}
          tableTitle={t("analyticsAllFineEntries")}
          tableColumns={[
            { key: "when", label: t("colWhen"), getValue: (row) => formatDateTime(row.__timestamp) },
            { key: "amount", label: t("colAmount"), getValue: (row) => formatCurrency(parseLooseNumber(row.__amount)) },
            { key: "content", label: t("colContent"), getValue: (row) => row.__content || "-" },
            { key: "status", label: t("colStatus"), getValue: (row) => row.__status || "-" },
            { key: "branch", label: t("colBranch"), getValue: (row) => row.__branch || "-" },
            { key: "due", label: t("colDue"), getValue: (row) => row.__due || "-" }
          ]}
          getField={(row, dimension) => {
            if (dimension === "branch") return row.__branch || t("unknownLabel");
            if (dimension === "status") return row.__status || t("unknownLabel");
            if (dimension === "content") return row.__content || t("unknownLabel");
            if (dimension === "year" || dimension === "month") {
              const parsed = getPaymentAnalyticsTimestamp(row);
              const date = new Date(parsed);
              if (Number.isNaN(date.getTime())) return t("unknownLabel");
              if (dimension === "year") return String(date.getFullYear());
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            return findRowValue(row, [dimension]) || t("unknownLabel");
          }}
          getMetricValue={(row) => parseLooseNumber(row.__amount)}
          formatMetricValue={(value) => formatCurrency(value)}
          t={t}
        />
      ) : activeTab === "laundry" ? (
        <GroupedAnalyticsDashboard
          title={t("laundryAnalyticsTitle")}
          description={t("laundryAnalyticsDesc")}
          rows={laundryAnalyticsRows}
          loading={laundryHistoryLoading}
          onRefresh={() => void loadLaundryHistory()}
          metricLabel={t("analyticsAllLaundryUses")}
          metricMode="count"
          dimensions={[
            { key: "device", label: t("dimMachine") },
            { key: "branch", label: t("dimBranch") },
            { key: "actor", label: t("dimActor") },
            { key: "year", label: t("dimYear") },
            { key: "month", label: t("dimMonth") }
          ]}
          defaultOrder={["device", "branch", "actor", "year", "month"]}
          allLabel={t("analyticsAllLaundryUses")}
          emptyMessage={laundryHistoryError || t("analyticsEmptyLaundry")}
          tableTitle={t("analyticsAllLaundryUses")}
          tableColumns={[
            { key: "when", label: t("colWhen"), getValue: (row) => formatDateTime(row.__timestamp) },
            { key: "machine", label: t("colMachine"), getValue: (row) => row.__device || "-" },
            { key: "branch", label: t("colBranch"), getValue: (row) => row.__branch || "-" },
            { key: "actor", label: t("colActor"), getValue: (row) => row.__actor || "-" },
            { key: "details", label: t("colDetails"), getValue: (row) => row.__details || "-" }
          ]}
          getField={(row, dimension) => {
            if (dimension === "device") return row.__device || t("unknownLabel");
            if (dimension === "branch") return row.__branch || t("unknownLabel");
            if (dimension === "actor") return row.__actor || t("unknownLabel");
            if (dimension === "year" || dimension === "month") {
              const date = new Date(row.__timestamp);
              if (Number.isNaN(date.getTime())) return t("unknownLabel");
              if (dimension === "year") return String(date.getFullYear());
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            return row[dimension] || t("unknownLabel");
          }}
          getMetricValue={() => 1}
          formatMetricValue={(value) => formatNumber(value)}
          t={t}
        />
      ) : activeTab === "airfryer" ? (
        <GroupedAnalyticsDashboard
          title={t("airfryerAnalyticsTitle")}
          description={t("airfryerAnalyticsDesc")}
          rows={airfryerAnalyticsRows}
          loading={controllerHistoryLoading}
          onRefresh={() => void loadControllerHistory()}
          metricLabel={t("analyticsAllAirfryerUses")}
          metricMode="count"
          dimensions={[
            { key: "branch", label: t("dimBranch") },
            { key: "actor", label: t("dimActor") },
            { key: "year", label: t("dimYear") },
            { key: "month", label: t("dimMonth") }
          ]}
          defaultOrder={["branch", "actor", "year", "month"]}
          allLabel={t("analyticsAllAirfryerUses")}
          emptyMessage={controllerHistoryError || t("analyticsEmptyAirfryer")}
          tableTitle={t("analyticsAllAirfryerUses")}
          tableColumns={[
            { key: "when", label: t("colWhen"), getValue: (row) => formatDateTime(row.__timestamp) },
            { key: "device", label: t("colMachine"), getValue: (row) => row.__device || "-" },
            { key: "branch", label: t("colBranch"), getValue: (row) => row.__branch || "-" },
            { key: "actor", label: t("colActor"), getValue: (row) => row.__actor || "-" },
            { key: "details", label: t("colDetails"), getValue: (row) => row.__details || "-" }
          ]}
          getField={(row, dimension) => {
            if (dimension === "branch") return row.__branch || t("unknownLabel");
            if (dimension === "actor") return row.__actor || t("unknownLabel");
            if (dimension === "year" || dimension === "month") {
              const date = new Date(row.__timestamp);
              if (Number.isNaN(date.getTime())) return t("unknownLabel");
              if (dimension === "year") return String(date.getFullYear());
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            return row[dimension] || t("unknownLabel");
          }}
          getMetricValue={() => 1}
          formatMetricValue={(value) => formatNumber(value)}
          t={t}
        />
      ) : (
        <GroupedAnalyticsDashboard
          title={t("cleaningAnalyticsTitle")}
          description={t("cleaningAnalyticsDesc")}
          rows={cleaningAnalyticsRows}
          loading={cleaningLoading}
          onRefresh={() => void loadCleaningTasks()}
          metricLabel={t("analyticsCleaningTab")}
          metricMode="count"
          dimensions={[
            { key: "status", label: t("dimStatus") },
            { key: "branch", label: t("dimBranch") },
            { key: "task", label: t("dimTask") },
            { key: "year", label: t("dimYear") },
            { key: "month", label: t("dimMonth") }
          ]}
          defaultOrder={["status", "branch", "task", "year", "month"]}
          allLabel={t("analyticsAllCleaningItems")}
          emptyMessage={cleaningError || t("analyticsEmptyCleaning")}
          tableTitle={t("analyticsAllCleaningItems")}
          tableColumns={[
            { key: "when", label: t("colWhen"), getValue: (row) => formatDateTime(row.__timestamp) },
            { key: "status", label: t("colStatus"), getValue: (row) => row.__status || "-" },
            { key: "task", label: t("colTask"), getValue: (row) => row.__task || "-" },
            { key: "resident", label: t("colResident"), getValue: (row) => row.__resident || "-" },
            { key: "branch", label: t("colBranch"), getValue: (row) => row.__branch || "-" },
            { key: "detail", label: t("colDetail"), getValue: (row) => row.__detail || "-" }
          ]}
          getField={(row, dimension) => {
            if (dimension === "status") return row.__status || t("unknownLabel");
            if (dimension === "branch") return row.__branch || t("unknownLabel");
            if (dimension === "task") return row.__task || t("unknownLabel");
            if (dimension === "year" || dimension === "month") {
              const date = new Date(row.__timestamp);
              if (Number.isNaN(date.getTime())) return t("unknownLabel");
              if (dimension === "year") return String(date.getFullYear());
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            return row[dimension] || t("unknownLabel");
          }}
          getMetricValue={() => 1}
          formatMetricValue={(value) => formatNumber(value)}
          t={t}
        />
      )}
    </section>
  );
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

function extractLaundryEmail(value: string) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase() ?? null;
}

function extractLaundryBranch(value: string) {
  const match = value.match(/\bD\s*([27])\b/i);
  if (match?.[1] === "2") {
    return "D2";
  }
  if (match?.[1] === "7") {
    return "D7";
  }
  return null;
}

function extractLaundryField(value: string, label: string) {
  const match = value.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? null;
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

function fineFieldLabels(t: (key: string) => string) {
  return {
    dueDate: t("fineFieldDueDate"),
    eventDateTime: t("fineFieldEventDateTime"),
    eventDateTimeHint: t("fineFieldEventDateTimeHint"),
    location: t("fineFieldLocation"),
    content: t("fineFieldContent"),
    description: t("fineFieldDescription"),
    image: t("fineFieldEvidence"),
    amount: t("fineFieldAmount"),
    imagePlaceholder: t("fineFieldEvidencePlaceholder"),
    submit: t("fineFieldSubmit")
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

function getDriveFileIdFromUrl(url: string) {
  return (
    url.match(/\/file\/d\/([^/]+)/)?.[1] ??
    url.match(/[?&]id=([^&]+)/)?.[1] ??
    null
  );
}

function chatRoleLabel(role: ClientChatMessage["senderRole"]) {
  if (role === "OWNER") {
    return "Owner";
  }
  if (role === "MANAGER") {
    return "Staff";
  }
  if (role === "ASSISTANT") {
    return "Assistant";
  }
  return "Resident";
}

const DEFAULT_MANAGER_CLIENT_PANEL_SECTIONS: Record<
  "overview" | "paymentPlan" | "duplicates" | "stayStatus" | "contractTermination" | "billing",
  boolean
> = {
  overview: true,
  paymentPlan: false,
  duplicates: false,
  stayStatus: false,
  contractTermination: false,
  billing: false
};

function ManagerClientPanelCollapsible({
  title,
  right,
  open,
  onToggle,
  children
}: {
  title: string;
  right?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/90"
      >
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {right}
          <span className="text-sm text-slate-400 tabular-nums">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open ? <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">{children}</div> : null}
    </div>
  );
}

function buildPrepaidOwnerLinesDiff(
  engine: PrepaidNextPaymentEstimatePayload,
  lines: { packageNet: number; laundry: number; fines: number; gate: number }
): PrepaidBreakdownOverridesPayload {
  const out: PrepaidBreakdownOverridesPayload = {};
  if (lines.packageNet !== engine.packageRecurringSubtotalVnd) {
    out.packageRecurringSubtotalVnd = lines.packageNet;
  }
  if (lines.laundry !== engine.laundryFeeVnd) {
    out.laundryFeeVnd = lines.laundry;
  }
  if (lines.fines !== engine.finesVnd) {
    out.finesVnd = lines.fines;
  }
  if (lines.gate !== engine.gateParkingFeeVnd) {
    out.gateParkingFeeVnd = lines.gate;
  }
  return out;
}

export function ManagerClient({ initialView = "overview" }: { initialView?: ManagerView }) {

  const router = useRouter();
  const { language, setLanguage, t } = usePortalLanguage();
  const { theme, toggleTheme } = usePortalTheme();
  const { sessionEmail, sessionRole } = usePortalSession();
  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isStaffSession = Boolean(sessionRole && sessionRole !== "user" && normalizedEmail);
  const isOwnerSession = sessionRole === "owner";
  const isAppAdminSession = sessionRole === "app_admin";
  const canViewContractApprovals =
    sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin";
  const canReviewContractApprovals = sessionRole === "owner" || sessionRole === "app_admin";
  const canManageOwnersEmployees = isOwnerSession || isAppAdminSession;
  const canCreatePaymentReceipt =
    sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin";
  const canSendDepositRefundEmail =
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
  const [contractApprovals, setContractApprovals] = useState<ContractApprovalSummary[]>([]);
  const [contractApprovalsLoading, setContractApprovalsLoading] = useState(false);
  const [contractApprovalActionId, setContractApprovalActionId] = useState<string | null>(null);
  const [expandedContractApprovals, setExpandedContractApprovals] = useState<Record<string, boolean>>({});
  const [branchToolsOpen, setBranchToolsOpen] = useState(false);
  const [branchToolsTab, setBranchToolsTab] = useState<"manual_receipt" | "branch_broadcast" | "unpaid_reminder">("manual_receipt");
  const [manualReceiptName, setManualReceiptName] = useState("");
  const [manualReceiptEmail, setManualReceiptEmail] = useState("");
  const [manualReceiptPurpose, setManualReceiptPurpose] = useState("");
  const [manualReceiptAmount, setManualReceiptAmount] = useState("");
  const [manualReceiptDetails, setManualReceiptDetails] = useState("");
  const [manualReceiptReceiver, setManualReceiptReceiver] = useState("");
  const [manualReceiptMemberTier, setManualReceiptMemberTier] = useState("");
  const [manualReceiptCurrentCoins, setManualReceiptCurrentCoins] = useState("");
  const [manualReceiptDiscountAmount, setManualReceiptDiscountAmount] = useState("");
  const [manualReceiptDiscountCondition, setManualReceiptDiscountCondition] = useState("");
  const [manualReceiptContractCode, setManualReceiptContractCode] = useState("");
  const [manualReceiptBed, setManualReceiptBed] = useState("");
  const [branchBroadcastTitle, setBranchBroadcastTitle] = useState("CozoroHome Notice");
  const [branchBroadcastMessage, setBranchBroadcastMessage] = useState("");
  const [settingInactive, setSettingInactive] = useState<Record<string, boolean>>({});
  const [inactiveBranchFilter, setInactiveBranchFilter] = useState("");
  const [inactiveYearFilter, setInactiveYearFilter] = useState("");
  const [inactiveSearch, setInactiveSearch] = useState("");
  const [expandedInactiveEmail, setExpandedInactiveEmail] = useState<string | null>(null);
  const [expandedInactiveBed, setExpandedInactiveBed] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [isEditingClientProfile, setIsEditingClientProfile] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [finePaidSavingKey, setFinePaidSavingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>("laundry");
  const [rentPaidStatus, setRentPaidStatus] = useState<boolean | null>(null);
  const [rentCoinRedeemInfo, setRentCoinRedeemInfo] = useState<{
    coins: number;
    valueVnd: number;
    at: string | null;
  } | null>(null);
  const [rentPaidMonth, setRentPaidMonth] = useState("");
  const [rentPaidLoading, setRentPaidLoading] = useState(false);
  const [rentSectionCollapsed, setRentSectionCollapsed] = useState(true);
  const [clientPanelSections, setClientPanelSections] = useState(() => ({ ...DEFAULT_MANAGER_CLIENT_PANEL_SECTIONS }));
  const [prepaidPkgBreakdownOpen, setPrepaidPkgBreakdownOpen] = useState(false);
  const [infoRentBreakdown, setInfoRentBreakdown] = useState<RentBreakdown | null>(null);
  const [infoManagerDiscount, setInfoManagerDiscount] = useState("0");
  const [infoShortTermSurchargeRate, setInfoShortTermSurchargeRate] = useState("0");
  const [infoParkingFee, setInfoParkingFee] = useState("0");
  const [infoRentCalculating, setInfoRentCalculating] = useState(false);
  const [gateParkingTickets, setGateParkingTickets] = useState<GateParkingTicketRow[]>([]);
  const [gateTicketsLoading, setGateTicketsLoading] = useState(false);
  const [gateNewSessionStart, setGateNewSessionStart] = useState(() => gateParkingDefaultDatetimeLocal());
  const [gateNewDurationHours, setGateNewDurationHours] = useState("1");
  const [gateNewBillingMonthOverride, setGateNewBillingMonthOverride] = useState("");
  const [gateNewAmount, setGateNewAmount] = useState(() => String(gateParkingSuggestedAmountVnd(1)));
  const [gateNewNote, setGateNewNote] = useState("");
  const [prepaidPkgLoading, setPrepaidPkgLoading] = useState(false);
  const [prepaidPkgEngineEstimate, setPrepaidPkgEngineEstimate] = useState<PrepaidNextPaymentEstimatePayload | null>(null);
  const [prepaidPkgBilling, setPrepaidPkgBilling] = useState<{
    confirmed?: boolean;
    managerPackageTotalVnd?: number;
    managerNote?: string | null;
    lastAppNotifyAt?: string | null;
    lastEmailNotifyAt?: string | null;
    breakdownOverrides?: PrepaidBreakdownOverridesPayload | null;
  } | null>(null);
  /** Absolute amounts for owner-editable package lines (initialized from engine + saved overrides). */
  const [prepaidOwnerLineValues, setPrepaidOwnerLineValues] = useState<{
    packageNet: number;
    laundry: number;
    fines: number;
    gate: number;
  } | null>(null);
  const [prepaidPkgTotalInput, setPrepaidPkgTotalInput] = useState("");
  const [prepaidPkgNoteInput, setPrepaidPkgNoteInput] = useState("");
  const [prepaidPkgActionLoading, setPrepaidPkgActionLoading] = useState(false);
  const canEditPrepaidOwnerLines = isOwnerSession || isAppAdminSession;
  const prepaidDisplayEstimate = useMemo(() => {
    if (!prepaidPkgEngineEstimate) {
      return null;
    }
    const eng = prepaidPkgEngineEstimate;
    if (!prepaidOwnerLineValues) {
      return mergePrepaidEstimateWithOverrides(eng, (prepaidPkgBilling?.breakdownOverrides as PrepaidBreakdownOverridesPayload) ?? null);
    }
    return mergePrepaidEstimateWithOverrides(eng, buildPrepaidOwnerLinesDiff(eng, prepaidOwnerLineValues));
  }, [prepaidPkgEngineEstimate, prepaidOwnerLineValues, prepaidPkgBilling?.breakdownOverrides]);
  const [monthlyRentPaidByEmail, setMonthlyRentPaidByEmail] = useState<Record<string, boolean>>({});
  const [monthlyRentPaidMapLoaded, setMonthlyRentPaidMapLoaded] = useState(false);
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
  const [fineEventAt, setFineEventAt] = useState("");
  const [fineAttachments, setFineAttachments] = useState<FineAttachment[]>([]);
  const [fineAttachmentUploading, setFineAttachmentUploading] = useState(false);
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
  const [stPricingDate, setStPricingDate] = useState<string>(() => formatDateInputValue(new Date()));
  const [stEditBedPricing, setStEditBedPricing] = useState<Record<string, number>>({});
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
    enabled: boolean;
    firstContractOnly?: boolean;
    updatedBy: string; updatedAt: string;
  };
  type BranchPricingSettings = {
    branchId: string; cleaningOptOutFeeVnd: number; parkingFeeVnd: number; updatedBy: string; updatedAt: string;
  };
  type BedParkingFeeOverride = {
    id: number; branchId: string; bedNumber: number; parkingFeeVnd: number; updatedBy: string; updatedAt: string;
  };
  type ParkingPricingTierRow = {
    id: string;
    branchId: string;
    labelEn: string;
    labelVi: string;
    feeVnd: number;
    sortOrder: number;
    active: boolean;
    updatedBy: string;
    updatedAt: string;
    createdAt: string;
  };
  const [pricingData, setPricingData] = useState<{
    bedOverrides: PricingBedOverride[];
    discounts: PricingDiscount[];
    branchSettings: BranchPricingSettings[];
    parkingOverrides: BedParkingFeeOverride[];
    parkingTiers: ParkingPricingTierRow[];
  } | null>(null);
  const [pricingConfigLoading, setPricingConfigLoading] = useState(false);
  const [referralProgramDraft, setReferralProgramDraft] = useState<{
    enabled: boolean;
    fullOfferContractMonths: string;
    newRegistrantDiscountVnd: string;
    newRegistrantCoins: string;
    referrerCoins: string;
    headlineEn: string;
    headlineVi: string;
    detailsEn: string;
    detailsVi: string;
    hostelEnabled: boolean;
    hostelNewRegistrantDiscountVnd: string;
    hostelNewRegistrantCoins: string;
    hostelReferrerCoins: string;
    hostelHeadlineEn: string;
    hostelHeadlineVi: string;
    hostelDetailsEn: string;
    hostelDetailsVi: string;
  } | null>(null);
  const [referralProgramLoading, setReferralProgramLoading] = useState(false);
  const [referralProgramSaving, setReferralProgramSaving] = useState(false);
  const [referralProgramMessage, setReferralProgramMessage] = useState("");
  const [managerSettingsMainSection, setManagerSettingsMainSection] = useState<ManagerSettingsMainSection>("pricing");
  const [pricingSettingsTab, setPricingSettingsTab] = useState<PricingSettingsSubTab>("long_term");
  const [bedPricingExpanded, setBedPricingExpanded] = useState(false);
  const [pricingSettingsExpanded, setPricingSettingsExpanded] = useState<Record<PricingSettingsSectionKey, boolean>>({
    parking_tiers: false,
    branch_fees: false,
    resident_portal: false,
    bed_prices: false,
    long_term_discounts: false,
    nightly_bed_prices: false,
    stay_discounts: false,
    staff_accounts: false
  });
  const [branchSettingsEdit, setBranchSettingsEdit] = useState<{
    branchId: string; cleaningOptOutFeeVnd: string; parkingFeeVnd: string; saving: boolean; result: string;
  } | null>(null);
  const [parkingBedEdit, setParkingBedEdit] = useState<{
    branchId: string; bedNumber: string; parkingFeeVnd: string; saving: boolean; result: string;
  } | null>(null);
  const [parkingAddDraft, setParkingAddDraft] = useState<Record<"D2" | "D7", { labelEn: string; labelVi: string; feeVnd: string; sortOrder: string }>>({
    D2: { labelEn: "", labelVi: "", feeVnd: "0", sortOrder: "0" },
    D7: { labelEn: "", labelVi: "", feeVnd: "0", sortOrder: "0" }
  });
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
    enabled: boolean;
    firstContractOnly: boolean;
    saving: boolean; result: string;
  } | null>(null);
  const [terminateDialog, setTerminateDialog] = useState(false);
  const [terminateNote, setTerminateNote] = useState("");
  const [terminateLoading, setTerminateLoading] = useState(false);
  const [depositRefundOpen, setDepositRefundOpen] = useState(false);
  const [depositRefundPreview, setDepositRefundPreview] = useState<{
    eligibilityReason: string;
    clientEmail: string;
    clientName: string;
    maHd: string;
    depositVnd: number;
    unpaidFinesVnd: number;
    unpaidGateVnd: number;
    suggestedRefundVnd: number;
  } | null>(null);
  const [depositRefundLoading, setDepositRefundLoading] = useState(false);
  const [depositRefundSending, setDepositRefundSending] = useState(false);
  const [depositRefundInput, setDepositRefundInput] = useState("");
  const [depositRefundModalError, setDepositRefundModalError] = useState("");
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
  const [clientActionMenuOpen, setClientActionMenuOpen] = useState(false);
  const clientToolsMenuRef = useRef<HTMLDivElement | null>(null);
  const [paymentReminderTitle, setPaymentReminderTitle] = useState("Nhắc thanh toán tiền phòng");
  const [paymentReminderBody, setPaymentReminderBody] = useState(
    "Chào bạn, hiện hệ thống ghi nhận kỳ thanh toán này chưa hoàn tất. Vui lòng thanh toán sớm để tránh gián đoạn tính năng; email sẽ kèm tổng tiền, chi tiết các khoản và hạn thanh toán."
  );
  const [sendReminderPopup, setSendReminderPopup] = useState(true);
  const [sendReminderInApp, setSendReminderInApp] = useState(true);
  const [sendReminderEmail, setSendReminderEmail] = useState(true);
  const [sendReminderEnglishCopy, setSendReminderEnglishCopy] = useState(false);
  const [unpaidReminderMode, setUnpaidReminderMode] = useState<"all_unpaid" | "selected">("all_unpaid");
  const [selectedUnpaidReminderEmails, setSelectedUnpaidReminderEmails] = useState<string[]>([]);
  const [showAllStatsEntries, setShowAllStatsEntries] = useState(false);
  const [showClientDetails, setShowClientDetails] = useState(false);
  const [activeManagerView, setActiveManagerView] = useState<ManagerView>(initialView);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [portalUxBlockingRent, setPortalUxBlockingRent] = useState(false);
  const [portalUxSaving, setPortalUxSaving] = useState(false);
  const [portalUxMessage, setPortalUxMessage] = useState("");

  const togglePricingSettingsSection = useCallback((section: PricingSettingsSectionKey) => {
    setPricingSettingsExpanded((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }, []);

  useEffect(() => {
    if (!pricingSettingsExpanded.resident_portal || !normalizedEmail) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/manager/portal-ux-settings?actorEmail=${encodeURIComponent(normalizedEmail)}`
        );
        const data = (await res.json()) as { blockingRentDuePopupEnabled?: boolean; error?: string };
        if (cancelled || !res.ok) {
          return;
        }
        setPortalUxBlockingRent(Boolean(data.blockingRentDuePopupEnabled));
        setPortalUxMessage("");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pricingSettingsExpanded.resident_portal, normalizedEmail]);

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
  /** Long-term diagram: quick sheet after tapping an occupied bed */
  const [diagramBedQuickSheet, setDiagramBedQuickSheet] = useState<{
    client: ManagerClientRecord;
    bedNumber: string;
  } | null>(null);
  const managerClientWorkspaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!diagramBedQuickSheet) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDiagramBedQuickSheet(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diagramBedQuickSheet]);
  const [supportFilterBranch, setSupportFilterBranch] = useState("");
  const [supportSortBy, setSupportSortBy] = useState<"newest" | "oldest_unanswered">("newest");
  const [acRooms, setAcRooms] = useState<any[]>([]);
  const [laundryMachines, setLaundryMachines] = useState<any[]>([]);
  const [airfryers, setAirfryers] = useState<SmartDevice[]>([]);
  const [microwaves, setMicrowaves] = useState<SmartDevice[]>([]);
  const [controllerLoading, setControllerLoading] = useState(false);
  const [controllerGroupCollapsed, setControllerGroupCollapsed] = useState<Record<string, boolean>>({});
  const [showControllerHistory, setShowControllerHistory] = useState(false);
  const [controllerHistoryLoading, setControllerHistoryLoading] = useState(false);
  const [controllerHistory, setControllerHistory] = useState<ControllerHistoryEntry[]>([]);
  const [controllerActionPending, setControllerActionPending] = useState<Record<string, string>>({});
  const [controllerActionFeedback, setControllerActionFeedback] = useState<Record<string, { tone: "success" | "error"; message: string }>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [supportSubTab, setSupportSubTab] = useState<"messages" | "feedbacks" | "maintenance" | "assistant">("messages");
  const [clientSubTab, setClientSubTab] = useState<ClientSubTab>("list");
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

  const loadMaintenanceTickets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setMaintenanceLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/staff/maintenance/tickets`);
      if (!response.ok) throw new Error("Failed to load maintenance tickets");
      const data = await response.json();
      const activeOnly = (data.tickets || []).filter(
        (t: MaintenanceTicket) => t.status === "REPORTED" || t.status === "ASSIGNED"
      );
      setMaintenanceTickets(activeOnly);
    } catch (err) {
      console.error(err);
    } finally {
      if (!opts?.silent) setMaintenanceLoading(false);
    }
  }, []);

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

  /** Open REPORTED + ASSIGNED tickets (same filter as the maintenance table). */
  const unsolvedMaintenanceTicketCount = maintenanceTickets.length;

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

  const showUnpaidRentMarker = useCallback(
    (client: ManagerClientRecord | null | undefined) => {
      if (!client || !monthlyRentPaidMapLoaded) return false;
      if (String(client.activeStay ?? "").trim() !== "1") return false;
      if (isClientOnPrepaidPlan(client.row)) return false;
      return monthlyRentPaidByEmail[client.email.trim().toLowerCase()] !== true;
    },
    [monthlyRentPaidByEmail, monthlyRentPaidMapLoaded]
  );

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
  const selectedClientContractApprovals = useMemo(() => {
    const selectedEmail = selectedClient?.email?.trim().toLowerCase();
    if (!selectedEmail) return [];
    return contractApprovals.filter((item) => item.email.trim().toLowerCase() === selectedEmail);
  }, [contractApprovals, selectedClient?.email]);
  const fineLabels = fineFieldLabels(t);
  const fineUiText = {
    suggestionPlaceholder: t("suggestionPlaceholder", "Search previous entries or type a new value"),
    uploadHint: t("fineEvidenceUploadHint"),
    uploading: t("fineEvidenceUploading"),
    uploaded: t("fineEvidenceUploadedDrive"),
    removeImage: t("removeFineEvidence")
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
  const manualReceiptReceiverSuggestions = useMemo(() => {
    const receivers =
      paymentPurposeRows
        .map(
          (row) =>
            String(
              (
                row["NGƯỜI NHẬN TIỀN"] ??
                row["NGUOI NHAN TIEN"] ??
                row["Người nhận tiền"] ??
                row["receiver"] ??
                findRowValue(row, ["nguoinhantien", "receiver"])
              ) || ""
            ).trim()
        )
        .filter(Boolean) ?? [];

    return Array.from(new Set(receivers)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [paymentPurposeRows]);
  const unpaidReminderCandidates = useMemo(
    () =>
      filteredClients.filter(
        (row) =>
          showUnpaidRentMarker(row) &&
          (!selectedBranch || normalizeBranchLabel(row.branch) === selectedBranch)
      ),
    [filteredClients, selectedBranch, monthlyRentPaidByEmail]
  );
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

  const showDepositRefundButton = useMemo(() => {
    if (!selectedClient || !canSendDepositRefundEmail) return false;
    const stay = String(selectedClient.activeStay ?? "").trim();
    if (stay !== "1") return true;
    if (terminationStatus && terminationStatus !== "loading") return true;
    const end = parseLooseDate(selectedClient.row?.["Ngày hết hạn hợp đồng"]);
    if (!end) return false;
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return days <= 7;
  }, [canSendDepositRefundEmail, selectedClient, terminationStatus]);

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

  async function refreshMonthlyRentPaidMap(forMonth?: string) {
    if (!isStaffSession || !normalizedEmail) {
      return;
    }
    const month =
      forMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    setMonthlyRentPaidMapLoaded(false);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/monthly-rent-paid-map?actorEmail=${encodeURIComponent(normalizedEmail)}&month=${encodeURIComponent(month)}`
      );
      const data = (await res.json()) as { byEmail?: Record<string, { isPaid: boolean }>; error?: string };
      if (!res.ok) {
        setMonthlyRentPaidByEmail({});
        return;
      }
      const map: Record<string, boolean> = {};
      for (const [em, row] of Object.entries(data.byEmail ?? {})) {
        map[em.trim().toLowerCase()] = row.isPaid === true;
      }
      setMonthlyRentPaidByEmail(map);
    } catch {
      setMonthlyRentPaidByEmail({});
    } finally {
      setMonthlyRentPaidMapLoaded(true);
    }
  }

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
      void refreshMonthlyRentPaidMap();
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

  async function loadContractApprovals() {
    if (!canViewContractApprovals) return;
    setContractApprovalsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/manager/contract-approvals?actorEmail=${encodeURIComponent(normalizedEmail)}`);
      const data = (await res.json()) as { approvals?: ContractApprovalSummary[] };
      setContractApprovals(data.approvals ?? []);
    } catch {
      setContractApprovals([]);
    } finally {
      setContractApprovalsLoading(false);
    }
  }

  async function reviewContractApproval(id: string, decision: "approve" | "reject") {
    setContractApprovalActionId(id);
    setStatus("");
    try {
      const res = await fetch(`${API_BASE_URL}/manager/contract-approvals/${encodeURIComponent(id)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? "Unable to review contract.");
        return;
      }
      setStatus(decision === "approve" ? "Contract approved and sent for email generation." : "Contract rejected.");
      await loadContractApprovals();
      await loadClients(true);
    } catch {
      setStatus("Unable to review contract.");
    } finally {
      setContractApprovalActionId(null);
    }
  }

  function toggleContractApprovalDetails(id: string) {
    setExpandedContractApprovals((current) => ({
      ...current,
      [id]: !current[id]
    }));
  }

  function openBranchToolsModal(tab: "manual_receipt" | "branch_broadcast") {
    const resolvedBranch =
      selectedBranch === "D2" || selectedBranch === "D7"
        ? selectedBranch
        : selectedClient
          ? normalizeBranchLabel(selectedClient.branch)
          : "D2";
    setSelectedBranch(resolvedBranch === "D7" ? "D7" : "D2");
    setBranchToolsTab(tab);
    setBranchToolsOpen(true);
    if (!manualReceiptPurpose) setManualReceiptPurpose("Rent");
  }

  async function submitManualReceiptForNewClient() {
    if (selectedBranch !== "D2" && selectedBranch !== "D7") {
      setStatus("Please select D2 or D7 first.");
      return;
    }
    if (!manualReceiptName.trim() || !manualReceiptEmail.trim() || !manualReceiptPurpose.trim() || !Number(manualReceiptAmount)) {
      setStatus("Name, email, purpose, and amount are required.");
      return;
    }
    await postJson(
      `${API_BASE_URL}/manager/payments/create-manual`,
      {
        actorEmail: normalizedEmail,
        fullName: manualReceiptName.trim(),
        recipientEmail: manualReceiptEmail.trim(),
        purpose: manualReceiptPurpose.trim(),
        amount: Number(manualReceiptAmount),
        details: manualReceiptDetails.trim() || undefined,
        payer: manualReceiptName.trim(),
        receiver: manualReceiptReceiver.trim() || undefined,
        memberTier: manualReceiptMemberTier.trim() || undefined,
        currentCoins: manualReceiptCurrentCoins.trim() || undefined,
        discountAmount: manualReceiptDiscountAmount.trim() ? Number(manualReceiptDiscountAmount) : undefined,
        discountCondition: manualReceiptDiscountCondition.trim() || undefined,
        branch: selectedBranch,
        contractCode: manualReceiptContractCode.trim() || undefined,
        bed: manualReceiptBed.trim() || undefined
      },
      "Manual receipt created successfully.",
      async () => {
        await loadPaymentPurposeRows();
        setManualReceiptName("");
        setManualReceiptEmail("");
        setManualReceiptPurpose("Rent");
        setManualReceiptAmount("");
        setManualReceiptDetails("");
        setManualReceiptContractCode("");
        setManualReceiptBed("");
      }
    );
  }

  async function submitBranchBroadcast() {
    if (selectedBranch !== "D2" && selectedBranch !== "D7") {
      setStatus("Please select D2 or D7 first.");
      return;
    }
    if (!branchBroadcastTitle.trim() || !branchBroadcastMessage.trim()) {
      setStatus("Broadcast title and message are required.");
      return;
    }
    await postJson(
      `${API_BASE_URL}/manager/branch-broadcast`,
      {
        actorEmail: normalizedEmail,
        branch: selectedBranch,
        title: branchBroadcastTitle.trim(),
        body: branchBroadcastMessage.trim()
      },
      `Broadcast sent to ${selectedBranch}. Push + first-open prompt queued.`,
      async () => {
        setBranchBroadcastMessage("");
      }
    );
  }

  async function markContractInactive(args: { maHd: string; rowNumber?: number; email?: string; key: string }) {
    const { maHd, rowNumber, email, key } = args;
    setSettingInactive((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/staff/clients/set-inactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, maHd, rowNumber, email })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to mark contract as inactive");
        return;
      }
      await loadClients(true);
    } catch {
      alert("Failed to mark contract as inactive");
    } finally {
      setSettingInactive((prev) => ({ ...prev, [key]: false }));
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

  useEffect(() => {
    if (canViewContractApprovals) {
      void loadContractApprovals();
    } else {
      setContractApprovals([]);
    }
  }, [canViewContractApprovals, normalizedEmail]);

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

  /** Manager AI returns navigate targets; map client stats tabs to client_list + activeTab. */
  function handleManagerAiNavigate(raw: string) {
    const view = String(raw || "").trim();
    if (view === "coins" || view === "payments" || view === "fines") {
      setActiveManagerView("client_list");
      setActiveTab(view);
      if (selectedMaHd) {
        void loadWorkspace(view, selectedMaHd);
      }
      router.replace("/manager?view=client_list");
      return;
    }

    const validTop: ManagerView[] = [
      "overview",
      "client_list",
      "owners_employees",
      "support_chat",
      "feedbacks",
      "admin_cleaning",
      "scheduling",
      "controller",
      "short_term",
      "settings"
    ];
    if (validTop.includes(view as ManagerView)) {
      setActiveManagerView(view as ManagerView);
      router.replace(`/manager?view=${encodeURIComponent(view)}`);
    }
  }

  async function loadRentPaidStatus(clientEmail: string) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setRentPaidMonth(month);
    setRentPaidStatus(null);
    setRentCoinRedeemInfo(null);
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
        const data = (await statusResponse.json()) as {
          isPaid: boolean;
          rentCoinRedeemCoins?: number | null;
          rentCoinRedeemValueVnd?: number | null;
          rentCoinRedeemAt?: string | null;
        };
        setRentPaidStatus(data.isPaid);
        if (data.rentCoinRedeemCoins != null && data.rentCoinRedeemCoins > 0) {
          setRentCoinRedeemInfo({
            coins: data.rentCoinRedeemCoins,
            valueVnd: data.rentCoinRedeemValueVnd ?? 0,
            at: data.rentCoinRedeemAt ?? null
          });
        } else {
          setRentCoinRedeemInfo(null);
        }
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

  useEffect(() => {
    const client = clients.find((c) => c.maHd === selectedMaHd) ?? null;
    const email = client?.email?.trim();
    const plan = String(client?.row?.["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
    if (!email || !normalizedEmail || (!plan.includes("03 tháng") && !plan.includes("06 tháng"))) {
      setPrepaidPkgEngineEstimate(null);
      setPrepaidPkgBilling(null);
      setPrepaidOwnerLineValues(null);
      setPrepaidPkgTotalInput("");
      setPrepaidPkgNoteInput("");
      return;
    }
    const month =
      rentPaidMonth && /^\d{4}-\d{2}$/.test(rentPaidMonth)
        ? rentPaidMonth
        : new Date().toISOString().slice(0, 7);
    let cancelled = false;
    setPrepaidPkgLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/manager/prepaid-package-billing?actorEmail=${encodeURIComponent(normalizedEmail)}&clientEmail=${encodeURIComponent(email)}&billingMonth=${encodeURIComponent(month)}`
        );
        const data = (await res.json()) as {
          error?: string;
          estimate?: PrepaidNextPaymentEstimatePayload;
          engineEstimate?: PrepaidNextPaymentEstimatePayload;
          billing?: {
            confirmed?: boolean;
            managerPackageTotalVnd?: number;
            managerNote?: string | null;
            lastAppNotifyAt?: string | null;
            lastEmailNotifyAt?: string | null;
            breakdownOverrides?: PrepaidBreakdownOverridesPayload | null;
          } | null;
        };
        if (cancelled) return;
        if (!res.ok || data.error) {
          setPrepaidPkgEngineEstimate(null);
          setPrepaidPkgBilling(null);
          setPrepaidOwnerLineValues(null);
          setPrepaidPkgTotalInput("");
          setPrepaidPkgNoteInput("");
          return;
        }
        const engine = data.engineEstimate ?? data.estimate ?? null;
        setPrepaidPkgEngineEstimate(engine);
        setPrepaidPkgBilling(data.billing ?? null);
        const bill = data.billing;
        const defaultTotal = bill?.managerPackageTotalVnd ?? engine?.estimatedTotalVnd ?? 0;
        setPrepaidPkgTotalInput(String(defaultTotal));
        setPrepaidPkgNoteInput(String(bill?.managerNote ?? ""));
        if (engine) {
          const mergedInit = mergePrepaidEstimateWithOverrides(
            engine,
            (bill?.breakdownOverrides as PrepaidBreakdownOverridesPayload) ?? null
          );
          setPrepaidOwnerLineValues({
            packageNet: mergedInit.packageRecurringSubtotalVnd,
            laundry: mergedInit.laundryFeeVnd,
            fines: mergedInit.finesVnd,
            gate: mergedInit.gateParkingFeeVnd
          });
        } else {
          setPrepaidOwnerLineValues(null);
        }
      } catch {
        if (!cancelled) {
          setPrepaidPkgEngineEstimate(null);
          setPrepaidPkgBilling(null);
          setPrepaidOwnerLineValues(null);
        }
      } finally {
        if (!cancelled) setPrepaidPkgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMaHd, clients, normalizedEmail, rentPaidMonth]);

  async function loadGateParkingTickets(clientEmail: string) {
    if (!isStaffSession || !clientEmail.trim()) {
      setGateParkingTickets([]);
      return;
    }
    setGateTicketsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/gate-parking-tickets?actorEmail=${encodeURIComponent(normalizedEmail)}&email=${encodeURIComponent(clientEmail.trim().toLowerCase())}`
      );
      const data = (await res.json()) as { tickets?: GateParkingTicketRow[] };
      if (res.ok) {
        setGateParkingTickets(data.tickets ?? []);
      } else {
        setGateParkingTickets([]);
      }
    } catch {
      setGateParkingTickets([]);
    } finally {
      setGateTicketsLoading(false);
    }
  }

  async function createGateParkingTicketForSelected() {
    if (!selectedClient?.email) return;
    const sessionStart = gateNewSessionStart.trim();
    const sessionDate = sessionStart ? new Date(sessionStart) : null;
    const durationHours = Number(gateNewDurationHours);
    const amount = Math.round(Number(gateNewAmount) || 0);
    if (
      !sessionDate ||
      Number.isNaN(sessionDate.getTime()) ||
      !Number.isFinite(durationHours) ||
      durationHours <= 0 ||
      amount <= 0
    ) {
      alert(t("gateParkingValidationRequired"));
      return;
    }
    const payload: Record<string, unknown> = {
      actorEmail: normalizedEmail,
      email: selectedClient.email.trim().toLowerCase(),
      sessionStartAt: sessionDate.toISOString(),
      durationHours,
      amountVnd: amount,
      note: gateNewNote.trim()
    };
    if (/^\d{4}-\d{2}$/.test(gateNewBillingMonthOverride.trim())) {
      payload.periodMonth = gateNewBillingMonthOverride.trim();
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/manager/gate-parking-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add ticket");
      setGateNewSessionStart(gateParkingDefaultDatetimeLocal());
      setGateNewDurationHours("1");
      setGateNewBillingMonthOverride("");
      setGateNewAmount(String(gateParkingSuggestedAmountVnd(1)));
      setGateNewNote("");
      await loadGateParkingTickets(selectedClient.email);
      await loadRentPaidStatus(selectedClient.email);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function updateGateTicketPaid(id: string, paid: boolean) {
    try {
      const res = await fetch(`${API_BASE_URL}/manager/gate-parking-tickets/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, markPaid: paid })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (selectedClient?.email) {
        await loadGateParkingTickets(selectedClient.email);
        await loadRentPaidStatus(selectedClient.email);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }

  async function removeGateTicket(id: string) {
    if (!window.confirm(t("gateParkingDeleteConfirm"))) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/gate-parking-tickets/${encodeURIComponent(id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (selectedClient?.email) {
        await loadGateParkingTickets(selectedClient.email);
        await loadRentPaidStatus(selectedClient.email);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
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
        setMonthlyRentPaidByEmail((prev) => ({
          ...prev,
          [clientEmail.trim().toLowerCase()]: data.isPaid
        }));
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
      setMonthlyRentPaidByEmail((prev) => ({
        ...prev,
        [options.client.email.trim().toLowerCase()]: true
      }));
      void loadGateParkingTickets(options.client.email);
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

  async function loadReferralProgramSettings() {
    setReferralProgramLoading(true);
    setReferralProgramMessage("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/referral-program?actorEmail=${encodeURIComponent(normalizedEmail)}`
      );
      const data = (await res.json()) as {
        enabled?: boolean;
        fullOfferContractMonths?: number;
        newRegistrantDiscountVnd?: number;
        newRegistrantCoins?: number;
        referrerCoins?: number;
        headlineEn?: string;
        headlineVi?: string;
        detailsEn?: string;
        detailsVi?: string;
        hostelEnabled?: boolean;
        hostelNewRegistrantDiscountVnd?: number;
        hostelNewRegistrantCoins?: number;
        hostelReferrerCoins?: number;
        hostelHeadlineEn?: string;
        hostelHeadlineVi?: string;
        hostelDetailsEn?: string;
        hostelDetailsVi?: string;
      };
      if (res.ok) {
        setReferralProgramDraft({
          enabled: Boolean(data.enabled),
          fullOfferContractMonths: String(data.fullOfferContractMonths ?? 6),
          newRegistrantDiscountVnd: String(data.newRegistrantDiscountVnd ?? 0),
          newRegistrantCoins: String(data.newRegistrantCoins ?? 0),
          referrerCoins: String(data.referrerCoins ?? 0),
          headlineEn: data.headlineEn ?? "",
          headlineVi: data.headlineVi ?? "",
          detailsEn: data.detailsEn ?? "",
          detailsVi: data.detailsVi ?? "",
          hostelEnabled: Boolean(data.hostelEnabled),
          hostelNewRegistrantDiscountVnd: String(data.hostelNewRegistrantDiscountVnd ?? 0),
          hostelNewRegistrantCoins: String(data.hostelNewRegistrantCoins ?? 0),
          hostelReferrerCoins: String(data.hostelReferrerCoins ?? 0),
          hostelHeadlineEn: data.hostelHeadlineEn ?? "",
          hostelHeadlineVi: data.hostelHeadlineVi ?? "",
          hostelDetailsEn: data.hostelDetailsEn ?? "",
          hostelDetailsVi: data.hostelDetailsVi ?? ""
        });
      } else {
        setReferralProgramMessage("Unable to load referral settings.");
      }
    } finally {
      setReferralProgramLoading(false);
    }
  }

  async function saveReferralProgramSettings() {
    if (!referralProgramDraft) {
      return;
    }
    setReferralProgramSaving(true);
    setReferralProgramMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/manager/referral-program`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          settings: {
            enabled: referralProgramDraft.enabled,
            fullOfferContractMonths: Number(referralProgramDraft.fullOfferContractMonths) || 6,
            newRegistrantDiscountVnd: Number(referralProgramDraft.newRegistrantDiscountVnd) || 0,
            newRegistrantCoins: Number(referralProgramDraft.newRegistrantCoins) || 0,
            referrerCoins: Number(referralProgramDraft.referrerCoins) || 0,
            headlineEn: referralProgramDraft.headlineEn,
            headlineVi: referralProgramDraft.headlineVi,
            detailsEn: referralProgramDraft.detailsEn,
            detailsVi: referralProgramDraft.detailsVi,
            hostelEnabled: referralProgramDraft.hostelEnabled,
            hostelNewRegistrantDiscountVnd: Number(referralProgramDraft.hostelNewRegistrantDiscountVnd) || 0,
            hostelNewRegistrantCoins: Number(referralProgramDraft.hostelNewRegistrantCoins) || 0,
            hostelReferrerCoins: Number(referralProgramDraft.hostelReferrerCoins) || 0,
            hostelHeadlineEn: referralProgramDraft.hostelHeadlineEn,
            hostelHeadlineVi: referralProgramDraft.hostelHeadlineVi,
            hostelDetailsEn: referralProgramDraft.hostelDetailsEn,
            hostelDetailsVi: referralProgramDraft.hostelDetailsVi
          }
        })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setReferralProgramMessage(data.error ?? "Save failed.");
        return;
      }
      setReferralProgramMessage("Saved.");
      await loadReferralProgramSettings();
    } finally {
      setReferralProgramSaving(false);
    }
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
        parkingTiers?: ParkingPricingTierRow[];
      };
      if (res.ok) setPricingData({
        bedOverrides: data.bedOverrides ?? [],
        discounts: data.discounts ?? [],
        branchSettings: data.branchSettings ?? [],
        parkingOverrides: data.parkingOverrides ?? [],
        parkingTiers: data.parkingTiers ?? []
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
    setFineAttachments([]);
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
    if (!clientActionMenuOpen) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (clientToolsMenuRef.current?.contains(target)) return;
      setClientActionMenuOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [clientActionMenuOpen]);

  useEffect(() => {
    setRentSectionCollapsed(true);
  }, [selectedMaHd]);

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
    if (activeManagerView === "support_chat") {
      void loadMaintenanceTickets({ silent: true });
    }
  }, [activeManagerView, loadMaintenanceTickets]);

  useEffect(() => {
    setActiveManagerView(initialView);
  }, [initialView]);

  useEffect(() => {
    setShowAllStatsEntries(false);
  }, [activeTab, selectedMaHd, workspace]);

  useEffect(() => {
    if (clientTermTab !== "short_term") {
      return;
    }
    const branchPricing = stConfig?.bedPricingByDate?.[stPricingBranch]?.[stPricingDate] ?? stConfig?.bedPricing?.[stPricingBranch] ?? {};
    setStEditBedPricing({ ...branchPricing });
  }, [clientTermTab, stConfig, stPricingBranch, stPricingDate]);

  useEffect(() => {
    setShowClientDetails(false);
    setClientPanelSections({ ...DEFAULT_MANAGER_CLIENT_PANEL_SECTIONS });
    setPrepaidPkgBreakdownOpen(false);
  }, [selectedMaHd]);

  useEffect(() => {
    if (selectedClient?.email) {
      void loadRentPaidStatus(selectedClient.email);
      void loadGateParkingTickets(selectedClient.email);
    } else {
      setRentPaidStatus(null);
      setRentPaidMonth("");
      setRentSectionCollapsed(true);
      setInfoRentBreakdown(null);
      setInfoManagerDiscount("0");
      setInfoShortTermSurchargeRate("0");
      setInfoParkingFee("0");
      setManagerDiscountInput("0");
      setShortTermSurchargeRateInput("0");
      setParkingFeeInput("0");
      setRentBreakdown(null);
      setGateParkingTickets([]);
      setPrepaidPkgEngineEstimate(null);
      setPrepaidPkgBilling(null);
      setPrepaidOwnerLineValues(null);
      setPrepaidPkgTotalInput("");
      setPrepaidPkgNoteInput("");
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
        setMicrowaves(data.microwaves || []);
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

  const handleMachineTrigger = async (machineId: string, deviceType: "laundry" | "airfryer" | "microwave") => {
    const actionKey = `${deviceType}:${machineId}`;
    // AntiGravity: Manager manual override warning
    if (!window.confirm(t("manualOverrideWarning").replace("{id}", machineId))) {
      return;
    }
    setControllerActionPending((current) => ({ ...current, [actionKey]: "TRIGGER" }));
    try {
      const endpoint =
        deviceType === "laundry"
          ? `${API_BASE_URL}/manager/controller/laundry/trigger`
          : deviceType === "microwave"
            ? `${API_BASE_URL}/manager/controller/microwave/trigger`
            : `${API_BASE_URL}/manager/controller/airfryer/trigger`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deviceType === "microwave" ? {} : { machineId })
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

  const handleLaundryMaintenanceToggle = async (machine: { id: string; offlineForMaintenance?: boolean }) => {
    const maintKey = `laundry-maint:${machine.id}`;
    const nextOffline = !machine.offlineForMaintenance;
    if (
      !window.confirm(
        nextOffline ? t("laundryMaintenanceConfirmOffline") : t("laundryMaintenanceConfirmOnline")
      )
    ) {
      return;
    }
    setControllerActionPending((current) => ({ ...current, [maintKey]: "TOGGLE" }));
    try {
      const response = await fetch(`${API_BASE_URL}/manager/laundry/machines/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          machineId: machine.id,
          offlineForMaintenance: nextOffline
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setControllerFeedback(maintKey, {
          tone: "error",
          message: data.error || t("requestFailed")
        });
        return;
      }
      setControllerFeedback(maintKey, {
        tone: "success",
        message: nextOffline ? t("laundryMaintenanceMarkedOffline") : t("laundryMaintenanceMarkedOnline")
      });
      await fetchDevices();
    } catch {
      setControllerFeedback(maintKey, {
        tone: "error",
        message: t("requestFailed")
      });
    } finally {
      setControllerActionPending((current) => {
        const next = { ...current };
        delete next[maintKey];
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

  async function patchFinePaidToggle(opts: {
    rowKey: string;
    residentEmail: string;
    timestamp: string;
    content: string;
    statusColumnKey: string;
    nextPaid: boolean;
  }) {
    setFinePaidSavingKey(opts.rowKey);
    setStatus("");
    try {
      const res = await fetch(`${API_BASE_URL}/staff/fines/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          email: opts.residentEmail.trim().toLowerCase(),
          timestamp: opts.timestamp,
          content: opts.content,
          values: {
            [opts.statusColumnKey]: opts.nextPaid ? "Đã thanh toán tiền mặt" : "CHƯA"
          }
        })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? t("requestFailed"));
        return;
      }
      if (selectedClient) {
        await loadWorkspace("fines", selectedClient.maHd);
      }
      setStatus(
        opts.nextPaid
          ? language === "vi"
            ? "Đã đánh dấu phiếu phạt là đã thanh toán."
            : "Fine marked as paid."
          : language === "vi"
            ? "Đã đánh dấu phiếu phạt là chưa thanh toán."
            : "Fine marked as unpaid."
      );
    } catch {
      setStatus(t("requestFailed"));
    } finally {
      setFinePaidSavingKey(null);
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
    void loadMaintenanceTickets({ silent: true });
    const interval = setInterval(() => {
      void fetchUnreadCounts();
      void loadMaintenanceTickets({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCounts, loadMaintenanceTickets]);

  async function uploadFineAttachment(file: File) {
    if (!selectedClient || !normalizedEmail) {
      return;
    }

    const maxBytes = 52 * 1024 * 1024;
    if (file.size > maxBytes) {
      setStatus(language === "vi" ? "File quá lớn (tối đa ~50MB trước khi nén)." : "File is too large (max ~50MB before compression).");
      return;
    }

    let mime = (file.type || "").trim().split(";")[0] ?? "";
    if (!mime) {
      const lowerName = file.name.toLowerCase();
      if (/\.(mp4|m4v|mov|webm|mkv)$/.test(lowerName)) {
        mime = "video/mp4";
      } else if (/\.(jpe?g|png|gif|webp|heic|heif)$/.test(lowerName)) {
        mime = "image/jpeg";
      }
    }

    if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
      setStatus(language === "vi" ? "Chỉ hỗ trợ ảnh hoặc video." : "Only image or video files are supported.");
      return;
    }

    const evidenceKind: "image" | "video" = mime.startsWith("video/") ? "video" : "image";

    setFineAttachmentUploading(true);
    setStatus("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : dataUrl;
      const defaultName =
        file.name?.trim() ||
        (evidenceKind === "video" ? `fine-${selectedClient.maHd}.mp4` : `fine-${selectedClient.maHd}.jpg`);
      const response = await fetch(`${API_BASE_URL}/staff/fines/upload-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          maHd: selectedClient.maHd,
          clientName: selectedClient.name || selectedClient.email,
          fileName: defaultName,
          mimeType: mime,
          dataBase64: base64Data
        })
      });
      const data = (await response.json()) as { url?: string; downloadUrl?: string; fileName?: string; mimeType?: string; fileId?: string; error?: string };
      const uploadedUrl = data.url?.trim();
      if (!response.ok || !uploadedUrl) {
        setStatus(data.error ?? t("unableToUploadFineImage"));
        return;
      }
      const uploadedDownloadUrl = data.downloadUrl?.trim() || uploadedUrl;

      setFineAttachments((current) => [
        ...current,
        {
          url: uploadedUrl,
          downloadUrl: uploadedDownloadUrl,
          fileName: data.fileName ?? file.name,
          mimeType: data.mimeType ?? mime,
          evidenceKind
        }
      ]);
      setStatus(t("fineImageUploaded"));
    } catch {
      setStatus(t("unableToUploadFineImage"));
    } finally {
      setFineAttachmentUploading(false);
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
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{t("manager")}</h1>
              <InlineHelp
                label={t("managementWorkspaceHelpLabel")}
                title={t("managementWorkspace")}
                body={t("managementWorkspaceDesc")}
              />
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
            {isOwnerSession ? (
              <button
                type="button"
                onClick={() => setClientSubTab("analytics")}
                className={`whitespace-nowrap px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all border-b-2 ${
                  clientSubTab === "analytics"
                    ? "border-sky-500 text-sky-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {t("statsTab")}
              </button>
            ) : null}
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
          {canViewContractApprovals && contractApprovals.some((item) => item.status === "pending") ? (
            <section className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-rose-50 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">
                    {t("pendingContractApprovals")} ({contractApprovals.filter((item) => item.status === "pending").length})
                  </h3>
                  <p className="mt-1 text-sm text-amber-800">
                    {t("pendingContractApprovalsDesc")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadContractApprovals()}
                    disabled={contractApprovalsLoading}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
                  >
                    {contractApprovalsLoading ? "Loading..." : "Refresh"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientSubTab("details")}
                    className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
                  >
                    Open full approvals view
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {contractApprovals
                  .filter((item) => item.status === "pending")
                  .slice(0, 4)
                  .map((item) => {
                    const isExpanded = Boolean(expandedContractApprovals[item.id]);
                    return (
                      <div key={item.id} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {item.type === "registration" ? "New registration" : "Contract extension"}
                            </div>
                            <div className="text-xs text-slate-600">{item.fullName || item.email}</div>
                          </div>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            {item.contractMonths ?? "-"} mo
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Signed: {item.clientSignatureTimestamp ? formatCozoroDateTime(item.clientSignatureTimestamp) : "-"}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleContractApprovalDetails(item.id)}
                          className="mt-2 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {isExpanded ? "Hide details" : "View details before approve"}
                        </button>
                        {isExpanded ? (
                          <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                            <div>Branch: {item.branchId || "-"}</div>
                            <div>Bed: {item.bedNumber ?? "-"}</div>
                            <div>Start: {item.contractStartDate || "-"}</div>
                            <div>End: {item.contractEndDate || "-"}</div>
                            <div>Submitted: {formatCozoroDateTime(item.submittedAt)}</div>
                            <div>Email: {item.email}</div>
                            {item.type === "extension" ? (
                              <div className="sm:col-span-2">Previous end: {item.previousContractEndDate || "-"}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {canReviewContractApprovals ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void reviewContractApproval(item.id, "approve")}
                              disabled={contractApprovalActionId === item.id}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {contractApprovalActionId === item.id ? "Working..." : "Approve and send"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviewContractApproval(item.id, "reject")}
                              disabled={contractApprovalActionId === item.id}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            </section>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  // Clear the focused client/room so the branch-sync effect does
                  // not snap the user back to the client's branch.
                  if (selectedClient && normalizeBranchLabel(selectedClient.branch) !== "D2") {
                    setSelectedMaHd("");
                    setSelectedRoom("");
                  }
                  setSelectedBranch("D2");
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedBranch === "D2" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                }`}
              >
                {t("branchD2")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedClient && normalizeBranchLabel(selectedClient.branch) !== "D7") {
                    setSelectedMaHd("");
                    setSelectedRoom("");
                  }
                  setSelectedBranch("D7");
                }}
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
              <button
                type="button"
                onClick={() => openBranchToolsModal("manual_receipt")}
                className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-all hover:bg-amber-100"
              >
                Branch Tools
              </button>
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
                                          const bedNum = String(slot.bedNumber);
                                          setDiagramBedQuickSheet((prev) =>
                                            prev?.client.maHd === client.maHd && prev.bedNumber === bedNum
                                              ? null
                                              : { client, bedNumber: bedNum }
                                          );
                                        } else {
                                          fillClientForm(null);
                                          setDiagramBedQuickSheet(null);
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
                                      <span className="flex items-center gap-0.5">
                                        {client ? getLastName(client.name) : slot.bedNumber}
                                        {client && showUnpaidRentMarker(client) ? (
                                          <span className="text-[8px] font-black leading-none text-red-600" title="Rent not marked paid">
                                            $
                                          </span>
                                        ) : null}
                                      </span>
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
                                      setDiagramBedQuickSheet(null);
                                      setClientSubTab("details");
                                    }}
                                    className="w-full text-left"
                                  >
                                    <div className="flex items-center gap-1 text-sm font-medium text-slate-900">
                                      <span>{client.name}</span>
                                      {showUnpaidRentMarker(client) ? (
                                        <span className="text-xs font-black text-red-600" title="Rent not marked paid">
                                          $
                                        </span>
                                      ) : null}
                                    </div>
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
            <div className="space-y-3">
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
                            setDiagramBedQuickSheet(null);
                            setClientSubTab("details");
                          }}
                          className={`cursor-pointer transition-colors hover:bg-slate-50 ${selectedMaHd === client.maHd ? "bg-sky-50" : ""}`}
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">
                            <span className="inline-flex items-center gap-1">
                              {client.name}
                              {showUnpaidRentMarker(client) ? (
                                <span className="font-black text-red-600" title="Rent not marked paid">
                                  $
                                </span>
                              ) : null}
                            </span>
                          </td>
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
          </div>
          )}
          </>)}
          {clientTermTab === "inactive" && (
            <section className="space-y-5">
              {inactiveClientsLoading ? (
                <p className="text-sm text-slate-500">{t("loadingInactiveClients")}</p>
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
                      {inactiveClients.length === 0 ? t("noInactiveClients") : t("noClientsMatchFilters")}
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
                                                            onClick={() => {
                                                              setSelectedMaHd(c.maHd);
                                                              fillClientForm(c);
                                                              setDiagramBedQuickSheet(null);
                                                              setClientSubTab("details");
                                                            }}
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
                  <h2 className="text-lg font-semibold text-slate-900">{t("hostelPortalTitle")}</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{t("hostelPortalDesc")}</p>
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
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
                  ) : !stPendingBookings?.length ? (
                    <p className="text-sm text-slate-500">{t("noPendingBookings")}</p>
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
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
                  ) : !stGuests?.current.length ? (
                    <p className="text-sm text-slate-500">{t("noGuestsCheckedIn")}</p>
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
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{t("bookingStatusActive")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </StSection>

                {/* Past hostel guests */}
                <StSection id="past" title="Past hostel guests" badge={stGuests?.past.length}
                  onOpen={() => { void stLoadGuests(); }}>
                  {stGuestsLoading ? (
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
                  ) : !stGuests?.past.length ? (
                    <p className="text-sm text-slate-500">{t("noPastShortStayRecords")}</p>
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
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{t("bookingStatusCheckedOut")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </StSection>

                {/* Bed pricing */}
                <StSection id="pricing" title="Bed pricing by date (nightly rate ₫)" onOpen={() => { void stLoadConfig(); }}>
                  {stConfigLoading ? (
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
                  ) : (
                    <div className="space-y-4">
                      {(() => {
                        const selectedDateOverride = stConfig?.bedPricingByDate?.[stPricingBranch]?.[stPricingDate] ?? null;
                        const legacyBranchPricing = stConfig?.bedPricing?.[stPricingBranch] ?? {};
                        const saveBedPricingByDate = {
                          ...(stConfig?.bedPricingByDate ?? {}),
                          [stPricingBranch]: {
                            ...(stConfig?.bedPricingByDate?.[stPricingBranch] ?? {}),
                            [stPricingDate]: stEditBedPricing
                          }
                        };
                        const clearBedPricingByDate = {
                          ...(stConfig?.bedPricingByDate ?? {})
                        };
                        if (clearBedPricingByDate[stPricingBranch]) {
                          const nextBranchDates = { ...clearBedPricingByDate[stPricingBranch] };
                          delete nextBranchDates[stPricingDate];
                          clearBedPricingByDate[stPricingBranch] = nextBranchDates;
                        }
                        return (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="space-y-1">
                                <span className="text-xs font-medium text-slate-700">{t("selectedDate", "Selected date")}</span>
                                <input
                                  type="date"
                                  value={stPricingDate}
                                  onChange={(e) => setStPricingDate(e.target.value)}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                                />
                              </label>
                              <div className="text-xs text-slate-500">
                                {selectedDateOverride
                                  ? "This date has its own saved prices."
                                  : "This date currently uses the branch's legacy nightly prices."}
                              </div>
                              <div className="ml-auto flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStEditBedPricing({ ...legacyBranchPricing });
                                  }}
                                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                                >
                                  Load legacy prices
                                </button>
                                <button
                                  type="button"
                                  disabled={stConfigSaving}
                                  onClick={() => void stSaveConfig({ bedPricingByDate: saveBedPricingByDate })}
                                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                >
                                  {stConfigSaving ? "Saving…" : "Save date prices"}
                                </button>
                                <button
                                  type="button"
                                  disabled={stConfigSaving || !selectedDateOverride}
                                  onClick={() => void stSaveConfig({ bedPricingByDate: clearBedPricingByDate })}
                                  className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                                >
                                  Clear date override
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">
                              Edit the prices for this specific date. That date will use these values when hostel guests book.
                            </p>
                          </div>
                        );
                      })()}
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
                                                const currentVal = stEditBedPricing[String(bedNum)];
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
                                                        [String(bedNum)]: Number(e.target.value)
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
                          onClick={() => {
                            const defaults: Record<string, number> = {};
                            for (const room of BRANCH_LAYOUTS[stPricingBranch]) {
                              for (let b = room.startBed; b <= room.endBed; b++) {
                                const level = ((b - 1) % 3) + 1;
                                defaults[String(b)] = level === 1 ? 150000 : 250000;
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
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
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
                                <span className="text-xs text-slate-500">{t("minNights")}</span>
                                <input
                                  type="number" min={1} value={rule.minNights}
                                  onChange={(e) => setStConfig({ ...stConfig, discounts: { ...stConfig.discounts, [type]: { ...rule, minNights: Number(e.target.value) } } })}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm w-full focus:outline-none focus:border-sky-400"
                                />
                              </label>
                              <label className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-slate-500">{t("discountPercent")}</span>
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
                    <p className="text-sm text-slate-500">{t("loadingGeneral")}</p>
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
                    Last updated {formatCozoroDateTime(stConfig.updatedAt)} by {stConfig.updatedBy}
                  </p>
                )}
              </section>
            );
          })()}
          </div>
        ) : clientSubTab === "analytics" && isOwnerSession ? (
           <OwnerAnalyticsDashboard
            paymentRows={paymentPurposeRows}
            normalizedEmail={normalizedEmail}
            paymentLoading={loading}
            onRefreshPayments={() => void loadPaymentPurposeRows()}
          />
        ) : (
          <div ref={managerClientWorkspaceRef} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {false ? <section /> : null}
            {canViewContractApprovals && selectedClientContractApprovals.length > 0 ? (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-amber-950">{t("pendingContractApprovals")}</h2>
                    <p className="mt-1 text-sm text-amber-800">{t("pendingContractApprovalsDesc")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadContractApprovals()}
                    disabled={contractApprovalsLoading}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 disabled:opacity-50"
                  >
                    {contractApprovalsLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {selectedClientContractApprovals.map((item) => {
                    const isExpanded = Boolean(expandedContractApprovals[item.id]);
                    return (
                    <div key={item.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {item.type === "registration" ? "New registration" : "Contract extension"}
                          </div>
                          <div className="mt-1 text-sm text-slate-700">{item.fullName || item.email}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.email}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              item.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {item.status === "pending" ? "Pending" : "Rejected"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {item.contractMonths ?? "-"} mo
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleContractApprovalDetails(item.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {isExpanded ? "Hide details" : "View details before approve"}
                        </button>
                      </div>
                      {isExpanded ? (
                        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                          <div>Branch: {item.branchId || "-"}</div>
                          <div>Bed: {item.bedNumber ?? "-"}</div>
                          <div>Start: {item.contractStartDate || "-"}</div>
                          <div>End: {item.contractEndDate || "-"}</div>
                          <div>Signed: {item.clientSignatureTimestamp ? formatCozoroDateTime(item.clientSignatureTimestamp) : "-"}</div>
                          <div>Submitted: {formatCozoroDateTime(item.submittedAt)}</div>
                          {item.type === "extension" ? (
                            <>
                              <div className="sm:col-span-2">Previous contract end: {item.previousContractEndDate || "-"}</div>
                              <div className="sm:col-span-2">Contract code: {item.contractCode || "-"}</div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {canReviewContractApprovals && item.status === "pending" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void reviewContractApproval(item.id, "approve")}
                            disabled={contractApprovalActionId === item.id}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {contractApprovalActionId === item.id ? "Working..." : "Approve and send"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void reviewContractApproval(item.id, "reject")}
                            disabled={contractApprovalActionId === item.id}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : item.status === "pending" && !canReviewContractApprovals ? (
                        <p className="mt-4 text-xs font-medium text-slate-600">
                          Only an owner or app admin can approve or reject this request.
                        </p>
                      ) : null}
                    </div>
                  )})}
                </div>
              </section>
            ) : null}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("selectedClient")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedClient ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>{selectedClient.name || selectedClient.email}</span>
                      {showUnpaidRentMarker(selectedClient) ? (
                        <span className="font-black text-red-600" title="This month's rent is not marked paid in the portal">
                          $
                        </span>
                      ) : null}
                      <span className="text-slate-400">• {selectedClient.maHd}</span>
                    </span>
                  ) : (
                    t("chooseClientPrompt")
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="relative" ref={clientToolsMenuRef}>
                  <button
                    type="button"
                    onClick={() => setClientActionMenuOpen((v) => !v)}
                    disabled={!selectedClient}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                  >
                    🧰 Tools
                  </button>
                  {clientActionMenuOpen ? (
                    <div className="absolute left-0 z-20 mt-2 w-[min(16rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl sm:left-auto sm:right-0 sm:w-64 sm:max-w-none">
                      {(() => {
                        const autoLock = selectedClient ? getAutomaticFeatureLockStatus(selectedClient) : null;
                        const isUnlocked = accountLockOverride?.unlocked === true;
                        const isManuallyLocked = accountLockOverride?.forceLocked === true;
                        const isCurrentlyLocked = isManuallyLocked || (Boolean(autoLock?.isBlocked) && !isUnlocked);
                        const canToggle =
                          !!selectedClient?.email && (sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin");
                        const lockLabel = accountLockOverrideLoading
                          ? t("loadingLabel")
                          : isCurrentlyLocked
                            ? t("featureLockOn")
                            : isUnlocked
                            ? t("featureLockOff")
                            : t("featureLockOff");
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (!selectedClient?.email) return;
                              const nextForceLocked = !isCurrentlyLocked;
                              const nextUnlocked = !nextForceLocked;
                              let note = nextUnlocked ? t("manualUnlockNote") : "";
                              if (nextForceLocked) {
                                const reason = window.prompt("Reason for lock:");
                                if (reason == null) return;
                                if (!reason.trim()) {
                                  setStatus("Please enter a reason for lock.");
                                  return;
                                }
                                note = reason.trim();
                              }
                              void postJson(
                                `${API_BASE_URL}/manager/account-lock-override`,
                                {
                                  actorEmail: normalizedEmail,
                                  targetEmail: selectedClient.email,
                                  unlocked: nextUnlocked,
                                  forceLocked: nextForceLocked,
                                  note
                                },
                                nextUnlocked ? t("accountUnlockedSuccess") : t("featureLockEnabledSuccess"),
                                async () => {
                                  await loadAccountLockOverride(selectedClient.email);
                                }
                              );
                              setClientActionMenuOpen(false);
                            }}
                            disabled={!canToggle || accountLockOverrideLoading || !selectedClient?.email}
                            title={
                              isManuallyLocked
                                ? accountLockOverride?.note || t("featureLockTitle")
                                : autoLock?.isBlocked
                                  ? isUnlocked
                                  ? t("overrideByLabel", { manager: accountLockOverride?.updatedBy ?? t("manager") })
                                  : autoLock.reason
                                  : t("normalAutomaticRulesDesc")
                            }
                            className={`mb-1 block w-full rounded-lg border px-3 py-2 text-left text-sm font-medium disabled:opacity-60 ${
                              isCurrentlyLocked
                                ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {t("featureLockTitle")}: {lockLabel}
                          </button>
                        );
                      })()}
                      {[
                        ["reminder", "🔔 Send notification to client"],
                        ["message", `💬 ${t("openChat")}`],
                        ["call", `📞 ${t("callClient")}`],
                        ["email", `✉️ ${t("emailClient")}`],
                        ["fine", `🧾 ${t("newFineTicket")}`],
                        ["coins", `🪙 ${t("newCoinsEntry")}`],
                        ["password", `🔐 ${t("changePassword", "Change password")}`],
                        ["gateParking", `🚦 ${t("gateParkingTickets")}`],
                        ...(canCreatePaymentReceipt ? ([[ "payment", `💵 ${t("newPaymentReceipt")}` ]] as const) : [])
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setActiveAction(value as ClientAction);
                            setClientActionMenuOpen(false);
                          }}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
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
                <ManagerClientPanelCollapsible
                  title="Overview"
                  open={clientPanelSections.overview}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      overview: !s.overview
                    }))
                  }
                >
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
                </ManagerClientPanelCollapsible>

                <ManagerClientPanelCollapsible
                  title="Payment plan"
                  open={clientPanelSections.paymentPlan}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      paymentPlan: !s.paymentPlan
                    }))
                  }
                >
                {(() => {
                  const ps = derivePaymentPlanSummary(selectedClient.row ?? {}, rentPaidStatus);
                  const expiryStr = ps.packageExpiry
                    ? formatCozoroDate(ps.packageExpiry, { day: "2-digit", month: "short", year: "numeric" })
                    : null;
                  const nextStr = formatCozoroDate(ps.nextPaymentDate, { day: "2-digit", month: "short", year: "numeric" });
                  return (
                    <div className={`rounded-2xl border p-4 ${ps.isDue ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("paymentPlanLabel")}</div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              ps.planType === "monthly" ? "bg-sky-100 text-sky-800" :
                              ps.planType === "3month" ? "bg-violet-100 text-violet-800" :
                              "bg-emerald-100 text-emerald-800"
                            }`}>{ps.planLabel}</span>
                            {ps.isDue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                {t("paymentDueLabel")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          {expiryStr && (
                            <div className="text-xs text-slate-500">
                              {t("packageExpiresLabel", { date: expiryStr })}
                            </div>
                          )}
                          <div className={`text-xs ${ps.isDue ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                            {ps.isDue ? t("overdueSinceLabel") : t("nextPaymentLabel")}{" "}
                            <span className="font-semibold">{nextStr}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                </ManagerClientPanelCollapsible>
                {selectedClientDuplicate ? (
                <ManagerClientPanelCollapsible
                  title={t("duplicateContractDetected")}
                  right={
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                      {selectedClientDuplicate.rows.length}
                    </span>
                  }
                  open={clientPanelSections.duplicates}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      duplicates: !s.duplicates
                    }))
                  }
                >
                {(() => {
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
                        <div className="text-sm font-semibold text-amber-900">{t("duplicateContractDetected")}</div>
                      </div>
                      <p className="text-xs text-amber-800">{t("duplicateContractDesc", { count: selectedClientDuplicate.rows.length })}</p>
                      <div className="space-y-2">
                        {sortedRows.map((row, idx) => {
                          const isLatest = row.submissionTimestamp === latestTs;
                          const stableKey = row.rowNumber != null
                            ? `r${row.rowNumber}`
                            : `${row.maHd || "nomahd"}-${row.submissionTimestamp || idx}`;
                          const canMarkInactive = !isLatest && (row.rowNumber != null || !!row.maHd);
                          return (
                            <div key={stableKey} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${isLatest ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-white"}`}>
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-800">
                                  {row.maHd || <span className="italic text-slate-400">no contract code</span>}
                                  {isLatest && <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-white">{t("usingThisRow")}</span>}
                                </div>
                                {row.submissionTimestamp && <div className="text-slate-400">{t("submittedAtWithDate", { date: row.submissionTimestamp })}</div>}
                                <div className="text-slate-500">{row.branch} · Bed {row.bed} · {row.contractStart} → {row.contractEnd}</div>
                                <div className="text-slate-500">{t("statusWithLabel", { status: <span className={row.activeStay === "1" ? "text-emerald-700 font-semibold" : "text-slate-500"}>{row.activeStay || "not set"}</span> })}</div>
                              </div>
                              {canMarkInactive && (
                                <button
                                  type="button"
                                  disabled={!!settingInactive[stableKey]}
                                  onClick={() => markContractInactive({ maHd: row.maHd, rowNumber: row.rowNumber, email: selectedClientDuplicate.email, key: stableKey })}
                                  className="ml-3 flex-shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  {settingInactive[stableKey] ? "Saving…" : "Mark Inactive (−1)"}
                                </button>
                              )}
                              {!isLatest && !canMarkInactive && (
                                <span className="ml-3 text-[10px] text-slate-400 italic">{t("missingIdentifierFixSheet")}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                </ManagerClientPanelCollapsible>
                ) : null}

                <ManagerClientPanelCollapsible
                  title={t("stayStatusLabel")}
                  open={clientPanelSections.stayStatus}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      stayStatus: !s.stayStatus
                    }))
                  }
                >
                {(() => {
                  const stay = String(selectedClient.activeStay ?? "").trim();
                  const isUnset = stay === "";
                  const isStaying = stay === "1";
                  const isMovedOut = stay === "0";
                  const isLeft = stay === "-1";
                  const stayLabel = isUnset
                    ? t("stayStatusNotSet")
                    : isStaying
                      ? t("stayStatusStaying")
                      : isMovedOut
                        ? t("stayStatusMovedOut")
                        : t("stayStatusLeft");
                  const stayColor = isUnset ? "text-pink-700" : isStaying ? "text-emerald-700" : "text-rose-700";
                  const borderColor = isUnset ? "border-pink-300 bg-pink-50" : "border-slate-200 bg-slate-50";

                  return (
                    <div className={`rounded-2xl border p-4 ${borderColor}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("stayStatusLabel")}</div>
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
                </ManagerClientPanelCollapsible>

                {selectedClient && showDepositRefundButton ? (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50/90 p-4 space-y-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-sky-900">{t("depositRefundEmailLabel")}</div>
                      <p className="mt-1 text-xs text-sky-950/80">
                        {t("depositRefundDesc")}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loading || !String(selectedClient.maHd ?? "").trim()}
                      onClick={async () => {
                        setDepositRefundOpen(true);
                        setDepositRefundModalError("");
                        setDepositRefundPreview(null);
                        setDepositRefundInput("");
                        setDepositRefundLoading(true);
                        try {
                          const res = await fetch(
                            `${API_BASE_URL}/manager/deposit-refund-preview?actorEmail=${encodeURIComponent(normalizedEmail)}&maHd=${encodeURIComponent(selectedClient.maHd)}`
                          );
                          const data = (await res.json()) as {
                            error?: string;
                            eligibilityReason?: string;
                            clientEmail?: string;
                            clientName?: string;
                            maHd?: string;
                            depositVnd?: number;
                            unpaidFinesVnd?: number;
                            unpaidGateVnd?: number;
                            suggestedRefundVnd?: number;
                          };
                          if (!res.ok) {
                            throw new Error(data.error ?? "Unable to load preview");
                          }
                          if (data.error) {
                            throw new Error(data.error);
                          }
                          setDepositRefundPreview({
                            eligibilityReason: String(data.eligibilityReason ?? ""),
                            clientEmail: String(data.clientEmail ?? ""),
                            clientName: String(data.clientName ?? ""),
                            maHd: String(data.maHd ?? selectedClient.maHd),
                            depositVnd: Number(data.depositVnd ?? 0),
                            unpaidFinesVnd: Number(data.unpaidFinesVnd ?? 0),
                            unpaidGateVnd: Number(data.unpaidGateVnd ?? 0),
                            suggestedRefundVnd: Number(data.suggestedRefundVnd ?? 0)
                          });
                          setDepositRefundInput(String(Math.round(Number(data.suggestedRefundVnd ?? 0))));
                        } catch (err) {
                          setDepositRefundModalError(err instanceof Error ? err.message : "Unable to load preview");
                        } finally {
                          setDepositRefundLoading(false);
                        }
                      }}
                      className="rounded-lg border border-sky-400 bg-white px-3 py-2 text-xs font-semibold text-sky-900 shadow-sm hover:bg-sky-100 disabled:opacity-50"
                    >
                      {t("depositRefundBtn")}
                    </button>
                  </div>
                ) : null}

                {/* Contract Termination — hidden for inactive clients */}
                {selectedClient && selectedClient.activeStay !== "0" && selectedClient.activeStay !== "-1" ? (
                <ManagerClientPanelCollapsible
                  title={t("contractTerminationBtn")}
                  open={clientPanelSections.contractTermination}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      contractTermination: !s.contractTermination
                    }))
                  }
                >
                {(() => {
                  const isTerminated = terminationStatus && terminationStatus !== "loading";
                  const checkedOut = isTerminated && (terminationStatus as { checkOut: { submittedAt: string } | null }).checkOut;
                  return (
                    <div className={`rounded-2xl border p-4 ${isTerminated ? (checkedOut ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50") : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("contractStatusLabel")}</div>
                            <InlineHelp
                              label={t("howContractStatusWorks")}
                              title={t("contractStatusTitle")}
                              body={t(MANAGER_FUNCTION_HELP.contractStatus)}
                            />
                          </div>
                          <div className={`mt-1 text-sm font-medium ${isTerminated ? (checkedOut ? "text-emerald-700" : "text-rose-700") : "text-slate-700"}`}>
                            {terminationStatus === "loading"
                              ? t("loadingGeneral")
                              : checkedOut
                                ? t("checkedOutWithDate", { date: formatCozoroDate((terminationStatus as { checkOut: { submittedAt: string } }).checkOut.submittedAt) })
                                : isTerminated
                                  ? t("terminatedCheckOutPending")
                                  : t("contractStatusActive")}
                          </div>
                          {isTerminated && !checkedOut && (terminationStatus as { terminatedAt: string }).terminatedAt && (
                            <div className="mt-0.5 text-xs text-rose-600">
                              {t("terminatedWithDate", { date: formatCozoroDate((terminationStatus as { terminatedAt: string }).terminatedAt) })}
                            </div>
                          )}
                        </div>
                        {!isTerminated && terminationStatus !== "loading" && (
                          <button
                            type="button"
                            onClick={() => { setTerminateNote(""); setTerminateDialog(true); }}
                            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            {t("terminateContractBtn")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
                </ManagerClientPanelCollapsible>
                ) : null}

                {/* Terminate contract confirmation dialog */}
                {terminateDialog && selectedClient && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl space-y-4">
                      <h3 className="font-semibold text-slate-900">{t("terminateContractQuestion")}</h3>
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 space-y-1">
                        <p className="font-semibold">{t("depositPolicyWarningTitle")}</p>
                        <p>{t("terminateContractWarning")}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">{t("depositNoteToClient")}</label>
                        <textarea
                          value={terminateNote}
                          onChange={(e) => setTerminateNote(e.target.value)}
                          rows={2}
                          placeholder={t("terminateNotePlaceholder")}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setTerminateDialog(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700">{t("cancelLabel")}</button>
                        <button
                          type="button"
                          disabled={terminateLoading}
                          onClick={async () => {
                            const secondConfirm = window.confirm(
                              "Final confirmation: terminate this contract now? This action is hard to undo."
                            );
                            if (!secondConfirm) {
                              return;
                            }
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
                              setStatus(t("contractTerminatedStatus"));
                            } catch (err) {
                              setStatus(err instanceof Error ? err.message : "Failed to terminate contract");
                            } finally {
                              setTerminateLoading(false);
                            }
                          }}
                          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {terminateLoading ? t("processingLabel") : t("confirmTerminationBtn")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {depositRefundOpen && selectedClient ? (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-900">{t("depositRefundEmailLabel")}</h3>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                          onClick={() => {
                            setDepositRefundOpen(false);
                            setDepositRefundPreview(null);
                            setDepositRefundModalError("");
                            setDepositRefundInput("");
                          }}
                        >
                          Close
                        </button>
                      </div>
                      {depositRefundLoading ? (
                        <p className="text-sm text-slate-600">Loading preview…</p>
                      ) : depositRefundPreview ? (
                        <>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                            <div>
                              <span className="font-semibold text-slate-800">Resident: </span>
                              {depositRefundPreview.clientName} ({depositRefundPreview.clientEmail})
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Eligibility: </span>
                              {depositRefundPreview.eligibilityReason === "inactive"
                                ? "Inactive / not currently staying"
                                : depositRefundPreview.eligibilityReason === "terminated"
                                  ? "Contract terminated"
                                  : depositRefundPreview.eligibilityReason === "contract_due"
                                    ? "Contract ending within 7 days"
                                    : depositRefundPreview.eligibilityReason}
                            </div>
                          </div>
                          <dl className="grid grid-cols-1 gap-2 text-sm">
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-600">Deposit (sheet)</dt>
                              <dd className="font-medium text-slate-900">{formatCurrency(depositRefundPreview.depositVnd)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-600">Unpaid fines</dt>
                              <dd className="font-medium text-rose-700">−{formatCurrency(depositRefundPreview.unpaidFinesVnd)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-600">Unpaid gate tickets</dt>
                              <dd className="font-medium text-rose-700">−{formatCurrency(depositRefundPreview.unpaidGateVnd)}</dd>
                            </div>
                            <div className="flex justify-between gap-2 border-t border-slate-200 pt-2">
                              <dt className="text-slate-800 font-semibold">Suggested refund</dt>
                              <dd className="font-semibold text-emerald-800">{formatCurrency(depositRefundPreview.suggestedRefundVnd)}</dd>
                            </div>
                          </dl>
                          <div>
                            <label className="text-xs font-medium text-slate-600">Refund amount to notify (VND)</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={depositRefundInput}
                              onChange={(e) => setDepositRefundInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              placeholder="e.g. 1980000"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                              Cannot exceed deposit on file ({formatCurrency(depositRefundPreview.depositVnd)}). Email is Vietnamese + English; processing time stated as 5–10 business days.
                            </p>
                          </div>
                          {depositRefundModalError ? (
                            <p className="text-sm font-medium text-rose-600">{depositRefundModalError}</p>
                          ) : null}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDepositRefundOpen(false);
                                setDepositRefundPreview(null);
                                setDepositRefundModalError("");
                                setDepositRefundInput("");
                              }}
                              className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={depositRefundSending}
                              onClick={async () => {
                                const parsed = Math.round(Number.parseInt(String(depositRefundInput).replace(/\D/g, ""), 10));
                                if (!Number.isFinite(parsed) || parsed < 0) {
                                  setDepositRefundModalError("Enter a valid non-negative amount.");
                                  return;
                                }
                                if (parsed > depositRefundPreview.depositVnd) {
                                  setDepositRefundModalError("Refund cannot exceed the deposit on file.");
                                  return;
                                }
                                setDepositRefundSending(true);
                                setDepositRefundModalError("");
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/deposit-refund-email`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      maHd: selectedClient.maHd,
                                      refundAmountVnd: parsed
                                    })
                                  });
                                  const data = (await res.json()) as { ok?: boolean; sentTo?: string; error?: string };
                                  if (!res.ok) {
                                    throw new Error(data.error ?? "Send failed");
                                  }
                                  setStatus(`Deposit refund email sent to ${data.sentTo ?? depositRefundPreview.clientEmail}.`);
                                  setDepositRefundOpen(false);
                                  setDepositRefundPreview(null);
                                  setDepositRefundInput("");
                                } catch (err) {
                                  setDepositRefundModalError(err instanceof Error ? err.message : "Send failed");
                                } finally {
                                  setDepositRefundSending(false);
                                }
                              }}
                              className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              {depositRefundSending ? "Sending…" : "Send email"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3">
                          {depositRefundModalError ? (
                            <p className="text-sm font-medium text-rose-600">{depositRefundModalError}</p>
                          ) : (
                            <p className="text-sm text-slate-600">{t("noPreviewLoaded")}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setDepositRefundOpen(false);
                              setDepositRefundModalError("");
                            }}
                            className="w-full rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <ManagerClientPanelCollapsible
                  title="Rent & package billing"
                  open={clientPanelSections.billing}
                  onToggle={() =>
                    setClientPanelSections((s) => ({
                      ...s,
                      billing: !s.billing
                    }))
                  }
                >
                {(() => {
                  const paymentPlan = String(selectedClient.row?.["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
                  const isOnPrepaidPlan = paymentPlan.includes("03 tháng") || paymentPlan.includes("06 tháng");
                  const billingMonth =
                    rentPaidMonth && /^\d{4}-\d{2}$/.test(rentPaidMonth)
                      ? rentPaidMonth
                      : new Date().toISOString().slice(0, 7);

                  if (isOnPrepaidPlan) {
                    const est = prepaidPkgEngineEstimate;
                    const parsedTotal = Math.round(Number(String(prepaidPkgTotalInput).replace(/[^\d.-]/g, "")));
                    const totalOk = Number.isFinite(parsedTotal) && parsedTotal >= 0;
                    return (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Multi-month package</div>
                            <div className="mt-0.5 text-sm font-medium text-slate-900">Billing month {billingMonth}</div>
                          </div>
                          {prepaidPkgBilling?.confirmed ? (
                            <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">Confirmed</span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-950">Draft</span>
                          )}
                        </div>

                        {prepaidPkgLoading ? (
                          <p className="text-xs text-slate-600 border-t border-slate-200 pt-3">Loading engine estimate…</p>
                        ) : est ? (
                          <div className="space-y-3 border-t border-slate-200 pt-3">
                            <button
                              type="button"
                              onClick={() => setPrepaidPkgBreakdownOpen((v) => !v)}
                              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100"
                            >
                              {prepaidPkgBreakdownOpen ? "Hide package estimate breakdown" : "Show package estimate breakdown"}
                            </button>
                            {prepaidPkgBreakdownOpen && prepaidDisplayEstimate ? (
                              <>
                                <PrepaidPackageBreakdownRows
                                  est={prepaidDisplayEstimate}
                                  billMonthLabel={formatBillingMonthLabel(billingMonth, language)}
                                  t={t}
                                  className="mt-0"
                                />
                                {canEditPrepaidOwnerLines && prepaidOwnerLineValues && prepaidPkgEngineEstimate ? (
                                  <div className="mt-3 space-y-2 rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-xs text-violet-950">
                                    <p className="font-semibold text-violet-950">
                                      {language === "vi" ? "Chủ sở hữu: chỉnh dòng gói (ghi đè máy tính)" : "Owner: package line overrides (not auto)"}
                                    </p>
                                    <p className="text-violet-900/85">
                                      {language === "vi"
                                        ? "Chỉnh các khoản ước tính (gói sau giảm, giặt, cổng, phạt). Phần tiền phòng theo sheet ở trên không chỉnh tại đây."
                                        : "Adjust estimated lines only (package after discount, laundry, gate, fines). Sheet rent lines above are not edited here."}
                                    </p>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <label className="block text-[11px] font-medium text-violet-900">
                                        {language === "vi" ? "Gói sau giảm (₫)" : "Package after discount (₫)"}
                                        <input
                                          type="number"
                                          min={0}
                                          step={1000}
                                          className="mt-0.5 w-full rounded border border-violet-200 bg-white px-2 py-1 text-sm text-slate-900"
                                          value={prepaidOwnerLineValues.packageNet}
                                          onChange={(e) => {
                                            const n = Math.round(Number(e.target.value));
                                            if (!Number.isFinite(n) || n < 0) return;
                                            setPrepaidOwnerLineValues((prev) => (prev ? { ...prev, packageNet: n } : prev));
                                          }}
                                        />
                                      </label>
                                      <label className="block text-[11px] font-medium text-violet-900">
                                        {language === "vi" ? "Giặt tiền mặt (₫)" : "Cash laundry (₫)"}
                                        <input
                                          type="number"
                                          min={0}
                                          step={1000}
                                          className="mt-0.5 w-full rounded border border-violet-200 bg-white px-2 py-1 text-sm text-slate-900"
                                          value={prepaidOwnerLineValues.laundry}
                                          onChange={(e) => {
                                            const n = Math.round(Number(e.target.value));
                                            if (!Number.isFinite(n) || n < 0) return;
                                            setPrepaidOwnerLineValues((prev) => (prev ? { ...prev, laundry: n } : prev));
                                          }}
                                        />
                                      </label>
                                      <label className="block text-[11px] font-medium text-violet-900">
                                        {language === "vi" ? "Gửi xe cổng (₫)" : "Gate parking (₫)"}
                                        <input
                                          type="number"
                                          min={0}
                                          step={1000}
                                          className="mt-0.5 w-full rounded border border-violet-200 bg-white px-2 py-1 text-sm text-slate-900"
                                          value={prepaidOwnerLineValues.gate}
                                          onChange={(e) => {
                                            const n = Math.round(Number(e.target.value));
                                            if (!Number.isFinite(n) || n < 0) return;
                                            setPrepaidOwnerLineValues((prev) => (prev ? { ...prev, gate: n } : prev));
                                          }}
                                        />
                                      </label>
                                      <label className="block text-[11px] font-medium text-violet-900">
                                        {language === "vi" ? "Phạt (₫)" : "Fines (₫)"}
                                        <input
                                          type="number"
                                          min={0}
                                          step={1000}
                                          className="mt-0.5 w-full rounded border border-violet-200 bg-white px-2 py-1 text-sm text-slate-900"
                                          value={prepaidOwnerLineValues.fines}
                                          onChange={(e) => {
                                            const n = Math.round(Number(e.target.value));
                                            if (!Number.isFinite(n) || n < 0) return;
                                            setPrepaidOwnerLineValues((prev) => (prev ? { ...prev, fines: n } : prev));
                                          }}
                                        />
                                      </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                      <button
                                        type="button"
                                        className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-50"
                                        onClick={() => {
                                          if (!prepaidDisplayEstimate) return;
                                          setPrepaidPkgTotalInput(String(suggestedTotalFromEstimate(prepaidDisplayEstimate)));
                                        }}
                                      >
                                        {language === "vi" ? "Điền tổng = các dòng" : "Set total from lines"}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-50"
                                        onClick={() => {
                                          if (!prepaidPkgEngineEstimate) return;
                                          const eng = prepaidPkgEngineEstimate;
                                          setPrepaidOwnerLineValues({
                                            packageNet: eng.packageRecurringSubtotalVnd,
                                            laundry: eng.laundryFeeVnd,
                                            fines: eng.finesVnd,
                                            gate: eng.gateParkingFeeVnd
                                          });
                                          setPrepaidPkgTotalInput(String(eng.estimatedTotalVnd));
                                        }}
                                      >
                                        {language === "vi" ? "Hoàn tác dòng (chưa lưu)" : "Reset lines (unsaved)"}
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </>
                            ) : null}
                            <label className="block text-xs font-medium text-slate-700">
                              Manager package total (₫)
                              <input
                                type="number"
                                min={0}
                                step={1000}
                                value={prepaidPkgTotalInput}
                                onChange={(e) => setPrepaidPkgTotalInput(e.target.value)}
                                className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-700">
                              Note to resident (optional)
                              <textarea
                                value={prepaidPkgNoteInput}
                                onChange={(e) => setPrepaidPkgNoteInput(e.target.value)}
                                rows={2}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                              />
                            </label>
                            {(prepaidPkgBilling?.lastAppNotifyAt || prepaidPkgBilling?.lastEmailNotifyAt) && (
                              <p className="text-xs text-slate-500">
                                Last notify — app: {prepaidPkgBilling?.lastAppNotifyAt ? formatCozoroDateTime(prepaidPkgBilling.lastAppNotifyAt) : "—"} · email:{" "}
                                {prepaidPkgBilling?.lastEmailNotifyAt ? formatCozoroDateTime(prepaidPkgBilling.lastEmailNotifyAt) : "—"}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-amber-950 border-t border-slate-200 pt-3">{t("noEngineEstimate")}</p>
                        )}

                        {!prepaidPkgLoading && est ? (
                          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                            <button
                              type="button"
                              disabled={prepaidPkgActionLoading || !totalOk}
                              onClick={async () => {
                                setPrepaidPkgActionLoading(true);
                                try {
                                  const ownerExtra: Record<string, unknown> = {};
                                  if (canEditPrepaidOwnerLines && prepaidPkgEngineEstimate && prepaidOwnerLineValues) {
                                    const diff = buildPrepaidOwnerLinesDiff(prepaidPkgEngineEstimate, prepaidOwnerLineValues);
                                    if (hasPrepaidBreakdownOverridesPayload(diff)) {
                                      ownerExtra.breakdownOverrides = diff;
                                    } else if (prepaidPkgBilling?.breakdownOverrides) {
                                      ownerExtra.clearBreakdownOverrides = true;
                                    }
                                  }
                                  const res = await fetch(`${API_BASE_URL}/manager/prepaid-package-billing`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      clientEmail: selectedClient.email,
                                      billingMonth,
                                      managerPackageTotalVnd: parsedTotal,
                                      managerNote: prepaidPkgNoteInput,
                                      ...ownerExtra
                                    })
                                  });
                                  const data = (await res.json()) as {
                                    error?: string;
                                    billing?: typeof prepaidPkgBilling;
                                    estimate?: PrepaidNextPaymentEstimatePayload;
                                    engineEstimate?: PrepaidNextPaymentEstimatePayload;
                                  };
                                  if (!res.ok || data.error) {
                                    setStatus(data.error ?? "Could not save package draft");
                                    return;
                                  }
                                  const engSaved = data.engineEstimate ?? data.estimate ?? null;
                                  if (engSaved) {
                                    setPrepaidPkgEngineEstimate(engSaved);
                                    const billSaved = data.billing;
                                    const mergedAfterSave = mergePrepaidEstimateWithOverrides(
                                      engSaved,
                                      (billSaved?.breakdownOverrides as PrepaidBreakdownOverridesPayload) ?? null
                                    );
                                    setPrepaidOwnerLineValues({
                                      packageNet: mergedAfterSave.packageRecurringSubtotalVnd,
                                      laundry: mergedAfterSave.laundryFeeVnd,
                                      fines: mergedAfterSave.finesVnd,
                                      gate: mergedAfterSave.gateParkingFeeVnd
                                    });
                                  }
                                  if (data.billing) setPrepaidPkgBilling(data.billing);
                                  setStatus("Package draft saved (re-confirm to lock amount).");
                                } catch {
                                  setStatus("Could not save package draft");
                                } finally {
                                  setPrepaidPkgActionLoading(false);
                                }
                              }}
                              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Save draft
                            </button>
                            <button
                              type="button"
                              disabled={prepaidPkgActionLoading || !prepaidPkgBilling}
                              onClick={async () => {
                                setPrepaidPkgActionLoading(true);
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/prepaid-package-billing/confirm`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      clientEmail: selectedClient.email,
                                      billingMonth
                                    })
                                  });
                                  const data = (await res.json()) as { error?: string; billing?: typeof prepaidPkgBilling };
                                  if (!res.ok || data.error) {
                                    setStatus(data.error ?? "Could not confirm package");
                                    return;
                                  }
                                  if (data.billing) setPrepaidPkgBilling(data.billing);
                                  setStatus("Package amount confirmed for the portal.");
                                } catch {
                                  setStatus("Could not confirm package");
                                } finally {
                                  setPrepaidPkgActionLoading(false);
                                }
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              disabled={prepaidPkgActionLoading || !prepaidPkgBilling?.confirmed}
                              onClick={async () => {
                                setPrepaidPkgActionLoading(true);
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/prepaid-package-billing/notify`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      clientEmail: selectedClient.email,
                                      billingMonth,
                                      clientName: selectedClient.name,
                                      notifyApp: true,
                                      notifyEmail: false
                                    })
                                  });
                                  const data = (await res.json()) as { error?: string; billing?: typeof prepaidPkgBilling };
                                  if (!res.ok || data.error) {
                                    setStatus(data.error ?? "Could not send in-app notification");
                                    return;
                                  }
                                  if (data.billing) setPrepaidPkgBilling(data.billing);
                                  setStatus("In-app notification sent.");
                                } catch {
                                  setStatus("Could not send in-app notification");
                                } finally {
                                  setPrepaidPkgActionLoading(false);
                                }
                              }}
                              className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                            >
                              Notify app
                            </button>
                            <button
                              type="button"
                              disabled={prepaidPkgActionLoading || !prepaidPkgBilling?.confirmed}
                              onClick={async () => {
                                setPrepaidPkgActionLoading(true);
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/prepaid-package-billing/notify`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      clientEmail: selectedClient.email,
                                      billingMonth,
                                      clientName: selectedClient.name,
                                      notifyApp: false,
                                      notifyEmail: true
                                    })
                                  });
                                  const data = (await res.json()) as { error?: string; billing?: typeof prepaidPkgBilling };
                                  if (!res.ok || data.error) {
                                    setStatus(data.error ?? "Could not send email");
                                    return;
                                  }
                                  if (data.billing) setPrepaidPkgBilling(data.billing);
                                  setStatus("Email sent.");
                                } catch {
                                  setStatus("Could not send email");
                                } finally {
                                  setPrepaidPkgActionLoading(false);
                                }
                              }}
                              className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                            >
                              Notify email
                            </button>
                            <button
                              type="button"
                              disabled={prepaidPkgActionLoading || !prepaidPkgBilling?.confirmed}
                              onClick={async () => {
                                setPrepaidPkgActionLoading(true);
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/prepaid-package-billing/notify`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      clientEmail: selectedClient.email,
                                      billingMonth,
                                      clientName: selectedClient.name,
                                      notifyApp: true,
                                      notifyEmail: true
                                    })
                                  });
                                  const data = (await res.json()) as { error?: string; billing?: typeof prepaidPkgBilling };
                                  if (!res.ok || data.error) {
                                    setStatus(data.error ?? "Could not notify");
                                    return;
                                  }
                                  if (data.billing) setPrepaidPkgBilling(data.billing);
                                  setStatus("In-app + email notifications sent.");
                                } catch {
                                  setStatus("Could not notify");
                                } finally {
                                  setPrepaidPkgActionLoading(false);
                                }
                              }}
                              className="rounded-lg border border-slate-400 px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
                            >
                              Notify both
                            </button>
                          </div>
                        ) : null}
                        <p className="text-xs text-slate-600">
                          Save draft recalculates the engine snapshot and clears confirmation until you confirm again. Notifications require a confirmed amount.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("monthlyRentLabel")}</div>
                            <InlineHelp
                              label={t("howMonthlyRentWorks")}
                              title={t("monthlyRentTitle")}
                              body={t(MANAGER_FUNCTION_HELP.monthlyRent)}
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
                          Expand for fee breakdown (zeros shown), parking override, and laundry from the prior calendar month. Gate parking uses unpaid tickets from Client Actions until rent is paid.
                        </p>
                      ) : infoRentCalculating ? (
                        <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">Calculating…</p>
                      ) : infoRentBreakdown ? (
                        <div className="space-y-1.5 border-t border-slate-200 pt-3 text-sm">
                          {rentCoinRedeemInfo ? (
                            <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5">
                              {language === "vi"
                                ? `Đã đổi coin cho hóa đơn: ${rentCoinRedeemInfo.coins.toLocaleString()} coin (≈ ${rentCoinRedeemInfo.valueVnd.toLocaleString()} ₫)${
                                    rentCoinRedeemInfo.at
                                      ? ` — ${new Date(rentCoinRedeemInfo.at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}`
                                      : ""
                                  }`
                                : `Coins exchanged for this bill: ${rentCoinRedeemInfo.coins.toLocaleString()} coins (≈ ${rentCoinRedeemInfo.valueVnd.toLocaleString()} VND)${
                                    rentCoinRedeemInfo.at
                                      ? ` — ${formatCozoroDateTime(rentCoinRedeemInfo.at)}`
                                      : ""
                                  }`}
                            </p>
                          ) : null}
                          {[
                            { label: t("baseRent"), value: infoRentBreakdown.baseRent ?? 0, color: "" },
                            {
                              label: `${t("tenureSurcharge")} (+${((infoRentBreakdown.tenureSurchargeRate ?? 0) * 100).toFixed(0)}%)`,
                              value: infoRentBreakdown.tenureSurchargeVnd ?? 0,
                              color: "text-amber-600"
                            },
                            {
                              label: t("monthlyAdjustmentSurcharge"),
                              value: Math.max(0, infoRentBreakdown.monthlyAdjustmentVnd ?? 0),
                              color: "text-amber-600"
                            },
                            {
                              label: t("monthlyAdjustmentDiscount"),
                              value: -(infoRentBreakdown.professionalDiscountVnd ?? 0),
                              color: "text-emerald-600"
                            },
                            { label: t("planDiscount"), value: -(infoRentBreakdown.planDiscountVnd ?? 0), color: "text-emerald-600" },
                            { label: t("managerDiscount"), value: -(infoRentBreakdown.managerDiscountVnd ?? 0), color: "text-emerald-600" },
                            { label: t("parkingFee"), value: infoRentBreakdown.parkingFeeVnd ?? 0, color: "" },
                            { label: t("gateParkingFeeDetail"), value: infoRentBreakdown.gateParkingFeeVnd ?? 0, color: "" },
                            {
                              label: t("laundryPriorMonthDetail", { month: infoRentBreakdown.details?.billingPrevMonth || "—", count: infoRentBreakdown.details?.laundryCount?.cash ?? 0 }),
                              value: infoRentBreakdown.laundryFeeVnd ?? 0,
                              color: ""
                            },
                            { label: t("unpaidFinesLabel"), value: infoRentBreakdown.finesVnd ?? 0, color: "" },
                            ...(infoRentBreakdown.maxCoinUsageVnd > 0 &&
                            infoRentBreakdown.coinRateVndPerCoin > 0 &&
                            (infoRentBreakdown.recommendedCoinValueVnd > 0 || rentCoinRedeemInfo)
                              ? ([
                                  {
                                    label: `Max coin credit (10% of bill): ${(infoRentBreakdown.maxCoinUsageVnd ?? 0).toLocaleString()} ₫`,
                                    value: 0,
                                    color: "text-slate-500"
                                  },
                                  {
                                    label: `1 coin = ${infoRentBreakdown.coinRateVndPerCoin} ₫ (tier ${infoRentBreakdown.details?.memberTier ?? ""})`,
                                    value: 0,
                                    color: "text-slate-500"
                                  },
                                  {
                                    label: `Cozoro Coins balance (sheet): ${(infoRentBreakdown.currentCoinsBalance ?? 0).toLocaleString()}`,
                                    value: 0,
                                    color: "text-slate-500"
                                  }
                                ] as const)
                              : []),
                            ...(infoRentBreakdown.recommendedCoinValueVnd > 0
                              ? ([
                                  {
                                    label: "Bill before coin credit",
                                    value: infoRentBreakdown.totalBeforeCoinsVnd ?? 0,
                                    color: ""
                                  },
                                  {
                                    label: `Coin credit (${infoRentBreakdown.recommendedCoinUsage} coins)`,
                                    value: -(infoRentBreakdown.recommendedCoinValueVnd ?? 0),
                                    color: "text-emerald-600"
                                  }
                                ] as const)
                              : [])
                          ].map((item) => (
                            <div key={item.label} className={`flex justify-between ${item.color || "text-slate-700"}`}>
                              <span>{item.label}</span>
                              <span className="font-medium">
                                {item.value === 0 && item.color === "text-slate-500" ? (
                                  <span className="text-slate-400">—</span>
                                ) : (
                                  <>
                                    {item.value < 0 ? "−" : ""}
                                    {Math.abs(item.value).toLocaleString()} ₫
                                  </>
                                )}
                              </span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between border-t border-slate-200 pt-2 gap-2">
                            <span className="font-bold text-slate-900">Total due (cash)</span>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{(infoRentBreakdown.finalTotalVnd ?? 0).toLocaleString()} ₫</span>
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
                        <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">{t("noBreakdownAvailable")}</p>
                      )}

                      {!rentSectionCollapsed ? (
                      <div className="space-y-2 border-t border-slate-200 pt-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                        </div>
                        <button
                          type="button"
                          disabled={infoRentCalculating || !selectedClient}
                          onClick={() =>
                            void recalcInfoBreakdown(
                              selectedClient.email,
                              infoManagerDiscount,
                              infoShortTermSurchargeRate,
                              infoParkingFee
                            )
                          }
                          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {infoRentCalculating ? "…" : "Recalc"}
                        </button>
                      </div>
                      ) : null}
                    </div>
                  );
                })()}
                </ManagerClientPanelCollapsible>

                <ManagerClientPanelCollapsible
                  title="Sheet columns (all fields)"
                  open={showClientDetails || isEditingClientProfile}
                  onToggle={() => {
                    if (!isEditingClientProfile) {
                      setShowClientDetails((v) => !v);
                    }
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-2">
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
                </ManagerClientPanelCollapsible>
              </div>
            ) : null}
          </section>

          {activeAction ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
                              : activeAction === "reminder"
                                ? "Send notification"
                              : activeAction === "payment"
                                  ? t("createPaymentReceipt")
                                : activeAction === "fine"
                                  ? t("createFineTicket")
                                  : activeAction === "password"
                                    ? t("changePassword", "Change password")
                                    : activeAction === "gateParking"
                                      ? t("gateParkingTickets")
                                      : t("createCoinsEntry")}
                    </h3>
                    <InlineHelp
                      label={t("howClientActionsWork")}
                      title={t("clientActionsTitle")}
                      body={t(MANAGER_FUNCTION_HELP.clientActions)}
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
                          const isAssistant = message.senderRole === "ASSISTANT";
                          return (
                            <div
                              key={message.id}
                              className={`flex ${isResident ? "justify-start" : "justify-end"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                                  isResident
                                    ? "bg-slate-100 text-slate-900"
                                    : isAssistant
                                      ? "bg-violet-700 text-white"
                                      : "bg-slate-900 text-white"
                                }`}
                              >
                                <div
                                  className={`text-xs font-semibold ${
                                    isResident ? "text-slate-500" : isAssistant ? "text-violet-200" : "text-slate-200"
                                  }`}
                                >
                                  {chatRoleLabel(message.senderRole)} · {message.senderName?.trim() || message.senderEmail}
                                </div>
                                <div className="mt-1 whitespace-pre-wrap">{message.body}</div>
                                <div
                                  className={`mt-2 text-xs ${
                                    isResident ? "text-slate-500" : isAssistant ? "text-violet-200" : "text-slate-300"
                                  }`}
                                >
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

                {activeAction === "reminder" ? (
                  <div className="mt-4 space-y-3">
                    <label className="block text-sm font-medium text-slate-700">
                      Title
                      <input
                        type="text"
                        value={paymentReminderTitle}
                        onChange={(event) => setPaymentReminderTitle(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Reminder message
                      <textarea
                        value={paymentReminderBody}
                        onChange={(event) => setPaymentReminderBody(event.target.value)}
                        rows={4}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={sendReminderPopup} onChange={(event) => setSendReminderPopup(event.target.checked)} />
                        Popup
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={sendReminderInApp} onChange={(event) => setSendReminderInApp(event.target.checked)} />
                        In-app message
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={sendReminderEmail} onChange={(event) => setSendReminderEmail(event.target.checked)} />
                        Email
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={sendReminderEnglishCopy}
                          onChange={(event) => setSendReminderEnglishCopy(event.target.checked)}
                          disabled={!sendReminderEmail}
                        />
                        English copy (email)
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/manager/payment-reminders/send`,
                          {
                            actorEmail: normalizedEmail,
                            mode: "single",
                            email: selectedClient?.email ?? "",
                            title: paymentReminderTitle.trim() || "Nhắc thanh toán tiền phòng",
                            body: paymentReminderBody.trim(),
                            sendPopup: sendReminderPopup,
                            sendInAppMessage: sendReminderInApp,
                            sendEmail: sendReminderEmail,
                            includeEnglishCopy: sendReminderEnglishCopy
                          },
                          "Payment reminder sent."
                        )
                      }
                      disabled={
                        loading ||
                        !selectedClient ||
                        !paymentReminderBody.trim() ||
                        (!sendReminderPopup && !sendReminderInApp && !sendReminderEmail)
                      }
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Send notification
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
                              {[
                                { label: t("baseRent"), value: rentBreakdown.baseRent, tone: "neutral" as const },
                                {
                                  label: `${t("tenureSurcharge")} (${(rentBreakdown.tenureSurchargeRate * 100).toFixed(0)}%)`,
                                  value: rentBreakdown.tenureSurchargeVnd,
                                  tone: "amber" as const
                                },
                                {
                                  label: t("monthlyAdjustmentSurcharge"),
                                  value: Math.max(0, rentBreakdown.monthlyAdjustmentVnd ?? 0),
                                  tone: "amber" as const
                                },
                                {
                                  label: t("monthlyAdjustmentDiscount"),
                                  value: -(rentBreakdown.professionalDiscountVnd ?? 0),
                                  tone: "discount" as const
                                },
                                { label: t("planDiscount"), value: -(rentBreakdown.planDiscountVnd ?? 0), tone: "discount" as const },
                                { label: t("managerDiscount"), value: -(rentBreakdown.managerDiscountVnd ?? 0), tone: "discount" as const },
                                { label: t("parkingFee"), value: rentBreakdown.parkingFeeVnd, tone: "neutral" as const },
                                {
                                  label: t("gateParkingFeeDetail"),
                                  value: rentBreakdown.gateParkingFeeVnd ?? 0,
                                  tone: "neutral" as const
                                },
                                {
                                  label: t("laundryPriorMonthDetail", { month: rentBreakdown.details?.billingPrevMonth || "—", count: rentBreakdown.details?.laundryCount?.cash ?? 0 }),
                                  value: rentBreakdown.laundryFeeVnd,
                                  tone: "neutral" as const
                                },
                                { label: t("unpaidFinesLabel"), value: rentBreakdown.finesVnd, tone: "neutral" as const }
                              ].map((row) => (
                                <div
                                  key={row.label}
                                  className={`flex justify-between ${
                                    row.tone === "amber"
                                      ? "text-amber-600"
                                      : row.tone === "discount"
                                        ? "text-emerald-600"
                                        : ""
                                  }`}
                                >
                                  <span className={row.tone === "neutral" ? "text-slate-600" : ""}>{row.label}</span>
                                  <span className="font-medium">
                                    {row.value < 0 ? "−" : ""}
                                    {Math.abs(row.value).toLocaleString()} VND
                                  </span>
                                </div>
                              ))}

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
                                placeholder={paymentPurposeSelections.length ? t("searchOrTypeNew") : t("selectExistingOrTypeNew")}
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
                                  <div className="px-3 py-2 text-sm text-slate-400">{t("noExistingValuesYet")}</div>
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
                      {fineLabels.eventDateTime}
                      <input
                        type="datetime-local"
                        value={fineEventAt}
                        onChange={(event) => setFineEventAt(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">{fineLabels.eventDateTimeHint}</span>
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
                        accept="image/*,video/*"
                        multiple
                        disabled={fineAttachmentUploading || loading || !selectedClient}
                        onChange={async (event) => {
                          const files = Array.from(event.target.files ?? []);
                          event.currentTarget.value = "";
                          if (!files.length) {
                            return;
                          }

                          setFineAttachmentUploading(true);
                          setStatus("");
                          try {
                            for (const file of files) {
                              await uploadFineAttachment(file);
                            }
                            setStatus(t("fineImageUploaded"));
                          } catch {
                            setStatus(t("unableToUploadFineImage"));
                          } finally {
                            setFineAttachmentUploading(false);
                          }
                        }}
                        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                      />
                      {fineAttachmentUploading ? <p className="text-sm text-slate-600">{fineUiText.uploading}</p> : null}
                      {fineAttachments.length > 0 ? (
                        <div className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-3">
                          <p className="text-sm text-emerald-700">{fineUiText.uploaded}</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {fineAttachments.map((attachment, index) => {
                              const driveId = getDriveFileIdFromUrl(attachment.downloadUrl || attachment.url);
                              return (
                                <div key={`${attachment.url}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-slate-800">{attachment.fileName}</p>
                                      <p className="text-[11px] text-slate-500">{attachment.evidenceKind.toUpperCase()}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setFineAttachments((current) => current.filter((item) => item.url !== attachment.url || item.fileName !== attachment.fileName))
                                      }
                                      className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                                    >
                                      {t("removeLabel")}
                                    </button>
                                  </div>
                                  <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs font-medium text-sky-700 underline">
                                    {attachment.url}
                                  </a>
                                  {driveId ? (
                                    <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-black">
                                      <iframe
                                        title={attachment.fileName}
                                        src={`https://drive.google.com/file/d/${driveId}/preview`}
                                        className="h-full w-full"
                                        allowFullScreen
                                      />
                                    </div>
                                  ) : attachment.evidenceKind === "video" ? (
                                    <video src={attachment.url} controls className="mt-2 max-h-56 w-full rounded-lg bg-black" />
                                  ) : (
                                    <img src={attachment.url} alt="" className="mt-2 max-h-56 w-full rounded-lg object-contain" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-sky-900">Fine ticket preview</p>
                        <span className="text-xs font-medium text-sky-700">{fineAttachments.length} attachment(s)</span>
                      </div>
                      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                        <div><span className="font-medium">Content:</span> {fineContent || "-"}</div>
                        <div><span className="font-medium">Amount:</span> {Number(fineAmount || 0).toLocaleString()} VND</div>
                        <div><span className="font-medium">Location:</span> {fineLocation || "-"}</div>
                        <div><span className="font-medium">Due date:</span> {fineDueDate || "-"}</div>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-white p-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">{selectedClient?.name || selectedClient?.email || "-"}</p>
                        <p className="mt-1 text-xs text-slate-500">{selectedClient?.email || "-"}</p>
                        {fineDescription ? <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{fineDescription}</p> : null}
                      </div>
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
                          {
                            maHd: selectedClient?.maHd ?? "",
                            amount: Number(fineAmount),
                            content: fineContent,
                            description: fineDescription,
                            location: fineLocation,
                            dueDate: fineDueDate || undefined,
                            eventAt: fineEventAt.trim() || undefined,
                            image: fineAttachments[0]?.url,
                            attachments: fineAttachments.map((attachment) => ({
                              url: attachment.url,
                              downloadUrl: attachment.downloadUrl,
                              fileName: attachment.fileName,
                              mimeType: attachment.mimeType
                            })),
                            operator: normalizedEmail
                          },
                          t("fineTicketCreated"),
                          async () => {
                            if (selectedClient) await loadWorkspace("fines", selectedClient.maHd);
                            setFineContent("");
                            setFineDescription("");
                            setFineLocation("");
                            setFineDueDate("");
                            setFineEventAt("");
                            setFineAttachments([]);
                          }
                        )
                      }
                      disabled={loading || fineAttachmentUploading || !selectedClient || !fineContent.trim()}
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
                              {translateCoinEvent(option, t)}
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

              {activeAction === "gateParking" ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-slate-600">{t("gateParkingRollIntoRentDesc")}</p>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{t("gateParkingTickets")}</p>
                      {gateTicketsLoading ? (
                        <span className="text-xs text-slate-400">{t("gateParkingLoading")}</span>
                      ) : null}
                    </div>
                    {gateParkingTickets.length === 0 ? (
                      <p className="text-sm text-slate-500">{t("gateParkingTicketsEmptyHint")}</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {gateParkingTickets.map((tk) => (
                          <div
                            key={tk.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="text-xs text-slate-500">
                                {formatGateSessionDisplay(tk.sessionStartAt, language)}
                                <span className="mx-1.5 text-slate-300">·</span>
                                {formatGateDurationHours(tk.durationHours)}{" "}
                                {t("gateParkingHoursUnit")}
                              </p>
                              <p className="font-mono text-slate-800">
                                {t("gateParkingBillingMonthShort")}: {tk.periodMonth}
                                <span className="mx-1.5 font-sans text-slate-300">·</span>
                                <span className="font-semibold">{tk.amountVnd.toLocaleString("vi-VN")} ₫</span>
                              </p>
                            </div>
                            <span className={tk.paidAt ? "text-emerald-600" : "text-amber-600"}>
                              {tk.paidAt ? t("paidLabel") : t("unpaidLabel")}
                            </span>
                            <div className="flex gap-2 ml-auto">
                              <button
                                type="button"
                                onClick={() => void updateGateTicketPaid(tk.id, !tk.paidAt)}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                              >
                                {tk.paidAt ? t("gateParkingButtonUnpay") : t("gateParkingButtonMarkPaid")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeGateTicket(tk.id)}
                                className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                              >
                                {t("deleteLabel")}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 items-end border-t border-slate-100 pt-3">
                      <label className="block text-xs font-medium text-slate-600">
                        {t("gateParkingSessionStartLabel")}
                        <input
                          type="datetime-local"
                          value={gateNewSessionStart}
                          onChange={(e) => setGateNewSessionStart(e.target.value)}
                          className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        {t("gateParkingDurationHoursLabel")}
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={gateNewDurationHours}
                          onChange={(e) => {
                            const v = e.target.value;
                            setGateNewDurationHours(v);
                            const h = Number(v);
                            if (Number.isFinite(h) && h > 0) {
                              setGateNewAmount(String(gateParkingSuggestedAmountVnd(h)));
                            }
                          }}
                          className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <p className="w-full text-[11px] text-slate-400">
                        {t("gateParkingRateAutoHint", {
                          rate: `${GATE_PARKING_VND_PER_HOUR.toLocaleString(language === "vi" ? "vi-VN" : "en-US")} ₫`
                        })}
                      </p>
                      <label className="block text-xs font-medium text-slate-600">
                        {t("gateParkingBillingMonthOptional")}
                        <input
                          type="month"
                          value={gateNewBillingMonthOverride}
                          onChange={(e) => setGateNewBillingMonthOverride(e.target.value)}
                          className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <p className="w-full text-[11px] text-slate-400">{t("gateParkingBillingMonthOptionalHint")}</p>
                      <label className="block text-xs font-medium text-slate-600">
                        {t("gateParkingAmountLabel")}
                        <input
                          type="number"
                          min={0}
                          value={gateNewAmount}
                          onChange={(e) => setGateNewAmount(e.target.value)}
                          className="mt-1 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block min-w-[140px] flex-1 text-xs font-medium text-slate-600">
                        {t("gateParkingNoteLabel")}
                        <input
                          type="text"
                          value={gateNewNote}
                          onChange={(e) => setGateNewNote(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          placeholder={t("optionalShort")}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={loading || !selectedClient}
                        onClick={() => void createGateParkingTicketForSelected()}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {t("gateParkingAddTicket")}
                      </button>
                    </div>
                  </div>
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
            </section>
          ) : null}

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
                          ? t("analyticsPaymentsWithCount", { count: workspace.stats.payments.length })
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
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Nội dung vi phạm" : "Violation") : activeTab === "coins" ? "Coins" : `${t("detailLabel")} 1`}</th>
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Người lập phiếu" : "Created by") : activeTab === "coins" ? "Sự kiện" : `${t("detailLabel")} 2`}</th>
                            <th className="px-4 py-3 font-medium">{activeTab === "fines" ? (language === "vi" ? "Chi phí" : "Amount") : activeTab === "coins" ? "Người thao tác" : `${t("detailLabel")} 3`}</th>
                            {activeTab === "fines" ? (
                              <th className="px-4 py-3 font-medium whitespace-nowrap">{language === "vi" ? "Đã thanh toán" : "Paid"}</th>
                            ) : null}
                          </>
                        )}
                        <th className="px-4 py-3 font-medium">{t("clientActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {(activeTab === "coins" ? workspace.stats.coins : activeTab === "payments" ? workspace.stats.payments : workspace.stats.fines).map((entry) => {
                        const key = makeWorkspaceStatsEntryKey(
                          activeTab as Exclude<StatsTab, "laundry">,
                          entry
                        );
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
                                {activeTab === "coins" ? (
                                  <>
                                    <td className="px-4 py-3 font-medium" style={{ color: Number(entry.row["COINS"] ?? "0") >= 0 ? "#16a34a" : "#dc2626" }}>{entry.row["COINS"] ? `${Number(entry.row["COINS"]) >= 0 ? "+" : ""}${Number(entry.row["COINS"]).toLocaleString()}` : "-"}</td>
                                    <td className="px-4 py-3 text-slate-700">{entry.row["Sự kiện"] || "-"}</td>
                                    <td className="px-4 py-3 text-slate-500">{entry.row["Người thao tác"] || (language === "vi" ? "Hệ thống" : "System")}</td>
                                  </>
                                ) : activeTab === "fines" ? (
                                  <>
                                    <td className="px-4 py-3 text-slate-700">{fineContent || "-"}</td>
                                    <td className="px-4 py-3 text-slate-700">{fineCreator || "-"}</td>
                                    <td className="px-4 py-3 text-slate-700">{fineAmount ? `${Number(fineAmount).toLocaleString()} ₫` : "-"}</td>
                                    <td className="px-4 py-3">
                                      {(() => {
                                        const statusColumnKey = findFinePaidStatusColumnKey(entry.row);
                                        if (!statusColumnKey) {
                                          return <span className="text-xs text-slate-400">—</span>;
                                        }
                                        const paid = (entry as FineEntry).coinPayment?.isPaid === true;
                                        const saving = finePaidSavingKey === key;
                                        const fineEmail = String(entry.row.EMAIL ?? selectedClient?.email ?? "").trim();
                                        const fineTs = String(entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? "").trim();
                                        const fineCt = String(entry.row["NỘI DUNG VI PHẠM"] ?? "").trim();
                                        if (!fineEmail || !fineTs || !fineCt) {
                                          return <span className="text-xs text-slate-400">—</span>;
                                        }
                                        return (
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={paid}
                                            aria-label={language === "vi" ? "Đánh dấu đã thanh toán" : "Mark fine paid"}
                                            disabled={saving}
                                            onClick={() =>
                                              void patchFinePaidToggle({
                                                rowKey: key,
                                                residentEmail: fineEmail,
                                                timestamp: fineTs,
                                                content: fineCt,
                                                statusColumnKey,
                                                nextPaid: !paid
                                              })
                                            }
                                            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                                              paid ? "bg-emerald-500" : "bg-slate-300"
                                            }`}
                                          >
                                            <span
                                              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                                paid ? "translate-x-6" : "translate-x-1"
                                              }`}
                                            />
                                          </button>
                                        );
                                      })()}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-4 py-3 text-slate-700">{preview[1] ? `${preview[1][0]}: ${preview[1][1]}` : "-"}</td>
                                    <td className="px-4 py-3 text-slate-700">{preview[2] ? `${preview[2][0]}: ${preview[2][1]}` : "-"}</td>
                                    <td className="px-4 py-3 text-slate-700">{preview[3] ? `${preview[3][0]}: ${preview[3][1]}` : "-"}</td>
                                  </>
                                )}
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
                  const key = makeWorkspaceStatsEntryKey(
                    activeTab as Exclude<StatsTab, "laundry">,
                    entry
                  );
                  const isEditing = editingId === `${activeTab}:${key}`;
                  if (!isEditing) {
                    return null;
                  }
                  return (
                    <div key={key} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
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
                <h2 className="text-xl font-bold text-slate-900">
                  {managerSettingsMainSection === "tools"
                    ? t("settingsToolsTitle")
                    : managerSettingsMainSection === "resident_guides"
                      ? t("settingsResidentGuidesTitle")
                      : pricingSettingsTab === "referral"
                        ? language === "vi"
                          ? "Chương trình giới thiệu"
                          : "Referral program"
                        : t("pricing")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {managerSettingsMainSection === "tools"
                    ? t("settingsToolsDesc")
                    : managerSettingsMainSection === "resident_guides"
                      ? t("settingsResidentGuidesDesc")
                      : pricingSettingsTab === "referral"
                        ? language === "vi"
                          ? "Bật/tắt, mức giảm một lần trên thanh toán lần đầu và Cozoro coins cho cư dân mới và người giới thiệu."
                          : "Toggle the program and set one-time first-payment discount and Cozoro coins for new residents and referrers."
                        : t("pricingDesc")}
                </p>
              </div>
              {managerSettingsMainSection === "pricing" && pricingSettingsTab !== "referral" ? (
                <button type="button" onClick={() => void loadPricingConfig()} disabled={pricingConfigLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50">
                  {pricingConfigLoading ? t("refreshing") : t("refreshData")}
                </button>
              ) : null}
              {managerSettingsMainSection === "pricing" && pricingSettingsTab === "referral" ? (
                <button
                  type="button"
                  onClick={() => void loadReferralProgramSettings()}
                  disabled={referralProgramLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
                >
                  {referralProgramLoading ? t("refreshing") : t("refreshData")}
                </button>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(["pricing", "resident_guides", "tools"] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setManagerSettingsMainSection(sec)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    managerSettingsMainSection === sec ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {sec === "pricing"
                    ? t("pricing")
                    : sec === "resident_guides"
                      ? t("settingsResidentGuidesTab")
                      : t("settingsToolsTab")}
                </button>
              ))}
            </div>
            {managerSettingsMainSection === "pricing" ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-600/60">
                {(["long_term", "short_term", "referral", "staff"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setPricingSettingsTab(tab);
                      if (tab === "referral") {
                        void loadReferralProgramSettings();
                      }
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      pricingSettingsTab === tab ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {tab === "long_term"
                      ? t("longTermTab")
                      : tab === "short_term"
                        ? t("shortTermTab")
                        : tab === "referral"
                          ? language === "vi"
                            ? "Giới thiệu"
                            : "Referral"
                          : t("staffAccountsTab")}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── Long-term tab: bed price diagram + discounts ── */}
          {managerSettingsMainSection === "pricing" && pricingSettingsTab === "long_term" ? (
            <section className="space-y-5">
              {isStaffSession ? (
                <CollapsibleSettingsSection
                  title={t("parkingTiersTitle")}
                  description={t("parkingTiersDesc")}
                  expanded={pricingSettingsExpanded.parking_tiers}
                  onToggle={() => togglePricingSettingsSection("parking_tiers")}
                >
                  {pricingConfigLoading ? (
                    <p className="text-sm text-slate-500">{t("refreshing")}</p>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-2">
                      {(["D2", "D7"] as const).map((branchId) => {
                        const draft = parkingAddDraft[branchId];
                        return (
                          <div key={branchId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                            <p className="text-sm font-semibold text-slate-900">{branchId}</p>
                            <ul className="space-y-2">
                              {(pricingData?.parkingTiers ?? [])
                                .filter((x) => x.branchId === branchId)
                                .map((tier) => (
                                  <li
                                    key={tier.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium text-slate-900 truncate">{tier.labelEn}</p>
                                      <p className="text-xs text-slate-500 truncate">{tier.labelVi}</p>
                                      <p className="text-xs font-semibold text-amber-800 mt-0.5">
                                        {tier.feeVnd.toLocaleString("vi-VN")} ₫/mo · #{tier.sortOrder}
                                        {!tier.active ? (
                                          <span className="text-rose-600">{language === "vi" ? " (ngưng)" : " (inactive)"}</span>
                                        ) : null}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                                      onClick={async () => {
                                        if (!window.confirm("Delete this parking plan?")) return;
                                        const res = await fetch(
                                          `${API_BASE_URL}/manager/pricing/parking-tiers?actorEmail=${encodeURIComponent(normalizedEmail)}&id=${encodeURIComponent(tier.id)}`,
                                          { method: "DELETE" }
                                        );
                                        const data = (await res.json()) as { error?: string };
                                        if (!res.ok) {
                                          setStatus(data.error ?? "Delete failed");
                                          return;
                                        }
                                        setPricingData((prev) =>
                                          prev ? { ...prev, parkingTiers: (prev.parkingTiers ?? []).filter((p) => p.id !== tier.id) } : prev
                                        );
                                      }}
                                    >
                                      {t("parkingTierDelete")}
                                    </button>
                                  </li>
                                ))}
                            </ul>
                            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 space-y-2">
                              <p className="text-xs font-semibold text-slate-700">{t("parkingTierAdd")}</p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="block text-xs text-slate-600">
                                  {t("parkingTierLabelEn")}
                                  <input
                                    value={draft.labelEn}
                                    onChange={(e) =>
                                      setParkingAddDraft((prev) => ({
                                        ...prev,
                                        [branchId]: { ...prev[branchId], labelEn: e.target.value }
                                      }))
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-slate-600">
                                  {t("parkingTierLabelVi")}
                                  <input
                                    value={draft.labelVi}
                                    onChange={(e) =>
                                      setParkingAddDraft((prev) => ({
                                        ...prev,
                                        [branchId]: { ...prev[branchId], labelVi: e.target.value }
                                      }))
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-slate-600">
                                  {t("parkingTierFeeVnd")}
                                  <input
                                    type="number"
                                    min={0}
                                    value={draft.feeVnd}
                                    onChange={(e) =>
                                      setParkingAddDraft((prev) => ({
                                        ...prev,
                                        [branchId]: { ...prev[branchId], feeVnd: e.target.value }
                                      }))
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-slate-600">
                                  {t("parkingTierSort")}
                                  <input
                                    type="number"
                                    value={draft.sortOrder}
                                    onChange={(e) =>
                                      setParkingAddDraft((prev) => ({
                                        ...prev,
                                        [branchId]: { ...prev[branchId], sortOrder: e.target.value }
                                      }))
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                                onClick={async () => {
                                  const fee = Math.round(Number(draft.feeVnd) || 0);
                                  if (!draft.labelEn.trim() && !draft.labelVi.trim()) {
                                    setStatus("Enter at least one label (English or Vietnamese).");
                                    return;
                                  }
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/parking-tiers`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      actorEmail: normalizedEmail,
                                      branchId,
                                      labelEn: draft.labelEn.trim() || draft.labelVi.trim(),
                                      labelVi: draft.labelVi.trim() || draft.labelEn.trim(),
                                      feeVnd: fee,
                                      sortOrder: Math.round(Number(draft.sortOrder) || 0),
                                      active: true
                                    })
                                  });
                                  const data = (await res.json()) as { ok?: boolean; row?: ParkingPricingTierRow; error?: string };
                                  if (!res.ok || !data.ok || !data.row) {
                                    setStatus(data.error ?? "Save failed");
                                    return;
                                  }
                                  setPricingData((prev) =>
                                    prev ? { ...prev, parkingTiers: [...(prev.parkingTiers ?? []), data.row!] } : prev
                                  );
                                  setParkingAddDraft((prev) => ({
                                    ...prev,
                                    [branchId]: { labelEn: "", labelVi: "", feeVnd: "0", sortOrder: "0" }
                                  }));
                                  setStatus("Parking plan saved.");
                                }}
                              >
                                {t("parkingTierSave")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSettingsSection>
              ) : null}

              {!canManageOwnersEmployees ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-slate-600">{t("parkingTiersManagerNote")}</p>
                </div>
              ) : (
                <>
                  {/* ── Branch pricing settings (cleaning opt-out fee, parking fee) ── */}
                  <CollapsibleSettingsSection
                    title={t("branchFeeSettings")}
                    description={t("branchFeeSettingsDesc")}
                    expanded={pricingSettingsExpanded.branch_fees}
                    onToggle={() => togglePricingSettingsSection("branch_fees")}
                  >
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">{t("refreshing")}</p> : (
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
                                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white">{t("editLabel")}</button>
                                )}
                              </div>
                              {isEditing ? (
                                <div className="space-y-3">
                                  <label className="space-y-1 block">
                                    <span className="text-xs font-medium text-slate-700">{t("cleaningOptOutFeeLabel")}</span>
                                    <input type="number" min={0} value={branchSettingsEdit!.cleaningOptOutFeeVnd}
                                      onChange={(e) => setBranchSettingsEdit({ ...branchSettingsEdit!, cleaningOptOutFeeVnd: e.target.value })}
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                                  </label>
                                  <label className="space-y-1 block">
                                    <span className="text-xs font-medium text-slate-700">{t("defaultParkingFeeLabel")}</span>
                                    <input type="number" min={0} value={branchSettingsEdit!.parkingFeeVnd}
                                      onChange={(e) => setBranchSettingsEdit({ ...branchSettingsEdit!, parkingFeeVnd: e.target.value })}
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                                  </label>
                                  {branchSettingsEdit!.result ? <p className={`text-sm font-medium ${branchSettingsEdit!.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{branchSettingsEdit!.result}</p> : null}
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setBranchSettingsEdit(null)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">{t("cancel")}</button>
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
                                    }} className="rounded-xl bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{branchSettingsEdit!.saving ? t("saving") : t("saveLabel")}</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1 text-sm text-slate-600">
                                  <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{t("cleaningOptOutFeeShort")}</span><span className="font-semibold">{settings.cleaningOptOutFeeVnd.toLocaleString("vi-VN")} ₫/mo</span></div>
                                  <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{t("defaultParkingFeeShort")}</span><span className="font-semibold">{settings.parkingFeeVnd.toLocaleString("vi-VN")} ₫/mo</span></div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CollapsibleSettingsSection>

                  <CollapsibleSettingsSection
                    title={t("residentPortalUxTitle")}
                    description={t("blockingRentDuePopupHelp")}
                    expanded={pricingSettingsExpanded.resident_portal}
                    onToggle={() => togglePricingSettingsSection("resident_portal")}
                  >
                    <div className="space-y-4">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={portalUxBlockingRent}
                          onChange={(event) => setPortalUxBlockingRent(event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <span className="text-sm font-medium text-slate-800">{t("blockingRentDuePopupLabel")}</span>
                      </label>
                      {portalUxMessage === "__ok__" ? (
                        <p className="text-sm font-medium text-emerald-700">{t("portalUxSettingsSaved")}</p>
                      ) : portalUxMessage ? (
                        <p className="text-sm font-medium text-rose-700">{portalUxMessage}</p>
                      ) : null}
                      <button
                        type="button"
                        disabled={portalUxSaving || !normalizedEmail}
                        onClick={async () => {
                          setPortalUxSaving(true);
                          setPortalUxMessage("");
                          try {
                            const res = await fetch(`${API_BASE_URL}/manager/portal-ux-settings`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                actorEmail: normalizedEmail,
                                blockingRentDuePopupEnabled: portalUxBlockingRent
                              })
                            });
                            const data = (await res.json()) as { error?: string };
                            if (!res.ok) {
                              throw new Error(data.error ?? "Failed to save");
                            }
                            setPortalUxMessage("__ok__");
                          } catch (err) {
                            setPortalUxMessage(err instanceof Error ? err.message : "Failed");
                          } finally {
                            setPortalUxSaving(false);
                          }
                        }}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {portalUxSaving ? t("saving") : t("savePortalUxSettings")}
                      </button>
                    </div>
                  </CollapsibleSettingsSection>

                  {/* ── Bed pricing diagram (collapsible) ── */}
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <button type="button" onClick={() => setBedPricingExpanded((v) => !v)}
                      className="flex w-full items-center justify-between px-6 py-5 text-left hover:bg-slate-50 transition-colors">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{t("bedPricesMonthly")}</h3>
                        <p className="mt-0.5 text-sm text-slate-500">{t("bedPricesMonthlyDesc")}</p>
                      </div>
                      <span className="text-slate-400 text-xl">{bedPricingExpanded ? "▲" : "▼"}</span>
                    </button>
                    {bedPricingExpanded && (
                    <div className="border-t border-slate-100 p-5 space-y-5">
                  {/* Mode selector */}
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-sm font-medium text-slate-700 mr-1">{t("editMode")}</span>
                      {([
                        { key: "by_branch", label: "By branch + tier", desc: "Set one price for all beds of a tier across an entire branch" },
                        { key: "by_room", label: "By room + tier", desc: "Set price for all beds of a tier within a specific room" },
                        { key: "per_bed", label: "Per bed", desc: "Click any individual bed to set its exact price" }
                      ] as const).map(({ key, label, desc }) => (
                        <button key={key} type="button" onClick={() => { setPricingDiagramMode(key); setBulkTierEdit(null); setBedOverrideEdit(null); }}
                          title={t(key === "by_branch" ? "byBranchDesc" : key === "by_room" ? "byRoomDesc" : "perBedDesc")}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${pricingDiagramMode === key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                          {key === "by_branch" ? t("byBranchTier") : key === "by_room" ? t("byRoomTier") : t("perBedBase")}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {pricingDiagramMode === "by_branch" && t("byBranchDesc")}
                      {pricingDiagramMode === "by_room" && t("byRoomDesc")}
                      {pricingDiagramMode === "per_bed" && t("perBedDesc")}
                    </p>
                  </div>

                  {/* ── By-branch bulk mode ── */}
                  {pricingDiagramMode === "by_branch" ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-base font-semibold text-slate-900">{t("setPriceByBranchTier")}</h3>
                      <p className="text-sm text-slate-500">{t("setPriceByBranchTierDesc")}</p>
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
                                    <div className="text-xs font-bold text-slate-500">{tier === "top" ? t("topBunk").charAt(0) : tier === "middle" ? t("middleBunk").charAt(0) : t("bottomBunk").charAt(0)}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{overrideCount}/{matchingBeds.length} {t("setSuffix")}</div>
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
                            {t("setPriceLabel")} — {bulkTierEdit.branchId} · {t("allTiersBeds", { tier: bulkTierEdit.tier === "top" ? t("topBunk") : bulkTierEdit.tier === "middle" ? t("middleBunk") : t("bottomBunk") })}
                          </p>
                          <div className="flex items-end gap-3 flex-wrap">
                            <label className="space-y-1 flex-1 min-w-[140px]">
                              <span className="text-xs font-medium text-slate-700">{t("monthlyPriceVnd")}</span>
                              <input type="number" min={0} value={bulkTierEdit.monthlyPrice}
                                onChange={(e) => setBulkTierEdit({ ...bulkTierEdit, monthlyPrice: e.target.value })}
                                placeholder={t("resetToSheetPlaceholder")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
                            </label>
                          </div>
                          {bulkTierEdit.result ? <p className={`text-sm font-medium ${bulkTierEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bulkTierEdit.result}</p> : null}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setBulkTierEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">{t("cancel")}</button>
                            <button type="button" disabled={bulkTierEdit.saving} onClick={async () => {
                              setBulkTierEdit({ ...bulkTierEdit, saving: true, result: "" });
                              try {
                                const price = bulkTierEdit.monthlyPrice ? Number(bulkTierEdit.monthlyPrice) : null;
                                await saveBulkTierPrices(bulkTierEdit.branchId, undefined, undefined, bulkTierEdit.tier, price);
                                setBulkTierEdit({ ...bulkTierEdit, saving: false, result: t("savedAllBedsInBranch", { tier: bulkTierEdit.tier === "top" ? t("topBunk") : bulkTierEdit.tier === "middle" ? t("middleBunk") : t("bottomBunk"), branch: bulkTierEdit.branchId }) });
                              } catch (err) { setBulkTierEdit({ ...bulkTierEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                            }} className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bulkTierEdit.saving ? t("saving") : t("applyToMatchingBeds")}</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── By-room bulk mode ── */}
                  {pricingDiagramMode === "by_room" ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
                      <h3 className="text-base font-semibold text-slate-900">{t("setPriceByRoomTier")}</h3>
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
                                        <p className="text-[10px] font-semibold text-slate-500 text-center">{t("roomLabel")} {room.room}</p>
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
                                                <span className="text-slate-600">{tier === "top" ? t("topBunk").charAt(0) : tier === "middle" ? t("middleBunk").charAt(0) : t("bottomBunk").charAt(0)}</span>
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
                            {t("setPriceLabel")} — {bulkTierEdit.branchId} {t("roomLabel")} {bulkTierEdit.room} · {t("allTiersBeds", { tier: bulkTierEdit.tier === "top" ? t("topBunk") : bulkTierEdit.tier === "middle" ? t("middleBunk") : t("bottomBunk") })}
                          </p>
                          <div className="flex items-end gap-3 flex-wrap">
                            <label className="space-y-1 flex-1 min-w-[140px]">
                              <span className="text-xs font-medium text-slate-700">Monthly price (VND)</span>
                              <input type="number" min={0} value={bulkTierEdit.monthlyPrice}
                                onChange={(e) => setBulkTierEdit({ ...bulkTierEdit, monthlyPrice: e.target.value })}
                                placeholder={t("resetToSheetPlaceholder")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none" />
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
                        <h3 className="text-base font-semibold text-slate-900">{branchId} — {t("monthlyBedPricesHeader")}</h3>
                        <p className="mt-1 text-sm text-slate-500">{t("monthlyBedPricesDesc")}</p>
                      </div>
                      {pricingConfigLoading ? <p className="text-sm text-slate-500">{t("refreshing")}</p> : (
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
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t("roomLabel")} {room.room} · {t("floorLabel")} {room.floor}</p>
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
                                                : <span className="text-slate-400">{t("sheetValue")}</span>}
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
                                  const tierLabel = room.bunkCount === 3 ? [t("topBunk"), t("middleBunk"), t("bottomBunk")][tierIdx] : [t("topBunk"), t("bottomBunk")][tierIdx];
                                  return <span className="ml-2 font-normal text-teal-700">· {t("roomLabel")} {room.room} · {tierLabel} {t("bedLabel").toLowerCase()}</span>;
                                })()}
                              </p>
                              <div className="flex items-end gap-3 flex-wrap">
                                <label className="space-y-1 flex-1 min-w-[140px]">
                                  <span className="text-xs font-medium text-slate-700">{t("monthlyPriceVnd")}</span>
                                  <input
                                    type="number" min={0}
                                    value={bedOverrideEdit.monthlyPrice}
                                    onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, monthlyPrice: e.target.value })}
                                    placeholder={t("resetToSheetPlaceholder")}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                                  />
                                </label>
                                <p className="text-xs text-slate-500 pb-2">{t("depositAutoNote")}</p>
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
                                          {existingPark ? t("editLabel") : t("setOverride")}
                                        </button>
                                      )}
                                    </div>
                                    {!existingPark && !isEditingParking && <p className="text-xs text-amber-600">Using branch default. Set an override to give this bed a different parking rate.</p>}
                                    {isEditingParking && (
                                      <div className="space-y-2">
                                        <input type="number" min={0} value={parkingBedEdit!.parkingFeeVnd}
                                          onChange={(e) => setParkingBedEdit({ ...parkingBedEdit!, parkingFeeVnd: e.target.value })}
                                          placeholder={t("parkingFeePlaceholder")}
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
                                  }} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600">{t("resetToSheet")}</button>
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
                  <CollapsibleSettingsSection
                    title={t("longTermDiscountsHeader")}
                    description={t("longTermDiscountsDesc")}
                    expanded={pricingSettingsExpanded.long_term_discounts}
                    onToggle={() => togglePricingSettingsSection("long_term_discounts")}
                  >
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">{t("refreshing")}</p> : (
                      <>
                        {(pricingData?.discounts ?? []).filter((d) => d.termType === "long_term").length > 0 ? (
                          <div className="space-y-3">
                            {(pricingData?.discounts ?? []).filter((d) => d.termType === "long_term").map((d) => (
                              <div key={d.id} className={`rounded-2xl border p-4 space-y-2 ${d.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <span className="font-semibold text-slate-900 text-sm">{language === "vi" && d.labelVi ? d.labelVi : d.label}</span>
                                    {!d.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500">{t("disabledLabel")}</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setDiscountEdit({ id: d.id, termType: "long_term", label: d.label, labelVi: d.labelVi ?? "", description: d.description, descriptionVi: d.descriptionVi ?? "", amountVnd: String(d.amountVnd ?? ""), percentOff: "", minNights: "", durationMonths: d.durationMonths != null ? String(d.durationMonths) : "", eligibility: d.eligibility.map((e) => ({ type: e.type, values: "values" in e ? ((e as { values: string[] }).values ?? []).join(", ") : "", value: "value" in e ? String((e as { value: number }).value) : "" })), selectionMode: d.selectionMode ?? "manual", stackMode: d.stackMode ?? "stackable", enabled: d.enabled, firstContractOnly: Boolean(d.firstContractOnly), saving: false, result: "" })}
                                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">{t("editLabel")}</button>
                                    <button type="button" onClick={async () => {
                                      if (!window.confirm(`Delete "${d.label}"?`)) return;
                                      const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts/${encodeURIComponent(d.id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`, { method: "DELETE" });
                                      if (res.ok) setPricingData((prev) => prev ? { ...prev, discounts: prev.discounts.filter((x) => x.id !== d.id) } : prev);
                                    }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">{t("deleteLabel")}</button>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-500">{language === "vi" && d.descriptionVi ? d.descriptionVi : d.description}</p>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {d.amountVnd != null && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 font-medium">−{d.amountVnd.toLocaleString("vi-VN")} ₫/month</span>}
                                  {d.firstContractOnly ? (
                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 font-medium">{t("firstContractOnlyBadge")}</span>
                                  ) : null}
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{d.durationMonths != null ? `${d.durationMonths} ${t("monthsLabel")}` : t("entireContractLabel")}</span>
                                  <span className={`rounded-full px-2.5 py-1 font-medium ${d.stackMode === "exclusive" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{d.stackMode === "exclusive" ? t("exclusiveLabel") : t("stackableLabel")}</span>
                                  {d.eligibility.map((e, i) => (
                                    <span key={i} className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                                      {e.type === "status" ? `${t("statusLabel")}: ${"values" in e ? ((e as { values: string[] }).values ?? []).join(" / ") : ""}` :
                                       e.type === "minMonths" ? `${t("minLabel")} ${"value" in e ? (e as { value: number }).value : "?"} ${t("monthsLabel")}` :
                                       e.type === "referral" ? t("hasReferralLabel") :
                                       e.type === "bedTier" ? `${t("bedTierLabel")}: ${"values" in e ? ((e as { values: string[] }).values ?? []).join("/") : ""}` :
                                       e.type === "gender" ? `${t("genderLabel")}: ${"values" in e ? ((e as { values: string[] }).values ?? []).join("/") : ""}` :
                                       e.type === "occupation" ? `${t("occupationLabel")}: ${"values" in e ? ((e as { values: string[] }).values ?? []).join(", ") : ""}` : e.type}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">{t("noLongTermDiscounts")}</p>}
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
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("descEn")}</span>
                                <input value={discountEdit.description} onChange={(e) => setDiscountEdit({ ...discountEdit, description: e.target.value })} placeholder="e.g. For university students" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("descVi")}</span>
                                <input value={discountEdit.descriptionVi} onChange={(e) => setDiscountEdit({ ...discountEdit, descriptionVi: e.target.value })} placeholder="e.g. Dành cho sinh viên đại học" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("monthlyDiscountVnd")}</span>
                                <input type="number" min={0} value={discountEdit.amountVnd} onChange={(e) => setDiscountEdit({ ...discountEdit, amountVnd: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("durationMonthsLabel")}</span>
                                <input type="number" min={1} value={discountEdit.durationMonths} onChange={(e) => setDiscountEdit({ ...discountEdit, durationMonths: e.target.value })} placeholder={t("wholeContractPlaceholder")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("selectionRuleDefault")}</span>
                                <select value={discountEdit.selectionMode} onChange={(e) => setDiscountEdit({ ...discountEdit, selectionMode: e.target.value as "manual" | "automatic" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                  <option value="manual">{t("residentMustSelect")}</option>
                                  <option value="automatic">{t("autoApplyEligible")}</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("stackingRuleDefault")}</span>
                                <select value={discountEdit.stackMode} onChange={(e) => setDiscountEdit({ ...discountEdit, stackMode: e.target.value as "stackable" | "exclusive" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                  <option value="stackable">{t("stackable")}</option>
                                  <option value="exclusive">{t("exclusive")}</option>
                                </select>
                              </label>
                              <div className="sm:col-span-2 space-y-2">
                                <span className="text-xs font-medium text-slate-700 block">{t("eligibilityRulesLabel")}</span>
                                {discountEdit.eligibility.map((rule, idx) => (
                                  <div key={idx} className="flex gap-2 items-start flex-wrap">
                                    <select value={rule.type} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { type: e.target.value, values: "", value: "" }; setDiscountEdit({ ...discountEdit, eligibility: u }); }}
                                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none">
                                      <option value="status">{t("residentStatus")}</option>
                                      <option value="minMonths">{t("minContractMonths")}</option>
                                      <option value="referral">{t("hasReferral")}</option>
                                      <option value="bedTier">{t("bedTierRule")}</option>
                                      <option value="gender">{t("genderRule")}</option>
                                      <option value="occupation">{t("occupationRule")}</option>
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
                                            {tier === "top" ? t("topBunk") : tier === "middle" ? t("middleBunk") : t("bottomBunk")}
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
                                            {g === "male" ? t("maleLabel") : t("femaleLabel")}
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                    {rule.type === "occupation" && <input value={rule.values} onChange={(e) => { const u = [...discountEdit.eligibility]; u[idx] = { ...u[idx], values: e.target.value }; setDiscountEdit({ ...discountEdit, eligibility: u }); }} placeholder="e.g. Doctor, Engineer, Nurse" className="flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />}
                                    <button type="button" onClick={() => setDiscountEdit({ ...discountEdit, eligibility: discountEdit.eligibility.filter((_, i) => i !== idx) })} className="rounded-xl border border-rose-200 px-3 py-2 text-xs text-rose-600 self-start mt-0.5">✕</button>
                                  </div>
                                ))}
                                <button type="button" onClick={() => setDiscountEdit({ ...discountEdit, eligibility: [...discountEdit.eligibility, { type: "status", values: "", value: "" }] })}
                                  className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-sky-400">{t("addRule")}</button>
                              </div>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={discountEdit.enabled} onChange={(e) => setDiscountEdit({ ...discountEdit, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
                                <span className="text-sm text-slate-700">{t("enabledVisibleLabel")}</span>
                              </label>
                              <label className="flex items-start gap-2 sm:col-span-2">
                                <input type="checkbox" checked={discountEdit.firstContractOnly} onChange={(e) => setDiscountEdit({ ...discountEdit, firstContractOnly: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600" />
                                <span>
                                  <span className="text-sm font-medium text-slate-800">{t("firstContractOnlyLabel")}</span>
                                  <span className="mt-0.5 block text-xs text-slate-500">{t("firstContractOnlyDesc")}</span>
                                </span>
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
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, discount: { id, termType: "long_term", label: discountEdit.label, labelVi: discountEdit.labelVi, description: discountEdit.description, descriptionVi: discountEdit.descriptionVi, amountVnd: Number(discountEdit.amountVnd) || 0, percentOff: null, minNights: null, durationMonths: discountEdit.durationMonths ? Number(discountEdit.durationMonths) : null, eligibility, selectionMode: discountEdit.selectionMode, stackMode: discountEdit.stackMode, enabled: discountEdit.enabled, firstContractOnly: discountEdit.firstContractOnly } }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingDiscount; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, discounts: [...prev.discounts.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setDiscountEdit(null);
                                } catch (err) { setDiscountEdit({ ...discountEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{discountEdit.saving ? t("saving") : t("saveDiscount")}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setDiscountEdit({ id: "", termType: "long_term", label: "", labelVi: "", description: "", descriptionVi: "", amountVnd: "0", percentOff: "", minNights: "", durationMonths: "", eligibility: [], selectionMode: "manual", stackMode: "stackable", enabled: true, firstContractOnly: false, saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-sky-400 hover:text-sky-700">{t("addDiscount")}</button>
                        )}
                      </>
                    )}
                  </CollapsibleSettingsSection>
                </>
              )}
            </section>
          ) : null}

          {/* ── Short-term tab: nightly bed prices + stay discounts ── */}
          {managerSettingsMainSection === "pricing" && pricingSettingsTab === "short_term" ? (
            <section className="space-y-5">
              {!canManageOwnersEmployees ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-slate-500">{t("pricingRestricted")}</p>
                </div>
              ) : (
                <>
                  {/* Short-term nightly bed overrides */}
                  <CollapsibleSettingsSection
                    title={t("nightlyBedPricesHeader")}
                    description={t("nightlyBedPricesDesc")}
                    expanded={pricingSettingsExpanded.nightly_bed_prices}
                    onToggle={() => togglePricingSettingsSection("nightly_bed_prices")}
                  >
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
                      <>
                        {(pricingData?.bedOverrides ?? []).filter((b) => b.termType === "short_term").length > 0 ? (
                          <div className="space-y-2">
                            {(pricingData?.bedOverrides ?? []).filter((b) => b.termType === "short_term").map((b) => (
                              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-sm">
                                  <span className="font-semibold text-slate-900">{b.branchId} {t("bedLabel")} {b.bedNumber}</span>
                                  <span className="ml-3 text-slate-500">{b.nightlyPrice != null ? `${b.nightlyPrice.toLocaleString("vi-VN")} ₫/${t("nightSuffix")}` : t("configDefault", "config default")}</span>
                                  <span className="ml-2 text-xs text-slate-400">by {b.updatedBy}</span>
                                </div>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setBedOverrideEdit({ id: b.id, branchId: b.branchId, bedNumber: String(b.bedNumber), termType: "short_term", monthlyPrice: "", deposit: "", nightlyPrice: String(b.nightlyPrice ?? ""), saving: false, result: "" })}
                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">{t("editLabel")}</button>
                                  <button type="button" onClick={async () => {
                                    if (!window.confirm(`Remove nightly override for ${b.branchId} Bed ${b.bedNumber}?`)) return;
                                    const res = await fetch(`${API_BASE_URL}/manager/pricing/beds?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=${b.branchId}&bedNumber=${b.bedNumber}&termType=short_term`, { method: "DELETE" });
                                    if (res.ok) setPricingData((prev) => prev ? { ...prev, bedOverrides: prev.bedOverrides.filter((x) => x.id !== b.id) } : prev);
                                  }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">{t("removeLabel")}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">{t("noNightlyOverrides")}</p>}
                        {bedOverrideEdit?.termType === "short_term" ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 space-y-4">
                            <p className="text-sm font-semibold text-violet-900">{bedOverrideEdit.id ? t("editLabel") : t("addLabel")} {t("nightlyBedPricesHeader").toLowerCase()}</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("branchLabel")}</span>
                                <select value={bedOverrideEdit.branchId} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, branchId: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="D2">D2</option><option value="D7">D7</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("bedNumberLabel")}</span>
                                <input type="number" min={1} value={bedOverrideEdit.bedNumber} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, bedNumber: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("nightlyPriceVnd")}</span>
                                <input type="number" min={0} value={bedOverrideEdit.nightlyPrice} onChange={(e) => setBedOverrideEdit({ ...bedOverrideEdit, nightlyPrice: e.target.value })} placeholder="e.g. 150000" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                            </div>
                            {bedOverrideEdit.result ? <p className={`text-sm font-medium ${bedOverrideEdit.result.startsWith("✓") ? "text-emerald-700" : "text-rose-700"}`}>{bedOverrideEdit.result}</p> : null}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setBedOverrideEdit(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">{t("cancelLabel")}</button>
                              <button type="button" disabled={bedOverrideEdit.saving} onClick={async () => {
                                setBedOverrideEdit({ ...bedOverrideEdit, saving: true, result: "" });
                                try {
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/beds`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, branchId: bedOverrideEdit.branchId, bedNumber: Number(bedOverrideEdit.bedNumber), termType: "short_term", nightlyPrice: bedOverrideEdit.nightlyPrice ? Number(bedOverrideEdit.nightlyPrice) : null }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingBedOverride; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, bedOverrides: [...prev.bedOverrides.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setBedOverrideEdit(null);
                                } catch (err) { setBedOverrideEdit({ ...bedOverrideEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{bedOverrideEdit.saving ? t("saving") : t("saveLabel")}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setBedOverrideEdit({ branchId: "D2", bedNumber: "", termType: "short_term", monthlyPrice: "", deposit: "", nightlyPrice: "", saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700">{t("addNightlyOverride")}</button>
                        )}
                      </>
                    )}
                  </CollapsibleSettingsSection>

                  {/* Short-term stay discounts */}
                  <CollapsibleSettingsSection
                    title={t("stayDiscountsHeader")}
                    description={t("stayDiscountsDesc")}
                    expanded={pricingSettingsExpanded.stay_discounts}
                    onToggle={() => togglePricingSettingsSection("stay_discounts")}
                  >
                    {pricingConfigLoading ? <p className="text-sm text-slate-500">{t("refreshing")}</p> : (
                      <>
                        {(pricingData?.discounts ?? []).filter((d) => d.termType === "short_term").length > 0 ? (
                          <div className="space-y-3">
                            {(pricingData?.discounts ?? []).filter((d) => d.termType === "short_term").map((d) => (
                              <div key={d.id} className={`rounded-2xl border p-4 space-y-2 ${d.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <span className="font-semibold text-slate-900 text-sm">{d.label}</span>
                                    {!d.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500">{t("disabledLabel")}</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setDiscountEdit({ id: d.id, termType: "short_term", label: d.label, labelVi: d.labelVi ?? "", description: d.description, descriptionVi: d.descriptionVi ?? "", amountVnd: "", percentOff: String(d.percentOff ?? ""), minNights: String(d.minNights ?? ""), durationMonths: "", eligibility: [], selectionMode: d.selectionMode ?? "automatic", stackMode: d.stackMode ?? "stackable", enabled: d.enabled, firstContractOnly: false, saving: false, result: "" })}
                                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">{t("editLabel")}</button>
                                    <button type="button" onClick={async () => {
                                      if (!window.confirm(`Delete "${d.label}"?`)) return;
                                      const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts/${encodeURIComponent(d.id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`, { method: "DELETE" });
                                      if (res.ok) setPricingData((prev) => prev ? { ...prev, discounts: prev.discounts.filter((x) => x.id !== d.id) } : prev);
                                    }} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600">{t("deleteLabel")}</button>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-500">{language === "vi" && d.descriptionVi ? d.descriptionVi : d.description}</p>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {d.percentOff != null && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-700 font-medium">{t("percentOffLabel", { percent: d.percentOff })}</span>}
                                  {d.minNights != null && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{t("minNightsCondition", { count: d.minNights })}</span>}
                                  <span className={`rounded-full px-2.5 py-1 font-medium ${d.stackMode === "exclusive" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{d.stackMode === "exclusive" ? t("exclusiveDiscount") : t("stackableDiscount")}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-slate-400 italic">{t("noShortTermDiscounts")}</p>}
                        {discountEdit?.termType === "short_term" ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 space-y-4">
                            <p className="text-sm font-semibold text-violet-900">{discountEdit.id && (pricingData?.discounts ?? []).some((d) => d.id === discountEdit.id) ? t("editStayDiscount") : t("newStayDiscount")}</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-slate-700">{t("labelLabel", "Label")}</span>
                                <input value={discountEdit.label} onChange={(e) => setDiscountEdit({ ...discountEdit, label: e.target.value })} placeholder="e.g. Weekly discount" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-slate-700">{t("descriptionLabel", "Description")}</span>
                                <input value={discountEdit.description} onChange={(e) => setDiscountEdit({ ...discountEdit, description: e.target.value })} placeholder="e.g. Stays of 7+ nights get 10% off" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("percentOffInput", "Discount % (0–100)")}</span>
                                <input type="number" min={0} max={100} value={discountEdit.percentOff} onChange={(e) => setDiscountEdit({ ...discountEdit, percentOff: e.target.value })} placeholder="e.g. 10" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("minimumNights", "Minimum nights")}</span>
                                <input type="number" min={1} value={discountEdit.minNights} onChange={(e) => setDiscountEdit({ ...discountEdit, minNights: e.target.value })} placeholder="e.g. 7" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("selectionRuleDefault")}</span>
                                <select value={discountEdit.selectionMode} onChange={(e) => setDiscountEdit({ ...discountEdit, selectionMode: e.target.value as "manual" | "automatic" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="manual">{t("guestMustSelect")}</option>
                                  <option value="automatic">{t("autoApplyEligible")}</option>
                                </select>
                              </label>
                              <label className="space-y-1"><span className="text-xs font-medium text-slate-700">{t("stackingRuleDefault")}</span>
                                <select value={discountEdit.stackMode} onChange={(e) => setDiscountEdit({ ...discountEdit, stackMode: e.target.value as "stackable" | "exclusive" })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
                                  <option value="stackable">{t("stackable")}</option>
                                  <option value="exclusive">{t("exclusive")}</option>
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
                                  const res = await fetch(`${API_BASE_URL}/manager/pricing/discounts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorEmail: normalizedEmail, discount: { id, termType: "short_term", label: discountEdit.label, labelVi: discountEdit.labelVi, description: discountEdit.description, descriptionVi: discountEdit.descriptionVi, amountVnd: null, percentOff: Number(discountEdit.percentOff) || 0, minNights: Number(discountEdit.minNights) || 1, durationMonths: null, eligibility: [], selectionMode: discountEdit.selectionMode, stackMode: discountEdit.stackMode, enabled: discountEdit.enabled, firstContractOnly: false } }) });
                                  const data = (await res.json()) as { ok?: boolean; row?: PricingDiscount; error?: string };
                                  if (!res.ok) throw new Error(data.error ?? "Failed");
                                  if (data.row) setPricingData((prev) => prev ? { ...prev, discounts: [...prev.discounts.filter((x) => x.id !== data.row!.id), data.row!] } : prev);
                                  setDiscountEdit(null);
                                } catch (err) { setDiscountEdit({ ...discountEdit, saving: false, result: err instanceof Error ? err.message : "Failed" }); }
                              }} className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{discountEdit.saving ? "Saving…" : "Save discount"}</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setDiscountEdit({ id: "", termType: "short_term", label: "", labelVi: "", description: "", descriptionVi: "", amountVnd: "", percentOff: "10", minNights: "7", durationMonths: "", eligibility: [], selectionMode: "automatic", stackMode: "stackable", enabled: true, firstContractOnly: false, saving: false, result: "" })}
                            className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700">{t("addStayDiscount")}</button>
                        )}
                      </>
                    )}
                  </CollapsibleSettingsSection>
                </>
              )}
            </section>
          ) : null}

          {managerSettingsMainSection === "pricing" && pricingSettingsTab === "referral" ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
              {referralProgramLoading ? (
                <p className="text-sm text-slate-600">{t("refreshing")}</p>
              ) : referralProgramDraft ? (
                <div className="mx-auto max-w-2xl space-y-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={referralProgramDraft.enabled}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {language === "vi" ? "Bật chương trình giới thiệu" : "Enable referral program"}
                  </label>
                  <label className="block text-sm text-slate-700">
                    {language === "vi"
                      ? "Số tháng hợp đồng cho mức thưởng đầy đủ (tỷ lệ cho hợp đồng ngắn hơn)"
                      : "Contract months for full reward (shorter contracts are pro-rated)"}
                    <input
                      type="number"
                      min={1}
                      max={36}
                      value={referralProgramDraft.fullOfferContractMonths}
                      onChange={(e) =>
                        setReferralProgramDraft((d) =>
                          d ? { ...d, fullOfferContractMonths: e.target.value } : d
                        )
                      }
                      className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {language === "vi" ? "Hợp đồng dài hạn (/register)" : "Long-term dorm (/register)"}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-slate-700">
                      {language === "vi"
                        ? "Giảm một lần trên tổng thanh toán lần đầu (VND)"
                        : "One-time discount on first payment total (VND)"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.newRegistrantDiscountVnd}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, newRegistrantDiscountVnd: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      {language === "vi" ? "Coins cư dân mới" : "Coins (new resident)"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.newRegistrantCoins}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, newRegistrantCoins: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      {language === "vi" ? "Coins người giới thiệu (cư dân đang ở)" : "Coins (referrer)"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.referrerCoins}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, referrerCoins: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={referralProgramDraft.hostelEnabled}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, hostelEnabled: e.target.checked } : d))
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {language === "vi" ? "Bật giới thiệu cho hostel / lưu trú ngắn" : "Enable hostel / short-stay referral"}
                  </label>
                  <p className="text-xs text-slate-600">
                    {language === "vi"
                      ? "Mức riêng cho đặt phòng tại hostel; tỷ lệ theo đêm ÷ 30 so với số tháng cơ sở ở trên."
                      : "Separate amounts for hostel bookings; scale uses nights ÷ 30 versus the baseline months above."}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-slate-700">
                      {language === "vi"
                        ? "Hostel — giảm một lần trên giá lưu trú (VND)"
                        : "Hostel — one-time stay discount (VND)"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.hostelNewRegistrantDiscountVnd}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, hostelNewRegistrantDiscountVnd: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      {language === "vi" ? "Hostel — coins khách" : "Hostel — guest coins"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.hostelNewRegistrantCoins}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, hostelNewRegistrantCoins: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      {language === "vi" ? "Hostel — coins người giới thiệu" : "Hostel — referrer coins"}
                      <input
                        type="number"
                        min={0}
                        value={referralProgramDraft.hostelReferrerCoins}
                        onChange={(e) =>
                          setReferralProgramDraft((d) =>
                            d ? { ...d, hostelReferrerCoins: e.target.value } : d
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                      />
                    </label>
                  </div>
                  <label className="block text-sm text-slate-700">
                    Hostel headline (EN)
                    <input
                      value={referralProgramDraft.hostelHeadlineEn}
                      onChange={(e) =>
                        setReferralProgramDraft((d) =>
                          d ? { ...d, hostelHeadlineEn: e.target.value } : d
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Hostel headline (VI)
                    <input
                      value={referralProgramDraft.hostelHeadlineVi}
                      onChange={(e) =>
                        setReferralProgramDraft((d) =>
                          d ? { ...d, hostelHeadlineVi: e.target.value } : d
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Hostel details (EN)
                    <textarea
                      rows={2}
                      value={referralProgramDraft.hostelDetailsEn}
                      onChange={(e) =>
                        setReferralProgramDraft((d) =>
                          d ? { ...d, hostelDetailsEn: e.target.value } : d
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Hostel details (VI)
                    <textarea
                      rows={2}
                      value={referralProgramDraft.hostelDetailsVi}
                      onChange={(e) =>
                        setReferralProgramDraft((d) =>
                          d ? { ...d, hostelDetailsVi: e.target.value } : d
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Headline (EN)
                    <input
                      value={referralProgramDraft.headlineEn}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, headlineEn: e.target.value } : d))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Headline (VI)
                    <input
                      value={referralProgramDraft.headlineVi}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, headlineVi: e.target.value } : d))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Details (EN)
                    <textarea
                      rows={3}
                      value={referralProgramDraft.detailsEn}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, detailsEn: e.target.value } : d))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Details (VI)
                    <textarea
                      rows={3}
                      value={referralProgramDraft.detailsVi}
                      onChange={(e) =>
                        setReferralProgramDraft((d) => (d ? { ...d, detailsVi: e.target.value } : d))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                    />
                  </label>
                  {referralProgramMessage ? (
                    <p className="text-sm text-slate-700">{referralProgramMessage}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={referralProgramSaving}
                    onClick={() => void saveReferralProgramSettings()}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {referralProgramSaving ? "…" : language === "vi" ? "Lưu" : "Save"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void loadReferralProgramSettings()}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  {language === "vi" ? "Tải cấu hình" : "Load settings"}
                </button>
              )}
            </section>
          ) : null}

          {/* ── Staff tab ── */}
          {managerSettingsMainSection === "pricing" && pricingSettingsTab === "staff" ? (
            <CollapsibleSettingsSection
              title={t("ownersEmployees")}
              description={t("ownersEmployeesDesc")}
              expanded={pricingSettingsExpanded.staff_accounts}
              onToggle={() => togglePricingSettingsSection("staff_accounts")}
            >
              <div className="mb-4 flex justify-end">
                <button type="button" onClick={() => void loadTeam()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">{t("refreshAccounts")}</button>
              </div>
              <div>
                <p className="text-sm text-slate-500">
                  Staff account management is available in the{" "}
                  <button type="button" onClick={() => setActiveManagerView("owners_employees")} className="font-medium text-sky-600 underline underline-offset-2">{t("staffAccountViewBtn")}</button>.
                </p>
              </div>
            </CollapsibleSettingsSection>
          ) : null}

          {managerSettingsMainSection === "resident_guides" ? (
            <ManagerResidentGuidesEditor normalizedEmail={normalizedEmail} language={language} t={t} />
          ) : null}

          {managerSettingsMainSection === "tools" ? (
            <ManagerSettingsTools
              normalizedEmail={normalizedEmail}
              clients={clients}
              t={t}
              onRefreshClients={async () => {
                await loadClients(true);
              }}
            />
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
              {t("preferences", "Preferences")}
            </h3>
            <div className="mt-4 divide-y divide-slate-200">
              <div className="flex items-center justify-between py-3">
                <p className="text-sm text-slate-600">{t("chooseDisplayLanguage")}</p>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="en">{t("english", "English")}</option>
                  <option value="vi">{t("vietnamese", "Vietnamese")}</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-3">
                <p className="text-sm text-slate-600">{t("darkMode", "Dark mode")}</p>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${theme === "dark" ? "bg-slate-700" : "bg-slate-200"}`}
                  role="switch"
                  aria-checked={theme === "dark"}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${theme === "dark" ? "translate-x-6" : "translate-x-1"}`}
                  />
                </button>
              </div>
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
                  placeholder={t("starterPasswordPlaceholder")}
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
                  {t("saveLabel")}
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
              {showStaffList ? t("hideTeamList") : t("showTeamList")}
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
                            {t("roleLabel")}: {entry.role} | {t("addedByLabel")}: {entry.addedBy || t("system")}
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
                                {entry.email === normalizedEmail ? t("myPermissions") : `⚙ ${t("permissions", "Permissions")}`}
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
                                {t("myPermissions")}
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
                  {t("confirmRemoveTitle")}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {t("confirmRemoveDesc")}:{" "}
                  <span className="font-medium text-slate-900">
                    {removeConfirmEntry.name ? `${removeConfirmEntry.name} (${removeConfirmEntry.email})` : removeConfirmEntry.email}
                  </span>
                </p>
                <p className="mt-3 text-sm text-slate-600">
                  {t("confirmRemovePasswordPrompt")}
                </p>
                <input
                  type="password"
                  value={removeConfirmPassword}
                  onChange={(e) => {
                    setRemoveConfirmPassword(e.target.value);
                    setRemoveConfirmError("");
                  }}
                  placeholder={t("passwordPlaceholder")}
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
                    {removeConfirmLoading ? t("refreshing") : t("confirmRemoveBtn")}
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
                      {permissionsEntry.email === normalizedEmail ? t("myPermissions") : `${t("permissions", "Permissions")} — ${permissionsEntry.name ?? permissionsEntry.email}`}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">{permissionsEntry.email}</p>
                  </div>
                  <button type="button" onClick={() => { setPermissionsEntry(null); setEditingPermissions(null); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {/* Branch access */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{t("branchAccess")}</div>
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
                        <span className="text-xs text-slate-500 self-center">{t("allBranches")}</span>
                      )}
                    </div>
                  </div>

                  {/* Data permissions grid */}
                  <div className="mt-5">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dataType")}</div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 text-center">{t("readLabel")}</div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 text-center">{t("writeLabel")}</div>
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
                            <div key={`${key}-label`} className="text-sm text-slate-700">{t(label)}</div>
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
                    {(isOwnerSession || isAppAdminSession) && permissionsEntry.email !== normalizedEmail ? t("cancelLabel") : t("closeLabel")}
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
                      {permissionsSaving ? t("saving") : t("saveLabel")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeManagerView === "support_chat" ? (
        <section className="flex min-h-[320px] flex-col gap-0 rounded-3xl border border-slate-200 bg-slate-50/90 p-2 shadow-sm ring-1 ring-slate-100 max-h-[min(82dvh,calc(100dvh-9.5rem))]">
          <div className="sticky top-0 z-20 shrink-0 rounded-2xl border border-slate-200/80 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar sm:flex-wrap sm:overflow-visible">
              <button
                type="button"
                onClick={() => setSupportSubTab("messages")}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  supportSubTab === "messages"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("messagesTab")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSupportSubTab("feedbacks");
                  void loadFeedbacks();
                }}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  supportSubTab === "feedbacks"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("feedbacksTab")}
              </button>
              <button
                type="button"
                onClick={() => setSupportSubTab("assistant")}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  supportSubTab === "assistant"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("chatAssistantTab")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSupportSubTab("maintenance");
                  void loadMaintenanceTickets();
                }}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  supportSubTab === "maintenance"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>{t("maintenanceTickets")}</span>
                {unsolvedMaintenanceTicketCount > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white tabular-nums ring-2 ring-white">
                    {unsolvedMaintenanceTicketCount > 99 ? "99+" : unsolvedMaintenanceTicketCount}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-2xl">
          {supportSubTab === "messages" ? (
            <ManagerSupportInbox
              operatorEmail={normalizedEmail}
              enabled={isStaffSession}
              operatorIsOwner={isOwnerSession}
              onViewClient={(email) => {
                const client = clients.find((c) => c.email?.toLowerCase() === email.toLowerCase())
                  ?? inactiveClients.find((c) => c.email?.toLowerCase() === email.toLowerCase());
                if (client) {
                  setSelectedMaHd(client.maHd);
                  fillClientForm(client);
                  setDiagramBedQuickSheet(null);
                  setClientSubTab("details");
                  setActiveManagerView("client_list");
                }
              }}
            />
          ) : supportSubTab === "assistant" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("chatAssistantTab")}{" "}
                  <span className="ml-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                    Beta
                  </span>
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {language === "vi"
                    ? "Thêm coin, tạo phạt, tạo biên lai, hoặc hỏi giường trống — trợ lý gọi dữ liệu thực từ hệ thống."
                    : "Add coins, create fines or receipts, or ask which beds are free — the assistant uses live data from tools."}
                </p>
              </div>
              <ManagerAiChat operatorEmail={normalizedEmail} onNavigate={handleManagerAiNavigate} inline />
            </section>
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
                  {t("refreshLabel")}
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
                            {entry.page} | {entry.createdAt ? formatDateTime(entry.createdAt) : t("unknownTime")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{entry.message || "-"}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    {feedbackLoading ? t("loadingFeedbacks") : t("noFeedbacks")}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("maintenanceTickets")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("maintenanceTicketsDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadMaintenanceTickets()}
                  disabled={maintenanceLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("refreshLabel")}
                </button>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'reportedAt', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        {t("timeLabel")} {maintenanceSort.field === 'reportedAt' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'residentName', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        {t("residentLabel")} {maintenanceSort.field === 'residentName' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'location', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        {t("locationLabel")} {maintenanceSort.field === 'location' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'device', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        {t("machineLabel")} {maintenanceSort.field === 'device' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2">{t("issueLabel")}</th>
                      <th className="pb-3 px-2 cursor-pointer hover:text-slate-900" onClick={() => setMaintenanceSort({ field: 'status', direction: maintenanceSort.direction === 'asc' ? 'desc' : 'asc' })}>
                        {t("statusLabel")} {maintenanceSort.field === 'status' && (maintenanceSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 px-2 text-right">{t("actionsLabel")}</th>
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
                              type="button"
                              onClick={() => resolveMaintenanceTicket(ticket.id)}
                              className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-800/80 dark:hover:text-emerald-200"
                            >
                              {t("resolveLabel")}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500 italic">
                          {maintenanceLoading ? t("loadingTickets") : t("noActiveTickets")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          </div>
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
              {t("cleaningSchedule")}
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
              {t("laundrySchedule")}
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
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t("realTimeDeviceControl")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("deviceControlDesc")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowControllerHistory((current) => !current)}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {showControllerHistory ? t("hideControllerHistory") : t("viewControllerHistory")}
                </button>
                <button 
                  onClick={() => void fetchDevices()} 
                  className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                  title={t("refreshStatus")}
                >
                  <svg className={`h-5 w-5 ${controllerLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {(() => {
              function toggleGroup(key: string) {
                setControllerGroupCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
              }
              function groupCollapsed(key: string) {
                return controllerGroupCollapsed[key] !== false;
              }

              // Derive floor from room code (D7 "X.Y" → floor X; D2 → no floor)
              function getRoomFloor(room: any): string | null {
                const code = (room.roomCodes?.[0] ?? "");
                const match = code.match(/^(\d+)\./);
                return match ? `${t("floorLabel")} ${match[1]}` : null;
              }

              const branches = ["D7", "D2"] as const;

              return (
                <div className="space-y-4">
                  {branches.map((branch) => {
                    const branchKey = `branch:${branch}`;
                    const branchCollapsed = groupCollapsed(branchKey);
                    const branchAcRooms = acRooms.filter((r) => r.branchId === branch);
                    const branchLaundry = laundryMachines.filter((m) => m.branchId === branch);
                    const branchAirfryers = airfryers.filter((af) => af.branchId === branch);
                    const branchMicrowaves = microwaves.filter((m) => m.branchId === branch);

                    // Group AC rooms by floor
                    const floorMap = new Map<string, any[]>();
                    branchAcRooms.forEach((room) => {
                      const floor = getRoomFloor(room) ?? "Rooms";
                      if (!floorMap.has(floor)) floorMap.set(floor, []);
                      floorMap.get(floor)!.push(room);
                    });
                    const floors = Array.from(floorMap.entries()).sort(([a], [b]) => a.localeCompare(b));

                    return (
                      <div key={branch} className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                        {/* Branch header */}
                        <button
                          type="button"
                          onClick={() => toggleGroup(branchKey)}
                          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-100 transition-colors"
                        >
                          <span className="text-sm font-bold text-slate-900">{t("branchLabel")} {branch}</span>
                          <svg
                            className={`h-4 w-4 text-slate-400 transition-transform ${branchCollapsed ? "" : "rotate-180"}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {!branchCollapsed && (
                          <div className="px-5 pb-5 space-y-4">
                            {/* Room area grouped by floor */}
                            {floors.length > 0 && (
                              <div>
                                <div className="py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("roomsAcTitle")}</div>
                                <div className="space-y-3">
                                  {floors.map(([floor, rooms]) => {
                                    const floorKey = `floor:${branch}:${floor}`;
                                    const floorCollapsed = groupCollapsed(floorKey);
                                    return (
                                      <div key={floor} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                        <button
                                          type="button"
                                          onClick={() => toggleGroup(floorKey)}
                                          className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                                        >
                                          <span className="text-xs font-semibold text-slate-700">{floor}</span>
                                          <svg
                                            className={`h-3.5 w-3.5 text-slate-400 transition-transform ${floorCollapsed ? "" : "rotate-180"}`}
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        {!floorCollapsed && (
                                          <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {rooms.map((room: any) => {
                                              const actionKey = `ac:${room.id}`;
                                              const pendingAction = controllerActionPending[actionKey];
                                              const feedback = controllerActionFeedback[actionKey];
                                              return (
                                                <div key={room.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                                  <div className="flex justify-between items-start">
                                                    <div>
                                                      <div className="text-sm font-bold text-slate-900">{room.label}</div>
                                                      <div className="text-[10px] text-slate-400">{t("iotIdLabel")}: {room.id}</div>
                                                    </div>
                                                    <div className={`h-2 w-2 rounded-full mt-1 ${room.lastRequestedAction === "ON" ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-slate-300"}`} />
                                                  </div>
                                                  <div className="mt-3 flex gap-2">
                                                    <button
                                                      onClick={() => handleAcControl(room.id, "ON")}
                                                      disabled={Boolean(pendingAction)}
                                                      className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "ON" ? "bg-emerald-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600"}`}
                                                    >
                                                      {pendingAction === "ON" ? "..." : "ON"}
                                                    </button>
                                                    <button
                                                      onClick={() => handleAcControl(room.id, "OFF")}
                                                      disabled={Boolean(pendingAction)}
                                                      className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${room.lastRequestedAction === "OFF" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}
                                                    >
                                                      {pendingAction === "OFF" ? "..." : "OFF"}
                                                    </button>
                                                  </div>
                                                  {feedback ? (
                                                    <div className={`mt-2 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                                                      {feedback.message}
                                                    </div>
                                                  ) : null}
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
                            )}

                            {/* Laundry area */}
                            {branchLaundry.length > 0 && (
                              <div>
                                <div className="py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("laundryTitle")}</div>
                                {(() => {
                                  const laundryKey = `laundry:${branch}`;
                                  const laundryCollapsed = groupCollapsed(laundryKey);
                                  return (
                                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(laundryKey)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                                      >
                                        <span className="text-xs font-semibold text-slate-700">{t("machinesLabel")}</span>
                                        <svg
                                          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${laundryCollapsed ? "" : "rotate-180"}`}
                                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                      {!laundryCollapsed && (
                                        <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                          {branchLaundry.map((machine) => {
                                            const actionKey = `laundry:${machine.id}`;
                                            const maintKey = `laundry-maint:${machine.id}`;
                                            const pendingAction = controllerActionPending[actionKey];
                                            const pendingMaint = controllerActionPending[maintKey];
                                            const feedback = controllerActionFeedback[actionKey];
                                            const feedbackMaint = controllerActionFeedback[maintKey];
                                            const offline = Boolean(machine.offlineForMaintenance);
                                            return (
                                              <div key={machine.id} className="rounded-xl border border-sky-100 bg-sky-50/30 p-3">
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="text-sm font-bold text-sky-900">{machine.label}</div>
                                                  {offline ? (
                                                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-900">
                                                      {t("laundryMaintenanceBadge")}
                                                    </span>
                                                  ) : null}
                                                </div>
                                                <div className="mt-3 flex flex-col gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMachineTrigger(machine.id, "laundry")}
                                                    disabled={Boolean(pendingAction || pendingMaint)}
                                                    className="w-full rounded-lg bg-sky-600 py-2 text-xs font-black text-white hover:bg-sky-700 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                                  >
                                                    {pendingAction ? t("triggering") : t("trigger")}
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => void handleLaundryMaintenanceToggle(machine)}
                                                    disabled={Boolean(pendingAction || pendingMaint)}
                                                    className={`w-full rounded-lg border-2 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                                                      offline
                                                        ? "border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50"
                                                        : "border-amber-600 bg-white text-amber-900 hover:bg-amber-50"
                                                    }`}
                                                  >
                                                    {pendingMaint
                                                      ? "…"
                                                      : offline
                                                        ? t("laundryMaintenanceMarkOnline")
                                                        : t("laundryMaintenanceMarkOffline")}
                                                  </button>
                                                </div>
                                                {feedback ? (
                                                  <div className={`mt-2 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                                                    {feedback.message}
                                                  </div>
                                                ) : null}
                                                {feedbackMaint ? (
                                                  <div className={`mt-2 text-xs font-medium ${feedbackMaint.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                                                    {feedbackMaint.message}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Common Area (kitchen: air fryers, microwave) */}
                            {(branchAirfryers.length > 0 || branchMicrowaves.length > 0) && (
                              <div>
                                <div className="py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("kitchenTitle")}</div>
                                {(() => {
                                  const appKey = `kitchen:${branch}`;
                                  const appCollapsed = groupCollapsed(appKey);
                                  return (
                                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(appKey)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                                      >
                                        <span className="text-xs font-semibold text-slate-700">{t("kitchenAppliances")}</span>
                                        <svg
                                          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${appCollapsed ? "" : "rotate-180"}`}
                                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                      {!appCollapsed && (
                                        <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                          {branchAirfryers.map((af) => {
                                            const actionKey = `airfryer:${af.id}`;
                                            const pendingAction = controllerActionPending[actionKey];
                                            const feedback = controllerActionFeedback[actionKey];
                                            return (
                                              <div key={af.id} className="rounded-xl border border-amber-100 bg-amber-50/30 p-3">
                                                <div className="text-sm font-bold text-amber-900">{af.label}</div>
                                                <button
                                                  onClick={() => handleMachineTrigger(af.id, "airfryer")}
                                                  disabled={Boolean(pendingAction)}
                                                  className="mt-3 w-full rounded-lg bg-amber-600 py-2 text-xs font-black text-white hover:bg-amber-700 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  {pendingAction ? t("triggering") : t("trigger")}
                                                </button>
                                                {feedback ? (
                                                  <div className={`mt-2 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                                                    {feedback.message}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                          {branchMicrowaves.map((mw) => {
                                            const actionKey = `microwave:${mw.id}`;
                                            const pendingAction = controllerActionPending[actionKey];
                                            const feedback = controllerActionFeedback[actionKey];
                                            return (
                                              <div key={mw.id} className="rounded-xl border border-violet-100 bg-violet-50/30 p-3">
                                                <div className="text-sm font-bold text-violet-900">{mw.label}</div>
                                                <button
                                                  onClick={() => handleMachineTrigger(mw.id, "microwave")}
                                                  disabled={Boolean(pendingAction)}
                                                  className="mt-3 w-full rounded-lg bg-violet-600 py-2 text-xs font-black text-white hover:bg-violet-700 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  {pendingAction ? t("triggering") : t("trigger")}
                                                </button>
                                                {feedback ? (
                                                  <div className={`mt-2 text-xs font-medium ${feedback.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                                                    {feedback.message}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>

          {showControllerHistory ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("controllerHistoryTitle")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("controllerHistoryDesc")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchControllerHistory()}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t("refreshHistory")}
                </button>
              </div>

              {controllerHistoryLoading ? (
                <div className="mt-6 text-sm text-slate-500">{t("refreshing")}</div>
              ) : controllerHistory.length === 0 ? (
                <div className="mt-6 text-sm text-slate-500">{t("noControllerHistory")}</div>
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

      {branchToolsOpen && (selectedBranch === "D2" || selectedBranch === "D7") ? (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-2xl rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Branch Tools — {selectedBranch}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Quick tools for this branch: manual receipt, branch-wide notifications, and unpaid reminders.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBranchToolsOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setBranchToolsTab("manual_receipt")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    branchToolsTab === "manual_receipt"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700"
                  }`}
                >
                  New-client receipt
                </button>
                <button
                  type="button"
                  onClick={() => setBranchToolsTab("branch_broadcast")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    branchToolsTab === "branch_broadcast"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700"
                  }`}
                >
                  Branch notification
                </button>
                <button
                  type="button"
                  onClick={() => setBranchToolsTab("unpaid_reminder")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    branchToolsTab === "unpaid_reminder"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700"
                  }`}
                >
                  Unpaid reminder
                </button>
              </div>

              {branchToolsTab === "manual_receipt" ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Create a payment receipt for a person who is not in the current client database.
                    Branch is pre-filled from your selected branch.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={manualReceiptName} onChange={(e) => setManualReceiptName(e.target.value)} placeholder="Full name *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptEmail} onChange={(e) => setManualReceiptEmail(e.target.value)} placeholder="Email *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptPurpose} onChange={(e) => setManualReceiptPurpose(e.target.value)} placeholder="Purpose *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input type="number" min="0" value={manualReceiptAmount} onChange={(e) => setManualReceiptAmount(e.target.value)} placeholder="Amount (VND) *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input
                      value={manualReceiptReceiver}
                      onChange={(e) => setManualReceiptReceiver(e.target.value)}
                      list="manual-receipt-receiver-options"
                      placeholder="Receiver / Người nhận tiền"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input value={manualReceiptMemberTier} onChange={(e) => setManualReceiptMemberTier(e.target.value)} placeholder="Member tier (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptCurrentCoins} onChange={(e) => setManualReceiptCurrentCoins(e.target.value)} placeholder="Current coins (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input type="number" min="0" value={manualReceiptDiscountAmount} onChange={(e) => setManualReceiptDiscountAmount(e.target.value)} placeholder="Discount amount (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptDiscountCondition} onChange={(e) => setManualReceiptDiscountCondition(e.target.value)} placeholder="Discount condition (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptBed} onChange={(e) => setManualReceiptBed(e.target.value)} placeholder="Bed (optional, default 0)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={manualReceiptContractCode} onChange={(e) => setManualReceiptContractCode(e.target.value)} placeholder="Contract code override (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <textarea value={manualReceiptDetails} onChange={(e) => setManualReceiptDetails(e.target.value)} placeholder="Details (optional)" rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <datalist id="manual-receipt-receiver-options">
                      {manualReceiptReceiverSuggestions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitManualReceiptForNewClient()}
                    disabled={loading}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Create Manual Receipt
                  </button>
                </div>
              ) : branchToolsTab === "branch_broadcast" ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Sends web push to all active clients in {selectedBranch}, and stores a first-open in-app prompt per resident.
                  </p>
                  <input
                    value={branchBroadcastTitle}
                    onChange={(e) => setBranchBroadcastTitle(e.target.value)}
                    placeholder="Notification title *"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={branchBroadcastMessage}
                    onChange={(e) => setBranchBroadcastMessage(e.target.value)}
                    placeholder="Message *"
                    rows={5}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void submitBranchBroadcast()}
                    disabled={loading}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Send Branch Notification
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Send reminder to unpaid clients. Channels can be combined (popup, in-app message, email).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setUnpaidReminderMode("all_unpaid")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        unpaidReminderMode === "all_unpaid"
                          ? "bg-slate-900 text-white"
                          : "border border-slate-300 text-slate-700"
                      }`}
                    >
                      All unpaid
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnpaidReminderMode("selected")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        unpaidReminderMode === "selected"
                          ? "bg-slate-900 text-white"
                          : "border border-slate-300 text-slate-700"
                      }`}
                    >
                      Selected users
                    </button>
                  </div>
                  {unpaidReminderMode === "selected" ? (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-700">
                          Choose recipients ({selectedUnpaidReminderEmails.length})
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedUnpaidReminderEmails(unpaidReminderCandidates.map((row) => row.email.trim().toLowerCase()))}
                            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedUnpaidReminderEmails([])}
                            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {unpaidReminderCandidates.map((row) => {
                          const email = row.email.trim().toLowerCase();
                          const checked = selectedUnpaidReminderEmails.includes(email);
                          return (
                            <label key={row.maHd} className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedUnpaidReminderEmails((current) =>
                                    event.target.checked ? [...current, email] : current.filter((entry) => entry !== email)
                                  );
                                }}
                              />
                              <span>{row.name || row.email}</span>
                              <span className="text-slate-400">({row.email})</span>
                            </label>
                          );
                        })}
                        {!unpaidReminderCandidates.length ? (
                          <div className="text-xs text-slate-500">No unpaid users in current list.</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <input
                    value={paymentReminderTitle}
                    onChange={(e) => setPaymentReminderTitle(e.target.value)}
                    placeholder="Reminder title"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={paymentReminderBody}
                    onChange={(e) => setPaymentReminderBody(e.target.value)}
                    placeholder="Reminder message *"
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={sendReminderPopup} onChange={(event) => setSendReminderPopup(event.target.checked)} />
                      Popup
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={sendReminderInApp} onChange={(event) => setSendReminderInApp(event.target.checked)} />
                      In-app message
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={sendReminderEmail} onChange={(event) => setSendReminderEmail(event.target.checked)} />
                      Email
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={sendReminderEnglishCopy}
                        disabled={!sendReminderEmail}
                        onChange={(event) => setSendReminderEnglishCopy(event.target.checked)}
                      />
                      Include English email copy
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void postJson(
                        `${API_BASE_URL}/manager/payment-reminders/send`,
                        {
                          actorEmail: normalizedEmail,
                          mode: unpaidReminderMode === "selected" ? "batch_selected" : "batch_unpaid",
                          emails: unpaidReminderMode === "selected" ? selectedUnpaidReminderEmails : undefined,
                          title: paymentReminderTitle.trim() || "Nhắc thanh toán tiền phòng",
                          body: paymentReminderBody.trim(),
                          sendPopup: sendReminderPopup,
                          sendInAppMessage: sendReminderInApp,
                          sendEmail: sendReminderEmail,
                          includeEnglishCopy: sendReminderEnglishCopy
                        },
                        "Batch reminders sent to unpaid clients."
                      )
                    }
                    disabled={
                      loading ||
                      !paymentReminderBody.trim() ||
                      (unpaidReminderMode === "selected"
                        ? selectedUnpaidReminderEmails.length === 0
                        : unpaidReminderCandidates.length === 0) ||
                      (!sendReminderPopup && !sendReminderInApp && !sendReminderEmail)
                    }
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {unpaidReminderMode === "selected"
                      ? `Send reminder to selected users (${selectedUnpaidReminderEmails.length})`
                      : `Send unpaid batch reminder (${unpaidReminderCandidates.length})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Short-term booking confirm & import dialog */}
      {stConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">{t("confirmImportBooking")}</h3>
              <p className="mt-1 text-xs text-slate-500">{stConfirmDialog.booking.guestName} · {stConfirmDialog.booking.email}</p>
              <p className="text-xs text-slate-500">{stConfirmDialog.booking.checkIn} → {stConfirmDialog.booking.checkOut}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t("branchLabel")}</label>
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
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t("bedNumberLabel")}</label>
                <input
                  type="number" min={1}
                  value={stConfirmDialog.bed}
                  onChange={(e) => setStConfirmDialog({ ...stConfirmDialog, bed: e.target.value })}
                  className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                  placeholder="e.g. 5"
                />
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                {t("initialPasswordWarning")}
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
              >{t("cancelLabel")}</button>
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
                {stConfirmDialog.saving ? t("importingLabel") : t("confirmImportLabel")}
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
              <h3 className="text-base font-semibold text-slate-900">{t("addHostelGuest")}</h3>
              <p className="mt-1 text-xs text-slate-500">{t("addHostelGuestDesc")}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("guestNameLabel")}</label>
                  <input type="text" value={stAddDialog.guestName} onChange={(e) => setStAddDialog({ ...stAddDialog, guestName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="Full name" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("emailLabel")}</label>
                  <input type="email" value={stAddDialog.email} onChange={(e) => setStAddDialog({ ...stAddDialog, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="guest@email.com" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("phoneLabel")}</label>
                  <input type="text" inputMode="tel" value={stAddDialog.phone} onChange={(e) => setStAddDialog({ ...stAddDialog, phone: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 0901234567" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("checkInLabel")}</label>
                  <input type="date" value={stAddDialog.checkIn} onChange={(e) => setStAddDialog({ ...stAddDialog, checkIn: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("checkOutLabel")}</label>
                  <input type="date" value={stAddDialog.checkOut} onChange={(e) => setStAddDialog({ ...stAddDialog, checkOut: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("branchLabel")}</label>
                  <div className="flex gap-2">
                    {(["D2", "D7"] as const).map((br) => (
                      <button key={br} type="button" onClick={() => setStAddDialog({ ...stAddDialog, branch: br })}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${stAddDialog.branch === br ? "bg-sky-600 text-white border-sky-600" : "border-slate-300 text-slate-600"}`}
                      >{br}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("bedNumberLabel")}</label>
                  <input type="number" min={1} value={stAddDialog.bed} onChange={(e) => setStAddDialog({ ...stAddDialog, bed: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 5" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("totalPriceLabel")}</label>
                  <input type="number" min={0} value={stAddDialog.totalAmount} onChange={(e) => setStAddDialog({ ...stAddDialog, totalAmount: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder="e.g. 1500000" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("paymentLabel")}</label>
                  <select value={stAddDialog.paymentStatus} onChange={(e) => setStAddDialog({ ...stAddDialog, paymentStatus: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none bg-white">
                    <option value="paid">{t("paidLabel")}</option>
                    <option value="cash">{t("cashLabel")}</option>
                    <option value="unpaid">{t("unpaidLabel")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("sourceLabel")}</label>
                  <select value={stAddDialog.source} onChange={(e) => setStAddDialog({ ...stAddDialog, source: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none bg-white">
                    <option value="direct">{t("directLabel")}</option>
                    <option value="booking.com">Booking.com</option>
                    <option value="airbnb">Airbnb</option>
                    <option value="other">{t("otherLabel")}</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t("notesLabel")}</label>
                  <textarea value={stAddDialog.notes} onChange={(e) => setStAddDialog({ ...stAddDialog, notes: e.target.value })}
                    rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" placeholder={t("anyExtraInfo")} />
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                {t("portalAccountWarning", "A portal account will be created for the guest. Initial password = phone digits. They must change it on first login.")}
              </div>
              {stAddDialog.result && (
                <div className={`rounded-xl p-3 text-xs font-medium ${stAddDialog.result.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {stAddDialog.result}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
              <button type="button" onClick={() => setStAddDialog(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">{t("cancelLabel")}</button>
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

      {diagramBedQuickSheet ? (
        <div className="fixed inset-0 z-[180] flex items-end justify-center sm:items-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="diagram-bed-sheet-title">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label={t("closeLabel")}
            onClick={() => setDiagramBedQuickSheet(null)}
          />
          <div className="relative z-[181] w-full max-w-md rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-3xl max-h-[min(90vh,520px)] flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p id="diagram-bed-sheet-title" className="truncate text-lg font-bold text-slate-900">
                  {diagramBedQuickSheet.client.name || diagramBedQuickSheet.client.email}
                </p>
                <p className="mt-0.5 truncate text-sm text-slate-500">{diagramBedQuickSheet.client.email}</p>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  {t("diagramBedQuickSheetTitle")} {diagramBedQuickSheet.bedNumber}
                  <span className="text-slate-400"> · </span>
                  {normalizeBranchLabel(diagramBedQuickSheet.client.branch)} · {resolveClientRoom(diagramBedQuickSheet.client)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDiagramBedQuickSheet(null)}
                className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                aria-label={t("closeLabel")}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <button
                type="button"
                onClick={() => {
                  setClientSubTab("details");
                  setShowClientDetails(false);
                  setDiagramBedQuickSheet(null);
                  window.setTimeout(() => {
                    managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 80);
                }}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                {t("diagramGoToClientDetail")}
              </button>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("diagramQuickActionsTitle")}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => {
                      setClientSubTab("details");
                      setShowClientDetails(false);
                      setActiveAction("");
                      setClientActionMenuOpen(true);
                      setDiagramBedQuickSheet(null);
                      window.setTimeout(() => {
                        managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 80);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    🧰 Tools
                  </button>
                  {canCreatePaymentReceipt ? (
                    <button
                      type="button"
                      onClick={() => {
                        setClientSubTab("details");
                        setActiveAction("payment");
                        setDiagramBedQuickSheet(null);
                        window.setTimeout(() => {
                          managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 80);
                      }}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      {t("newPaymentReceipt")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setClientSubTab("details");
                      setActiveAction("fine");
                      setDiagramBedQuickSheet(null);
                      window.setTimeout(() => {
                        managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 80);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    {t("newFineTicket")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClientSubTab("details");
                      setActiveAction("coins");
                      setDiagramBedQuickSheet(null);
                      window.setTimeout(() => {
                        managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 80);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    {t("newCoinsEntry")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClientSubTab("details");
                      setShowClientDetails(false);
                      setActiveAction("message");
                      setDiagramBedQuickSheet(null);
                      window.setTimeout(() => {
                        managerClientWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 80);
                    }}
                    className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-center text-xs font-semibold text-sky-900 hover:bg-sky-100"
                  >
                    {t("diagramMessageClient")}
                  </button>
                  {(() => {
                    const tel = toPhoneHref(getClientPhone(diagramBedQuickSheet.client));
                    return tel ? (
                      <a
                        href={tel}
                        className="flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2.5 text-center text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        {t("diagramCallNow")}
                      </a>
                    ) : (
                      <span className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-center text-xs font-medium text-slate-400">
                        {t("diagramNoPhoneOnFile")}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
