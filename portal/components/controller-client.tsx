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

export function ControllerClient() {
  const { language, t } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [activeEmail, setActiveEmail] = useState("");
  const [context, setContext] = useState<ControllerContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"ON" | "OFF" | null>(null);
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
      const nextContext = await fetchJson<ControllerContext>(
        `${API_BASE_URL}/controller/ac?email=${encodeURIComponent(resolvedEmail)}`
      );
      setContext(nextContext);
      setActiveEmail(resolvedEmail);
      login(resolvedEmail);
      setMessage(language === "vi" ? "Da tai dieu khien may lanh cho phong cua ban." : "Loaded AC controller for your room.");
    } catch (error) {
      setContext(null);
      setMessage(error instanceof Error ? error.message : "Unable to load AC controller.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionEmail.trim()) {
      setContext(null);
      setActiveEmail("");
      return;
    }

    void loadControllerContext();
  }, [sessionEmail]);

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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">{t("acControllerTitle", "Room Controller")}</h1>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2 text-sm text-slate-700">
          <span>{language === "vi" ? "Dang nhap bang" : "Signed in as"}</span>
          <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900">
            {sessionEmail}
          </div>
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>

      {context ? (
        <div className="space-y-6">
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
        </div>
      ) : null}
    </div>
  );
}
