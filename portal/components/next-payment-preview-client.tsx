"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { parseVietnamDate } from "../lib/contract-utils";
import type { RentPaidStatusPayload } from "../lib/rent-paid-status";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { NextPaymentSummary } from "./next-payment-summary";

const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";

function getNextMonthFirstDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export function NextPaymentPreviewClient() {
  const { language } = usePortalLanguage();
  const { sessionEmail } = usePortalSession();
  const [rentPaidStatus, setRentPaidStatus] = useState<RentPaidStatusPayload | null>(null);
  const [packageExpiryRaw, setPackageExpiryRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionEmail) {
      return;
    }

    async function load() {
      try {
        const [clientRes, rentRes] = await Promise.all([
          fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(sessionEmail)}`),
          fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(sessionEmail)}`)
        ]);
        if (rentRes.ok) {
          setRentPaidStatus((await rentRes.json()) as RentPaidStatusPayload);
        }
        if (clientRes.ok) {
          const client = (await clientRes.json()) as Record<string, string>;
          setPackageExpiryRaw(client[PACKAGE_EXPIRY_COLUMN] ?? null);
        }
      } catch (e) {
        console.error("Failed to load next payment", e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [sessionEmail]);

  const nextPaymentDate = useMemo(() => {
    const expiry = packageExpiryRaw ? parseVietnamDate(packageExpiryRaw) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!expiry || expiry.getTime() < today.getTime()) {
      return getNextMonthFirstDate();
    }

    return expiry;
  }, [packageExpiryRaw]);

  if (loading) {
    return <div className="animate-pulse rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 h-24" />;
  }

  return (
    <NextPaymentSummary
      nextPaymentDate={nextPaymentDate}
      rentPaidStatus={rentPaidStatus}
      packageExpiryNote={
        packageExpiryRaw
          ? language === "vi"
            ? `Ngày hết hạn gói đã thanh toán: ${packageExpiryRaw}`
            : `Paid package expires: ${packageExpiryRaw}`
          : language === "vi"
            ? "Không có ngày hết hạn gói trong hồ sơ — kỳ thanh toán mặc định là ngày đầu tháng sau."
            : "No paid-package expiry on file — next cycle defaults to the first of next month."
      }
    />
  );
}
