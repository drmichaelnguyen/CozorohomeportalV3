"use client";

import { useEffect, useState, useMemo } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

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
  previous: Booking[];
  upcoming: Booking[];
};

export function LaundryScheduleManager() {
  const [schedules, setSchedules] = useState<MachineSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterBranch, setFilterBranch] = useState("All");

  useEffect(() => {
    async function fetchSchedules() {
      try {
        const response = await fetch(`${API_BASE_URL}/manager/laundry/schedule`);
        if (!response.ok) throw new Error("Failed to fetch laundry schedules");
        const data = await response.json();
        setSchedules(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load laundry schedules");
      } finally {
        setLoading(false);
      }
    }
    fetchSchedules();
  }, []);

  const branches = useMemo(() => {
    const b = new Set<string>(["All"]);
    schedules.forEach(s => {
      const match = s.summary.match(/^([^-]+)-/);
      if (match) b.add(match[1].trim());
      else if (s.summary.includes("D2")) b.add("D2");
      else if (s.summary.includes("D7")) b.add("D7");
    });
    return Array.from(b).sort();
  }, [schedules]);

  const filteredSchedules = useMemo(() => {
    if (filterBranch === "All") return schedules;
    return schedules.filter(s => s.summary.includes(filterBranch));
  }, [schedules, filterBranch]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading schedules...</div>;
  if (error) return <div className="p-8 text-center text-rose-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Laundry Machine Timelines</h2>
          <p className="text-sm text-slate-500 mt-1">Showing the last 5 and next 2 bookings for each machine.</p>
        </div>
        <div className="flex gap-2">
          {branches.map(b => (
            <button
              key={b}
              onClick={() => setFilterBranch(b)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                filterBranch === b ? "bg-slate-900 text-white shadow-md" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6">
        {filteredSchedules.map(machine => (
          <div key={machine.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-500"></span>
                {machine.summary}
              </h3>
              <span className="text-xs font-mono text-slate-400">{machine.id}</span>
            </div>
            
            <div className="p-6">
              <div className="grid lg:grid-cols-2 gap-8 relative">
                {/* Past Bookings */}
                <div>
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Past 5 Bookings</h4>
                  <div className="space-y-3">
                    {machine.previous.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No recent history</p>
                    ) : (
                      machine.previous.map(b => (
                        <div key={b.id} className="flex gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50/30 opacity-70">
                          <div className="text-[10px] font-bold text-slate-400 w-24 shrink-0">
                            {new Date(b.start).toLocaleDateString()}<br/>
                            {new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-sm text-slate-600 truncate">{b.summary}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Upcoming Bookings */}
                <div className="lg:border-l lg:pl-8 border-slate-100">
                  <h4 className="text-xs font-black text-sky-500 uppercase tracking-widest mb-4">Next 2 Bookings</h4>
                  <div className="space-y-3">
                    {machine.upcoming.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No upcoming bookings</p>
                    ) : (
                      machine.upcoming.map(b => (
                        <div key={b.id} className="flex gap-4 p-4 rounded-2xl border border-sky-100 bg-sky-50 shadow-sm ring-1 ring-sky-200">
                          <div className="text-[10px] font-bold text-sky-600 w-24 shrink-0">
                            {new Date(b.start).toLocaleDateString()}<br/>
                            {new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-sm font-semibold text-sky-900 truncate">{b.summary}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Vertical Divider for Large Screens */}
                <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-slate-100 -translate-x-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
