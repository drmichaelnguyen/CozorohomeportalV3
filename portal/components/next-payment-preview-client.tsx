"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { parseVietnamDate } from "../lib/contract-utils";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";

function parseFlexibleDate(value: string | null | undefined) {
  return parseVietnamDate(value);
}

function getNextMonthFirstDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export function NextPaymentPreviewClient() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail } = usePortalSession();
  const [nextPayment, setNextPayment] = useState<{ date: Date; label: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionEmail) return;

    async function load() {
      try {
        const response = await fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(sessionEmail)}`);
        const client = await response.json();
        if (response.ok && client) {
          const expiry = parseFlexibleDate(client[PACKAGE_EXPIRY_COLUMN]);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (!expiry || expiry.getTime() < today.getTime()) {
            setNextPayment({ date: getNextMonthFirstDate(), label: "Monthly rent" });
          } else {
            setNextPayment({ date: expiry, label: "Package expiry" });
          }
        }
      } catch (e) {
        console.error("Failed to load next payment", e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [sessionEmail]);

  if (loading) return <div className="animate-pulse rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 h-24" />;
  if (!nextPayment) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {language === "vi" ? "Đợt thanh toán tiếp theo" : t("nextPayment", "Next Payment")}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {nextPayment.date.toLocaleDateString()}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-amber-900/70">
        {nextPayment.label === "Monthly rent"
          ? (language === "vi" ? "Thanh toán định kỳ hằng tháng vào ngày 01." : "Regular monthly rent due on the 1st.")
          : (language === "vi" ? "Thanh toán dựa trên ngày hết hạn hợp đồng/gói." : "Payment based on your package expiry date.")}
      </p>
    </section>
  );
}
