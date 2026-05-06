"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import type { RentPaidStatusPayload } from "../lib/rent-paid-status";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { NextPaymentSummary } from "./next-payment-summary";

const DISMISS_PREFIX = "cozorohome-rent-popup-dismissed";

function dismissStorageKey(email: string, month: string) {
  return `${DISMISS_PREFIX}:${email.trim().toLowerCase()}:${month}`;
}

export function RentDueBlockingOverlay() {
  const { t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const [rentPaidStatus, setRentPaidStatus] = useState<RentPaidStatusPayload | null>(null);
  const [clientRemoved, setClientRemoved] = useState(false);
  const [clientPaymentDueRaw, setClientPaymentDueRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(false);
  const [hideCountdownSeconds, setHideCountdownSeconds] = useState(0);

  const isResidentSession =
    isSessionLoaded &&
    isLoggedIn &&
    sessionEmail.trim().length > 0 &&
    sessionRole !== "manager" &&
    sessionRole !== "owner" &&
    sessionRole !== "app_admin" &&
    sessionRole !== "mechanic";

  const load = useCallback(async () => {
    const email = sessionEmail.trim().toLowerCase();
    if (!email) {
      return;
    }
    setLoading(true);
    try {
      const [clientRes, rentRes] = await Promise.all([
        fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(email)}`),
        fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(email)}`)
      ]);
      if (clientRes.ok) {
        const client = (await clientRes.json()) as Record<string, string> | { error?: string };
        if (client && typeof client === "object" && !("error" in client)) {
          const clientRow = client as Record<string, string>;
          setClientRemoved(String(clientRow["Hiện còn ở"] ?? "").trim() === "-1");
          setClientPaymentDueRaw(
            String(
              clientRow["Ngày hết hạn gói đã thanh toán"] ??
                clientRow["ngày hết hạn gói đã thanh toán"] ??
                clientRow["hết hạn"] ??
                clientRow["het han"] ??
                ""
            ).trim()
          );
        } else {
          setClientRemoved(false);
          setClientPaymentDueRaw("");
        }
      } else {
        setClientRemoved(false);
        setClientPaymentDueRaw("");
      }

      if (rentRes.ok) {
        setRentPaidStatus((await rentRes.json()) as RentPaidStatusPayload);
      } else {
        setRentPaidStatus(null);
      }
    } catch {
      setRentPaidStatus(null);
    } finally {
      setLoading(false);
    }
  }, [sessionEmail]);

  useEffect(() => {
    if (!isResidentSession) {
      setRentPaidStatus(null);
      return;
    }
    void load();
  }, [isResidentSession, load]);

  useEffect(() => {
    setLocalDismissed(false);
  }, [rentPaidStatus?.month, sessionEmail]);

  const overdueDays = useMemo(() => {
    const raw = clientPaymentDueRaw.trim();
    if (!raw) return 0;
    const direct = new Date(raw);
    let due = Number.isNaN(direct.getTime()) ? null : direct;
    if (!due) {
      const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
      if (!match) return 0;
      const day = Number.parseInt(match[1] ?? "0", 10);
      const month = Number.parseInt(match[2] ?? "0", 10) - 1;
      const yearRaw = Number.parseInt(match[3] ?? "0", 10);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const parsed = new Date(year, month, day);
      if (Number.isNaN(parsed.getTime())) return 0;
      due = parsed;
    }
    due.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, diffDays);
  }, [clientPaymentDueRaw]);

  const hideDelaySeconds = useMemo(() => 5 + overdueDays * 10, [overdueDays]);

  const shouldBlock = useMemo(() => {
    if (localDismissed) {
      return false;
    }
    if (!isResidentSession || !rentPaidStatus || clientRemoved) {
      return false;
    }
    if (!rentPaidStatus.blockingRentDuePopupEnabled) {
      return false;
    }
    if (rentPaidStatus.onPrepaidPlan || rentPaidStatus.isPaid) {
      return false;
    }
    if (!rentPaidStatus.breakdown) {
      return false;
    }
    if (typeof window === "undefined") {
      return true;
    }
    const key = dismissStorageKey(sessionEmail, rentPaidStatus.month);
    return window.sessionStorage.getItem(key) !== "1";
  }, [localDismissed, isResidentSession, rentPaidStatus, clientRemoved, sessionEmail]);

  function handleHide() {
    if (hideCountdownSeconds > 0) {
      return;
    }
    if (!rentPaidStatus) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(dismissStorageKey(sessionEmail, rentPaidStatus.month), "1");
    }
    setLocalDismissed(true);
  }

  useEffect(() => {
    if (!shouldBlock) {
      setHideCountdownSeconds(0);
      return;
    }
    setHideCountdownSeconds(hideDelaySeconds);
  }, [shouldBlock, hideDelaySeconds, rentPaidStatus?.month]);

  useEffect(() => {
    if (!shouldBlock || hideCountdownSeconds <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHideCountdownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [shouldBlock, hideCountdownSeconds]);

  if (!shouldBlock || !rentPaidStatus?.breakdown) {
    return null;
  }

  const [y, mo] = rentPaidStatus.month.split("-").map((p) => Number.parseInt(p, 10));
  const cycleDate =
    Number.isFinite(y) && Number.isFinite(mo) && mo >= 1 && mo <= 12
      ? new Date(y!, mo! - 1, 1)
      : new Date();
  cycleDate.setHours(0, 0, 0, 0);

  return (
    <div
      className="fixed inset-0 z-[220] flex flex-col bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rent-blocking-title"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50 px-4 py-3 sm:px-6">
        <p id="rent-blocking-title" className="text-sm font-bold text-amber-950 sm:text-base">
          {t("rentBlockingTitle", "Rent payment required")}
        </p>
        <button
          type="button"
          onClick={handleHide}
          disabled={hideCountdownSeconds > 0}
          className="rounded-full bg-amber-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {hideCountdownSeconds > 0 ? `${t("hideNotice", "Hide")} (${hideCountdownSeconds}s)` : t("hideNotice", "Hide")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-lg space-y-4">
          <p className="text-center text-sm text-white/95">{t("rentBlockingSub")}</p>
          {overdueDays >= 5 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              You are 5+ days late. Warning: your account features can be locked until payment is completed.
            </div>
          ) : null}
          <div className="rounded-2xl bg-white p-1 shadow-xl">
            <NextPaymentSummary
              nextPaymentDate={cycleDate}
              rentPaidStatus={rentPaidStatus}
              rentLoading={loading}
              showPaymentsLink
            />
          </div>
        </div>
      </div>
    </div>
  );
}
