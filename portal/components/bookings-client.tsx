"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
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

export function BookingsClient() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail, isLoggedIn, login } = usePortalSession();
  const [email, setEmail] = useState("");
  const [activeEmail, setActiveEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
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
        label: "Free laundry",
        disabled: !selectedMachine.allowsFreeLaundry || remainingFreeUsesForSelectedMachine <= 0
      },
      {
        value: "COINS" as const,
        label: "Pay by coins",
        disabled: !canPayWithCoins
      },
      {
        value: "CASH" as const,
        label: "Pay by cash",
        disabled: false
      }
    ];
  }, [canPayWithCoins, remainingFreeUsesForSelectedMachine, selectedMachine]);
  const paymentRuleNote = useMemo(() => {
    if (!selectedMachine) {
      return "Select a machine to see its allowed payment methods.";
    }

    if (selectedMachine.id === "d7-washer-paid") {
      return "Giáº·t D7 paid Whirlpool only accepts cash or coins.";
    }

    if (selectedMachine.branchId === "D7") {
      return "This D7 machine accepts free laundry, coins, or cash when available.";
    }

    return "Payment methods depend on your allowance and available coins.";
  }, [selectedMachine]);
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
      setActiveEmail(trimmedEmail);
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
      const [bookingsResult, availabilityResult] = await Promise.allSettled([
        loadBookings(trimmedEmail),
        nextMachineId ? loadAvailability(nextMachineId, trimmedEmail, true) : Promise.resolve()
      ]);

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
    const alreadyLoadedForSession =
      normalizedActiveEmail === normalizedSessionEmail && (machines.length > 0 || allowance !== null || bookings.length > 0);

    if (alreadyLoadedForSession || loading) {
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

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{t("laundryBookingsTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {language === "vi"
            ? "Chá»n mÃ¡y theo chi nhÃ¡nh cá»§a báº¡n, rá»“i Ä‘áº·t má»™t khung giá» cÃ²n trá»‘ng trong 7 ngÃ y tá»›i. Sau khi Ä‘áº·t, khung giá» Ä‘Ã³ sáº½ bá»‹ khÃ³a trÃªn Google Calendar."
            : "Choose your branch machine, then book an open time in the next 7 days. Once booked, that slot is blocked in Google Calendar."}
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {language === "vi" ? "Táº¡o lá»‹ch Ä‘áº·t" : "Create Booking"}
          </h2>

          <div className="mt-4 grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => void loadContext()}
                disabled={loading || !sessionEmail.trim()}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
              >
                {loading ? (language === "vi" ? "Äang táº£i..." : "Loading...") : t("loadBookingOptions")}
              </button>
              <button
                type="button"
                onClick={() => void refreshAvailabilityNow()}
                disabled={refreshingAvailability || !selectedMachineId}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 sm:w-auto"
              >
                {refreshingAvailability ? (language === "vi" ? "Äang lÃ m má»›i..." : "Refreshing...") : (language === "vi" ? "LÃ m má»›i lá»‹ch trá»‘ng" : "Refresh availability")}
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
              <div className="rounded-xl bg-slate-50 p-4 md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timezone</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {getTimeZoneLabel(timeZone)} ({timeZone})
                </div>
              </div>
            </div>

            {allowance ? (
              <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                <div className="font-medium text-slate-900">Monthly Free Laundry</div>
                <div className="mt-2">
                  Recorded member: <span className="font-medium">{allowance.recordedMember}</span>
                </div>
                <div className="mt-1">
                  Base free uses: <span className="font-medium">{allowance.baseFreeUsesPerMonth}</span>
                </div>
                <div className="mt-1">
                  Used free laundry this month: <span className="font-medium">{allowance.usedFreeLaundryThisMonth}</span>
                </div>
                <div className="mt-1">
                  Remaining free laundry:{" "}
                  <span className="font-medium">
                    {allowance.branchId === "D2"
                      ? `${allowance.remainingBaseFreeUses} base+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} washer bonus`
                      : `${allowance.remainingBaseFreeUses} base+coupon / ${allowance.remainingCouponFreeUses} coupon / ${allowance.remainingBonusWasherUses} washer bonus / ${allowance.remainingBonusDryerUses} dryer bonus`}
                  </span>
                </div>
                <div className="mt-1">
                  Coupon free uses this month: <span className="font-medium">{allowance.couponFreeUsesPerMonth}</span>
                </div>
                <div className="mt-1">
                  Member bonus:{" "}
                  <span className="font-medium">
                    {allowance.branchId === "D2"
                      ? `${allowance.bonusWasherUsesPerMonth} washer`
                      : `${allowance.bonusWasherUsesPerMonth} washer / ${allowance.bonusDryerUsesPerMonth} dryer`}
                  </span>
                </div>
                <div className="mt-1">
                  Available coins after future bookings:{" "}
                  <span className="font-medium">{allowance.availableCoinBalance}</span>
                </div>
                {allowance.floor ? (
                  <div className="mt-1">
                    Floor: <span className="font-medium">{allowance.floor}</span>
                  </div>
                ) : null}
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
                  {allowance.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "MÃ¡y" : "Machine"}
              <select
                value={selectedMachineId}
                onChange={(event) => setSelectedMachineId(event.target.value)}
                disabled={loading || machines.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {machines.length === 0 ? <option value="">No machines available</option> : null}
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.label} ({formatDuration(machine.durationMinutes)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "NgÃ y" : "Date"}
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
              {language === "vi" ? "Giá» cÃ²n trá»‘ng" : "Available Time"}
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
              <div className="font-medium text-slate-900">Automatic Payment Type</div>
              <div className="mt-2 text-sm text-slate-900">{automaticPaymentMethod}</div>
              <div className="mt-1 text-xs text-slate-500">
                Order: free laundry first, then coins if available, then cash.
              </div>
              <div className="mt-2 text-xs text-slate-500">{paymentRuleNote}</div>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Payment
              <select
                value={selectedPaymentMethod}
                onChange={(event) =>
                  setSelectedPaymentMethod(event.target.value as "FREE_LAUNDRY" | "COINS" | "CASH" | "")
                }
                disabled={!selectedMachine}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {!selectedMachine ? <option value="">Select a machine first</option> : null}
                {paymentOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                    {option.value === automaticPaymentMethod ? " (Recommended)" : ""}
                    {option.disabled ? " (Unavailable)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {language === "vi" ? "MÃ£ Æ°u Ä‘Ã£i" : "Coupon"}
              <input
                type="text"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Optional coupon code"
              />
            </label>

            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Booking Summary</div>
              <div className="mt-2">
                Machine: {selectedMachine?.label ?? "-"}
              </div>
              <div className="mt-1">
                Duration: {selectedMachine ? formatDuration(selectedMachine.durationMinutes) : "-"}
              </div>
              <div className="mt-1">Payment: {selectedPaymentMethod || automaticPaymentMethod}</div>
              <div className="mt-1">Coupon: {couponCode || "-"}</div>
              <div className="mt-1">
                Time: {selectedStart ? formatDateTimeInTimeZone(selectedStart, timeZone) : "-"}
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
                    {machine.branchId} â€¢ {machine.type} â€¢ {formatDuration(machine.durationMinutes)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {language === "vi" ? "Lịch đặt của tôi" : "My bookings"}
            </h2>
            <div className="mt-4 space-y-4">
              {bookings.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Calendar
                    <select
                      value={bookingCalendarFilter}
                      onChange={(event) => {
                        setBookingCalendarFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All calendars</option>
                      {bookingCalendarOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Time
                    <select
                      value={bookingTimeFilter}
                      onChange={(event) => {
                        setBookingTimeFilter(event.target.value as "all" | "future" | "past");
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All bookings</option>
                      <option value="future">Future only</option>
                      <option value="past">Past only</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Year
                    <select
                      value={bookingYearFilter}
                      onChange={(event) => {
                        setBookingYearFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All years</option>
                      {bookingYearOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Month
                    <select
                      value={bookingMonthFilter}
                      onChange={(event) => {
                        setBookingMonthFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All months</option>
                      {bookingMonthOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Date
                    <select
                      value={bookingDayFilter}
                      onChange={(event) => {
                        setBookingDayFilter(event.target.value);
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All dates</option>
                      {bookingDayOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Payment
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
                      <option value="all">All payment types</option>
                      <option value="FREE_LAUNDRY">Free laundry</option>
                      <option value="COINS">Coins</option>
                      <option value="CASH">Cash</option>
                      <option value="OTHER">Other / Unknown</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Sort
                    <select
                      value={bookingSortDirection}
                      onChange={(event) => {
                        setBookingSortDirection(event.target.value as "desc" | "asc");
                        setShowAllBookings(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="desc">Latest first</option>
                      <option value="asc">Oldest first</option>
                    </select>
                  </label>
                </div>
              ) : null}

              {filteredBookings.length === 0 ? (
                <p className="text-sm text-slate-600">No laundry bookings match the current filters.</p>
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
                    Payment: {getBookingPaymentType(booking).replace("_", " ")}
                  </div>
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

