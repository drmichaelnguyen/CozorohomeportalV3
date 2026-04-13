"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import Link from "next/link";
import { ContractExtension } from "./contract-extension";
import { InlineHelp } from "./inline-help";
import { NextPaymentSummary } from "./next-payment-summary";
import { isContractExpired, daysUntilContractEnd } from "../lib/contract-utils";

type ClientRecord = Record<string, string>;

type LaundryBooking = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  status: string;
};

type CleaningTask = {
  id: string;
  scheduledDate: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  status: "ASSIGNED" | "DONE_PENDING_AUDIT" | "APPROVED" | "REJECTED" | "MISSED";
  rewardCoins: number;
};

type CleaningOverview = {
  tasks: CleaningTask[];
};

type FineEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
  coinPayment: { isPaid: boolean };
};

type RentBreakdown = {
  baseRent: number;
  parkingFeeVnd: number;
  gateParkingFeeVnd?: number;
  laundryFeeVnd: number;
  finesVnd: number;
  finalTotalVnd: number;
  tenureSurchargeVnd: number;
  tenureSurchargeRate?: number;
  monthlyAdjustmentVnd?: number;
  professionalDiscountVnd: number;
  planDiscountVnd: number;
  managerDiscountVnd: number;
  details?: {
    laundryCount?: { cash?: number };
    billingPrevMonth?: string;
  };
};

type RentStatus = {
  month: string;
  isPaid: boolean;
  onPrepaidPlan: boolean;
  breakdown: RentBreakdown | null;
  blockingRentDuePopupEnabled?: boolean;
};

type CoinEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
};

type MaintenanceTicket = {
  id: string;
  residentEmail: string;
  residentName: string;
  branch: string;
  location: string;
  category: string;
  description: string;
  reportedAt: string;
  status: "REPORTED" | "ASSIGNED" | "SOLVED" | "CLOSED";
  mechanicEmail?: string | null;
  solvedAt?: string | null;
  satisfaction?: string | null;
  feedback?: string | null;
};

const FINE_AMOUNT_COLUMN = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
const COINS_COLUMN = "COINS";
const COIN_EVENT_COLUMN = "S\u1ef0 KI\u1ec6N";

const DASHBOARD_HELP = {
  nextLaundry:
    "Next Laundry shows the resident's upcoming booked laundry slot.\n\nThis aligns with Cozorohome policy by encouraging residents to use machines only during their reserved time.",
  support:
    "Support Center is for maintenance, dorm questions, and follow-up with staff.\n\nThis aligns with Cozorohome policy by centralizing requests instead of relying on untracked side conversations."
} as const;

function normalizeBranch(value: string | undefined): "D2" | "D7" | null {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized.includes("D7") || normalized === "7") return "D7";
  if (normalized.includes("D2") || normalized === "2") return "D2";
  return null;
}

function deriveRoomLabel(branch: "D2" | "D7" | null, bed: string | undefined): string | null {
  if (!branch || !bed) return null;
  const bedNum = parseInt(bed, 10);
  if (isNaN(bedNum)) return null;

  if (branch === "D2") {
    if (bedNum >= 1 && bedNum <= 9) return "1";
    if (bedNum >= 10 && bedNum <= 15) return "2";
    if (bedNum >= 16 && bedNum <= 21) return "3";
  }
  if (branch === "D7") {
    if (bedNum >= 1 && bedNum <= 9) return "1.1";
    if (bedNum >= 10 && bedNum <= 15) return "1.2";
    if (bedNum >= 16 && bedNum <= 24) return "1.3";
    if (bedNum >= 25 && bedNum <= 33) return "2.1";
    if (bedNum >= 34 && bedNum <= 39) return "2.2";
    if (bedNum >= 40 && bedNum <= 48) return "2.3";
    if (bedNum >= 49 && bedNum <= 57) return "3.1";
    if (bedNum >= 58 && bedNum <= 63) return "3.2";
  }
  return null;
}

function deriveFloorLabel(branch: "D2" | "D7" | null, room: string | null): string {
  if (!branch) return "-";
  if (branch === "D2") return "D2";
  if (branch === "D7") {
    if (room?.startsWith("1")) return "Floor 1";
    if (room?.startsWith("2")) return "Floor 2";
    if (room?.startsWith("3")) return "Floor 3";
  }
  return "-";
}

function parseFlexibleDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (value.includes("/")) {
    const [d, m, y] = value.split("/");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function getNextMonthFirstDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function parseLooseInteger(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d-]/g, "");
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

function parseCoinAmount(value: string | undefined): number {
  return parseLooseInteger(value);
}

function prettyTaskType(type: string): string {
  return type.split("_").map(s => s.charAt(0) + s.slice(1).toLowerCase()).join(" ");
}

function formatCoins(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getCleaningCompletionWindow(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const dayStart = startOfDay(new Date(task.scheduledDate));
  const windowStart = new Date(dayStart);
  const windowEnd = new Date(dayStart);

  if (task.type === "KITCHEN_D7") {
    windowStart.setHours(17, 0, 0, 0);
    windowEnd.setHours(23, 0, 0, 0);
    return { windowStart, windowEnd, label: "17:00 to 23:00 on the assigned date" };
  }

  windowStart.setHours(0, 0, 0, 0);
  windowEnd.setHours(23, 59, 59, 999);
  return { windowStart, windowEnd, label: "any time on the assigned date" };
}

function canCompleteCleaningTaskNow(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowStart, windowEnd } = getCleaningCompletionWindow(task);
  const now = new Date();
  return now >= windowStart && now <= windowEnd;
}

function canCompleteCleaningTaskLate(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowEnd } = getCleaningCompletionWindow(task);
  const lateEnd = new Date(windowEnd.getTime() + 10 * 60 * 60 * 1000);
  const now = new Date();
  return now > windowEnd && now <= lateEnd;
}

function getCleaningLateDeadline(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowEnd } = getCleaningCompletionWindow(task);
  return new Date(windowEnd.getTime() + 10 * 60 * 60 * 1000);
}

function getNextCleaningTask(tasks: CleaningTask[]) {
  return [...tasks]
    .filter((task) => task.status === "ASSIGNED" && getCleaningLateDeadline(task).getTime() >= Date.now())
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null;
}

export function HomeDashboardClient() {
  const { sessionEmail } = usePortalSession();
  const { t } = usePortalLanguage();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [laundryBookings, setLaundryBookings] = useState<LaundryBooking[]>([]);
  const [cleaningOverview, setCleaningOverview] = useState<CleaningOverview | null>(null);
  const [fineEntries, setFineEntries] = useState<FineEntry[]>([]);
  const [coinEntries, setCoinEntries] = useState<CoinEntry[]>([]);
  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>([]);
  const [feedbackTicketId, setFeedbackTicketId] = useState("");
  const [feedbackSatisfaction, setFeedbackSatisfaction] = useState("satisfied");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [showCoinDetail, setShowCoinDetail] = useState(false);
  const [rentStatus, setRentStatus] = useState<RentStatus | null>(null);
  const [terminationRecord, setTerminationRecord] = useState<{ maHd: string; terminatedAt: string; depositNote: string; checkOut: { submittedAt: string } | null } | null>(null);
  const [extensionExpanded, setExtensionExpanded] = useState(false);
  const activeEmail = sessionEmail.trim().toLowerCase();

  function openExtensionPanel() {
    setExtensionExpanded(true);
    setTimeout(() => {
      document.getElementById("contract-extension-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  const isExpired = useMemo(() => {
    return isContractExpired(client?.["Ngày hết hạn hợp đồng"]);
  }, [client]);

  const contractDaysRemaining = useMemo(() => {
    return daysUntilContractEnd(client?.["Ngày hết hạn hợp đồng"]);
  }, [client]);

  // Warn when ≤30 days remain but not yet expired
  const isExpiringSoon = useMemo(() => {
    return contractDaysRemaining !== null && contractDaysRemaining >= 0 && contractDaysRemaining <= 30;
  }, [contractDaysRemaining]);

  const isRemoved = useMemo(() => {
    return client?.["Hiện còn ở"] === "-1";
  }, [client]);

  async function loadDashboard() {
    if (!activeEmail) {
      setMessage(t("signInToView", "Sign in first to view your dashboard."));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const [clientResponse, laundryResponse, cleaningResponse, finesResponse, coinsResponse, maintenanceResponse, rentStatusResponse, terminationResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/cleaning/me?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/client/maintenance/tickets?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/client/termination-status?email=${encodeURIComponent(activeEmail)}`)
      ]);

      const clientData = (await clientResponse.json()) as ClientRecord | { error?: string };
      const laundryData = (await laundryResponse.json()) as { bookings?: LaundryBooking[]; error?: string };
      const cleaningData = (await cleaningResponse.json()) as (CleaningOverview & { error?: string }) | { error?: string };
      const finesData = (await finesResponse.json()) as { entries?: FineEntry[]; error?: string };
      const coinsData = (await coinsResponse.json()) as { entries?: CoinEntry[]; error?: string };
      const maintenanceData = (await maintenanceResponse.json()) as { tickets?: MaintenanceTicket[]; error?: string };
      const rentStatusData = rentStatusResponse.ok ? (await rentStatusResponse.json()) as RentStatus : null;
      const terminationData = terminationResponse.ok ? (await terminationResponse.json()) as { record?: { maHd: string; terminatedAt: string; depositNote: string; checkOut: { submittedAt: string } | null } | null } : null;

      if (!clientResponse.ok) {
        setMessage(
          typeof clientData === "object" && clientData !== null && "error" in clientData && typeof clientData.error === "string"
            ? clientData.error
            : t("unableToLoadDashboard", "Unable to load dashboard.")
        );
        return;
      }

      setClient(clientData as ClientRecord);
      setLaundryBookings(laundryResponse.ok ? laundryData.bookings ?? [] : []);
      setCleaningOverview(
        cleaningResponse.ok
          ? {
              tasks: "tasks" in cleaningData && Array.isArray(cleaningData.tasks) ? cleaningData.tasks : []
            }
          : { tasks: [] }
      );
      setFineEntries(finesResponse.ok ? finesData.entries ?? [] : []);
      setCoinEntries(coinsResponse.ok ? coinsData.entries ?? [] : []);
      setMaintenanceTickets(maintenanceResponse.ok ? maintenanceData.tickets ?? [] : []);
      setRentStatus(rentStatusData);
      setTerminationRecord(terminationData?.record ?? null);

      if (!laundryResponse.ok || !cleaningResponse.ok || !finesResponse.ok || !coinsResponse.ok || !maintenanceResponse.ok) {
        setMessage(t("dashboardPartialData", "Dashboard loaded with partial data."));
      }
    } catch {
      setMessage(t("unableToLoadRightNow", "Unable to load dashboard right now."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [activeEmail]);

  const branchId = normalizeBranch(client?.["Chi nhánh Cozoro dorm"]);
  const bedLabel = client?.["số giường"] || "-";
  const roomLabel = deriveRoomLabel(branchId, client?.["số giường"]);
  const floorLabel = deriveFloorLabel(branchId, roomLabel);

  const nextPaymentDate = useMemo(() => {
    const expiry = parseFlexibleDate(client?.["Ngày hết hạn gói đã thanh toán"]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!expiry || expiry.getTime() < today.getTime()) {
      return getNextMonthFirstDate();
    }

    return expiry;
  }, [client]);

  const nextLaundry = useMemo(
    () =>
      [...laundryBookings]
        .filter((booking) => new Date(booking.end).getTime() >= Date.now())
        .sort((left, right) => left.start.localeCompare(right.start))[0] ?? null,
    [laundryBookings]
  );

  const nextCleaning = useMemo(() => getNextCleaningTask(cleaningOverview?.tasks ?? []), [cleaningOverview]);

  const unpaidFineSummary = useMemo(() => {
    const unpaidEntries = fineEntries.filter((entry) => !entry.coinPayment.isPaid);

    return {
      count: unpaidEntries.length,
      amount: unpaidEntries.reduce((sum, entry) => sum + parseLooseInteger(entry.row[FINE_AMOUNT_COLUMN]), 0)
    };
  }, [fineEntries]);

  const coinSummary = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
    const lastMonth = lastMonthDate.getMonth();
    const lastMonthYear = lastMonthDate.getFullYear();
    const usedByMonth = new Map<string, number>();
    const usedByCategory = new Map<string, number>();

    let earnedLastMonth = 0;
    let earnedThisMonth = 0;
    let usedLastMonth = 0;
    let usedThisMonth = 0;

    for (const entry of coinEntries) {
      const amount = parseCoinAmount(entry.row[COINS_COLUMN]);
      const timestamp = parseFlexibleDate(entry.parsedTimestamp);
      const category = (entry.row[COIN_EVENT_COLUMN] || "Other").trim() || "Other";

      if (amount > 0 && timestamp) {
        const month = timestamp.getMonth();
        const year = timestamp.getFullYear();

        if (month === thisMonth && year === thisYear) {
          earnedThisMonth += amount;
        }

        if (month === lastMonth && year === lastMonthYear) {
          earnedLastMonth += amount;
        }
      }

      if (amount < 0 && timestamp) {
        const usedAmount = Math.abs(amount);
        const month = timestamp.getMonth();
        const year = timestamp.getFullYear();

        if (month === thisMonth && year === thisYear) {
          usedThisMonth += usedAmount;
        }
        if (month === lastMonth && year === lastMonthYear) {
          usedLastMonth += usedAmount;
        }
      }

      if (amount < 0) {
        const usedAmount = Math.abs(amount);
        const monthKey = timestamp
          ? `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`
          : "Unknown month";

        usedByMonth.set(monthKey, (usedByMonth.get(monthKey) ?? 0) + usedAmount);
        usedByCategory.set(category, (usedByCategory.get(category) ?? 0) + usedAmount);
      }
    }

    const monthlyUsage = Array.from(usedByMonth.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-6)
      .map(([key, value]) => ({
        key,
        label:
          key === "Unknown month"
            ? key
            : new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        value
      }));

    const categoryUsage = Array.from(usedByCategory.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([key, value]) => ({ key, label: key, value }));

    const recentEntries = [...coinEntries]
      .sort((a, b) => (b.parsedTimestamp || "").localeCompare(a.parsedTimestamp || ""))
      .slice(0, 5);

    return {
      earnedLastMonth,
      earnedThisMonth,
      usedLastMonth,
      usedThisMonth,
      usedByMonth: monthlyUsage,
      usedByCategory: categoryUsage,
      maxUsedByMonth: Math.max(1, ...monthlyUsage.map((entry) => entry.value)),
      maxUsedByCategory: Math.max(1, ...categoryUsage.map((entry) => entry.value)),
      recentEntries
    };
  }, [coinEntries]);

  return (
    <div className="space-y-6 pb-12">
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">{t("accountOverview", "Account Overview")}</p>
            <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
              {client?.["Tên"] || t("yourDashboard", "Your dashboard")}
            </h1>
            {isExpired && !isRemoved ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 animate-in fade-in slide-in-from-top-2 duration-500">
                <div className="flex items-center gap-3 text-rose-800 font-bold">
                  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{t("contractExpiredWarning", "Your contract has expired!")}</span>
                </div>
                <p className="mt-2 text-sm text-rose-700 font-medium">
                  {t("contractExpiredSub", "Portal services are restricted. Please extend your contract to continue living at Cozoro Home and regain full access.")}
                </p>
                <p className="mt-1 text-sm text-rose-600">
                  {t("contractExpiredGrace", "Access will be permanently removed 5 days after your contract end date if no extension is made. / Quyền truy cập sẽ bị xóa sau 5 ngày kể từ ngày hết hạn nếu không gia hạn.")}
                </p>
                <button
                  type="button"
                  onClick={openExtensionPanel}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-800 transition"
                >
                  {t("extendContractNow", "Extend Contract Now →")}
                </button>
              </div>
            ) : isExpiringSoon && !isRemoved ? (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 animate-in fade-in slide-in-from-top-2 duration-500">
                <div className="flex items-center gap-3 text-amber-800 font-bold">
                  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>
                    {contractDaysRemaining === 0
                      ? t("contractExpiringToday", "Your contract expires today!")
                      : contractDaysRemaining === 1
                        ? t("contractExpiring1Day", "Your contract expires tomorrow!")
                        : t("contractExpiringSoon", `Your contract expires in ${contractDaysRemaining} days.`)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-amber-800">
                  {t("contractExpiringSoonSub", "Extend your contract to keep using all portal services. Access will be removed 5 days after the contract end date if not renewed. / Gia hạn hợp đồng để tiếp tục sử dụng dịch vụ. Quyền truy cập sẽ bị xóa sau 5 ngày nếu không gia hạn.")}
                </p>
                <button
                  type="button"
                  onClick={openExtensionPanel}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-700 transition"
                >
                  {t("extendContractNow", "Extend Contract Now →")}
                </button>
              </div>
            ) : (
              <>
                <p className="max-w-2xl text-sm text-slate-600">
                  {t("dashboardSubtext", "A quick view of your account, bookings, cleaning schedule, and unpaid fine tickets.")}
                </p>
              </>
            )}
            <p className="text-sm text-slate-500 break-all">{sessionEmail}</p>
          </div>

          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-900 disabled:opacity-60 sm:w-auto"
          >
            {loading ? t("refreshing", "Refreshing...") : t("refreshDashboard", "Refresh dashboard")}
          </button>
        </div>

        {message ? <p className="mt-4 text-sm text-rose-600 font-bold">{message}</p> : null}
      </section>

      {client?.["Ngày hết hạn hợp đồng"] && !isRemoved && (
        <ContractExtension
          email={sessionEmail}
          endDateStr={client["Ngày hết hạn hợp đồng"]}
          onExtended={() => { setExtensionExpanded(false); void loadDashboard(); }}
          forceExpand={extensionExpanded}
        />
      )}

      {terminationRecord && !terminationRecord.checkOut && !isRemoved && (
        <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 text-lg">🚪</div>
            <div className="flex-1">
              <p className="text-sm font-bold text-rose-800">
                {t("contractTerminatedTitle", "Your contract has been terminated")}
              </p>
              <p className="mt-1 text-xs text-rose-700">
                {t("contractTerminatedSubtext", "Please complete the check-out process before leaving.")}
              </p>
              {terminationRecord.depositNote && (
                <p className="mt-2 text-xs font-medium text-rose-700">⚠️ {terminationRecord.depositNote}</p>
              )}
              <Link
                href="/checkout"
                className="mt-3 inline-block rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
              >
                {t("startCheckOut", "Start check-out →")}
              </Link>
            </div>
          </div>
        </section>
      )}

      {!isRemoved && (
        <NextPaymentSummary
          variant="dashboard"
          nextPaymentDate={nextPaymentDate}
          rentPaidStatus={rentStatus}
          rentLoading={loading}
          showPaymentsLink
        />
      )}

      {isRemoved ? (
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-rose-900">{t("accountRemoved", "Account Removed")}</h2>
          <p className="mt-2 text-rose-700">
            {t("accountRemovedDesc", "This account has been removed from Cozoro Home. Access to all portal services is permanently restricted.")}
          </p>
        </section>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-700">
          <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr_1.05fr]">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{t("briefUserInfo", "Brief User Info")}</h2>
                {!isExpired && (
                  <Link href="/account-overview" className="text-sm font-medium text-sky-800">
                    {t("openFullAccount", "Open full account")}
                  </Link>
                )}
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("name", "Name")}</div>
                  <div className="mt-1 font-medium text-slate-900">{client?.["TÃªn"] || "-"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("branch", "Branch")}</div>
                  <div className="mt-1 font-medium text-slate-900">
                    {[client?.["Chi nhÃ¡nh Cozoro dorm"] || "-", roomLabel ? `${t("roomLabel", "Room")} ${roomLabel}` : null, bedLabel !== "-" ? `${t("bedNumber", "Bed")} ${bedLabel}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("emailLabel", "Email")}</div>
                  <div className="mt-1 break-all font-medium text-slate-900">{client?.["Äá»‹a chá»‰ email"] || sessionEmail || "-"}</div>
                </div>
              </div>
            </div>

            {!isExpired && (
              <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{t("nextLaundry", "Next Laundry")}</h2>
                    <InlineHelp
                      label="How next laundry works"
                      title="Next Laundry"
                      body={DASHBOARD_HELP.nextLaundry}
                    />
                  </div>
                  <Link href="/service/laundry" className="text-sm font-medium text-sky-800">
                    {t("openLaundry", "Open laundry")}
                  </Link>
                </div>

                {!nextLaundry ? (
                  <p className="mt-5 text-sm text-slate-600">{t("noUpcomingLaundry", "No upcoming laundry booking is scheduled.")}</p>
                ) : (
                  <div className="mt-5 space-y-3">
                    <div className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">{t("today", "Today")}</div>
                    <div className="text-xl font-semibold text-slate-900">
                      {new Date(nextLaundry.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                    </div>
                    <div className="text-base font-semibold text-slate-900">{nextLaundry.summary || nextLaundry.calendarSummary}</div>
                    <div className="text-sm text-slate-600">
                      {new Date(nextLaundry.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} to {new Date(nextLaundry.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={`rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6 ${isExpired ? "lg:col-span-2" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{t("nextCleaning", "Next Cleaning")}</h2>
                {!isExpired && (
                  <Link href="/cleaning-schedule" className="text-sm font-medium text-amber-800">
                    {t("openCleaning", "Open cleaning")}
                  </Link>
                )}
              </div>

              {!nextCleaning ? (
                <p className="mt-5 text-sm text-slate-600">{t("clearForNow", "You are clear for now.")}</p>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">
                    {canCompleteCleaningTaskLate(nextCleaning)
                      ? t("due", "Due")
                      : canCompleteCleaningTaskNow(nextCleaning)
                        ? t("today", "Today")
                        : t("scheduled", "Scheduled")}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {new Date(nextCleaning.scheduledDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </div>
                  <div className="text-base font-semibold text-slate-900">{prettyTaskType(nextCleaning.type)}</div>
                  <div className="text-sm text-slate-600">
                    {canCompleteCleaningTaskLate(nextCleaning)
                      ? `${t("lateReward", "Late reward")}: +${formatCoins(Math.floor(nextCleaning.rewardCoins * 0.5))} ${t("coins", "Coins")}`
                      : `+${formatCoins(nextCleaning.rewardCoins)} ${t("coins", "Coins")}`}
                  </div>
                </div>
              )}
            </div>
          </section>

          <details className="group rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("moreDetails", "More Details")}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("moreDetailsDesc", "Payment, support, maintenance, fines, and coin details are here if you need them.")}
                </p>
              </div>
              <div className="rounded-full bg-slate-100 p-2 text-slate-500 transition group-open:rotate-180">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </summary>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {!isExpired && (
              <>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{t("nextPayment", "Next Payment")}</div>
                  <div className="mt-3 text-2xl font-semibold text-slate-900">
                    {nextPaymentDate ? nextPaymentDate.toLocaleDateString() : "-"}
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">{t("currentCoins", "Current Coins")}</div>
                  <div className="mt-3 text-2xl font-semibold text-slate-900">
                    {client?.["Cozoro coins hiện có"] || "0"}
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-700">{t("coinsEarnedLastMonth", "Coins Earned Last Month")}</div>
                  <div className="mt-3 text-2xl font-semibold text-slate-900">{formatCoins(coinSummary.earnedLastMonth)}</div>
                </div>

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{t("coinsEarnedThisMonth", "Coins Earned This Month")}</div>
                  <div className="mt-3 text-2xl font-semibold text-slate-900">{formatCoins(coinSummary.earnedThisMonth)}</div>
                </div>
              </>
            )}

            <div className={`rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm ${isExpired ? "sm:col-span-2 xl:col-span-1" : ""}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{t("nextCleaning", "Next Cleaning")}</div>
              <div className="mt-3 text-lg font-semibold text-slate-900">
                {nextCleaning
                  ? new Date(nextCleaning.scheduledDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                  : t("noUpcomingTask", "No upcoming task")}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {nextCleaning ? `${prettyTaskType(nextCleaning.type)} · ${nextCleaning.status}` : t("clearForNow", "You are clear for now.")}
              </div>
            </div>

            {!isExpired && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">{t("unpaidFineTickets", "Unpaid Fine Tickets")}</div>
                <div className="mt-3 text-2xl font-semibold text-slate-900">{unpaidFineSummary.count}</div>
                <div className="mt-2 text-sm text-slate-600">
                  {t("totalUnpaidAmount", "Total unpaid amount")}: {unpaidFineSummary.amount.toLocaleString()} VND
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{t("briefUserInfo", "Brief User Info")}</h2>
                {!isExpired && (
                  <Link href="/account-overview" className="text-sm font-medium text-sky-800">
                    {t("openFullAccount", "Open full account")}
                  </Link>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [t("name", "Name"), client?.["Tên"] || "-"],
                  [t("branch", "Branch"), client?.["Chi nhánh Cozoro dorm"] || "-"],
                  [t("bedNumber", "Bed Number"), bedLabel],
                  [t("floorLabel", "Floor"), floorLabel],
                  [t("roomLabel", "Room"), roomLabel || "-"],
                  [t("phone", "Phone"), client?.["Số điện thoại liên hệ"] || "-"],
                  [t("emailLabel", "Email"), client?.["Địa chỉ email"] || sessionEmail || "-"]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-2 text-sm font-medium text-slate-900 break-all">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              {!isExpired && (
                <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{t("nextLaundry", "Next Laundry")}</h2>
                    <InlineHelp
                      label="How next laundry works"
                      title="Next Laundry"
                      body={DASHBOARD_HELP.nextLaundry}
                    />
                  </div>
                  <Link href="/service/laundry" className="text-sm font-medium text-sky-800">
                    {t("openLaundry", "Open laundry")}
                  </Link>
                </div>

                  {!nextLaundry ? (
                    <p className="mt-4 text-sm text-slate-600">{t("noUpcomingLaundry", "No upcoming laundry booking is scheduled.")}</p>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-semibold text-slate-900">{nextLaundry.summary || nextLaundry.calendarSummary}</div>
                      <div className="mt-2 text-sm text-slate-600">
                        {new Date(nextLaundry.start).toLocaleString()} to {new Date(nextLaundry.end).toLocaleString()}
                      </div>
                      <div className="mt-2 text-sm text-slate-500">{t("status", "Status")}: {nextLaundry.status}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{t("supportCenter", "Support Center")}</h2>
                    <InlineHelp
                      label="How support center works"
                      title="Support Center"
                      body={DASHBOARD_HELP.support}
                    />
                  </div>
                  <Link href="/support" className="text-sm font-medium text-sky-800">
                    {t("openSupport", "Open support")}
                  </Link>
                </div>
                <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4">
                  <p className="text-sm text-sky-900 font-medium leading-relaxed">
                    {t("supportContactPrompt", "Need help with your room or have a general inquiry? Send us a message and our team will get back to you shortly.")}
                  </p>
                  <Link 
                    href="/support"
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-sky-100 hover:bg-sky-700 transition-all"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {t("sendMessage", "Send Message")}
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{t("maintenance", "Maintenance & Malfunctions")}</h2>
              <Link href="/support" className="text-sm font-medium text-sky-800 hover:underline flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t("reportNewIssue", "Report in Messages")}
              </Link>
            </div>

            <div className="mt-5 space-y-4">
              {maintenanceTickets.length === 0 ? (
                <p className="text-sm text-slate-500 italic">{t("noActiveTickets", "No active maintenance tickets.")}</p>
              ) : (
                maintenanceTickets.map((ticket) => (
                  <div key={ticket.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${
                          ticket.status === "REPORTED" ? "bg-amber-500" :
                          ticket.status === "ASSIGNED" ? "bg-sky-500 animate-pulse" :
                          ticket.status === "SOLVED" ? "bg-emerald-500" : "bg-slate-300"
                        }`} />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{ticket.status}</span>
                      </div>
                      <div className="font-semibold text-slate-900">{ticket.category || t("maintenanceIssue", "Maintenance Issue")}</div>
                      <div className="text-sm text-slate-600">{ticket.location} · <span className="italic">"{ticket.description}"</span></div>
                    </div>

                    <div className="flex items-center gap-3">
                      {ticket.status === "SOLVED" && !ticket.satisfaction && feedbackTicketId !== ticket.id && (
                        <button
                          onClick={() => setFeedbackTicketId(ticket.id)}
                          className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                        >
                          {t("leaveFeedback", "Leave Feedback")}
                        </button>
                      )}

                      {feedbackTicketId === ticket.id && (
                        <div className="flex flex-col gap-2 w-full sm:w-64 animate-in fade-in zoom-in-95 duration-200">
                          <select
                            value={feedbackSatisfaction}
                            onChange={(e) => setFeedbackSatisfaction(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="satisfied">{t("satisfied", "Satisfied")}</option>
                            <option value="neutral">{t("neutral", "Neutral")}</option>
                            <option value="unsatisfied">{t("unsatisfied", "Unsatisfied")}</option>
                          </select>
                          <input
                            type="text"
                            placeholder={t("optionalComment", "Optional comment")}
                            value={feedbackComment}
                            onChange={(e) => setFeedbackComment(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              disabled={loading}
                              onClick={async () => {
                                setLoading(true);
                                try {
                                  await fetch(`${API_BASE_URL}/client/maintenance/feedback`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      ticketId: ticket.id,
                                      satisfaction: feedbackSatisfaction,
                                      feedback: feedbackComment
                                    })
                                  });
                                  setFeedbackTicketId("");
                                  await loadDashboard();
                                } finally {
                                  setLoading(false);
                                }
                              }}
                              className="flex-1 rounded-lg bg-emerald-600 py-1 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {loading ? t("sending", "Sending...") : t("send", "Send")}
                            </button>
                            <button onClick={() => setFeedbackTicketId("")} className="text-xs text-slate-500">{t("cancel", "Cancel")}</button>
                          </div>
                        </div>
                      )}

                      {ticket.satisfaction && (
                        <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {ticket.satisfaction}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {!isExpired && (
            <section className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">{t("coinsUsedByMonth", "Coins Used by Month")}</h2>
                  <Link href="/coins" className="text-sm font-medium text-sky-800">
                    {t("openCoins", "Open coins")}
                  </Link>
                </div>

                {coinSummary.usedByMonth.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">{t("noMonthlyCoinUsage", "No monthly coin usage is available yet.")}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {coinSummary.usedByMonth.map((entry) => (
                      <div key={entry.key}>
                        <div className="mb-1 flex items-center justify-between text-sm text-slate-700">
                          <span>{entry.label}</span>
                          <span>{formatCoins(entry.value)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-100">
                          <div
                            className="h-3 rounded-full bg-sky-600"
                            style={{ width: `${Math.max(8, (entry.value / coinSummary.maxUsedByMonth) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">{t("coinsUsedByCategory", "Coins Used by Category")}</h2>
                  <Link href="/coins" className="text-sm font-medium text-sky-800">
                    {t("openCoins", "Open coins")}
                  </Link>
                </div>

                {coinSummary.usedByCategory.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">{t("noCategoryCoinUsage", "No coin usage categories are available yet.")}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {coinSummary.usedByCategory.map((entry) => (
                      <div key={entry.key}>
                        <div className="mb-1 flex items-center justify-between text-sm text-slate-700">
                          <span>{entry.label}</span>
                          <span>{formatCoins(entry.value)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-100">
                          <div
                            className="h-3 rounded-full bg-sky-600"
                            style={{ width: `${Math.max(8, (entry.value / coinSummary.maxUsedByCategory) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
          </details>
        </div>
      )}

      {showCoinDetail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{t("coinPortfolio", "Coin Portfolio")}</h2>
                <p className="text-sm text-slate-500">{t("memberLabel", "Member")}: {client?.["Tên"] || "-"}</p>
              </div>
              <button
                onClick={() => setShowCoinDetail(false)}
                className="rounded-full bg-slate-50 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-8 h-[calc(90vh-160px)]">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600">{t("earnedThisMonth", "This Month Earned")}</div>
                  <div className="text-2xl font-bold text-sky-900 mt-1">+{formatCoins(coinSummary.earnedThisMonth)}</div>
                </div>
                <div className="bg-rose-50 rounded-2xl p-4 border border-rose-100">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">{t("usedThisMonth", "This Month Used")}</div>
                  <div className="text-2xl font-bold text-rose-900 mt-1">-{formatCoins(coinSummary.usedThisMonth)}</div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="font-bold text-slate-900">{t("recentHistory", "Recent History")}</h3>
                {coinSummary.recentEntries.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-slate-50 pb-3 last:border-0 overflow-hidden">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{(entry.row[COIN_EVENT_COLUMN] || "Other").trim() || "Other"}</div>
                      <div className="text-xs text-slate-500">{entry.parsedTimestamp}</div>
                    </div>
                    <div className={`font-bold ${parseCoinAmount(entry.row[COINS_COLUMN]) > 0 ? "text-emerald-600" : "text-slate-900"}`}>
                      {parseCoinAmount(entry.row[COINS_COLUMN]) > 0 ? "+" : ""}{formatCoins(parseCoinAmount(entry.row[COINS_COLUMN]))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-6 border-top border-slate-100 flex justify-end">
               <Link 
                  href="/coins"
                  className="rounded-full bg-slate-900 px-6 py-2 text-sm font-bold text-white hover:bg-slate-800 transition"
               >
                 {t("viewCoinHistory", "View coin history")}
               </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
