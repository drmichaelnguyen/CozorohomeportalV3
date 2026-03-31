"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { AdminCleaningClient } from "./admin-cleaning-client";
import { ManagerSupportInbox } from "./manager-support-inbox";
import { LaundryScheduleManager } from "./laundry-schedule-manager";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import Link from "next/link";


type StaffRole = "manager" | "owner" | "app_admin" | "mechanic";
type StatsTab = "laundry" | "coins" | "payments" | "fines";
type ClientAction = "call" | "sms" | "email" | "message" | "fine" | "coins" | "payment" | "";
type CoinEntryMode = "add" | "use";
type ManagerView = "overview" | "client_list" | "owners_employees" | "support_chat" | "feedbacks" | "admin_cleaning" | "scheduling" | "controller";
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

type BranchLayoutRoom = {
  room: string;
  floor: string;
  startBed: number;
  endBed: number;
  bunkCount: number;
};

type CoinEntry = { row: Record<string, string>; parsedTimestamp: string | null };
type PaymentEntry = { row: Record<string, string>; parsedTimestamp: string | null };
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
};
type FeedbackEntry = {
  fileName: string;
  email: string;
  page: string;
  message: string;
  createdAt: string;
};

type RentBreakdown = {
  email: string;
  month: string;
  baseRent: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate: number;
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

const PAYMENT_PURPOSE_OPTIONS = [
  "Monthly rent",
  "Deposit",
  "Utilities",
  "Laundry fee",
  "Fine payment",
  "Room transfer",
  "Extension fee",
  "Other"
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

function summarizeLaundry(entries: LaundryEntry[]): StatSummaryItem[] {
  const now = Date.now();
  const upcoming = entries.filter((entry) => new Date(entry.start).getTime() > now).length;
  const completed = entries.filter((entry) => new Date(entry.end).getTime() <= now).length;
  const nextBooking = entries
    .filter((entry) => new Date(entry.start).getTime() > now)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())[0];

  return [
    { label: "Total bookings", value: formatNumber(entries.length) },
    { label: "Upcoming", value: formatNumber(upcoming), tone: upcoming > 0 ? "positive" : "default" },
    { label: "Completed", value: formatNumber(completed) },
    { label: "Next booking", value: nextBooking ? formatDateTime(nextBooking.start) : "No upcoming booking", tone: nextBooking ? "warning" : "default" }
  ];
}

function summarizeCoins(entries: CoinEntry[], client: ManagerClientRecord | null): StatSummaryItem[] {
  const deltas = entries.map((entry) =>
    parseLooseNumber(findRowValue(entry.row, ["coins"]) || entry.row.COINS || entry.row["COINS"])
  );
  const earned = deltas.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const spent = Math.abs(deltas.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  return [
    { label: "Current balance", value: formatNumber(parseLooseNumber(client?.currentCoins != null ? String(client.currentCoins) : null)), tone: "positive" },
    { label: "Lifetime coins", value: formatNumber(parseLooseNumber(client?.totalCoins != null ? String(client.totalCoins) : null)) },
    { label: "Coins added", value: formatNumber(earned) },
    { label: "Coins used", value: formatNumber(spent), tone: spent > 0 ? "warning" : "default" }
  ];
}

function summarizePayments(entries: PaymentEntry[]): StatSummaryItem[] {
  const amounts = entries.map((entry) =>
    parseLooseNumber(findRowValue(entry.row, ["sotien"]) || findRowValue(entry.row, ["amount"]))
  );
  const totalPaid = amounts.reduce((sum, value) => sum + value, 0);
  const latestPayment = entries[0]?.parsedTimestamp ?? null;

  return [
    { label: "Payment count", value: formatNumber(entries.length) },
    { label: "Total paid", value: formatCurrency(totalPaid), tone: "positive" },
    { label: "Average payment", value: entries.length ? formatCurrency(Math.round(totalPaid / entries.length)) : formatCurrency(0) },
    { label: "Latest payment", value: latestPayment ? formatDateTime(latestPayment) : "No payments yet" }
  ];
}

function summarizeFines(entries: FineEntry[]): StatSummaryItem[] {
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
    { label: "Fine count", value: formatNumber(entries.length) },
    { label: "Unpaid fines", value: formatNumber(unpaidCount), tone: unpaidCount > 0 ? "warning" : "default" },
    { label: "Total fine value", value: formatCurrency(totalFine) },
    { label: "Nearest due date", value: nextDue?.parsedDueDate ? formatDateTime(nextDue.parsedDueDate) : "No due date", tone: nextDue?.parsedDueDate ? "warning" : "default" }
  ];
}

function getSummaryItems(tab: StatsTab, workspace: WorkspacePayload | null): StatSummaryItem[] {
  if (!workspace) {
    return [];
  }

  if (tab === "laundry") {
    return summarizeLaundry(workspace.stats.laundry);
  }
  if (tab === "coins") {
    return summarizeCoins(workspace.stats.coins, workspace.client);
  }
  if (tab === "payments") {
    return summarizePayments(workspace.stats.payments);
  }
  return summarizeFines(workspace.stats.fines);
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
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [isEditingClientProfile, setIsEditingClientProfile] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>("laundry");
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
  const [paymentPurpose, setPaymentPurpose] = useState("Monthly rent");
  const [paymentPurposeInput, setPaymentPurposeInput] = useState("");
  const [paymentPurposeSelections, setPaymentPurposeSelections] = useState<string[]>(["Monthly rent"]);
  const [paymentDetails, setPaymentDetails] = useState("");
  const [paymentPayer, setPaymentPayer] = useState("");
  const [paymentBranch, setPaymentBranch] = useState("");
  const [paymentRecipientEmail, setPaymentRecipientEmail] = useState("");
  const [paymentMemberTier, setPaymentMemberTier] = useState("");
  const [paymentCurrentCoins, setPaymentCurrentCoins] = useState("");
  const [paymentDiscountAmount, setPaymentDiscountAmount] = useState("");
  const [paymentDiscountCondition, setPaymentDiscountCondition] = useState("");
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [selfDisplayName, setSelfDisplayName] = useState("");
  const [selfDisplayNameSaving, setSelfDisplayNameSaving] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>("manager");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
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
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [supportSubTab, setSupportSubTab] = useState<"messages" | "feedbacks" | "maintenance">("messages");
  const [clientSubTab, setClientSubTab] = useState<"list" | "details">("list");
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
  const selectedClient = useMemo(
    () => clients.find((client) => client.maHd === selectedMaHd) ?? null,
    [clients, selectedMaHd]
  );
  const fineLabels = fineFieldLabels(language);
  const fineUiText =
    language === "vi"
      ? {
          suggestionPlaceholder: "T\u00ecm gi\u00e1 tr\u1ecb c\u0169 ho\u1eb7c nh\u1eadp m\u1edbi",
          uploadHint: "Ch\u1ee5p \u1ea3nh ho\u1eb7c t\u1ea3i l\u00ean t\u1eeb \u0111i\u1ec7n tho\u1ea1i / m\u00e1y t\u00ednh",
          uploading: "\u0110ang t\u1ea3i \u1ea3nh l\u00ean...",
          uploaded: "\u0110\u00e3 t\u1ea3i \u1ea3nh l\u00ean Google Drive",
          removeImage: "X\u00f3a \u1ea3nh"
        }
      : {
          suggestionPlaceholder: "Search previous entries or type a new value",
          uploadHint: "Take a picture or upload an image from phone or computer",
          uploading: "Uploading image...",
          uploaded: "Image uploaded to Google Drive",
          removeImage: "Remove image"
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
  const summaryItems = useMemo(() => getSummaryItems(activeTab, workspace), [activeTab, workspace]);
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
      workspace?.stats.payments
        .map(
          (entry) =>
            findRowValue(entry.row, ["mucdich"]) ||
            findRowValue(entry.row, ["purpose"])
        )
        .flatMap((value) =>
          String(value ?? "")
            .split(/[,;/]+/)
            .map((part) => part.trim())
            .filter(Boolean)
        ) ?? [];

    return Array.from(new Set([...PAYMENT_PURPOSE_OPTIONS, ...historicalPurposes])).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [workspace]);
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
        label: selectedBranch || "Rooms",
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
      { label: "Branches", value: formatNumber(branchCount) },
      { label: selectedBranch === "D7" ? "Floors" : "Rooms", value: formatNumber(selectedBranch === "D7" ? floors.size : overviewRooms.length) },
      { label: selectedBranch === "D7" ? "Rooms" : "Occupied beds", value: formatNumber(selectedBranch === "D7" ? overviewRooms.length : totalBeds) },
      { label: "Clients", value: formatNumber(selectedBranch ? totalBeds : clients.length) }
    ];
  }, [branchOverviewGroups, clients.length, quickNav.length, selectedBranch]);

  const selectedClientPhone = getClientPhone(selectedClient);
  const selectedClientTelHref = toPhoneHref(selectedClientPhone);
  const selectedClientSmsHref = toSmsHref(selectedClientPhone);



  useEffect(() => {
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
        setStatus(data.error ?? "Unable to load clients.");
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
      setStatus(syncFirst ? "Client data refreshed." : "Client list loaded.");
    } catch {
      setStatus("Unable to load clients.");
    } finally {
      setLoading(false);
    }
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
        setStatus(data.error ?? "Unable to load client workspace.");
        return;
      }
      setWorkspace(data);
      setActiveTab(tab);
      setStatus(`Loaded ${tab} for ${data.client.name || data.client.email}.`);
    } catch {
      setStatus("Unable to load client workspace.");
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
      setStatus(data.error ?? "Unable to load owners and employees.");
    }
  }

  useEffect(() => {
    if (!isStaffSession) {
      setClients([]);
      setWorkspace(null);
      setStaffEntries([]);
      return;
    }
    void loadClients(false);
    if (isStaffSession) {
      void loadTeam();
    }
  }, [isStaffSession, normalizedEmail]);

  useEffect(() => {
    setActiveAction("");
    setFineImage("");
    setFineImageFileName("");
    setPaymentPurpose("Monthly rent");
    setPaymentPurposeInput("");
    setPaymentPurposeSelections(["Monthly rent"]);
    setPaymentDiscountAmount("");
    setPaymentDiscountCondition("");
    const client = clients.find((c) => c.maHd === selectedMaHd) ?? null;
    setPaymentBranch(client ? normalizeBranchLabel(client.branch) : "");
    setPaymentRecipientEmail(client?.email ?? "");
    setPaymentMemberTier(client?.recordedMember ?? "");
    setPaymentCurrentCoins(client?.currentCoins ?? "");
  }, [selectedMaHd, clients]);

  useEffect(() => {
    if (activeAction === "message" && selectedClient?.email) {
      void loadClientChat(selectedClient.email);
    }
  }, [activeAction, selectedClient?.email]);

  useEffect(() => {
    if (activeManagerView === "feedbacks") {
      void loadFeedbacks();
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

  const handleAcControl = async (roomId: string, action: "ON" | "OFF") => {
    try {
      const response = await fetch(`${API_BASE_URL}/controller/ac/rooms/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, action })
      });
      if (response.ok) {
        void fetchDevices();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to control AC");
      }
    } catch (err) {
      alert("Network error controlling AC");
    }
  };

  const handleMachineTrigger = async (machineId: string, deviceType: "laundry" | "airfryer") => {
    // AntiGravity: Manager manual override warning
    if (!window.confirm(`WARNING: Manual override for ${machineId}. This will bypass resident booking schedules. Proceed?`)) {
      return;
    }
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
        alert(`${machineId} triggered successfully.`);
      } else {
        const data = await response.json();
        alert(data.error || `Failed to trigger ${deviceType}`);
      }
    } catch (err) {
      alert(`Network error triggering ${deviceType}`);
    }
  };

  useEffect(() => {
    if (activeManagerView === "controller") {
      void fetchDevices();
    }
  }, [activeManagerView, fetchDevices]);

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
        setStatus(data.error ?? "Request failed.");
        return;
      }
      if (after) {
        await after();
      }
      setEditingId("");
      setEditValues({});
      setStatus(successMessage);
    } catch {
      setStatus("Request failed.");
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
        setStatus(data.error ?? "Unable to load client chat.");
        return;
      }
      setClientChatMessages(data.messages ?? []);
    } catch {
      setStatus("Unable to load client chat.");
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
        setStatus(data.error ?? "Unable to load feedbacks.");
        return;
      }
      setFeedbackEntries(data.entries ?? []);
    } catch {
      setStatus("Unable to load feedbacks.");
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
        setStatus(data.error ?? "Unable to upload fine image.");
        return;
      }

      setFineImage(data.url);
      setFineImageFileName(data.fileName ?? file.name);
      setStatus("Fine image uploaded.");
    } catch {
      setStatus("Unable to upload fine image.");
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
  }

  if (!isStaffSession) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Cozoro Side</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with a Cozoro, manager, or owner account to search clients, send messages, create fine tickets, add coin entries, and review client statistics.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Management Workspace</h1>
              <p className="mt-2 text-sm text-slate-600">
                Search clients, edit their profile, send messages, create fine tickets and coin entries, then open laundry, coins, payments, or fines from latest to oldest.
              </p>
            </div>
          <button
            type="button"
            onClick={() => void loadClients(true)}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
          >
            Refresh data
          </button>
        </div>
        {status ? <p className="mt-4 text-sm text-slate-700">{status}</p> : null}
      </section>

      {(activeManagerView === "client_list" || activeManagerView === "overview") ? (
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
              1. Browse List
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
                2. Client Details
              </button>
            )}
          </div>

          {clientSubTab === "list" ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedBranch("D2")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedBranch === "D2" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                }`}
              >
                Branch D2
              </button>
              <button
                type="button"
                onClick={() => setSelectedBranch("D7")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedBranch === "D7" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"
                }`}
              >
                Branch D7
              </button>
              <Link
                href="/support?newGroup=true"
                className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition-all hover:bg-sky-100"
              >
                + New Group Message
              </Link>
            </div>
            <div className="flex rounded-xl bg-slate-100 p-1 shadow-inner">
              <button
                type="button"
                onClick={() => setClientListMode("diagram")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                  clientListMode === "diagram" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Diagram
              </button>
              <button
                type="button"
                onClick={() => setClientListMode("table")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                  clientListMode === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Table
              </button>
            </div>
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
                      return (
                        <div key={room.room} className={`relative rounded-2xl border bg-white p-3 shadow-sm transition-all hover:shadow-md ${roomUnread > 0 ? "border-sky-300 ring-1 ring-sky-300" : "border-slate-200"}`}>
                          {roomUnread > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                              {roomUnread}
                            </span>
                          )}
                          <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                            <span className="text-sm font-bold text-slate-900">Room {room.room}</span>
                            <span className="text-[10px] font-medium text-slate-500">{room.clients.length} beds</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {room.diagram.bunks.map((bunk) => (
                              <div key={bunk.bunkNumber} className="flex flex-col gap-1 w-14 p-1 rounded-lg border border-slate-100 bg-slate-50/20">
                                {bunk.levels.map((slot) => {
                                  const client = slot.client;
                                  const isSelected = client?.maHd === selectedMaHd;
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
                                          : client
                                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                            : "border-dashed border-slate-200 bg-slate-25 text-slate-300"
                                      }`}
                                      title={client ? `${client.name} (Bed ${slot.bedNumber})` : `Bed ${slot.bedNumber} (Empty)`}
                                    >
                                      {client && (
                                        <span className="absolute left-0.5 top-0.5 text-[7px] leading-none text-emerald-600/70">
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
                      {["Name", "Branch", "Room", "Bed", "Contract", "Phone", "Coins", "Status"].map((header) => (
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
                             <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 font-medium">Active</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {false ? <section /> : null}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Selected Client</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedClient ? `${selectedClient.name || selectedClient.email} • ${selectedClient.maHd}` : "Choose a client from the list."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setShowClientDetails((current) => !current)}
                  disabled={!selectedClient}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {showClientDetails ? "Hide details" : "Show details"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingClientProfile(true)}
                  disabled={loading || !selectedClient || isEditingClientProfile}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  Edit profile
                </button>
                {selectedClient && (
                  <>
                    <Link
                      href={`/support?tab=room&groupId=ROOM_${normalizeBranchLabel(selectedClient.branch)}_${resolveClientRoom(selectedClient)}`}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
                    >
                      Message Room
                    </Link>
                    <Link
                      href={`/support?tab=branch&groupId=BRANCH_${normalizeBranchLabel(selectedClient.branch)}`}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      Message Branch
                    </Link>
                  </>
                )}

                <button
                  type="button"
                  onClick={() =>

                    void postJson(
                      `${API_BASE_URL}/staff/client-sheet-update`,
                      { actorEmail: normalizedEmail, maHd: selectedClient?.maHd ?? "", values: clientForm },
                      "Client profile updated.",
                      async () => {
                        await loadClients(false);
                      }
                    )
                  }
                  disabled={loading || !selectedClient || !isEditingClientProfile}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Submit profile changes
                </button>
                <button
                  type="button"
                  onClick={() => fillClientForm(selectedClient)}
                  disabled={loading || !selectedClient || !isEditingClientProfile}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  Cancel edit
                </button>
              </div>
            </div>

            {selectedClient ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contract</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.maHd || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.branch || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Room / Bed</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{resolveClientRoom(selectedClient)} / {selectedClient.bed || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coins</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedClient.currentCoins || "0"} current</div>
                    <div className="mt-1 text-sm text-slate-600">{selectedClient.totalCoins || "0"} lifetime</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</div>
                    <div className="mt-2 text-sm text-slate-800">{selectedClient.email || "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</div>
                    <div className="mt-2 text-sm text-slate-800">{selectedClientPhone || "-"}</div>
                  </div>
                </div>

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
                <h2 className="text-lg font-semibold text-slate-900">Client Actions</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Choose an action first, then complete it in the popup form.
                </p>
              </div>
              <div className="text-sm text-slate-600">
                <div>Email: {selectedClient?.email || "-"}</div>
                <div>Phone: {selectedClientPhone || "-"}</div>
              </div>
            </div>
              <div className="mt-4 flex flex-wrap gap-3">
                  {[
                    ["call", "Call client"],
                    ["sms", "Text client"],
                    ["email", "Email client"],
                    ["message", "Open chat"],
                    ["fine", "New fine ticket"],
                  ["coins", "New coins entry"],
                  ...(canCreatePaymentReceipt ? ([["payment", "New payment receipt"]] as const) : [])
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
                  <h3 className="text-base font-semibold text-slate-900">
                    {activeAction === "call"
                      ? "Call Client"
                      : activeAction === "sms"
                        ? "Text Client"
                        : activeAction === "email"
                          ? "Email Client"
                          : activeAction === "message"
                            ? "Client Chat"
                            : activeAction === "payment"
                                ? "Create Payment Receipt"
                              : activeAction === "fine"
                                ? "Create Fine Ticket"
                                : "Create Coins Entry"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveAction("")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    Close
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
                      Start call
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
                      Open email
                    </a>
                  </div>
                ) : null}

                {activeAction === "message" ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-600">
                        Conversation with {selectedClient?.name || selectedClient?.email || "client"}
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadClientChat()}
                        disabled={clientChatLoading || !selectedClient}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        Refresh chat
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
                          {clientChatLoading ? "Loading chat..." : "No chat messages yet. Start the conversation below."}
                        </div>
                      )}
                    </div>
                    <textarea
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"
                      placeholder="Write a reply to this client..."
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
                        Rent Calculation
                      </button>
                      <button
                        type="button"
                        onClick={() => setRentPaymentMode("simple")}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                          rentPaymentMode === "simple" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Simple Receipt
                      </button>
                    </div>

                    {rentPaymentMode === "rent" ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            Target Month
                            <input
                              type="month"
                              value={targetMonthInput}
                              onChange={(e) => setTargetMonthInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Manager Discount (VND)
                            <input
                              type="number"
                              value={managerDiscountInput}
                              onChange={(e) => setManagerDiscountInput(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
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
                                  managerDiscountVnd: Number(managerDiscountInput)
                                })
                              });
                              if (!response.ok) throw new Error("Calculation failed");
                              const data = await response.json();
                              setRentBreakdown(data);
                            } catch (err) {
                              alert(err instanceof Error ? err.message : "Error");
                            } finally {
                              setCalculatingRent(false);
                            }
                          }}
                          disabled={calculatingRent || !selectedClient}
                          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
                        >
                          {calculatingRent ? "Calculating..." : "Calculate Rent Breakdown"}
                        </button>

                        {rentBreakdown ? (
                          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-900">Breakdown for {rentBreakdown.month}</h4>
                            
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-slate-600">Base Rent</span>
                                <span className="font-medium">{rentBreakdown.baseRent.toLocaleString()} VND</span>
                              </div>
                              
                              {rentBreakdown.tenureSurchargeVnd > 0 && (
                                <div className="flex justify-between text-amber-600">
                                  <span>Tenure Surcharge ({rentBreakdown.tenureSurchargeRate * 100}%)</span>
                                  <span>+{rentBreakdown.tenureSurchargeVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.professionalDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>Professional Discount (10%)</span>
                                  <span>-{rentBreakdown.professionalDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.planDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>Plan Discount</span>
                                  <span>-{rentBreakdown.planDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              {rentBreakdown.managerDiscountVnd > 0 && (
                                <div className="flex justify-between text-emerald-600">
                                  <span>Manager Discount</span>
                                  <span>-{rentBreakdown.managerDiscountVnd.toLocaleString()} VND</span>
                                </div>
                              )}

                              <div className="flex justify-between">
                                <span className="text-slate-600">Parking Fee</span>
                                <span className="font-medium">{rentBreakdown.parkingFeeVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between">
                                <span className="text-slate-600">Laundry Fee ({rentBreakdown.details.laundryCount.cash} paid uses)</span>
                                <span className="font-medium">{rentBreakdown.laundryFeeVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between">
                                <span className="text-slate-600">Unpaid Fines</span>
                                <span className="font-medium">{rentBreakdown.finesVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="my-2 border-t border-slate-100 pt-2 font-bold flex justify-between">
                                <span>Subtotal</span>
                                <span>{rentBreakdown.totalBeforeCoinsVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="flex justify-between text-sky-600">
                                <span>Coin Usage ({rentBreakdown.recommendedCoinUsage} coins)</span>
                                <span>-{rentBreakdown.recommendedCoinValueVnd.toLocaleString()} VND</span>
                              </div>

                              <div className="my-2 rounded-xl bg-slate-900 p-4 text-white flex justify-between items-center">
                                <span className="text-xs uppercase tracking-wider opacity-70 font-bold">Total Due</span>
                                <span className="text-xl font-bold">{rentBreakdown.finalTotalVnd.toLocaleString()} VND</span>
                              </div>
                            </div>

                            <div className="space-y-3 pt-3">
                              <label className="block text-sm font-medium text-slate-700">
                                Payer Name
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
                                onClick={async () => {
                                  setLoading(true);
                                  try {
                                    const response = await fetch(`${API_BASE_URL}/pay-rent`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        email: selectedClient?.email,
                                        targetMonth: targetMonthInput,
                                        managerDiscountVnd: Number(managerDiscountInput),
                                        coinUsage: rentBreakdown.recommendedCoinUsage,
                                        payerName: paymentPayer || selectedClient?.name,
                                        receiverName: normalizedEmail
                                      })
                                    });
                                    if (!response.ok) throw new Error("Payment recording failed");
                                    alert("Payment recorded and receipt sent via Gmail!");
                                    setActiveAction("");
                                    setRentBreakdown(null);
                                    if (selectedClient) await loadWorkspace("payments", selectedClient.maHd);
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : "Error");
                                  } finally {
                                    setLoading(false);
                                  }
                                }}
                                disabled={loading}
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
                        <label className="block text-sm font-medium text-slate-700">
                          Số tiền / Amount
                          <input type="number" min="1" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                        </label>
                        <div className="block text-sm font-medium text-slate-700">
                          Mục đích / Purpose
                          <div className="mt-2 flex flex-wrap gap-2">
                            {paymentPurposeSuggestions.map((option) => {
                              const isSelected = paymentPurposeSelections.some((s) => s.toLowerCase() === option.toLowerCase());
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() =>
                                    isSelected
                                      ? syncPaymentPurposeSelection(paymentPurposeSelections.filter((s) => s.toLowerCase() !== option.toLowerCase()))
                                      : syncPaymentPurposeSelection([...paymentPurposeSelections, option])
                                  }
                                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                    isSelected
                                      ? "border-sky-400 bg-sky-500 text-white"
                                      : "border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                                  }`}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              value={paymentPurposeInput}
                              onChange={(event) => setPaymentPurposeInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === ",") {
                                  event.preventDefault();
                                  addPaymentPurposeOption(paymentPurposeInput);
                                }
                              }}
                              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              placeholder="Mục đích khác..."
                            />
                            <button
                              type="button"
                              onClick={() => addPaymentPurposeOption(paymentPurposeInput)}
                              disabled={!paymentPurposeInput.trim()}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              Thêm
                            </button>
                          </div>
                        </div>
                        <label className="block text-sm font-medium text-slate-700">
                          Mục đích - Ghi rõ / Details
                          <textarea value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} rows={2} className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Chi nhánh Dorm
                            <input type="text" value={paymentBranch} onChange={(event) => setPaymentBranch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Cozoro Member
                            <input type="text" value={paymentMemberTier} onChange={(event) => setPaymentMemberTier(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Số Coins hiện có
                            <input type="text" value={paymentCurrentCoins} onChange={(event) => setPaymentCurrentCoins(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Địa chỉ email người nhận
                            <input type="text" value={paymentRecipientEmail} onChange={(event) => setPaymentRecipientEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder={selectedClient?.email ?? ""} />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Số tiền hưởng ưu đãi
                            <input type="number" min="0" value={paymentDiscountAmount} onChange={(event) => setPaymentDiscountAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="0" />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Điều kiện hưởng ưu đãi
                            <input type="text" value={paymentDiscountCondition} onChange={(event) => setPaymentDiscountCondition(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="VD: Member Gold" />
                          </label>
                        </div>
                        <label className="block text-sm font-medium text-slate-700">
                          Người đóng tiền / Payer
                          <input type="text" value={paymentPayer} onChange={(event) => setPaymentPayer(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder={selectedClient?.name || selectedClient?.email || ""} />
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
                              "Đã tạo biên nhận thanh toán.",
                              async () => {
                                if (selectedClient) await loadWorkspace("payments", selectedClient.maHd);
                                setPaymentPurposeInput("");
                                syncPaymentPurposeSelection(["Monthly rent"]);
                              }
                            );
                          }}
                          disabled={loading || !selectedClient || !canCreatePaymentReceipt || !Number(paymentAmount) || (!paymentPurposeSelections.length && !paymentPurposeInput.trim())}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          Create payment receipt
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
                          "Fine ticket created.",
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
                      <option value="add">Adding coins</option>
                      <option value="use">Using coins</option>
                    </select>
                    <label className="block text-sm font-medium text-slate-700">
                      Search or create event
                      <input
                        type="text"
                        list="coin-event-options"
                        value={coinReason}
                        onChange={(event) => setCoinReason(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        placeholder="Search available events or type a new one"
                      />
                    </label>
                    <datalist id="coin-event-options">
                      {coinEventSuggestions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Available options and previous entries
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
                            No match found. You can create a new event by typing it above.
                          </div>
                        )}
                      </div>
                    </div>
                    <input type="number" min="1" value={coinAmount} onChange={(event) => setCoinAmount(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder="Coins amount" />
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/manager/coins/adjust`,
                          { maHd: selectedClient?.maHd ?? "", delta: Math.abs(Number(coinAmount)) * (coinEntryMode === "use" ? -1 : 1), reason: coinReason, operator: normalizedEmail },
                          "Coins entry created.",
                          async () => {
                            await loadClients(true);
                            if (selectedClient) await loadWorkspace("coins", selectedClient.maHd);
                          }
                        )
                      }
                      disabled={loading || !selectedClient || !Number(coinAmount) || !coinReason.trim()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Create coins entry
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Client Statistics</h2>
                <p className="mt-1 text-sm text-slate-600">Open laundry, coins, payments, or fines on demand. Each tab starts with a summary, and raw entries only appear when requested.</p>
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
                Select a client and press one of the statistic buttons.
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
                    {showAllStatsEntries ? "Hide entries panel" : "Open entries panel"}
                  </button>
                </div>
              </div>
            ) : null}

            {workspace && showAllStatsEntries && activeTab === "laundry" ? (
              <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-600">
                  Laundry entries are packed into a scroll panel so the manager page stays shorter.
                </div>
                <div className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Summary</th>
                        <th className="px-4 py-3 font-medium">Start</th>
                        <th className="px-4 py-3 font-medium">End</th>
                        <th className="px-4 py-3 font-medium">Location</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {workspace.stats.laundry.map((entry) => {
                        const key = makeKey([entry.calendarId, entry.id]);
                        return (
                          <tr key={key} className="align-top">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900">{entry.summary}</div>
                              {entry.description ? <div className="mt-1 whitespace-pre-wrap text-slate-600">{entry.description}</div> : null}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{formatDateTime(entry.start)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatDateTime(entry.end)}</td>
                            <td className="px-4 py-3 text-slate-700">{entry.location || entry.calendarSummary || "-"}</td>
                            <td className="px-4 py-3">
                              <button type="button" onClick={() => { setEditingId(`laundry:${key}`); setEditValues({ summary: entry.summary, description: entry.description, location: entry.location, start: toDateTimeLocalValue(entry.start), end: toDateTimeLocalValue(entry.end) }); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Edit</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>

                {workspace.stats.laundry.map((entry) => {
                  const key = makeKey([entry.calendarId, entry.id]);
                  const isEditing = editingId === `laundry:${key}`;
                  return isEditing ? (
                    <div key={`edit-${key}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="space-y-3">
                        <input type="text" value={editValues.summary ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, summary: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                        <input type="text" value={editValues.location ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, location: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                        <input type="datetime-local" value={editValues.start ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, start: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                        <input type="datetime-local" value={editValues.end ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, end: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                        <textarea value={editValues.description ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, description: event.target.value }))} rows={4} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                        <div className="flex gap-3">
                          <button type="button" onClick={() => void postJson(`${API_BASE_URL}/staff/laundry/update`, { actorEmail: normalizedEmail, calendarId: entry.calendarId, eventId: entry.id, summary: editValues.summary ?? "", description: editValues.description ?? "", location: editValues.location ?? "", start: new Date(editValues.start ?? "").toISOString(), end: new Date(editValues.end ?? "").toISOString() }, "Laundry entry updated.", async () => { if (selectedClient) await loadWorkspace("laundry", selectedClient.maHd); })} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Save</button>
                          <button type="button" onClick={() => setEditingId("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">Cancel</button>
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
                  Showing a compact entries panel with its own scroll area.
                </div>
                <div className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Detail 1</th>
                        <th className="px-4 py-3 font-medium">Detail 2</th>
                        <th className="px-4 py-3 font-medium">Detail 3</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {(activeTab === "coins" ? workspace.stats.coins : activeTab === "payments" ? workspace.stats.payments : workspace.stats.fines).map((entry) => {
                        const key = makeKey(Object.values(entry.row).slice(0, 4));
                        const preview = Object.entries(entry.row).filter(([, value]) => String(value ?? "").trim()).slice(0, 4);
                        return (
                          <tr key={`table:${key}`} className="align-top">
                            <td className="px-4 py-3 text-slate-700">{formatDateTime(entry.parsedTimestamp)}</td>
                            <td className="px-4 py-3 text-slate-700">{preview[1] ? `${preview[1][0]}: ${preview[1][1]}` : "-"}</td>
                            <td className="px-4 py-3 text-slate-700">{preview[2] ? `${preview[2][0]}: ${preview[2][1]}` : "-"}</td>
                            <td className="px-4 py-3 text-slate-700">{preview[3] ? `${preview[3][0]}: ${preview[3][1]}` : "-"}</td>
                            <td className="px-4 py-3">
                              <button type="button" onClick={() => { setEditingId(`${activeTab}:${key}`); setEditValues(entry.row); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Edit</button>
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

      {activeManagerView === "owners_employees" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Owners & employees</h2>
              <p className="mt-1 text-sm text-slate-600">
                Store and review Cozoro-side accounts with manager, owner, or app admin status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadTeam()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              Refresh accounts
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              {language === "vi" ? "Cài đặt ngôn ngữ" : "Language Preference"}
            </h3>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                {language === "vi" ? "Chọn ngôn ngữ hiển thị cho cổng quản lý." : "Choose the display language for the management portal."}
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
              {language === "vi" ? "Tên hiển thị" : "Your Display Name"}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {language === "vi"
                ? "Tên này hiển thị trên biên lai thanh toán. Email không thể thay đổi."
                : "This name appears on payment receipts. Your email cannot be changed."}
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
                    if (!res.ok) throw new Error(data.error ?? "Failed to save");
                    setStatus(language === "vi" ? "Đã lưu tên hiển thị." : "Display name saved.");
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : "Failed to save display name");
                  } finally {
                    setSelfDisplayNameSaving(false);
                  }
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {selfDisplayNameSaving ? (language === "vi" ? "Đang lưu..." : "Saving...") : (language === "vi" ? "Lưu" : "Save")}
              </button>
            </div>
          </div>

          {canManageOwnersEmployees ? (
            <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Create or update account access</div>
                <p className="mt-1 text-sm text-slate-600">
                  {isAppAdminSession
                    ? "App admin can add managers and owners. A selected client can also be promoted to manager."
                    : "Owners can add or update manager accounts. A selected client can also be promoted to manager."}
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
                  Make selected client a manager
                </button>
                {selectedClient?.email ? (
                  <div className="text-sm text-slate-600">
                    Selected client email: {selectedClient.email}
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
                  placeholder="Display name"
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
                      "Account access updated. New accounts will be asked to change password on first login.",
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
                  Save account
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Managers can view the owners and employees directory here, but only owners or the app admin can change it.
            </div>
          )}

          <div className="mt-6 space-y-3">
            {staffEntries.length ? (
              staffEntries.map((entry) => (
                <div
                  key={entry.email}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      {entry.name ? `${entry.name} — ` : ""}{entry.email}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Role: {entry.role} | Added by: {entry.addedBy || "system"}
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
                        onClick={() =>
                          void fetch(`${API_BASE_URL}/staff-access`, {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ actorEmail: normalizedEmail, targetEmail: entry.email })
                          }).then(() => loadTeam())
                        }
                        disabled={entry.role === "app_admin"}
                        className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">View only</div>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                No owners or employees have been added yet.
              </div>
            )}
          </div>
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
                  <h2 className="text-lg font-semibold text-slate-900">Resident Feedbacks</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Review notes submitted by residents via the portal.
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
            <LaundryScheduleManager />
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
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${room.lastRequestedAction === "ON" ? "bg-emerald-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600"}`}
                        >
                          ON
                        </button>
                        <button 
                          onClick={() => handleAcControl(room.id, "OFF")}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${room.lastRequestedAction === "OFF" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}
                        >
                          OFF
                        </button>
                      </div>
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
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${room.lastRequestedAction === "ON" ? "bg-emerald-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600"}`}
                        >
                          ON
                        </button>
                        <button 
                          onClick={() => handleAcControl(room.id, "OFF")}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${room.lastRequestedAction === "OFF" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}
                        >
                          OFF
                        </button>
                      </div>
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
                        <div className="font-bold text-amber-900">{af.label}</div>
                        <div className="text-[10px] text-amber-500 font-bold uppercase mt-0.5">Branch {af.branchId} Appliance</div>
                        <button 
                          onClick={() => handleMachineTrigger(af.id, "airfryer")}
                          className="mt-4 w-full rounded-xl bg-amber-600 py-2.5 text-xs font-black text-white shadow-lg shadow-amber-200 hover:bg-amber-700 active:scale-95 transition-all"
                        >
                          TRIGGER {af.label.toUpperCase()}
                        </button>
                     </div>
                   ))}

                   {/* Laundry Machines */}
                   {laundryMachines.map(machine => (
                    <div key={machine.id} className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                      <div className="font-bold text-sky-900">{machine.label}</div>
                      <div className="text-[10px] text-sky-400 font-bold uppercase mt-0.5">Branch {machine.branchId} Unit</div>
                      <button 
                        onClick={() => handleMachineTrigger(machine.id, "laundry")}
                        className="mt-4 w-full rounded-xl bg-sky-600 py-2.5 text-xs font-black text-white shadow-lg shadow-sky-200 hover:bg-sky-700 active:scale-95 transition-all"
                      >
                        TRIGGER {machine.label.toUpperCase()}
                      </button>
                    </div>
                   ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Usage History</h2>
              <button type="button" className="text-sm font-medium text-sky-600 hover:underline">View All History</button>
            </div>
            <div className="mt-6 space-y-3">
              {[
                { time: "2 hours ago", device: "Washer 1 (D7)", user: "John Doe", duration: "45 mins" },
                { time: "4 hours ago", device: "AC Unit 1 (D7)", user: "Jane Smith", duration: "2 hours" },
                { time: "Yesterday", device: "Airfryer (D2)", user: "Bob Wilson", duration: "20 mins" }
              ].map((entry, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{entry.device}</div>
                    <div className="text-xs text-slate-500">{entry.user} · {entry.time}</div>
                  </div>
                  <div className="font-semibold text-slate-900">{entry.duration}</div>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
