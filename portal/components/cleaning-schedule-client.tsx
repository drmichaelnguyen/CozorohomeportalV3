"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortalSession } from "./portal-session";
import { usePortalLanguage } from "./portal-language";
import { API_BASE_URL } from "../lib/api-base-url";

type CleaningTask = {
  id: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  branchId: string;
  floor: number | null;
  assignedByEmail?: string | null;
  assignedByName?: string | null;
  scheduledDate: string;
  status: "ASSIGNED" | "DONE_PENDING_AUDIT" | "APPROVED" | "REJECTED" | "MISSED";
  rewardCoins: number;
  isSelfAssigned: boolean;
  assignmentSource?: "SYSTEM" | "MANAGER" | "SELF";
  completionNote?: string | null;
  auditorNote?: string | null;
};

type CleaningAvailability = {
  id: string;
  date: string;
  type: "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";
  note?: string | null;
};

type OccupiedSlot = {
  date: string;
  type: CleaningTask["type"];
  floor: number | null;
};

type CleaningOverview = {
  tasks: CleaningTask[];
  availability: CleaningAvailability[];
  occupiedSlots?: OccupiedSlot[];
  optOut?: { month: string; paymentMethod: string } | null;
  user?: {
    branchId: string;
    floor: number | null;
    name: string;
  } | null;
  releasesThisMonth?: number;
  monthlyReleaseLimit?: number;
};

type PendingSelfAssignment = {
  type: CleaningTask["type"];
  date: string;
  canSubmit: boolean;
  reason?: string;
};

function prettyTaskType(type: CleaningTask["type"]) {
  if (type === "KITCHEN_D2") return "Kitchen D2";
  if (type === "KITCHEN_D7") return "Kitchen D7";
  return "Trash D7";
}

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

function toApiCalendarDate(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCompletionWindow(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const dayStart = startOfDay(new Date(task.scheduledDate));
  const windowStart = new Date(dayStart);
  const windowEnd = new Date(dayStart);

  if (task.type === "KITCHEN_D7") {
    windowStart.setHours(17, 0, 0, 0);
    windowEnd.setHours(23, 0, 0, 0);
    return {
      windowStart,
      windowEnd,
      label: "17:00 to 23:00 on the assigned date"
    };
  }

  windowStart.setHours(0, 0, 0, 0);
  windowEnd.setHours(23, 59, 59, 999);
  return {
    windowStart,
    windowEnd,
    label: "any time on the assigned date"
  };
}

function canCompleteTaskNow(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowStart, windowEnd } = getCompletionWindow(task);
  const now = new Date();
  return now >= windowStart && now <= windowEnd;
}

function canCompleteTaskLate(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowEnd } = getCompletionWindow(task);
  const lateEnd = new Date(windowEnd.getTime() + 10 * 60 * 60 * 1000);
  const now = new Date();
  return now > windowEnd && now <= lateEnd;
}

function getLateDeadline(task: { type: CleaningTask["type"]; scheduledDate: string }) {
  const { windowEnd } = getCompletionWindow(task);
  return new Date(windowEnd.getTime() + 10 * 60 * 60 * 1000);
}

function isFutureDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(new Date()).getTime();
}

function isTodayOrFuture(date: Date) {
  return startOfDay(date).getTime() >= startOfDay(new Date()).getTime();
}

function isAfter8pm() {
  return new Date().getHours() >= 20;
}

function getResidentAssignerLabel(task: Pick<CleaningTask, "assignmentSource" | "isSelfAssigned">) {
  if (task.assignmentSource === "SYSTEM") {
    return "System";
  }
  if (task.assignmentSource === "SELF" || task.isSelfAssigned) {
    return "Self assign";
  }
  return "Cozoro";
}

function canReleaseTask(task: { scheduledDate: string }) {
  const taskDate = startOfDay(new Date(task.scheduledDate));
  const today = startOfDay(new Date());
  return taskDate.getTime() >= today.getTime();
}

function getReleasePenalty(task: { scheduledDate: string; isSelfAssigned?: boolean }) {
  const taskDate = startOfDay(new Date(task.scheduledDate));
  const today = startOfDay(new Date());
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const daysUntilTask = Math.round((taskDate.getTime() - today.getTime()) / millisecondsPerDay);

  if (daysUntilTask < 0) {
    return {
      canRelease: false,
      label: "Past due",
      helpText: "The assigned date has passed. No work is charged as a full fine."
    };
  }

  if (task.isSelfAssigned && daysUntilTask >= 5) {
    return {
      canRelease: true,
      label: "No fine",
      helpText: "Self-assigned — no fine when releasing 5+ days ahead. Does not count against your monthly limit.",
      isSelfAssignedFree: true
    };
  }

  if (daysUntilTask === 0) {
    return {
      canRelease: true,
      label: "75% fine",
      helpText: "Same-day notice applies a 75% fine."
    };
  }

  if (daysUntilTask <= 4) {
    return {
      canRelease: true,
      label: "50% fine",
      helpText: "Notice 1 to 4 days ahead applies a 50% fine."
    };
  }

  return {
    canRelease: true,
    label: "No fine",
    helpText: "Rescheduling 5 or more days ahead has no fine."
  };
}

export function CleaningScheduleClient() {
  const { sessionEmail, isLoggedIn, login } = usePortalSession();
  const { t } = usePortalLanguage();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<CleaningOverview | null>(null);
  const [completionNotes, setCompletionNotes] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [calendarFocusDate, setCalendarFocusDate] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [dayNote, setDayNote] = useState("");
  const [pastVisibleCount, setPastVisibleCount] = useState(5);
  const [pastMonthFilter, setPastMonthFilter] = useState("all");
  const [pastYearFilter, setPastYearFilter] = useState("all");
  const [selfAssignSuggestions, setSelfAssignSuggestions] = useState<string[]>([]);
  const [pendingSelfAssignment, setPendingSelfAssignment] = useState<PendingSelfAssignment | null>(null);
  const [activeMenuDate, setActiveMenuDate] = useState<Date | null>(null);
  const [awayMode, setAwayMode] = useState(false);
  const [awayDates, setAwayDates] = useState<Set<string>>(new Set());
  const [awaySubmitting, setAwaySubmitting] = useState(false);
  const [optOutModal, setOptOutModal] = useState(false);
  const [optOutPayment, setOptOutPayment] = useState<"VND" | "COINS">("VND");
  const [optOutLoading, setOptOutLoading] = useState(false);
  const canSelfAssignSelectedDate = isTodayOrFuture(selectedDate);
  const activeEmail = sessionEmail.trim().toLowerCase();

  const currentMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const currentMonthLabel = new Date().toLocaleString(undefined, { month: "long", year: "numeric" });

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  // Auto-load when the user is already logged in
  useEffect(() => {
    if (isLoggedIn && activeEmail && !overview) {
      setLoading(true);
      loadOverview(activeEmail)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, activeEmail]);

  async function readJsonSafely<T>(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    if (!contentType.includes("application/json")) {
      throw new Error("The server returned HTML instead of JSON. Refresh the page or restart the dev server.");
    }

    return JSON.parse(bodyText) as T;
  }

  async function loadOverview(targetEmail = activeEmail, options?: { refresh?: boolean }) {
    const response = await fetch(
      `${API_BASE_URL}/cleaning/me?email=${encodeURIComponent(targetEmail.trim())}${options?.refresh ? "&refresh=true" : ""}`
    );
    const data = await readJsonSafely<CleaningOverview & { error?: string }>(response);

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load cleaning schedule.");
    }

    setOverview(data as CleaningOverview);
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      await loadOverview();
      login(activeEmail);
      setPastVisibleCount(5);
      setPastMonthFilter("all");
      setPastYearFilter("all");
      setSelfAssignSuggestions([]);
      setPendingSelfAssignment(null);
      setMessage("Cleaning schedule loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load cleaning schedule.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshOverviewNow() {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setRefreshing(true);
    setMessage("");

    try {
      await loadOverview(activeEmail, { refresh: true });
      setPastVisibleCount(5);
      setPastMonthFilter("all");
      setPastYearFilter("all");
      setSelfAssignSuggestions([]);
      setPendingSelfAssignment(null);
      setMessage("Cleaning schedule refreshed and saved locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh cleaning schedule.");
    } finally {
      setRefreshing(false);
    }
  }

  async function saveAvailability(type: CleaningAvailability["type"]) {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/availability`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          date: toApiCalendarDate(selectedDate),
          type,
          note: dayNote || undefined
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to save availability.");
        return;
      }

      await loadOverview(activeEmail, { refresh: true });
      setMessage(type === "UNAVAILABLE" ? "Date marked unavailable." : "Date preference saved.");
      setDayNote("");
      setPendingSelfAssignment(null);
    } catch {
      setMessage("Unable to save availability.");
    } finally {
      setLoading(false);
    }
  }

  async function submitAwayDates() {
    if (awayDates.size === 0) return;
    setAwaySubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/availability/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          dates: Array.from(awayDates),
          type: "UNAVAILABLE",
          note: "Away"
        })
      });
      const data = await readJsonSafely<{ updated?: number; error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? "Unable to save away dates.");
        return;
      }
      await loadOverview(activeEmail, { refresh: true });
      setMessage(`${data.updated ?? awayDates.size} date(s) marked as away.`);
      setAwayDates(new Set());
      setAwayMode(false);
    } catch {
      setMessage("Unable to save away dates.");
    } finally {
      setAwaySubmitting(false);
    }
  }

  async function handleOptOut() {
    setOptOutLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail, paymentMethod: optOutPayment, month: currentMonth })
      });
      const data = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? "Unable to process opt-out.");
        return;
      }
      await loadOverview(activeEmail, { refresh: true });
      setOptOutModal(false);
      setMessage(
        optOutPayment === "COINS"
          ? `Opted out for ${currentMonthLabel}. 150,000 coins deducted.`
          : `Opted out for ${currentMonthLabel}. A fine of 100,000 VND has been added to your account.`
      );
    } catch {
      setMessage("Unable to process opt-out.");
    } finally {
      setOptOutLoading(false);
    }
  }

  async function handleCancelOptOut() {
    setOptOutLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/opt-out`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail, month: currentMonth })
      });
      const data = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? "Unable to cancel opt-out.");
        return;
      }
      await loadOverview(activeEmail, { refresh: true });
      setMessage("Opt-out cancelled. You are back in the cleaning rotation.");
    } catch {
      setMessage("Unable to cancel opt-out.");
    } finally {
      setOptOutLoading(false);
    }
  }

  async function prepareSelfAssignment(type: CleaningTask["type"]) {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }
    if (!canSelfAssignSelectedDate) {
      setMessage("Self-assignment is only available for today or future dates.");
      return;
    }

    setLoading(true);
    setSelfAssignSuggestions([]);
    setMessage("");

    try {
      const date = toApiCalendarDate(selectedDate);
      const response = await fetch(`${API_BASE_URL}/cleaning/self-assign/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          date,
          type
        })
      });
      const data = await readJsonSafely<{ canSubmit?: boolean; reason?: string; suggestions?: string[]; error?: string }>(
        response
      );

      if (!response.ok) {
        setPendingSelfAssignment(null);
        setMessage(data.error ?? "Unable to check this self-assignment.");
        return;
      }

      setSelfAssignSuggestions(data.suggestions ?? []);
      setPendingSelfAssignment({
        type,
        date,
        canSubmit: Boolean(data.canSubmit),
        reason: data.reason
      });
      setMessage(
        data.canSubmit
          ? `Review ${prettyTaskType(type)} on ${selectedDate.toLocaleDateString()} and submit when ready.`
          : (data.reason ?? "This date cannot be self-assigned.")
      );
    } catch {
      setPendingSelfAssignment(null);
      setMessage("Unable to check this self-assignment.");
    } finally {
      setLoading(false);
    }
  }

  async function submitSelfAssignment() {
    if (!pendingSelfAssignment) {
      setMessage("Choose a task first.");
      return;
    }
    if (!pendingSelfAssignment.canSubmit) {
      setMessage(pendingSelfAssignment.reason ?? "This date cannot be self-assigned.");
      return;
    }
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setLoading(true);
    setMessage("");
    setSelfAssignSuggestions([]);

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/self-assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          date: pendingSelfAssignment.date,
          type: pendingSelfAssignment.type
        })
      });
      const data = await readJsonSafely<{ error?: string; suggestions?: string[] }>(response);

      if (response.status === 409) {
        setSelfAssignSuggestions(data.suggestions ?? []);
        setMessage(data.error ?? "That date already has someone assigned.");
        return;
      }

      if (!response.ok) {
        setMessage(data.error ?? "Unable to self-assign this date.");
        return;
      }

      await loadOverview(activeEmail, { refresh: true });
      setPendingSelfAssignment(null);
      setMessage(
        `${prettyTaskType(pendingSelfAssignment.type)} assigned to you on ${new Date(
          `${pendingSelfAssignment.date}T12:00:00`
        ).toLocaleDateString()}.`
      );
    } catch {
      setMessage("Unable to self-assign this date.");
    } finally {
      setLoading(false);
    }
  }

  async function markDone(taskId: string) {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/tasks/${taskId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          note: completionNotes[taskId] || undefined
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to mark task done.");
        return;
      }

      await loadOverview(activeEmail, { refresh: true });
      setMessage("Task marked done and sent for audit.");
    } catch {
      setMessage("Unable to mark task done.");
    } finally {
      setLoading(false);
    }
  }

  async function releaseTask(taskId: string) {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/tasks/${taskId}/release`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail
        })
      });
      const data = await readJsonSafely<{
        error?: string;
        penalty?: {
          fineAmount: number;
          message: string;
        };
      }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to release this task.");
        return;
      }

      await loadOverview(activeEmail, { refresh: true });
      setMessage(
        data.penalty?.fineAmount
          ? `You were removed from this task and the system reassigned it. Fine applied: ${data.penalty.fineAmount}.`
          : "You were removed from this task and the system reassigned it."
      );
    } catch {
      setMessage("Unable to release this task.");
    } finally {
      setLoading(false);
    }
  }

  const futureTasks = useMemo(
    () =>
      (overview?.tasks ?? []).filter(
        (task) => new Date(task.scheduledDate).getTime() >= new Date().setHours(0, 0, 0, 0)
      ),
    [overview]
  );
  const pastTasks = useMemo(
    () =>
      (overview?.tasks ?? []).filter(
        (task) => new Date(task.scheduledDate).getTime() < new Date().setHours(0, 0, 0, 0)
      ).sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate)),
    [overview]
  );
  const pastMonthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          pastTasks.map((task) => String(new Date(task.scheduledDate).getMonth() + 1).padStart(2, "0"))
        )
      ).sort(),
    [pastTasks]
  );
  const pastYearOptions = useMemo(
    () => Array.from(new Set(pastTasks.map((task) => String(new Date(task.scheduledDate).getFullYear())))).sort(),
    [pastTasks]
  );
  const filteredPastTasks = useMemo(
    () =>
      pastTasks.filter((task) => {
        const date = new Date(task.scheduledDate);
        const monthMatches =
          pastMonthFilter === "all" || String(date.getMonth() + 1).padStart(2, "0") === pastMonthFilter;
        const yearMatches = pastYearFilter === "all" || String(date.getFullYear()) === pastYearFilter;
        return monthMatches && yearMatches;
      }),
    [pastMonthFilter, pastTasks, pastYearFilter]
  );
  const visiblePastTasks = useMemo(
    () => filteredPastTasks.slice(0, pastVisibleCount),
    [filteredPastTasks, pastVisibleCount]
  );

  const monthDays = useMemo(() => {
    const gridStart = startOfMonthGrid(calendarFocusDate);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [calendarFocusDate]);

  const selectedDateTasks = useMemo(
    () => (overview?.tasks ?? []).filter((task) => sameDay(new Date(task.scheduledDate), selectedDate)),
    [overview, selectedDate]
  );

  const selectedDateAvailability = useMemo(
    () => overview?.availability.find((entry) => sameDay(new Date(entry.date), selectedDate)) ?? null,
    [overview, selectedDate]
  );

  const allowedTaskTypes = useMemo(() => {
    if (!overview?.user) {
      return [] as CleaningTask["type"][];
    }

    if (overview.user.branchId === "D2") {
      return ["KITCHEN_D2"] as CleaningTask["type"][];
    }

    return overview.user.floor ? (["TRASH_D7", "KITCHEN_D7"] as CleaningTask["type"][]) : (["KITCHEN_D7"] as CleaningTask["type"][]);
  }, [overview]);

  // Upcoming open slots: rest of this month grouped by task type
  const upcomingOpenSlots = useMemo(() => {
    if (!overview || allowedTaskTypes.length === 0) return {} as Record<CleaningTask["type"], string[]>;
    const result: Record<string, string[]> = {};
    for (const type of allowedTaskTypes) {
      result[type] = [];
    }
    const today = startOfDay(new Date());
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    for (let i = 0; addDays(today, i) <= endOfMonth; i++) {
      const day = addDays(today, i);
      const dayStr = toApiCalendarDate(day);
      for (const type of allowedTaskTypes) {
        const isMyTask = (overview.tasks ?? []).some((t) => t.type === type && t.scheduledDate.startsWith(dayStr));
        const isOccupied = (overview.occupiedSlots ?? []).some(
          (slot) =>
            slot.date === dayStr &&
            slot.type === type &&
            (type !== "TRASH_D7" || slot.floor === (overview.user?.floor ?? null))
        );
        if (!isMyTask && !isOccupied) {
          result[type].push(dayStr);
        }
      }
    }
    return result as Record<CleaningTask["type"], string[]>;
  }, [overview, allowedTaskTypes]);

  function moveMonth(direction: -1 | 1) {
    setCalendarFocusDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Cleaning Schedule</h1>
        <p className="mt-2 text-sm text-slate-600">
          Click a date to mark yourself unavailable or assign yourself to a cleaning task that fits your branch and floor.
        </p>

        <form onSubmit={handleLogin} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading || !activeEmail}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Loading..." : "Load cleaning schedule"}
            </button>
            <button
              type="button"
              onClick={() => void refreshOverviewNow()}
              disabled={refreshing || !activeEmail}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh schedule"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {overview && futureTasks.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-200 text-amber-700 shadow-sm">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-amber-900 uppercase tracking-tight">{t("nextCleaning", "Your Next Cleaning")}</h2>
              <p className="text-xl font-black text-slate-900">
                {new Date(futureTasks[0].scheduledDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded-md bg-white/60 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-amber-200 uppercase">{prettyTaskType(futureTasks[0].type)}</span>
                <span className="text-[10px] font-bold text-amber-700">+{futureTasks[0].rewardCoins} Coins</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {optOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Opt out of cleaning — {currentMonthLabel}</h3>
            <p className="mt-2 text-sm text-slate-600">
              You will be exempt from all cleaning assignments this month. A fee will be charged.
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => setOptOutPayment("VND")}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${optOutPayment === "VND" ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">Pay 100,000 VND</p>
                  <p className="text-xs text-slate-500">A fine will be added to your account.</p>
                </div>
                {optOutPayment === "VND" && <div className="h-4 w-4 rounded-full bg-slate-900" />}
              </button>
              <button
                onClick={() => setOptOutPayment("COINS")}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${optOutPayment === "COINS" ? "border-amber-500 bg-amber-50 ring-2 ring-amber-500" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">Pay 150,000 Coins</p>
                  <p className="text-xs text-slate-500">Deducted from your coin balance immediately.</p>
                </div>
                {optOutPayment === "COINS" && <div className="h-4 w-4 rounded-full bg-amber-500" />}
              </button>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => void handleOptOut()}
                disabled={optOutLoading}
                className="flex-1 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {optOutLoading ? "Processing..." : "Confirm Opt Out"}
              </button>
              <button
                onClick={() => setOptOutModal(false)}
                disabled={optOutLoading}
                className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm text-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {overview ? (
        <>
          {activeMenuDate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
              <div 
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">
                    {activeMenuDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </h3>
                  <button 
                    onClick={() => setActiveMenuDate(null)}
                    className="rounded-full p-2 text-slate-400 hover:bg-slate-100 transition-colors"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Task Actions</div>
                    <div className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase ring-1 ring-amber-200">
                      +20% Coins Bonus
                    </div>
                  </div>

                  {allowedTaskTypes.length === 0 && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
                      Your cleaning profile hasn't been set up yet. Contact your manager to be added to the system.
                    </div>
                  )}

                  {allowedTaskTypes.map((type) => {
                    const isMyTask = (overview.tasks ?? []).some(
                      (t) => sameDay(new Date(t.scheduledDate), activeMenuDate) && t.type === type
                    );
                    if (isMyTask) return null;

                    const activeDateStr = toApiCalendarDate(activeMenuDate);
                    const isOccupiedByOther = (overview.occupiedSlots ?? []).some(
                      (slot) =>
                        slot.date === activeDateStr &&
                        slot.type === type &&
                        (type !== "TRASH_D7" || slot.floor === (overview.user?.floor ?? null))
                    );
                    const isDateTodayOrFuture = isTodayOrFuture(activeMenuDate);
                    const isDateToday = sameDay(activeMenuDate, new Date());
                    const canTakeOver = isDateToday && isAfter8pm();

                    if (isOccupiedByOther) {
                      if (canTakeOver) {
                        return (
                          <button
                            key={type}
                            onClick={() => {
                              void prepareSelfAssignment(type);
                              setActiveMenuDate(null);
                            }}
                            className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left transition-all hover:bg-amber-100 active:scale-[0.98]"
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-amber-900">Take Over</p>
                              <p className="text-xs text-amber-700">{prettyTaskType(type)} — assigned person hasn't completed it yet</p>
                            </div>
                            <div className="ml-auto text-[10px] font-bold text-amber-600">+20%</div>
                          </button>
                        );
                      }
                      return (
                        <div
                          key={type}
                          className="flex w-full items-center gap-3 rounded-xl border border-sky-100 bg-sky-50 p-4"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-sky-900">Already assigned</p>
                            <p className="text-xs text-sky-700">{prettyTaskType(type)}</p>
                          </div>
                        </div>
                      );
                    }

                    if (!isDateTodayOrFuture) return null;

                    return (
                      <button
                        key={type}
                        onClick={() => {
                          void prepareSelfAssignment(type);
                          setActiveMenuDate(null);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left transition-all hover:bg-emerald-100 active:scale-[0.98]"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-emerald-900">Assign Myself</p>
                          <p className="text-xs text-emerald-700">{prettyTaskType(type)}</p>
                        </div>
                        <div className="ml-auto text-[10px] font-bold text-amber-600">+20%</div>
                      </button>
                    );
                  })}

                  {(overview.tasks ?? []).filter(t => sameDay(new Date(t.scheduledDate), activeMenuDate)).map(task => {
                    const releasePenalty = getReleasePenalty(task);
                    const releasesUsed = overview.releasesThisMonth ?? 0;
                    const releaseLimit = overview.monthlyReleaseLimit ?? 3;
                    const atMonthlyLimit = !releasePenalty.isSelfAssignedFree && releasesUsed >= releaseLimit;
                    const canRelease = releasePenalty.canRelease && !atMonthlyLimit;
                    return (
                      <div key={task.id} className="space-y-2">
                        <div className="flex items-center justify-between px-1 flex-wrap gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(task.assignmentSource === "SELF" || task.isSelfAssigned) ? (
                              <>
                                <span className="text-amber-500">★</span>
                                <span className="text-xs font-semibold text-amber-700">Self-assigned</span>
                                {releasePenalty.isSelfAssignedFree && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Free release</span>
                                )}
                              </>
                            ) : task.assignmentSource === "SYSTEM" ? (
                              <>
                                <span className="text-sky-500">⚙</span>
                                <span className="text-xs font-semibold text-sky-700">Auto-scheduled</span>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-400">👤</span>
                                <span className="text-xs font-semibold text-slate-600">Assigned by manager</span>
                              </>
                            )}
                          </div>
                          {task.status === "REJECTED" ? (
                            <span className="text-xs font-semibold text-rose-500 line-through">+{task.rewardCoins.toLocaleString()} coins</span>
                          ) : task.status === "APPROVED" ? (
                            <span className="text-xs font-semibold text-emerald-600">+{task.rewardCoins.toLocaleString()} coins ✓</span>
                          ) : task.status === "DONE_PENDING_AUDIT" ? (
                            <span className="text-xs text-amber-600">+{task.rewardCoins.toLocaleString()} coins ⏳</span>
                          ) : task.status === "MISSED" ? (
                            <span className="text-xs text-slate-400 line-through">+{task.rewardCoins.toLocaleString()} coins</span>
                          ) : (
                            <span className="text-xs text-slate-500">+{task.rewardCoins.toLocaleString()} coins</span>
                          )}
                        </div>
                        {task.status === "REJECTED" && task.auditorNote && (
                          <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
                            <p className="text-xs font-semibold text-rose-700">Not approved</p>
                            <p className="text-xs text-rose-600 mt-0.5">{task.auditorNote}</p>
                          </div>
                        )}
                        {task.status === "APPROVED" && (
                          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                            <p className="text-xs font-semibold text-emerald-700">Approved — +{task.rewardCoins.toLocaleString()} coins added to your account</p>
                          </div>
                        )}
                        <button
                          disabled={!canRelease || loading}
                          onClick={() => {
                            void releaseTask(task.id);
                            setActiveMenuDate(null);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 text-left transition-all hover:bg-rose-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-rose-900">Remove Myself ({releasePenalty.label})</p>
                            <p className="text-xs text-rose-700">{prettyTaskType(task.type)} — {releasePenalty.helpText}</p>
                          </div>
                        </button>
                        {atMonthlyLimit ? (
                          <p className="text-xs text-rose-600 px-1">You have used all {releaseLimit} removals for this month.</p>
                        ) : canRelease && !releasePenalty.isSelfAssignedFree ? (
                          <p className="text-xs text-slate-500 px-1">
                            You will be automatically reassigned to another date. ({releasesUsed}/{releaseLimit} removals used this month)
                          </p>
                        ) : canRelease && releasePenalty.isSelfAssignedFree ? (
                          <p className="text-xs text-emerald-700 px-1">
                            You will be reassigned to another date. This will not count against your monthly removal limit.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Availability</div>
                  
                  <button
                    onClick={() => {
                      void saveAvailability("UNAVAILABLE");
                      setActiveMenuDate(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition-all hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Mark Unavailable</p>
                      <p className="text-xs text-slate-500">You won't be assigned on this day.</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">My Cleaning Profile</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Branch</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{overview.user?.branchId ?? "-"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Floor</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{overview.user?.floor ?? "-"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Name</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{overview.user?.name ?? sessionEmail}</div>
              </div>
            </div>
          </section>

          {/* Opt-out section */}
          <section className={`rounded-2xl p-5 shadow-sm ring-1 ${overview.optOut ? "bg-slate-100 ring-slate-300" : "bg-white ring-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Cleaning Opt-out — {currentMonthLabel}</div>
                {overview.optOut ? (
                  <p className="mt-0.5 text-sm text-slate-600">
                    You have opted out this month (paid via {overview.optOut.paymentMethod === "COINS" ? "150,000 coins" : "100,000 VND"}).
                    You will not be assigned to any cleaning tasks.
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-500">
                    Pay 100,000 VND or 150,000 coins to be exempt from all cleaning assignments this month.
                  </p>
                )}
              </div>
              {overview.optOut ? (
                <button
                  onClick={() => void handleCancelOptOut()}
                  disabled={optOutLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60 hover:bg-white transition-colors"
                >
                  {optOutLoading ? "..." : "Cancel opt-out"}
                </button>
              ) : (
                <button
                  onClick={() => setOptOutModal(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  Opt out this month
                </button>
              )}
            </div>
          </section>

          {allowedTaskTypes.length > 0 && Object.values(upcomingOpenSlots).some((dates) => dates.length > 0) && (
            <section className="rounded-2xl bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-200">
              <h2 className="text-sm font-semibold text-emerald-900">Upcoming open slots — available to self-assign</h2>
              <div className="mt-3 space-y-3">
                {(Object.entries(upcomingOpenSlots) as [CleaningTask["type"], string[]][]).map(([type, dates]) => {
                  if (dates.length === 0) return null;
                  const label = type === "KITCHEN_D2" ? "Kitchen D2" : type === "KITCHEN_D7" ? "Kitchen D7" : `Trash D7 (floor ${overview?.user?.floor ?? "?"})`;
                  // Group dates by month
                  const byMonth: Record<string, string[]> = {};
                  for (const d of dates) {
                    const monthKey = d.slice(0, 7);
                    if (!byMonth[monthKey]) byMonth[monthKey] = [];
                    byMonth[monthKey].push(d);
                  }
                  return (
                    <div key={type}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{label}</div>
                      <div className="mt-1 space-y-1">
                        {Object.entries(byMonth).map(([month, monthDates]) => {
                          const [year, mon] = month.split("-");
                          const monthLabel = new Date(Number(year), Number(mon) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
                          return (
                            <div key={month} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-xs font-medium text-emerald-800 w-28 shrink-0">{monthLabel}:</span>
                              <div className="flex flex-wrap gap-1">
                                {monthDates.slice(0, 20).map((d) => {
                                  const dayNum = parseInt(d.slice(8), 10);
                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => {
                                        const target = new Date(d + "T00:00:00");
                                        setCalendarFocusDate(new Date(target.getFullYear(), target.getMonth(), 1));
                                        setSelectedDate(startOfDay(target));
                                        setActiveMenuDate(startOfDay(target));
                                        setPendingSelfAssignment(null);
                                        setSelfAssignSuggestions([]);
                                      }}
                                      className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-200 transition-colors"
                                    >
                                      {dayNum}
                                    </button>
                                  );
                                })}
                                {monthDates.length > 20 && (
                                  <span className="text-xs text-emerald-600">+{monthDates.length - 20} more</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Cleaning Calendar</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Select a date to set availability or claim a task yourself.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => moveMonth(-1)}
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
                    onClick={() => moveMonth(1)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAwayMode((m) => !m); setAwayDates(new Set()); }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${awayMode ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    {awayMode ? "Cancel Away" : "Mark Away"}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  {calendarFocusDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
                </div>
                {awayMode && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-orange-700">
                      {awayDates.size} date{awayDates.size !== 1 ? "s" : ""} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => void submitAwayDates()}
                      disabled={awaySubmitting || awayDates.size === 0}
                      className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 hover:bg-orange-600 transition-colors"
                    >
                      {awaySubmitting ? "Saving..." : "Mark Away"}
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 overflow-x-auto pb-2 hide-scrollbar">
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {["M", "T", "W", "T", "F", "S", "S"].map((label, idx) => (
                  <div key={idx}>{label}</div>
                ))}
                </div>

                <div className="mt-2 grid grid-cols-7 gap-1">
                {monthDays.map((day) => {
                  const tasks = (overview.tasks ?? []).filter((task) => sameDay(new Date(task.scheduledDate), day));
                  const availability = (overview.availability ?? []).find((entry) =>
                    sameDay(new Date(entry.date), day)
                  );
                  const isCurrentMonth = day.getMonth() === calendarFocusDate.getMonth();
                  const isSelected = sameDay(day, selectedDate);
                  const isToday = sameDay(day, new Date());
                  const isFuture = isFutureDate(day);
                  const dayDateStr = toApiCalendarDate(day);

                  // Determine open vs occupied slots for this day
                  const isAssignable = isTodayOrFuture(day);
                  const hasOpenSlot = isAssignable && allowedTaskTypes.some((type) => {
                    const isMyTask = tasks.some((t) => t.type === type);
                    const isOccupied = (overview.occupiedSlots ?? []).some(
                      (slot) =>
                        slot.date === dayDateStr &&
                        slot.type === type &&
                        (type !== "TRASH_D7" || slot.floor === (overview.user?.floor ?? null))
                    );
                    return !isMyTask && !isOccupied;
                  });

                  const hasOccupiedByOthers = isAssignable && !hasOpenSlot && allowedTaskTypes.some((type) => {
                    const isMyTask = tasks.some((t) => t.type === type);
                    const isOccupied = (overview.occupiedSlots ?? []).some(
                      (slot) =>
                        slot.date === dayDateStr &&
                        slot.type === type &&
                        (type !== "TRASH_D7" || slot.floor === (overview.user?.floor ?? null))
                    );
                    return !isMyTask && isOccupied;
                  });

                  const isAwaySelected = awayDates.has(dayDateStr);

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => {
                        if (awayMode) {
                          setAwayDates((prev) => {
                            const next = new Set(prev);
                            if (next.has(dayDateStr)) next.delete(dayDateStr);
                            else next.add(dayDateStr);
                            return next;
                          });
                          return;
                        }
                        setSelectedDate(startOfDay(day));
                        setActiveMenuDate(startOfDay(day));
                        setPendingSelfAssignment(null);
                        setSelfAssignSuggestions([]);
                        setDayNote(availability?.note ?? "");
                      }}
                      className={[
                        "min-h-[3.5rem] md:min-h-28 rounded-lg border p-1 md:p-2 text-left transition-all",
                        awayMode && isAwaySelected ? "bg-orange-100 border-orange-400 ring-2 ring-orange-400" :
                        awayMode ? "hover:bg-orange-50 hover:border-orange-300" :
                        isSelected ? "ring-2 ring-slate-900 border-slate-900" : "hover:border-slate-400",
                        isToday && !awayMode ? "border-slate-400" : "",
                        !awayMode && hasOpenSlot && !isSelected ? "bg-emerald-50 border-emerald-300" :
                        !awayMode && hasOccupiedByOthers && !isSelected ? "bg-sky-50 border-sky-300" :
                        isCurrentMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                      ].filter(Boolean).join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`text-[10px] md:text-xs font-semibold ${isToday ? "text-blue-600" : "text-slate-900"}`}>{day.getDate()}</div>
                        {awayMode && isAwaySelected ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-orange-500" title="Away" />
                        ) : availability?.type === "UNAVAILABLE" ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-rose-400" title="Unavailable" />
                        ) : hasOpenSlot ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Open slot" />
                        ) : hasOccupiedByOthers ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-sky-400" title="Taken" />
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {!awayMode && tasks.map((task) => (
                          <div key={task.id} className={`h-1.5 w-1.5 shrink-0 rounded-full md:h-auto md:w-full md:px-1.5 md:py-0.5 md:text-[10px] md:truncate ${task.status === "REJECTED" ? "bg-rose-400 md:bg-rose-100 md:text-rose-700" : task.status === "APPROVED" ? "bg-emerald-500 md:bg-emerald-100 md:text-emerald-800" : "bg-amber-500 md:bg-amber-500 md:text-white"}`}>
                            <span className={`hidden md:inline ${task.status === "REJECTED" ? "line-through" : ""}`}>{prettyTaskType(task.type)}{(task.assignmentSource === "SELF" || task.isSelfAssigned) ? " ★" : task.assignmentSource === "SYSTEM" ? " ⚙" : task.assignmentSource === "MANAGER" ? " 👤" : ""}</span>
                          </div>
                        ))}
                        {!awayMode && hasOpenSlot && tasks.length === 0 && (
                          <div className="text-[8px] font-bold text-emerald-600 uppercase hidden md:block">Open</div>
                        )}
                        {!awayMode && hasOccupiedByOthers && tasks.length === 0 && (
                          <div className="text-[8px] font-bold text-sky-600 uppercase hidden md:block">Taken</div>
                        )}
                        {!awayMode && availability?.type === "UNAVAILABLE" && (
                          <div className="text-[8px] font-medium text-slate-500 uppercase hidden md:block">Off</div>
                        )}
                        {awayMode && isAwaySelected && (
                          <div className="text-[8px] font-bold text-orange-600 uppercase hidden md:block">Away</div>
                        )}
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Selected Date</h2>
              <div className="mt-2 text-sm text-slate-600">
                {selectedDate.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric"
                })}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Current status</div>
                <div className="mt-2 text-sm text-slate-900">
                  {selectedDateAvailability
                    ? `${selectedDateAvailability.type}${selectedDateAvailability.note ? ` - ${selectedDateAvailability.note}` : ""}`
                    : "No availability preference saved"}
                </div>
              </div>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                Note
                <input
                  type="text"
                  value={dayNote}
                  onChange={(event) => setDayNote(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Optional note for this date"
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveAvailability("UNAVAILABLE")}
                  disabled={loading}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 disabled:opacity-60"
                >
                  Mark unavailable
                </button>
                <button
                  type="button"
                  onClick={() => void saveAvailability("AVAILABLE")}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  Mark available
                </button>
              </div>

              <div className="mt-6">
                <div className="text-sm font-medium text-slate-900">Assign myself on this date</div>
                {!canSelfAssignSelectedDate ? (
                  <p className="mt-2 text-sm text-amber-700">You can only assign yourself to today or future dates.</p>
                ) : null}
                {selfAssignSuggestions.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-medium">Suggested nearby open dates</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selfAssignSuggestions.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => {
                            setSelectedDate(startOfDay(new Date(`${date}T12:00:00`)));
                            setSelfAssignSuggestions([]);
                            setPendingSelfAssignment(null);
                          }}
                          className="rounded-lg border border-amber-300 px-3 py-1 text-sm text-amber-900"
                        >
                          {new Date(`${date}T12:00:00`).toLocaleDateString()}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3">
                  {allowedTaskTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => void prepareSelfAssignment(type)}
                      disabled={loading || !canSelfAssignSelectedDate}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {prettyTaskType(type)}
                    </button>
                  ))}
                </div>
                {overview.user?.branchId === "D7" && overview.user.floor ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Your D7 trash task follows floor {overview.user.floor} automatically.
                  </p>
                ) : null}
                {pendingSelfAssignment ? (
                  <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
                    <div className="text-sm font-medium text-slate-900">Ready to submit</div>
                    <div className="mt-2 text-sm text-slate-700">
                      {prettyTaskType(pendingSelfAssignment.type)} on{" "}
                      {new Date(`${pendingSelfAssignment.date}T12:00:00`).toLocaleDateString()}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {pendingSelfAssignment.canSubmit
                        ? "Nothing will be changed until you confirm and submit this task."
                        : pendingSelfAssignment.reason ?? "This date cannot be self-assigned."}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void submitSelfAssignment()}
                        disabled={loading || !pendingSelfAssignment.canSubmit}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                      >
                        Confirm and submit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingSelfAssignment(null)}
                        disabled={loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-6">
                <div className="text-sm font-medium text-slate-900">Tasks on this date</div>
                <div className="mt-3 space-y-2">
                  {selectedDateTasks.length === 0 ? (
                    <p className="text-sm text-slate-500">No tasks assigned on this date yet.</p>
                  ) : (
                    selectedDateTasks.map((task) => (
                      <div key={task.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="font-medium text-slate-900">{prettyTaskType(task.type)}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          Status: {task.status} | Reward: {task.rewardCoins} coins
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          Assigner: {getResidentAssignerLabel(task)}
                        </div>
                        {task.type === "TRASH_D7" && task.floor ? (
                          <div className="mt-1 text-sm text-slate-600">Floor: {task.floor}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Upcoming Tasks</h2>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Reschedule policy: 5+ days notice has no fine, 1–4 days notice has a 50% fine, same-day notice has a 75% fine, and missing the work is a full fine.
                Late completion: You may mark a task done up to 10 hours after the deadline and still earn 50% of the normal coin reward. After 10 hours the task is marked missed and a fine is issued automatically.
              </div>
              <div className="mt-4 space-y-3">
                {futureTasks.length === 0 ? <p className="text-sm text-slate-600">No upcoming tasks.</p> : null}
                {futureTasks.map((task) => {
                  const releasePenalty = getReleasePenalty(task);
                  const releasesUsed = overview?.releasesThisMonth ?? 0;
                  const releaseLimit = overview?.monthlyReleaseLimit ?? 3;
                  const atMonthlyLimit = releasesUsed >= releaseLimit;
                  const canRelease = releasePenalty.canRelease && !atMonthlyLimit;

                  return (
                  <div key={task.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="font-medium text-slate-900">
                      {prettyTaskType(task.type)} - {new Date(task.scheduledDate).toLocaleDateString()}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Status: {task.status} | Reward: {task.rewardCoins} coins
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Assigner: {getResidentAssignerLabel(task)}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Completion window: {getCompletionWindow(task).label}
                    </div>
                    {task.type === "TRASH_D7" && task.floor ? (
                      <div className="mt-1 text-sm text-slate-600">Floor: {task.floor}</div>
                    ) : null}
                    {task.status === "ASSIGNED" ? (
                      <>
                        <textarea
                          value={completionNotes[task.id] ?? ""}
                          onChange={(event) =>
                            setCompletionNotes((current) => ({ ...current, [task.id]: event.target.value }))
                          }
                          placeholder="Optional completion note"
                          className="mt-3 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void markDone(task.id)}
                          disabled={loading || (!canCompleteTaskNow(task) && !canCompleteTaskLate(task))}
                          className={`mt-3 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-60 ${
                            canCompleteTaskLate(task) ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-900"
                          }`}
                        >
                          {canCompleteTaskLate(task) ? "Mark done (late — 50% coins)" : "Mark done"}
                        </button>
                        {canCompleteTaskLate(task) ? (
                          <div className="mt-2 text-sm text-amber-700">
                            ⚠ Late submission. You will earn {Math.round(task.rewardCoins * 0.5)} coins (50%) instead of {task.rewardCoins}. Deadline: {getLateDeadline(task).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                          </div>
                        ) : !canCompleteTaskNow(task) ? (
                          <div className="mt-2 text-sm text-rose-600">
                            Deadline passed. You had until {getLateDeadline(task).toLocaleString()} to submit late.
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void releaseTask(task.id)}
                          disabled={loading || !canRelease}
                          className="mt-3 ml-3 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                        >
                          Remove myself ({releasePenalty.label})
                        </button>
                        {atMonthlyLimit ? (
                          <div className="mt-2 text-sm text-rose-600">
                            You have used all {releaseLimit} removals for this month.
                          </div>
                        ) : !releasePenalty.canRelease ? (
                          <div className="mt-2 text-sm text-amber-700">
                            {releasePenalty.helpText}
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">
                            You will be automatically reassigned to another date. ({releasesUsed}/{releaseLimit} removals used this month)
                          </div>
                        )}
                      </>
                    ) : null}
                    {task.auditorNote ? <div className="mt-2 text-sm text-slate-600">Audit note: {task.auditorNote}</div> : null}
                  </div>
                  );
                })}
              </div>
            </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">Past Tasks</h2>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Month
                    <select
                      value={pastMonthFilter}
                      onChange={(event) => {
                        setPastMonthFilter(event.target.value);
                        setPastVisibleCount(5);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All months</option>
                      {pastMonthOptions.map((month) => (
                        <option key={month} value={month}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Year
                    <select
                      value={pastYearFilter}
                      onChange={(event) => {
                        setPastYearFilter(event.target.value);
                        setPastVisibleCount(5);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="all">All years</option>
                      {pastYearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {filteredPastTasks.length === 0 ? <p className="text-sm text-slate-600">No past tasks yet.</p> : null}
                {visiblePastTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="font-medium text-slate-900">
                      {prettyTaskType(task.type)} - {new Date(task.scheduledDate).toLocaleDateString()}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Status: {task.status} | Reward: {task.rewardCoins} coins
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Assigner: {getResidentAssignerLabel(task)}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Completion window: {getCompletionWindow(task).label}
                    </div>
                    {task.completionNote ? <div className="mt-2 text-sm text-slate-600">Your note: {task.completionNote}</div> : null}
                    {task.auditorNote ? <div className="mt-2 text-sm text-slate-600">Audit note: {task.auditorNote}</div> : null}
                  </div>
                ))}
                {visiblePastTasks.length < filteredPastTasks.length ? (
                  <button
                    type="button"
                    onClick={() => setPastVisibleCount((current) => current + 5)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Show 5 more
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
