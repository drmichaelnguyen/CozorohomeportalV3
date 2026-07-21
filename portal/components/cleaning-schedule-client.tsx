"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortalSession } from "./portal-session";
import { usePortalLanguage } from "./portal-language";
import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDate, formatCozoroDateTime, formatCozoroMonth } from "../lib/date-format";

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
  contractOptOut?: {
    contractCode: string;
    cleaningFeeVnd: number;
    startDate: string | null;
    endDate: string | null;
  } | null;
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

type SwapCandidate = {
  email: string;
  name: string;
  bedDisplay: string;
  branchId: string;
  floor: number | null;
  availabilityType: "AVAILABLE" | "PREFERRED" | "UNAVAILABLE" | null;
  hasSameDayTask: boolean;
};

type SwapRequest = {
  id: string;
  taskId: string;
  requesterEmail: string;
  requesterName: string | null;
  targetEmail: string;
  targetName: string | null;
  offeredCoins: number;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";
  taskType: CleaningTask["type"];
  taskScheduledDate: string;
  taskBranchId: string;
  taskRewardCoins: number;
  createdAt: string;
};

type SwapRequestsData = {
  sent: SwapRequest[];
  received: SwapRequest[];
  pendingReceivedCount: number;
};

function prettyTaskType(type: CleaningTask["type"]) {
  if (type === "KITCHEN_D2") return "Kitchen D2";
  if (type === "KITCHEN_D7") return "Kitchen D7";
  return "Trash D7";
}

const DISMISSED_OVERDUE_TASK_NOTE_PREFIX = "[Dismissed overdue task]";

function isDismissedOverdueTask(note?: string | null) {
  return Boolean(note?.startsWith(DISMISSED_OVERDUE_TASK_NOTE_PREFIX));
}

function formatDismissedOverdueTaskNote(note?: string | null) {
  if (!note) {
    return "";
  }

  if (!note.startsWith(DISMISSED_OVERDUE_TASK_NOTE_PREFIX)) {
    return note;
  }

  return note.slice(DISMISSED_OVERDUE_TASK_NOTE_PREFIX.length).trimStart();
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

function shouldShowNextCleaningCard(task: CleaningTask) {
  if (task.status !== "ASSIGNED") {
    return false;
  }

  return getLateDeadline(task).getTime() >= Date.now();
}

function getNextCleaningCardLabel(task: CleaningTask) {
  if (canCompleteTaskLate(task)) {
    return "Due";
  }

  if (canCompleteTaskNow(task)) {
    return "Today";
  }

  return "Scheduled";
}

function isFutureDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(new Date()).getTime();
}

function isTodayOrFuture(date: Date) {
  return startOfDay(date).getTime() >= startOfDay(new Date()).getTime();
}

type SelfAssignAvailability = {
  available: boolean;
  hidden?: boolean;
  reasonKey?: string;
  reasonFallback?: string;
};

function isSlotOccupiedByOther(
  overview: CleaningOverview,
  dateStr: string,
  type: CleaningTask["type"]
) {
  return (overview.occupiedSlots ?? []).some(
    (slot) =>
      slot.date === dateStr &&
      slot.type === type &&
      (type !== "TRASH_D7" || slot.floor === (overview.user?.floor ?? null))
  );
}

function getSelfAssignAvailability(
  date: Date,
  type: CleaningTask["type"],
  overview: CleaningOverview | null
): SelfAssignAvailability {
  if (!overview) {
    return { available: false, reasonKey: "cannotSelfAssign", reasonFallback: "This date cannot be self-assigned." };
  }

  const dateStr = toApiCalendarDate(date);
  const hasMyTask = (overview.tasks ?? []).some(
    (task) => sameDay(new Date(task.scheduledDate), date) && task.type === type
  );
  if (hasMyTask) {
    return { available: false, hidden: true };
  }

  const occupiedByOther = isSlotOccupiedByOther(overview, dateStr, type);
  const isDateToday = sameDay(date, new Date());
  const canTakeOver = isDateToday && isAfter8pm() && occupiedByOther;

  if (occupiedByOther && !canTakeOver) {
    return {
      available: false,
      reasonKey: "selfAssignSlotTaken",
      reasonFallback: "This slot is already assigned to someone else."
    };
  }

  if (!isFutureDate(date) && !canTakeOver) {
    return {
      available: false,
      reasonKey: "selfAssignFutureOnly",
      reasonFallback: "Self-assignment is only available for future dates."
    };
  }

  const availability = (overview.availability ?? []).find((entry) => sameDay(new Date(entry.date), date));
  if (availability?.type === "UNAVAILABLE") {
    return {
      available: false,
      reasonKey: "selfAssignDateUnavailable",
      reasonFallback: "This date is marked unavailable."
    };
  }

  if (overview.contractOptOut) {
    return {
      available: false,
      reasonFallback: "You are opted out of cleaning for this contract."
    };
  }

  const selectedMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (overview.optOut?.month === selectedMonth) {
    return {
      available: false,
      reasonFallback: "You have opted out of cleaning for this month."
    };
  }

  return { available: true };
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
  const { sessionEmail, isLoggedIn, isSessionLoaded, login } = usePortalSession();
  const { t, language } = usePortalLanguage();
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
  const [pastTasksExpanded, setPastTasksExpanded] = useState(false);
  const [selfAssignSuggestions, setSelfAssignSuggestions] = useState<string[]>([]);
  const [pendingSelfAssignment, setPendingSelfAssignment] = useState<PendingSelfAssignment | null>(null);
  const [activeMenuDate, setActiveMenuDate] = useState<Date | null>(null);
  const [awayMode, setAwayMode] = useState(false);
  const [awayDates, setAwayDates] = useState<Set<string>>(new Set());
  const [awaySubmitting, setAwaySubmitting] = useState(false);
  const [optOutModal, setOptOutModal] = useState(false);
  const [optOutPayment, setOptOutPayment] = useState<"VND" | "COINS">("VND");
  const [optOutLoading, setOptOutLoading] = useState(false);
  const [showPolicyHelp, setShowPolicyHelp] = useState(false);
  const [showReleaseHelp, setShowReleaseHelp] = useState(false);
  const [showAssignHelp, setShowAssignHelp] = useState(false);
  const [showSwapHelp, setShowSwapHelp] = useState(false);
  const [markAwayHelpOpen, setMarkAwayHelpOpen] = useState(false);
  const [markUnavailableHelpOpen, setMarkUnavailableHelpOpen] = useState(false);
  // Swap request state
  const [swapFlowTaskId, setSwapFlowTaskId] = useState<string | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [swapCandidatesLoading, setSwapCandidatesLoading] = useState(false);
  const [selectedSwapTarget, setSelectedSwapTarget] = useState<SwapCandidate | null>(null);
  const [swapOfferedCoins, setSwapOfferedCoins] = useState(0);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapRequestsData, setSwapRequestsData] = useState<SwapRequestsData | null>(null);
  const [swapActionLoading, setSwapActionLoading] = useState<string | null>(null);
  const activeEmail = sessionEmail.trim().toLowerCase();

  const currentMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const currentMonthLabel = new Date().toLocaleString(language === "vi" ? "vi-VN" : "en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  // Auto-load once session is known and the user is logged in
  useEffect(() => {
    if (!isSessionLoaded || !isLoggedIn || !activeEmail || overview) {
      return;
    }
    setLoading(true);
    loadOverview(activeEmail)
      .then(() => void loadSwapRequests())
      .catch(() => {})
      .finally(() => setLoading(false));
    // overview omitted from deps on purpose: we only auto-fetch when session/email gates change, not when overview updates (avoids loops on failed fetch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSessionLoaded, isLoggedIn, activeEmail]);

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

    if (type === "UNAVAILABLE" && !isTodayOrFuture(selectedDate)) {
      setMessage(t("pastUnavailableError", "Past dates cannot be marked unavailable."));
      return;
    }

    const assignedTasks = (overview?.tasks ?? []).filter(
      (task) => task.status === "ASSIGNED" && sameDay(new Date(task.scheduledDate), selectedDate)
    );
    if (
      type === "UNAVAILABLE" &&
      assignedTasks.length > 0 &&
      !window.confirm(
        t("assignedTaskAwayWarning", undefined, { dates: formatCozoroDate(selectedDate) })
      )
    ) {
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
    const sortedDates = Array.from(awayDates).sort();
    const dateLabels = sortedDates
      .map((date) => formatCozoroDate(new Date(`${date}T00:00:00`), { month: "short", day: "numeric", year: "numeric" }))
      .join(", ");
    if (!window.confirm(t("confirmAwayDates", undefined, { dates: dateLabels }))) return;

    const assignedDateSet = new Set(
      (overview?.tasks ?? [])
        .filter((task) => task.status === "ASSIGNED")
        .map((task) => toApiCalendarDate(new Date(task.scheduledDate)))
    );
    const conflictingDates = sortedDates.filter((date) => assignedDateSet.has(date));
    if (
      conflictingDates.length > 0 &&
      !window.confirm(
        t("assignedTaskAwayWarning", undefined, {
          dates: conflictingDates
            .map((date) => formatCozoroDate(new Date(`${date}T00:00:00`), { month: "short", day: "numeric", year: "numeric" }))
            .join(", ")
        })
      )
    ) return;

    setAwaySubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/availability/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          dates: sortedDates,
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
    const availability = getSelfAssignAvailability(selectedDate, type, overview);
    if (!availability.available) {
      setMessage(
        availability.reasonKey
          ? t(availability.reasonKey, availability.reasonFallback ?? t("cannotSelfAssign"))
          : (availability.reasonFallback ?? t("cannotSelfAssign"))
      );
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
          ? `Review ${prettyTaskType(type)} on ${formatCozoroDate(selectedDate)} and submit when ready.`
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
        `${prettyTaskType(pendingSelfAssignment.type)} assigned to you on ${formatCozoroDate(
          `${pendingSelfAssignment.date}T12:00:00`
        )}.`
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

  async function loadSwapRequests() {
    if (!activeEmail) return;
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/swap-requests?email=${encodeURIComponent(activeEmail)}`);
      if (!response.ok) return;
      const data = await readJsonSafely<SwapRequestsData>(response);
      setSwapRequestsData(data);
    } catch {
      // Non-critical — silently ignore
    }
  }

  async function openSwapFlow(taskId: string, taskRewardCoins: number) {
    setSwapFlowTaskId(taskId);
    setSelectedSwapTarget(null);
    setSwapOfferedCoins(Math.min(taskRewardCoins, 10));
    setSwapCandidates([]);
    setSwapCandidatesLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/cleaning/swap-candidates?taskId=${encodeURIComponent(taskId)}&email=${encodeURIComponent(activeEmail)}`
      );
      const data = await readJsonSafely<SwapCandidate[] | { error?: string }>(response);
      if (!response.ok || !Array.isArray(data)) {
        setMessage((data as { error?: string }).error ?? "Unable to load swap candidates.");
        setSwapFlowTaskId(null);
        return;
      }
      setSwapCandidates(data);
    } catch {
      setMessage("Unable to load swap candidates.");
      setSwapFlowTaskId(null);
    } finally {
      setSwapCandidatesLoading(false);
    }
  }

  async function submitSwapRequest(taskId: string) {
    if (!selectedSwapTarget) return;
    setSwapSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/swap-requests/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          requesterEmail: activeEmail,
          targetEmail: selectedSwapTarget.email,
          offeredCoins: swapOfferedCoins
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? "Unable to send swap request.");
        return;
      }
      setSwapFlowTaskId(null);
      setSelectedSwapTarget(null);
      await loadSwapRequests();
      setMessage(`Swap request sent to ${selectedSwapTarget.name}. They will see it in their Swap Requests section.`);
    } catch {
      setMessage("Unable to send swap request.");
    } finally {
      setSwapSubmitting(false);
    }
  }

  async function respondToSwap(requestId: string, action: "accept" | "decline" | "cancel") {
    setSwapActionLoading(requestId);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/swap-requests/${requestId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail })
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? `Unable to ${action} swap request.`);
        return;
      }
      await Promise.all([loadSwapRequests(), loadOverview(activeEmail, { refresh: true })]);
      setMessage(
        action === "accept"
          ? "Swap accepted! The task has been reassigned to you."
          : action === "decline"
            ? "Swap request declined."
            : "Swap request cancelled."
      );
    } catch {
      setMessage(`Unable to ${action} swap request.`);
    } finally {
      setSwapActionLoading(null);
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
  const nextCleaningCardTask = useMemo(
    () =>
      [...(overview?.tasks ?? [])]
        .filter((task) => shouldShowNextCleaningCard(task))
        .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null,
    [overview]
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

  const selectedDateSelfAssignByType = useMemo(() => {
    const statuses = new Map<CleaningTask["type"], SelfAssignAvailability>();
    for (const type of allowedTaskTypes) {
      statuses.set(type, getSelfAssignAvailability(selectedDate, type, overview));
    }
    return statuses;
  }, [allowedTaskTypes, overview, selectedDate]);

  const hasAnySelfAssignOption = useMemo(
    () => [...selectedDateSelfAssignByType.values()].some((status) => status.available),
    [selectedDateSelfAssignByType]
  );

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
        <h1 className="text-2xl font-semibold text-slate-900">{t("cleaningScheduleTitle", "Cleaning Schedule")}</h1>

        <form onSubmit={handleLogin} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex flex-wrap gap-3">
            {!(isLoggedIn && activeEmail && (loading || overview)) ? (
            <button
              type="submit"
              disabled={loading || !activeEmail}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? t("refreshing", "Loading...") : t("loadCleaningSchedule", "Load cleaning schedule")}
            </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refreshOverviewNow()}
              disabled={refreshing || !activeEmail}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {refreshing ? t("refreshingSchedule", "Refreshing...") : t("refreshSchedule", "Refresh schedule")}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {nextCleaningCardTask && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-200 text-amber-700 shadow-sm">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-amber-900 uppercase tracking-tight">{t("nextCleaning", "Your Next Cleaning")}</h2>
                <p className="text-xl font-black text-slate-900">
                  {formatCozoroDate(nextCleaningCardTask.scheduledDate, { weekday: "long", month: "long", day: "numeric" })}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-white/60 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-amber-200 uppercase">{prettyTaskType(nextCleaningCardTask.type)}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${canCompleteTaskLate(nextCleaningCardTask) ? "bg-rose-100 text-rose-700 ring-1 ring-rose-200" : canCompleteTaskNow(nextCleaningCardTask) ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200" : "bg-white/70 text-amber-800 ring-1 ring-amber-200"}`}>
                    {getNextCleaningCardLabel(nextCleaningCardTask)}
                  </span>
                  <span className="text-[10px] font-bold text-amber-700">
                    +{canCompleteTaskLate(nextCleaningCardTask) ? Math.round(nextCleaningCardTask.rewardCoins * 0.5) : nextCleaningCardTask.rewardCoins} Coins
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {canCompleteTaskLate(nextCleaningCardTask)
                    ? t("nextCleaningDueNow", "Due now. Late submissions stay open until {deadline} and earn 50% coins.").replace("{deadline}", formatCozoroDateTime(getLateDeadline(nextCleaningCardTask)))
                    : canCompleteTaskNow(nextCleaningCardTask)
                      ? t("nextCleaningCanDone", "You can mark this done during {window}.").replace("{window}", getCompletionWindow(nextCleaningCardTask).label)
                      : t("nextCleaningOpensSoon", "Mark done opens during {window}.").replace("{window}", getCompletionWindow(nextCleaningCardTask).label)}
                </p>
                {nextCleaningCardTask.type === "TRASH_D7" && nextCleaningCardTask.floor ? (
                  <p className="mt-1 text-xs text-slate-500">{t("floorLabel", "Floor")} {nextCleaningCardTask.floor}</p>
                ) : null}
              </div>
            </div>
            <div className="md:min-w-[220px]">
              <button
                type="button"
                onClick={() => void markDone(nextCleaningCardTask.id)}
                disabled={loading || (!canCompleteTaskNow(nextCleaningCardTask) && !canCompleteTaskLate(nextCleaningCardTask))}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${canCompleteTaskLate(nextCleaningCardTask) ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {canCompleteTaskLate(nextCleaningCardTask) ? t("markDoneLateCardBtn", "Mark done (late - 50% coins)") : t("markDoneCardBtn", "Mark done")}
              </button>
            </div>
          </div>
        </section>
      )}

      {optOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">{t("optOutModalTitle", "Opt out of cleaning")} — {currentMonthLabel}</h3>
            <p className="mt-2 text-sm text-slate-600">
              {t("optOutModalDesc", "You will be exempt from all cleaning assignments this month. A fee will be charged.")}
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => setOptOutPayment("VND")}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${optOutPayment === "VND" ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">{t("pay100kVnd", "Pay 100,000 VND")}</p>
                  <p className="text-xs text-slate-500">{t("pay100kVndDesc", "A fine will be added to your account.")}</p>
                </div>
                {optOutPayment === "VND" && <div className="h-4 w-4 rounded-full bg-slate-900" />}
              </button>
              <button
                onClick={() => setOptOutPayment("COINS")}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${optOutPayment === "COINS" ? "border-amber-500 bg-amber-50 ring-2 ring-amber-500" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">{t("pay150kCoins", "Pay 150,000 Coins")}</p>
                  <p className="text-xs text-slate-500">{t("pay150kCoinsDesc", "Deducted from your coin balance immediately.")}</p>
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
                {optOutLoading ? t("processingOptOut", "Processing...") : t("confirmOptOut", "Confirm Opt Out")}
              </button>
              <button
                onClick={() => setOptOutModal(false)}
                disabled={optOutLoading}
                className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm text-slate-700 disabled:opacity-60"
              >
                {t("cancel", "Cancel")}
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
                    {formatCozoroDate(activeMenuDate, { weekday: "long", month: "long", day: "numeric" })}
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
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("taskActionsHeader", "Task Actions")}</div>
                    <div className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase ring-1 ring-amber-200">
                      {t("coinsBonusBadge", "+50% Coins Bonus")}
                    </div>
                  </div>

                  {allowedTaskTypes.length === 0 && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
                      {t("noCleaningProfile", "Your cleaning profile hasn't been set up yet. Contact your manager to be added to the system.")}
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
                              <p className="text-sm font-bold text-amber-900">{t("takeOver", "Take Over")}</p>
                              <p className="text-xs text-amber-700">{prettyTaskType(type)} — {t("takeOverDesc", "assigned person hasn't completed it yet")}</p>
                            </div>
                            <div className="ml-auto text-[10px] font-bold text-amber-600">{t("selfAssignBonusPercent", "+50%")}</div>
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
                        <div className="ml-auto text-[10px] font-bold text-amber-600">{t("selfAssignBonusPercent", "+50%")}</div>
                      </button>
                    );
                  })}

                  {(overview.tasks ?? []).filter(t => sameDay(new Date(t.scheduledDate), activeMenuDate)).map(task => {
                    const releasePenalty = getReleasePenalty(task);
                    const releasesUsed = overview.releasesThisMonth ?? 0;
                    const releaseLimit = overview.monthlyReleaseLimit ?? 3;
                    const atMonthlyLimit = !releasePenalty.isSelfAssignedFree && releasesUsed >= releaseLimit;
                    const canRelease = releasePenalty.canRelease && !atMonthlyLimit;
                    const isDismissed = task.status === "REJECTED" && isDismissedOverdueTask(task.auditorNote);
                    const auditorNote = formatDismissedOverdueTaskNote(task.auditorNote);
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
                            <span className={`text-xs font-semibold ${isDismissed ? "text-slate-500 line-through" : "text-rose-500 line-through"}`}>+{task.rewardCoins.toLocaleString()} coins</span>
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
                        {task.status === "REJECTED" && auditorNote && (
                          <div className={`rounded-lg border px-3 py-2 ${isDismissed ? "bg-slate-50 border-slate-200" : "bg-rose-50 border-rose-100"}`}>
                            <p className={`text-xs font-semibold ${isDismissed ? "text-slate-700" : "text-rose-700"}`}>
                              {isDismissed ? t("taskDismissed") : t("notApproved")}
                            </p>
                            <p className={`text-xs mt-0.5 ${isDismissed ? "text-slate-600" : "text-rose-600"}`}>{auditorNote}</p>
                          </div>
                        )}
                        {task.status === "APPROVED" && (
                          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                            <p className="text-xs font-semibold text-emerald-700">Approved — +{task.rewardCoins.toLocaleString()} coins added to your account</p>
                          </div>
                        )}
                        {/* Find swap partner (preferred removal path) */}
                        {task.status === "ASSIGNED" && isFutureDate(new Date(task.scheduledDate)) && (
                          <div className="space-y-2">
                            {swapFlowTaskId !== task.id ? (
                              <button
                                type="button"
                                disabled={loading || swapCandidatesLoading}
                                onClick={() => void openSwapFlow(task.id, task.rewardCoins)}
                                className="flex w-full items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-left transition-all hover:bg-sky-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-sky-900">{t("swapFindPartnerBtn", "Find swap partner")}</p>
                                  <p className="text-xs text-sky-700">Offer coins to another resident to take your slot — no auto-fine</p>
                                </div>
                              </button>
                            ) : (
                              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-semibold text-sky-900">{t("swapSelectCandidate", "Select a resident to request a swap")}</p>
                                  <button
                                    type="button"
                                    onClick={() => { setSwapFlowTaskId(null); setSelectedSwapTarget(null); }}
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                  >
                                    {t("swapCancelFlowBtn", "Cancel")}
                                  </button>
                                </div>
                                {swapCandidatesLoading ? (
                                  <p className="text-sm text-sky-700">{t("swapCandidatesLoading", "Loading available residents...")}</p>
                                ) : swapCandidates.length === 0 ? (
                                  <p className="text-sm text-slate-600">{t("swapNoCandidates", "No available residents found for this date.")}</p>
                                ) : (
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {swapCandidates.map((candidate) => (
                                      <button
                                        key={candidate.email}
                                        type="button"
                                        onClick={() => setSelectedSwapTarget(candidate)}
                                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${selectedSwapTarget?.email === candidate.email ? "border-sky-500 bg-sky-100 ring-2 ring-sky-400" : "border-slate-200 hover:bg-slate-50"}`}
                                      >
                                        <div>
                                          <p className="text-sm font-medium text-slate-900">{candidate.name}</p>
                                          <p className="text-xs text-slate-500">{candidate.bedDisplay}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5">
                                          {candidate.availabilityType === "PREFERRED" && (
                                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{t("swapPreferredBadge", "Preferred")}</span>
                                          )}
                                          {candidate.availabilityType === "AVAILABLE" && (
                                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{t("swapAvailableBadge", "Available")}</span>
                                          )}
                                          {candidate.hasSameDayTask && (
                                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{t("swapConflictWarning", "Already has a task that day")}</span>
                                          )}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {selectedSwapTarget && (
                                  <div className="space-y-2 pt-1 border-t border-sky-200">
                                    <label className="block text-xs font-medium text-slate-700">
                                      {t("swapOfferCoinsLabel", "Offer coins (0 = no incentive, max = task reward)")}
                                      <input
                                        type="number"
                                        min={0}
                                        max={task.rewardCoins}
                                        value={swapOfferedCoins}
                                        onChange={(e) => setSwapOfferedCoins(Math.max(0, Math.min(task.rewardCoins, Number(e.target.value) || 0)))}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                                      />
                                      <span className="text-[10px] text-slate-500">Max: {task.rewardCoins} coins (= task reward)</span>
                                    </label>
                                    <button
                                      type="button"
                                      disabled={swapSubmitting}
                                      onClick={() => void submitSwapRequest(task.id)}
                                      className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                                    >
                                      {swapSubmitting ? t("swapSendingBtn", "Sending...") : t("swapSendRequestBtn", "Send swap request")}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Direct removal (with fine) */}
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
          <section className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-4 sm:gap-y-1">
              <h2 className="text-sm font-semibold text-slate-900">{t("cleaningProfileTitle")}</h2>
              <p className="text-sm text-slate-700">
                <span className="text-slate-500">{t("branchLabel")}</span>{" "}
                <span className="font-medium text-slate-900">{overview.user?.branchId ?? "—"}</span>
                <span className="mx-2 text-slate-300" aria-hidden>
                  ·
                </span>
                <span className="text-slate-500">{t("floorLabel")}</span>{" "}
                <span className="font-medium text-slate-900">{overview.user?.floor ?? "—"}</span>
                <span className="mx-2 text-slate-300" aria-hidden>
                  ·
                </span>
                <span className="text-slate-500">{t("name")}</span>{" "}
                <span className="font-medium text-slate-900 break-words">{overview.user?.name ?? sessionEmail}</span>
              </p>
            </div>
          </section>

          {/* Swap Requests inbox */}
          {swapRequestsData && (swapRequestsData.sent.length > 0 || swapRequestsData.received.length > 0 || swapRequestsData.pendingReceivedCount > 0) && (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{t("swapRequestsTitle", "Swap Requests")}</h2>
                {swapRequestsData.pendingReceivedCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    {t("swapRequestsPendingBadge", "{count} pending").replace("{count}", String(swapRequestsData.pendingReceivedCount))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowSwapHelp((v) => !v)}
                  className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-600"
                  title={t("swapHelpTitle", "How does swap work?")}
                >
                  ?
                </button>
              </div>
              {showSwapHelp && (
                <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700 whitespace-pre-line">
                  {t("swapHelp")}
                </div>
              )}

              {/* Received requests */}
              {swapRequestsData.received.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t("swapReceivedSection", "Received")}</div>
                  <div className="space-y-2">
                    {swapRequestsData.received.map((req) => (
                      <div
                        key={req.id}
                        className={`rounded-xl border p-4 ${req.status === "PENDING" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {t("swapFrom", "From")}: {req.requesterName ?? req.requesterEmail}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {prettyTaskType(req.taskType)} — {formatCozoroDate(req.taskScheduledDate, { weekday: "short", month: "short", day: "numeric" })}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {req.offeredCoins > 0
                                ? t("swapOfferedCoins", "Offer: {coins} coins").replace("{coins}", String(req.offeredCoins))
                                : t("swapOfferedNoCoins", "No coin offer")}
                            </p>
                          </div>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            req.status === "PENDING" ? "bg-amber-100 text-amber-800" :
                            req.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" :
                            "bg-slate-200 text-slate-600"
                          }`}>
                            {req.status === "PENDING" ? t("swapStatusPending") :
                             req.status === "ACCEPTED" ? t("swapStatusAccepted") :
                             req.status === "DECLINED" ? t("swapStatusDeclined") :
                             t("swapStatusCancelled")}
                          </span>
                        </div>
                        {req.status === "PENDING" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={swapActionLoading === req.id}
                              onClick={() => void respondToSwap(req.id, "accept")}
                              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {swapActionLoading === req.id ? "..." : t("swapAcceptBtn", "Accept")}
                            </button>
                            <button
                              type="button"
                              disabled={swapActionLoading === req.id}
                              onClick={() => void respondToSwap(req.id, "decline")}
                              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {t("swapDeclineBtn", "Decline")}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sent requests */}
              {swapRequestsData.sent.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t("swapSentSection", "Sent")}</div>
                  <div className="space-y-2">
                    {swapRequestsData.sent.map((req) => (
                      <div
                        key={req.id}
                        className={`rounded-xl border p-4 ${req.status === "PENDING" ? "border-sky-200 bg-sky-50/60" : "border-slate-200 bg-slate-50"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {t("swapTo", "To")}: {req.targetName ?? req.targetEmail}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {prettyTaskType(req.taskType)} — {formatCozoroDate(req.taskScheduledDate, { weekday: "short", month: "short", day: "numeric" })}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {req.offeredCoins > 0
                                ? t("swapOfferedCoins", "Offer: {coins} coins").replace("{coins}", String(req.offeredCoins))
                                : t("swapOfferedNoCoins", "No coin offer")}
                            </p>
                          </div>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            req.status === "PENDING" ? "bg-sky-100 text-sky-800" :
                            req.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" :
                            "bg-slate-200 text-slate-600"
                          }`}>
                            {req.status === "PENDING" ? t("swapStatusPending") :
                             req.status === "ACCEPTED" ? t("swapStatusAccepted") :
                             req.status === "DECLINED" ? t("swapStatusDeclined") :
                             t("swapStatusCancelled")}
                          </span>
                        </div>
                        {req.status === "PENDING" && (
                          <div className="mt-3">
                            <button
                              type="button"
                              disabled={swapActionLoading === req.id}
                              onClick={() => void respondToSwap(req.id, "cancel")}
                              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {swapActionLoading === req.id ? "..." : t("swapCancelBtn", "Cancel request")}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Opt-out section */}
          <section className={`rounded-2xl p-5 shadow-sm ring-1 ${overview.optOut || overview.contractOptOut ? "bg-slate-100 ring-slate-300" : "bg-white ring-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{t("cleaningOptOutTitle", "Cleaning Opt-out")} — {currentMonthLabel}</div>
                {overview.contractOptOut ? (
                  <p className="mt-0.5 text-sm text-slate-600">
                    {t("contractCleaningOptedOut", "You are exempt from cleaning assignments for your current contract. Cleaning fee: {amount}/month.")
                      .replace("{amount}", `${overview.contractOptOut.cleaningFeeVnd.toLocaleString(language === "vi" ? "vi-VN" : "en-US")} VND`)}
                  </p>
                ) : overview.optOut ? (
                  <p className="mt-0.5 text-sm text-slate-600">
                    {t("cleaningOptedOut", "You have opted out this month (paid via {method}). You will not be assigned to any cleaning tasks.")
                      .replace("{method}", overview.optOut.paymentMethod === "COINS" ? "150,000 coins" : "100,000 VND")}
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {t("cleaningOptOutDesc", "Pay 100,000 VND or 150,000 coins to be exempt from all cleaning assignments this month.")}
                  </p>
                )}
              </div>
              {overview.contractOptOut ? (
                <div className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  {t("cleaningFeeActive", "Cleaning fee active")}
                </div>
              ) : overview.optOut ? (
                <button
                  onClick={() => void handleCancelOptOut()}
                  disabled={optOutLoading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60 hover:bg-white transition-colors"
                >
                  {optOutLoading ? "..." : t("cancelOptOut", "Cancel opt-out")}
                </button>
              ) : (
                <button
                  onClick={() => setOptOutModal(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  {t("optOutThisMonth", "Opt out this month")}
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
                          const monthLabel = formatCozoroMonth(new Date(Number(year), Number(mon) - 1, 1));
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
                    onClick={() => {
                      const enablingAwayMode = !awayMode;
                      setAwayMode(enablingAwayMode);
                      setAwayDates(new Set());
                      if (enablingAwayMode) {
                        const today = startOfDay(new Date());
                        setCalendarFocusDate(today);
                        setSelectedDate(today);
                      }
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${awayMode ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    {awayMode ? t("cancelAwayBtn", "Cancel Away") : t("markAwayBtn", "Mark Away")}
                  </button>
                  <button
                    type="button"
                    id="mark-away-help-trigger"
                    aria-expanded={markAwayHelpOpen}
                    aria-controls="mark-away-help-panel"
                    onClick={() => setMarkAwayHelpOpen((v) => !v)}
                    className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full border border-slate-400/80 bg-white text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    title={t("markAwayHelpTitle", "What is Mark Away?")}
                  >
                    ?
                  </button>
                </div>
              </div>

              {markAwayHelpOpen ? (
                <p
                  id="mark-away-help-panel"
                  role="region"
                  aria-labelledby="mark-away-help-trigger"
                  className="mt-3 rounded-xl border border-orange-200/90 bg-orange-50/90 px-4 py-3 text-sm text-slate-800 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-50"
                >
                  {t("markAwayHelp")}
                </p>
              ) : null}

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  {formatCozoroMonth(calendarFocusDate)}
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
                      {awaySubmitting ? t("savingAway", "Saving...") : t("markAwayBtn", "Mark Away")}
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
                  const canMarkAway = isTodayOrFuture(day);

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => {
                        if (awayMode) {
                          if (!canMarkAway) {
                            setMessage(t("pastUnavailableError", "Past dates cannot be marked unavailable."));
                            return;
                          }
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
                        awayMode && !canMarkAway ? "cursor-not-allowed bg-slate-100 text-slate-400 opacity-60" :
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
                {formatCozoroDate(selectedDate, {
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

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveAvailability("UNAVAILABLE")}
                    disabled={loading || !isTodayOrFuture(selectedDate)}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 disabled:opacity-60"
                  >
                    {t("markUnavailableBtn", "Mark unavailable")}
                  </button>
                  <button
                    type="button"
                    id="mark-unavailable-help-trigger"
                    aria-expanded={markUnavailableHelpOpen}
                    aria-controls="mark-unavailable-help-panel"
                    onClick={() => setMarkUnavailableHelpOpen((v) => !v)}
                    className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full border border-rose-300/90 bg-white text-sm font-bold text-rose-800 shadow-sm hover:bg-rose-50 dark:border-rose-600 dark:bg-rose-950/50 dark:text-rose-100 dark:hover:bg-rose-900/40"
                    title={t("markUnavailableHelpTitle", "What does Mark unavailable do?")}
                  >
                    ?
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void saveAvailability("AVAILABLE")}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("markAvailableBtn", "Mark available")}
                </button>
              </div>

              {markUnavailableHelpOpen ? (
                <p
                  id="mark-unavailable-help-panel"
                  role="region"
                  aria-labelledby="mark-unavailable-help-trigger"
                  className="mt-3 rounded-xl border border-rose-200/90 bg-rose-50/90 px-4 py-3 text-sm font-medium leading-relaxed text-slate-950 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-100"
                >
                  {t(
                    "markUnavailableHelp",
                    "This saves your choice for the selected date only: scheduling will treat you as not available for cleaning duty that day. Use Mark available to clear it. Add an optional note above if needed. To block several days at once, use Mark Away on the calendar."
                  )}
                </p>
              ) : null}

              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-slate-900">Assign myself on this date</div>
                  <button
                    type="button"
                    onClick={() => setShowAssignHelp((v) => !v)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400 text-xs font-bold text-emerald-700"
                    aria-label={t("autoScheduleHelpTitle", "How does auto-scheduling work?")}
                    title={t("autoScheduleHelpTitle", "How does auto-scheduling work?")}
                  >
                    ?
                  </button>
                </div>
                {showAssignHelp && (
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700 whitespace-pre-line">
                    {t("autoScheduleHelp")}
                  </div>
                )}
                {!hasAnySelfAssignOption && allowedTaskTypes.length > 0 ? (
                  <p className="mt-2 text-sm text-amber-700">
                    {(() => {
                      const blocked = [...selectedDateSelfAssignByType.values()].find((status) => !status.available && !status.hidden);
                      if (blocked?.reasonKey) {
                        return t(blocked.reasonKey, blocked.reasonFallback ?? t("cannotSelfAssign"));
                      }
                      return blocked?.reasonFallback ?? t("cannotSelfAssign");
                    })()}
                  </p>
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
                          {formatCozoroDate(`${date}T12:00:00`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3">
                  {allowedTaskTypes.map((type) => {
                    const availability = selectedDateSelfAssignByType.get(type) ?? { available: false };
                    if (availability.hidden) {
                      return null;
                    }

                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => void prepareSelfAssignment(type)}
                        disabled={loading || !availability.available}
                        className={
                          availability.available
                            ? "rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                            : "cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-left text-sm text-slate-400 opacity-60"
                        }
                      >
                        <span className={availability.available ? "" : "text-slate-500"}>{prettyTaskType(type)}</span>
                        {!availability.available ? (
                          <span className="mt-0.5 block text-xs font-medium text-slate-400">
                            {t("notAvailableForSelfAssign", "Not available for self assign")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
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
                      {formatCozoroDate(`${pendingSelfAssignment.date}T12:00:00`)}
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
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Upcoming Tasks</h2>
                <button
                  type="button"
                  onClick={() => setShowPolicyHelp((v) => !v)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-semibold text-slate-700"
                  aria-label="Show mark done instructions"
                  title="Mark done instructions"
                >
                  ?
                </button>
                <button
                  type="button"
                  onClick={() => setShowReleaseHelp((v) => !v)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-300 text-sm font-semibold text-rose-700"
                  aria-label={t("removalHelpTitle", "Removal and reassignment rules")}
                  title={t("removalHelpTitle", "Removal and reassignment rules")}
                >
                  ?
                </button>
              </div>
              {showPolicyHelp && (
                <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700 space-y-2">
                  <p><span className="font-semibold">Mark done window:</span> You can submit on the assigned date. D7 kitchen tasks are only open from 17:00 to 23:00 on that date.</p>
                  <p><span className="font-semibold">Late submission:</span> You may still mark the task done up to 10 hours after the deadline and earn 50% of the normal coin reward. After 10 hours the task is marked missed automatically.</p>
                </div>
              )}
              {showReleaseHelp && (
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-slate-700 whitespace-pre-line">
                  {t("removalHelp")}
                </div>
              )}
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
                      {prettyTaskType(task.type)} - {formatCozoroDate(task.scheduledDate)}
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
                            Deadline passed. You had until {formatCozoroDateTime(getLateDeadline(task))} to submit late.
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {t("pastTasksTitle", "Past Tasks")}
                  </h2>
                  {pastTasks.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPastTasksExpanded((current) => !current)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    >
                      {pastTasksExpanded ? t("pastTasksHide", "Hide past tasks") : t("pastTasksShow", "Show past tasks")}
                    </button>
                  ) : null}
                </div>
                {pastTasks.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">{t("noPastTasksYet", "No past tasks yet.")}</p>
                ) : pastTasksExpanded ? (
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
                    {filteredPastTasks.length === 0 ? (
                      <p className="text-sm text-slate-600">{t("noPastTasksMatchFilters", "No tasks match these filters.")}</p>
                    ) : null}
                    {visiblePastTasks.map((task) => (
                      <div key={task.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="font-medium text-slate-900">
                          {prettyTaskType(task.type)} - {formatCozoroDate(task.scheduledDate)}
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
                ) : null}
              </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
