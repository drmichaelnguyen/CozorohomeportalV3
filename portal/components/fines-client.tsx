"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
const TIMESTAMP_COLUMN = "Dấu thời gian";
const EMAIL_COLUMN = "EMAIL";
const AMOUNT_COLUMN = "CHI PHÍ THANH TOÁN CHO VI PHẠM";
const STATUS_COLUMN = "ĐÃ THANH TOÁN?";
const CONTENT_COLUMN = "NỘI DUNG VI PHẠM";
const DESCRIPTION_COLUMN = "MÔ TẢ VI PHẠM";
const DUE_COLUMN = "HẠN THANH TOÁN";
const CREATOR_COLUMN = "NGƯỜI LẬP PHIẾU";
const DISPUTE_COLUMN = "Khieu nai tu khach hang";
const IMAGE_COLUMN = "HÌNH ẢNH";

function FineEvidencePreview({ url }: { url: string }) {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const driveId = trimmed.match(/\/file\/d\/([^/]+)/)?.[1];
  if (driveId) {
    return (
      <div className="mt-2 aspect-video w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-black">
        <iframe
          title="Fine evidence"
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          className="h-full w-full"
          allowFullScreen
        />
      </div>
    );
  }

  const lower = trimmed.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/.test(lower)) {
    return <img src={trimmed} alt="" className="mt-2 max-h-56 rounded-lg object-contain" />;
  }
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) {
    return <video src={trimmed} controls className="mt-2 max-h-56 w-full rounded-lg bg-black" />;
  }

  return null;
}

type FineEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
  coinPayment: {
    coinCost: number;
    currentCoins: number;
    canPay: boolean;
    recordedMember: string;
    multiplier: number;
    isPaid: boolean;
  };
};

type FinesLocalCache = {
  email: string;
  entries: FineEntry[];
  savedAt: string;
};

const LOCAL_FINES_CACHE_KEY = "cozorohome-fines-cache";

function parseDisplayDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function FinesClient() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [payingFineKey, setPayingFineKey] = useState("");
  const [disputingFineKey, setDisputingFineKey] = useState("");
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<FineEntry[]>([]);
  const [disputeDrafts, setDisputeDrafts] = useState<Record<string, string>>({});
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");

  const activeEmail = sessionEmail.trim().toLowerCase();

  async function readJsonSafely<T>(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    if (!contentType.includes("application/json")) {
      throw new Error("The server returned HTML instead of JSON. Refresh the page or restart the dev server.");
    }

    return JSON.parse(bodyText) as T;
  }

  function saveLocalCache(nextEmail: string, nextEntries: FineEntry[]) {
    if (typeof window === "undefined") {
      return;
    }

    const payload: FinesLocalCache = {
      email: nextEmail.trim().toLowerCase(),
      entries: nextEntries,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(LOCAL_FINES_CACHE_KEY, JSON.stringify(payload));
  }

  function loadLocalCache(targetEmail: string) {
    if (typeof window === "undefined") {
      return null;
    }

    const raw = window.localStorage.getItem(LOCAL_FINES_CACHE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as FinesLocalCache;
      if (parsed.email !== targetEmail.trim().toLowerCase()) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setEntries([]);

    try {
      const cached = loadLocalCache(activeEmail);
      if (cached) {
        setEntries(cached.entries);
        setMonthFilter("all");
        setYearFilter("all");
        setStatusFilter("all");
        setSortDirection("desc");
        setMessage(`Fine history loaded from local storage. Last saved ${new Date(cached.savedAt).toLocaleString()}.`);
      } else {
        const response = await fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`);
        const data = await readJsonSafely<{ entries?: FineEntry[]; error?: string }>(response);

        if (!response.ok) {
          setMessage(data.error ?? "Unable to load fine history.");
          return;
        }

        const nextEntries = data.entries ?? [];
        setEntries(nextEntries);
        login(activeEmail);
        saveLocalCache(activeEmail, nextEntries);
        setMonthFilter("all");
        setYearFilter("all");
        setStatusFilter("all");
        setSortDirection("desc");
        setMessage("Fine history loaded.");
      }
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets is connected.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshFinesNow() {
    if (!activeEmail) {
      setMessage("Sign in first to load fine history.");
      return;
    }

    setRefreshing(true);
    setMessage("");

    try {
      await fetch(`${API_BASE_URL}/fines/sync`, { method: "POST" });
      const response = await fetch(`${API_BASE_URL}/fines?email=${encodeURIComponent(activeEmail)}`);
      const data = await readJsonSafely<{ entries?: FineEntry[]; error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to refresh fine history.");
        return;
      }

      const nextEntries = data.entries ?? [];
      setEntries(nextEntries);
      saveLocalCache(activeEmail, nextEntries);
      setMonthFilter("all");
      setYearFilter("all");
      setStatusFilter("all");
      setSortDirection("desc");
      setMessage("Fine history refreshed from the API and saved locally.");
    } catch {
      setMessage("Unable to refresh fine history right now.");
    } finally {
      setRefreshing(false);
    }
  }

  async function payFineNow(entry: FineEntry) {
    if (!activeEmail) {
      setMessage("Sign in first to pay this fine.");
      return;
    }

    const fineKey = `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`;
    setPayingFineKey(fineKey);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/fines/pay-by-coins`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          timestamp: entry.row[TIMESTAMP_COLUMN],
          content: entry.row[CONTENT_COLUMN]
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to pay this fine by coins.");
        return;
      }

      await refreshFinesNow();
      setMessage("Fine paid by coins successfully.");
    } catch {
      setMessage("Unable to pay this fine by coins right now.");
    } finally {
      setPayingFineKey("");
    }
  }

  async function submitDisputeNow(entry: FineEntry) {
    if (!activeEmail) {
      setMessage("Sign in first to submit a dispute.");
      return;
    }

    const fineKey = `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`;
    const disputeText = (disputeDrafts[fineKey] ?? "").trim();
    if (!disputeText) {
      setMessage("Enter your dispute first.");
      return;
    }

    setDisputingFineKey(fineKey);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/fines/dispute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          timestamp: entry.row[TIMESTAMP_COLUMN],
          content: entry.row[CONTENT_COLUMN],
          disputeText
        })
      });
      const data = await readJsonSafely<{ error?: string }>(response);

      if (!response.ok) {
        setMessage(data.error ?? "Unable to submit this dispute.");
        return;
      }

      await refreshFinesNow();
      setDisputeDrafts((current) => ({ ...current, [fineKey]: "" }));
      setMessage("Dispute submitted successfully.");
    } catch {
      setMessage("Unable to submit this dispute right now.");
    } finally {
      setDisputingFineKey("");
    }
  }
  useEffect(() => {
    const cached = loadLocalCache(activeEmail);
    if (!cached) {
      return;
    }

    setEntries(cached.entries);
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

  const statusOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.row[STATUS_COLUMN]).filter(Boolean))).sort(),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const next = entries.filter((entry) => {
      const timestamp = parseDisplayDate(entry.parsedTimestamp);
      const monthMatches =
        monthFilter === "all" || (timestamp && String(timestamp.getMonth() + 1).padStart(2, "0") === monthFilter);
      const yearMatches = yearFilter === "all" || (timestamp && String(timestamp.getFullYear()) === yearFilter);
      const statusMatches = statusFilter === "all" || entry.row[STATUS_COLUMN] === statusFilter;
      return Boolean(monthMatches && yearMatches && statusMatches);
    });

    return [...next].sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return sortDirection === "desc"
        ? rightTimestamp.localeCompare(leftTimestamp)
        : leftTimestamp.localeCompare(rightTimestamp);
    });
  }, [entries, monthFilter, yearFilter, statusFilter, sortDirection]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{t("finesTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          View your violation fine history from <code>PHÍ VI PHẠM</code>. This page only loads rows where your email
          matches the fine sheet email column.
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="hidden">
            Signed in as <span className="font-medium">{sessionEmail}</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading || !activeEmail}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? (language === "vi" ? "Đang tải..." : "Loading...") : t("viewFineHistory")}
            </button>
            <button
              type="button"
              onClick={() => void refreshFinesNow()}
              disabled={refreshing || !activeEmail}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {refreshing ? (language === "vi" ? "Đang làm mới..." : "Refreshing...") : t("refreshFines")}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          {language === "vi" ? "Các khoản vi phạm của tôi" : "My Fine Entries"}
        </h2>

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Use your signed-in account to load matching fine rows from <code>PHÍ VI PHẠM</code>.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
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
                {language === "vi" ? "Trạng thái thanh toán" : "Payment Status"}
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {language === "vi" ? "Sắp xếp theo thời gian" : "Sort by time"}
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

            {filteredEntries.length === 0 ? (
              <p className="text-sm text-slate-600">No fine entries match the current filters.</p>
            ) : (
              <div className="space-y-3">
                {filteredEntries.map((entry, index) => (
                  <div key={`${entry.row[EMAIL_COLUMN]}-${entry.parsedTimestamp ?? index}`} className="rounded-xl border border-slate-200 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dấu thời gian</div>
                        <div className="mt-1 text-sm text-slate-900">
                          {parseDisplayDate(entry.parsedTimestamp)?.toLocaleString() ?? entry.row[TIMESTAMP_COLUMN] ?? "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hạn thanh toán</div>
                        <div className="mt-1 text-sm text-slate-900">
                          {parseDisplayDate(entry.parsedDueDate)?.toLocaleString() ?? entry.row[DUE_COLUMN] ?? "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {language === "vi" ? "Người lập phiếu" : "Created by"}
                        </div>
                        <div className="mt-1 text-sm text-slate-900">{entry.row[CREATOR_COLUMN] || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nội dung vi phạm</div>
                        <div className="mt-1 text-sm text-slate-900">{entry.row[CONTENT_COLUMN] || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chi phí</div>
                        <div className="mt-1 text-sm text-slate-900">{entry.row[AMOUNT_COLUMN] || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trạng thái</div>
                        <div className="mt-1 text-sm text-slate-900">{entry.row[STATUS_COLUMN] || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mô tả</div>
                        <div className="mt-1 text-sm text-slate-900">{entry.row[DESCRIPTION_COLUMN] || "-"}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {language === "vi" ? "Ảnh / video minh chứng" : "Photo / video evidence"}
                        </div>
                        {entry.row[IMAGE_COLUMN]?.trim() ? (
                          <div className="mt-1">
                            <a
                              href={entry.row[IMAGE_COLUMN].trim()}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-medium text-sky-700 underline break-all"
                            >
                              {entry.row[IMAGE_COLUMN].trim()}
                            </a>
                            <FineEvidencePreview url={entry.row[IMAGE_COLUMN].trim()} />
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-slate-500">—</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dispute</div>
                        <textarea
                          value={
                            disputeDrafts[`${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`] ??
                            entry.row[DISPUTE_COLUMN] ??
                            ""
                          }
                          onChange={(event) =>
                            setDisputeDrafts((current) => ({
                              ...current,
                              [`${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`]:
                                event.target.value
                            }))
                          }
                          className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Explain why you dispute this fine"
                        />
                        <button
                          type="button"
                          onClick={() => void submitDisputeNow(entry)}
                          disabled={
                            disputingFineKey === `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}` ||
                            !(disputeDrafts[`${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`] ?? entry.row[DISPUTE_COLUMN] ?? "").trim()
                          }
                          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                        >
                          {disputingFineKey === `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`
                            ? "Submitting..."
                            : "Submit dispute"}
                        </button>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pay by coins</div>
                        <div className="mt-1 text-sm text-slate-900">
                          {entry.coinPayment.coinCost.toLocaleString()} coins
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Rank: {entry.coinPayment.recordedMember} • Rate: {entry.coinPayment.multiplier}x • Current coins:{" "}
                          {entry.coinPayment.currentCoins.toLocaleString()}
                        </div>
                        {entry.coinPayment.canPay ? (
                          <button
                            type="button"
                            onClick={() => void payFineNow(entry)}
                            disabled={payingFineKey === `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`}
                            className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          >
                            {payingFineKey === `${entry.row[EMAIL_COLUMN]}-${entry.row[TIMESTAMP_COLUMN]}-${entry.row[CONTENT_COLUMN]}`
                              ? "Paying..."
                              : "Pay by coins"}
                          </button>
                        ) : (
                          <div className="mt-3 text-xs text-slate-500">
                            {entry.coinPayment.isPaid
                              ? "This fine is already paid."
                              : "Not enough coins to pay this fine."}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}




