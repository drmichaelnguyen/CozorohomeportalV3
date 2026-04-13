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
  const [loading, setLoading] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(false);

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
          setClientRemoved(String((client as Record<string, string>)["Hiện còn ở"] ?? "").trim() === "-1");
        } else {
          setClientRemoved(false);
        }
      } else {
        setClientRemoved(false);
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
    if (!rentPaidStatus) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(dismissStorageKey(sessionEmail, rentPaidStatus.month), "1");
    }
    setLocalDismissed(true);
  }

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
          className="rounded-full bg-amber-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-950"
        >
          {t("hideNotice", "Hide")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-lg space-y-4">
          <p className="text-center text-sm text-white/95">{t("rentBlockingSub")}</p>
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
