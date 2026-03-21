"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
const ADMIN_EMAILS = new Set(["cozorohome@gmail.com", "dr.trongto@gmail.com"]);
const HIDDEN_ADMIN_COLUMNS = new Set(["Địa chỉ email - Hidden"]);

type ClientRecord = Record<string, string>;

type ClientCachePayload = {
  rows: ClientRecord[];
  syncedAt: string;
};

type AdminLaundryEvent = {
  id: string;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: string;
  end: string;
  htmlLink: string;
};

type AdminLaundryCalendar = {
  id: string;
  summary: string;
  description: string;
  primary: boolean;
  selected: boolean;
  accessRole: string;
  events: AdminLaundryEvent[];
  error?: string;
};

type CalendarViewMode = "month" | "week" | "day";

const preferredFields = [
  "\u0110\u1ecba ch\u1ec9 email",
  "T\u00ean",
  "Gi\u1edbi t\u00ednh",
  "Chi nh\u00e1nh Cozoro dorm",
  "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i li\u00ean h\u1ec7",
  "s\u1ed1 gi\u01b0\u1eddng",
  "Hi\u1ec7n c\u00f2n \u1edf",
  "M\u00c3 HD",
  "Cozoro coins hi\u1ec7n c\u00f3",
  "T\u1ed5ng Coins t\u00edch lu\u1ef9",
  "Coins \u0111\u01b0\u1ee3c c\u1ed9ng th\u00e1ng n\u00e0y",
  "Cozoro coins s\u1eed d\u1ee5ng th\u00e1ng n\u00e0y",
  "S\u1ed1 l\u01b0\u1ee3t gi\u1eb7t",
  "S\u1ed1 l\u01b0\u1ee3t s\u1ea5y",
  "Cozoro Member",
  "Ch\u00fa th\u00edch"
];

function renderFields(client: ClientRecord) {
  return preferredFields
    .filter((field) => client[field])
    .map((field) => [field, client[field]] as const);
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

function formatRange(start: string, end: string) {
  return `${new Date(start).toLocaleString()} to ${new Date(end).toLocaleString()}`;
}

export function ClientLoginClient() {
  const { sessionEmail, isLoggedIn, login, logout, hasSavedPassword, savePassword, isPasswordMatch } =
    usePortalSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [cacheRows, setCacheRows] = useState<ClientRecord[]>([]);
  const [selectedMaHd, setSelectedMaHd] = useState("");
  const [adminForm, setAdminForm] = useState<Record<string, string>>({});
  const [laundryCalendars, setLaundryCalendars] = useState<AdminLaundryCalendar[]>([]);
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("week");
  const [calendarFocusDate, setCalendarFocusDate] = useState(() => startOfDay(new Date()));

  const normalizedEmail = email.trim().toLowerCase();
  const isAdmin = ADMIN_EMAILS.has(normalizedEmail);
  const isAdminSession = isLoggedIn && ADMIN_EMAILS.has(sessionEmail.trim().toLowerCase());
  const passwordAlreadySaved = hasSavedPassword(normalizedEmail);

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
  }, [sessionEmail]);

  const selectedClient = useMemo(
    () => cacheRows.find((row) => row["M\u00c3 HD"] === selectedMaHd) ?? null,
    [cacheRows, selectedMaHd]
  );
  const calendarEvents = useMemo(
    () =>
      laundryCalendars
        .flatMap((calendar) =>
          calendar.events.map((event) => ({
            ...event,
            calendarSummary: calendar.summary
          }))
        )
        .sort((left, right) => left.start.localeCompare(right.start)),
    [laundryCalendars]
  );

  function fillAdminForm(nextClient: ClientRecord | null) {
    if (!nextClient) {
      setAdminForm({});
      return;
    }

    setAdminForm(
      Object.fromEntries(
        Object.entries(nextClient).filter(([field]) => !HIDDEN_ADMIN_COLUMNS.has(field))
      )
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setClient(null);
    setCacheRows([]);
    setSelectedMaHd("");
    setAdminForm({});
    setLaundryCalendars([]);

    try {
      if (!password.trim()) {
        setMessage(
          passwordAlreadySaved
            ? "Enter your saved password to log in."
            : "Create a password the first time you log in on this device."
        );
        return;
      }

      const clientResponse = await fetch(
        `${API_BASE_URL}/clients?email=${encodeURIComponent(normalizedEmail)}`
      );
      const clientData = (await clientResponse.json()) as ClientRecord | { error?: string };

      if (!clientResponse.ok) {
        setMessage(
          typeof clientData === "object" && clientData !== null && "error" in clientData && typeof clientData.error === "string"
            ? clientData.error
            : "Only emails from the user list can log in."
        );
        return;
      }

      if (passwordAlreadySaved) {
        if (!isPasswordMatch(normalizedEmail, password)) {
          setMessage("Incorrect password for this email on this device.");
          return;
        }
      } else {
        savePassword(normalizedEmail, password);
      }

      if (isAdmin) {
        const [cacheResponse, laundryResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/clients/cache`),
          fetch(`${API_BASE_URL}/admin/laundry-calendars`)
        ]);
        const data = (await cacheResponse.json()) as ClientCachePayload | { error?: string };
        const laundryData = (await laundryResponse.json()) as
          | { calendars?: AdminLaundryCalendar[]; error?: string }
          | undefined;

        if (!cacheResponse.ok) {
          setMessage(
            typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
              ? data.error
              : "Unable to load admin client cache."
          );
          return;
        }

        const rows = (data as ClientCachePayload).rows;
        setCacheRows(rows);
        const firstClient = rows[0] ?? null;
        setSelectedMaHd(firstClient?.["M\u00c3 HD"] ?? "");
        fillAdminForm(firstClient);
        if (laundryResponse.ok) {
          setLaundryCalendars(laundryData?.calendars ?? []);
        }
        login(normalizedEmail);
        setPassword("");
        setMessage(passwordAlreadySaved ? "Admin view loaded." : "Password created. Admin view loaded.");
        return;
      }

      login(normalizedEmail);
      setClient(clientData as ClientRecord);
      setPassword("");
      setMessage(
        passwordAlreadySaved ? "Client information loaded." : "Password created. Client information loaded."
      );
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets has been connected.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAdminCache() {
    setLoading(true);
    setMessage("");

    try {
      const [response, laundryResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients/sync`, { method: "POST" }),
        fetch(`${API_BASE_URL}/admin/laundry-calendars`)
      ]);
      const data = (await response.json()) as ClientCachePayload | { error?: string };
      const laundryData = (await laundryResponse.json()) as
        | { calendars?: AdminLaundryCalendar[]; error?: string }
        | undefined;

      if (!response.ok) {
        setMessage(
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to refresh admin cache."
        );
        return;
      }

      const rows = (data as ClientCachePayload).rows;
      setCacheRows(rows);
      const nextClient = rows.find((row) => row["M\u00c3 HD"] === selectedMaHd) ?? rows[0] ?? null;
      setSelectedMaHd(nextClient?.["M\u00c3 HD"] ?? "");
      fillAdminForm(nextClient);
      if (laundryResponse.ok) {
        setLaundryCalendars(laundryData?.calendars ?? []);
      }
      setMessage("Admin cache refreshed from Google Sheets and Calendar.");
    } catch {
      setMessage("Unable to refresh from Google Sheets.");
    } finally {
      setLoading(false);
    }
  }

  async function saveAdminChanges() {
    if (!selectedClient?.["M\u00c3 HD"]) {
      setMessage("Choose a client first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/clients/${encodeURIComponent(selectedClient["M\u00c3 HD"])}/sheet-update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(adminForm)
        }
      );

      const data = (await response.json()) as ClientCachePayload | { error?: string };

      if (!response.ok) {
        setMessage(
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to update client data."
        );
        return;
      }

      const rows = (data as ClientCachePayload).rows;
      setCacheRows(rows);
      const nextClient = rows.find((row) => row["M\u00c3 HD"] === selectedClient["M\u00c3 HD"]) ?? null;
      fillAdminForm(nextClient);
      setMessage("Client data updated in Google Sheets.");
    } catch {
      setMessage("Unable to save client changes.");
    } finally {
      setLoading(false);
    }
  }

  const shownFields = client ? renderFields(client) : [];
  const shownAdminFields = selectedClient ? renderFields(selectedClient) : [];
  const monthDays = useMemo(() => {
    const gridStart = startOfMonthGrid(calendarFocusDate);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [calendarFocusDate]);
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(calendarFocusDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [calendarFocusDate]);
  const dayEvents = calendarEvents.filter((event) => sameDay(new Date(event.start), calendarFocusDate));

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Client Login</h1>
        <p className="mt-2 text-sm text-slate-600">
          This is a local demo role check. Normal users see their own row. Admin can browse and edit the full client profile.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Only emails that exist in the active user list can log in.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          First login on this browser creates a password for that email. Later logins must use the same password.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Enter client email"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder={passwordAlreadySaved ? "Enter saved password" : "Create password"}
            />
          </label>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Checking..." : "Login"}
            </button>
            <div className="text-sm text-slate-600">
              Role: {isAdmin ? "Admin" : "Normal user"}
            </div>
            {isLoggedIn ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Use another email
              </button>
            ) : null}
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {isAdminSession ? (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Active Users</h2>
              <button
                type="button"
                onClick={() => void refreshAdminCache()}
                disabled={loading}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
              >
                Refresh from Sheet
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {cacheRows.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Login as admin after Google sync is connected to load active users.
                </p>
              ) : null}

              {cacheRows.map((row) => {
                const maHd = row["M\u00c3 HD"];
                const isSelected = maHd === selectedMaHd;
                return (
                  <button
                    key={maHd}
                    type="button"
                    onClick={() => {
                      setSelectedMaHd(maHd);
                      fillAdminForm(row);
                    }}
                    className={`w-full rounded-xl border px-4 py-3 text-left ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <div className="font-medium">{row["T\u00ean"] || maHd}</div>
                    <div className={`text-sm ${isSelected ? "text-emerald-50" : "text-slate-600"}`}>
                      {row["\u0110\u1ecba ch\u1ec9 email"] || "No email"} | {row["Chi nh\u00e1nh Cozoro dorm"] || "No branch"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Selected User</h2>

              {!selectedClient ? (
                <p className="mt-3 text-sm text-slate-600">Choose an active user to inspect and edit.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {shownAdminFields.map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                      <div className="mt-1 text-sm text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Editable Fields</h2>
                <button
                  type="button"
                  onClick={() => void saveAdminChanges()}
                  disabled={loading || !selectedClient}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Save to Sheet
                </button>
              </div>

              {!selectedClient ? (
                <p className="mt-3 text-sm text-slate-600">Select a user to edit their client information.</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {Object.keys(adminForm).map((field) => (
                    <label key={field} className="block text-sm font-medium text-slate-700">
                      {field}
                      <input
                        type="text"
                        value={adminForm[field] ?? ""}
                        onChange={(event) =>
                          setAdminForm((current) => ({
                            ...current,
                            [field]: event.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Laundry Calendars</h2>
              {laundryCalendars.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  No laundry calendars are visible yet. This usually means Calendar access has not been granted or the
                  connected Google account cannot see the laundry calendars.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">Calendar View</div>
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
                        {(["month", "week", "day"] as const).map((mode) => (
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
                      </div>
                    </div>

                    {calendarViewMode === "month" ? (
                      <div className="mt-4">
                        <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                            <div key={label}>{label}</div>
                          ))}
                        </div>
                        <div className="mt-2 grid grid-cols-7 gap-2">
                          {monthDays.map((day) => {
                            const events = calendarEvents.filter((event) => sameDay(new Date(event.start), day));
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
                                  {events.slice(0, 3).map((event) => (
                                    <button
                                      key={event.id}
                                      type="button"
                                      onClick={() => {
                                        setCalendarViewMode("day");
                                        setCalendarFocusDate(startOfDay(new Date(event.start)));
                                      }}
                                      className="block w-full rounded-md bg-slate-900 px-2 py-1 text-left text-xs text-white"
                                    >
                                      {new Date(event.start).toLocaleTimeString([], {
                                        hour: "numeric",
                                        minute: "2-digit"
                                      })}{" "}
                                      {event.summary}
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

                    {calendarViewMode === "week" ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-7">
                        {weekDays.map((day) => {
                          const events = calendarEvents.filter((event) => sameDay(new Date(event.start), day));
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
                                  events.map((event) => (
                                    <div key={event.id} className="rounded-lg bg-slate-50 p-2">
                                      <div className="text-xs font-medium text-slate-900">{event.summary}</div>
                                      <div className="mt-1 text-xs text-slate-600">
                                        {new Date(event.start).toLocaleTimeString([], {
                                          hour: "numeric",
                                          minute: "2-digit"
                                        })}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">{event.calendarSummary}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {calendarViewMode === "day" ? (
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
                          {dayEvents.length === 0 ? (
                            <div className="text-sm text-slate-500">No bookings for this day.</div>
                          ) : (
                            dayEvents.map((event) => (
                              <div key={event.id} className="rounded-xl bg-slate-50 p-4">
                                <div className="font-medium text-slate-900">{event.summary}</div>
                                <div className="mt-1 text-sm text-slate-600">{formatRange(event.start, event.end)}</div>
                                <div className="mt-1 text-sm text-slate-600">Calendar: {event.calendarSummary}</div>
                                {event.location ? (
                                  <div className="mt-1 text-sm text-slate-600">Location: {event.location}</div>
                                ) : null}
                                {event.description ? (
                                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                                    {event.description}
                                  </div>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {laundryCalendars.map((calendar) => (
                    <div key={calendar.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="font-medium text-slate-900">{calendar.summary}</div>
                      <div className="mt-1 text-xs text-slate-500">{calendar.id}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Access: {calendar.accessRole || "unknown"} | Events: {calendar.events.length}
                      </div>
                      {calendar.error ? (
                        <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          Calendar load issue: {calendar.error}
                        </div>
                      ) : null}
                      {calendar.description ? (
                        <div className="mt-1 text-sm text-slate-600">{calendar.description}</div>
                      ) : null}
                      {calendar.events.length === 0 ? (
                        <div className="mt-3 text-sm text-slate-600">No events found in the current time window.</div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {calendar.events.map((event) => (
                            <div key={event.id} className="rounded-lg bg-slate-50 p-3">
                              <div className="font-medium text-slate-900">{event.summary}</div>
                              <div className="mt-1 text-sm text-slate-600">
                                {new Date(event.start).toLocaleString()} to {new Date(event.end).toLocaleString()}
                              </div>
                              {event.location ? (
                                <div className="mt-1 text-sm text-slate-600">Location: {event.location}</div>
                              ) : null}
                              {event.description ? (
                                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                                  {event.description}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">My Information</h2>

          {!client ? (
            <p className="mt-3 text-sm text-slate-600">
              Submit your email to load the active client row where <code>Hi\u1ec7n c\u00f2n \u1edf = 1</code>.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {shownFields.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1 text-sm text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
