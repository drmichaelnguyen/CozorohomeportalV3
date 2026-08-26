"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const NOTICE_VERSION = "v2";

function storageKey(email: string) {
  return `cozorohome-cooker-policy-${NOTICE_VERSION}:${email.trim().toLowerCase()}`;
}

export function CookerPolicyPrompt() {
  const { t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const [open, setOpen] = useState(false);

  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isResidentSession =
    isSessionLoaded &&
    isLoggedIn &&
    normalizedEmail.length > 0 &&
    sessionRole !== "manager" &&
    sessionRole !== "owner" &&
    sessionRole !== "app_admin" &&
    sessionRole !== "mechanic";

  useEffect(() => {
    if (!isResidentSession) {
      setOpen(false);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    setOpen(window.localStorage.getItem(storageKey(normalizedEmail)) !== "1");
  }, [isResidentSession, normalizedEmail]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(normalizedEmail), "1");
    }
    setOpen(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[135] flex items-end justify-center bg-black/45 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cooker-policy-title"
    >
      <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-5 shadow-2xl sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
          {t("cookerPolicyNoticeKicker")}
        </p>
        <h3 id="cooker-policy-title" className="mt-2 text-base font-semibold text-slate-900">
          {t("cookerPolicyNoticeTitle")}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{t("cookerPolicyNoticeIntro")}</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
          <li>{t("cookerPolicyRule1")}</li>
          <li>{t("cookerPolicyRule2")}</li>
          <li>{t("cookerPolicyRule3")}</li>
        </ol>
        <p className="mt-3 text-sm font-medium leading-relaxed text-rose-800">{t("cookerPolicyNoticeFine")}</p>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            href={"/service/cooker" as Route}
            onClick={dismiss}
            className="inline-flex w-full items-center justify-center rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
          >
            {t("cookerPolicyOpenCooker")}
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t("gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
