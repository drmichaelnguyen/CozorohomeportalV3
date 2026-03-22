"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { buildCozoroMemberProgram } from "../lib/cozoro-member";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
const COINS_COLUMN = "COINS";
const EMAIL_COLUMN = "\u0110\u1ecba ch\u1ec9 email";
const TIMESTAMP_COLUMN = "D\u1ea4U TH\u1edcI GIAN";
const EVENT_COLUMN = "S\u1ef1 ki\u1ec7n";

type ClientRecord = Record<string, string>;

type CoinEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
};

type CoinsLocalCache = {
  email: string;
  entries: CoinEntry[];
  savedAt: string;
};

const LOCAL_COINS_CACHE_KEY = "cozorohome-coins-cache";

function parseDisplayDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCoinAmount(value: string | undefined) {
  const normalized = (value ?? "").replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCoins(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function CoinsClient() {
  const DEFAULT_VISIBLE_ENTRIES = 10;
  const { t, language } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<CoinEntry[]>([]);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [refreshing, setRefreshing] = useState(false);
  const [showHistoryTools, setShowHistoryTools] = useState(false);
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

  function saveLocalCache(nextEmail: string, nextEntries: CoinEntry[]) {
    if (typeof window === "undefined") {
      return;
    }

    const payload: CoinsLocalCache = {
      email: nextEmail.trim().toLowerCase(),
      entries: nextEntries,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(LOCAL_COINS_CACHE_KEY, JSON.stringify(payload));
  }

  function loadLocalCache(targetEmail: string) {
    if (typeof window === "undefined") {
      return null;
    }

    const raw = window.localStorage.getItem(LOCAL_COINS_CACHE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CoinsLocalCache;
      if (parsed.email !== targetEmail.trim().toLowerCase()) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function fetchCoins(targetEmail: string) {
    const response = await fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(targetEmail.trim())}`);
    return readJsonSafely<{ entries?: CoinEntry[]; error?: string }>(response);
  }

  async function fetchClient(targetEmail: string) {
    const response = await fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(targetEmail.trim())}`);
    return {
      response,
      data: await readJsonSafely<ClientRecord | { error?: string }>(response)
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setEntries([]);
    setClient(null);

    try {
      const cached = loadLocalCache(activeEmail);
      const clientResult = await fetchClient(activeEmail);
      if (clientResult.response.ok) {
        setClient(clientResult.data as ClientRecord);
      }

      if (cached) {
        setEntries(cached.entries);
        setMonthFilter("all");
        setYearFilter("all");
        setDayFilter("all");
        setEventFilter("all");
        setSortDirection("desc");
        setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
        setMessage(`Coin history loaded from local storage. Last saved ${new Date(cached.savedAt).toLocaleString()}.`);
      } else {
        const response = await fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`);
        const data = await readJsonSafely<{ entries?: CoinEntry[]; error?: string }>(response);

        if (!response.ok) {
          setMessage(data.error ?? "Unable to load coin history.");
          return;
        }

        const nextEntries = data.entries ?? [];
        setEntries(nextEntries);
        login(activeEmail);
        saveLocalCache(activeEmail, nextEntries);
        setMonthFilter("all");
        setYearFilter("all");
        setDayFilter("all");
        setEventFilter("all");
        setSortDirection("desc");
        setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
        setMessage("Coin history loaded.");
      }
    } catch {
      setMessage("API request failed. Make sure the API is running and Google Sheets is connected.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshCoinsNow() {
    if (!activeEmail) {
      setMessage("Sign in first to load coin history.");
      return;
    }

    setRefreshing(true);
    setMessage("");

    try {
      const [coinsResponse, clientResult] = await Promise.all([
        fetch(`${API_BASE_URL}/coins?email=${encodeURIComponent(activeEmail)}`),
        fetchClient(activeEmail)
      ]);
      const data = await readJsonSafely<{ entries?: CoinEntry[]; error?: string }>(coinsResponse);

      if (!coinsResponse.ok) {
        setMessage(data.error ?? "Unable to refresh coin history.");
        return;
      }

      if (clientResult.response.ok) {
        setClient(clientResult.data as ClientRecord);
      }

      const nextEntries = data.entries ?? [];
      setEntries(nextEntries);
      saveLocalCache(activeEmail, nextEntries);
      setMonthFilter("all");
      setYearFilter("all");
      setDayFilter("all");
      setEventFilter("all");
      setSortDirection("desc");
      setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
      setMessage("Coin history refreshed from the API and saved locally.");
    } catch {
      setMessage("Unable to refresh coin history right now.");
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

  const eventOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.row[EVENT_COLUMN]).filter(Boolean))).sort(),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const next = entries.filter((entry) => {
      const timestamp = parseDisplayDate(entry.parsedTimestamp);
      const monthMatches =
        monthFilter === "all" || (timestamp && String(timestamp.getMonth() + 1).padStart(2, "0") === monthFilter);
      const yearMatches = yearFilter === "all" || (timestamp && String(timestamp.getFullYear()) === yearFilter);
      const dayMatches = dayFilter === "all" || (timestamp && String(timestamp.getDate()).padStart(2, "0") === dayFilter);
      const eventMatches = eventFilter === "all" || entry.row[EVENT_COLUMN] === eventFilter;

      return Boolean(monthMatches && yearMatches && dayMatches && eventMatches);
    });

    return [...next].sort((left, right) => {
      const leftTimestamp = left.parsedTimestamp ?? "";
      const rightTimestamp = right.parsedTimestamp ?? "";
      return sortDirection === "desc"
        ? rightTimestamp.localeCompare(leftTimestamp)
        : leftTimestamp.localeCompare(rightTimestamp);
    });
  }, [dayFilter, entries, eventFilter, monthFilter, sortDirection, yearFilter]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, visibleEntriesCount),
    [filteredEntries, visibleEntriesCount]
  );

  useEffect(() => {
    setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES);
  }, [DEFAULT_VISIBLE_ENTRIES, monthFilter, yearFilter, dayFilter, eventFilter, sortDirection]);

  const coinStats = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
    const lastMonth = lastMonthDate.getMonth();
    const lastMonthYear = lastMonthDate.getFullYear();
    const previousCalendarYear = thisYear - 1;

    let earnedTotal = 0;
    let usedTotal = 0;
    let usedThisMonth = 0;
    let usedLastMonth = 0;
    let usedLastYear = 0;

    const earnedByMonth = new Map<string, number>();
    const earnedByCategory = new Map<string, number>();

    for (const entry of entries) {
      const amount = parseCoinAmount(entry.row[COINS_COLUMN]);
      const timestamp = parseDisplayDate(entry.parsedTimestamp);
      const category = entry.row[EVENT_COLUMN] || "Other";

      if (amount > 0) {
        earnedTotal += amount;
        earnedByCategory.set(category, (earnedByCategory.get(category) ?? 0) + amount);

        if (timestamp) {
          const monthKey = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`;
          earnedByMonth.set(monthKey, (earnedByMonth.get(monthKey) ?? 0) + amount);
        }
      } else if (amount < 0) {
        const usedAmount = Math.abs(amount);
        usedTotal += usedAmount;

        if (timestamp) {
          const month = timestamp.getMonth();
          const year = timestamp.getFullYear();

          if (month === thisMonth && year === thisYear) {
            usedThisMonth += usedAmount;
          }
          if (month === lastMonth && year === lastMonthYear) {
            usedLastMonth += usedAmount;
          }
          if (year === previousCalendarYear) {
            usedLastYear += usedAmount;
          }
        }
      }
    }

    return {
      earnedTotal,
      usedTotal,
      usedThisMonth,
      usedLastMonth,
      usedLastYear,
      currentCoins: earnedTotal - usedTotal,
      earnedByMonth: Array.from(earnedByMonth.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([key, value]) => ({ key, label: key, value })),
      earnedByCategory: Array.from(earnedByCategory.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([key, value]) => ({ key, label: key, value }))
    };
  }, [entries]);

  const maxMonthlyEarned = useMemo(
    () => Math.max(1, ...coinStats.earnedByMonth.map((entry) => entry.value)),
    [coinStats.earnedByMonth]
  );
  const maxCategoryEarned = useMemo(
    () => Math.max(1, ...coinStats.earnedByCategory.map((entry) => entry.value)),
    [coinStats.earnedByCategory]
  );
  const memberProgram = useMemo(
    () =>
      buildCozoroMemberProgram({
        rankValue: client?.["Cozoro Member"] ?? entries[0]?.row["Cozoro Member"] ?? "",
        branchId: client?.["Chi nhánh Cozoro dorm"] ?? "",
        totalAccumulatedCoins: client?.["Tổng Coins tích luỹ"] ?? coinStats.earnedTotal
      }),
    [client, coinStats.earnedTotal, entries]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{t("coinsTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          View your Cozoro coin history. This page only loads rows where your email matches the sheet email column.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading || !activeEmail}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? (language === "vi" ? "Đang tải..." : "Loading...") : t("viewCoinHistory")}
            </button>
            <button
              type="button"
              onClick={() => void refreshCoinsNow()}
              disabled={refreshing || !activeEmail}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              {refreshing ? (language === "vi" ? "Đang làm mới..." : "Refreshing...") : t("refreshCoins")}
            </button>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {entries.length > 0 ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Coin Summary</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Used Last Month</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCoins(coinStats.usedLastMonth)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Used This Month</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCoins(coinStats.usedThisMonth)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Used Last Year</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCoins(coinStats.usedLastYear)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Earned</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">{formatCoins(coinStats.earnedTotal)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Used</div>
              <div className="mt-2 text-2xl font-semibold text-rose-700">{formatCoins(coinStats.usedTotal)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Coins</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCoins(coinStats.currentCoins)}</div>
              <div className="mt-1 text-xs text-slate-500">Earned minus used</div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-base font-semibold text-slate-900">Coins Earned by Month</h3>
              {coinStats.earnedByMonth.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No earned coin data is available yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {coinStats.earnedByMonth.map((entry) => (
                    <div key={entry.key}>
                      <div className="mb-1 flex items-center justify-between text-sm text-slate-700">
                        <span>{entry.label}</span>
                        <span>{formatCoins(entry.value)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-100">
                        <div
                          className="h-3 rounded-full bg-slate-900"
                          style={{ width: `${Math.max(6, (entry.value / maxMonthlyEarned) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-base font-semibold text-slate-900">Coins Earned by Category</h3>
              {coinStats.earnedByCategory.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No earned categories are available yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {coinStats.earnedByCategory.map((entry) => (
                    <div key={entry.key}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm text-slate-700">
                        <span className="truncate">{entry.label}</span>
                        <span>{formatCoins(entry.value)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-100">
                        <div
                          className="h-3 rounded-full bg-emerald-600"
                          style={{ width: `${Math.max(6, (entry.value / maxCategoryEarned) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">{t("myCoinEntries")}</h2>

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Use your signed-in account to load matching coin rows from <code>COZORO COINS</code>.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="text-sm font-medium text-slate-900">{t("recentHistory")}</div>
                <div className="text-xs text-slate-500">
                  Showing {Math.min(visibleEntries.length, filteredEntries.length)} of {filteredEntries.length} matching entries.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryTools((current) => !current)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                {showHistoryTools ? t("hideFilters") : t("showFilters")}
              </button>
            </div>

            {showHistoryTools ? <div className="grid gap-3 md:grid-cols-5">
              <label className="block text-sm font-medium text-slate-700">
                Month
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
                Year
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
                Day
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
                Event
                <select
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="all">All events</option>
                  {eventOptions.map((eventName) => (
                    <option key={eventName} value={eventName}>
                      {eventName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Sort by time
                <select
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value as "desc" | "asc")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
            </div> : null}

            {filteredEntries.length === 0 ? (
              <p className="text-sm text-slate-600">
                {language === "vi" ? "Không có giao dịch coins nào phù hợp với bộ lọc hiện tại." : "No coin entries match the current filters."}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{t("timestamp")}</th>
                        <th className="px-4 py-3">{t("event")}</th>
                        <th className="px-4 py-3">Coins</th>
                        <th className="px-4 py-3">{t("operator")}</th>
                        <th className="px-4 py-3">Cozoro Member</th>
                        <th className="px-4 py-3">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {visibleEntries.map((entry, index) => (
                        <tr key={`${entry.row[TIMESTAMP_COLUMN]}-${index}`} className="align-top">
                          <td className="px-4 py-3 whitespace-nowrap text-slate-900">
                            {entry.parsedTimestamp
                              ? new Date(entry.parsedTimestamp).toLocaleString()
                              : entry.row[TIMESTAMP_COLUMN] || "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-900">{entry.row[EVENT_COLUMN] || "-"}</td>
                          <td
                            className={`px-4 py-3 font-medium ${
                              parseCoinAmount(entry.row[COINS_COLUMN]) >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {entry.row[COINS_COLUMN] || "-"}
                          </td>
                          <td className="px-4 py-3">{entry.row["Người thao tác"] || "-"}</td>
                          <td className="px-4 py-3">{entry.row["Cozoro Member"] || "-"}</td>
                          <td className="px-4 py-3 break-all">{entry.row[EMAIL_COLUMN] || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {showHistoryTools && filteredEntries.length > visibleEntries.length ? (
                  <button
                    type="button"
                    onClick={() => setVisibleEntriesCount((current) => current + 10)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    {t("showMore10")}
                  </button>
                ) : null}
                {showHistoryTools &&
                filteredEntries.length > DEFAULT_VISIBLE_ENTRIES &&
                visibleEntries.length > DEFAULT_VISIBLE_ENTRIES ? (
                  <button
                    type="button"
                    onClick={() => setVisibleEntriesCount(DEFAULT_VISIBLE_ENTRIES)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    {t("showFewer")}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>

      {entries.length > 0 ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Cozoro Member Status</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded Cozoro Member</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memberProgram.recordedRank}</div>
              <div className="mt-1 text-xs text-slate-500">Sheet value, updated monthly</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculated Cozoro Member</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memberProgram.liveRank}</div>
              <div className="mt-1 text-xs text-slate-500">Calculated from current accumulated coins</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accumulated Coins</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {formatCoins(memberProgram.totalAccumulatedCoins)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coins To Next Cozoro Member</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {memberProgram.nextTier ? formatCoins(memberProgram.nextTier.remainingCoins) : "0"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {memberProgram.nextTier ? `Next: ${memberProgram.nextTier.name}` : "Top Cozoro Member reached"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coins To Remain</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {memberProgram.maintainCoinsNeeded != null ? formatCoins(memberProgram.maintainCoinsNeeded) : "-"}
              </div>
              <div className="mt-1 text-xs text-slate-500">Minimum needed this month to keep the current Cozoro Member</div>
            </div>
          </div>
        </section>
      ) : null}

      {entries.length > 0 ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Member Program</h2>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-base font-semibold text-slate-900">Cozoro Member</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Cozoro Member</div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">{memberProgram.rank}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accumulated Coins</div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">
                    {formatCoins(memberProgram.totalAccumulatedCoins)}
                  </div>
                </div>
              </div>

              {(memberProgram.branchId === "D7" || memberProgram.branchId === "D2") && memberProgram.currentTier ? (
                <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">{memberProgram.branchId} live tier: {memberProgram.currentTier.name}</div>
                  <div className="mt-2">VND exchange rate: {memberProgram.currentTier.exchangeRate}</div>
                  <div className="mt-1">Free laundry each month: {memberProgram.currentTier.freeLaundry}</div>
                  <div className="mt-1">Monthly coins to maintain: {memberProgram.currentTier.monthlyMaintainCoins}</div>
                  {memberProgram.nextTier ? (
                    <div className="mt-2 text-xs text-slate-500">
                      {formatCoins(memberProgram.nextTier.remainingCoins)} more accumulated coins to reach{" "}
                      {memberProgram.nextTier.name}.
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                {memberProgram.earnRules.map((rule) => (
                  <div
                    key={`${rule.category}-${rule.label}`}
                    className="flex items-start justify-between gap-4 rounded-lg border border-slate-100 p-3"
                  >
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rule.category}</div>
                      <div className="mt-1 text-sm text-slate-900">{rule.label}</div>
                    </div>
                    <div className="text-sm font-semibold text-emerald-700">{rule.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-base font-semibold text-slate-900">Where Coins Can Be Used</h3>
              <div className="mt-4 space-y-3">
                {memberProgram.usageRules.map((rule) => (
                  <div key={rule} className="rounded-lg border border-slate-100 p-3 text-sm text-slate-700">
                    {rule}
                  </div>
                ))}
              </div>

              {memberProgram.branchId === "D7" || memberProgram.branchId === "D2" ? (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {memberProgram.branchId} Member Privileges
                  </h4>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-slate-700">
                      <thead className="text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-2">Tier</th>
                          <th className="px-2 py-2">Thăng hạng</th>
                          <th className="px-2 py-2">Tỷ giá</th>
                          <th className="px-2 py-2">Giặt / sấy</th>
                          <th className="px-2 py-2">Duy trì / tháng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memberProgram.branchTiers.map((tier) => (
                          <tr key={tier.name} className={tier.name === memberProgram.currentTier?.name ? "bg-slate-50" : ""}>
                            <td className="px-2 py-2 font-medium text-slate-900">{tier.name}</td>
                            <td className="px-2 py-2">{tier.threshold == null ? "-" : formatCoins(tier.threshold)}</td>
                            <td className="px-2 py-2">{tier.exchangeRate}</td>
                            <td className="px-2 py-2">{tier.freeLaundry}</td>
                            <td className="px-2 py-2">{tier.monthlyMaintainCoins}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
