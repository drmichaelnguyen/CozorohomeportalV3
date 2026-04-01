"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildCozoroMemberProgram, parseUpgradeCoins } from "../lib/cozoro-member";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { LaundryController } from "./laundry-controller";
import { ContractExtension } from "./contract-extension";

type ClientRecord = Record<string, string>;

type LaundryBooking = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: string;
  end: string;
  htmlLink: string;
};

type CoinEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
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

type PaymentEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
};

type FineEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
};

type BookingFilterMode = "future" | "past";
type CalendarViewMode = "list" | "month" | "week" | "day";

const overviewFields = [
  "\u0110\u1ecba ch\u1ec9 email",
  "T\u00ean",
  "Gi\u1edbi t\u00ednh",
  "Chi nh\u00e1nh Cozoro dorm",
  "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i li\u00ean h\u1ec7",
  "s\u1ed1 gi\u01b0\u1eddng",
  "Room",
  "Hi\u1ec7n c\u00f2n \u1edf",
  "M\u00c3 HD",
  "Ng\u00e0y b\u1eaft \u0111\u1ea7u h\u1ee3p \u0111\u1ed3ng",
  "Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng",
  "Ph\u00ed \u1edf \u0111\u00f3ng m\u1ed7i th\u00e1ng",
  "Ph\u00ed g\u1edfi xe",
  "Th\u00e1ng n\u00e0y",
  "Th\u00e1ng tr\u01b0\u1edbc",
  "\u01afu \u0111\u00e3i th\u00e1ng",
  "T\u1ed5ng ti\u1ec1n thanh to\u00e1n th\u00e1ng",
  "Ng\u00e0y h\u1ebft h\u1ea1n g\u00f3i \u0111\u00e3 thanh to\u00e1n",
  "\u0110\u00e3 \u0111\u00f3ng ph\u00ed th\u00e1ng",
  "Ch\u00fa th\u00edch",
  "Chi ph\u00ed gi\u1eb7t s\u1ea5y",
  "S\u1ed1 l\u01b0\u1ee3t gi\u1eb7t",
  "S\u1ed1 l\u01b0\u1ee3t gi\u1eb7t \u0111\u1ed5i coins",
  "S\u1ed1 l\u01b0\u1ee3t gi\u1eb7t l\u1ed3ng ngang",
  "S\u1ed1 l\u01b0\u1ee3t s\u1ea5y",
  "S\u1ed1 l\u01b0\u1ee3t s\u1ea5y \u0111\u1ed5i coins",
  "Cozoro coins hi\u1ec7n c\u00f3",
  "T\u1ed5ng Coins t\u00edch lu\u1ef9",
  "Cozoro Member"
];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(next, diff);
}

function startOfMonthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  return startOfWeek(first);
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatRange(start: string, end: string) {
  return `${new Date(start).toLocaleString()} to ${new Date(end).toLocaleString()}`;
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
  const year = Number.parseInt(yearValue, 10) < 100 ? 2000 + Number.parseInt(yearValue, 10) : Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10) - 1;
  const day = Number.parseInt(dayValue, 10);
  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getNextMonthFirstDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function parseCoinAmount(value: string | undefined) {
  const normalized = (value ?? "").replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
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

export function AccountOverviewClient() {
  const { t, language, setLanguage } = usePortalLanguage();
  const { sessionEmail, isLoggedIn, login } = usePortalSession();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [laundryBookings, setLaundryBookings] = useState<LaundryBooking[]>([]);
  const [coinEntries, setCoinEntries] = useState<CoinEntry[]>([]);
  const [cleaningOverview, setCleaningOverview] = useState<CleaningOverview | null>(null);
  const [bookingFilterMode, setBookingFilterMode] = useState<BookingFilterMode>("future");
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("list");
  const [calendarFocusDate, setCalendarFocusDate] = useState(() => startOfDay(new Date()));
  const [expandedBookingIds, setExpandedBookingIds] = useState<string[]>([]);
  const [refreshingCalendar, setRefreshingCalendar] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [showAllInformation, setShowAllInformation] = useState(false);
  const [showLaundryDetails, setShowLaundryDetails] = useState(false);
  const [selectedUpgradeMember, setSelectedUpgradeMember] = useState("");
  const [upgradingMember, setUpgradingMember] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [fines, setFines] = useState<FineEntry[]>([]);
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const activeEmail = sessionEmail.trim().toLowerCase();

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  const clientWithDerivedRoom = useMemo(() => {
    if (!client) {
      return null;
    }

    const branchId = normalizeBranch(client["Chi nhánh Cozoro dorm"]);
    return {
      ...client,
      Room: deriveRoomLabel(branchId, client["số giường"])
    } as ClientRecord;
  }, [client]);

  async function loadAccountData() {
    setLoading(true);
    setMessage("");
    setClient(null);
    setLaundryBookings([]);
    setCoinEntries([]);
    setPayments([]);
    setFines([]);
    setCleaningOverview(null);
    setExpandedBookingIds([]);
    setCalendarFilter("all");
    setMonthFilter("all");
    setYearFilter("all");
    setRangeStart("");
    setRangeEnd("");
    setShowAllInformation(false);
    setShowLaundryDetails(false);

    try {
      const response = await fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(activeEmail)}`);
      const data = (await response.json()) as ClientRecord | { error?: string };

      if (!response.ok) {
        setMessage(
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to load account information."
        );
        return;
      }

      setClient(data as ClientRecord);
      login(activeEmail);
      const [laundryResponse, coinsResponse, cleaningResponse, paymentsResponse, finesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/cleaning/me?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/payments?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`)
      ]);
      const laundryPayload = (await laundryResponse.json()) as
        | { bookings?: LaundryBooking[]; error?: string }
        | undefined;
      const coinsPayload = (await coinsResponse.json()) as { entries?: CoinEntry[]; error?: string } | undefined;
      const cleaningPayload = (await cleaningResponse.json()) as (CleaningOverview & { error?: string }) | undefined;
      const paymentsPayload = (await paymentsResponse.json()) as { entries?: PaymentEntry[]; error?: string } | undefined;
      const finesPayload = (await finesResponse.json()) as { entries?: FineEntry[]; error?: string } | undefined;

      if (laundryResponse.ok) {
        setLaundryBookings(laundryPayload?.bookings ?? []);
      } else {
        setMessage(
          typeof laundryPayload === "object" &&
            laundryPayload !== null &&
            "error" in laundryPayload &&
            typeof laundryPayload.error === "string"
            ? `Account information loaded, but calendar bookings could not be read: ${laundryPayload.error}`
            : "Account information loaded, but calendar bookings could not be read."
        );
        return;
      }

      if (coinsResponse.ok) {
        setCoinEntries(coinsPayload?.entries ?? []);
      }

      if (cleaningResponse.ok) {
        setCleaningOverview({
          tasks: cleaningPayload?.tasks ?? []
        });
      }

      if (paymentsResponse.ok) {
        setPayments(paymentsPayload?.entries ?? []);
      }

      if (finesResponse.ok) {
        setFines(finesPayload?.entries ?? []);
      }

      setMessage("Account information loaded.");
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets is connected.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadAccountData();
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t("enterBothPasswords", "Please enter all password fields."));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordsDoNotMatch", "Passwords do not match."));
      return;
    }

    if (newPassword.length < 4) {
      setPasswordError(t("passwordTooShort", "Password must be at least 4 characters."));
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to change password.");
      }

      setPasswordSuccess(t("passwordChangedSuccess", "Password changed successfully."));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function refreshCalendarNow() {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setRefreshingCalendar(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}&refresh=true`
      );
      const payload = (await response.json()) as { bookings?: LaundryBooking[]; error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Unable to refresh calendar bookings.");
        return;
      }

      setLaundryBookings(payload.bookings ?? []);
      setExpandedBookingIds([]);
      setMessage("Calendar refreshed with the latest Google data.");
    } catch {
      setMessage("Unable to refresh calendar bookings right now.");
    } finally {
      setRefreshingCalendar(false);
    }
  }

  async function upgradeCozoroMemberNow() {
    if (!activeEmail || !selectedUpgradeMember) {
      setMessage("Choose a Cozoro Member to upgrade first.");
      return;
    }

    setUpgradingMember(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cozoro-member/upgrade`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          targetMember: selectedUpgradeMember
        })
      });
      const payload = (await response.json()) as {
        currentCoins?: number;
        upgradedTo?: string;
        upgradeCost?: number;
        error?: string;
      };

      if (!response.ok) {
        setMessage(payload.error ?? "Unable to upgrade Cozoro Member.");
        return;
      }

      await loadAccountData();
      setMessage(
        `Cozoro Member upgraded to ${payload.upgradedTo ?? selectedUpgradeMember} using ${new Intl.NumberFormat().format(
          payload.upgradeCost ?? 0
        )} coins.`
      );
    } catch {
      setMessage("Unable to upgrade Cozoro Member right now.");
    } finally {
      setUpgradingMember(false);
    }
  }

  const shownFields = clientWithDerivedRoom
    ? overviewFields
        .filter((field) => clientWithDerivedRoom[field])
        .map((field) => [field, clientWithDerivedRoom[field]] as const)
    : [];
  const visibleFields = showAllInformation ? shownFields : shownFields.slice(0, 8);
  const calendarOptions = useMemo(
    () => Array.from(new Set(laundryBookings.map((booking) => booking.calendarSummary))).sort(),
    [laundryBookings]
  );
  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          laundryBookings.map((booking) => String(new Date(booking.start).getFullYear()))
        )
      ).sort(),
    [laundryBookings]
  );
  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          laundryBookings.map((booking) =>
            String(new Date(booking.start).getMonth() + 1).padStart(2, "0")
          )
        )
      ).sort(),
    [laundryBookings]
  );
  const filteredBookings = useMemo(() => {
    const now = Date.now();
    return laundryBookings.filter((booking) => {
      const endTime = new Date(booking.end).getTime();
      const startDate = new Date(booking.start);
      const passesCurrentPast = bookingFilterMode === "future" ? endTime >= now : endTime < now;
      const passesCalendar =
        calendarFilter === "all" ? true : booking.calendarSummary === calendarFilter;
      const passesMonth =
        monthFilter === "all"
          ? true
          : String(startDate.getMonth() + 1).padStart(2, "0") === monthFilter;
      const passesYear =
        yearFilter === "all" ? true : String(startDate.getFullYear()) === yearFilter;
      const passesStart = rangeStart ? startDate >= new Date(`${rangeStart}T00:00:00`) : true;
      const passesEnd = rangeEnd ? startDate <= new Date(`${rangeEnd}T23:59:59`) : true;

      return passesCurrentPast && passesCalendar && passesMonth && passesYear && passesStart && passesEnd;
    });
  }, [bookingFilterMode, calendarFilter, monthFilter, yearFilter, rangeEnd, rangeStart, laundryBookings]);
  const laundrySummaryByCalendar = useMemo(() => {
    const summary = new Map<
      string,
      { calendar: string; bookings: number; totalMinutes: number }
    >();

    for (const booking of filteredBookings) {
      const key = booking.calendarSummary || "Unknown calendar";
      const current = summary.get(key) ?? {
        calendar: key,
        bookings: 0,
        totalMinutes: 0
      };
      const durationMinutes = Math.max(
        0,
        Math.round((new Date(booking.end).getTime() - new Date(booking.start).getTime()) / 60000)
      );
      current.bookings += 1;
      current.totalMinutes += durationMinutes;
      summary.set(key, current);
    }

    return Array.from(summary.values()).sort((left, right) => left.calendar.localeCompare(right.calendar));
  }, [filteredBookings]);
  const monthDays = useMemo(() => {
    const gridStart = startOfMonthGrid(calendarFocusDate);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [calendarFocusDate]);
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(calendarFocusDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [calendarFocusDate]);
  const dayBookings = filteredBookings.filter((booking) => sameDay(new Date(booking.start), calendarFocusDate));
  const nextPaymentDate = useMemo(() => {
    if (!client) {
      return null;
    }

    const expiry = parseFlexibleDate(clientWithDerivedRoom?.["Ngày hết hạn gói đã thanh toán"]);
    const today = startOfDay(new Date());

    if (!expiry || startOfDay(expiry).getTime() < today.getTime()) {
      return getNextMonthFirstDate();
    }

    return expiry;
  }, [client]);
  const currentCoins = useMemo(() => {
    let earned = 0;
    let used = 0;

    for (const entry of coinEntries) {
      const amount = parseCoinAmount(entry.row["COINS"]);
      if (amount > 0) {
        earned += amount;
      } else if (amount < 0) {
        used += Math.abs(amount);
      }
    }

    return earned - used;
  }, [coinEntries]);
  const nextLaundryBooking = useMemo(() => {
    const now = Date.now();
    return [...laundryBookings]
      .filter((booking) => new Date(booking.end).getTime() >= now)
      .sort((left, right) => left.start.localeCompare(right.start))[0] ?? null;
  }, [laundryBookings]);
  const nextCleaningTask = useMemo(() => {
    const now = Date.now();
    return [...(cleaningOverview?.tasks ?? [])]
      .filter((task) => new Date(task.scheduledDate).getTime() >= now)
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null;
  }, [cleaningOverview]);
  const memberProgram = useMemo(
    () =>
      buildCozoroMemberProgram({
        rankValue: clientWithDerivedRoom?.["Cozoro Member"] ?? "",
        branchId: clientWithDerivedRoom?.["Chi nhánh Cozoro dorm"] ?? "",
        totalAccumulatedCoins: clientWithDerivedRoom?.["Tổng Coins tích luỹ"] ?? currentCoins
      }),
    [clientWithDerivedRoom, currentCoins]
  );
  const availableMemberUpgrades = useMemo(() => {
    const currentTierIndex = memberProgram.currentTier
      ? memberProgram.branchTiers.findIndex((tier) => tier.name === memberProgram.currentTier?.name)
      : -1;

    return memberProgram.branchTiers
      .filter((tier) => memberProgram.branchId === "D2" || memberProgram.branchId === "D7")
      .filter((tier) => memberProgram.branchTiers.findIndex((entry) => entry.name === tier.name) > currentTierIndex)
      .map((tier) => ({
        ...tier,
        upgradeCost: parseUpgradeCoins(tier.upgradeCoins)
      }))
      .filter((tier) => tier.upgradeCost != null);
  }, [memberProgram]);

  useEffect(() => {
    const firstAvailableUpgrade = availableMemberUpgrades[0]?.name ?? "";
    setSelectedUpgradeMember((current) =>
      current && availableMemberUpgrades.some((tier) => tier.name === current) ? current : firstAvailableUpgrade
    );
  }, [availableMemberUpgrades]);

  function moveCalendar(direction: -1 | 1) {
    if (calendarViewMode === "month") {
      setCalendarFocusDate(
        (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1)
      );
      return;
    }

    if (calendarViewMode === "week") {
      setCalendarFocusDate((current) => addDays(current, direction * 7));
      return;
    }

    setCalendarFocusDate((current) => addDays(current, direction));
  }

  function toggleExpandedBooking(id: string) {
    setExpandedBookingIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }

  function formatUsage(totalMinutes: number) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return `${minutes}m`;
    }

    if (minutes === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{t("accountOverviewTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {language === "vi"
            ? "Người dùng thường có thể xem thông tin tài khoản đã đồng bộ tại đây. Trang này không cho chỉnh sửa."
            : "Regular users can view their synced account information here. Editing is not available on this page."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 break-all">
            Signed in as <span className="font-medium">{sessionEmail}</span>
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={loading || !activeEmail}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Loading..." : "View account"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Thông tin của tôi" : "My Information"}
        </h2>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">
            Enter your email to load the active client row where <code>Hi\u1ec7n c\u00f2n \u1edf = 1</code>.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleFields.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 text-sm text-slate-900">{value}</div>
              </div>
            ))}
            {shownFields.length > 8 ? (
              <button
                type="button"
                onClick={() => setShowAllInformation((current) => !current)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                {showAllInformation ? "Show less" : `Expand details (${shownFields.length - 8} more)`}
              </button>
            ) : null}
          </div>
        )}
      </section>

      {client?.["Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng"] && (
        <ContractExtension
          email={sessionEmail}
          endDateStr={client["Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng"]}
          onExtended={() => void loadAccountData()}
        />
      )}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Tóm tắt nhanh" : "Quick Summary"}
        </h2>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">Load your account first to see the upcoming summary items.</p>
        ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Payment Date</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {nextPaymentDate ? nextPaymentDate.toLocaleDateString() : "-"}
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Coins Currently Have</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{new Intl.NumberFormat().format(currentCoins)}</div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Laundry Time</div>
              <div className="mt-2 text-sm text-slate-900">
                {nextLaundryBooking ? formatRange(nextLaundryBooking.start, nextLaundryBooking.end) : "No upcoming laundry booking"}
              </div>
            </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Cleaning Schedule</div>
                <div className="mt-2 text-sm text-slate-900">
                  {nextCleaningTask
                    ? `${nextCleaningTask.type} - ${new Date(nextCleaningTask.scheduledDate).toLocaleDateString()}`
                    : "No upcoming cleaning task"}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cozoro Member</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{memberProgram.rank}</div>
                {(memberProgram.branchId === "D7" || memberProgram.branchId === "D2") && memberProgram.currentTier ? (
                  <div className="mt-1 text-xs text-slate-500">
                    {memberProgram.branchId} tier: {memberProgram.currentTier.name}
                    {memberProgram.nextTier ? ` • ${new Intl.NumberFormat().format(memberProgram.nextTier.remainingCoins)} to ${memberProgram.nextTier.name}` : ""}
                  </div>
                ) : null}
              </div>
            </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Cozoro Member</h2>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">Load your account first to see your member level and progress.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded Cozoro Member</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">{memberProgram.recordedRank}</div>
                <div className="mt-1 text-xs text-slate-500">Sheet value, updated monthly</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculated Cozoro Member</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">{memberProgram.liveRank}</div>
                <div className="mt-1 text-xs text-slate-500">Calculated from current accumulated coins</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accumulated Coins</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {new Intl.NumberFormat().format(memberProgram.totalAccumulatedCoins)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coins To Next Cozoro Member</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {memberProgram.nextTier ? new Intl.NumberFormat().format(memberProgram.nextTier.remainingCoins) : "0"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {memberProgram.nextTier ? `Next: ${memberProgram.nextTier.name}` : "Top Cozoro Member reached"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coins To Remain</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {memberProgram.maintainCoinsNeeded != null
                    ? new Intl.NumberFormat().format(memberProgram.maintainCoinsNeeded)
                    : "-"}
                </div>
                <div className="mt-1 text-xs text-slate-500">Monthly minimum to keep this Cozoro Member</div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Upgrade Cozoro Member</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Spend coins to move to a higher Cozoro Member. The upgrade will create a coins entry like
                    <span className="font-medium"> Upgrade to Diamond</span>.
                  </div>
                </div>

                {availableMemberUpgrades.length > 0 ? (
                  <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
                    <select
                      value={selectedUpgradeMember}
                      onChange={(event) => setSelectedUpgradeMember(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 sm:min-w-[16rem]"
                    >
                      {availableMemberUpgrades.map((tier) => (
                        <option key={tier.name} value={tier.name}>
                          {tier.name} - {new Intl.NumberFormat().format(tier.upgradeCost ?? 0)} coins
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void upgradeCozoroMemberNow()}
                      disabled={
                        upgradingMember ||
                        !selectedUpgradeMember ||
                        (availableMemberUpgrades.find((tier) => tier.name === selectedUpgradeMember)?.upgradeCost ?? 0) >
                          currentCoins
                      }
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {upgradingMember ? "Upgrading..." : "Upgrade now"}
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">No higher Cozoro Member upgrades are available.</div>
                )}
              </div>

              {availableMemberUpgrades.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {availableMemberUpgrades.map((tier) => {
                    const upgradeCost = tier.upgradeCost ?? 0;
                    const canAfford = currentCoins >= upgradeCost;
                    return (
                      <div
                        key={tier.name}
                        className={`rounded-xl border p-4 ${
                          selectedUpgradeMember === tier.name
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">{tier.name}</div>
                        <div className="mt-2 text-sm text-slate-600">
                          Upgrade cost: {new Intl.NumberFormat().format(upgradeCost)} coins
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {canAfford ? "You have enough coins for this upgrade." : "Not enough current coins yet."}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Lịch giặt sấy" : "Laundry Bookings"}
        </h2>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">
            Load your account first to see any matching Google Calendar laundry bookings.
          </p>
        ) : laundryBookings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No Google Calendar laundry bookings were found for this email in the configured calendars.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">Booking View</div>
                  <div className="text-sm text-slate-600">
                    {calendarViewMode === "month"
                      ? calendarFocusDate.toLocaleString(undefined, {
                          month: "long",
                          year: "numeric"
                        })
                      : calendarViewMode === "week"
                        ? `Week of ${startOfWeek(calendarFocusDate).toLocaleDateString()}`
                        : calendarFocusDate.toLocaleDateString()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["future", "past"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBookingFilterMode(mode)}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        bookingFilterMode === mode
                          ? "bg-slate-900 text-white"
                          : "border border-slate-300 text-slate-700"
                      }`}
                    >
                      {mode === "future" ? "Future" : "Past"}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => moveCalendar(-1)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(startOfDay(new Date()))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCalendar(1)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    Next
                  </button>
                  {(["list", "month", "week", "day"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCalendarViewMode(mode)}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        calendarViewMode === mode
                          ? "bg-slate-900 text-white"
                          : "border border-slate-300 text-slate-700"
                      }`}
                    >
                      {mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void refreshCalendarNow()}
                    disabled={refreshingCalendar}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                  >
                    {refreshingCalendar ? "Refreshing..." : "Refresh calendar"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <label className="block text-sm font-medium text-slate-700">
                  Calendar
                  <select
                    value={calendarFilter}
                    onChange={(event) => setCalendarFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="all">All calendars</option>
                    {calendarOptions.map((calendar) => (
                      <option key={calendar} value={calendar}>
                        {calendar}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Month
                  <select
                    value={monthFilter}
                    onChange={(event) => setMonthFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="all">All months</option>
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {new Date(2000, Number(month) - 1, 1).toLocaleString(undefined, {
                          month: "long"
                        })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Year
                  <select
                    value={yearFilter}
                    onChange={(event) => setYearFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="all">All years</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  From
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  To
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total Bookings
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {filteredBookings.length}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total Usage
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {formatUsage(
                      filteredBookings.reduce((sum, booking) => {
                        return (
                          sum +
                          Math.max(
                            0,
                            Math.round(
                              (new Date(booking.end).getTime() - new Date(booking.start).getTime()) / 60000
                            )
                          )
                        );
                      }, 0)
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Calendars Used
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {laundrySummaryByCalendar.length}
                  </div>
                </div>
              </div>

              {laundrySummaryByCalendar.length > 0 ? (
                <div className="mt-4 rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                    Laundry Summary by Calendar
                  </div>
                  <div className="divide-y divide-slate-200">
                    {laundrySummaryByCalendar.map((entry) => (
                      <div
                        key={entry.calendar}
                        className="grid gap-2 px-4 py-3 text-sm text-slate-700 md:grid-cols-[minmax(0,1fr),140px,140px]"
                      >
                        <div className="font-medium text-slate-900">{entry.calendar}</div>
                        <div>{entry.bookings} bookings</div>
                        <div>{formatUsage(entry.totalMinutes)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {filteredBookings.length === 0 ? (
                <div className="mt-4 text-sm text-slate-500">
                  No {bookingFilterMode} laundry bookings found for this account.
                </div>
              ) : null}

              {filteredBookings.length > 0 ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowLaundryDetails((current) => !current)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    {showLaundryDetails ? "Hide booking details" : `Expand booking details (${filteredBookings.length})`}
                  </button>
                </div>
              ) : null}

              {filteredBookings.length > 0 && showLaundryDetails && calendarViewMode === "list" ? (
                <div className="mt-4 space-y-3">
                  {filteredBookings.map((booking) => (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => toggleExpandedBooking(booking.id)}
                      className="block w-full rounded-xl border border-slate-200 p-4 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-900">{booking.summary}</div>
                        <div className="text-xs text-slate-500">
                          {expandedBookingIds.includes(booking.id) ? "Hide" : "Show"}
                        </div>
                      </div>

                      {expandedBookingIds.includes(booking.id) ? (
                        <div className="mt-3">
                          <div className="text-sm text-slate-600">{formatRange(booking.start, booking.end)}</div>
                          <div className="mt-1 text-sm text-slate-600">Calendar: {booking.calendarSummary}</div>
                          {booking.location ? (
                            <div className="mt-1 text-sm text-slate-600">Location: {booking.location}</div>
                          ) : null}
                          {booking.description ? (
                            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                              {booking.description}
                            </div>
                          ) : null}
                          {booking.htmlLink ? (
                            <a
                              href={booking.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="mt-3 inline-block text-sm font-medium text-slate-900 underline"
                            >
                              Open in Google Calendar
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {filteredBookings.length > 0 && showLaundryDetails && calendarViewMode === "month" ? (
                <div className="mt-4 overflow-x-auto pb-2 hide-scrollbar">
                  <div className="grid min-w-[42rem] grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                      <div key={label}>{label}</div>
                    ))}
                  </div>
                  <div className="mt-2 grid min-w-[42rem] grid-cols-7 gap-2">
                    {monthDays.map((day) => {
                      const events = filteredBookings.filter((booking) => sameDay(new Date(booking.start), day));
                      const isCurrentMonth = day.getMonth() === calendarFocusDate.getMonth();
                      const isToday = sameDay(day, new Date());
                      return (
                        <div
                          key={day.toISOString()}
                          className={`min-h-28 rounded-xl border p-2 ${
                            isCurrentMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                          } ${isToday ? "ring-2 ring-slate-900" : ""}`}
                        >
                          <div className="text-sm font-medium text-slate-900">{day.getDate()}</div>
                          <div className="mt-2 space-y-1">
                            {events.slice(0, 3).map((booking) => (
                              <button
                                key={booking.id}
                                type="button"
                                onClick={() => {
                                  setCalendarViewMode("day");
                                  setCalendarFocusDate(startOfDay(new Date(booking.start)));
                                }}
                                className="block w-full rounded-md bg-slate-900 px-2 py-1 text-left text-xs text-white"
                              >
                                {new Date(booking.start).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit"
                                })}{" "}
                                {booking.summary}
                              </button>
                            ))}
                            {events.length > 3 ? (
                              <div className="text-xs text-slate-500">+{events.length - 3} more</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {filteredBookings.length > 0 && showLaundryDetails && calendarViewMode === "week" ? (
                <div className="mt-4 overflow-x-auto pb-2 hide-scrollbar">
                  <div className="grid min-w-[42rem] gap-3 md:grid-cols-7">
                  {weekDays.map((day) => {
                    const events = filteredBookings.filter((booking) => sameDay(new Date(booking.start), day));
                    return (
                      <div key={day.toISOString()} className="rounded-xl border border-slate-200 p-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {day.toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric"
                          })}
                        </div>
                        <div className="mt-3 space-y-2">
                          {events.length === 0 ? (
                            <div className="text-xs text-slate-500">No bookings</div>
                          ) : (
                            events.map((booking) => (
                              <div key={booking.id} className="rounded-lg bg-slate-50 p-2">
                                <div className="text-xs font-medium text-slate-900">{booking.summary}</div>
                                <div className="mt-1 text-xs text-slate-600">
                                  {new Date(booking.start).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{booking.calendarSummary}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              ) : null}

              {filteredBookings.length > 0 && showLaundryDetails && calendarViewMode === "day" ? (
                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {calendarFocusDate.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </div>
                  <div className="mt-4 space-y-3">
                    {dayBookings.length === 0 ? (
                      <div className="text-sm text-slate-500">No bookings for this day.</div>
                    ) : (
                      dayBookings.map((booking) => (
                        <div key={booking.id} className="rounded-xl bg-slate-50 p-4">
                          <div className="font-medium text-slate-900">{booking.summary}</div>
                          <div className="mt-1 text-sm text-slate-600">{formatRange(booking.start, booking.end)}</div>
                          <div className="mt-1 text-sm text-slate-600">Calendar: {booking.calendarSummary}</div>
                          {booking.location ? (
                            <div className="mt-1 text-sm text-slate-600">Location: {booking.location}</div>
                          ) : null}
                          {booking.description ? (
                            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                              {booking.description}
                            </div>
                          ) : null}
                          {booking.htmlLink ? (
                            <a
                              href={booking.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-block text-sm font-medium text-slate-900 underline"
                            >
                              Open in Google Calendar
                            </a>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {/* Payments Section */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Lịch sử thanh toán" : "Payment History"}
          </h2>
          <Link href="/payments" className="text-sm font-medium text-sky-600 hover:underline">
            {language === "vi" ? "Xem tất cả" : "View all"}
          </Link>
        </div>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">Load account to see recent payments.</p>
        ) : payments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 italic">No recent payments found.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {payments.slice(0, 3).map((payment, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{payment.row["MỤC ĐÍCH"] || "Payment"}</div>
                  <div className="text-xs text-slate-500">{payment.parsedTimestamp ? new Date(payment.parsedTimestamp).toLocaleDateString() : ""}</div>
                </div>
                <div className="font-semibold text-slate-900">{payment.row["SỐ TIỀN"]}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fines Section */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Vi phạm & Tiền phạt" : "Fines & Violations"}
          </h2>
          <Link href="/fines" className="text-sm font-medium text-sky-600 hover:underline">
            {language === "vi" ? "Xem tất cả" : "View all"}
          </Link>
        </div>

        {!client ? (
          <p className="mt-3 text-sm text-slate-600">Load account to see recent fines.</p>
        ) : fines.length === 0 ? (
          <p className="mt-3 text-sm text-green-600 italic">No violations found. Great job!</p>
        ) : (
          <div className="mt-4 space-y-3">
            {fines.slice(0, 3).map((fine, idx) => (
              <div key={idx} className="rounded-xl border border-red-100 bg-red-50/30 p-3 text-sm">
                <div className="flex items-center justify-between font-medium text-slate-900">
                  <span>{fine.row["NỘI DUNG VI PHẠM"]}</span>
                  <span className="text-red-600">{fine.row["CHI PHÍ THANH TOÁN CHO VI PHẠM"]}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{fine.parsedTimestamp ? new Date(fine.parsedTimestamp).toLocaleDateString() : ""}</span>
                  <span className={fine.row["ĐÃ THANH TOÁN?"] === "1" ? "text-green-600 font-medium" : "text-amber-600 font-medium"}>
                    {fine.row["ĐÃ THANH TOÁN?"] === "1" ? "Paid" : "Unpaid"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Account Security Section */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("accountSecurity", "Account Security")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("changePasswordAnytime", "You can change your portal password here.")}
        </p>

        <form onSubmit={handlePasswordChange} className="mt-6 space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-700">{t("currentPassword")}</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("enterCurrentPassword")}
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">{t("newPassword")}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("chooseNewPassword")}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{t("confirmPassword")}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("confirmPassword")}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          {passwordError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 font-medium">
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 font-medium">
              {passwordSuccess}
            </div>
          )}

          <button
            type="submit"
            disabled={isChangingPassword}
            className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50 transition-all sm:w-auto"
          >
            {isChangingPassword ? t("changingPassword") : t("changePassword")}
          </button>
        </form>
      </section>

      {/* Language Preference Section */}
      <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Cài đặt ngôn ngữ" : "Language Preference"}
        </h2>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            {language === "vi" ? "Chọn ngôn ngữ hiển thị cho cổng thông tin." : "Choose the display language for the portal."}
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
      </section>
    </div>
  );
}
