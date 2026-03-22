"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
const REMEMBERED_LOGIN_EMAIL_KEY = "cozorohome-portal-remembered-email";
const REMEMBERED_LOGIN_PASSWORD_KEY = "cozorohome-portal-remembered-password";
const REMEMBERED_LOGIN_ENABLED_KEY = "cozorohome-portal-remembered-enabled";
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

type PortalResolvedRole = "user" | "manager" | "owner" | "app_admin";

type LoginResolution = {
  allowed: boolean;
  email: string;
  role: PortalResolvedRole | null;
  source: "client" | "staff" | null;
  mustChangePassword?: boolean;
  error?: string;
};

type StaffAccessEntry = {
  email: string;
  role: "manager" | "owner" | "app_admin";
  addedAt: string;
  addedBy: string;
};

type GoogleConfigResponse = {
  enabled: boolean;
  clientId: string | null;
};

type GoogleCredentialResponse = {
  credential: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              shape?: "rectangular" | "pill" | "circle" | "square";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              width?: number;
              logo_alignment?: "left" | "center";
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

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

const SENSITIVE_FIELD_PATTERNS = [
  "ngaysinh",
  "birthday",
  "birthdate",
  "cccd",
  "cmnd",
  "cancuoc",
  "passport",
  "hochieu",
  "idnumber",
  "socccd",
  "socmnd"
];

function renderFields(client: ClientRecord) {
  return preferredFields
    .filter((field) => client[field])
    .map((field) => [field, client[field]] as const);
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isSensitiveClientField(field: string) {
  const normalized = normalizeLookupKey(field);
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function getClientEmail(client: ClientRecord | null) {
  if (!client) {
    return "";
  }

  const directEmail = client["\u0110\u1ecba ch\u1ec9 email"];
  if (directEmail) {
    return String(directEmail).trim().toLowerCase();
  }

  const match = Object.entries(client).find(([key, value]) => {
    if (!String(value ?? "").trim()) {
      return false;
    }

    return normalizeLookupKey(key).includes("email");
  });

  return String(match?.[1] ?? "").trim().toLowerCase();
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

function PasswordVisibilityButton({
  visible,
  onToggle,
  label
}: {
  visible: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="border-l border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={
            visible
              ? "M3 5l16 16M10.58 10.58a2 2 0 102.83 2.83M9.88 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 7.5a11.83 11.83 0 01-4.12 5.22M6.61 6.61A11.8 11.8 0 001 11.5C2.73 15.89 7 19 12 19a10.9 10.9 0 005.39-1.39"
              : "M2 12s3.64-7 10-7 10 7 10 7-3.64 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z"
          }
        />
      </svg>
    </button>
  );
}

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function ClientLoginClient() {
  const { sessionEmail, sessionRole, isLoggedIn, login, logout } = usePortalSession();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [cacheRows, setCacheRows] = useState<ClientRecord[]>([]);
  const [selectedMaHd, setSelectedMaHd] = useState("");
  const [quickNavigationMaHd, setQuickNavigationMaHd] = useState("");
  const [adminForm, setAdminForm] = useState<Record<string, string>>({});
  const [laundryCalendars, setLaundryCalendars] = useState<AdminLaundryCalendar[]>([]);
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("week");
  const [calendarFocusDate, setCalendarFocusDate] = useState(() => startOfDay(new Date()));
  const [resolvedRole, setResolvedRole] = useState<PortalResolvedRole | null>(null);
  const [staffEntries, setStaffEntries] = useState<StaffAccessEntry[]>([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<"manager" | "owner">("manager");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [managedPasswordEmail, setManagedPasswordEmail] = useState("");
  const [managedPasswordInput, setManagedPasswordInput] = useState("");
  const [showManagedPassword, setShowManagedPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();
  const isAdminSession = isLoggedIn && !!sessionRole && sessionRole !== "user";
  const isManagerSession = sessionRole === "manager";
  const isOwnerSession = isLoggedIn && sessionRole === "owner";
  const isAppAdminSession = isLoggedIn && sessionRole === "app_admin";
  const canManagePasswords = isOwnerSession || isAppAdminSession;
  const canManageStaffAccess = isOwnerSession || isAppAdminSession;
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedRememberSetting = window.localStorage.getItem(REMEMBERED_LOGIN_ENABLED_KEY);
    const savedEmail = window.localStorage.getItem(REMEMBERED_LOGIN_EMAIL_KEY) ?? "";
    const savedPassword = window.localStorage.getItem(REMEMBERED_LOGIN_PASSWORD_KEY) ?? "";
    const shouldRemember = savedRememberSetting !== "false";

    setRememberLogin(shouldRemember);

    if (!sessionEmail && savedEmail) {
      setEmail(savedEmail);
    }

    if (shouldRemember && savedPassword) {
      setPassword(savedPassword);
    }
  }, [sessionEmail]);

  useEffect(() => {
    if (sessionEmail) {
      setEmail(sessionEmail);
    }
    if (sessionRole) {
      setResolvedRole(sessionRole);
    }
  }, [sessionEmail, sessionRole]);

  useEffect(() => {
    if (!isAppAdminSession && staffRole === "owner") {
      setStaffRole("manager");
    }
  }, [isAppAdminSession, staffRole]);

  useEffect(() => {
    let cancelled = false;

    async function loadGoogleConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/google/config`);
        const data = (await response.json()) as GoogleConfigResponse;

        if (!response.ok || !data.enabled || !data.clientId || cancelled) {
          return;
        }

        setGoogleClientId(data.clientId);
      } catch {
        // Google sign-in is optional. The email/password fallback stays available.
      }
    }

    void loadGoogleConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) {
      return;
    }

    let cancelled = false;
    const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    const script =
      existingScript instanceof HTMLScriptElement
        ? existingScript
        : Object.assign(document.createElement("script"), {
            src: "https://accounts.google.com/gsi/client",
            async: true,
            defer: true
          });

    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts.id || !googleButtonRef.current) {
        return;
      }

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          void handleGoogleCredential(response);
        }
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 280,
        logo_alignment: "left"
      });
    };

    if (window.google?.accounts.id) {
      renderGoogleButton();
      return;
    }

    script.addEventListener("load", renderGoogleButton);
    if (!existingScript) {
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script.removeEventListener("load", renderGoogleButton);
    };
  }, [googleClientId]);

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

  async function loadOwnerStaffEntries(actorEmail: string) {
    const response = await fetchWithTimeout(`${API_BASE_URL}/staff-access?email=${encodeURIComponent(actorEmail)}`);
    const data = (await response.json()) as { staff?: StaffAccessEntry[]; error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load approved staff access.");
    }

    setStaffEntries(data.staff ?? []);
  }

  function resetLoginView() {
    setMessage("");
    setClient(null);
    setCacheRows([]);
    setSelectedMaHd("");
    setQuickNavigationMaHd("");
    setAdminForm({});
    setLaundryCalendars([]);
    setResolvedRole(null);
    setStaffEntries([]);
    setPasswordChangeRequired(false);
  }

  async function loadPortalData(resolution: LoginResolution, successMessage: string) {
    setResolvedRole(resolution.role);

    if (!resolution.role) {
      throw new Error("No portal role was returned for this account.");
    }

    if (resolution.role === "app_admin" || resolution.role === "owner" || resolution.role === "manager") {
      const [cacheResponse, laundryResponse] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/clients/cache`),
        fetchWithTimeout(`${API_BASE_URL}/admin/laundry-calendars`)
      ]);
      const data = (await cacheResponse.json()) as ClientCachePayload | { error?: string };
      const laundryData = (await laundryResponse.json()) as
        | { calendars?: AdminLaundryCalendar[]; error?: string }
        | undefined;

      if (!cacheResponse.ok) {
        throw new Error(
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to load admin client cache."
        );
      }

      const rows = (data as ClientCachePayload).rows;
      setCacheRows(rows);
      const firstClient = rows[0] ?? null;
      setSelectedMaHd(firstClient?.["M\u00c3 HD"] ?? "");
      setQuickNavigationMaHd("");
      fillAdminForm(firstClient);
      if (laundryResponse.ok) {
        setLaundryCalendars(laundryData?.calendars ?? []);
      }
      if (resolution.role === "owner" || resolution.role === "app_admin") {
        await loadOwnerStaffEntries(resolution.email);
      }

      login(resolution.email, resolution.role);
      setPassword("");
      setCurrentPasswordInput("");
      setMessage(successMessage);
      return;
    }

    const clientResponse = await fetchWithTimeout(
      `${API_BASE_URL}/clients?email=${encodeURIComponent(resolution.email)}`
    );
    const clientData = (await clientResponse.json()) as ClientRecord | { error?: string };

    if (!clientResponse.ok) {
      throw new Error(
        typeof clientData === "object" &&
          clientData !== null &&
          "error" in clientData &&
          typeof clientData.error === "string"
          ? clientData.error
          : "Unable to load client information."
      );
    }

    login(resolution.email, "user");
    setClient(clientData as ClientRecord);
    setPassword("");
    setCurrentPasswordInput("");
    setMessage(successMessage);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    resetLoginView();

    try {
      if (!password.trim()) {
        setMessage("Enter your password. For clients, the default first password is your phone number.");
        return;
      }

      const loginResponse = await fetchWithTimeout(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password
        })
      });
      const loginData = (await loginResponse.json()) as (LoginResolution & { createdPassword?: boolean; error?: string });

      if (!loginResponse.ok || !loginData.allowed || !loginData.role) {
        setMessage(loginData.error ?? "Only active users or pre-approved Cozoro team emails can log in.");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(REMEMBERED_LOGIN_ENABLED_KEY, rememberLogin ? "true" : "false");
        if (rememberLogin) {
          window.localStorage.setItem(REMEMBERED_LOGIN_EMAIL_KEY, normalizedEmail);
          window.localStorage.setItem(REMEMBERED_LOGIN_PASSWORD_KEY, password);
        } else {
          window.localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY);
          window.localStorage.removeItem(REMEMBERED_LOGIN_PASSWORD_KEY);
        }
      }

      await loadPortalData(
        loginData,
        loginData.mustChangePassword
          ? "Please change your password before continuing."
          : loginData.createdPassword
            ? loginData.role === "user"
              ? "Default password accepted. Client information loaded."
              : `Password created. ${loginData.role[0].toUpperCase() + loginData.role.slice(1)} view loaded.`
            : loginData.role === "user"
              ? "Client information loaded."
              : `${loginData.role[0].toUpperCase() + loginData.role.slice(1)} view loaded.`
      );
      setPasswordChangeRequired(Boolean(loginData.mustChangePassword));
      if (loginData.mustChangePassword) {
        setCurrentPasswordInput(password);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "API request failed. Make sure the API is running and Google Sheets has been connected."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(googleResponse: GoogleCredentialResponse) {
    setLoading(true);
    resetLoginView();

    try {
      const response = await fetch(`${API_BASE_URL}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          credential: googleResponse.credential
        })
      });
      const data = (await response.json()) as LoginResolution;

      if (!response.ok || !data.allowed || !data.role) {
        setMessage(data.error ?? "Only active users or pre-approved Cozoro team emails can log in.");
        return;
      }

      setEmail(data.email);
      await loadPortalData(
        data,
        data.mustChangePassword
          ? "Please change your password before continuing."
          : data.role === "user"
            ? "Google sign-in successful. Client information loaded."
            : "Google sign-in successful."
      );
      setPasswordChangeRequired(Boolean(data.mustChangePassword));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-in failed.");
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
      setQuickNavigationMaHd("");
      fillAdminForm(nextClient);
      if (laundryResponse.ok) {
        setLaundryCalendars(laundryData?.calendars ?? []);
      }
      if (canManageStaffAccess) {
        await loadOwnerStaffEntries(sessionEmail);
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
          body: JSON.stringify({
            actorEmail: sessionEmail,
            values: adminForm
          })
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

  async function saveStaffAccess() {
    if (!canManageStaffAccess) {
      setMessage("Only the app admin or owners can update app management roles.");
      return;
    }

    if (!staffEmail.trim()) {
      setMessage("Enter an email to approve.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/staff-access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actorEmail: sessionEmail,
          targetEmail: staffEmail.trim().toLowerCase(),
          role: staffRole
        })
      });

      const data = (await response.json()) as { staff?: StaffAccessEntry[]; error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Unable to save staff access.");
        return;
      }

      setStaffEntries(data.staff ?? []);
      setStaffEmail("");
      setStaffRole("manager");
      setMessage("Staff access updated.");
    } catch {
      setMessage("Unable to update staff access.");
    } finally {
      setLoading(false);
    }
  }

  async function handleManagedPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManagePasswords) {
      setMessage("Only the app admin or owners can reset other users' passwords.");
      return;
    }

    if (!managedPasswordEmail.trim() || !managedPasswordInput.trim()) {
      setMessage("Enter the target email and a new password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/auth/admin-set-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actorEmail: sessionEmail,
          targetEmail: managedPasswordEmail.trim().toLowerCase(),
          newPassword: managedPasswordInput
        })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Unable to reset password.");
        return;
      }

      setManagedPasswordInput("");
      setShowManagedPassword(false);
      setMessage("Password reset saved. The user will need to change it after their next login.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sessionEmail) {
      setMessage("Please log in before changing your password.");
      return;
    }

    if (!currentPasswordInput.trim() || !newPasswordInput.trim()) {
      setMessage("Enter both your current password and a new password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: sessionEmail,
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput
        })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Unable to change password.");
        return;
      }

      if (typeof window !== "undefined" && rememberLogin) {
        window.localStorage.setItem(REMEMBERED_LOGIN_PASSWORD_KEY, newPasswordInput);
      }

      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setPasswordChangeRequired(false);
      setMessage("Password changed successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to change password.");
    } finally {
      setLoading(false);
    }
  }

  const shownFields = client ? renderFields(client) : [];
  const shownAdminFields = selectedClient
    ? renderFields(selectedClient).filter(([label]) => !isManagerSession || !isSensitiveClientField(label))
    : [];
  const editableAdminFields = Object.keys(adminForm).filter(
    (field) => !isManagerSession || !isSensitiveClientField(field)
  );
  const selectedClientEmail = getClientEmail(selectedClient);
  const filteredCacheRows = quickNavigationMaHd
    ? cacheRows.filter((row) => row["M\u00c3 HD"] === quickNavigationMaHd)
    : cacheRows;
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {isLoggedIn ? "Portal Session" : "Client Login"}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {isLoggedIn
                ? `Signed in as ${sessionEmail}${sessionRole ? ` (${sessionRole})` : ""}.`
                : "Active users can log in from the client list. Cozoro team members can also log in if an owner has pre-approved their email."}
            </p>
            {!isLoggedIn ? (
              <p className="mt-2 text-sm text-slate-600">
                Use Google to sign in with the account tied to your active client or approved app management email.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Password tools are in the Account Security section below.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isLoggedIn ? (
              <a href="#account-security" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
                Change password
              </a>
            ) : null}
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
        </div>

        {!isLoggedIn ? (
          <>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">Continue with Google</div>
              <p className="mt-1 text-sm text-slate-600">
                Sign in with the Google account tied to your active client or approved Cozoro team email.
              </p>
              {googleClientId ? (
                <div ref={googleButtonRef} className="mt-4 min-h-11" />
              ) : (
                <p className="mt-4 text-sm text-slate-500">Google sign-in is not configured yet on this environment.</p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-900">Sign in with email</div>
              <p className="mt-1 text-sm text-slate-600">
                If you signed out on this computer, the email and password fields will show again here.
              </p>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  placeholder="name@example.com"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                Password
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    placeholder="Enter your password"
                  />
                  <PasswordVisibilityButton
                    visible={showPassword}
                    onToggle={() => setShowPassword((current) => !current)}
                    label={showPassword ? "Hide password" : "Show password"}
                  />
                </div>
              </label>

              <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Remember this login on this computer
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {loading ? "Signing in..." : "Log in with email"}
              </button>
            </form>
          </>
        ) : null}

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {isLoggedIn ? (
        <section
          id="account-security"
          className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ${passwordChangeRequired ? "ring-amber-300" : "ring-slate-200"}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Account Security</h2>
              <p className="mt-1 text-sm text-slate-600">
                {passwordChangeRequired
                  ? "First login detected. Please change your password before continuing to use the portal."
                  : "You can change your password here at any time."}
              </p>
            </div>
          </div>
          <form onSubmit={handleChangePassword} className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Current password
                <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPasswordInput}
                    onChange={(event) => setCurrentPasswordInput(event.target.value)}
                    className="w-full px-3 py-2 outline-none"
                    placeholder="Enter current password"
                  />
                  <PasswordVisibilityButton
                    visible={showCurrentPassword}
                    onToggle={() => setShowCurrentPassword((current) => !current)}
                    label={showCurrentPassword ? "Hide current password" : "Show current password"}
                  />
                </div>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                New password
                <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPasswordInput}
                    onChange={(event) => setNewPasswordInput(event.target.value)}
                    className="w-full px-3 py-2 outline-none"
                    placeholder="Choose a new password"
                  />
                  <PasswordVisibilityButton
                    visible={showNewPassword}
                    onToggle={() => setShowNewPassword((current) => !current)}
                    label={showNewPassword ? "Hide new password" : "Show new password"}
                  />
                </div>
              </label>
            </div>
            <div className="mt-4">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Change password
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {canManagePasswords ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Reset Another User Password</h2>
              <p className="mt-1 text-sm text-slate-600">
                {isAppAdminSession
                  ? "App admin can reset passwords for owners, managers, and users. Those users must change the password after logging in."
                  : "Owners can reset passwords for managers and users, but not for app admin or owner accounts."}
              </p>
            </div>
            {selectedClientEmail ? (
              <button
                type="button"
                onClick={() => setManagedPasswordEmail(selectedClientEmail)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                Use selected user
              </button>
            ) : null}
          </div>

          <form onSubmit={handleManagedPasswordReset} className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Target email
              <input
                type="email"
                value={managedPasswordEmail}
                onChange={(event) => setManagedPasswordEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="user@example.com"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              New password
              <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-300 bg-white">
                <input
                  type={showManagedPassword ? "text" : "password"}
                  value={managedPasswordInput}
                  onChange={(event) => setManagedPasswordInput(event.target.value)}
                  className="w-full px-3 py-2 outline-none"
                  placeholder="Enter a temporary password"
                />
                <PasswordVisibilityButton
                  visible={showManagedPassword}
                  onToggle={() => setShowManagedPassword((current) => !current)}
                  label={showManagedPassword ? "Hide reset password" : "Show reset password"}
                />
              </div>
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Reset password
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {isAdminSession ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Manager Workspace</h2>
          <p className="mt-1 text-sm text-slate-600">
            Open the full manager view here. Active users, cleaning tools, laundry calendars, and the Owners & employees area now live on the dedicated manager page so this login screen stays short.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/manager" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
              Open manager overview
            </Link>
            <Link
              href="/manager?view=owners_employees"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              Open Owners & employees
            </Link>
            <Link
              href="/manager?view=admin_cleaning"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              Open Cleaning schedule assigning
            </Link>
          </div>
        </section>
      ) : null}
      {!isAdminSession ? (
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
      ) : null}
    </div>
  );
}
