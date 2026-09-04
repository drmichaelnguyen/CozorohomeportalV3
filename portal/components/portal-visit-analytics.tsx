"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type VisitAnalytics = {
  days: number;
  generatedAt?: string;
  totals: { visits: number; uniqueVisitors: number };
  daily: Array<{ day: string; visits: number; uniqueVisitors: number }>;
  topPaths: Array<{ path: string; count: number }>;
  roleCounts: Array<{ role: string; count: number }>;
  topUsers: Array<{ email: string; role: string | null; visits: number; lastAt: string }>;
  recent: Array<{
    id: string;
    email: string;
    role: string | null;
    path: string;
    device: string | null;
    createdAt: string;
  }>;
  error?: string;
};

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function PortalVisitAnalytics({ actorEmail }: { actorEmail: string }) {
  const { t } = usePortalLanguage();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<VisitAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/portal-visit-analytics?actorEmail=${encodeURIComponent(actorEmail)}&days=${days}`
      );
      const body = (await response.json()) as VisitAnalytics;
      if (!response.ok) {
        throw new Error(body.error ?? t("portalVisitAnalyticsLoadError"));
      }
      setData(body);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : t("portalVisitAnalyticsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [actorEmail, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{t("portalVisitAnalyticsTitle")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("portalVisitAnalyticsDesc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                days === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {t("portalVisitDays", { days: value })}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? t("refreshing") : t("refreshLabel")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("portalVisitTotalVisits")}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {data ? new Intl.NumberFormat().format(data.totals.visits) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("portalVisitUniqueVisitors")}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {data ? new Intl.NumberFormat().format(data.totals.uniqueVisitors) : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-x-auto rounded-2xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
            {t("portalVisitTopPaths")}
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <tbody className="divide-y divide-slate-100 bg-white">
              {(data?.topPaths ?? []).length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500">{t("portalVisitEmpty")}</td>
                </tr>
              ) : (
                data!.topPaths.map((row) => (
                  <tr key={row.path}>
                    <td className="px-4 py-2 font-medium text-slate-800">{row.path}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{row.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="overflow-x-auto rounded-2xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
            {t("portalVisitTopUsers")}
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <tbody className="divide-y divide-slate-100 bg-white">
              {(data?.topUsers ?? []).length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500">{t("portalVisitEmpty")}</td>
                </tr>
              ) : (
                data!.topUsers.map((row) => (
                  <tr key={row.email}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{row.email}</div>
                      <div className="text-xs text-slate-500">
                        {row.role || "—"} · {formatWhen(row.lastAt)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{row.visits}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="overflow-x-auto rounded-2xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
          {t("portalVisitRecent")}
        </div>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">{t("colWhen")}</th>
              <th className="px-4 py-2">{t("portalVisitColUser")}</th>
              <th className="px-4 py-2">{t("portalVisitColPath")}</th>
              <th className="px-4 py-2">{t("portalVisitColDevice")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(data?.recent ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  {loading ? t("loadingLabel") : t("portalVisitEmpty")}
                </td>
              </tr>
            ) : (
              data!.recent.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatWhen(row.createdAt)}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{row.email}</div>
                    <div className="text-xs text-slate-500">{row.role || "—"}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{row.path}</td>
                  <td className="px-4 py-2 text-slate-600">{row.device || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
