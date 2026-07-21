"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

type Snapshot = { id: string; month: string; branchId: string; totalBeds: number; occupiedBeds: number; availableBeds: number; unassignedUsers: number; snapshotDate: string; capturedAt: string };

export function BedOccupancyAnalytics({ actorEmail }: { actorEmail: string }) {
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/manager/bed-occupancy-history?actorEmail=${encodeURIComponent(actorEmail)}`);
      const data = await response.json() as { snapshots?: Snapshot[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load occupancy history.");
      setRows(data.snapshots ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load occupancy history."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [actorEmail]);
  const latest = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const rate = (row: Snapshot) => row.totalBeds ? row.occupiedBeds / row.totalBeds : 0;
  return <div className="space-y-5">
    <div><h3 className="text-lg font-semibold text-slate-900">Bed occupancy through time</h3><p className="mt-1 text-sm text-slate-500">A monthly snapshot is recorded on or after the 15th. Inventory: D2 = 21 beds, D7 = 63 beds.</p></div>
    {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">{["D2", "D7"].map(branch => { const row = latest.find(item => item.branchId === branch); return <div key={branch} className="rounded-2xl border border-slate-200 p-4"><p className="text-sm font-semibold">{branch} latest</p><p className="mt-2 text-2xl font-bold">{row ? `${(rate(row) * 100).toFixed(1)}%` : "—"}</p><p className="text-sm text-slate-500">{row ? `${row.occupiedBeds} occupied · ${row.availableBeds} available · ${row.month}` : "No snapshot yet"}</p></div>; })}</div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[650px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-3">Month</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Occupied</th><th className="px-4 py-3">Available</th><th className="px-4 py-3">Occupancy</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3">{row.month}</td><td className="px-4 py-3 font-medium">{row.branchId}</td><td className="px-4 py-3">{row.occupiedBeds}/{row.totalBeds}</td><td className="px-4 py-3">{row.availableBeds}</td><td className="px-4 py-3"><div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-600" style={{ width: `${rate(row) * 100}%` }} /></div><span className="text-xs">{(rate(row) * 100).toFixed(1)}%</span></td></tr>)}</tbody></table>{loading ? <p className="p-4 text-sm text-slate-500">Loading…</p> : null}</div>
  </div>;
}
