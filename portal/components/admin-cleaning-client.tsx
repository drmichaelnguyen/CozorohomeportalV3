"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
const PRIVILEGED_EMAILS = new Set(["cozorohome@gmail.com", "dr.trongto@gmail.com"]);
const DEFAULT_PRIVILEGED_EMAIL = "cozorohome@gmail.com";
const OVERDUE_ASSIGNED_PAGE_SIZE = 5;
const DISMISSED_OVERDUE_TASK_NOTE_PREFIX = "[Dismissed overdue task]";

type AdminTask = {
  id: string;
  userEmail: string;
  userName?: string | null;
  /** Branch · bed · room · floor — joined on admin calendar load from active residents. */
  bedDisplay?: string | null;
  assignedByEmail?: string | null;
  assignedByName?: string | null;
  branchId: string;
  floor: number | null;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  scheduledDate: string;
  status: "ASSIGNED" | "DONE_PENDING_AUDIT" | "APPROVED" | "REJECTED" | "MISSED";
  rewardCoins: number;
  isSelfAssigned: boolean;
  assignmentSource?: "SYSTEM" | "MANAGER" | "SELF";
  calendarId?: string | null;
  completedAt?: string | null;
  completionNote?: string | null;
  completionPhoto?: string | null;
  auditorNote?: string | null;
};

type AdminCalendar = {
  calendarId: string;
  title: string;
  type: AdminTask["type"];
  branchId: string;
  floor: number | null;
  tasks: AdminTask[];
};

type AdminAvailableUser = {
  email: string;
  name: string;
  /** Branch · bed · room · floor — from API; email not shown in assign UI. */
  bedDisplay?: string;
  branchId: string;
  floor: number | null;
  availabilityType: "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" | null;
  availabilityCount: number;
  totalTaskCount: number;
  hasSameDayTask: boolean;
  sameDayTasks: Array<{
    id: string;
    type: AdminTask["type"];
    scheduledDate: string;
  }>;
};

function assignUserPickerLabel(user: AdminAvailableUser, t: (key: string, fallback?: string, params?: Record<string, string>) => string) {
  const bed = user.bedDisplay?.trim() || user.branchId;
  return `${user.name} — ${bed} | ${t("tasksCount", "tasks {count}", { count: String(user.totalTaskCount) })}`;
}

type AutoAssignPreview = {
  date: string;
  user: AdminAvailableUser | null;
};

type CleaningReviewQueuePayload = {
  pendingAudit: Array<{
    id: string;
    userEmail: string;
    userName: string | null;
    bedDisplay: string | null;
    branchId: string;
    floor: number | null;
    type: AdminTask["type"];
    scheduledDate: string;
    status: string;
    rewardCoins: number;
    completedAt: string | null;
    completionNote: string | null;
    completionPhoto: string | null;
  }>;
  overdueAssigned: Array<{
    id: string;
    userEmail: string;
    userName: string | null;
    bedDisplay: string | null;
    branchId: string;
    floor: number | null;
    type: AdminTask["type"];
    scheduledDate: string;
    status: string;
    rewardCoins: number;
    hasAutomaticFine: boolean;
    suggestedFineAmount: number;
    missedFineDeadlineAt: string;
  }>;
};

type AutoSchedulerConfig = {
  enabled: boolean;
  autoMissedCleaningFines: boolean;
  updatedAt: string;
  updatedBy: string;
  jobs: Array<{
    key: string;
    type: AdminTask["type"];
    branchId: string;
    floor: number | null;
    title: string;
    enabled: boolean;
    fillUnassignedDates: boolean;
    horizonDays: number;
    updatedAt: string;
    updatedBy: string;
  }>;
};

function prettyTaskType(type: AdminTask["type"], t: (key: any, ...args: any[]) => string) {
  if (type === "KITCHEN_D2") return t("kitchenD2");
  if (type === "KITCHEN_D7") return t("kitchenD7");
  return t("trashD7");
}

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
  return startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toApiDate(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarKey(calendar: Pick<AdminCalendar, "type" | "floor">) {
  return calendar.type === "TRASH_D7" ? `${calendar.type}:${calendar.floor ?? "none"}` : calendar.type;
}

/** Short given-name style token (last whitespace segment); email → compact local part. */
function adminCalendarShortName(nameOrEmail: string) {
  const raw = nameOrEmail.trim();
  if (!raw) return "—";
  if (raw.includes("@")) {
    const local = (raw.split("@")[0] ?? "").replace(/[._]+/g, " ");
    const parts = local.split(/\s+/).filter(Boolean);
    const token = (parts.length ? parts[parts.length - 1] : local) ?? local;
    return token.length > 14 ? `${token.slice(0, 13)}…` : token;
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] ?? raw;
  }
  const last = parts[parts.length - 1] ?? raw;
  return last.length > 16 ? `${last.slice(0, 15)}…` : last;
}

function adminCalendarBedDigits(
  bedDisplay: string | null | undefined,
  task: Pick<AdminTask, "branchId" | "floor" | "type">
) {
  if (bedDisplay) {
    const match = bedDisplay.match(/Bed\s*(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  if (task.type === "TRASH_D7" && task.floor != null) {
    return `F${task.floor}`;
  }
  return "";
}

function adminCalendarMobileCellLine(task: AdminTask) {
  const name = adminCalendarShortName(task.userName?.trim() || task.userEmail);
  const bed = adminCalendarBedDigits(task.bedDisplay, task);
  return bed ? `${name} · ${bed}` : name;
}

function isFutureDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(new Date()).getTime();
}

function getAssignerLabel(task: Pick<AdminTask, "assignmentSource" | "isSelfAssigned" | "assignedByName" | "assignedByEmail">, t: (key: any, ...args: any[]) => string) {
  if (task.assignmentSource === "SYSTEM") {
    return t("systemAssigned");
  }
  if (task.assignmentSource === "SELF" || task.isSelfAssigned) {
    return t("selfAssigned");
  }
  return task.assignedByName?.trim() || task.assignedByEmail?.trim() || t("cozoroShortName");
}

function getSchedulerJobLabel(
  job: AutoSchedulerConfig["jobs"][number],
  t: (key: string, fallback?: string) => string
) {
  if (job.type === "TRASH_D7" && job.floor != null) {
    return `${job.title} (${job.branchId} · ${t("floorLabel")} ${job.floor})`;
  }
  return `${job.title} (${job.branchId})`;
}

export function AdminCleaningClient() {
  const { t, language } = usePortalLanguage();
  const dateLocale = language === "vi" ? "vi-VN" : "en-US";
  const { sessionEmail } = usePortalSession();
  const activeEmail = sessionEmail || DEFAULT_PRIVILEGED_EMAIL;
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedCalendarKey, setSelectedCalendarKey] = useState<string>("");
  const [calendarFocusDate, setCalendarFocusDate] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [availableUsers, setAvailableUsers] = useState<AdminAvailableUser[]>([]);
  const [selectedAssignEmail, setSelectedAssignEmail] = useState("");
  const [pendingConflict, setPendingConflict] = useState<{
    email: string;
    conflicts: Array<{ id: string; type: AdminTask["type"]; scheduledDate: string }>;
  } | null>(null);
  const [autoAssignPreview, setAutoAssignPreview] = useState<AutoAssignPreview[]>([]);
  const [selectedAutoAssignDates, setSelectedAutoAssignDates] = useState<string[]>([]);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [showSchedulerHelp, setShowSchedulerHelp] = useState(false);
  const [auditingTaskId, setAuditingTaskId] = useState<string | null>(null);
  const [auditNote, setAuditNote] = useState("");
  const [rejectFineDialog, setRejectFineDialog] = useState<{ taskId: string; userEmail: string; scheduledDate: string } | null>(null);
  const [rejectFineCreate, setRejectFineCreate] = useState(false);
  const [rejectFineAmount, setRejectFineAmount] = useState("50000");
  const [rejectFineSendEmail, setRejectFineSendEmail] = useState(false);
  const [missedFineSendEmail, setMissedFineSendEmail] = useState(false);
  const [bulkOverdueLoading, setBulkOverdueLoading] = useState(false);
  const [autoSchedulerConfig, setAutoSchedulerConfig] = useState<AutoSchedulerConfig | null>(null);
  const [autoSchedulerSaving, setAutoSchedulerSaving] = useState(false);
  const [showAutoScheduler, setShowAutoScheduler] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<CleaningReviewQueuePayload | null>(null);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [overdueAssignedVisibleCount, setOverdueAssignedVisibleCount] = useState(OVERDUE_ASSIGNED_PAGE_SIZE);
  const [editingFineTaskId, setEditingFineTaskId] = useState<string | null>(null);
  const [editingFineAmount, setEditingFineAmount] = useState<string>("");
  const selectedCalendar =
    calendars.find((entry) => calendarKey(entry) === selectedCalendarKey) ?? calendars[0] ?? null;
  const selectedSchedulerJob =
    autoSchedulerConfig && selectedCalendar
      ? autoSchedulerConfig.jobs.find((job) => job.key === calendarKey(selectedCalendar)) ?? null
      : null;
  const canAssignSelectedDate = isFutureDate(selectedDate);

  const selectedDayTasks = useMemo(() => {
    if (!selectedCalendar) {
      return [];
    }

    return selectedCalendar.tasks.filter((task) => sameDay(new Date(task.scheduledDate), selectedDate));
  }, [selectedCalendar, selectedDate]);

  const monthDays = useMemo(() => {
    const start = startOfMonthGrid(calendarFocusDate);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [calendarFocusDate]);

  const overdueAssignedSortedNewestFirst = useMemo(() => {
    if (!reviewQueue?.overdueAssigned.length) {
      return [];
    }
    return [...reviewQueue.overdueAssigned].sort(
      (a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()
    );
  }, [reviewQueue]);

  useEffect(() => {
    setOverdueAssignedVisibleCount(OVERDUE_ASSIGNED_PAGE_SIZE);
  }, [reviewQueue]);

  async function readJsonSafely<T>(response: Response) {
    const bodyText = await response.text();
    return JSON.parse(bodyText) as T;
  }

  async function loadCalendars() {
    const params = new URLSearchParams();
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
    const response = await fetch(`${API_BASE_URL}/admin/cleaning/calendars?${params.toString()}`);
    const data = await readJsonSafely<{ calendars?: AdminCalendar[]; error?: string }>(response);

    if (!response.ok) {
      throw new Error(data.error ?? t("adminCleaningErrLoadCalendars"));
    }

    const nextCalendars = data.calendars ?? [];
    setCalendars(nextCalendars);
    setSelectedCalendarKey((current) => current || (nextCalendars[0] ? calendarKey(nextCalendars[0]) : ""));
  }

  async function reloadAll() {
    await loadCalendars();
  }

  async function loadReviewQueue() {
    setReviewQueueLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/admin/cleaning/review-queue?actorEmail=${encodeURIComponent(activeEmail)}`
      );
      const data = await readJsonSafely<{
        pendingAudit?: CleaningReviewQueuePayload["pendingAudit"];
        overdueAssigned?: CleaningReviewQueuePayload["overdueAssigned"];
        error?: string;
      }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrReviewQueue"));
        return;
      }
      setReviewQueue({
        pendingAudit: data.pendingAudit ?? [],
        overdueAssigned: data.overdueAssigned ?? []
      });
      setMessage(t("adminCleaningReviewQueueLoaded"));
    } catch {
      setMessage(t("adminCleaningErrReviewQueue"));
    } finally {
      setReviewQueueLoading(false);
    }
  }

  async function issueMissedCleaningFine(taskId: string, customAmount?: number, sendEmail?: boolean) {
    setLoading(true);
    setMessage("");
    setEditingFineTaskId(null);
    try {
      const body: Record<string, unknown> = { actorEmail: activeEmail };
      if (customAmount != null && customAmount > 0) body.customAmount = customAmount;
      if (sendEmail) body.sendEmail = true;
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks/${encodeURIComponent(taskId)}/missed-fine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await readJsonSafely<{ error?: string; fineAmount?: number }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrMissedFine"));
        return;
      }
      await Promise.all([reloadAll(), loadReviewQueue()]);
      setMessage(t("adminCleaningMissedFineIssued", undefined, { amount: String(data.fineAmount ?? "") }));
    } catch {
      setMessage(t("adminCleaningErrMissedFine"));
    } finally {
      setLoading(false);
    }
  }

  async function dismissOverdueCleaningTask(taskId: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks/${encodeURIComponent(taskId)}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: activeEmail })
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrDismissTask"));
        return;
      }
      await Promise.all([reloadAll(), loadReviewQueue()]);
      setMessage(t("adminCleaningTaskDismissed"));
    } catch {
      setMessage(t("adminCleaningErrDismissTask"));
    } finally {
      setLoading(false);
    }
  }

  async function bulkProcessOverdueTasks(action: "fine" | "dismiss", taskIds: string[], sendEmail?: boolean) {
    setBulkOverdueLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/overdue/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: activeEmail, taskIds, action, sendEmail: sendEmail ?? false })
      });
      const data = await readJsonSafely<{ processed?: number; failed?: number; error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrMissedFine"));
        return;
      }
      await Promise.all([reloadAll(), loadReviewQueue()]);
      const failNote = (data.failed ?? 0) > 0 ? ` (${data.failed} failed)` : "";
      setMessage(`${action === "fine" ? t("adminCleaningIssueMissedFine") : t("adminCleaningDismissTask")}: ${data.processed ?? 0} done${failNote}`);
    } catch {
      setMessage(t("adminCleaningErrMissedFine"));
    } finally {
      setBulkOverdueLoading(false);
    }
  }

  async function runOverdueSweepManual() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/overdue/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: activeEmail })
      });
      const data = await readJsonSafely<{
        error?: string;
        markedMissed?: number;
        missedTaskSweepSkipped?: boolean;
        evasion?: { charged?: number };
      }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrOverdueRun"));
        return;
      }
      await Promise.all([reloadAll(), loadReviewQueue()]);
      const parts = [
        t("adminCleaningOverdueRunResult", undefined, {
          marked: String(data.markedMissed ?? 0),
          evasion: String(data.evasion?.charged ?? 0)
        })
      ];
      if (data.missedTaskSweepSkipped) {
        parts.push(t("adminCleaningOverdueRunSkippedMissed"));
      }
      setMessage(parts.join(" "));
    } catch {
      setMessage(t("adminCleaningErrOverdueRun"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAutoSchedulerConfig() {
    const response = await fetch(`${API_BASE_URL}/admin/cleaning/auto-scheduler-config?actorEmail=${encodeURIComponent(activeEmail)}`);
    const data = await readJsonSafely<AutoSchedulerConfig & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(data.error ?? t("adminCleaningErrLoadAutoScheduler"));
    }
    setAutoSchedulerConfig({
      ...data,
      autoMissedCleaningFines: data.autoMissedCleaningFines ?? true
    });
  }

  async function saveAutoSchedulerConfig() {
    if (!autoSchedulerConfig) return;
    setAutoSchedulerSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/auto-scheduler-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: activeEmail,
          enabled: autoSchedulerConfig.enabled,
          autoMissedCleaningFines: autoSchedulerConfig.autoMissedCleaningFines,
          jobs: autoSchedulerConfig.jobs.map((job) => ({
            key: job.key,
            enabled: job.enabled,
            fillUnassignedDates: job.fillUnassignedDates,
            horizonDays: job.horizonDays
          }))
        })
      });
      const data = await readJsonSafely<AutoSchedulerConfig & { error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrSaveAutoScheduler"));
        return;
      }
      setAutoSchedulerConfig(data);
      setMessage(t("adminCleaningAutoSchedulerSaved"));
    } catch {
      setMessage(t("adminCleaningErrSaveAutoScheduler"));
    } finally {
      setAutoSchedulerSaving(false);
    }
  }

  function getNextSevenOpenDates() {
    if (!selectedCalendar) {
      return [];
    }

    const dates: string[] = [];
    let cursor = addDays(startOfDay(new Date()), 1);

    while (dates.length < 7) {
      const hasTask = selectedCalendar.tasks.some((task) => sameDay(new Date(task.scheduledDate), cursor));
      if (!hasTask) {
        dates.push(toApiDate(cursor));
      }
      cursor = addDays(cursor, 1);
    }

    return dates;
  }

  async function loadAvailableUsers(all = false) {
    if (!selectedCalendar) {
      setMessage(t("adminCleaningChooseCalendarFirst"));
      return;
    }
    if (!canAssignSelectedDate) {
      setMessage(t("assignmentFutureOnly"));
      return;
    }

    setLoading(true);
    setMessage("");
    setPendingConflict(null);

    try {
      const params = new URLSearchParams({
        date: toApiDate(selectedDate),
        type: selectedCalendar.type
      });
      // TRASH_D7 slots are per floor; kitchen tasks use all branch residents ΓÇö never send floor for kitchen.
      if (selectedCalendar.type === "TRASH_D7" && selectedCalendar.floor != null) {
        params.set("floor", String(selectedCalendar.floor));
      }
      if (all) {
        params.set("showAll", "true");
      }

      const response = await fetch(`${API_BASE_URL}/admin/cleaning/available-users?${params.toString()}`);
      const data = await readJsonSafely<{ users?: AdminAvailableUser[]; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrLoadSuggestedUsers"));
        return;
      }

      const nextUsers = data.users ?? [];
      setAvailableUsers(nextUsers);
      setSelectedAssignEmail(nextUsers[0]?.email ?? "");
      setMessage(
        nextUsers.length > 0
          ? all
            ? t("adminCleaningUsersLoadedCount", { count: String(nextUsers.length) })
            : t("adminCleaningSuggestedUsersLoaded")
          : t("adminCleaningNoEligibleUsersDate")
      );
    } catch {
      setMessage(t("adminCleaningErrLoadSuggestedUsers"));
    } finally {
      setLoading(false);
    }
  }

  async function removeTask(taskId: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE"
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrRemoveTask"));
        return;
      }
      await reloadAll();
      setMessage(t("adminCleaningTaskRemoved"));
    } catch {
      setMessage(t("adminCleaningErrRemoveTask"));
    } finally {
      setLoading(false);
    }
  }

  async function assignSelectedUser(force = false) {
    if (!selectedCalendar || !selectedAssignEmail) {
      setMessage(t("adminCleaningChooseSuggestedUserFirst"));
      return;
    }
    if (!canAssignSelectedDate) {
      setMessage(t("assignmentFutureOnly"));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actorEmail: activeEmail,
          email: selectedAssignEmail,
          date: toApiDate(selectedDate),
          type: selectedCalendar.type,
          floor: selectedCalendar.floor ?? undefined,
          force
        })
      });
      const data = await readJsonSafely<{
        error?: string;
        conflicts?: Array<{ id: string; type: AdminTask["type"]; scheduledDate: string }>;
      }>(response);

      if (response.status === 409) {
        setPendingConflict({
          email: selectedAssignEmail,
          conflicts: data.conflicts ?? []
        });
        setMessage(data.error ?? t("adminCleaningUserHasTaskSameDay"));
        return;
      }

      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrAssignTask"));
        return;
      }

      await reloadAll();
      await loadAvailableUsers();
      setPendingConflict(null);
      setMessage(t("adminCleaningTaskAssigned"));
    } catch {
      setMessage(t("adminCleaningErrAssignTask"));
    } finally {
      setLoading(false);
    }
  }

  async function previewAutoAssignDates(dates: string[]) {
    if (!selectedCalendar) {
      setMessage(t("adminCleaningChooseCalendarFirst"));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const previews: AutoAssignPreview[] = [];
      const reservedEmails = new Set<string>();

      for (const date of dates) {
        const params = new URLSearchParams({
          date,
          type: selectedCalendar.type
        });
        if (selectedCalendar.type === "TRASH_D7" && selectedCalendar.floor != null) {
          params.set("floor", String(selectedCalendar.floor));
        }
        if (reservedEmails.size > 0) {
          params.set("excludeEmails", Array.from(reservedEmails).join(","));
        }

        const response = await fetch(`${API_BASE_URL}/admin/cleaning/available-users?${params.toString()}`);
        const data = await readJsonSafely<{ users?: AdminAvailableUser[]; error?: string }>(response);

        if (!response.ok) {
          throw new Error(data.error ?? t("adminCleaningErrPreviewUsersForDate", undefined, { date }));
        }

        const user = (data.users ?? [])[0] ?? null;
        if (user) {
          reservedEmails.add(user.email.toLowerCase());
        }

        previews.push({
          date,
          user
        });
      }

      setAutoAssignPreview(previews);
      setSelectedAutoAssignDates(previews.filter((entry) => entry.user).map((entry) => entry.date));
      setMessage(
        previews.length > 0 ? t("adminCleaningAutoPreviewReady") : t("adminCleaningNoOpenFutureDates")
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("adminCleaningErrAutoPreview"));
    } finally {
      setLoading(false);
    }
  }

  async function previewNextSevenDays() {
    const dates = getNextSevenOpenDates();
    await previewAutoAssignDates(dates);
  }

  async function commitAutoAssignments() {
    if (!selectedCalendar) {
      setMessage(t("adminCleaningChooseCalendarFirst"));
      return;
    }
    if (selectedAutoAssignDates.length === 0) {
      setMessage(t("adminCleaningChoosePreviewDatesFirst"));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/auto-assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actorEmail: activeEmail,
          dates: selectedAutoAssignDates,
          type: selectedCalendar.type,
          floor: selectedCalendar.floor ?? undefined
        })
      });
      const data = await readJsonSafely<{ assigned?: number; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrAutoAssignSelected"));
        return;
      }

      await reloadAll();
      setAutoAssignPreview([]);
      setSelectedAutoAssignDates([]);
      setMessage(
        t("adminCleaningAssignedDatesPushed", {
          assigned: String(data.assigned ?? 0)
        })
      );
    } catch {
      setMessage(t("adminCleaningErrAutoAssignSelected"));
    } finally {
      setLoading(false);
    }
  }

  async function auditTask(
    taskId: string,
    decision: "APPROVE" | "REJECT",
    opts?: { createFine?: boolean; fineAmount?: number; useEmptyNote?: boolean; sendEmail?: boolean }
  ) {
    setLoading(true);
    setMessage("");
    const notePayload =
      opts?.useEmptyNote === true ? undefined : auditNote.trim() || undefined;
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks/${taskId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: activeEmail,
          decision,
          note: notePayload,
          createFine: opts?.createFine ?? false,
          fineAmount: opts?.fineAmount,
          sendEmail: opts?.sendEmail ?? false
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrAuditTask"));
        return;
      }
      setAuditingTaskId(null);
      setAuditNote("");
      setRejectFineDialog(null);
      setRejectFineCreate(false);
      await reloadAll();
      if (reviewQueue) {
        await loadReviewQueue();
      }
      if (decision === "APPROVE") {
        setMessage(t("adminCleaningTaskApprovedCoins"));
      } else {
        setMessage(
          opts?.createFine ? t("adminCleaningTaskRejectedForfeitFine") : t("adminCleaningTaskRejectedForfeit")
        );
      }
    } catch {
      setMessage(t("adminCleaningErrAuditTask"));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoad(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      await loadCalendars();
      await loadAutoSchedulerConfig();
      setMessage(t("adminCleaningPrivilegedViewLoaded"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("adminCleaningErrLoadAdminView"));
    } finally {
      setLoading(false);
    }
  }

  async function syncCalendarsAndFillMissingDates() {
    if (!from || !to) {
      setMessage(t("adminCleaningChooseFromToFirst"));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: new Date(`${from}T00:00:00`).toISOString(),
          to: new Date(`${to}T23:59:59`).toISOString()
        })
      });
      const data = await readJsonSafely<{ imported?: number; created?: number; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? t("adminCleaningErrSyncCalendars"));
        return;
      }

      await reloadAll();
      setMessage(
        t("adminCleaningSyncImportedCreated", {
          imported: String(data.imported ?? 0),
          created: String(data.created ?? 0)
        })
      );
    } catch {
      setMessage(t("adminCleaningErrSyncCalendars"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">{t("adminCleaningHeader")}</h1>
          <button
            type="button"
            onClick={() => setShowSchedulerHelp((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-500 hover:bg-slate-200"
            aria-label={t("aboutLabel")}
          >
            ?
          </button>
        </div>
        {showSchedulerHelp && (
          <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            {t("adminCleaningHelpBlurb")}
          </div>
        )}

        <form onSubmit={handleLoad} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Authenticated as <span className="font-medium">{activeEmail}</span>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => setShowDateRange((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"
              aria-expanded={showDateRange}
            >
              <span>
                {t("adminCleaningDateRangeSection")}
                {from.trim() && to.trim() ? (
                  <span className="ml-2 font-normal text-slate-500">
                    ({from} → {to})
                  </span>
                ) : null}
              </span>
              <svg
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showDateRange ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {showDateRange ? (
            <>
              <label className="block text-sm font-medium text-slate-700">
                {t("fromLabel")}
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {t("toLabel")}
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </>
          ) : null}

          <div className="md:col-span-2 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {loading ? t("refreshing") : t("loadAdminCalendars")}
            </button>
            <button
              type="button"
              onClick={() => void syncCalendarsAndFillMissingDates()}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {t("pullExistingCalendarData")}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t("adminCleaningReviewQueueTitle")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("adminCleaningReviewQueueBlurb")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadReviewQueue()}
              disabled={reviewQueueLoading || loading}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
            >
              {reviewQueueLoading ? t("refreshing") : t("adminCleaningReviewQueueRefresh")}
            </button>
            <button
              type="button"
              onClick={() => void runOverdueSweepManual()}
              disabled={loading || reviewQueueLoading}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {t("adminCleaningRunOverdueSweep")}
            </button>
          </div>
        </div>

        {reviewQueue ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-amber-900">{t("adminCleaningPendingAuditTitle")}</h3>
              <p className="mt-1 text-xs text-slate-500">{t("adminCleaningPendingAuditHint")}</p>
              {reviewQueue.pendingAudit.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      void Promise.all(
                        reviewQueue.pendingAudit.map((task) => auditTask(task.id, "APPROVE", { useEmptyNote: true }))
                      );
                    }}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {t("approveLabel")} {language === "vi" ? "tất cả" : "all"} ({reviewQueue.pendingAudit.length})
                  </button>
                </div>
              ) : null}
              <ul className="mt-3 space-y-2">
                {reviewQueue.pendingAudit.length === 0 ? (
                  <li className="text-sm text-slate-600">{t("adminCleaningQueueEmpty")}</li>
                ) : (
                  reviewQueue.pendingAudit.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2 text-sm text-slate-800"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{task.userName?.trim() || task.userEmail}</div>
                          <div className="text-xs text-slate-500">
                            {prettyTaskType(task.type, t)} · {task.bedDisplay ?? task.branchId} ·{" "}
                            {new Date(task.scheduledDate).toLocaleDateString(dateLocale)}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">{task.userEmail}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => void auditTask(task.id, "APPROVE", { useEmptyNote: true })}
                            disabled={loading}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {t("approveLabel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAuditNote("");
                              setRejectFineDialog({
                                taskId: task.id,
                                userEmail: task.userEmail,
                                scheduledDate: task.scheduledDate
                              });
                            }}
                            disabled={loading}
                            className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            {t("rejectLabel")}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-rose-900">{t("adminCleaningOverdueAssignedTitle")}</h3>
              <p className="mt-1 text-xs text-slate-500">{t("adminCleaningOverdueAssignedHint")}</p>
              {overdueAssignedSortedNewestFirst.length > 0 ? (
                <>
                  <p className="mt-2 text-xs text-slate-500">
                    {t("adminCleaningOverdueShowingCount", undefined, {
                      visible: String(Math.min(overdueAssignedVisibleCount, overdueAssignedSortedNewestFirst.length)),
                      total: String(overdueAssignedSortedNewestFirst.length)
                    })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={missedFineSendEmail}
                        onChange={(e) => setMissedFineSendEmail(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600"
                      />
                      {language === "vi" ? "Gửi email thông báo" : "Send email notification"}
                    </label>
                    <button
                      type="button"
                      disabled={loading || bulkOverdueLoading}
                      onClick={() => void bulkProcessOverdueTasks(
                        "fine",
                        overdueAssignedSortedNewestFirst.map((t) => t.id),
                        missedFineSendEmail
                      )}
                      className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {t("adminCleaningIssueMissedFine")} ({overdueAssignedSortedNewestFirst.length})
                    </button>
                    <button
                      type="button"
                      disabled={loading || bulkOverdueLoading}
                      onClick={() => void bulkProcessOverdueTasks(
                        "dismiss",
                        overdueAssignedSortedNewestFirst.map((t) => t.id)
                      )}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t("adminCleaningDismissTask")} ({overdueAssignedSortedNewestFirst.length})
                    </button>
                  </div>
                </>
              ) : null}
              <ul className="mt-3 space-y-2">
                {overdueAssignedSortedNewestFirst.length === 0 ? (
                  <li className="text-sm text-slate-600">{t("adminCleaningQueueEmpty")}</li>
                ) : (
                  <>
                    {overdueAssignedSortedNewestFirst.slice(0, overdueAssignedVisibleCount).map((task) => (
                      <li
                        key={task.id}
                        className="rounded-xl border border-rose-200 bg-rose-50/40 px-3 py-2 text-sm text-slate-800"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-900">{task.userName?.trim() || task.userEmail}</div>
                            <div className="text-xs text-slate-500">
                              {prettyTaskType(task.type, t)} · {task.bedDisplay ?? task.branchId} ·{" "}
                              {new Date(task.scheduledDate).toLocaleDateString(dateLocale)}
                            </div>
                            <div className="mt-1 text-xs text-slate-600">{task.userEmail}</div>
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-rose-800">
                              {editingFineTaskId === task.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step={1000}
                                    value={editingFineAmount}
                                    onChange={(e) => setEditingFineAmount(e.target.value)}
                                    className="w-24 rounded border border-rose-300 px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-400"
                                    autoFocus
                                  />
                                  <span className="text-rose-700">VND</span>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingFineTaskId(null); setEditingFineAmount(""); }}
                                    className="ml-1 text-slate-500 hover:text-slate-700"
                                    title="Cancel"
                                  >✕</button>
                                </div>
                              ) : (
                                <>
                                  {t("adminCleaningSuggestedFine", undefined, {
                                    amount: task.suggestedFineAmount.toLocaleString(dateLocale)
                                  })}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingFineTaskId(task.id);
                                      setEditingFineAmount(String(task.suggestedFineAmount));
                                    }}
                                    className="ml-1 rounded p-0.5 text-rose-600 hover:bg-rose-100"
                                    title={language === "vi" ? "Sửa mức phạt" : "Edit fine amount"}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                      <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.751 2.751 0 0 1 .596-.892l7.262-7.262Z" />
                                    </svg>
                                  </button>
                                </>
                              )}
                              {!editingFineTaskId || editingFineTaskId !== task.id
                                ? task.hasAutomaticFine ? ` · ${t("adminCleaningFineMayExist")}` : null
                                : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const amt = editingFineTaskId === task.id ? Number(editingFineAmount) : undefined;
                                void issueMissedCleaningFine(task.id, amt && amt > 0 ? amt : undefined, missedFineSendEmail);
                              }}
                              disabled={loading}
                              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {t("adminCleaningIssueMissedFine")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void dismissOverdueCleaningTask(task.id)}
                              disabled={loading}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {t("adminCleaningDismissTask")}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </>
                )}
              </ul>
              {overdueAssignedSortedNewestFirst.length > overdueAssignedVisibleCount ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOverdueAssignedVisibleCount((c) => c + OVERDUE_ASSIGNED_PAGE_SIZE)
                    }
                    disabled={loading}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {t("adminCleaningOverdueLoadMore", undefined, {
                      n: String(OVERDUE_ASSIGNED_PAGE_SIZE)
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverdueAssignedVisibleCount(overdueAssignedSortedNewestFirst.length)}
                    disabled={loading}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {t("adminCleaningOverdueShowAll")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">{t("adminCleaningReviewQueuePrompt")}</p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-2">
          {calendars.map((calendar) => {
            const key = calendarKey(calendar);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedCalendarKey(key)}
                className={`rounded-full px-4 py-2 text-sm ${
                  key === selectedCalendarKey ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {calendar.title}
              </button>
            );
          })}
        </div>

        {selectedCalendar ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selectedCalendar.title}</h2>
                  <p className="text-sm text-slate-600">
                    {t("branchLabel")}: {selectedCalendar.branchId}
                    {selectedCalendar.floor ? ` | ${t("floorLabel")} ${selectedCalendar.floor}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth() - 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("previousNav")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(startOfDay(new Date()))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("todayNav")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth() + 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("nextNav")}
                  </button>
                </div>
              </div>

              {autoSchedulerConfig && selectedSchedulerJob ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <button
                    type="button"
                    onClick={() => setShowAutoScheduler((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{t("backgroundAutoScheduler")}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {t("controlSystemJob")} {getSchedulerJobLabel(selectedSchedulerJob, t)}.
                      </p>
                    </div>
                    <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showAutoScheduler ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showAutoScheduler && (
                  <>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void saveAutoSchedulerConfig()}
                      disabled={!autoSchedulerConfig || autoSchedulerSaving}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {autoSchedulerSaving ? t("saving") : t("saveLabel")}
                    </button>
                  </div>

                  <label className="mt-4 block rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-slate-800">
                    <div className="font-medium text-slate-900">{t("autoMissedCleaningFinesLabel")}</div>
                    <div className="mt-1 text-xs text-slate-600">{t("autoMissedCleaningFinesDesc")}</div>
                    <input
                      type="checkbox"
                      checked={autoSchedulerConfig.autoMissedCleaningFines ?? true}
                      onChange={(event) =>
                        setAutoSchedulerConfig((current) =>
                          current ? { ...current, autoMissedCleaningFines: event.target.checked } : current
                        )
                      }
                      className="mt-3 h-4 w-4 rounded border-slate-300"
                    />
                  </label>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{getSchedulerJobLabel(selectedSchedulerJob, t)}</div>
                    <div className="mt-1 text-xs text-slate-500">{t("adminCleaningSchedulerCalendarOnly")}</div>

                    <label className="mt-4 block">
                      <div className="font-medium text-slate-900">{t("enableThisJob")}</div>
                      <div className="mt-1 text-xs text-slate-500">{t("enableJobDesc", "Turn the background scheduler on or off for this specific cleaning slot.")}</div>
                      <input
                        type="checkbox"
                        checked={selectedSchedulerJob.enabled}
                        onChange={(event) =>
                          setAutoSchedulerConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  enabled: current.jobs.some((entry) =>
                                    entry.key === selectedSchedulerJob.key ? event.target.checked : entry.enabled
                                  ),
                                  jobs: current.jobs.map((entry) =>
                                    entry.key === selectedSchedulerJob.key ? { ...entry, enabled: event.target.checked } : entry
                                  )
                                }
                              : current
                          )
                        }
                        className="mt-3 h-4 w-4"
                      />
                    </label>

                    <label className="mt-4 block">
                      <div className="font-medium text-slate-900">{t("fillUnassignedDates")}</div>
                      <div className="mt-1 text-xs text-slate-500">{t("fillUnassignedDesc", "Stop automatic assignment for this slot while keeping other jobs running.")}</div>
                      <input
                        type="checkbox"
                        checked={selectedSchedulerJob.fillUnassignedDates}
                        onChange={(event) =>
                          setAutoSchedulerConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  jobs: current.jobs.map((entry) =>
                                    entry.key === selectedSchedulerJob.key ? { ...entry, fillUnassignedDates: event.target.checked } : entry
                                  )
                                }
                              : current
                          )
                        }
                        className="mt-3 h-4 w-4"
                      />
                    </label>

                    <label className="mt-4 block">
                      <div className="font-medium text-slate-900">{t("daysInAdvance")}</div>
                      <div className="mt-1 text-xs text-slate-500">{t("daysAdvanceDesc", "How far ahead the system should auto-schedule this specific cleaning job.")}</div>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={selectedSchedulerJob.horizonDays}
                        onChange={(event) =>
                          setAutoSchedulerConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  jobs: current.jobs.map((entry) =>
                                    entry.key === selectedSchedulerJob.key ? { ...entry, horizonDays: Number(event.target.value) || 1 } : entry
                                  )
                                }
                              : current
                          )
                        }
                        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    {t("lastUpdatedBy")} {autoSchedulerConfig.updatedBy || t("system")} {t("atTimeLabel")}{" "}
                    {autoSchedulerConfig.updatedAt
                      ? new Date(autoSchedulerConfig.updatedAt).toLocaleString(dateLocale)
                      : t("unknown")}
                    .
                  </p>
                  </>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:gap-2 sm:text-xs">
                {[t("mon"), t("tue"), t("wed"), t("thu"), t("fri"), t("sat"), t("sun")].map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {monthDays.map((date) => {
                  const dayTasks = selectedCalendar.tasks.filter((task) => sameDay(new Date(task.scheduledDate), date));
                  const isSelected = sameDay(date, selectedDate);
                  const isCurrentMonth = date.getMonth() === calendarFocusDate.getMonth();

                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      onClick={() => setSelectedDate(startOfDay(date))}
                      className={`relative flex min-h-[5.25rem] flex-col rounded-lg border p-1.5 text-left sm:min-h-28 sm:rounded-xl sm:p-3 ${
                        isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                      } ${!isCurrentMonth ? "opacity-45" : ""}`}
                    >
                      <span className="absolute right-1 top-1 text-[10px] font-semibold tabular-nums text-slate-400 sm:static sm:text-sm sm:font-semibold sm:text-slate-900">
                        {date.getDate()}
                      </span>
                      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 sm:mt-2 sm:space-y-1 sm:gap-0">
                        {dayTasks.slice(0, 3).map((task) => (
                          <div
                            key={task.id}
                            className={`rounded-md px-1 py-0.5 sm:truncate sm:px-2 sm:py-1 sm:text-xs ${
                              task.calendarId ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800 sm:border sm:border-amber-200"
                            }`}
                          >
                            <span className="hidden sm:inline">
                              {(task.assignmentSource === "SELF" || task.isSelfAssigned)
                                ? "★ "
                                : task.assignmentSource === "SYSTEM"
                                  ? "⚙ "
                                  : task.assignmentSource === "MANAGER"
                                    ? "👤 "
                                    : ""}
                              {task.userName || task.userEmail}
                            </span>
                            <span className="sm:hidden block text-left text-[11px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">
                              <span className="mr-0.5 align-middle text-[9px] font-normal opacity-80">
                                {(task.assignmentSource === "SELF" || task.isSelfAssigned)
                                  ? "★"
                                  : task.assignmentSource === "SYSTEM"
                                    ? "⚙"
                                    : task.assignmentSource === "MANAGER"
                                      ? "👤"
                                      : ""}
                              </span>
                              {adminCalendarMobileCellLine(task)}
                            </span>
                          </div>
                        ))}
                        {dayTasks.length > 3 ? (
                          <div className="text-[10px] text-slate-500 sm:text-xs">
                            +{dayTasks.length - 3} {t("moreLabel")}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="space-y-4 rounded-2xl border border-slate-200 p-4">
              <div>
                <div className="text-sm font-medium text-slate-500">{t("selectedDate")}</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{selectedDate.toLocaleDateString("vi-VN")}</div>
                {!canAssignSelectedDate ? (
                  <div className="mt-2 text-sm text-amber-700">{t("assignmentFutureOnly", "Assignment is only enabled for future dates.")}</div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAllUsers(false); void loadAvailableUsers(false); }}
                  disabled={loading || !canAssignSelectedDate}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {loading ? t("refreshing") : t("findBestUser")}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAllUsers(true); void loadAvailableUsers(true); }}
                  disabled={loading || !canAssignSelectedDate}
                  className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-700 disabled:opacity-60"
                >
                  {t("showAllUsers")}
                </button>
                <button
                  type="button"
                  onClick={() => void previewNextSevenDays()}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {t("autoAssignNext7Days")}
                </button>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">{t("tasksOnThisDay")}</h3>
                <div className="mt-2 space-y-3">
                  {selectedDayTasks.length === 0 ? (
                    <p className="text-sm text-slate-600">{t("noCleaningTaskOnThisDay")}</p>
                  ) : (
                    selectedDayTasks.map((task) => {
                      const isAuditing = auditingTaskId === task.id;
                      const isPast = !isFutureDate(new Date(task.scheduledDate));
                      const canRemoveAssigned = task.status === "ASSIGNED" && isFutureDate(new Date(task.scheduledDate));
                      const canAudit =
                        task.status === "DONE_PENDING_AUDIT" ||
                        (isPast && (task.status === "APPROVED" || (task.status === "REJECTED" && !isDismissedOverdueTask(task.auditorNote))));
                      const isDismissed = task.status === "REJECTED" && isDismissedOverdueTask(task.auditorNote);
                      const statusLabel = isDismissed
                        ? t("taskDismissed")
                        : t(`task${task.status.split("_").map(x => x.charAt(0) + x.slice(1).toLowerCase()).join("")}`);
                      const auditorNote = formatDismissedOverdueTaskNote(task.auditorNote);
                      const statusColors: Record<string, string> = {
                        ASSIGNED: "bg-sky-100 text-sky-700",
                        DONE_PENDING_AUDIT: "bg-amber-100 text-amber-700",
                        APPROVED: "bg-emerald-100 text-emerald-700",
                        REJECTED: "bg-rose-100 text-rose-700",
                        MISSED: "bg-slate-200 text-slate-600"
                      };
                      return (
                        <div key={task.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">{task.userName || task.userEmail}</div>
                              <div className="text-xs text-slate-500 truncate">{task.userEmail}</div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDismissed ? "bg-slate-200 text-slate-700" : statusColors[task.status] ?? "bg-slate-100 text-slate-600"}`}>
                                  {statusLabel}
                                </span>
                                {(task.assignmentSource === "SELF" || task.isSelfAssigned) ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                    ★ {t("selfShort")}
                                  </span>
                                ) : task.assignmentSource === "SYSTEM" ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                    ⚙ {t("autoShort")}
                                  </span>
                                ) : task.assignmentSource === "MANAGER" ? (
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                    👤 {t("roleManager")}
                                  </span>
                                ) : null}
                                {task.status === "REJECTED" ? (
                                  <span className="text-[11px] font-semibold text-rose-500 line-through">
                                    {t("coinsRewardPlus", { n: task.rewardCoins.toLocaleString(dateLocale) })}
                                  </span>
                                ) : task.status === "APPROVED" ? (
                                  <span className="text-[11px] font-semibold text-emerald-600">
                                    {t("coinsRewardPlus", { n: task.rewardCoins.toLocaleString(dateLocale) })}
                                  </span>
                                ) : (
                                  <span className={`text-[11px] ${isDismissed ? "text-slate-500 line-through" : "text-slate-500"}`}>
                                    {t("coinsRewardPlus", { n: task.rewardCoins.toLocaleString(dateLocale) })}
                                  </span>
                                )}
                              </div>
                              {task.completionNote && (
                                <p className="mt-1 text-xs text-slate-600 italic">"{task.completionNote}"</p>
                              )}
                              {task.completionPhoto && (
                                <a
                                  href={task.completionPhoto}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 inline-block text-xs text-sky-600 underline"
                                >
                                  {t("viewCompletionPhoto")}
                                </a>
                              )}
                              <p className="mt-1 text-xs text-slate-500">{t("assignerLabel")}: {getAssignerLabel(task, t)}</p>
                              {auditorNote && (
                                <p className={`mt-1 text-xs font-medium ${isDismissed ? "text-slate-600" : "text-rose-700"}`}>
                                  {isDismissed ? t("taskDismissed") : t("auditorNoteLabel")}: {auditorNote}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              {task.status === "ASSIGNED" && canRemoveAssigned ? (
                                <button
                                  type="button"
                                  onClick={() => void removeTask(task.id)}
                                  disabled={loading}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  {t("removeLabel")}
                                </button>
                              ) : task.status === "ASSIGNED" && !canRemoveAssigned ? (
                                <span className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
                                  {t("adminCleaningRemovePastBlocked")}
                                </span>
                              ) : null}
                              {canAudit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAuditingTaskId(isAuditing ? null : task.id);
                                    setAuditNote(task.auditorNote ?? "");
                                  }}
                                  disabled={loading}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  {isAuditing ? t("cancelLabel") : task.status === "DONE_PENDING_AUDIT" ? t("auditLabel") : t("reAuditLabel")}
                                </button>
                              )}
                              {task.status === "ASSIGNED" && isPast ? (
                                <button
                                  type="button"
                                  onClick={() => void dismissOverdueCleaningTask(task.id)}
                                  disabled={loading}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  {t("adminCleaningDismissTask")}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {isAuditing && (
                            <div className="border-t border-slate-200 pt-2 space-y-2">
                              <textarea
                                rows={2}
                                placeholder={t("auditorNotePlaceholder")}
                                value={auditNote}
                                onChange={(e) => setAuditNote(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void auditTask(task.id, "APPROVE")}
                                  disabled={loading}
                                  className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {t("approveLabel")} —{" "}
                                  {t("grantCoinsLabel", { count: task.rewardCoins.toLocaleString(dateLocale) })}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setRejectFineCreate(false); setRejectFineSendEmail(false); setRejectFineDialog({ taskId: task.id, userEmail: task.userEmail, scheduledDate: task.scheduledDate }); }}
                                  disabled={loading}
                                  className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  {t("rejectLabel")} — {t("forfeitCoinsLabel")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">{t("assignTaskLabel")}</h3>
                <p className="mt-1 text-xs text-slate-500">{t("assignTaskPickByBedNote")}</p>
                {availableUsers.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {t("findBestUserPrompt")}
                  </p>
                ) : (
                  <div className="mt-2 space-y-3">
                    <label className="block text-sm font-medium text-slate-700">
                      {showAllUsers ? t("allEligibleUsers") : t("suggestedUser")}
                      <select
                        value={selectedAssignEmail}
                        onChange={(event) => {
                          setSelectedAssignEmail(event.target.value);
                          setPendingConflict(null);
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        {availableUsers.map((user) => (
                          <option key={user.email} value={user.email}>
                            {assignUserPickerLabel(user, t)}
                            {user.availabilityType === "UNAVAILABLE"
                              ? ` | ${t("unavailableLabel")}`
                              : user.availabilityType === "PREFERRED"
                                ? ` | ${t("preferredLabel")}`
                                : ""}
                            {user.hasSameDayTask ? ` | ${t("alreadyBookedLabel")}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    {selectedAssignEmail ? (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                        {(() => {
                          const selectedUser = availableUsers.find((user) => user.email === selectedAssignEmail);
                          if (!selectedUser) {
                            return t("noUserSelected");
                          }

                          return (
                            <>
                              <div className="font-medium text-slate-900">{selectedUser.name}</div>
                              <div className="text-sm font-semibold text-sky-800">
                                {selectedUser.bedDisplay?.trim() || selectedUser.branchId}
                              </div>
                              <div>
                                {t("preferenceLabel")}: {selectedUser.availabilityType ?? t("noneLabel")} |{" "}
                              {t("availabilityScore")}: {selectedUser.availabilityCount}
                              </div>
                              <div>{t("totalTasksLabel")}: {selectedUser.totalTaskCount}</div>
                              {selectedUser.hasSameDayTask ? (
                                <div className="mt-2 text-amber-700">
                                  {t("alreadyBookedWarning")}
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void assignSelectedUser(false)}
                        disabled={loading || !selectedAssignEmail || !canAssignSelectedDate}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {t("assignTaskLabel")}
                      </button>
                      {pendingConflict ? (
                        <button
                          type="button"
                          onClick={() => void assignSelectedUser(true)}
                          disabled={loading || !canAssignSelectedDate}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 disabled:opacity-60"
                        >
                          {t("assignAnyway")}
                        </button>
                      ) : null}
                    </div>

                    {pendingConflict ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="font-medium">{t("adminWarning")}</div>
                        <div className="mt-1">
                          {t("userAlreadyHasTask", undefined, {
                            who: (() => {
                              const u = availableUsers.find((x) => x.email === pendingConflict.email);
                              return u ? `${u.name} — ${u.bedDisplay?.trim() || u.branchId}` : pendingConflict.email;
                            })()
                          })}
                        </div>
                        <div className="mt-2 space-y-1">
                          {pendingConflict.conflicts.map((conflict) => (
                            <div key={conflict.id}>
                              {t("adminCleaningTaskOnDate", {
                                task: prettyTaskType(conflict.type, t),
                                date: new Date(conflict.scheduledDate).toLocaleDateString(dateLocale)
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">{t("bulkAutoAssignment")}</h3>
                {autoAssignPreview.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {t("bulkAutoAssignPrompt")}
                  </p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {autoAssignPreview.map((entry) => (
                      <label key={entry.date} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                        <input
                          type="checkbox"
                          checked={selectedAutoAssignDates.includes(entry.date)}
                          onChange={(event) =>
                            setSelectedAutoAssignDates((current) =>
                              event.target.checked
                                ? [...current, entry.date]
                                : current.filter((value) => value !== entry.date)
                            )
                          }
                          className="mt-1"
                        />
                        <div className="text-sm text-slate-700">
                          <div className="font-medium text-slate-900">
                            {new Date(`${entry.date}T12:00:00`).toLocaleDateString(dateLocale)}
                          </div>
                          {entry.user ? (
                            <>
                              <div>
                                {t("suggestedLabel")}: {entry.user.name} — {entry.user.bedDisplay?.trim() || entry.user.branchId}
                              </div>
                              <div>
                                {t("availabilityLabel")}: {entry.user.availabilityType ?? t("noneLabel")} |{" "}
                                {t("availabilityScore")}: {entry.user.availabilityCount} | {t("totalTasksLabel")}:{" "}
                                {entry.user.totalTaskCount}
                              </div>
                            </>
                          ) : (
                            <div className="text-amber-700">{t("noEligibleUserFound")}</div>
                          )}
                        </div>
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => void commitAutoAssignments()}
                      disabled={loading || selectedAutoAssignDates.length === 0}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {t("submitSelectedDates")}
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">{t("loadCalendarsPrompt")}</p>
        )}
      </section>

      {rejectFineDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">{t("rejectTaskConfirm")}</h3>
            <p className="text-sm text-slate-600">
              {t("rejectingFor", {
                email: rejectFineDialog.userEmail,
                date: new Date(rejectFineDialog.scheduledDate).toLocaleDateString(dateLocale)
              })}
              {" "}{t("coinsWillBeForfeited")}
            </p>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rejectFineCreate}
                onChange={(e) => setRejectFineCreate(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-rose-600"
              />
              <span className="text-sm font-medium text-slate-700">{t("alsoCreateFineTicket")}</span>
            </label>

            {rejectFineCreate && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  {t("fineAmountLabel")}
                  <input
                    type="number"
                    value={rejectFineAmount}
                    onChange={(e) => setRejectFineAmount(e.target.value)}
                    min="1000"
                    step="1000"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rejectFineSendEmail}
                    onChange={(e) => setRejectFineSendEmail(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-rose-600"
                  />
                  <span className="text-sm text-slate-700">
                    {language === "vi" ? "Gửi email phiếu phạt" : "Send fine ticket email"}
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void auditTask(
                  rejectFineDialog.taskId,
                  "REJECT",
                  rejectFineCreate
                    ? { createFine: true, fineAmount: Number(rejectFineAmount), sendEmail: rejectFineSendEmail }
                    : undefined
                )}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {loading ? t("refreshing") : rejectFineCreate ? t("rejectIssueFine") : t("rejectLabel")}
              </button>
              <button
                type="button"
                onClick={() => { setRejectFineDialog(null); setRejectFineCreate(false); setRejectFineSendEmail(false); }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("cancelLabel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
