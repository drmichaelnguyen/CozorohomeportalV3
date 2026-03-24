"use client";

import { useState, useEffect } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

type LaundryBooking = {
  id: string;
  start: string;
  end: string;
  location: string;
  calendarSummary: string;
};

type LaundryControllerProps = {
  email: string;
  bookings: LaundryBooking[];
};

export function LaundryController({ email, bookings }: LaundryControllerProps) {
  const [activeMachine, setActiveMachine] = useState<string | null>(null);
  const [nextBooking, setNextBooking] = useState<LaundryBooking | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkBookings = () => {
      const now = new Date();
      // Grace period: 5 minutes early, 10 minutes late relative to the booking slot
      const currentBooking = bookings.find(b => {
        const start = new Date(b.start);
        const end = new Date(b.end);
        const graceStart = new Date(start.getTime() - 10 * 60000);
        const graceEnd = new Date(start.getTime() + 20 * 60000);
        return now >= graceStart && now <= graceEnd;
      });

      // Find the very next booking in the future
      const futureBookings = bookings
        .filter(b => new Date(b.start) > now)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      
      setNextBooking(futureBookings[0] || null);

      if (currentBooking) {
        const loc = (currentBooking.location || currentBooking.calendarSummary || "").toLowerCase();
        if (loc.includes("d2")) setActiveMachine("D2 Laundry");
        else if (loc.includes("d7") && loc.includes("paid")) setActiveMachine("D7 Laundry Paid (Whirlpool)");
        else if (loc.includes("d7") && loc.includes("dryer")) setActiveMachine("D7 Dryer");
        else if (loc.includes("d7")) setActiveMachine("D7 Laundry");
        else setActiveMachine(null);
      } else {
        setActiveMachine(null);
      }
    };

    checkBookings();
    const timer = setInterval(checkBookings, 30000);
    return () => clearInterval(timer);
  }, [bookings]);

  const handleTrigger = async () => {
    if (!activeMachine) return;
    setLoading(true);
    setStatus("Triggering machine...");

    try {
      const response = await fetch(`${API_BASE_URL}/laundry/manual-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email, 
          machineId: activeMachine.toLowerCase().replace(/\s+/g, "_")
        })
      });

      if (response.ok) {
        setStatus(`Successfully started ${activeMachine}`);
      } else {
        const data = await response.json();
        setStatus(`Failed: ${data.error || "Machine didn't respond"}`);
      }
    } catch (err) {
      setStatus("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const iconColor = activeMachine ? "bg-sky-500 animate-pulse" : "bg-slate-300";
  const containerClass = `rounded-3xl border p-6 shadow-lg relative overflow-hidden group transition-all duration-500 ${
    activeMachine 
      ? "border-sky-200 bg-gradient-to-br from-sky-50 to-white shadow-sky-100/50 ring-1 ring-sky-100 mt-6" 
      : "border-slate-200 bg-slate-50/50 opacity-60 grayscale-[0.5] mt-6"
  }`;

  return (
    <div className={containerClass}>
      <div className={`absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 blur-3xl transition-all ${activeMachine ? "bg-sky-200/20 group-hover:bg-sky-200/40" : "bg-slate-200/20"}`}></div>
      
      <div className="relative">
        <h3 className={`text-lg font-bold border-b pb-3 mb-4 flex items-center gap-2 ${activeMachine ? "text-sky-900 border-sky-100" : "text-slate-500 border-slate-200"}`}>
          <span className={`flex h-2 w-2 rounded-full ${iconColor}`}></span>
          Manual Laundry Control
        </h3>
        
        {activeMachine ? (
          <p className="text-sm text-sky-700/80 mb-6 leading-relaxed">
            It looks like you have a booking for <span className="font-bold text-sky-900">{activeMachine}</span> right now. 
            If the machine failed to start automatically, you can manually trigger it below.
          </p>
        ) : (
          <div className="mb-6">
            <p className="text-sm text-slate-500 leading-relaxed italic">
              Manual control is only available during your scheduled booking time frame.
            </p>
            {nextBooking && (
              <div className="mt-2 flex items-center gap-2 text-xs font-bold text-sky-600 bg-sky-50 w-fit px-3 py-1 rounded-full border border-sky-100">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Next laundry: {formatDateTime(nextBooking.start)} ({nextBooking.location || nextBooking.calendarSummary})
              </div>
            )}
          </div>
        )}
        
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <button
            onClick={handleTrigger}
            disabled={loading || !activeMachine}
            className={`w-full sm:w-auto min-w-[200px] rounded-2xl px-8 py-4 text-sm font-black tracking-widest text-white shadow-xl transition-all ${
              activeMachine 
                ? "bg-sky-600 shadow-sky-200 hover:bg-sky-700 hover:-translate-y-1 active:translate-y-0 active:scale-95" 
                : "bg-slate-400 cursor-not-allowed shadow-none"
            } disabled:opacity-50 disabled:translate-y-0`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                STARTING...
              </span>
            ) : activeMachine ? `START ${activeMachine.toUpperCase()}` : "NO ACTIVE BOOKING"}
          </button>
          
          {status && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${status.includes("Failed") || status.includes("Error") ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}>
              {status.includes("Successfully") && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {status}
            </div>
          )}
        </div>
        
        <div className={`mt-4 text-[10px] font-medium uppercase tracking-tight ${activeMachine ? "text-sky-400" : "text-slate-400"}`}>
          {activeMachine ? "System operational • Waiting for user trigger" : "Control Locked • Requires scheduled booking"}
        </div>
      </div>
    </div>
  );
}

