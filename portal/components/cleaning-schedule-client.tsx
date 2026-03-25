"use client";

import { useEffect, useMemo, useState } from "react";
import { usePortalSession } from "./portal-session";
import { API_BASE_URL } from "../lib/api-base-url";

type CleaningTask = {
  id: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  branchId: string;
  floor: number | null;
  scheduledDate: string;
  status: "ASSIGNED" | "DONE_PENDING_AUDIT" | "APPROVED" | "REJECTED" | "MISSED";
  rewardCoins: number;
  completionNote?: string | null;
  auditorNote?: string | null;
};

type CleaningAvailability = {
  id: string;
  date: string;
  type: "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";
  note?: string | null;
};

type CleaningOverview = {
  tasks: CleaningTask[];
  availability: CleaningAvailability[];
  user?: {
    branchId: string;
    floor: number | null;
    name: string;
  } | null;
};

type PendingSelfAssignment = {
  type: CleaningTask["type"];
  date: string;
  canSubmit: boolean;
  reason?: string;
};

function prettyTaskType(type: CleaningTask["type"]) {
  if (type === "KITCHEN_D2") return "Vệ sinh bếp D2";
  if (type === "KITCHEN_D7") return "Vệ sinh bếp D7";
  return "Đổ rác D7";
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

function isFutureDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(new Date()).getTime();
}

function canReleaseTask(task: { scheduledDate: string }) {
  const taskDate = startOfDay(new Date(task.scheduledDate));
  const today = startOfDay(new Date());
  return taskDate.getTime() >= today.getTime();
}

function getReleasePenalty(task: { scheduledDate: string }) {
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
  const canSelfAssignSelectedDate = isFutureDate(selectedDate);
  const activeEmail = sessionEmail.trim().toLowerCase();

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

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

  async function prepareSelfAssignment(type: CleaningTask["type"]) {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }
    if (!canSelfAssignSelectedDate) {
      setMessage("Self-assignment is only available for future dates.");
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
                  
                  {allowedTaskTypes.map((type) => {
                    const isAssigned = (overview.tasks ?? []).some(t => sameDay(new Date(t.scheduledDate), activeMenuDate) && t.type === type);
                    if (isAssigned) return null;

                    return (
                      <button
                        key={type}
                        onClick={() => {
                          void prepareSelfAssignment(type);
                          setActiveMenuDate(null);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition-all hover:bg-slate-50 active:scale-[0.98]"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">Assign Myself</p>
                          <p className="text-xs text-slate-500">{prettyTaskType(type)}</p>
                        </div>
                        <div className="ml-auto text-[10px] font-bold text-amber-600">+20%</div>
                      </button>
                    );
                  })}

                  {(overview.tasks ?? []).filter(t => sameDay(new Date(t.scheduledDate), activeMenuDate)).map(task => (
                    <button
                      key={task.id}
                      onClick={() => {
                        void releaseTask(task.id);
                        setActiveMenuDate(null);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 text-left transition-all hover:bg-rose-50 active:scale-[0.98]"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-rose-900">Remove Myself</p>
                        <p className="text-xs text-rose-700">{prettyTaskType(task.type)}</p>
                      </div>
                    </button>
                  ))}

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
                </div>
              </div>

              <div className="mt-4 text-sm text-slate-600">
                {calendarFocusDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
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

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => {
                        setSelectedDate(startOfDay(day));
                        setActiveMenuDate(startOfDay(day));
                        setPendingSelfAssignment(null);
                        setSelfAssignSuggestions([]);
                        setDayNote(availability?.note ?? "");
                      }}
                      className={`min-h-[3.5rem] md:min-h-28 rounded-lg border p-1 md:p-2 text-left transition-all hover:border-slate-400 ${
                        isCurrentMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                      } ${isSelected ? "ring-1 ring-slate-900 border-slate-900" : ""} ${isToday ? "bg-slate-50 border-slate-400" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`text-[10px] md:text-xs font-semibold ${isToday ? "text-blue-600" : "text-slate-900"}`}>{day.getDate()}</div>
                        {availability?.type === "UNAVAILABLE" ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Unavailable"></div>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {tasks.map((task) => (
                          <div key={task.id} className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-800 md:h-auto md:w-full md:bg-slate-900 md:px-1.5 md:py-0.5 md:text-[10px] md:text-white md:truncate">
                            <span className="hidden md:inline">{prettyTaskType(task.type)}</span>
                          </div>
                        ))}
                        {availability && availability.type !== "AVAILABLE" && (
                          <div className="text-[8px] font-medium text-slate-500 uppercase hidden md:block">{availability.type === "UNAVAILABLE" ? "Off" : "Pref"}</div>
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
                  <p className="mt-2 text-sm text-amber-700">You can only assign yourself to future dates.</p>
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
                Reschedule policy: 5+ days notice has no fine, 1-4 days notice has a 50% fine, same-day notice has a
                75% fine, and missing the work is a full fine.
              </div>
              <div className="mt-4 space-y-3">
                {futureTasks.length === 0 ? <p className="text-sm text-slate-600">No upcoming tasks.</p> : null}
                {futureTasks.map((task) => {
                  const releasePenalty = getReleasePenalty(task);

                  return (
                  <div key={task.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="font-medium text-slate-900">
                      {prettyTaskType(task.type)} - {new Date(task.scheduledDate).toLocaleDateString()}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Status: {task.status} | Reward: {task.rewardCoins} coins
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
                          disabled={loading || !canCompleteTaskNow(task)}
                          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                        >
                          Mark done
                        </button>
                        {!canCompleteTaskNow(task) ? (
                          <div className="mt-2 text-sm text-amber-700">
                            You can only mark this task done during {getCompletionWindow(task).label}.
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void releaseTask(task.id)}
                          disabled={loading || !releasePenalty.canRelease}
                          className="mt-3 ml-3 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                        >
                          Remove myself ({releasePenalty.label})
                        </button>
                        {!releasePenalty.canRelease ? (
                          <div className="mt-2 text-sm text-amber-700">
                            {releasePenalty.helpText}
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">{releasePenalty.helpText}</div>
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
