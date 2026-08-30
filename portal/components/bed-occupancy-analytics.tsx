"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Snapshot = {
  id: string;
  month: string;
  branchId: string;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  unassignedUsers: number;
  snapshotDate: string;
  capturedAt: string;
};

type BranchId = "D2" | "D7";

const BRANCH_COLORS: Record<BranchId, string> = {
  D2: "#0ea5e9",
  D7: "#14b8a6"
};

const CHART = {
  width: 800,
  height: 320,
  padding: { top: 20, right: 24, bottom: 52, left: 52 }
};

function occupancyRate(row: Snapshot) {
  return row.totalBeds ? (row.occupiedBeds / row.totalBeds) * 100 : 0;
}

function formatMonthLabel(month: string) {
  const [year, monthPart] = month.split("-");
  if (!year || !monthPart) {
    return month;
  }
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  if (Number.isNaN(date.getTime())) {
    return month;
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function buildPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) {
    return "";
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function BedOccupancyAnalytics({ actorEmail }: { actorEmail: string }) {
  const { t } = usePortalLanguage();
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/bed-occupancy-history?actorEmail=${encodeURIComponent(actorEmail)}`
      );
      const data = (await response.json()) as { snapshots?: Snapshot[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? t("bedOccupancyLoadError"));
      }
      setRows(data.snapshots ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bedOccupancyLoadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [actorEmail]);

  const months = useMemo(
    () => [...new Set(rows.map((row) => row.month))].sort((left, right) => left.localeCompare(right)),
    [rows]
  );

  const latestByBranch = useMemo(() => {
    const latest = new Map<BranchId, Snapshot>();
    [...rows]
      .sort((left, right) => right.month.localeCompare(left.month))
      .forEach((row) => {
        const branchId = row.branchId as BranchId;
        if ((branchId === "D2" || branchId === "D7") && !latest.has(branchId)) {
          latest.set(branchId, row);
        }
      });
    return latest;
  }, [rows]);

  const chart = useMemo(() => {
    const plotWidth = CHART.width - CHART.padding.left - CHART.padding.right;
    const plotHeight = CHART.height - CHART.padding.top - CHART.padding.bottom;
    const yTicks = [0, 25, 50, 75, 100];
    const xStep = months.length > 1 ? plotWidth / (months.length - 1) : 0;

    const branches: BranchId[] = ["D2", "D7"];
    const series = branches.map((branchId) => {
      const byMonth = new Map(rows.filter((row) => row.branchId === branchId).map((row) => [row.month, row]));
      const points = months
        .map((month, index) => {
          const row = byMonth.get(month);
          if (!row) {
            return null;
          }
          const x = CHART.padding.left + (months.length > 1 ? index * xStep : plotWidth / 2);
          const rate = occupancyRate(row);
          const y = CHART.padding.top + plotHeight - (rate / 100) * plotHeight;
          return { month, row, rate, x, y };
        })
        .filter((point): point is NonNullable<typeof point> => point != null);

      return { branchId, points, path: buildPath(points.map((point) => ({ x: point.x, y: point.y }))) };
    });

    return { plotWidth, plotHeight, yTicks, series };
  }, [months, rows]);

  const hoveredSnapshots = useMemo(() => {
    if (!hoveredMonth) {
      return [];
    }
    return (["D2", "D7"] as BranchId[])
      .map((branchId) => rows.find((row) => row.month === hoveredMonth && row.branchId === branchId))
      .filter((row): row is Snapshot => row != null);
  }, [hoveredMonth, rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{t("bedOccupancyTitle")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("bedOccupancyDesc")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
        >
          {loading ? t("refreshing") : t("refreshWithLabel", { label: t("bedOccupancyTab").toLowerCase() })}
        </button>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {(["D2", "D7"] as BranchId[]).map((branchId) => {
          const row = latestByBranch.get(branchId);
          const rate = row ? occupancyRate(row) : null;
          return (
            <div key={branchId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: BRANCH_COLORS[branchId] }} />
                {branchId} · {t("bedOccupancyLatest")}
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">{rate != null ? `${rate.toFixed(1)}%` : "—"}</p>
              <p className="text-sm text-slate-500">
                {row
                  ? t("bedOccupancyLatestDetail", {
                      occupied: row.occupiedBeds,
                      total: row.totalBeds,
                      month: row.month
                    })
                  : t("bedOccupancyNoSnapshot")}
              </p>
            </div>
          );
        })}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">{t("bedOccupancyTrendTitle")}</h4>
            <p className="mt-1 text-sm text-slate-500">{t("bedOccupancyTrendDesc")}</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            {(["D2", "D7"] as BranchId[]).map((branchId) => (
              <div key={branchId} className="flex items-center gap-2">
                <span className="h-2.5 w-8 rounded-full" style={{ backgroundColor: BRANCH_COLORS[branchId] }} />
                <span>{branchId}</span>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-slate-500">{t("refreshing")}</p>
        ) : months.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
            {t("bedOccupancyNoData")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${CHART.width} ${CHART.height}`}
                className="mx-auto h-auto w-full min-w-[640px] max-w-5xl"
                role="img"
                aria-label={t("bedOccupancyTrendTitle")}
              >
                {chart.yTicks.map((tick) => {
                  const y = CHART.padding.top + chart.plotHeight - (tick / 100) * chart.plotHeight;
                  return (
                    <g key={tick}>
                      <line
                        x1={CHART.padding.left}
                        x2={CHART.width - CHART.padding.right}
                        y1={y}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeDasharray={tick === 0 ? undefined : "4 4"}
                      />
                      <text x={CHART.padding.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                        {tick}%
                      </text>
                    </g>
                  );
                })}

                {months.map((month, index) => {
                  const x =
                    CHART.padding.left +
                    (months.length > 1 ? index * (chart.plotWidth / (months.length - 1)) : chart.plotWidth / 2);
                  const active = hoveredMonth === month;
                  return (
                    <g key={month}>
                      <line
                        x1={x}
                        x2={x}
                        y1={CHART.padding.top}
                        y2={CHART.padding.top + chart.plotHeight}
                        stroke={active ? "#cbd5e1" : "transparent"}
                      />
                      <text
                        x={x}
                        y={CHART.height - 16}
                        textAnchor="middle"
                        className={`text-[11px] ${active ? "fill-slate-900 font-semibold" : "fill-slate-500"}`}
                      >
                        {formatMonthLabel(month)}
                      </text>
                      <rect
                        x={x - 24}
                        y={CHART.padding.top}
                        width={48}
                        height={chart.plotHeight}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredMonth(month)}
                        onMouseLeave={() => setHoveredMonth(null)}
                      />
                    </g>
                  );
                })}

                {chart.series.map((line) => (
                  <g key={line.branchId}>
                    <path
                      d={line.path}
                      fill="none"
                      stroke={BRANCH_COLORS[line.branchId]}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {line.points.map((point) => (
                      <g key={`${line.branchId}-${point.month}`}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={hoveredMonth === point.month ? 6 : 4}
                          fill={BRANCH_COLORS[line.branchId]}
                          stroke="#ffffff"
                          strokeWidth={2}
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredMonth(point.month)}
                          onMouseLeave={() => setHoveredMonth(null)}
                        >
                          <title>
                            {`${line.branchId} ${point.month}: ${point.rate.toFixed(1)}% (${point.row.occupiedBeds}/${point.row.totalBeds})`}
                          </title>
                        </circle>
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            </div>

            {hoveredSnapshots.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {hoveredSnapshots.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: BRANCH_COLORS[row.branchId as BranchId] }}
                      />
                      {row.branchId} · {row.month}
                    </div>
                    <p className="mt-2 text-xl font-bold text-slate-900">{occupancyRate(row).toFixed(1)}%</p>
                    <p className="text-sm text-slate-500">
                      {t("bedOccupancyLatestDetail", {
                        occupied: row.occupiedBeds,
                        total: row.totalBeds,
                        month: row.month
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">{t("bedOccupancyHoverHint")}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
