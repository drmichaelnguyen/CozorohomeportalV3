"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const API_TIMEOUT_MS = 6000;

type ControllerContext = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  bed: string;
  roomCode: string | null;
  contractCode: string;
  room: {
    id: string;
    label: string;
    iftttConfigured: boolean;
    lastRequestedAction: "ON" | "OFF" | null;
    lastRequestedAt: string | null;
  } | null;
  restrictions: {
    canTurnOnNow: boolean;
    turnOnBlockedReason: string | null;
    timeZone: string;
  };
  mappingHint: {
    branchId: "D2" | "D7";
    bed: string;
    roomCode: string;
    contractCode: string;
  };
};

type AirFryerContext = {
  email: string;
  name: string;
  branchId: string;
  eligible: boolean;
  cooldownMinutes: number;
  status: {
    inUse: boolean;
    availableNow: boolean;
    availableAt: string | null;
    currentUse: {
      startedAt: string;
      availableAt: string;
      startedByEmail: string;
      startedByName: string;
    } | null;
    lastUse: {
      startedAt: string;
      availableAt: string;
      startedByEmail: string;
      startedByName: string;
    } | null;
  };
};

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

function formatTimestamp(value: string | null, language: "en" | "vi") {
  if (!value) {
    return language === "vi" ? "Chua co" : "Not yet";
  }

  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ControllerClient({
  showAcSection = true,
  showAirFryerSection = true,
  title = "Room Controller"
}: {
  showAcSection?: boolean;
  showAirFryerSection?: boolean;
  title?: string;
}) {
  const { language, t } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [activeEmail, setActiveEmail] = useState("");
  const [context, setContext] = useState<ControllerContext | null>(null);
  const [airFryerContext, setAirFryerContext] = useState<AirFryerContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"ON" | "OFF" | null>(null);
  const [startingAirFryer, setStartingAirFryer] = useState(false);
  const [message, setMessage] = useState("");

  async function loadControllerContext() {
    const resolvedEmail = sessionEmail.trim().toLowerCase();
    if (!resolvedEmail) {
      setMessage(language === "vi" ? "Vui long dang nhap truoc." : "Please sign in first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const requests: Promise<unknown>[] = [];

      if (showAcSection) {
        requests.push(fetchJson<ControllerContext>(`${API_BASE_URL}/controller/ac?email=${encodeURIComponent(resolvedEmail)}`));
      }

      if (showAirFryerSection) {
        requests.push(fetchJson<AirFryerContext>(`${API_BASE_URL}/controller/airfryer?email=${encodeURIComponent(resolvedEmail)}`));
      }

      const results = await Promise.all(requests);
      let offset = 0;

      if (showAcSection) {
        setContext(results[offset] as ControllerContext);
        offset += 1;
      } else {
        setContext(null);
      }

      if (showAirFryerSection) {
        setAirFryerContext(results[offset] as AirFryerContext);
      } else {
        setAirFryerContext(null);
      }

      setActiveEmail(resolvedEmail);
      login(resolvedEmail);
      setMessage(language === "vi" ? "Da tai bo dieu khien cho tai khoan cua ban." : "Loaded your controls.");
    } catch (error) {
      setContext(null);
      setAirFryerContext(null);
      setMessage(error instanceof Error ? error.message : "Unable to load controls.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionEmail.trim()) {
      setContext(null);
      setAirFryerContext(null);
      setActiveEmail("");
      return;
    }

    void loadControllerContext();
  }, [sessionEmail, showAcSection, showAirFryerSection]);

  async function sendCommand(action: "ON" | "OFF") {
    if (!activeEmail) {
      return;
    }

    setSubmittingAction(action);
    setMessage("");

    try {
      const result = await fetchJson<{ requestedAt: string }>(`${API_BASE_URL}/controller/ac/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          action
        })
      });

      setContext((current) =>
        current && current.room
          ? {
              ...current,
              room: {
                ...current.room,
                lastRequestedAction: action,
                lastRequestedAt: result.requestedAt
              }
            }
          : current
      );

      setMessage(
        action === "ON"
          ? language === "vi"
            ? "Da gui lenh bat may lanh."
            : "AC turn-on request sent."
          : language === "vi"
            ? "Da gui lenh tat may lanh."
            : "AC turn-off request sent."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send AC command.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function startAirFryer() {
    if (!activeEmail) {
      return;
    }

    setStartingAirFryer(true);
    setMessage("");

    try {
      await fetchJson<{ ok: true }>(`${API_BASE_URL}/controller/airfryer/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail
        })
      });

      const nextAirFryerContext = await fetchJson<AirFryerContext>(
        `${API_BASE_URL}/controller/airfryer?email=${encodeURIComponent(activeEmail)}`
      );
      setAirFryerContext(nextAirFryerContext);
      setMessage(language === "vi" ? "Da bat dau luot su dung noi chien khong dau." : "Air fryer use started.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start air fryer use.");
    } finally {
      setStartingAirFryer(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-700">
          {loading
            ? language === "vi"
              ? "Dang tai bo dieu khien..."
              : "Loading your controls..."
            : language === "vi"
              ? "Bo dieu khien tu dong tai theo tai khoan dang nhap."
              : "Your controls load automatically from your signed-in account."}
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>

      {context || airFryerContext ? (
        <div className="space-y-6">
          {showAcSection && context ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">{language === "vi" ? "Phong duoc phep dieu khien" : "Allowed room"}</h2>
              <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                <div>
                  <span className="font-medium">{language === "vi" ? "Khach" : "Client"}:</span> {context.name || context.email}
                </div>
                <div>
                  <span className="font-medium">{language === "vi" ? "Chi nhanh" : "Branch"}:</span> {context.branchId}
                </div>
                <div>
                  <span className="font-medium">{language === "vi" ? "Giuong" : "Bed"}:</span> {context.bed || "-"}
                </div>
                <div>
                  <span className="font-medium">{language === "vi" ? "Phong" : "Room"}:</span> {context.roomCode || "-"}
                </div>
                <div>
                  <span className="font-medium">{language === "vi" ? "Ma hop dong" : "Contract code"}:</span> {context.contractCode || "-"}
                </div>
              </div>

              {context.room ? (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-900">{context.room.label}</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {language === "vi" ? "Lenh gan nhat" : "Last request"}:{" "}
                    {context.room.lastRequestedAction
                      ? `${context.room.lastRequestedAction} · ${formatTimestamp(context.room.lastRequestedAt, language)}`
                      : formatTimestamp(context.room.lastRequestedAt, language)}
                  </p>
                  {!context.restrictions.canTurnOnNow ? (
                    <p className="mt-2 text-sm text-amber-700">
                      {language === "vi"
                        ? "Nguoi dung khong duoc bat may lanh tu 7:00 sang den 10:00 sang moi ngay, tru Chu nhat."
                        : context.restrictions.turnOnBlockedReason}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void sendCommand("ON")}
                      disabled={submittingAction !== null || !context.room.iftttConfigured || !context.restrictions.canTurnOnNow}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submittingAction === "ON" ? (language === "vi" ? "Dang gui..." : "Sending...") : language === "vi" ? "Bat may lanh" : "Turn AC on"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendCommand("OFF")}
                      disabled={submittingAction !== null || !context.room.iftttConfigured}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submittingAction === "OFF" ? (language === "vi" ? "Dang gui..." : "Sending...") : language === "vi" ? "Tat may lanh" : "Turn AC off"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">
                    {language === "vi"
                      ? "Chua co cau hinh phong may lanh cho khach nay."
                      : "No AC room mapping is configured for this user yet."}
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li>Branch: {context.mappingHint.branchId}</li>
                    <li>Bed: {context.mappingHint.bed || "-"}</li>
                    <li>Room: {context.mappingHint.roomCode || "-"}</li>
                    <li>Contract: {context.mappingHint.contractCode || "-"}</li>
                  </ul>
                </div>
              )}
            </section>
          ) : null}

          {showAirFryerSection && airFryerContext ? (
            <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {language === "vi" ? "Noi chien khong dau D7" : "D7 Air Fryer"}
              </h2>
              {airFryerContext.eligible ? (
                <>
                  <p className="mt-2 text-sm text-slate-600">
                    {language === "vi"
                      ? `Thiet bi dung chung voi thoi gian cho ${airFryerContext.cooldownMinutes} phut moi luot.`
                      : `Shared appliance with a ${airFryerContext.cooldownMinutes}-minute cooldown per use.`}
                  </p>

                  <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                    <div>
                      <span className="font-medium">{language === "vi" ? "Trang thai" : "Status"}:</span>{" "}
                      {airFryerContext.status.availableNow
                        ? language === "vi"
                          ? "San sang"
                          : "Available now"
                        : language === "vi"
                          ? "Dang duoc su dung"
                          : "Currently in use"}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Co the dung lai luc" : "Available again"}:</span>{" "}
                      {formatTimestamp(airFryerContext.status.availableAt, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Luot gan nhat" : "Last use"}:</span>{" "}
                      {formatTimestamp(airFryerContext.status.lastUse?.startedAt ?? null, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Nguoi dung gan nhat" : "Last user"}:</span>{" "}
                      {airFryerContext.status.lastUse?.startedByName || airFryerContext.status.lastUse?.startedByEmail || "-"}
                    </div>
                  </div>

                  {airFryerContext.status.currentUse ? (
                    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-semibold">
                        {language === "vi"
                          ? `${airFryerContext.status.currentUse.startedByName || airFryerContext.status.currentUse.startedByEmail} dang su dung noi chien khong dau.`
                          : `${airFryerContext.status.currentUse.startedByName || airFryerContext.status.currentUse.startedByEmail} is currently using the air fryer.`}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Bat dau" : "Started"}:{" "}
                        {formatTimestamp(airFryerContext.status.currentUse.startedAt, language)}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Co the dung lai sau" : "Available again after"}:{" "}
                        {formatTimestamp(airFryerContext.status.currentUse.availableAt, language)}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => void startAirFryer()}
                      disabled={startingAirFryer || !airFryerContext.status.availableNow}
                      className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {startingAirFryer
                        ? language === "vi"
                          ? "Dang bat dau..."
                          : "Starting..."
                        : language === "vi"
                          ? "Su dung noi chien khong dau"
                          : "Use air fryer now"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {language === "vi"
                    ? "Tinh nang nay chi danh cho nguoi dung chi nhanh D7."
                    : "This feature is only available for D7 users."}
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
