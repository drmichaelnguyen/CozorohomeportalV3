"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type RankingEntry = {
  rank: number;
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  recordedMember: string;
  liveTier: string;
  tierMismatch: boolean;
  currentCoins: number;
  totalCoins: number;
  previousMonthEarnings: number;
  tierIndex: number;
};

type HistoryEntry = {
  at: string;
  email: string;
  name: string;
  branch: string;
  maHd: string;
  fromTier: string;
  toTier: string;
  event: string;
  source: "paid_upgrade" | "coins_row" | "manual_event";
  coinDelta: number | null;
};

type AnalyticsPayload = {
  ranking?: RankingEntry[];
  tierCounts?: Array<{ tier: string; count: number }>;
  history?: HistoryEntry[];
  historyNote?: string;
  generatedAt?: string;
  error?: string;
};

type BranchFilter = "all" | "D2" | "D7";

const TIER_BADGE: Record<string, string> = {
  Silver: "bg-slate-100 text-slate-700",
  Gold: "bg-amber-100 text-amber-800",
  Platinum: "bg-sky-100 text-sky-800",
  Diamond: "bg-violet-100 text-violet-800",
  Elite: "bg-rose-100 text-rose-800"
};

function formatCoins(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function tierBadgeClass(tier: string) {
  return TIER_BADGE[tier] ?? "bg-slate-100 text-slate-700";
}

function sourceLabel(
  source: HistoryEntry["source"],
  t: (key: string, fallback?: string) => string
) {
  if (source === "paid_upgrade") return t("memberTierHistorySourceUpgrade");
  if (source === "manual_event") return t("memberTierHistorySourceManual");
  return t("memberTierHistorySourceSnapshot");
}

export function MemberTierAnalytics({
  actorEmail,
  onOpenClient
}: {
  actorEmail: string;
  onOpenClient?: (maHd: string) => void;
}) {
  const { t } = usePortalLanguage();
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [tierCounts, setTierCounts] = useState<Array<{ tier: string; count: number }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branchFilter, setBranchFilter] = useState<BranchFilter>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const load = useCallback(
    async (sync = false) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          actorEmail,
          historyLimit: "200"
        });
        if (sync) params.set("sync", "1");
        const response = await fetch(`${API_BASE_URL}/manager/member-tier-analytics?${params}`);
        const data = (await response.json()) as AnalyticsPayload;
        if (!response.ok) {
          throw new Error(data.error ?? t("memberTierAnalyticsLoadError"));
        }
        setRanking(data.ranking ?? []);
        setTierCounts(data.tierCounts ?? []);
        setHistory(data.history ?? []);
        setGeneratedAt(data.generatedAt ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : t("memberTierAnalyticsLoadError"));
        setRanking([]);
        setTierCounts([]);
        setHistory([]);
      } finally {
        setLoading(false);
      }
    },
    [actorEmail, t]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const filteredRanking = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ranking.filter((row) => {
      if (branchFilter !== "all" && row.branch !== branchFilter) return false;
      if (tierFilter !== "all" && row.liveTier !== tierFilter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.maHd.toLowerCase().includes(q) ||
        row.bed.toLowerCase().includes(q)
      );
    });
  }, [ranking, branchFilter, tierFilter, search]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return history.filter((row) => {
      if (branchFilter !== "all" && row.branch !== branchFilter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.fromTier.toLowerCase().includes(q) ||
        row.toTier.toLowerCase().includes(q) ||
        row.event.toLowerCase().includes(q)
      );
    });
  }, [history, historySearch, branchFilter]);

  const mismatchCount = useMemo(
    () => ranking.filter((row) => row.tierMismatch).length,
    [ranking]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{t("memberTierAnalyticsTitle")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("memberTierAnalyticsDesc")}</p>
          {generatedAt ? (
            <p className="mt-1 text-xs text-slate-500">
              {t("memberTierAnalyticsUpdated", { when: formatWhen(generatedAt) })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? t("refreshing") : t("memberTierAnalyticsRefresh")}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tierCounts.map((item) => (
          <button
            key={item.tier}
            type="button"
            onClick={() => setTierFilter((prev) => (prev === item.tier ? "all" : item.tier))}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              tierFilter === item.tier
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 hover:bg-white"
            }`}
          >
            <div className={`text-xs font-semibold uppercase tracking-wide ${tierFilter === item.tier ? "text-slate-300" : "text-slate-500"}`}>
              {item.tier}
            </div>
            <div className="mt-1 text-2xl font-semibold">{item.count}</div>
          </button>
        ))}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {t("memberTierMismatchLabel")}
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-900">{mismatchCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "D2", "D7"] as BranchFilter[]).map((branch) => (
          <button
            key={branch}
            type="button"
            onClick={() => setBranchFilter(branch)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              branchFilter === branch ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {branch === "all" ? t("memberTierFilterAllBranches") : branch}
          </button>
        ))}
        {tierFilter !== "all" ? (
          <button
            type="button"
            onClick={() => setTierFilter("all")}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            {t("memberTierClearTierFilter")}
          </button>
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">{t("memberTierRankingTitle")}</h4>
            <p className="text-xs text-slate-500">{t("memberTierRankingHint")}</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("memberTierSearchPlaceholder")}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">{t("name")}</th>
                <th className="px-3 py-3">{t("dimBranch")}</th>
                <th className="px-3 py-3">{t("memberTierColLive")}</th>
                <th className="px-3 py-3">{t("memberTierColRecorded")}</th>
                <th className="px-3 py-3 text-right">{t("memberTierColTotal")}</th>
                <th className="px-3 py-3 text-right">{t("memberTierColCurrent")}</th>
                <th className="px-3 py-3 text-right">{t("memberTierColPrevMonth")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && filteredRanking.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    {t("loadingLabel")}
                  </td>
                </tr>
              ) : filteredRanking.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    {t("memberTierRankingEmpty")}
                  </td>
                </tr>
              ) : (
                filteredRanking.map((row) => (
                  <tr key={row.maHd || row.email} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{row.rank}</td>
                    <td className="px-3 py-2.5">
                      {onOpenClient && row.maHd ? (
                        <button
                          type="button"
                          onClick={() => onOpenClient(row.maHd)}
                          className="text-left font-medium text-slate-900 hover:underline"
                        >
                          {row.name}
                        </button>
                      ) : (
                        <div className="font-medium text-slate-900">{row.name}</div>
                      )}
                      <div className="text-xs text-slate-500">
                        {row.email}
                        {row.bed ? ` · ${t("bedLabel")} ${row.bed}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{row.branch || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.liveTier)}`}>
                        {row.liveTier}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.recordedMember)}`}>
                        {row.recordedMember}
                      </span>
                      {row.tierMismatch ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">{t("memberTierMismatchHint")}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{formatCoins(row.totalCoins)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{formatCoins(row.currentCoins)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                      {formatCoins(row.previousMonthEarnings)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">{t("memberTierHistoryTitle")}</h4>
            <p className="text-xs text-slate-500">{t("memberTierHistoryHint")}</p>
          </div>
          <input
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder={t("memberTierHistorySearchPlaceholder")}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">{t("colWhen")}</th>
                <th className="px-3 py-3">{t("name")}</th>
                <th className="px-3 py-3">{t("memberTierHistoryChange")}</th>
                <th className="px-3 py-3">{t("colEvent")}</th>
                <th className="px-3 py-3">{t("memberTierHistorySource")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    {t("loadingLabel")}
                  </td>
                </tr>
              ) : filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    {t("memberTierHistoryEmpty")}
                  </td>
                </tr>
              ) : (
                filteredHistory.map((row, index) => (
                  <tr key={`${row.email}-${row.at}-${row.fromTier}-${row.toTier}-${index}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{formatWhen(row.at)}</td>
                    <td className="px-3 py-2.5">
                      {onOpenClient && row.maHd ? (
                        <button
                          type="button"
                          onClick={() => onOpenClient(row.maHd)}
                          className="text-left font-medium text-slate-900 hover:underline"
                        >
                          {row.name}
                        </button>
                      ) : (
                        <div className="font-medium text-slate-900">{row.name}</div>
                      )}
                      <div className="text-xs text-slate-500">
                        {row.email}
                        {row.branch ? ` · ${row.branch}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.fromTier)}`}>
                          {row.fromTier}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.toTier)}`}>
                          {row.toTier}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <div>{row.event || "—"}</div>
                      {row.coinDelta != null && row.coinDelta !== 0 ? (
                        <div className="text-xs text-slate-500">
                          {row.coinDelta > 0 ? "+" : ""}
                          {formatCoins(row.coinDelta)} coins
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{sourceLabel(row.source, t)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
