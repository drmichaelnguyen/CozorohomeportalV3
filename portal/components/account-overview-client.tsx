"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildCozoroMemberProgram,
  COZORO_MEMBER_DIAMOND_EXAMPLE,
  COZORO_MEMBER_RULE_DETAILS,
  getMemberUpgradeCheck,
  parseUpgradeCoins
} from "../lib/cozoro-member";
import { API_BASE_URL } from "../lib/api-base-url";
import { APP_VERSION } from "../lib/app-version";
import { parseVietnamDate } from "../lib/contract-utils";
import { formatResidentCoinsOperatorLabel } from "../lib/resident-coin-operator";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { usePortalTheme } from "./portal-theme";
import { LaundryController } from "./laundry-controller";
import { ContractExtension } from "./contract-extension";
import { NextPaymentSummary } from "./next-payment-summary";
import { AccountNoonFlappyBee } from "./account-noon-flappy-bee";
import type { RentPaidStatusPayload } from "../lib/rent-paid-status";

type ClientRecord = Record<string, string>;

type CheckoutBannerContext = {
  eligible: boolean;
  kind?: "termination" | "contract_due";
  completed?: boolean;
  depositNote?: string;
};

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
  rewardCoins: number;
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
  return parseVietnamDate(value);
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

export function AccountOverviewClient() {
  const { t, language, setLanguage } = usePortalLanguage();
  const { sessionEmail, isLoggedIn, login, logout } = usePortalSession();
  const { theme, toggleTheme } = usePortalTheme();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [laundryBookings, setLaundryBookings] = useState<LaundryBooking[]>([]);
  const [coinEntries, setCoinEntries] = useState<CoinEntry[]>([]);
  const [cleaningOverview, setCleaningOverview] = useState<CleaningOverview | null>(null);
  const [bookingFilterMode, setBookingFilterMode] = useState<BookingFilterMode>("future");
  const [expandedBookingIds, setExpandedBookingIds] = useState<string[]>([]);
  const [refreshingCalendar, setRefreshingCalendar] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [bookingsExpanded, setBookingsExpanded] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [memberExpanded, setMemberExpanded] = useState(false);
  const [paymentsExpanded, setPaymentsExpanded] = useState(false);
  const [finesExpanded, setFinesExpanded] = useState(false);
  const [coinsExpanded, setCoinsExpanded] = useState(false);
  const [showAllCoins, setShowAllCoins] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [showAllInformation, setShowAllInformation] = useState(false);
  const [showMemberRuleHelp, setShowMemberRuleHelp] = useState(false);
  const [selectedUpgradeMember, setSelectedUpgradeMember] = useState("");
  const [upgradingMember, setUpgradingMember] = useState(false);
  const [completingCleaningTaskId, setCompletingCleaningTaskId] = useState("");
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [fines, setFines] = useState<FineEntry[]>([]);
  const [rentPaidStatus, setRentPaidStatus] = useState<RentPaidStatusPayload | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<CheckoutBannerContext | null>(null);
  
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

  useEffect(() => {
    if (sessionEmail && isLoggedIn) {
      void loadAccountData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEmail, isLoggedIn]);

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
    setRentPaidStatus(null);
    setCheckoutBanner(null);
    setCleaningOverview(null);
    setExpandedBookingIds([]);
    setCalendarFilter("all");
    setMonthFilter("all");
    setYearFilter("all");
    setRangeStart("");
    setRangeEnd("");
    setShowAllInformation(false);

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
      const [laundryResponse, coinsResponse, cleaningResponse, paymentsResponse, finesResponse, rentPaidResponse, checkoutCtxResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/cleaning/me?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/payments?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(activeEmail)}`),
        fetch(`${API_BASE_URL}/client/checkout-context?email=${encodeURIComponent(activeEmail)}`)
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

      if (rentPaidResponse.ok) {
        setRentPaidStatus((await rentPaidResponse.json()) as RentPaidStatusPayload);
      }

      if (checkoutCtxResponse.ok) {
        setCheckoutBanner((await checkoutCtxResponse.json()) as CheckoutBannerContext);
      }

      setMessage("Account information loaded.");
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets is connected.");
    } finally {
      setLoading(false);
    }
  }

  async function refetchRentPaidStatusOnly() {
    if (!activeEmail) {
      return;
    }
    try {
      const rentPaidResponse = await fetch(
        `${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(activeEmail)}`
      );
      if (rentPaidResponse.ok) {
        setRentPaidStatus((await rentPaidResponse.json()) as RentPaidStatusPayload);
      }
    } catch {
      // ignore
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

  async function markCleaningTaskDone(taskId: string) {
    if (!activeEmail) {
      setMessage("Enter your email first.");
      return;
    }

    setCompletingCleaningTaskId(taskId);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/tasks/${taskId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail
        })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Unable to mark task done.");
        return;
      }

      await loadAccountData();
      setMessage("Task marked done and sent for audit.");
    } catch {
      setMessage("Unable to mark task done right now.");
    } finally {
      setCompletingCleaningTaskId("");
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
  }, [client, clientWithDerivedRoom]);
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
  const previousMonthEarnings = useMemo(() => {
    const now = new Date();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonth = previousMonthDate.getMonth();
    const previousMonthYear = previousMonthDate.getFullYear();
    let total = 0;

    for (const entry of coinEntries) {
      if (!entry.parsedTimestamp) {
        continue;
      }

      const timestamp = new Date(entry.parsedTimestamp);
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      if (timestamp.getMonth() !== previousMonth || timestamp.getFullYear() !== previousMonthYear) {
        continue;
      }

      const amount = parseCoinAmount(entry.row["COINS"]);
      if (amount > 0) {
        total += amount;
      }
    }

    return total;
  }, [coinEntries]);
  const nextLaundryBooking = useMemo(() => {
    const now = Date.now();
    return [...laundryBookings]
      .filter((booking) => new Date(booking.end).getTime() >= now)
      .sort((left, right) => left.start.localeCompare(right.start))[0] ?? null;
  }, [laundryBookings]);
  const nextCleaningTask = useMemo(() => {
    return [...(cleaningOverview?.tasks ?? [])]
      .filter((task) => task.status === "ASSIGNED" && getCleaningLateDeadline(task).getTime() >= Date.now())
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null;
  }, [cleaningOverview]);
  const memberProgram = useMemo(
    () =>
      buildCozoroMemberProgram({
        rankValue: clientWithDerivedRoom?.["Cozoro Member"] ?? "",
        branchId: clientWithDerivedRoom?.["Chi nhánh Cozoro dorm"] ?? "",
        totalAccumulatedCoins: clientWithDerivedRoom?.["Tổng Coins tích luỹ"] ?? currentCoins,
        previousMonthEarnings
      }),
    [clientWithDerivedRoom, currentCoins, previousMonthEarnings]
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
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-900">{t("accountOverviewTitle")}</h1>
          {isLoggedIn && (
            <button
              type="button"
              onClick={logout}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
            >
              {t("logout", "Log out")}
            </button>
          )}
        </div>
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

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setInfoExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Thông tin của tôi" : "My Information"}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${infoExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {infoExpanded && (
          <div className="px-6 pb-6">
            {!client ? (
              <p className="text-sm text-slate-600">
                {loading ? "Loading..." : "Account information will appear here once loaded."}
              </p>
            ) : (
              <div className="space-y-3">
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
          </div>
        )}
      </section>

      {checkoutBanner?.eligible && !checkoutBanner.completed && client && client["Hiện còn ở"] !== "-1" ? (
        <section
          className={`rounded-2xl border p-6 shadow-sm ${
            checkoutBanner.kind === "termination"
              ? "border-rose-300 bg-rose-50"
              : "border-amber-300 bg-amber-50"
          }`}
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {checkoutBanner.kind === "termination" ? "Check-out bắt buộc" : "Quy trình trả phòng"}
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            {checkoutBanner.kind === "termination"
              ? "Hợp đồng đã được chấm dứt. Vui lòng hoàn tất các bước check-out trước khi rời đi."
              : "Hợp đồng của bạn đang trong kỳ trả phòng (trong vòng 7 ngày trước ngày hết hạn). Hoàn tất check-out theo từng bước và ảnh minh chứng."}
          </p>
          {checkoutBanner.depositNote ? (
            <p className="mt-2 text-xs font-medium text-amber-900">⚠️ {checkoutBanner.depositNote}</p>
          ) : null}
          <Link
            href="/check-out"
            className={`mt-4 inline-flex rounded-xl px-5 py-2.5 text-sm font-semibold text-white ${
              checkoutBanner.kind === "termination" ? "bg-rose-700 hover:bg-rose-800" : "bg-amber-800 hover:bg-amber-900"
            }`}
          >
            {language === "vi" ? "Mở Check-out →" : "Open check-out →"}
          </Link>
        </section>
      ) : null}

      {client?.["Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng"] && (
        <ContractExtension
          email={sessionEmail}
          endDateStr={client["Ng\u00e0y h\u1ebft h\u1ea1n h\u1ee3p \u0111\u1ed3ng"]}
          onExtended={() => void loadAccountData()}
        />
      )}

      {client && client["Hiện còn ở"] !== "-1" ? (
        <NextPaymentSummary
          nextPaymentDate={nextPaymentDate}
          rentPaidStatus={rentPaidStatus}
          rentLoading={loading}
          residentEmail={activeEmail}
          onRentPaidStatusRefresh={() => void refetchRentPaidStatusOnly()}
          packageExpiryNote={
            client["Ngày hết hạn gói đã thanh toán"]
              ? language === "vi"
                ? `Ngày hết hạn gói đã thanh toán: ${client["Ngày hết hạn gói đã thanh toán"]}`
                : `Paid package expires: ${client["Ngày hết hạn gói đã thanh toán"]}`
              : language === "vi"
                ? "Không có ngày hết hạn gói trong hồ sơ — kỳ thanh toán tiếp theo mặc định là ngày đầu tháng sau."
                : "No paid-package expiry on file — next cycle defaults to the first day of next month."
          }
          showPaymentsLink
        />
      ) : null}

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setSummaryExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Tóm tắt nhanh" : "Quick Summary"}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${summaryExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {summaryExpanded && (
        <div className="px-6 pb-6">
        {!client ? (
          <p className="text-sm text-slate-600">{loading ? "Loading..." : "Account information will appear here once loaded."}</p>
        ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                {nextCleaningTask ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-1 font-semibold ${canCompleteCleaningTaskLate(nextCleaningTask) ? "bg-rose-100 text-rose-700" : canCompleteCleaningTaskNow(nextCleaningTask) ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                        {canCompleteCleaningTaskLate(nextCleaningTask) ? "Due" : canCompleteCleaningTaskNow(nextCleaningTask) ? "Today" : "Scheduled"}
                      </span>
                      <span className="font-semibold text-amber-800">
                        +{new Intl.NumberFormat().format(canCompleteCleaningTaskLate(nextCleaningTask) ? Math.round(nextCleaningTask.rewardCoins * 0.5) : nextCleaningTask.rewardCoins)} Coins
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      {canCompleteCleaningTaskLate(nextCleaningTask)
                        ? `Late window is open until ${getCleaningLateDeadline(nextCleaningTask).toLocaleString()}.`
                        : canCompleteCleaningTaskNow(nextCleaningTask)
                          ? `Mark done is open during ${getCleaningCompletionWindow(nextCleaningTask).label}.`
                          : `Mark done opens during ${getCleaningCompletionWindow(nextCleaningTask).label}.`}
                    </div>
                    <button
                      type="button"
                      onClick={() => void markCleaningTaskDone(nextCleaningTask.id)}
                      disabled={
                        completingCleaningTaskId === nextCleaningTask.id ||
                        (!canCompleteCleaningTaskNow(nextCleaningTask) && !canCompleteCleaningTaskLate(nextCleaningTask))
                      }
                      className={`mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${canCompleteCleaningTaskLate(nextCleaningTask) ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-900 hover:bg-slate-800"}`}
                    >
                      {completingCleaningTaskId === nextCleaningTask.id
                        ? "Submitting..."
                        : canCompleteCleaningTaskLate(nextCleaningTask)
                          ? "Mark done (late - 50% coins)"
                          : "Mark done"}
                    </button>
                  </>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cozoro Member</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{memberProgram.rank}</div>
                {(memberProgram.branchId === "D7" || memberProgram.branchId === "D2") && memberProgram.currentTier ? (
                  <div className="mt-1 text-xs text-slate-500">
                    {memberProgram.branchId} tier: {memberProgram.currentTier.name}
                    {` • Prev month earned ${new Intl.NumberFormat().format(memberProgram.previousMonthEarnings)}`}
                    {memberProgram.nextTier ? ` • ${new Intl.NumberFormat().format(memberProgram.nextTier.remainingCoins)} to ${memberProgram.nextTier.name}` : ""}
                  </div>
                ) : null}
              </div>
            </div>
        )}
        </div>
        )}
      </section>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setMemberExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMemberExpanded((v) => !v); }}
          className="flex w-full cursor-pointer items-center justify-between p-6 text-left"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Cozoro Member</h2>
          </div>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${memberExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {memberExpanded && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setShowMemberRuleHelp((current) => !current)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-semibold text-slate-700"
              aria-label="Show Cozoro Member ranking details"
              title="How Cozoro Member ranking is calculated"
            >
              ?
            </button>
            <span className="text-sm text-slate-500">How ranking is calculated</span>
          </div>
          {!client ? (
            <p className="text-sm text-slate-600">{loading ? "Loading..." : "Account information will appear here once loaded."}</p>
          ) : (
          <>
            {showMemberRuleHelp ? (
              <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">How Cozoro calculates your member tier</div>
                <div className="mt-3 space-y-2">
                  {COZORO_MEMBER_RULE_DETAILS.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-sky-100 bg-white px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diamond example</div>
                  <div className="mt-2 space-y-1">
                    {COZORO_MEMBER_DIAMOND_EXAMPLE.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded Cozoro Member</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">{memberProgram.recordedRank}</div>
                <div className="mt-1 text-xs text-slate-500">Sheet value, updated monthly</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculated Cozoro Member</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">{memberProgram.liveRank}</div>
                <div className="mt-1 text-xs text-slate-500">Calculated from accumulated coins and previous month earnings</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accumulated Coins</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {new Intl.NumberFormat().format(memberProgram.totalAccumulatedCoins)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous Month Earned</div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {new Intl.NumberFormat().format(memberProgram.previousMonthEarnings)}
                </div>
                <div className="mt-1 text-xs text-slate-500">Positive coins earned in the previous calendar month</div>
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
                    Move to a higher Cozoro Member when you meet the accumulated-coins rule, previous-month rule, and any one-time upgrade fee for that tier. The upgrade will create a coins entry like
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
                    const eligibility = getMemberUpgradeCheck({
                      tierName: tier.name,
                      totalAccumulatedCoins: memberProgram.totalAccumulatedCoins,
                      previousMonthEarnings: memberProgram.previousMonthEarnings,
                      currentCoins
                    });
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
                          One-time upgrade cost: {new Intl.NumberFormat().format(upgradeCost)} coins
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          <div>
                            {eligibility?.meetsAccumulated
                              ? "Accumulated coins requirement met."
                              : `Need ${new Intl.NumberFormat().format(eligibility?.threshold ?? 0)} accumulated coins.`}
                          </div>
                          <div>
                            {eligibility?.meetsPreviousMonth
                              ? "Previous month earnings requirement met."
                              : `Need ${new Intl.NumberFormat().format(eligibility?.previousMonthRequirement ?? 0)} coins earned in the previous month.`}
                          </div>
                          <div>
                            {canAfford
                              ? "Current coin balance is enough for the one-time upgrade fee."
                              : "Not enough current coins for the one-time upgrade fee yet."}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
          )}
        </div>
        )}
      </section>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setBookingsExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Lịch giặt sấy" : "My Bookings"}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${bookingsExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {bookingsExpanded && (
          <div className="px-6 pb-6">
        {!client ? (
          <p className="text-sm text-slate-600">
            Load your account first to see any matching Google Calendar laundry bookings.
          </p>
        ) : laundryBookings.length === 0 ? (
          <p className="text-sm text-slate-600">
            No Google Calendar laundry bookings were found for this email in the configured calendars.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bookingFilterMode}
                  onChange={(e) => setBookingFilterMode(e.target.value as BookingFilterMode)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                >
                  <option value="future">Upcoming</option>
                  <option value="past">Past</option>
                </select>
                <select
                  value={calendarFilter}
                  onChange={(event) => setCalendarFilter(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                >
                  <option value="all">All calendars</option>
                  {calendarOptions.map((calendar) => (
                    <option key={calendar} value={calendar}>{calendar}</option>
                  ))}
                </select>
                <select
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                >
                  <option value="all">All years</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <select
                  value={monthFilter}
                  onChange={(event) => setMonthFilter(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                >
                  <option value="all">All months</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {new Date(2000, Number(month) - 1, 1).toLocaleString(undefined, { month: "short" })}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                  title="From date"
                />
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                  title="To date"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{filteredBookings.length} bookings</span>
                <button
                  type="button"
                  onClick={() => void refreshCalendarNow()}
                  disabled={refreshingCalendar}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                >
                  {refreshingCalendar ? "..." : "Refresh"}
                </button>
              </div>
            </div>

            {filteredBookings.length === 0 ? (
              <p className="text-sm text-slate-500">No {bookingFilterMode === "future" ? "upcoming" : "past"} bookings.</p>
            ) : (
              <div className="space-y-2">
                {filteredBookings.map((booking) => (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => toggleExpandedBooking(booking.id)}
                    className="block w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-900">{booking.summary}</div>
                      <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expandedBookingIds.includes(booking.id) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{formatRange(booking.start, booking.end)}</div>
                    {expandedBookingIds.includes(booking.id) ? (
                      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                        <div className="text-xs text-slate-600">Calendar: {booking.calendarSummary}</div>
                        {booking.description ? (
                          <div className="text-xs text-slate-500">{booking.description}</div>
                        ) : null}
                        {booking.htmlLink ? (
                          <a
                            href={booking.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="text-xs font-medium text-sky-600 underline"
                          >
                            Open in Google Calendar
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
          </div>
        )}
      </section>

      {/* Payments Section */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setPaymentsExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Lịch sử thanh toán" : "Payment History"}
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="/payments"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-sky-600 hover:underline"
            >
              {language === "vi" ? "Xem tất cả" : "View all"}
            </Link>
            <svg
              className={`h-5 w-5 text-slate-500 transition-transform ${paymentsExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {paymentsExpanded && (
          <div className="px-6 pb-6">
            {!client ? (
              <p className="text-sm text-slate-600">{loading ? "Loading..." : "Account information will appear here once loaded."}</p>
            ) : payments.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No recent payments found.</p>
            ) : (
              <div className="space-y-3">
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
          </div>
        )}
      </section>

      {/* Fines Section */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setFinesExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Vi phạm & Tiền phạt" : "Fines & Violations"}
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="/fines"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-sky-600 hover:underline"
            >
              {language === "vi" ? "Xem tất cả" : "View all"}
            </Link>
            <svg
              className={`h-5 w-5 text-slate-500 transition-transform ${finesExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {finesExpanded && (
          <div className="px-6 pb-6">
            {!client ? (
              <p className="text-sm text-slate-600">{loading ? "Loading..." : "Account information will appear here once loaded."}</p>
            ) : fines.length === 0 ? (
              <p className="text-sm text-green-600 italic">No violations found. Great job!</p>
            ) : (
              <div className="space-y-3">
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
          </div>
        )}
      </section>

      {/* Coins Section */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setCoinsExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Lịch sử Coins" : "Coins History"}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${coinsExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {coinsExpanded && (
          <div className="px-6 pb-6">
            {!client ? (
              <p className="text-sm text-slate-600">{loading ? "Loading..." : "Account information will appear here once loaded."}</p>
            ) : coinEntries.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No coin entries found.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">{coinEntries.length} entries total</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {language === "vi" ? "Số dư: " : "Balance: "}
                    <span className={currentCoins >= 0 ? "text-emerald-600" : "text-red-600"}>
                      {new Intl.NumberFormat().format(currentCoins)}
                    </span>
                  </span>
                </div>
                {(showAllCoins ? coinEntries : coinEntries.slice(0, 5)).map((entry, idx) => {
                  const amount = parseCoinAmount(entry.row["COINS"]);
                  const isPositive = amount > 0;
                  return (
                    <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="font-medium text-slate-900 truncate">
                            {entry.row["Sự kiện"] || "—"}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {entry.parsedTimestamp ? new Date(entry.parsedTimestamp).toLocaleDateString() : ""}
                            {` · ${formatResidentCoinsOperatorLabel(entry.row["Người thao tác"], activeEmail, language)}`}
                          </div>
                        </div>
                        <div className={`shrink-0 font-semibold ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                          {isPositive ? "+" : ""}{new Intl.NumberFormat().format(amount)}
                        </div>
                      </div>
                      {entry.row["Số Coins hiện có"] ? (
                        <div className="mt-1 text-right text-xs text-slate-400">
                          Balance: {entry.row["Số Coins hiện có"]}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {coinEntries.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllCoins((v) => !v)}
                    className="mt-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 w-full"
                  >
                    {showAllCoins ? "Show less" : `Show all (${coinEntries.length - 5} more)`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Account Security Section */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setSecurityExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {t("accountSecurity", "Account Security")}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${securityExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {securityExpanded && (
          <div className="border-t border-slate-200 px-6 pb-6 pt-4">
            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
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
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 font-medium">{passwordError}</div>
              )}
              {passwordSuccess && (
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 font-medium">{passwordSuccess}</div>
              )}
              <button
                type="submit"
                disabled={isChangingPassword}
                className="flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 transition-all"
              >
                {isChangingPassword ? t("changingPassword") : t("changePassword")}
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Preferences Section */}
      <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Tùy chọn" : "Preferences"}
        </h2>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {language === "vi" ? "Chọn ngôn ngữ hiển thị." : "Display language"}
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
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              {language === "vi" ? "Giao diện tối" : "Dark mode"}
            </p>
            <button
              type="button"
              onClick={toggleTheme}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${theme === "dark" ? "bg-slate-700" : "bg-slate-200"}`}
              role="switch"
              aria-checked={theme === "dark"}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${theme === "dark" ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="mt-8 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => setAboutExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Về ứng dụng" : "About"}
          </h2>
          <svg
            className={`h-5 w-5 text-slate-500 transition-transform ${aboutExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {aboutExpanded ? (
          <div className="px-6 pb-6">
            <p className="text-sm leading-relaxed text-slate-700">
              {language === "vi"
                ? "Đây là phiên bản thay thế cho ứng dụng web CozoroHome 7 năm tuổi vốn đã trở nên chậm chạp theo thời gian. Ứng dụng mới được xây dựng với hiệu suất cao, hệ thống tự động hóa tiên tiến và trải nghiệm sống hiện đại cho cư dân."
                : "This app is the replacement for the 7-year-old CozoroHome web app, which had become slow over time. It was built for speed, high automation, and a modern living experience for residents."}
            </p>
            <div className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
              {language === "vi" ? `Phiên bản ứng dụng: v${APP_VERSION}` : `App version: v${APP_VERSION}`}
            </div>
            <div className="mt-5 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-xl font-bold select-none">T</div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Dr. Trong Nguyen</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {language === "vi"
                    ? "Bác sĩ tại Việt Nam · Nhà phát triển AI · Vancouver, Canada"
                    : "Doctor in Vietnam · AI-driven Developer · Vancouver, Canada"}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {language === "vi"
                    ? "Người sáng lập CozoroHome vào năm 2019 với tầm nhìn xây dựng hệ thống nhà ở được tự động hóa cao, hướng đến chất lượng sống hiện đại và tiên tiến cho cư dân."
                    : "Founder of CozoroHome in 2019, with a vision of a highly automated co-living system that delivers a futuristic and high-quality living experience for residents."}
                </p>
                <a
                  href="https://www.facebook.com/nguyentrong265"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                  {language === "vi" ? "Kết nối với Dr. Trong" : "Connect with Dr. Trong"}
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      <AccountNoonFlappyBee />
    </div>
  );
}
