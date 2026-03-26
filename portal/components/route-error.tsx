"use client";

import { useEffect, useState } from "react";

// Tier 1 — Critical services (device control, laundry booking)
// Auto-retries after countdown; shows a "critical service" badge
export function CriticalRouteError({
  error,
  reset,
  serviceName
}: {
  error: Error & { digest?: string };
  reset: () => void;
  serviceName?: string;
}) {
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    if (countdown <= 0) {
      reset();
      return;
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, reset]);

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
          <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-red-900">
              {serviceName ? `${serviceName} is temporarily unavailable` : "Service temporarily unavailable"}
            </p>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
              Critical
            </span>
          </div>
          <p className="mt-1 text-xs text-red-700 break-words">
            {error.message || "An unexpected error occurred. Please retry or check your connection."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { setCountdown(8); reset(); }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all"
            >
              Retry now
            </button>
            <p className="text-xs text-red-600">
              Auto-retrying in <span className="font-bold">{countdown}s</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Tier 2 — Standard services (billing, coins, schedule, etc.)
// Simple fallback with manual retry only
export function StandardRouteError({
  error,
  reset,
  serviceName
}: {
  error: Error & { digest?: string };
  reset: () => void;
  serviceName?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">
            {serviceName ? `${serviceName} could not load` : "Something went wrong"}
          </p>
          <p className="mt-1 text-xs text-slate-500 break-words">
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
