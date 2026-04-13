"use client";

import { useState } from "react";
import Link from "next/link";

import type { RentBreakdownPayload, RentPaidStatusPayload } from "../lib/rent-paid-status";
import { formatBillingMonthLabel } from "../lib/rent-paid-status";
import { usePortalLanguage } from "./portal-language";

function BreakdownRows({
  breakdown,
  billMonthLabel,
  t
}: {
  breakdown: RentBreakdownPayload;
  billMonthLabel: string;
  t: (key: string, fallback?: string) => string;
}) {
  const rows: { label: string; value: number }[] = [
    { label: t("rent", "Rent"), value: breakdown.baseRent },
    {
      label: `${t("tenureSurcharge", "Short-term surcharge")} (${((breakdown.tenureSurchargeRate ?? 0) * 100).toFixed(0)}%)`,
      value: breakdown.tenureSurchargeVnd
    },
    {
      label: t("monthlyAdjustmentSurcharge", "Monthly adjustment surcharge"),
      value: Math.max(0, breakdown.monthlyAdjustmentVnd ?? 0)
    },
    {
      label: t("professionalDiscount", "Monthly adjustment discount (professional)"),
      value: -breakdown.professionalDiscountVnd
    },
    { label: t("planDiscount", "Plan discount"), value: -breakdown.planDiscountVnd },
    { label: t("managerDiscount", "Manager discount"), value: -breakdown.managerDiscountVnd },
    { label: t("parking", "Parking"), value: breakdown.parkingFeeVnd },
    {
      label: t("gateParking", "Gate parking (unpaid tickets)"),
      value: breakdown.gateParkingFeeVnd ?? 0
    },
    {
      label: `${t("laundryServices", "Laundry services")} — ${breakdown.details?.billingPrevMonth || "—"} (${breakdown.details?.laundryCount?.cash ?? 0} cash)`,
      value: breakdown.laundryFeeVnd
    },
    { label: t("fines", "Fines"), value: breakdown.finesVnd }
  ];

  const coinCreditVnd = breakdown.recommendedCoinValueVnd ?? 0;
  if (coinCreditVnd > 0) {
    rows.push({
      label: t("coinUsageLabel", "Coin usage ({count} coins)").replace(
        /\{count\}/g,
        String(breakdown.recommendedCoinUsage ?? 0)
      ),
      value: -coinCreditVnd
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-amber-200/80 bg-white/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800/90">
        {t("billForMonth", "Bill")} · {billMonthLabel}
      </p>
      {rows.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
          <span className={item.value < 0 ? "text-emerald-700" : "text-slate-700"}>{item.label}</span>
          <span className={`shrink-0 font-semibold ${item.value < 0 ? "text-emerald-700" : "text-slate-900"}`}>
            {item.value < 0 ? "-" : ""}
            {new Intl.NumberFormat("vi-VN").format(Math.abs(item.value))} ₫
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-amber-200/80 pt-3 text-sm font-bold text-slate-900">
        <span>{t("totalDue", "Total Due")}</span>
        <span className="text-amber-800">{new Intl.NumberFormat("vi-VN").format(breakdown.finalTotalVnd)} ₫</span>
      </div>
      <p className="text-xs text-slate-500">
        {t("contactManagerForPayment", "Contact your manager to arrange payment or for any questions about this breakdown.")}
      </p>
    </div>
  );
}

type NextPaymentSummaryProps = {
  nextPaymentDate: Date | null;
  rentPaidStatus: RentPaidStatusPayload | null;
  rentLoading?: boolean;
  /** Extra note under the date (e.g. package expiry column text) */
  packageExpiryNote?: string | null;
  /** Larger padding / heading for dashboard */
  variant?: "default" | "dashboard";
  /** Optional link row */
  showPaymentsLink?: boolean;
};

export function NextPaymentSummary({
  nextPaymentDate,
  rentPaidStatus,
  rentLoading,
  packageExpiryNote,
  variant = "default",
  showPaymentsLink
}: NextPaymentSummaryProps) {
  const { t, language } = usePortalLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isDashboard = variant === "dashboard";
  const pad = isDashboard ? "p-5 sm:p-6" : "p-6";
  const rounded = isDashboard ? "rounded-3xl" : "rounded-2xl";

  const billMonthLabel = rentPaidStatus?.month
    ? formatBillingMonthLabel(rentPaidStatus.month, language)
    : "";

  const breakdown = rentPaidStatus?.breakdown ?? null;
  const showAmountRow =
    Boolean(breakdown) && rentPaidStatus && !rentPaidStatus.isPaid && !rentPaidStatus.onPrepaidPlan;
  const coinCreditVnd = breakdown?.recommendedCoinValueVnd ?? 0;
  const cashDueZeroButBillPositive =
    Boolean(breakdown) && breakdown.finalTotalVnd === 0 && coinCreditVnd > 0;

  return (
    <section className={`${rounded} border border-amber-200 bg-amber-50 shadow-sm ${pad}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {t("nextPayment", "Next Payment")}
          </div>
          {rentLoading ? (
            <div className="mt-2 h-9 w-48 animate-pulse rounded-lg bg-amber-100/80" />
          ) : nextPaymentDate ? (
            <div className={`mt-1 font-semibold text-slate-900 ${isDashboard ? "text-2xl" : "text-2xl"}`}>
              {nextPaymentDate.toLocaleDateString(language === "vi" ? "vi-VN" : undefined)}
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-900/80">{t("nextPaymentUnavailable", "Next payment date is not available yet.")}</p>
          )}
        </div>
        {showPaymentsLink ? (
          <Link
            href="/payments"
            className="shrink-0 text-sm font-medium text-amber-900 underline-offset-2 hover:underline"
          >
            {t("viewPaymentHistory", "View payment history")}
          </Link>
        ) : null}
      </div>

      {packageExpiryNote ? <p className="mt-2 text-sm text-slate-700">{packageExpiryNote}</p> : null}

      {rentPaidStatus?.onPrepaidPlan ? (
        <p className="mt-3 text-sm text-emerald-800">
          {t("rentOnPrepaidPlan", "You are on a multi-month prepaid plan. Monthly rent notices may not apply each month.")}
        </p>
      ) : null}

      {rentPaidStatus && !rentPaidStatus.onPrepaidPlan && rentPaidStatus.isPaid && billMonthLabel ? (
        <p className="mt-3 text-sm text-emerald-800">
          {language === "vi"
            ? `Tiền thuê tháng ${billMonthLabel} đã được ghi nhận đã thanh toán.`
            : `Rent for ${billMonthLabel} is recorded as paid.`}
        </p>
      ) : null}

      {showAmountRow && breakdown ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800/90">
                {t("totalPaymentNeeded", "Total payment needed")}
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
                {new Intl.NumberFormat("vi-VN").format(breakdown.finalTotalVnd)} ₫
              </div>
              {cashDueZeroButBillPositive ? (
                <p className="mt-2 max-w-md text-xs font-medium text-emerald-800">{t("rentCashDueZeroCoinNote")}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 shadow-sm hover:bg-amber-50"
            >
              {detailsOpen ? t("hideDetails", "Hide details") : t("paymentDetails", "Details")}
              <svg
                className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {detailsOpen ? <BreakdownRows breakdown={breakdown} billMonthLabel={billMonthLabel} t={t} /> : null}
        </div>
      ) : !rentLoading && rentPaidStatus && !rentPaidStatus.isPaid && !rentPaidStatus.onPrepaidPlan && !breakdown ? (
        <p className="mt-3 text-sm text-amber-900/80">
          {t("rentBreakdownPending", "Amount details will appear here once your billing profile is synced.")}
        </p>
      ) : null}
    </section>
  );
}
