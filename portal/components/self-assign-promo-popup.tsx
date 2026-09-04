"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { isShortTermContractCode } from "../lib/resident-guides-types";
import {
  pickRotatingLine,
  SELF_ASSIGN_PROMO_BODIES,
  SELF_ASSIGN_PROMO_CTAS,
  SELF_ASSIGN_PROMO_DISMISSES,
  SELF_ASSIGN_PROMO_EYEBROWS,
  SELF_ASSIGN_PROMO_HINTS,
  SELF_ASSIGN_PROMO_TITLES
} from "../lib/rotating-promo-copy";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

/** ~4 days → about 1–2 shows per week when the resident opens the app. */
const PROMO_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2500;

function storageKey(email: string) {
  return `cozorohome-self-assign-promo:${email.trim().toLowerCase()}`;
}

function shouldShowPromo(email: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const raw = window.localStorage.getItem(storageKey(email));
  if (!raw) {
    return true;
  }
  const last = Number.parseInt(raw, 10);
  if (!Number.isFinite(last)) {
    return true;
  }
  return Date.now() - last >= PROMO_INTERVAL_MS;
}

function markPromoDismissed(email: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey(email), String(Date.now()));
}

export function SelfAssignPromoPopup() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isHostelGuest, setIsHostelGuest] = useState(false);

  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const lang = language === "vi" ? "vi" : "en";
  const isResidentSession =
    isSessionLoaded &&
    isLoggedIn &&
    normalizedEmail.length > 0 &&
    sessionRole !== "manager" &&
    sessionRole !== "owner" &&
    sessionRole !== "app_admin" &&
    sessionRole !== "mechanic";

  const onSchedulePage = pathname === "/schedule" || pathname === "/cleaning-schedule";

  const copy = useMemo(() => {
    const seed = normalizedEmail || "guest";
    return {
      eyebrow: pickRotatingLine("self-assign-eyebrow", seed, SELF_ASSIGN_PROMO_EYEBROWS, lang),
      title: pickRotatingLine("self-assign-title", seed, SELF_ASSIGN_PROMO_TITLES, lang),
      body: pickRotatingLine("self-assign-body", seed, SELF_ASSIGN_PROMO_BODIES, lang),
      hint: pickRotatingLine("self-assign-hint", seed, SELF_ASSIGN_PROMO_HINTS, lang),
      cta: pickRotatingLine("self-assign-cta", seed, SELF_ASSIGN_PROMO_CTAS, lang),
      dismiss: pickRotatingLine("self-assign-dismiss", seed, SELF_ASSIGN_PROMO_DISMISSES, lang)
    };
  }, [normalizedEmail, lang]);

  useEffect(() => {
    if (!isResidentSession || !normalizedEmail) {
      setIsHostelGuest(false);
      return;
    }
    let active = true;
    fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(normalizedEmail)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<string, string> | null) => {
        if (!active) return;
        setIsHostelGuest(isShortTermContractCode(data?.["MÃ HD"]));
      })
      .catch(() => {
        if (active) setIsHostelGuest(false);
      });
    return () => {
      active = false;
    };
  }, [isResidentSession, normalizedEmail]);

  useEffect(() => {
    if (!isResidentSession || !normalizedEmail || onSchedulePage || isHostelGuest) {
      setOpen(false);
      return;
    }
    if (!shouldShowPromo(normalizedEmail)) {
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (shouldShowPromo(normalizedEmail)) {
        setOpen(true);
      }
    }, SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isResidentSession, normalizedEmail, onSchedulePage, isHostelGuest]);

  function dismiss() {
    markPromoDismissed(normalizedEmail);
    setOpen(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-assign-promo-title"
    >
      <div className="w-full max-w-md rounded-3xl border border-emerald-200 bg-white shadow-2xl dark:border-emerald-800 dark:bg-slate-900">
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 sm:px-5 dark:border-emerald-900/60 dark:bg-emerald-950/50">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            {copy.eyebrow}
          </p>
          <h3
            id="self-assign-promo-title"
            className="mt-1 text-base font-semibold text-emerald-950 dark:text-emerald-50"
          >
            {copy.title}
          </h3>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{copy.body}</p>
          <ul className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
            <li className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              {t("selfAssignBonusWeekday", "x2")}
              <div className="mt-0.5 font-normal text-emerald-700/80 dark:text-emerald-300/80">
                {t("selfAssignPromoWeekdayLabel", "Weekday")}
              </div>
            </li>
            <li className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              x2.5
              <div className="mt-0.5 font-normal text-emerald-700/80 dark:text-emerald-300/80">
                {t("selfAssignPromoWeekendLabel", "Weekend")}
              </div>
            </li>
            <li className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              x3
              <div className="mt-0.5 font-normal text-emerald-700/80 dark:text-emerald-300/80">
                {t("selfAssignPromoHolidayLabel", "Holiday")}
              </div>
            </li>
          </ul>
          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.hint}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href="/schedule"
              onClick={dismiss}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 sm:flex-none"
            >
              {copy.cta}
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {copy.dismiss}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
