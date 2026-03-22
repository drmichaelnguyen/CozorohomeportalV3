"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
import { usePortalLanguage } from "./portal-language";

type ClientRecord = Record<string, string>;

type LaundryBooking = {
  id: string;
  summary: string;
  calendarSummary: string;
  start: string;
  end: string;
  status: string;
};

type CleaningTask = {
  id: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  scheduledDate: string;
  status: "ASSIGNED" | "DONE_PENDING_AUDIT" | "APPROVED" | "REJECTED" | "MISSED";
};

type CleaningOverview = {
  tasks: CleaningTask[];
};

type FineEntry = {
  row: Record<string, string>;
  coinPayment: {
    isPaid: boolean;
  };
};

const FINE_AMOUNT_COLUMN = "CHI PHÍ THANH TOÁN CHO VI PHẠM";

type CoinEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
};

const COINS_COLUMN = "COINS";
const COIN_EVENT_COLUMN = "S\u1ef1 ki\u1ec7n";

const quickLinks: Array<{ href: Route; label: string; description: string; labelKey: string; descriptionKey: string }> = [
  { href: "/service/laundry", label: "Laundry", description: "Book laundry and check machine availability", labelKey: "laundryQuickLink", descriptionKey: "laundryDesc" },
  { href: "/service/controller", label: "Controller", description: "Control your room devices", labelKey: "controller", descriptionKey: "controllerDesc" },
  { href: "/schedule", label: "Schedule", description: "See cleaning duties and next laundry", labelKey: "schedule", descriptionKey: "scheduleDesc" },
  { href: "/billings/laundry-fee", label: "Billings", description: "Review laundry fees and fines", labelKey: "billingCenter", descriptionKey: "billingsDesc" },
  { href: "/coins", label: "Coins", description: "Check your current coins and member status", labelKey: "coins", descriptionKey: "coinsDesc" },
  { href: "/billings/fine", label: "Fines", description: "Review unpaid fine tickets", labelKey: "fines", descriptionKey: "finesDesc" }
];

function parseLooseInteger(value: string | undefined) {
  const normalized = (value ?? "").replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCoinAmount(value: string | undefined) {
  return parseLooseInteger(value);
}

function parseFlexibleDate(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) {
    return null;
  }

  const [, dayValue, monthValue, yearValue] = match;
  const year =
    Number.parseInt(yearValue, 10) < 100 ? 2000 + Number.parseInt(yearValue, 10) : Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10) - 1;
  const day = Number.parseInt(dayValue, 10);
  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getNextMonthFirstDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function normalizeBranch(value: string | undefined) {
  const normalized = (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7" as const;
  }
  return "D2" as const;
}

function parseBedNumber(value: string | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function deriveRoomLabel(branchId: "D2" | "D7", bedValue: string | undefined) {
  const bed = parseBedNumber(bedValue);
  if (!bed || bed <= 0) {
    return "";
  }

  if (branchId === "D2") {
    if (bed >= 1 && bed <= 9) return "1";
    if (bed >= 10 && bed <= 15) return "2";
    if (bed >= 16 && bed <= 21) return "3";
    return "";
  }

  if (bed >= 1 && bed <= 9) return "1.1";
  if (bed >= 10 && bed <= 15) return "1.2";
  if (bed >= 16 && bed <= 24) return "1.3";
  if (bed >= 25 && bed <= 33) return "2.1";
  if (bed >= 34 && bed <= 39) return "2.2";
  if (bed >= 40 && bed <= 48) return "2.3";
  if (bed >= 49 && bed <= 57) return "3.1";
  if (bed >= 58 && bed <= 63) return "3.2";
  return "";
}

function deriveFloorLabel(branchId: "D2" | "D7", roomLabel: string) {
  if (!roomLabel) {
    return "-";
  }

  if (branchId === "D2") {
    return roomLabel;
  }

  return roomLabel.split(".")[0] || "-";
}

function prettyTaskType(type: CleaningTask["type"]) {
  if (type === "KITCHEN_D2") return "Kitchen D2";
  if (type === "KITCHEN_D7") return "Kitchen D7";
  return "Trash D7";
}

function formatCoins(value: number) {
  return new Intl.NumberFormat().format(value);
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
  const activeEmail = sessionEmail.trim().toLowerCase();

  async function loadDashboard() {
    if (!activeEmail) {
      setMessage(t("signInToView", "Sign in first to view your dashboard."));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const [clientResponse, laundryResponse, cleaningResponse, finesResponse, coinsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/cleaning/me?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`)
      ]);

      const clientData = (await clientResponse.json()) as ClientRecord | { error?: string };
      const laundryData = (await laundryResponse.json()) as { bookings?: LaundryBooking[]; error?: string };
      const cleaningData = (await cleaningResponse.json()) as (CleaningOverview & { error?: string }) | { error?: string };
      const finesData = (await finesResponse.json()) as { entries?: FineEntry[]; error?: string };
      const coinsData = (await coinsResponse.json()) as { entries?: CoinEntry[]; error?: string };

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

      if (!laundryResponse.ok || !cleaningResponse.ok || !finesResponse.ok || !coinsResponse.ok) {
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

  const nextCleaning = useMemo(
    () =>
      [...(cleaningOverview?.tasks ?? [])]
        .filter((task) => new Date(task.scheduledDate).getTime() >= Date.now())
        .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null,
    [cleaningOverview]
  );

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

    return {
      earnedLastMonth,
      earnedThisMonth,
      usedByMonth: monthlyUsage,
      usedByCategory: categoryUsage,
      maxUsedByMonth: Math.max(1, ...monthlyUsage.map((entry) => entry.value)),
      maxUsedByCategory: Math.max(1, ...categoryUsage.map((entry) => entry.value))
    };
  }, [coinEntries]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">{t("accountOverview", "Account Overview")}</p>
            <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
              {client?.["Tên"] || t("yourDashboard", "Your dashboard")}
            </h1>
            <p className="max-w-2xl text-sm text-slate-600">
              {t("dashboardSubtext", "A quick view of your account, bookings, cleaning schedule, and unpaid fine tickets.")}
            </p>
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

        {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}
      </section>

      <section className="-mx-4 overflow-x-auto px-4 pb-1 hide-scrollbar sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="w-48 shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="text-sm font-semibold text-slate-900">{t(link.labelKey, link.label)}</div>
              <div className="mt-2 text-xs leading-5 text-slate-600">{t(link.descriptionKey, link.description)}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{t("nextCleaning", "Next Cleaning")}</div>
          <div className="mt-3 text-lg font-semibold text-slate-900">
            {nextCleaning ? new Date(nextCleaning.scheduledDate).toLocaleDateString() : t("noUpcomingTask", "No upcoming task")}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {nextCleaning ? `${prettyTaskType(nextCleaning.type)} · ${nextCleaning.status}` : t("clearForNow", "You are clear for now.")}
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">{t("unpaidFineTickets", "Unpaid Fine Tickets")}</div>
          <div className="mt-3 text-2xl font-semibold text-slate-900">{unpaidFineSummary.count}</div>
          <div className="mt-2 text-sm text-slate-600">
            {t("totalUnpaidAmount", "Total unpaid amount")}: {unpaidFineSummary.amount.toLocaleString()} VND
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{t("briefUserInfo", "Brief User Info")}</h2>
            <Link href="/account-overview" className="text-sm font-medium text-sky-800">
              {t("openFullAccount", "Open full account")}
            </Link>
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
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{t("nextLaundry", "Next Laundry")}</h2>
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

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{t("accountSnapshot", "Account Snapshot")}</h2>
              <Link href="/billings/fine" className="text-sm font-medium text-sky-800">
                {t("reviewFines", "Review fines")}
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("cozoroMember", "Cozoro Member")}</div>
                <div className="mt-2 text-sm font-medium text-slate-900">{client?.["Cozoro Member"] || "-"}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("contractCode", "Contract Code")}</div>
                <div className="mt-2 text-sm font-medium text-slate-900">{client?.["MÃ HD"] || "-"}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("paidThrough", "Paid Through")}</div>
                <div className="mt-2 text-sm font-medium text-slate-900">{client?.["Ngày hết hạn gói đã thanh toán"] || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm text-slate-700">
                    <span className="truncate">{entry.label}</span>
                    <span>{formatCoins(entry.value)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100">
                    <div
                      className="h-3 rounded-full bg-emerald-600"
                      style={{ width: `${Math.max(8, (entry.value / coinSummary.maxUsedByCategory) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
