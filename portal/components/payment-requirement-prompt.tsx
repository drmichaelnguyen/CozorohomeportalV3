"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

type PaymentRequirementNotice = {
  id: string;
  title: string;
  body: string;
  sentAt: string;
};

export function PaymentRequirementPrompt({ email, enabled }: { email: string; enabled: boolean }) {
  const [queue, setQueue] = useState<PaymentRequirementNotice[]>([]);
  const active = queue[0] ?? null;

  useEffect(() => {
    if (!enabled || !email) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/clients/payment-requirement-notices/pending?email=${encodeURIComponent(email.trim().toLowerCase())}`
        );
        const data = (await res.json()) as { notices?: PaymentRequirementNotice[] };
        if (!res.ok || cancelled) return;
        setQueue(Array.isArray(data.notices) ? data.notices : []);
      } catch {
        // non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, enabled]);

  async function dismissCurrent() {
    if (!active) return;
    try {
      await fetch(`${API_BASE_URL}/clients/payment-requirement-notices/${encodeURIComponent(active.id)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
    } catch {
      // ignore
    } finally {
      setQueue((prev) => prev.slice(1));
    }
  }

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[145] flex items-end justify-center bg-black/45 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-5 shadow-2xl sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Payment requirement</p>
        <h3 className="mt-2 text-base font-semibold text-slate-900">{active.title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{active.body}</p>
        <p className="mt-3 text-xs text-slate-500">Sent: {new Date(active.sentAt).toLocaleString()}</p>
        <button
          type="button"
          onClick={() => void dismissCurrent()}
          className="mt-4 w-full rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}

