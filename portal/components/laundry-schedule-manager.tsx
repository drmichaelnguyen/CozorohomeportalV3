"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { InlineHelp } from "./inline-help";

type Booking = {
  id: string;
  summary: string;
  start: string;
  end: string;
  calendarSummary: string;
};

type MachineSchedule = {
  id: string;
  summary: string;
  machineId: string;
  label: string;
  branchId: "D2" | "D7" | null;
  type: "WASHER" | "DRYER" | null;
  durationMinutes: number | null;
  cooldownMinutes: number;
  updatedAt: string | null;
  updatedBy: string | null;
  previous: Booking[];
  upcoming: Booking[];
};

function formatDuration(minutes: number | null) {
  if (minutes === null) {
    return "-";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (remainder === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainder}m`;
}

export function LaundryScheduleManager({ actorEmail }: { actorEmail: string }) {
  const [schedules, setSchedules] = useState<MachineSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterBranch, setFilterBranch] = useState("All");
  const [durationInputs, setDurationInputs] = useState<Record<string, string>>({});
  const [cooldownInputs, setCooldownInputs] = useState<Record<string, string>>({});
  const [savingMachineId, setSavingMachineId] = useState("");
  const [statusByMachineId, setStatusByMachineId] = useState<Record<string, { tone: "success" | "error"; message: string }>>({});

  async function fetchSchedules() {
    try {
      setError("");
      const response = await fetch(`${API_BASE_URL}/manager/laundry/schedule`);
      if (!response.ok) {
        throw new Error("Failed to fetch laundry schedules");
      }
      const data = (await response.json()) as MachineSchedule[];
      setSchedules(data);
      setDurationInputs(
        Object.fromEntries(
          data.map((machine) => [machine.machineId, String(machine.durationMinutes ?? 0)])
        )
      );
      setCooldownInputs(
        Object.fromEntries(data.map((machine) => [machine.machineId, String(machine.cooldownMinutes ?? 0)]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load laundry schedules");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSchedules();
  }, []);

  const branches = useMemo(() => {
    const values = new Set<string>(["All"]);
    schedules.forEach((schedule) => {
      if (schedule.branchId) {
        values.add(schedule.branchId);
      }
    });
    return Array.from(values).sort();
  }, [schedules]);

  const filteredSchedules = useMemo(() => {
    if (filterBranch === "All") {
      return schedules;
    }
    return schedules.filter((schedule) => schedule.branchId === filterBranch);
  }, [schedules, filterBranch]);

  async function saveCooldown(machineId: string) {
    const durationInput = durationInputs[machineId] ?? "0";
    const cooldownInput = cooldownInputs[machineId] ?? "0";
    const durationMinutes = Number.parseInt(durationInput, 10);
    const cooldownMinutes = Number.parseInt(cooldownInput, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 10) {
      setStatusByMachineId((current) => ({
        ...current,
        [machineId]: { tone: "error", message: "Duration must be at least 10 minutes." }
      }));
      return;
    }
    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
      setStatusByMachineId((current) => ({
        ...current,
        [machineId]: { tone: "error", message: "Cooldown must be 0 minutes or more." }
      }));
      return;
    }

    setSavingMachineId(machineId);
    setStatusByMachineId((current) => {
      const next = { ...current };
      delete next[machineId];
      return next;
    });

    try {
      const response = await fetch(`${API_BASE_URL}/manager/laundry/machines/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail,
          machineId,
          durationMinutes,
          cooldownMinutes
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save cooldown");
      }

      setStatusByMachineId((current) => ({
        ...current,
        [machineId]: { tone: "success", message: "Machine settings updated." }
      }));
      await fetchSchedules();
    } catch (err) {
      setStatusByMachineId((current) => ({
        ...current,
        [machineId]: { tone: "error", message: err instanceof Error ? err.message : "Unable to save cooldown." }
      }));
    } finally {
      setSavingMachineId("");
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading schedules...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-rose-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">Laundry Machine Timelines</h2>
            <InlineHelp
              label="How laundry timing works"
              title="Laundry Calendar Logic"
              body={
                "Managers set two values for each machine:\n\n" +
                "Duration: how long one booking runs.\n" +
                "Cooldown: how long the machine stays unavailable after that booking ends.\n\n" +
                "Calendar example:\n" +
                "- Booking starts at 10:00\n" +
                "- Duration is 75 minutes\n" +
                "- Booking ends at 11:15\n" +
                "- Cooldown is 30 minutes\n" +
                "- Next available booking can start at 11:45\n\n" +
                "Rule used by the system:\n" +
                "next available start = booking start + duration + cooldown"
              }
            />
          </div>
          <p className="mt-1 text-sm text-slate-500">Managers can set both booking duration and cooldown. Next slot = start time + duration + cooldown.</p>
        </div>
        <div className="flex gap-2">
          {branches.map((branch) => (
            <button
              key={branch}
              onClick={() => setFilterBranch(branch)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                filterBranch === branch ? "bg-slate-900 text-white shadow-md" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {branch}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6">
        {filteredSchedules.map((machine) => {
          const status = statusByMachineId[machine.machineId];
          const saving = savingMachineId === machine.machineId;
          return (
            <div key={machine.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4">
                <div>
                  <h3 className="flex items-center gap-2 font-bold text-slate-900">
                    <span className="h-2 w-2 rounded-full bg-sky-500"></span>
                    {machine.label}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {machine.branchId ?? "-"} {machine.type ? `| ${machine.type}` : ""} {machine.durationMinutes !== null ? `| ${formatDuration(machine.durationMinutes)} cycle` : ""}
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-400">{machine.machineId}</span>
              </div>

              <div className="grid gap-8 p-6 lg:grid-cols-[320px_1fr_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">Machine setup</div>
                  <div className="mt-4 text-sm text-slate-700">
                    <div>Duration: <span className="font-semibold text-slate-900">{formatDuration(machine.durationMinutes)}</span></div>
                    <div className="mt-2">Current cooldown: <span className="font-semibold text-slate-900">{machine.cooldownMinutes} min</span></div>
                    <div className="mt-2">Next start rule: <span className="font-semibold text-slate-900">start + duration + cooldown</span></div>
                    {machine.updatedAt ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Last updated {new Date(machine.updatedAt).toLocaleString()}
                        {machine.updatedBy ? ` by ${machine.updatedBy}` : ""}
                      </div>
                    ) : null}
                  </div>

                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Duration per booking
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min={10}
                        step={1}
                        value={durationInputs[machine.machineId] ?? ""}
                        onChange={(event) =>
                          setDurationInputs((current) => ({
                            ...current,
                            [machine.machineId]: event.target.value
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                      <span className="flex items-center text-sm text-slate-500">min</span>
                    </div>
                  </label>

                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Cooldown after booking ends
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={cooldownInputs[machine.machineId] ?? ""}
                        onChange={(event) =>
                          setCooldownInputs((current) => ({
                            ...current,
                            [machine.machineId]: event.target.value
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                      <span className="flex items-center text-sm text-slate-500">min</span>
                      <button
                        type="button"
                        onClick={() => void saveCooldown(machine.machineId)}
                        disabled={saving}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </label>

                  {status ? (
                    <p className={`mt-3 text-sm ${status.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                      {status.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <h4 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Past 5 Bookings</h4>
                  <div className="space-y-3">
                    {machine.previous.length === 0 ? (
                      <p className="text-sm italic text-slate-400">No recent history</p>
                    ) : (
                      machine.previous.map((booking) => (
                        <div key={booking.id} className="flex gap-4 rounded-2xl border border-slate-100 bg-slate-50/30 p-3 opacity-70">
                          <div className="w-24 shrink-0 text-[10px] font-bold text-slate-400">
                            {new Date(booking.start).toLocaleDateString()}
                            <br />
                            {new Date(booking.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div className="text-sm text-slate-600">{booking.summary}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-4 text-xs font-black uppercase tracking-widest text-sky-500">Next 2 Bookings</h4>
                  <div className="space-y-3">
                    {machine.upcoming.length === 0 ? (
                      <p className="text-sm italic text-slate-400">No upcoming bookings</p>
                    ) : (
                      machine.upcoming.map((booking) => (
                        <div key={booking.id} className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm ring-1 ring-sky-200">
                          <div className="flex gap-4">
                            <div className="w-24 shrink-0 text-[10px] font-bold text-sky-600">
                              {new Date(booking.start).toLocaleDateString()}
                              <br />
                              {new Date(booking.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            <div className="text-sm font-semibold text-sky-900">{booking.summary}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
