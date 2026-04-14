"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { parseContractEndDate } from "../lib/contract-utils";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
const API_TIMEOUT_MS = 6000;

type LaundryMachine = {
  id: string;
  calendarId: string;
  label: string;
  branchId: "D2" | "D7";
  type: "WASHER" | "DRYER";
  durationMinutes: number;
  cooldownMinutes: number;
  coinPrice: number;
  allowsFreeLaundry: boolean;
};

type LaundryAvailabilityDay = {
  date: string;
  slots: string[];
};

type LaundryAllowanceSummary = {
  branchId: "D2" | "D7";
  gender: string;
  floor: number | null;
  recordedMember: string;
  baseFreeUsesPerMonth: number;
  couponFreeUsesPerMonth: number;
  bonusWasherUsesPerMonth: number;
  bonusDryerUsesPerMonth: number;
  usedFreeLaundryThisMonth: number;
  remainingBaseFreeUses: number;
  remainingCouponFreeUses: number;
  remainingBonusWasherUses: number;
  remainingBonusDryerUses: number;
  currentCoinsBalance: number;
  reservedFutureCoinUses: number;
  availableCoinBalance: number;
  notes: string[];
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
  syncWarnings?: string[];
};

type AccountLockOverride = {
  unlocked?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  note?: string;
};

function getTimeZoneLabel(timeZone: string) {
  if (timeZone === "America/Vancouver") {
    return "Vancouver";
  }
  return "Vietnam";
}

function formatDateInTimeZone(value: string, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options
  }).format(new Date(value));
}

function formatTimeInTimeZone(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value));
}

function formatDateTimeInTimeZone(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value));
}

function isPastSlot(value: string) {
  return new Date(value).getTime() < Date.now();
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${minutes} minutes`;
  }

  if (remainder === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${hours}h ${remainder}m`;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const data = (await response.json()) as T;

    if (!response.ok) {
      const errorMessage =
        typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error
          : "Request failed";
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("API request timed out. Check that the API is running.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getBookingPaymentType(booking: LaundryBooking): "FREE_LAUNDRY" | "COINS" | "CASH" | "OTHER" {
  const haystack = `${booking.summary}\n${booking.description}\n${booking.location}`.toUpperCase();

  if (haystack.includes("FREE_LAUNDRY") || haystack.includes("FREE LAUNDRY")) {
    return "FREE_LAUNDRY";
  }
  if (haystack.includes("COINS") || haystack.includes("COIN")) {
    return "COINS";
  }
  if (haystack.includes("CASH")) {
    return "CASH";
  }
  return "OTHER";
}

function translateLaundryPaymentCode(
  code: string,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string
): string {
  if (!code || code === "-") {
    return "—";
  }
  switch (code) {
    case "FREE_LAUNDRY":
      return t("laundryPaymentCodeFreeLaundry");
    case "COINS":
      return t("laundryPaymentCodeCoins");
    case "CASH":
      return t("laundryPaymentCodeCash");
    case "OTHER":
      return t("laundryPaymentCodeOther");
    default:
      return code;
  }
}

function parseLooseDate(value: string | undefined): Date | null {
  return parseContractEndDate(value);
}

function getAccountStatus(client: Record<string, string> | null, override: AccountLockOverride | null): {
  isBlocked: boolean;
  blockReason: string | null;
  warnings: string[];
} {
  if (!client) return { isBlocked: false, blockReason: null, warnings: [] };

  const now = new Date();
  const MS_PER_DAY = 86400000;
  const BLOCK_GRACE_DAYS = 5;
  const WARN_DAYS_AHEAD = 30;

  const contractEnd = parseLooseDate(client["Ngày hết hạn hợp đồng"]);
  const paymentExpiry = parseLooseDate(client["Ngày hết hạn gói đã thanh toán"]);

  const warnings: string[] = [];
  let blockReason: string | null = null;

  if (contractEnd) {
    const diffDays = (now.getTime() - contractEnd.getTime()) / MS_PER_DAY;
    if (diffDays > BLOCK_GRACE_DAYS) {
      blockReason = `Hợp đồng đã hết hạn ${Math.floor(diffDays)} ngày. Liên hệ quản lý để gia hạn.`;
    } else if (diffDays > 0) {
      warnings.push(`Hợp đồng đã hết hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn. Vui lòng gia hạn trên trang chủ.`);
    } else if (-diffDays < WARN_DAYS_AHEAD) {
      const daysLeft = Math.ceil(-diffDays);
      warnings.push(`Hợp đồng sắp hết hạn vào ngày ${contractEnd.toLocaleDateString("vi-VN")} (còn ${daysLeft} ngày). Gia hạn ngay trên trang chủ để nhận Cozoro Coins: 3 tháng +10.000 · 6 tháng +25.000 · 12 tháng +50.000.`);
    }
  }

  if (!blockReason && paymentExpiry) {
    const diffDays = (now.getTime() - paymentExpiry.getTime()) / MS_PER_DAY;
    if (diffDays > BLOCK_GRACE_DAYS) {
      blockReason = `Tiền thuê quá hạn ${Math.floor(diffDays)} ngày. Vui lòng thanh toán để tiếp tục sử dụng dịch vụ.`;
    } else if (diffDays > 0) {
      warnings.push(`Tiền thuê quá hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn.`);
    } else if (-diffDays < WARN_DAYS_AHEAD) {
      warnings.push(`Gói thanh toán sắp hết hạn vào ngày ${paymentExpiry.toLocaleDateString("vi-VN")}.`);
    }
  }

  if (blockReason && override?.unlocked) {
    warnings.unshift(
      override.updatedBy
        ? `Tài khoản đã được mở khoá thủ công bởi ${override.updatedBy}.`
        : "Tài khoản đã được mở khoá thủ công bởi quản lý."
    );
    return { isBlocked: false, blockReason: null, warnings };
  }

  return { isBlocked: blockReason !== null, blockReason, warnings };
}

export function BookingsClient() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail, isLoggedIn, login } = usePortalSession();
  const [email, setEmail] = useState("");
  const [activeEmail, setActiveEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [clientRecord, setClientRecord] = useState<Record<string, string> | null>(null);
  const [accountLockOverride, setAccountLockOverride] = useState<AccountLockOverride | null>(null);
  const [branchId, setBranchId] = useState<"D2" | "D7" | "">("");
  const [coins, setCoins] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [allowance, setAllowance] = useState<LaundryAllowanceSummary | null>(null);
  const [machines, setMachines] = useState<LaundryMachine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [availability, setAvailability] = useState<LaundryAvailabilityDay[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"FREE_LAUNDRY" | "COINS" | "CASH" | "">("");
  const [couponCode, setCouponCode] = useState("");
  const [bookings, setBookings] = useState<LaundryBooking[]>([]);
  const [showAllBookings, setShowAllBookings] = useState(false);
  const [bookingCalendarFilter, setBookingCalendarFilter] = useState("all");
  const [bookingTimeFilter, setBookingTimeFilter] = useState<"all" | "future" | "past">("all");
  const [bookingYearFilter, setBookingYearFilter] = useState("all");
  const [bookingMonthFilter, setBookingMonthFilter] = useState("all");
  const [bookingDayFilter, setBookingDayFilter] = useState("all");
  const [bookingPaymentFilter, setBookingPaymentFilter] = useState<"all" | "FREE_LAUNDRY" | "COINS" | "CASH" | "OTHER">("all");
  const [bookingSortDirection, setBookingSortDirection] = useState<"desc" | "asc">("desc");
  const [refreshingAvailability, setRefreshingAvailability] = useState(false);
  const [acceptedLoadWarning, setAcceptedLoadWarning] = useState(false);
  const [acceptedBasketWarning, setAcceptedBasketWarning] = useState(false);
  const [showBookingHelp, setShowBookingHelp] = useState(false);
  const [showAllowanceDetails, setShowAllowanceDetails] = useState(false);
  const [bookingFiltersExpanded, setBookingFiltersExpanded] = useState(false);

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === selectedMachineId) ?? null,
    [machines, selectedMachineId]
  );
  const selectedDayAvailability = useMemo(
    () => availability.find((day) => day.date === selectedDate) ?? null,
    [availability, selectedDate]
  );
  const remainingFreeUsesForSelectedMachine = useMemo(() => {
    if (!allowance || !selectedMachine) {
      return 0;
    }

    const bonusRemaining =
      selectedMachine.type === "WASHER"
        ? allowance.remainingBonusWasherUses
        : allowance.remainingBonusDryerUses;
    return allowance.remainingBaseFreeUses + bonusRemaining;
  }, [allowance, selectedMachine]);
  const canPayWithCoins = useMemo(
    () => Boolean(selectedMachine && allowance && allowance.availableCoinBalance >= selectedMachine.coinPrice),
    [allowance, selectedMachine]
  );
  const automaticPaymentMethod = useMemo(() => {
    if (!selectedMachine) {
      return "-";
    }
    if (selectedMachine.allowsFreeLaundry && remainingFreeUsesForSelectedMachine > 0) {
      return "FREE_LAUNDRY";
    }
    if (canPayWithCoins) {
      return "COINS";
    }
    return "CASH";
  }, [canPayWithCoins, remainingFreeUsesForSelectedMachine, selectedMachine]);
  const paymentOptions = useMemo(() => {
    if (!selectedMachine) {
      return [] as Array<{ value: "FREE_LAUNDRY" | "COINS" | "CASH"; label: string; disabled: boolean }>;
    }

    return [
      {
        value: "FREE_LAUNDRY" as const,
        label: t("laundryPayOptionFreeLaundry"),
        disabled: !selectedMachine.allowsFreeLaundry || remainingFreeUsesForSelectedMachine <= 0
      },
      {
        value: "COINS" as const,
        label: t("laundryPayOptionCoins"),
        disabled: !canPayWithCoins
      },
      {
        value: "CASH" as const,
        label: t("laundryPayOptionCash"),
        disabled: false
      }
    ];
  }, [canPayWithCoins, remainingFreeUsesForSelectedMachine, selectedMachine, t]);
  const paymentRuleNote = useMemo(() => {
    if (!selectedMachine) {
      return t("laundryPaymentRuleSelectMachine");
    }

    if (selectedMachine.id === "d7-washer-paid") {
      return t("laundryPaymentRuleD7PaidWhirlpool");
    }

    if (selectedMachine.branchId === "D7") {
      return t("laundryPaymentRuleD7General");
    }

    return t("laundryPaymentRuleDefault");
  }, [selectedMachine, t]);
  const bookingCalendarOptions = useMemo(
    () => Array.from(new Set(bookings.map((booking) => booking.calendarSummary))).sort(),
    [bookings]
  );
  const bookingYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          bookings.map((booking) => {
            const date = new Date(booking.start);
            return Number.isNaN(date.getTime()) ? null : String(date.getFullYear());
          }).filter((value): value is string => Boolean(value))
        )
      ).sort(),
    [bookings]
  );
  const bookingMonthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          bookings.map((booking) => {
            const date = new Date(booking.start);
            return Number.isNaN(date.getTime()) ? null : String(date.getMonth() + 1).padStart(2, "0");
          }).filter((value): value is string => Boolean(value))
        )
      ).sort(),
    [bookings]
  );
  const bookingDayOptions = useMemo(
    () =>
      Array.from(
        new Set(
          bookings.map((booking) => {
            const date = new Date(booking.start);
            return Number.isNaN(date.getTime()) ? null : String(date.getDate()).padStart(2, "0");
          }).filter((value): value is string => Boolean(value))
        )
      ).sort(),
    [bookings]
  );
  const filteredBookings = useMemo(() => {
    const now = Date.now();
    return bookings
      .filter((booking) => {
        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end).getTime();
        const paymentType = getBookingPaymentType(booking);
        const yearMatches =
          bookingYearFilter === "all" ||
          (!Number.isNaN(bookingStart.getTime()) && String(bookingStart.getFullYear()) === bookingYearFilter);
        const monthMatches =
          bookingMonthFilter === "all" ||
          (!Number.isNaN(bookingStart.getTime()) &&
            String(bookingStart.getMonth() + 1).padStart(2, "0") === bookingMonthFilter);
        const dayMatches =
          bookingDayFilter === "all" ||
          (!Number.isNaN(bookingStart.getTime()) &&
            String(bookingStart.getDate()).padStart(2, "0") === bookingDayFilter);
        const paymentMatches = bookingPaymentFilter === "all" || paymentType === bookingPaymentFilter;
        const calendarMatches =
          bookingCalendarFilter === "all" || booking.calendarSummary === bookingCalendarFilter;
        const timeMatches =
          bookingTimeFilter === "all" ||
          (bookingTimeFilter === "future" ? bookingEnd >= now : bookingEnd < now);
        return yearMatches && monthMatches && dayMatches && paymentMatches && calendarMatches && timeMatches;
      })
      .sort((left, right) =>
        bookingSortDirection === "desc"
          ? right.start.localeCompare(left.start)
          : left.start.localeCompare(right.start)
      );
  }, [
    bookingCalendarFilter,
    bookingDayFilter,
    bookingMonthFilter,
    bookingPaymentFilter,
    bookingSortDirection,
    bookingTimeFilter,
    bookingYearFilter,
    bookings
  ]);
  const visibleBookings = useMemo(
    () => (showAllBookings ? filteredBookings : filteredBookings.slice(0, 10)),
    [filteredBookings, showAllBookings]
  );
  const { isBlocked, blockReason, warnings } = useMemo(
    () => getAccountStatus(clientRecord, accountLockOverride),
    [accountLockOverride, clientRecord]
  );

  async function loadBookings(emailValue?: string, shouldRefresh = false) {
    const trimmedEmail = (emailValue ?? activeEmail).trim();
    if (!trimmedEmail) {
      return;
    }

    const result = await fetchJson<{ bookings: LaundryBooking[] }>(
      `${API_BASE_URL}/laundry/bookings?email=${encodeURIComponent(trimmedEmail)}${
        shouldRefresh ? "&refresh=true" : ""
      }`
    );
    setBookings(result.bookings ?? []);
  }

  async function loadAvailability(machineId: string, emailValue?: string, shouldRefresh = false) {
    const trimmedEmail = (emailValue ?? activeEmail).trim();
    if (!trimmedEmail || !machineId) {
      setAvailability([]);
      setSelectedDate("");
      setSelectedStart("");
      return;
    }

    const result = await fetchJson<{ machine: LaundryMachine; availability: LaundryAvailabilityDay[] }>(
      `${API_BASE_URL}/laundry/availability?email=${encodeURIComponent(trimmedEmail)}&machineId=${encodeURIComponent(
        machineId
      )}${shouldRefresh ? "&refresh=true" : ""}`
    );
    setAvailability(result.availability ?? []);
    const firstDate = result.availability.find((day) => day.slots.length > 0)?.date ?? result.availability[0]?.date ?? "";
    setSelectedDate((current) => {
      const stillValid = result.availability.some((day) => day.date === current);
      return stillValid ? current : firstDate;
    });
    setSelectedStart("");
  }

  async function loadContext() {
    const trimmedEmail = email.trim();
    setActiveEmail(trimmedEmail);
    if (!trimmedEmail) {
      setMessage("Enter your email first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const machineResult = await fetchJson<{
        branchId: "D2" | "D7";
        coins: string;
        allowance: LaundryAllowanceSummary;
        machines: LaundryMachine[];
        timeZone: string;
      }>(`${API_BASE_URL}/laundry/machines?email=${encodeURIComponent(trimmedEmail)}`);

      setBranchId(machineResult.branchId);
      setCoins(machineResult.coins ?? "");
      setTimeZone(machineResult.timeZone || "Asia/Ho_Chi_Minh");
      setAllowance(machineResult.allowance ?? null);
      setMachines(machineResult.machines ?? []);
      login(trimmedEmail);
      const nextMachineId = machineResult.machines[0]?.id ?? "";
      setSelectedMachineId(nextMachineId);
      setShowAllBookings(false);
      setBookingCalendarFilter("all");
      setBookingTimeFilter("all");
      setBookingYearFilter("all");
      setBookingMonthFilter("all");
      setBookingDayFilter("all");
      setBookingPaymentFilter("all");
      setBookingSortDirection("desc");
      const [bookingsResult, availabilityResult, clientResult, overrideResult] = await Promise.allSettled([
        loadBookings(trimmedEmail),
        nextMachineId ? loadAvailability(nextMachineId, trimmedEmail, true) : Promise.resolve(),
        fetchJson<Record<string, string>>(`${API_BASE_URL}/clients?email=${encodeURIComponent(trimmedEmail)}`),
        fetchJson<{ override?: AccountLockOverride | null }>(`${API_BASE_URL}/account-lock-override?email=${encodeURIComponent(trimmedEmail)}`)
      ]);

      if (clientResult.status === "fulfilled") {
        setClientRecord(clientResult.value);
      }
      if (overrideResult.status === "fulfilled") {
        setAccountLockOverride(overrideResult.value.override ?? null);
      }

      if (bookingsResult.status === "rejected" || availabilityResult.status === "rejected") {
        const issues = [
          bookingsResult.status === "rejected"
            ? getErrorMessage(bookingsResult.reason, "Unable to load bookings.")
            : null,
          availabilityResult.status === "rejected"
            ? getErrorMessage(availabilityResult.reason, "Unable to load availability.")
            : null
        ].filter(Boolean);
        setMessage(`Booking options loaded with partial data. ${issues.join(" ")}`.trim());
      } else {
        setMessage("Laundry booking options loaded.");
      }
    } catch (error) {
      setBranchId("");
      setCoins("");
      setTimeZone("Asia/Ho_Chi_Minh");
      setAllowance(null);
      setMachines([]);
      setSelectedMachineId("");
      setAvailability([]);
      setBookings([]);
      setAccountLockOverride(null);
      setMessage(error instanceof Error ? error.message : "Unable to load laundry booking options.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionEmail.trim()) {
      return;
    }

    const normalizedSessionEmail = sessionEmail.trim().toLowerCase();
    const normalizedActiveEmail = activeEmail.trim().toLowerCase();
    const alreadyAttemptedForSession = normalizedActiveEmail === normalizedSessionEmail;

    if (alreadyAttemptedForSession || loading) {
      return;
    }

    if (email !== sessionEmail) {
      setEmail(sessionEmail);
      return;
    }

    void loadContext();
  }, [activeEmail, allowance, bookings.length, email, loading, machines.length, sessionEmail]);

  useEffect(() => {
    if (!selectedMachineId || !activeEmail.trim()) {
      return;
    }

    void loadAvailability(selectedMachineId, activeEmail);
  }, [activeEmail, selectedMachineId]);

  useEffect(() => {
    const nextSlot =
      selectedDayAvailability?.slots.find((slot) => !isPastSlot(slot)) ??
      selectedDayAvailability?.slots[0] ??
      "";
    setSelectedStart(nextSlot);
  }, [selectedDayAvailability]);

  useEffect(() => {
    if (automaticPaymentMethod === "-") {
      setSelectedPaymentMethod("");
      return;
    }

    const selectedOption = paymentOptions.find((option) => option.value === selectedPaymentMethod);
    if (!selectedOption || selectedOption.disabled) {
      setSelectedPaymentMethod(automaticPaymentMethod as "FREE_LAUNDRY" | "COINS" | "CASH");
    }
  }, [automaticPaymentMethod, paymentOptions, selectedPaymentMethod]);

  useEffect(() => {
    setAcceptedLoadWarning(false);
    setAcceptedBasketWarning(false);
  }, [selectedMachineId, selectedDate, selectedStart]);

  async function refreshAvailabilityNow() {
    if (!selectedMachineId || !activeEmail.trim()) {
      setMessage("Load your booking options first.");
      return;
    }

    setRefreshingAvailability(true);
    setMessage("");

    try {
      await Promise.all([
        loadAvailability(selectedMachineId, activeEmail, true),
        loadBookings(activeEmail, true)
      ]);
      setMessage("Availability refreshed from Google Calendar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh laundry availability.");
    } finally {
      setRefreshingAvailability(false);
    }
  }

  async function createBooking() {
    if (!selectedMachineId || !selectedStart || !activeEmail.trim()) {
      setMessage("Choose a machine and an available time.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const booking = await fetchJson<LaundryBooking>(`${API_BASE_URL}/laundry/bookings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail.trim(),
          machineId: selectedMachineId,
          start: selectedStart,
          paymentMethod: selectedPaymentMethod || automaticPaymentMethod,
          couponCode: couponCode.trim() || undefined
        })
      });

      await Promise.all([
        loadAvailability(selectedMachineId, activeEmail, true),
        loadBookings(activeEmail, true)
      ]);
      setMessage(
        booking.syncWarnings?.length
          ? `Laundry booking created and blocked on the machine calendar. ${booking.syncWarnings.join(" ")}`
          : "Laundry booking created and blocked on the machine calendar."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelBooking(booking: LaundryBooking) {
    const start = new Date(booking.start);
    const now = new Date();
    const oneHourMs = 60 * 60 * 1000;

    if (start.getTime() - now.getTime() < oneHourMs) {
      alert(
        language === "vi"
          ? "Bạn chỉ có thể hủy lịch trước giờ bắt đầu ít nhất 1 tiếng."
          : "Cancellations are only allowed at least 1 hour before the start time."
      );
      return;
    }

    const confirmMessage =
      language === "vi"
        ? `Bạn có chắc chắn muốn hủy lịch đặt ${booking.summary} vào lúc ${formatDateTimeInTimeZone(
            booking.start,
            timeZone
          )} không? Coins đã dùng sẽ được hoàn lại.`
        : `Are you sure you want to cancel the booking for ${booking.summary} at ${formatDateTimeInTimeZone(
            booking.start,
            timeZone
          )}? Used coins will be refunded.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      await fetchJson(`${API_BASE_URL}/laundry/bookings/${booking.id}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail.trim(),
          calendarId: booking.calendarId
        })
      });

      setMessage(
        language === "vi" ? "Đã hủy lịch đặt thành công." : "Laundry booking cancelled successfully."
      );

      await Promise.all([
        loadBookings(activeEmail, true),
        loadContext() // Refresh coins and allowance
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to cancel booking.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">{t("laundryBookingsTitle")}</h1>
          <button
            type="button"
            onClick={() => setShowBookingHelp((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-semibold text-slate-700"
            aria-label="How laundry booking works"
          >
            ?
          </button>
        </div>
        {showBookingHelp && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
            {language === "vi"
              ? "Chọn máy theo chi nhánh của bạn, rồi đặt một khung giờ còn trống trong 7 ngày tới. Sau khi đặt, khung giờ đó sẽ bị khóa trên Google Calendar."
              : "Choose your branch machine, then book an open time in the next 7 days. Once booked, that slot is blocked in Google Calendar."}
          </div>
        )}
      </section>

      {isBlocked && blockReason ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <div className="font-semibold">{language === "vi" ? "Tài khoản bị tạm khóa dịch vụ" : "Service access restricted"}</div>
          <div className="mt-1">{blockReason}</div>
        </section>
      ) : warnings.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <div className="font-semibold">{language === "vi" ? "Lưu ý tài khoản" : "Account notice"}</div>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-6 md:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Tạo lịch đặt" : "Create Booking"}
          </h2>

          <div className="mt-4 grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => void loadContext()}
                disabled={loading || !sessionEmail.trim()}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
              >
                {loading ? (language === "vi" ? "Đang tải..." : "Loading...") : t("loadBookingOptions")}
              </button>
              <button
                type="button"
                onClick={() => void refreshAvailabilityNow()}
                disabled={refreshingAvailability || !selectedMachineId}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 sm:w-auto"
              >
                {refreshingAvailability ? (language === "vi" ? "Đang làm mới..." : "Refreshing...") : (language === "vi" ? "Làm mới lịch trống" : "Refresh availability")}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{branchId || "-"}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Coins</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{coins || "-"}</div>
              </div>
            </div>

            {(timeZone || allowance) ? (
              <div className="rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAllowanceDetails((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium text-slate-700">
                    {language === "vi" ? "Chi tiết & Ưu đãi" : "Details & Allowance"}
                  </span>
                  <svg
                    className={`h-4 w-4 text-slate-500 transition-transform ${showAllowanceDetails ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAllowanceDetails && (
                  <div className="border-t border-slate-200 px-4 pb-4 pt-3 text-sm text-slate-700 space-y-1">
                    {timeZone ? (
                      <div>
                        <span className="text-slate-500">{language === "vi" ? "Múi giờ" : "Timezone"}:</span>{" "}
                        <span className="font-medium">{getTimeZoneLabel(timeZone)} ({timeZone})</span>
                      </div>
                    ) : null}
                    {allowance ? (
                      <>
                        <div className="pt-1 font-medium text-slate-900">{language === "vi" ? "Ưu đãi giặt miễn phí hằng tháng" : "Monthly Free Laundry"}</div>
                        <div>
                          {language === "vi" ? "Hạng thành viên" : "Recorded member"}: <span className="font-medium">{allowance.recordedMember}</span>
                        </div>
                        <div>
                          {language === "vi" ? "Lượt miễn phí cơ bản" : "Base free uses"}: <span className="font-medium">{allowance.baseFreeUsesPerMonth}</span>
                        </div>
                        <div>
                          {language === "vi" ? "Đã dùng tháng này" : "Used free laundry this month"}: <span className="font-medium">{allowance.usedFreeLaundryThisMonth}</span>
                        </div>
                        <div>
                          {language === "vi" ? "Số lượt miễn phí còn lại" : "Remaining free laundry"}:{" "}
                          <span className="font-medium">
                            {allowance.branchId === "D2"
                              ? (language === "vi"
                                ? `${allowance.remainingBaseFreeUses} cơ bản+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} giặt thêm`
                                : `${allowance.remainingBaseFreeUses} base+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} washer bonus`)
                              : (language === "vi"
                                ? `${allowance.remainingBaseFreeUses} cơ bản+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} giặt thêm / ${allowance.remainingBonusDryerUses} sấy thêm`
                                : `${allowance.remainingBaseFreeUses} base+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} washer bonus / ${allowance.remainingBonusDryerUses} dryer bonus`)}
                          </span>
                        </div>
                        <div>
                          {language === "vi" ? "Số lượt coupon trong tháng" : "Coupon free uses this month"}: <span className="font-medium">{allowance.couponFreeUsesPerMonth}</span>
                        </div>
                        <div>
                          {language === "vi" ? "Khuyến mãi thành viên" : "Member bonus"}:{" "}
                          <span className="font-medium">
                            {allowance.branchId === "D2"
                              ? (language === "vi" ? `${allowance.bonusWasherUsesPerMonth} giặt` : `${allowance.bonusWasherUsesPerMonth} washer`)
                              : (language === "vi" ? `${allowance.bonusWasherUsesPerMonth} giặt / ${allowance.bonusDryerUsesPerMonth} sấy` : `${allowance.bonusWasherUsesPerMonth} washer / ${allowance.bonusDryerUsesPerMonth} dryer`)}
                          </span>
                        </div>
                        <div>
                          {language === "vi" ? "Số dư coins sau đặt lệnh" : "Available coins after future bookings"}:{" "}
                          <span className="font-medium">{allowance.availableCoinBalance}</span>
                        </div>
                        {allowance.floor ? (
                          <div>
                            {language === "vi" ? "Tầng" : "Floor"}: <span className="font-medium">{allowance.floor}</span>
                          </div>
                        ) : null}
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                          {allowance.notes.map((note) => {
                            const parts = note.split(" / ");
                            const display = language === "vi" && parts.length >= 2 ? parts.slice(1).join(" / ") : parts[0] ?? note;
                            return <li key={note}>{display}</li>;
                          })}
                        </ul>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "Máy" : "Machine"}
              <select
                value={selectedMachineId}
                onChange={(event) => setSelectedMachineId(event.target.value)}
                disabled={loading || machines.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {machines.length === 0 ? <option value="">{language === "vi" ? "Không có máy" : "No machines available"}</option> : null}
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.label} ({formatDuration(machine.durationMinutes)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "Ngày" : "Date"}
              <select
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                disabled={!selectedMachineId || availability.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {availability.length === 0 ? <option value="">No dates loaded</option> : null}
                {availability.map((day) => (
                  <option key={day.date} value={day.date}>
                    {formatDateInTimeZone(`${day.date}T12:00:00.000Z`, timeZone)}{" "}
                    {day.slots.length === 0 ? "(Fully booked)" : `(${day.slots.length} open)`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "Giờ còn trống" : "Available Time"}
              <select
                value={selectedStart}
                onChange={(event) => setSelectedStart(event.target.value)}
                disabled={!selectedDayAvailability || selectedDayAvailability.slots.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {!selectedDayAvailability || selectedDayAvailability.slots.length === 0 ? (
                  <option value="">No open times on this date</option>
                ) : null}
                {selectedDayAvailability?.slots.map((slot) => (
                  <option key={slot} value={slot} disabled={isPastSlot(slot)}>
                    {formatTimeInTimeZone(slot, timeZone)}
                    {isPastSlot(slot) ? " (Unavailable)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">{t("laundryAutoPaymentTitle")}</div>
              <div className="mt-2 text-sm text-slate-900">
                {automaticPaymentMethod === "-"
                  ? "—"
                  : translateLaundryPaymentCode(automaticPaymentMethod, t)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{t("laundryPaymentPriorityOrder")}</div>
              <div className="mt-2 text-xs text-slate-500">{paymentRuleNote}</div>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              {t("laundryPayLabel")}
              <select
                value={selectedPaymentMethod}
                onChange={(event) =>
                  setSelectedPaymentMethod(event.target.value as "FREE_LAUNDRY" | "COINS" | "CASH" | "")
                }
                disabled={!selectedMachine}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {!selectedMachine ? <option value="">{t("laundrySelectMachineFirst")}</option> : null}
                {paymentOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                    {option.value === automaticPaymentMethod ? t("laundrySuffixRecommended") : ""}
                    {option.disabled ? t("laundrySuffixUnavailable") : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "Mã ưu đãi" : "Coupon"}
              <input
                type="text"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder={t("laundryCouponPlaceholder")}
              />
            </label>

            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">{t("laundryBookingSummaryTitle")}</div>
              <div className="mt-2">
                {t("laundrySummaryMachine")} {selectedMachine?.label ?? "—"}
              </div>
              <div className="mt-1">
                {t("laundrySummaryDuration")}{" "}
                {selectedMachine ? formatDuration(selectedMachine.durationMinutes) : "—"}
              </div>
              <div className="mt-1">
                {t("laundrySummaryCooldown")}{" "}
                {selectedMachine ? formatDuration(selectedMachine.cooldownMinutes) : "—"}
              </div>
              <div className="mt-1">
                {t("laundrySummaryPayment")}{" "}
                {translateLaundryPaymentCode(
                  selectedPaymentMethod || (automaticPaymentMethod === "-" ? "" : automaticPaymentMethod),
                  t
                )}
              </div>
              <div className="mt-1">
                {t("laundrySummaryCoupon")} {couponCode.trim() ? couponCode : "—"}
              </div>
              <div className="mt-1">
                {t("laundrySummaryTime")}{" "}
                {selectedStart ? formatDateTimeInTimeZone(selectedStart, timeZone) : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">
                {language === "vi" ? "Trước khi đặt lịch" : "Before you book"}
              </div>
              <label className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={acceptedLoadWarning}
                  onChange={(event) => setAcceptedLoadWarning(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  {language === "vi"
                    ? "Máy chỉ hoạt động tốt nếu lượng đồ nhỏ hơn hoặc bằng 2/3 thể tích lồng giặt."
                    : "The machine only works properly if the laundry load is less than or equal to 2/3 of the drum capacity."}
                </span>
              </label>
              <label className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={acceptedBasketWarning}
                  onChange={(event) => setAcceptedBasketWarning(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  {language === "vi"
                    ? "Tôi sẽ cất giỏ đựng đồ về lại phòng giặt ngay sau khi sử dụng."
                    : "I will return the laundry basket to the laundry room immediately after use."}
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void createBooking()}
              disabled={
                submitting ||
                isBlocked ||
                !selectedMachineId ||
                !selectedStart ||
                isPastSlot(selectedStart) ||
                !acceptedLoadWarning ||
                !acceptedBasketWarning
              }
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? (language === "vi" ? "Đang đặt lịch..." : "Booking...") : t("bookLaundrySlot")}
            </button>

            {message ? <p className="text-sm text-slate-700">{message}</p> : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {language === "vi" ? "Các máy khả dụng" : "Available Machines"}
            </h2>
            <div className="mt-4 space-y-3">
              {machines.length === 0 ? <p className="text-sm text-slate-600">Load your email to see your branch machines.</p> : null}
              {machines.map((machine) => (
                <div key={machine.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-medium text-slate-900">{machine.label}</div>
                  <div className="mt-1 text-sm text-slate-600">
                      {machine.branchId} | {machine.type} | {formatDuration(machine.durationMinutes)} cycle | {formatDuration(machine.cooldownMinutes)} cooldown
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {language === "vi" ? "Lịch đặt của tôi" : "My bookings"}
              </h2>
              {bookings.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setBookingFiltersExpanded((current) => !current)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  {bookingFiltersExpanded ? t("laundryBookingFiltersHide") : t("laundryBookingFiltersShow")}
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-4">
              {bookings.length > 0 && bookingFiltersExpanded ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block text-sm font-medium text-slate-700">
                    {t("laundryBookingsFilterCalendar")}
                    <select
                      value={bookingCalendarFilter}
                      onChange={(event) => {
                        setBookingCalendarFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("laundryAllCalendars")}</option>
                      {bookingCalendarOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("laundryBookingsFilterTime")}
                    <select
                      value={bookingTimeFilter}
                      onChange={(event) => {
                        setBookingTimeFilter(event.target.value as "all" | "future" | "past");
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("laundryAllBookings")}</option>
                      <option value="future">{t("laundryTimeFutureOnly")}</option>
                      <option value="past">{t("laundryTimePastOnly")}</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("yearFilterLabel")}
                    <select
                      value={bookingYearFilter}
                      onChange={(event) => {
                        setBookingYearFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("allYears")}</option>
                      {bookingYearOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("monthFilterLabel")}
                    <select
                      value={bookingMonthFilter}
                      onChange={(event) => {
                        setBookingMonthFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("allMonths")}</option>
                      {bookingMonthOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("laundryBookingsFilterDate")}
                    <select
                      value={bookingDayFilter}
                      onChange={(event) => {
                        setBookingDayFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("laundryAllDates")}</option>
                      {bookingDayOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("laundryBookingsFilterPayment")}
                    <select
                      value={bookingPaymentFilter}
                      onChange={(event) => {
                        setBookingPaymentFilter(
                          event.target.value as "all" | "FREE_LAUNDRY" | "COINS" | "CASH" | "OTHER"
                        );
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">{t("laundryAllPaymentTypes")}</option>
                      <option value="FREE_LAUNDRY">{t("laundryPaymentFilterFree")}</option>
                      <option value="COINS">{t("laundryPaymentFilterCoins")}</option>
                      <option value="CASH">{t("laundryPaymentFilterCash")}</option>
                      <option value="OTHER">{t("laundryPaymentFilterOther")}</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    {t("laundryBookingsFilterSort")}
                    <select
                      value={bookingSortDirection}
                      onChange={(event) => {
                        setBookingSortDirection(event.target.value as "desc" | "asc");
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="desc">{t("laundrySortLatestFirst")}</option>
                      <option value="asc">{t("laundrySortOldestFirst")}</option>
                    </select>
                  </label>
                </div>
              ) : null}

              {filteredBookings.length === 0 ? (
                <p className="text-sm text-slate-600">{t("laundryNoMatchingBookings")}</p>
              ) : null}

              {visibleBookings.map((booking) => (
                <div key={booking.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-medium text-slate-900">{booking.summary}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {formatDateTimeInTimeZone(booking.start, timeZone)} to{" "}
                    {formatDateTimeInTimeZone(booking.end, timeZone)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">Calendar: {booking.calendarSummary}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {t("laundrySummaryPayment")}{" "}
                    {translateLaundryPaymentCode(getBookingPaymentType(booking), t)}
                  </div>
                  {booking.htmlLink ? (
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <a
                        href={booking.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-slate-900 underline"
                      >
                        Open in Google Calendar
                      </a>
                      
                      {new Date(booking.end).getTime() > Date.now() && (
                        <button
                          type="button"
                          onClick={() => void cancelBooking(booking)}
                          disabled={submitting}
                          className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {language === "vi" ? "Hủy lịch" : "Cancel booking"}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}

              {filteredBookings.length > 10 ? (
                <button
                  type="button"
                  onClick={() => setShowAllBookings((current) => !current)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  {showAllBookings
                    ? "Show fewer bookings"
                    : `Show all bookings (${filteredBookings.length})`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
