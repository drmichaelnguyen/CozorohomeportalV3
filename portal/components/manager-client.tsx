"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { AdminCleaningClient } from "./admin-cleaning-client";
import { ManagerSupportInbox } from "./manager-support-inbox";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

type StaffRole = "manager" | "owner" | "app_admin";
type StatsTab = "laundry" | "coins" | "payments" | "fines";
type ClientAction = "call" | "sms" | "email" | "message" | "fine" | "coins" | "payment" | "";
type CoinEntryMode = "add" | "use";
type ManagerView = "overview" | "client_list" | "owners_employees" | "support_chat" | "feedbacks" | "admin_cleaning";
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
  currentCoins: string;
  totalCoins: string;
  row: Record<string, string>;
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
  addedBy: string;
};
type FeedbackEntry = {
  fileName: string;
  email: string;
  page: string;
  message: string;
  createdAt: string;
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
    { room: "1.1", floor: "Floor 1", startBed: 1, endBed: 6, bunkCount: 2 },
    { room: "1.2", floor: "Floor 1", startBed: 7, endBed: 15, bunkCount: 3 },
    { room: "1.3", floor: "Floor 1", startBed: 16, endBed: 24, bunkCount: 3 },
    { room: "2.1", floor: "Floor 2", startBed: 25, endBed: 33, bunkCount: 3 },
    { room: "2.2", floor: "Floor 2", startBed: 34, endBed: 39, bunkCount: 2 },
    { room: "2.3", floor: "Floor 2", startBed: 40, endBed: 48, bunkCount: 3 },
    { room: "3.1", floor: "Floor 3", startBed: 49, endBed: 57, bunkCount: 3 },
    { room: "3.2", floor: "Floor 3", startBed: 58, endBed: 63, bunkCount: 2 }
  ]
};

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
    { label: "Current balance", value: formatNumber(parseLooseNumber(client?.currentCoins)), tone: "positive" },
    { label: "Lifetime coins", value: formatNumber(parseLooseNumber(client?.totalCoins)) },
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
  const { language } = usePortalLanguage();
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
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [newStaffEmail, setNewStaffEmail] = useState("");
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
      const nextSelected = nextClients.find((client) => client.maHd === selectedMaHd) ?? nextClients[0] ?? null;
      setSelectedMaHd(nextSelected?.maHd ?? "");
      fillClientForm(nextSelected);
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
  }, [selectedMaHd]);

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
            <h1 className="text-2xl font-semibold text-slate-900">Cozoro Side</h1>
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

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {[
            ["overview", "Overview"],
            ["client_list", "Client list"],
            ["owners_employees", "Owners & employees"],
            ["support_chat", "Support chat"],
            ["feedbacks", "Feedbacks"],
            ["admin_cleaning", "Cleaning schedule assigning"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveManagerView(value as ManagerView)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                activeManagerView === value
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {activeManagerView === "overview" ? (
        <section className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Overview</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Switch branches to explore rooms, floors, bed diagrams, and a quick summary of the property.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickNav.map((entry) => (
                  <button
                    key={entry.branch}
                    type="button"
                    onClick={() => {
                      setSelectedBranch(entry.branch);
                      setSelectedRoom(entry.rooms[0]?.room ?? "");
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      selectedBranch === entry.branch
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 text-slate-700"
                    }`}
                  >
                    {entry.branch}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {overviewStats.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900">{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          {selectedBranch ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Branch Layout</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedBranch === "D7"
                      ? "D7 overview grouped by floor, room, and bunk bed."
                      : `${selectedBranch} overview with all rooms and bunk beds.`}
                  </p>
                </div>
                <div className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                  {selectedBranch}
                </div>
              </div>

              <div className="mt-6 space-y-6">
                {branchOverviewGroups.map((group) => (
                  <div key={group.label} className="space-y-4">
                    {selectedBranch === "D7" ? (
                      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
                    ) : null}
                    <div className={`grid gap-4 ${selectedBranch === "D7" ? "2xl:grid-cols-2" : "xl:grid-cols-2"}`}>
                      {group.rooms.map((room) => (
                        <div key={room.room} className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">Room {room.room}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                Beds {room.startBed}-{room.endBed} | {room.clients.length} / {room.endBed - room.startBed + 1} occupied
                              </div>
                            </div>
                            <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {room.bunkCount} bunks
                            </div>
                          </div>

                          <div className="mt-4 rounded-[1.5rem] border border-white/80 bg-white/80 p-4">
                            <div className="rounded-full bg-slate-200/70 px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                              Walkway
                            </div>
                            <div className={`mt-4 grid gap-3 ${room.bunkCount === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                              {room.diagram.bunks.map((bunk) => (
                                <div key={`${room.room}-${bunk.bunkNumber}`} className="min-w-0 rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                                  <div className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Bunk {bunk.bunkNumber}
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {bunk.levels.map((slot) => {
                                      const client = slot.client;
                                      const isSelected = client?.maHd === selectedMaHd;
                                      return client ? (
                                        <button
                                          key={`${room.room}-${bunk.bunkNumber}-${slot.level}`}
                                          type="button"
                                          onClick={() => {
                                            setActiveManagerView("client_list");
                                            setSelectedMaHd(client.maHd);
                                            setSelectedBranch(selectedBranch);
                                            setSelectedRoom(room.room);
                                            fillClientForm(client);
                                            setWorkspace(null);
                                            setEditingId("");
                                          }}
                                          className={`block w-full min-w-0 rounded-xl border px-2.5 py-2.5 text-left ${
                                            isSelected
                                              ? "border-slate-900 bg-slate-900 text-white"
                                              : "border-emerald-200 bg-emerald-50 text-slate-900"
                                          }`}
                                        >
                                          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                                            Level {slot.level} | Bed {slot.bedNumber}
                                          </div>
                                          <div className="mt-1 text-[13px] font-medium leading-tight break-words whitespace-normal">
                                            {client.name || client.email}
                                          </div>
                                        </button>
                                      ) : (
                                        <div
                                          key={`${room.room}-${bunk.bunkNumber}-${slot.level}`}
                                          className="min-w-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2.5 text-left"
                                        >
                                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Level {slot.level} | Bed {slot.bedNumber}
                                          </div>
                                          <div className="mt-1 text-sm text-slate-400">Empty</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {activeManagerView === "client_list" ? (
      <section className="grid gap-6 lg:grid-cols-[23rem_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">All Clients</h2>
            <span className="text-sm text-slate-500">{filteredClients.length}</span>
          </div>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, branch, bed, contract"
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <div className="mt-4 max-h-[44rem] space-y-2 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-900">Quick Navigation</div>
              <div className="mt-3 grid gap-3">
                <select
                  value={selectedBranch}
                  onChange={(event) => {
                    const nextBranch = event.target.value;
                    setSelectedBranch(nextBranch);
                    setSelectedMaHd("");
                    setSelectedRoom(
                      filteredQuickNav.find((entry) => entry.branch === nextBranch)?.rooms[0]?.room ?? ""
                    );
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select branch</option>
                  {filteredQuickNav.map((entry) => (
                    <option key={entry.branch} value={entry.branch}>
                      {entry.branch}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={roomFilter}
                  onChange={(event) => {
                    setRoomFilter(event.target.value);
                    setSelectedMaHd("");
                  }}
                  placeholder="Filter room"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={selectedRoom}
                  onChange={(event) => {
                    setSelectedRoom(event.target.value);
                    setSelectedMaHd("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={!selectedBranch}
                >
                  <option value="">Select room</option>
                  {visibleRooms.map((entry) => (
                    <option key={entry.room} value={entry.room}>
                      {entry.room} ({entry.clients.length})
                    </option>
                  ))}
                </select>
              </div>
              {false && selectedBranch && selectedRoom ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Room Diagram
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      3-level bunk layout: bed 1 = level 1, bed 2 = level 2, bed 3 = level 3, then repeats for beds 4-6 and onward.
                    </div>
                    <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                      {roomDiagram.stacks.map(([stackNumber, levels]) => (
                        <div key={stackNumber} className="min-w-[10rem] rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Bunk {stackNumber}
                          </div>
                          <div className="mt-3 space-y-2">
                            {[3, 2, 1].map((level) => {
                              const client = levels[level as 1 | 2 | 3] ?? null;
                              const isSelected = client?.maHd === selectedMaHd;
                              return client ? (
                                <button
                                  key={`${stackNumber}-${level}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedMaHd(client.maHd);
                                    fillClientForm(client);
                                    setWorkspace(null);
                                    setEditingId("");
                                  }}
                                  className={`block w-full rounded-xl border px-3 py-3 text-left ${
                                    isSelected
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-200 bg-slate-50 text-slate-900"
                                  }`}
                                >
                                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                                    Level {level} · Bed {client.bed}
                                  </div>
                                  <div className="mt-1 font-medium">{client.name || client.email}</div>
                                  <div className={`mt-1 text-xs ${isSelected ? "text-slate-200" : "text-slate-600"}`}>
                                    {client.email}
                                  </div>
                                </button>
                              ) : (
                                <div
                                  key={`${stackNumber}-${level}`}
                                  className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-left"
                                >
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Level {level}
                                  </div>
                                  <div className="mt-1 text-sm text-slate-400">Empty</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {roomDiagram.unassigned.length ? (
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Unassigned Beds
                        </div>
                        <div className="mt-2 space-y-2">
                          {roomDiagram.unassigned.map((client) => (
                            <button
                              key={client.maHd}
                              type="button"
                              onClick={() => {
                                setSelectedMaHd(client.maHd);
                                fillClientForm(client);
                                setWorkspace(null);
                                setEditingId("");
                              }}
                              className={`block w-full rounded-xl border px-3 py-2 text-left text-sm ${
                                client.maHd === selectedMaHd
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-900"
                              }`}
                            >
                              <div className="font-medium">{client.name || client.email}</div>
                              <div className={client.maHd === selectedMaHd ? "text-slate-200" : "text-slate-600"}>
                                Bed {client.bed || "-"} | {client.email}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {filteredClients.map((client) => {
              const isSelected = client.maHd === selectedMaHd;
              return (
                <button
                  key={client.maHd}
                  type="button"
                  onClick={() => {
                    setSelectedMaHd(client.maHd);
                    setSelectedBranch(normalizeBranchLabel(client.branch));
                    setSelectedRoom(resolveClientRoom(client));
                    fillClientForm(client);
                    setWorkspace(null);
                    setEditingId("");
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${
                    isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <div className="font-medium">{client.name || client.maHd}</div>
                  <div className={`mt-1 text-sm ${isSelected ? "text-slate-200" : "text-slate-600"}`}>
                    {client.email} | {client.branch || "-"} | Bed {client.bed || "-"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
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
                  <div className="mt-4 space-y-3">
                    <label className="block text-sm font-medium text-slate-700">
                      Amount
                      <input type="number" min="1" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Purpose
                      <input
                        type="text"
                        list="payment-purpose-options"
                        value={paymentPurposeInput}
                        onChange={(event) => setPaymentPurposeInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            addPaymentPurposeOption(paymentPurposeInput);
                          }
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        placeholder="Search previous purposes or add your own"
                      />
                      <datalist id="payment-purpose-options">
                        {paymentPurposeSuggestions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {paymentPurposeSelections.map((purpose) => (
                          <button
                            key={purpose}
                            type="button"
                            onClick={() =>
                              syncPaymentPurposeSelection(
                                paymentPurposeSelections.filter((entry) => entry !== purpose)
                              )
                            }
                            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900"
                          >
                            {purpose} x
                          </button>
                        ))}
                      </div>
                      {filteredPaymentPurposeSuggestions.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {filteredPaymentPurposeSuggestions.slice(0, 10).map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => addPaymentPurposeOption(option)}
                              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => addPaymentPurposeOption(paymentPurposeInput)}
                        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                      >
                        Add purpose
                      </button>
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Details
                      <textarea value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} rows={3} className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Payer
                      <input type="text" value={paymentPayer} onChange={(event) => setPaymentPayer(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder={selectedClient?.name || selectedClient?.email || ""} />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        void postJson(
                          `${API_BASE_URL}/manager/payments/create`,
                          {
                            actorEmail: normalizedEmail,
                            maHd: selectedClient?.maHd ?? "",
                            amount: Number(paymentAmount),
                            purpose: paymentPurposeSelections.join(", "),
                            details: paymentDetails,
                            payer: paymentPayer,
                            receiver: normalizedEmail
                          },
                          "Payment receipt created.",
                          async () => {
                            if (selectedClient) await loadWorkspace("payments", selectedClient.maHd);
                            setPaymentPurposeInput("");
                            syncPaymentPurposeSelection(["Monthly rent"]);
                          }
                        )
                      }
                      disabled={loading || !selectedClient || !canCreatePaymentReceipt || !Number(paymentAmount) || !paymentPurposeSelections.length}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Create payment receipt
                    </button>
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
                <button
                  type="button"
                  onClick={() => setShowAllStatsEntries((current) => !current)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  {showAllStatsEntries ? "Hide all entries" : "Show all entries"}
                </button>
              </div>
            ) : null}

            {workspace && showAllStatsEntries && activeTab === "laundry" ? (
              <div className="mt-4 space-y-4">
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
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
              <div className="mt-4 space-y-4">
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
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

              <div className="grid gap-4 md:grid-cols-4">
                <input
                  type="email"
                  value={newStaffEmail}
                  onChange={(event) => setNewStaffEmail(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="team@example.com"
                />
                <select
                  value={newStaffRole}
                  onChange={(event) => setNewStaffRole(event.target.value as StaffRole)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="manager">Manager</option>
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
                        role: newStaffRole,
                        password: newStaffPassword.trim() || undefined
                      },
                      "Account access updated. New accounts will be asked to change password on first login.",
                      async () => {
                        await loadTeam();
                        setNewStaffEmail("");
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
                    <div className="font-medium text-slate-900">{entry.email}</div>
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
        <ManagerSupportInbox operatorEmail={normalizedEmail} enabled={isStaffSession} />
      ) : null}

      {activeManagerView === "feedbacks" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Feedbacks</h2>
              <p className="mt-1 text-sm text-slate-600">
                Review the feedback and support notes that residents submitted through the portal.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadFeedbacks()}
              disabled={feedbackLoading}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              Refresh feedbacks
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
      ) : null}

      {activeManagerView === "admin_cleaning" ? <AdminCleaningClient /> : null}
    </div>
  );
}
