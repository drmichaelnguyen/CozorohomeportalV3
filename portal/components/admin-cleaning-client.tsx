"use client";

import { useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
const PRIVILEGED_EMAILS = new Set(["cozorohome@gmail.com", "dr.trongto@gmail.com"]);
const DEFAULT_PRIVILEGED_EMAIL = "cozorohome@gmail.com";

type AdminTask = {
  id: string;
  userEmail: string;
  userName?: string | null;
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

type AutoAssignPreview = {
  date: string;
  user: AdminAvailableUser | null;
};

type AutoSchedulerConfig = {
  enabled: boolean;
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
  return task.assignedByName?.trim() || task.assignedByEmail?.trim() || "Cozoro";
}

function getSchedulerJobLabel(job: AutoSchedulerConfig["jobs"][number]) {
  return job.type === "TRASH_D7" && job.floor ? `${job.title} (${job.branchId} floor ${job.floor})` : `${job.title} (${job.branchId})`;
}

export function AdminCleaningClient() {
  const { t } = usePortalLanguage();
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
  const [autoSchedulerConfig, setAutoSchedulerConfig] = useState<AutoSchedulerConfig | null>(null);
  const [autoSchedulerSaving, setAutoSchedulerSaving] = useState(false);
  const [showAutoScheduler, setShowAutoScheduler] = useState(false);
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
      throw new Error(data.error ?? "Unable to load cleaning calendars.");
    }

    const nextCalendars = data.calendars ?? [];
    setCalendars(nextCalendars);
    setSelectedCalendarKey((current) => current || (nextCalendars[0] ? calendarKey(nextCalendars[0]) : ""));
  }

  async function reloadAll() {
    await loadCalendars();
  }

  async function loadAutoSchedulerConfig() {
    const response = await fetch(`${API_BASE_URL}/admin/cleaning/auto-scheduler-config?actorEmail=${encodeURIComponent(activeEmail)}`);
    const data = await readJsonSafely<AutoSchedulerConfig & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load auto-scheduler settings.");
    }
    setAutoSchedulerConfig(data);
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
        setMessage(data.error ?? "Unable to save auto-scheduler settings.");
        return;
      }
      setAutoSchedulerConfig(data);
      setMessage("Auto-scheduler settings saved.");
    } catch {
      setMessage("Unable to save auto-scheduler settings.");
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
      setMessage("Choose a cleaning calendar first.");
      return;
    }
    if (!canAssignSelectedDate) {
      setMessage("Admin assignment is only available for future dates.");
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
      if (selectedCalendar.floor) {
        params.set("floor", String(selectedCalendar.floor));
      }
      if (all) {
        params.set("showAll", "true");
      }

      const response = await fetch(`${API_BASE_URL}/admin/cleaning/available-users?${params.toString()}`);
      const data = await readJsonSafely<{ users?: AdminAvailableUser[]; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to load suggested users.");
        return;
      }

      const nextUsers = data.users ?? [];
      setAvailableUsers(nextUsers);
      setSelectedAssignEmail(nextUsers[0]?.email ?? "");
      setMessage(nextUsers.length > 0 ? (all ? `${nextUsers.length} users loaded.` : "Suggested users loaded.") : "No eligible users available for this date.");
    } catch {
      setMessage("Unable to load suggested users.");
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
        setMessage(data.error ?? "Unable to remove task.");
        return;
      }
      await reloadAll();
      setMessage("Task removed.");
    } catch {
      setMessage("Unable to remove task.");
    } finally {
      setLoading(false);
    }
  }

  async function assignSelectedUser(force = false) {
    if (!selectedCalendar || !selectedAssignEmail) {
      setMessage("Choose a suggested user first.");
      return;
    }
    if (!canAssignSelectedDate) {
      setMessage("Admin assignment is only available for future dates.");
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
        setMessage(data.error ?? "This user already has another task on that date.");
        return;
      }

      if (!response.ok) {
        setMessage(data.error ?? "Unable to assign cleaning task.");
        return;
      }

      await reloadAll();
      await loadAvailableUsers();
      setPendingConflict(null);
      setMessage("Cleaning task assigned.");
    } catch {
      setMessage("Unable to assign cleaning task.");
    } finally {
      setLoading(false);
    }
  }

  async function previewAutoAssignDates(dates: string[]) {
    if (!selectedCalendar) {
      setMessage("Choose a cleaning calendar first.");
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
        if (selectedCalendar.floor) {
          params.set("floor", String(selectedCalendar.floor));
        }
        if (reservedEmails.size > 0) {
          params.set("excludeEmails", Array.from(reservedEmails).join(","));
        }

        const response = await fetch(`${API_BASE_URL}/admin/cleaning/available-users?${params.toString()}`);
        const data = await readJsonSafely<{ users?: AdminAvailableUser[]; error?: string }>(response);

        if (!response.ok) {
          throw new Error(data.error ?? `Unable to preview users for ${date}.`);
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
      setMessage(previews.length > 0 ? "Auto-assignment preview ready." : "No open future dates found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to build auto-assignment preview.");
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
      setMessage("Choose a cleaning calendar first.");
      return;
    }
    if (selectedAutoAssignDates.length === 0) {
      setMessage("Choose at least one preview date first.");
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
        setMessage(data.error ?? "Unable to auto-assign selected dates.");
        return;
      }

      await reloadAll();
      setAutoAssignPreview([]);
      setSelectedAutoAssignDates([]);
      setMessage(`Assigned ${data.assigned ?? 0} cleaning dates and pushed them to Google Calendar.`);
    } catch {
      setMessage("Unable to auto-assign selected dates.");
    } finally {
      setLoading(false);
    }
  }

  async function auditTask(taskId: string, decision: "APPROVE" | "REJECT", opts?: { createFine?: boolean; fineAmount?: number }) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/cleaning/tasks/${taskId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: activeEmail,
          decision,
          note: auditNote.trim() || undefined,
          createFine: opts?.createFine ?? false,
          fineAmount: opts?.fineAmount
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);
      if (!response.ok) {
        setMessage(data.error ?? "Unable to audit task.");
        return;
      }
      setAuditingTaskId(null);
      setAuditNote("");
      setRejectFineDialog(null);
      setRejectFineCreate(false);
      await reloadAll();
      if (decision === "APPROVE") {
        setMessage("Task approved — coins granted.");
      } else {
        setMessage(opts?.createFine ? "Task rejected — coins forfeited and fine issued." : "Task rejected — coins forfeited.");
      }
    } catch {
      setMessage("Unable to audit task.");
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
      setMessage("Privileged cleaning view loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load admin cleaning view.");
    } finally {
      setLoading(false);
    }
  }

  async function syncCalendarsAndFillMissingDates() {
    if (!from || !to) {
      setMessage("Choose a from and to date first.");
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
        setMessage(data.error ?? "Unable to sync cleaning calendars.");
        return;
      }

      await reloadAll();
      setMessage(`Imported ${data.imported ?? 0} calendar tasks and created ${data.created ?? 0} missing cleaning tasks.`);
    } catch {
      setMessage("Unable to sync cleaning calendars.");
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
            aria-label={t("aboutLabel", "About")}
          >
            ?
          </button>
        </div>
        {showSchedulerHelp && (
          <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            Admin and manager share this cleaning scheduler. View each cleaning calendar, inspect existing assignments, and assign future cleaning dates.
          </div>
        )}

        <form onSubmit={handleLoad} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Authenticated as <span className="font-medium">{activeEmail}</span>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            {t("fromLabel", "From")}
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            {t("toLabel", "To")}
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

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
                    {t("previousNav", "Prev")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(startOfDay(new Date()))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("todayNav", "Today")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarFocusDate(new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth() + 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {t("nextNav", "Next")}
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
                      <p className="mt-1 text-sm text-slate-600">{t("controlSystemJob", "Control the system job for")} {getSchedulerJobLabel(selectedSchedulerJob)}.</p>
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

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{getSchedulerJobLabel(selectedSchedulerJob)}</div>
                    <div className="mt-1 text-xs text-slate-500">These settings apply only to this selected calendar.</div>

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
                    {t("lastUpdatedBy", "Last updated by")} {autoSchedulerConfig.updatedBy || t("system")} at{" "}
                    {autoSchedulerConfig.updatedAt ? new Date(autoSchedulerConfig.updatedAt).toLocaleString("vi-VN") : t("unknown")}.
                  </p>
                  </>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
                {[t("mon", "Mon"), t("tue", "Tue"), t("wed", "Wed"), t("thu", "Thu"), t("fri", "Fri"), t("sat", "Sat"), t("sun", "Sun")].map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {monthDays.map((date) => {
                  const dayTasks = selectedCalendar.tasks.filter((task) => sameDay(new Date(task.scheduledDate), date));
                  const isSelected = sameDay(date, selectedDate);
                  const isCurrentMonth = date.getMonth() === calendarFocusDate.getMonth();

                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      onClick={() => setSelectedDate(startOfDay(date))}
                      className={`min-h-28 rounded-xl border p-3 text-left ${
                        isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                      } ${!isCurrentMonth ? "opacity-45" : ""}`}
                    >
                      <div className="text-sm font-semibold text-slate-900">{date.getDate()}</div>
                      <div className="mt-2 space-y-1">
                        {dayTasks.slice(0, 3).map((task) => (
                          <div key={task.id} className={`truncate rounded-md px-2 py-1 text-xs ${task.calendarId ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                            {(task.assignmentSource === "SELF" || task.isSelfAssigned) ? "★ " : task.assignmentSource === "SYSTEM" ? "⚙ " : task.assignmentSource === "MANAGER" ? "👤 " : ""}{task.userName || task.userEmail}
                          </div>
                        ))}
                        {dayTasks.length > 3 ? (
                          <div className="text-xs text-slate-500">+{dayTasks.length - 3} {t("moreLabel", "more")}</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="space-y-4 rounded-2xl border border-slate-200 p-4">
              <div>
                <div className="text-sm font-medium text-slate-500">{t("selectedDate", "Selected date")}</div>
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
                      const canAudit = task.status === "DONE_PENDING_AUDIT" || (isPast && (task.status === "APPROVED" || task.status === "REJECTED"));
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
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColors[task.status] ?? "bg-slate-100 text-slate-600"}`}>
                                  {t(`task${task.status.split("_").map(x => x.charAt(0) + x.slice(1).toLowerCase()).join("")}`)}
                                </span>
                                {(task.assignmentSource === "SELF" || task.isSelfAssigned) ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">★ {t("selfShort", "Self")}</span>
                                ) : task.assignmentSource === "SYSTEM" ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">⚙ {t("autoShort", "Auto")}</span>
                                ) : task.assignmentSource === "MANAGER" ? (
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">👤 {t("roleManager", "Manager")}</span>
                                ) : null}
                                {task.status === "REJECTED" ? (
                                  <span className="text-[11px] font-semibold text-rose-500 line-through">+{task.rewardCoins.toLocaleString()} coins</span>
                                ) : task.status === "APPROVED" ? (
                                  <span className="text-[11px] font-semibold text-emerald-600">+{task.rewardCoins.toLocaleString()} coins</span>
                                ) : (
                                  <span className="text-[11px] text-slate-500">+{task.rewardCoins.toLocaleString()} coins</span>
                                )}
                              </div>
                              {task.completionNote && (
                                <p className="mt-1 text-xs text-slate-600 italic">"{task.completionNote}"</p>
                              )}
                              {task.completionPhoto && (
                                <a href={task.completionPhoto} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-sky-600 underline">View photo</a>
                              )}
                              <p className="mt-1 text-xs text-slate-500">{t("assignerLabel")}: {getAssignerLabel(task, t)}</p>
                              {task.auditorNote && (
                                <p className="mt-1 text-xs text-rose-700 font-medium">{t("auditorNoteLabel")}: {task.auditorNote}</p>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              {task.status === "ASSIGNED" && (
                                <button
                                  type="button"
                                  onClick={() => void removeTask(task.id)}
                                  disabled={loading}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  {t("removeLabel")}
                                </button>
                              )}
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
                                  {isAuditing ? t("cancelLabel") : task.status === "DONE_PENDING_AUDIT" ? t("auditLabel", "Audit") : t("reAuditLabel", "Re-audit")}
                                </button>
                              )}
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
                                  {t("approveLabel", "Approve")} — {t("grantCoinsLabel", "grant +{count} coins", { count: task.rewardCoins.toLocaleString("vi-VN") })}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectFineDialog({ taskId: task.id, userEmail: task.userEmail, scheduledDate: task.scheduledDate })}
                                  disabled={loading}
                                  className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  {t("rejectLabel", "Reject")} — {t("forfeitCoinsLabel", "forfeit coins")}
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
                {availableUsers.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {t("findBestUserPrompt", "Click <span className=\"font-medium\">Find best user</span> to load recommended users for this date.")}
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
                            {user.name} ({user.email}) | {t("tasksCount", "tasks {count}", { count: user.totalTaskCount })}
                            {user.availabilityType === "UNAVAILABLE" ? ` | ${t("unavailableLabel", "UNAVAILABLE")}` : user.availabilityType === "PREFERRED" ? ` | ${t("preferredLabel", "preferred")}` : ""}
                            {user.hasSameDayTask ? ` | ${t("alreadyBookedLabel", "already booked")}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    {selectedAssignEmail ? (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                        {(() => {
                          const selectedUser = availableUsers.find((user) => user.email === selectedAssignEmail);
                          if (!selectedUser) {
                            return t("noUserSelected", "No user selected.");
                          }

                          return (
                            <>
                              <div className="font-medium text-slate-900">{selectedUser.name}</div>
                              <div>
                                {t("preferenceLabel")}: {selectedUser.availabilityType ?? t("noneLabel", "none")} | {t("availabilityScore")}: {selectedUser.availabilityCount}
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
                          {t("userAlreadyHasTask", "{email} already has task(s) on this date. You can still override this rule.", { email: pendingConflict.email })}
                        </div>
                        <div className="mt-2 space-y-1">
                          {pendingConflict.conflicts.map((conflict) => (
                            <div key={conflict.id}>
                              {prettyTaskType(conflict.type, t)} on {new Date(conflict.scheduledDate).toLocaleDateString("vi-VN")}
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
                    {t("bulkAutoAssignPrompt", "Preview open future dates first, then submit the selected dates when the suggestions look good.")}
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
                            {new Date(`${entry.date}T12:00:00`).toLocaleDateString()}
                          </div>
                          {entry.user ? (
                            <>
                              <div>
                                {t("suggestedLabel", "Suggested")}: {entry.user.name} ({entry.user.email})
                              </div>
                              <div>
                                {t("availabilityLabel", "Availability")}: {entry.user.availabilityType ?? t("noneLabel", "none")} | {t("availabilityScore")}: {entry.user.availabilityCount} | {t("totalTasksLabel")}: {entry.user.totalTaskCount}
                              </div>
                            </>
                          ) : (
                            <div className="text-amber-700">{t("noEligibleUserFound", "No eligible user found for this date.")}</div>
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
          <p className="mt-4 text-sm text-slate-600">{t("loadCalendarsPrompt", "Load the admin calendars first.")}</p>
        )}
      </section>

      {rejectFineDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">{t("rejectTaskConfirm")}</h3>
            <p className="text-sm text-slate-600">
              {t("rejectingFor", { email: rejectFineDialog.userEmail, date: new Date(rejectFineDialog.scheduledDate).toLocaleDateString("vi-VN") })}
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
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void auditTask(
                  rejectFineDialog.taskId,
                  "REJECT",
                  rejectFineCreate ? { createFine: true, fineAmount: Number(rejectFineAmount) } : undefined
                )}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {loading ? t("refreshing") : rejectFineCreate ? t("rejectIssueFine") : t("rejectLabel")}
              </button>
              <button
                type="button"
                onClick={() => { setRejectFineDialog(null); setRejectFineCreate(false); }}
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
