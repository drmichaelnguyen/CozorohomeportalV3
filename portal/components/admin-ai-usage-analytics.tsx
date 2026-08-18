"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";

type Summary = {
  key: string;
  label?: string;
  modality?: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  imageCount: number;
  estimatedCostUsd: number;
};

type Analytics = {
  days: number;
  totals: Summary;
  byFeature: Summary[];
  byModel: Summary[];
  byModality: Summary[];
  daily: Summary[];
  recent: Array<{
    id: string;
    feature: string;
    featureLabel: string;
    modality: string;
    modalityLabel: string;
    provider: string;
    model: string;
    actorEmail: string | null;
    totalTokens: number;
    imageCount: number;
    estimatedCostUsd: number;
    createdAt: string;
  }>;
  pricing: {
    gemini25FlashInputUsdPerMillion: number;
    gemini25FlashOutputUsdPerMillion: number;
  };
};

const integer = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6
});

function modalityBadge(modality?: string) {
  if (modality === "vision") {
    return "rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800";
  }
  if (modality === "mixed") {
    return "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700";
  }
  return "rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800";
}

export function AdminAiUsageAnalytics({ actorEmail }: { actorEmail: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/ai-usage-analytics?actorEmail=${encodeURIComponent(actorEmail)}&days=${days}`
      );
      const body = (await response.json()) as Analytics & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load AI usage analytics.");
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load AI usage analytics.");
    } finally {
      setLoading(false);
    }
  }, [actorEmail, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const textUsage = data?.byModality.find((row) => row.key === "text");
  const visionUsage = data?.byModality.find((row) => row.key === "vision");
  const cards = data
    ? [
        ["Requests", integer.format(data.totals.requests)],
        ["Total tokens", integer.format(data.totals.totalTokens)],
        ["Vision images", integer.format(data.totals.imageCount)],
        ["Estimated cost", usd.format(data.totals.estimatedCostUsd)]
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">AI token usage and estimated cost</h3>
          <p className="mt-1 text-sm text-slate-500">
            Owner and app-admin analytics. Text chat and computer vision are tracked separately. Costs are estimates based on
            configured list rates, not billing invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Text chat</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{usd.format(textUsage?.estimatedCostUsd ?? 0)}</p>
          <p className="mt-1 text-sm text-slate-600">
            {integer.format(textUsage?.requests ?? 0)} requests · {integer.format(textUsage?.totalTokens ?? 0)} tokens
          </p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Computer vision</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{usd.format(visionUsage?.estimatedCostUsd ?? 0)}</p>
          <p className="mt-1 text-sm text-slate-600">
            {integer.format(visionUsage?.requests ?? 0)} requests · {integer.format(visionUsage?.totalTokens ?? 0)} tokens ·{" "}
            {integer.format(visionUsage?.imageCount ?? 0)} images
          </p>
        </div>
      </div>
      {data ? (
        <p className="text-xs text-slate-500">
          Gemini 2.5 Flash estimate: ${data.pricing.gemini25FlashInputUsdPerMillion}/1M input tokens and $
          {data.pricing.gemini25FlashOutputUsdPerMillion}/1M output/thinking tokens. Vision usage stays at zero until a
          computer-vision feature starts recording with modality `vision`.
        </p>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-2">
        {[
          ["By feature", data?.byFeature],
          ["By provider/model", data?.byModel]
        ].map(([title, rows]) => (
          <div key={String(title)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <h4 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">{String(title)}</h4>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Requests</th>
                  <th className="px-4 py-2">Tokens</th>
                  <th className="px-4 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(rows as Summary[] | undefined)?.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{row.label ?? row.key}</td>
                    <td className="px-4 py-2">
                      <span className={modalityBadge(row.modality)}>{row.modality ?? "text"}</span>
                    </td>
                    <td className="px-4 py-2">{integer.format(row.requests)}</td>
                    <td className="px-4 py-2">{integer.format(row.totalTokens)}</td>
                    <td className="px-4 py-2">{usd.format(row.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <h4 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Recent requests</h4>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">Feature</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Model</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Tokens</th>
              <th className="px-4 py-2">Images</th>
              <th className="px-4 py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data?.recent.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2">{row.featureLabel}</td>
                <td className="px-4 py-2">
                  <span className={modalityBadge(row.modality)}>{row.modalityLabel}</span>
                </td>
                <td className="px-4 py-2">
                  {row.provider}/{row.model}
                </td>
                <td className="px-4 py-2">{row.actorEmail ?? "—"}</td>
                <td className="px-4 py-2">{integer.format(row.totalTokens)}</td>
                <td className="px-4 py-2">{integer.format(row.imageCount)}</td>
                <td className="px-4 py-2">{usd.format(row.estimatedCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
