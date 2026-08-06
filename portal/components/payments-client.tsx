"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { parseVietnamDate } from "../lib/contract-utils";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { NextPaymentSummary } from "./next-payment-summary";
import type { RentPaidStatusPayload } from "../lib/rent-paid-status";
import { formatCozoroDateTime } from "../lib/date-format";
const TIMESTAMP_COLUMN = "DẤU THỜI GIAN";
const EMAIL_COLUMN = "Địa chỉ email";
const AMOUNT_COLUMN = "SỐ TIỀN";
const PURPOSE_COLUMN = "MỤC ĐÍCH";
const DETAILS_COLUMN = "MỤC ĐÍCH - GHI RÕ";
const PAYER_COLUMN = "NGƯỜI ĐÓNG TIỀN";
const RECEIVER_COLUMN = "NGƯỜI NHẬN TIỀN";

type PaymentEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
};

type ClientRecord = Record<string, string>;

type PaymentsLocalCache = {
  email: string;
  entries: PaymentEntry[];
  savedAt: string;
};

const LOCAL_PAYMENTS_CACHE_KEY = "cozorohome-payments-cache-v2";
const PACKAGE_EXPIRY_COLUMN = "Ngày hết hạn gói đã thanh toán";

function parseFlexibleDate(value: string | null | undefined) {
  return parseVietnamDate(value);
}

function getNextMonthFirstDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function computeNextPaymentDate(
  client: ClientRecord | null,
  receiptNextPaymentDate?: string | null
) {
  if (!client) {
    return null;
  }

  const fromReceipt = parseFlexibleDate(receiptNextPaymentDate);
  if (fromReceipt) {
    return {
      date: fromReceipt,
      label: "Receipt next payment",
      source: "next_payment_date"
    };
  }

  const expiry = parseFlexibleDate(client[PACKAGE_EXPIRY_COLUMN]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!expiry || expiry.getTime() < today.getTime()) {
    return {
      date: getNextMonthFirstDate(),
      label: "Monthly payment",
      source: "First day of next month"
    };
  }

  return {
    date: expiry,
    label: "Package expiry payment",
    source: PACKAGE_EXPIRY_COLUMN
  };
}

function parseDisplayDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function PaymentsClient() {
  const DEFAULT_VISIBLE_ENTRIES = 5;
  const { t, language } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [rentPaidStatus, setRentPaidStatus] = useState<RentPaidStatusPayload | null>(null);
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [purposeFilter, setPurposeFilter] = useState("all");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [visibleEntriesCount, setVisibleEntriesCount] = useState(DEFAULT_VISIBLE_ENTRIES);

  const activeEmail = sessionEmail.trim().toLowerCase();

  async function readJsonSafely<T>(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    if (!contentType.includes("application/json")) {
      throw new Error("The server returned HTML instead of JSON. Refresh the page or restart the dev server.");
    }

    return JSON.parse(bodyText) as T;
  }

  function saveLocalCache(nextEmail: string, nextEntries: PaymentEntry[]) {
    if (typeof window === "undefined") {
      return;
    }

    const payload: PaymentsLocalCache = {
      email: nextEmail.trim().toLowerCase(),
      entries: nextEntries,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(LOCAL_PAYMENTS_CACHE_KEY, JSON.stringify(payload));
  }

  function loadLocalCache(targetEmail: string) {
    if (typeof window === "undefined") {
      return null;
    }

    const raw = window.localStorage.getItem(LOCAL_PAYMENTS_CACHE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as PaymentsLocalCache;
      if (parsed.email !== targetEmail.trim().toLowerCase()) {
        return null;
      }
      if (parsed.entries.some((entry) => entry.parsedTimestamp === null)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function loadPayments() {
    if (!activeEmail) {
      setMessage("Sign in first to load payment history.");
      return;
    }

    setLoading(true);
    setMessage("");
    setEntries([]);
    setClient(null);
    setRentPaidStatus(null);

    try {
      const clientResponse = await fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(activeEmail)}`);
      const clientData = await readJsonSafely<ClientRecord | { error?: string }>(clientResponse);

      if (clientResponse.ok) {
        setClient(clientData as ClientRecord);
      }

      const rentRes = await fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(activeEmail)}`);
      if (rentRes.ok) {
        setRentPaidStatus((await readJsonSafely<RentPaidStatusPayload>(rentRes)) as RentPaidStatusPayload);
      }

      const cached = loadLocalCache(activeEmail);
      if (cached) {
        setEntries(cached.entries);
        setMonthFilter("all");
        setYearFilter("all");
        setDayFilter("all");
        setPurposeFilter("all");
        setSortDirection("desc");
        setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
        setMessage(`Payment history loaded from local storage. Last saved ${formatCozoroDateTime(cached.savedAt)}.`);
      } else {
        const response = await fetch(`${API_BASE_URL}/payments?email=${encodeURIComponent(activeEmail)}`);
        const data = await readJsonSafely<{ entries?: PaymentEntry[]; error?: string }>(response);

        if (!response.ok) {
          setMessage(data.error ?? "Unable to load payment history.");
          return;
        }

        const nextEntries = data.entries ?? [];
        setEntries(nextEntries);
        login(activeEmail);
        saveLocalCache(activeEmail, nextEntries);
        setMonthFilter("all");
        setYearFilter("all");
        setDayFilter("all");
        setPurposeFilter("all");
        setSortDirection("desc");
        setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
        setMessage("Payment history loaded.");
      }
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets is connected.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadPayments();
  }

  async function refreshPaymentsNow() {
    if (!activeEmail) {
      setMessage("Sign in first to load payment history.");
      return;
    }

    setRefreshing(true);
    setMessage("");

    try {
      await fetch(`${API_BASE_URL}/payments/sync`, { method: "POST" });
      const clientResponse = await fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(activeEmail)}`);
      const clientData = await readJsonSafely<ClientRecord | { error?: string }>(clientResponse);
      if (clientResponse.ok) {
        setClient(clientData as ClientRecord);
      }
      const rentRes = await fetch(`${API_BASE_URL}/rent-paid-status?email=${encodeURIComponent(activeEmail)}`);
      if (rentRes.ok) {
        setRentPaidStatus((await readJsonSafely<RentPaidStatusPayload>(rentRes)) as RentPaidStatusPayload);
      }
      const response = await fetch(`${API_BASE_URL}/payments?email=${encodeURIComponent(activeEmail)}`);
      const data = await readJsonSafely<{ entries?: PaymentEntry[]; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to refresh payment history.");
        return;
      }

      const nextEntries = data.entries ?? [];
      setEntries(nextEntries);
      saveLocalCache(activeEmail, nextEntries);
      setMonthFilter("all");
      setYearFilter("all");
      setDayFilter("all");
      setPurposeFilter("all");
      setSortDirection("desc");
      setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
      setMessage("Payment history refreshed from the API and saved locally.");
    } catch {
      setMessage("Unable to refresh payment history right now.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const cached = loadLocalCache(activeEmail);
    if (!cached) {
      return;
    }

    setEntries(cached.entries);
  }, [activeEmail]);

  useEffect(() => {
    if (!activeEmail) {
      return;
    }

    const cached = loadLocalCache(activeEmail);
    if (cached) {
      return;
    }

    void loadPayments();
  }, [activeEmail]);

  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          entries
            .map((entry) => parseDisplayDate(entry.parsedTimestamp))
            .filter((value): value is Date => Boolean(value))
            .map((value) => String(value.getMonth() + 1).padStart(2, "0"))
        )
      ).sort(),
    [entries]
  );

  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          entries
            .map((entry) => parseDisplayDate(entry.parsedTimestamp))
            .filter((value): value is Date => Boolean(value))
            .map((value) => String(value.getFullYear()))
        )
      ).sort(),
    [entries]
  );

  const dayOptions = useMemo(
    () =>
      Array.from(
        new Set(
          entries
            .map((entry) => parseDisplayDate(entry.parsedTimestamp))
            .filter((value): value is Date => Boolean(value))
            .map((value) => String(value.getDate()).padStart(2, "0"))
        )
      ).sort(),
    [entries]
  );

  const purposeOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.row[PURPOSE_COLUMN]).filter(Boolean))).sort(),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const next = entries.filter((entry) => {
      const timestamp = parseDisplayDate(entry.parsedTimestamp);
      const monthMatches =
        monthFilter === "all" || (timestamp && String(timestamp.getMonth() + 1).padStart(2, "0") === monthFilter);
      const yearMatches = yearFilter === "all" || (timestamp && String(timestamp.getFullYear()) === yearFilter);
      const dayMatches = dayFilter === "all" || (timestamp && String(timestamp.getDate()).padStart(2, "0") === dayFilter);
      const purposeMatches = purposeFilter === "all" || entry.row[PURPOSE_COLUMN] === purposeFilter;

      return Boolean(monthMatches && yearMatches && dayMatches && purposeMatches);
    });

    return [...next].sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return sortDirection === "desc"
        ? rightTimestamp.localeCompare(leftTimestamp)
        : leftTimestamp.localeCompare(rightTimestamp);
    });
  }, [dayFilter, entries, monthFilter, purposeFilter, sortDirection, yearFilter]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, visibleEntriesCount),
    [filteredEntries, visibleEntriesCount]
  );

  useEffect(() => {
    setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
  }, [DEFAULT_VISIBLE_ENTRIES, dayFilter, monthFilter, purposeFilter, sortDirection, yearFilter]);

  const nextPayment = useMemo(
    () => computeNextPaymentDate(client, rentPaidStatus?.nextPaymentDate),
    [client, rentPaidStatus?.nextPaymentDate]
  );
  const nextPaymentDate = nextPayment?.date ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{t("paymentHistory")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {language === "vi"
            ? "Xem lịch sử biên nhận thanh toán của bạn từ "
            : "View your payment receipts from "}
          <code>{language === "vi" ? "BIÊN NHẬN" : "BIEN NHAN"}</code>
          {language === "vi"
            ? ". Trang này chỉ tải các dòng có email trùng với email của bạn trong sheet."
            : ". This page only loads rows where your email matches the sheet email column."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void refreshPaymentsNow()}
              disabled={refreshing || !activeEmail}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {refreshing ? (language === "vi" ? "Đang làm mới..." : "Refreshing...") : t("refreshPayments")}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {nextPayment ? (
        <NextPaymentSummary
          nextPaymentDate={nextPaymentDate}
          rentPaidStatus={rentPaidStatus}
          rentLoading={loading}
          packageExpiryNote={
            client?.[PACKAGE_EXPIRY_COLUMN]
              ? language === "vi"
                ? `${nextPayment.label} (${nextPayment.source}). Hiện tại ${PACKAGE_EXPIRY_COLUMN}: ${client[PACKAGE_EXPIRY_COLUMN]}`
                : `${nextPayment.label} (${nextPayment.source}). Current ${PACKAGE_EXPIRY_COLUMN}: ${client[PACKAGE_EXPIRY_COLUMN]}`
              : language === "vi"
                ? `${nextPayment.label} (${nextPayment.source}). Không có ngày hết hạn gói — kỳ thanh toán mặc định là ngày đầu tháng sau.`
                : `${nextPayment.label} (${nextPayment.source}). No package expiry on file — next cycle defaults to the first of next month.`
          }
        />
      ) : null}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Các khoản thanh toán của tôi" : "My Payment Entries"}
        </h2>

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {language === "vi" ? "Dùng tài khoản đã đăng nhập để tải các dòng thanh toán phù hợp từ " : "Use your signed-in account to load matching payment rows from "}
            <code>{language === "vi" ? "BIÊN NHẬN" : "BIEN NHAN"}</code>.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <label className="block text-sm font-medium text-slate-700">
                {language === "vi" ? "Tháng" : "Month"}
                <select
                  value={monthFilter}
                  onChange={(event) => setMonthFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All months</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {language === "vi" ? "Năm" : "Year"}
                <select
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All years</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {language === "vi" ? "Ngày" : "Day"}
                <select
                  value={dayFilter}
                  onChange={(event) => setDayFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All days</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {t("purpose")}
                <select
                  value={purposeFilter}
                  onChange={(event) => setPurposeFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All purposes</option>
                  {purposeOptions.map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {purpose}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Sort
                <select
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value as "desc" | "asc")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
            </div>

            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">{t("purpose")}</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Payer</th>
                      <th className="px-4 py-3">Receiver</th>
                      <th className="px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {visibleEntries.map((entry, index) => (
                      <tr key={`${entry.row[EMAIL_COLUMN]}-${entry.parsedTimestamp ?? index}`} className="align-top">
                        <td className="px-4 py-3 whitespace-nowrap text-slate-900">
                          {entry.parsedTimestamp ? formatCozoroDateTime(entry.parsedTimestamp) : entry.row[TIMESTAMP_COLUMN] ?? "No timestamp"}
                        </td>
                        <td className="px-4 py-3 text-slate-900">{entry.row[PURPOSE_COLUMN] || "Payment receipt"}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{entry.row[AMOUNT_COLUMN] || "-"}</td>
                        <td className="px-4 py-3">{entry.row[PAYER_COLUMN] || "-"}</td>
                        <td className="px-4 py-3">{entry.row[RECEIVER_COLUMN] || "-"}</td>
                        <td className="px-4 py-3">{entry.row[DETAILS_COLUMN] || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredEntries.length > visibleEntries.length ? (
                <button
                  type="button"
                  onClick={() => setVisibleEntriesCount((current) => current + DEFAULT_VISIBLE_ENTRIES)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Show 5 more
                </button>
              ) : null}
              {filteredEntries.length > DEFAULT_VISIBLE_ENTRIES && visibleEntries.length > DEFAULT_VISIBLE_ENTRIES ? (
                <button
                  type="button"
                  onClick={() => setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Show fewer
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
