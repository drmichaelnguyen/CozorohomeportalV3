"use client";

import { useState } from "react";
import Link from "next/link";

import { API_BASE_URL } from "../lib/api-base-url";
import type {
  PrepaidNextPaymentEstimatePayload,
  RentBreakdownPayload,
  RentPaidStatusPayload
} from "../lib/rent-paid-status";
import { formatBillingMonthLabel } from "../lib/rent-paid-status";
import { usePortalLanguage } from "./portal-language";

function BreakdownRows({
  breakdown,
  billMonthLabel,
  language,
  showCoinExplainers,
  t
}: {
  breakdown: RentBreakdownPayload;
  billMonthLabel: string;
  language: "en" | "vi";
  /** When false, hide cap/rate/balance helper rows (resident turned off coin use). */
  showCoinExplainers: boolean;
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string;
}) {
  const rows: { label: string; value: number | "skip" }[] = [
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

  const maxCap = breakdown.maxCoinUsageVnd ?? 0;
  const rate = breakdown.coinRateVndPerCoin;
  const balance = breakdown.currentCoinsBalance;
  const fmtN = (n: number) => new Intl.NumberFormat(language === "vi" ? "vi-VN" : "en-US").format(n);
  if (showCoinExplainers && maxCap > 0 && typeof rate === "number" && Number.isFinite(rate)) {
    rows.push({
      label: t("rentCoinMaxCreditRow", undefined, { max: fmtN(maxCap) }),
      value: "skip"
    });
    rows.push({
      label: t("rentCoinRateRow", undefined, { rate: fmtN(rate) }),
      value: "skip"
    });
    if (typeof balance === "number" && Number.isFinite(balance)) {
      rows.push({
        label: t("rentCoinBalanceRow", undefined, { n: fmtN(balance) }),
        value: "skip"
      });
    }
  }

  const coinCreditVnd = breakdown.recommendedCoinValueVnd ?? 0;
  if (breakdown.totalBeforeCoinsVnd != null && coinCreditVnd > 0) {
    rows.push({
      label: t("billSubtotalBeforeCoins"),
      value: breakdown.totalBeforeCoinsVnd
    });
  }
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
      {rows.map((item, idx) => (
        <div key={`${idx}-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
          <span className={typeof item.value === "number" && item.value < 0 ? "text-emerald-700" : "text-slate-700"}>
            {item.label}
          </span>
          <span
            className={`shrink-0 font-semibold ${
              typeof item.value === "number" && item.value < 0 ? "text-emerald-700" : "text-slate-900"
            }`}
          >
            {item.value === "skip" ? (
              <span className="text-slate-400">—</span>
            ) : (
              <>
                {item.value < 0 ? "-" : ""}
                {new Intl.NumberFormat("vi-VN").format(Math.abs(item.value))} ₫
              </>
            )}
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

export function PrepaidPackageBreakdownRows({
  est,
  billMonthLabel,
  t,
  className = "mt-3"
}: {
  est: PrepaidNextPaymentEstimatePayload;
  billMonthLabel: string;
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string;
  className?: string;
}) {
  const { language } = usePortalLanguage();
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  const rc = est.recurringComponents;
  const packageGrossMonths =
    est.packageGrossMonths ?? (est.planMonths === 6 ? 7 : est.planMonths);
  const gross = est.recurringMonthlyVnd * packageGrossMonths;
  const laundryUses = est.laundryCashUses ?? 0;

  const packageRows: { label: string; value: number }[] = [
    {
      label: t("prepaidLinePackageGross", undefined, { months: packageGrossMonths }),
      value: gross
    }
  ];
  if (est.frequencyDiscountVnd > 0) {
    packageRows.push({
      label: t("prepaidLinePlanDiscount"),
      value: -est.frequencyDiscountVnd
    });
  }
  packageRows.push({
    label: t("prepaidLinePackageNet"),
    value: est.packageRecurringSubtotalVnd
  });

  const payablesRows: { label: string; value: number }[] = [
    {
      label: `${t("laundryServices")} — ${est.laundryBillingPrevMonth || "—"} (${t("prepaidLaundryCashUsesLabel", undefined, { n: laundryUses })})`,
      value: est.laundryFeeVnd
    },
    { label: t("gateParking"), value: est.gateParkingFeeVnd },
    { label: t("fines"), value: est.finesVnd }
  ];

  function Row({ label, value }: { label: string; value: number }) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className={value < 0 ? "text-emerald-700" : "text-slate-700"}>{label}</span>
        <span className={`shrink-0 font-semibold tabular-nums ${value < 0 ? "text-emerald-700" : "text-slate-900"}`}>
          {value < 0 ? "-" : ""}
          {fmt(Math.abs(value))} ₫
        </span>
      </div>
    );
  }

  return (
    <div className={`${className} space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-800">
        {t("prepaidNextPackageTitle")} · {billMonthLabel}
        {est.breakdownHasOwnerOverrides ? (
          <span className="ml-2 font-normal normal-case text-violet-700">
            {language === "vi" ? "· Điều chỉnh chủ" : "· Owner-adjusted lines"}
          </span>
        ) : null}
      </p>

      {rc ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">{t("prepaidEachMonthNoDeposit")}</p>
          <Row label={t("rent", "Rent")} value={rc.baseRentVnd} />
          <Row
            label={`${t("tenureSurcharge")} (${(rc.tenureSurchargeRate * 100).toFixed(0)}%)`}
            value={rc.tenureSurchargeVnd}
          />
          <Row label={t("monthlyAdjustmentSurcharge")} value={rc.monthlyAdjustmentSurchargeVnd} />
          <Row label={t("professionalDiscount")} value={-rc.professionalDiscountVnd} />
          <Row label={t("parking")} value={rc.parkingFeeVnd} />
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900">
            <span>{t("prepaidRecurringMonthlyTotalLabel")}</span>
            <span className="tabular-nums">{fmt(rc.recurringMonthlyVnd)} ₫</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Row label={t("prepaidLineRecurringMonthly")} value={est.recurringMonthlyVnd} />
        </div>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold text-slate-600">{t("prepaidPackagePortionTitle")}</p>
        {packageRows.map((item, idx) => (
          <Row key={`pkg-${idx}`} label={item.label} value={item.value} />
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold text-slate-600">{t("prepaidBillAddOnsTitle")}</p>
        {payablesRows.map((item, idx) => (
          <Row key={`pay-${idx}`} label={item.label} value={item.value} />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-bold text-slate-900">
        <span>{t("totalDue", "Total Due")}</span>
        <span className="text-slate-900 tabular-nums">{fmt(est.estimatedTotalVnd)} ₫</span>
      </div>
      <p className="text-xs text-slate-600">{t("prepaidEstimateDisclaimer")}</p>
      {est.prepaidManagerConfirmed ? (
        <p className="text-xs text-slate-600">
          {t(
            "prepaidDetailsEngineNote",
            "Line items reflect the system calculation; the total above may differ if your manager adjusted the package amount."
          )}
        </p>
      ) : null}
      <p className="text-xs text-slate-600">{t("contactManagerForPayment")}</p>
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
  /** When set with an unpaid breakdown, shows coin opt-in for this month’s bill. */
  residentEmail?: string;
  /** Refetch rent-paid-status after saving coin preference (e.g. reload dashboard / account). */
  onRentPaidStatusRefresh?: () => void | Promise<void>;
};

export function NextPaymentSummary({
  nextPaymentDate,
  rentPaidStatus,
  rentLoading,
  packageExpiryNote,
  variant = "default",
  showPaymentsLink,
  residentEmail,
  onRentPaidStatusRefresh
}: NextPaymentSummaryProps) {
  const { t, language } = usePortalLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [prepaidDetailsOpen, setPrepaidDetailsOpen] = useState(false);
  const [coinPrefSaving, setCoinPrefSaving] = useState(false);
  const [coinPrefError, setCoinPrefError] = useState("");
  const [coinRedeemSaving, setCoinRedeemSaving] = useState(false);
  const [coinRedeemError, setCoinRedeemError] = useState("");

  async function handleApplyCoinsChange(next: boolean) {
    if (!residentEmail || !rentPaidStatus?.month) {
      return;
    }
    setCoinPrefError("");
    setCoinPrefSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/rent-paid-status/apply-coins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: residentEmail,
          applyCoinsTowardRent: next,
          month: rentPaidStatus.month
        })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCoinPrefError(typeof data.error === "string" ? data.error : t("useCoinsTowardRentError"));
        return;
      }
      await onRentPaidStatusRefresh?.();
    } catch {
      setCoinPrefError(t("useCoinsTowardRentError"));
    } finally {
      setCoinPrefSaving(false);
    }
  }

  async function handleRedeemCoinsForBill() {
    if (!residentEmail || !rentPaidStatus?.month) {
      return;
    }
    setCoinRedeemError("");
    setCoinRedeemSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/rent-paid-status/redeem-coins-for-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: residentEmail,
          month: rentPaidStatus.month
        })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCoinRedeemError(typeof data.error === "string" ? data.error : t("rentCoinSubmitError"));
        return;
      }
      await onRentPaidStatusRefresh?.();
    } catch {
      setCoinRedeemError(t("rentCoinSubmitError"));
    } finally {
      setCoinRedeemSaving(false);
    }
  }

  const isDashboard = variant === "dashboard";
  const pad = isDashboard ? "p-5 sm:p-6" : "p-6";
  const rounded = isDashboard ? "rounded-3xl" : "rounded-2xl";

  const billMonthLabel = rentPaidStatus?.month
    ? formatBillingMonthLabel(rentPaidStatus.month, language)
    : "";

  const breakdown = rentPaidStatus?.breakdown ?? null;
  const prepaidEst = rentPaidStatus?.prepaidNextPaymentEstimate ?? null;
  const showAmountRow =
    Boolean(breakdown) && rentPaidStatus && !rentPaidStatus.isPaid && !rentPaidStatus.onPrepaidPlan;
  const showPrepaidEstimateBlock =
    Boolean(rentPaidStatus?.onPrepaidPlan && prepaidEst && !rentLoading);
  const coinCreditVnd = breakdown?.recommendedCoinValueVnd ?? 0;
  const cashDueZeroButBillPositive =
    breakdown != null && breakdown.finalTotalVnd === 0 && coinCreditVnd > 0;
  const coinRedeemDone = (rentPaidStatus?.rentCoinRedeemCoins ?? 0) > 0;

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
        <p className="mt-3 text-sm text-slate-800">
          {t("rentOnPrepaidPlan", "You are on a multi-month prepaid plan. Monthly rent notices may not apply each month.")}
        </p>
      ) : null}

      {showPrepaidEstimateBlock && prepaidEst ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-600">
            {t("prepaidNextPackageAsOf", undefined, { month: formatBillingMonthLabel(prepaidEst.billingMonth, language) })}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-800">
                {t("prepaidNextPackageTitle")}
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
                {new Intl.NumberFormat("vi-VN").format(prepaidEst.estimatedTotalVnd)} ₫
              </div>
              {prepaidEst.prepaidManagerConfirmed && prepaidEst.engineEstimatedTotalVnd != null ? (
                <p className="mt-2 text-xs font-medium text-slate-800">
                  {language === "vi"
                    ? `Quản lý xác nhận số tiền này (ước tính hệ thống: ${new Intl.NumberFormat("vi-VN").format(prepaidEst.engineEstimatedTotalVnd)} ₫).`
                    : `Your manager confirmed this amount (system estimate was ${new Intl.NumberFormat("vi-VN").format(prepaidEst.engineEstimatedTotalVnd)} ₫).`}
                </p>
              ) : null}
              {prepaidEst.managerPackageNote?.trim() ? (
                <p className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800">{prepaidEst.managerPackageNote.trim()}</p>
              ) : null}
              {(prepaidEst.midCyclePayablesVnd ?? 0) > 0 ? (
                <p className="mt-2 text-xs font-medium text-slate-700">
                  {t("prepaidMidCyclePayables", undefined, {
                    amount: new Intl.NumberFormat("vi-VN").format(prepaidEst.midCyclePayablesVnd ?? 0)
                  })}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setPrepaidDetailsOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
            >
              {prepaidDetailsOpen ? t("hideDetails", "Hide details") : t("paymentDetails", "Details")}
              <svg
                className={`h-4 w-4 transition-transform ${prepaidDetailsOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {prepaidDetailsOpen ? (
            <PrepaidPackageBreakdownRows
              est={prepaidEst}
              billMonthLabel={formatBillingMonthLabel(prepaidEst.billingMonth, language)}
              t={t}
            />
          ) : null}
        </div>
      ) : rentPaidStatus?.onPrepaidPlan && !rentLoading && !prepaidEst ? (
        <p className="mt-3 text-sm text-amber-900/80">{t("rentBreakdownPending")}</p>
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
          {residentEmail ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200/80 bg-white/70 p-3 text-sm text-slate-800 shadow-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-amber-400 text-amber-700 focus:ring-amber-500 disabled:opacity-50"
                checked={rentPaidStatus?.applyCoinsTowardRent === true}
                disabled={coinPrefSaving || coinRedeemDone}
                onChange={(e) => void handleApplyCoinsChange(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">{t("useCoinsTowardRentLabel")}</span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-600">{t("useCoinsTowardRentHelp")}</span>
                {coinPrefSaving ? (
                  <span className="mt-1 block text-xs font-medium text-amber-800">{t("useCoinsTowardRentSaving")}</span>
                ) : null}
                {coinPrefError ? <span className="mt-1 block text-xs text-rose-700">{coinPrefError}</span> : null}
              </span>
            </label>
          ) : null}
          {residentEmail && rentPaidStatus?.applyCoinsTowardRent && breakdown && !coinRedeemDone ? (
            <div className="rounded-xl border border-amber-200/80 bg-white/80 p-3 text-sm text-slate-800 shadow-sm">
              {(breakdown.recommendedCoinUsage ?? 0) > 0 ? (
                <>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {t("rentCoinPlannedDeduction", undefined, {
                      coins: String(breakdown.recommendedCoinUsage ?? 0),
                      vnd: new Intl.NumberFormat("vi-VN").format(breakdown.recommendedCoinValueVnd ?? 0)
                    })}
                  </p>
                  <button
                    type="button"
                    disabled={coinRedeemSaving || coinPrefSaving}
                    onClick={() => void handleRedeemCoinsForBill()}
                    className="mt-2 inline-flex items-center justify-center rounded-lg bg-amber-800 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-900 disabled:opacity-50"
                  >
                    {coinRedeemSaving ? t("rentCoinSubmitting") : t("rentCoinSubmitExchange")}
                  </button>
                  {coinRedeemError ? <p className="mt-2 text-xs text-rose-700">{coinRedeemError}</p> : null}
                </>
              ) : (
                <p className="text-xs text-slate-600">
                  {language === "vi"
                    ? "Bật tùy chọn ở trên nhưng hiện không có coin để đổi (kiểm tra số dư hoặc mức tối đa 10%)."
                    : "Coin use is on, but there are no coins to exchange toward this bill yet (check your balance or the 10% cap)."}
                </p>
              )}
            </div>
          ) : null}
          {coinRedeemDone && rentPaidStatus ? (
            <p className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 p-3 text-xs font-medium text-emerald-900">
              {t("rentCoinExchangeDone", undefined, {
                when: rentPaidStatus.rentCoinRedeemAt
                  ? new Date(rentPaidStatus.rentCoinRedeemAt).toLocaleString(
                      language === "vi" ? "vi-VN" : "en-GB",
                      { dateStyle: "short", timeStyle: "short" }
                    )
                  : "—",
                coins: String(rentPaidStatus.rentCoinRedeemCoins ?? 0),
                vnd: new Intl.NumberFormat("vi-VN").format(rentPaidStatus.rentCoinRedeemValueVnd ?? 0)
              })}
            </p>
          ) : null}
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
          {detailsOpen ? (
            <BreakdownRows
              breakdown={breakdown}
              billMonthLabel={billMonthLabel}
              language={language}
              showCoinExplainers={rentPaidStatus?.applyCoinsTowardRent === true || coinRedeemDone}
              t={t}
            />
          ) : null}
        </div>
      ) : !rentLoading && rentPaidStatus && !rentPaidStatus.isPaid && !rentPaidStatus.onPrepaidPlan && !breakdown ? (
        <p className="mt-3 text-sm text-amber-900/80">
          {t("rentBreakdownPending", "Amount details will appear here once your billing profile is synced.")}
        </p>
      ) : null}
    </section>
  );
}
