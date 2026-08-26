"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type BranchPromptNotice = {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  branch: "D2" | "D7";
};

export function BranchBroadcastPrompt({
  email,
  enabled
}: {
  email: string;
  enabled: boolean;
}) {
  const { t } = usePortalLanguage();
  const [queue, setQueue] = useState<BranchPromptNotice[]>([]);
  const active = queue[0] ?? null;
  const isHeroNotice =
    Boolean(active?.title?.includes("Cozoro Hero")) || Boolean(active?.title?.includes("Anh hùng Cozoro"));

  useEffect(() => {
    if (!enabled || !email) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/clients/branch-broadcasts/pending?email=${encodeURIComponent(email.trim().toLowerCase())}`
        );
        const data = (await res.json()) as { notices?: BranchPromptNotice[] };
        if (!res.ok || cancelled) return;
        setQueue(Array.isArray(data.notices) ? data.notices : []);
      } catch {
        // ignore; prompt is non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, enabled]);

  async function dismissCurrent() {
    if (!active) return;
    try {
      await fetch(`${API_BASE_URL}/clients/branch-broadcasts/${encodeURIComponent(active.id)}/read`, {
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
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/45 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-5 shadow-2xl sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
          Branch notice · {active.branch}
        </p>
        <h3 className="mt-2 text-base font-semibold text-slate-900">{active.title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{active.body}</p>
        <p className="mt-3 text-xs text-slate-500">
          Sent: {new Date(active.sentAt).toLocaleString()}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {isHeroNotice ? (
            <Link
              href="/schedule"
              onClick={() => void dismissCurrent()}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {t("selfAssignPromoCta", "Open schedule")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void dismissCurrent()}
            className={`inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold ${
              isHeroNotice
                ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
                : "w-full bg-amber-600 text-white hover:bg-amber-700"
            }`}
          >
            {t("notificationAcComfortDismiss", "Got it")}
          </button>
        </div>
      </div>
    </div>
  );
}

