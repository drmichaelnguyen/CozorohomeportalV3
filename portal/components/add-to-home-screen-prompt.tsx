"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { detectMobileOs, isStandalonePwa } from "../lib/mobile-platform";
import { AddToHomeStepsContent } from "./resident-instructions-panel";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const DISMISS_KEY = "cozoro_pwa_install_dismissed_v1";
const SNOOZE_KEY = "cozoro_pwa_install_snooze_until_v1";
const SNOOZE_MS = 1000 * 60 * 60 * 24;

export function AddToHomeScreenPrompt() {
  const { t } = usePortalLanguage();
  const { isLoggedIn, sessionRole, isSessionLoaded } = usePortalSession();
  const [visible, setVisible] = useState(false);

  const isStaff =
    sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin" || sessionRole === "mechanic";

  const mobileOs = useMemo(() => detectMobileOs(), []);

  useEffect(() => {
    if (typeof window === "undefined" || !isSessionLoaded || !isLoggedIn || isStaff) {
      setVisible(false);
      return;
    }
    if (isStandalonePwa()) {
      setVisible(false);
      return;
    }
    if (mobileOs !== "ios" && mobileOs !== "android") {
      setVisible(false);
      return;
    }
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") {
        setVisible(false);
        return;
      }
      const snoozeUntil = Number(window.localStorage.getItem(SNOOZE_KEY) ?? "0");
      if (snoozeUntil && Date.now() < snoozeUntil) {
        setVisible(false);
        return;
      }
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, [isLoggedIn, isSessionLoaded, isStaff, mobileOs]);

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pwa-prompt-title">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
        <h2 id="pwa-prompt-title" className="text-lg font-semibold text-slate-900">
          {t("pwaPromptTitle")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{t("pwaPromptSubtitle")}</p>
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("addToHomeSectionTitle")}</p>
          <AddToHomeStepsContent os={mobileOs} />
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISS_KEY, "1");
                window.localStorage.removeItem(SNOOZE_KEY);
              } catch {
                /* ignore */
              }
              setVisible(false);
            }}
          >
            {t("pwaPromptDismiss")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            onClick={() => {
              try {
                window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
              } catch {
                /* ignore */
              }
              setVisible(false);
            }}
          >
            {t("pwaPromptLater")}
          </button>
          <Link
            href="/account-overview"
            className="inline-flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
            onClick={() => {
              try {
                window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
              } catch {
                /* ignore */
              }
              setVisible(false);
            }}
          >
            {t("pwaPromptOpenGuides")}
          </Link>
        </div>
      </div>
    </div>
  );
}
