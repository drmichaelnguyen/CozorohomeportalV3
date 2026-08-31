"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { isShortTermContractCode } from "../lib/resident-guides-types";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const PROMO_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 3000;

type BirthdayBenefits = {
  isBirthMonth: boolean;
  isBirthdayToday: boolean;
  birthdayCoinGrant: number;
  extensionCoinMultiplier: number;
  extensionMinMonths: number;
};

function storageKey(email: string, year: number, month: number) {
  return `cozorohome-birth-month-promo:${email.trim().toLowerCase()}:${year}-${month}`;
}

function shouldShowPromo(email: string, year: number, month: number): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(storageKey(email, year, month));
  if (!raw) return true;
  const last = Number.parseInt(raw, 10);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= PROMO_INTERVAL_MS;
}

function markPromoDismissed(email: string, year: number, month: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(email, year, month), String(Date.now()));
}

export function BirthMonthPromoPopup() {
  const { t, language } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isHostelGuest, setIsHostelGuest] = useState(false);
  const [benefits, setBenefits] = useState<BirthdayBenefits | null>(null);

  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isResidentSession =
    isSessionLoaded &&
    isLoggedIn &&
    normalizedEmail.length > 0 &&
    sessionRole !== "manager" &&
    sessionRole !== "owner" &&
    sessionRole !== "app_admin" &&
    sessionRole !== "mechanic";

  const onAccountPage = pathname === "/account" || pathname === "/";

  useEffect(() => {
    if (!isResidentSession || !normalizedEmail) {
      setIsHostelGuest(false);
      setBenefits(null);
      return;
    }
    let active = true;
    Promise.all([
      fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(normalizedEmail)}`).then((res) =>
        res.ok ? res.json() : null
      ),
      fetch(`${API_BASE_URL}/clients/birthday-benefits?email=${encodeURIComponent(normalizedEmail)}`).then((res) =>
        res.ok ? res.json() : null
      )
    ])
      .then(([client, birthdayData]) => {
        if (!active) return;
        setIsHostelGuest(isShortTermContractCode(client?.["MÃ HD"]));
        setBenefits(birthdayData as BirthdayBenefits | null);
      })
      .catch(() => {
        if (active) {
          setIsHostelGuest(false);
          setBenefits(null);
        }
      });
    return () => {
      active = false;
    };
  }, [isResidentSession, normalizedEmail]);

  useEffect(() => {
    if (!benefits?.isBirthMonth || !isResidentSession || !normalizedEmail || isHostelGuest) {
      setOpen(false);
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (!shouldShowPromo(normalizedEmail, year, month)) {
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (shouldShowPromo(normalizedEmail, year, month)) {
        setOpen(true);
      }
    }, SHOW_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [benefits, isResidentSession, normalizedEmail, isHostelGuest]);

  function dismiss() {
    const now = new Date();
    markPromoDismissed(normalizedEmail, now.getFullYear(), now.getMonth() + 1);
    setOpen(false);
  }

  if (!open || !benefits?.isBirthMonth) {
    return null;
  }

  const amount = benefits.birthdayCoinGrant.toLocaleString(language === "vi" ? "vi-VN" : "en-US");

  return (
    <div
      className="fixed inset-0 z-[131] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="birth-month-promo-title"
    >
      <div className="w-full max-w-md rounded-3xl border border-pink-200 bg-white shadow-2xl dark:border-pink-800 dark:bg-slate-900">
        <div className="border-b border-pink-100 bg-pink-50 px-4 py-3 sm:px-5 dark:border-pink-900/60 dark:bg-pink-950/50">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pink-700 dark:text-pink-300">
            {t("birthMonthPromoEyebrow", "Birth month")}
          </p>
          <h3 id="birth-month-promo-title" className="mt-1 text-base font-semibold text-pink-950 dark:text-pink-50">
            {benefits.isBirthdayToday
              ? t("birthMonthPromoTitleToday", "Happy birthday!")
              : t("birthMonthPromoTitle", "Your birth-month perks")}
          </h3>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {benefits.isBirthdayToday
              ? t("birthMonthPromoBodyToday", {
                  birthdayCoins: amount,
                  minMonths: String(benefits.extensionMinMonths),
                  multiplier: String(benefits.extensionCoinMultiplier)
                })
              : t("birthMonthPromoBody", {
                  birthdayCoins: amount,
                  minMonths: String(benefits.extensionMinMonths),
                  multiplier: String(benefits.extensionCoinMultiplier)
                })}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={onAccountPage ? "#contract-extension-panel" : "/account#contract-extension-panel"}
              onClick={dismiss}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-pink-700 sm:flex-none"
            >
              {t("birthMonthPromoCta", "Extend contract")}
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t("birthMonthPromoDismiss", "Not now")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
