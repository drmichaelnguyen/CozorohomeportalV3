"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { isShortTermContractCode } from "../lib/resident-guides-types";
import {
  CLEANING_ACTION_LABELS,
  CLEANING_GROUP_LABELS,
  CLEANING_TODAY_BODIES,
  CLEANING_TODAY_TITLES,
  CLEANING_TOMORROW_BODIES,
  CLEANING_TOMORROW_TITLES,
  fillPromoTemplate,
  LAUNDRY_ACTION_LABELS,
  LAUNDRY_GROUP_LABELS,
  LAUNDRY_NOW_BODIES,
  LAUNDRY_NOW_TITLES,
  LAUNDRY_SOON_BODIES,
  LAUNDRY_SOON_TITLES,
  pickRotatingLine,
  REMINDER_HIDE_LABELS,
  REMINDER_POPUP_HEADERS
} from "../lib/rotating-promo-copy";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

type ReminderNotification = {
  id: string;
  type: "LAUNDRY_REMINDER" | "CLEANING_REMINDER";
  title: string;
  body: string;
  createdAt: string;
  unreadCount: number;
  href: string;
};

type ReminderNotificationResponseItem = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  body?: unknown;
  createdAt?: unknown;
  unreadCount?: unknown;
  href?: unknown;
};

const DISMISS_PREFIX = "cozorohome-reminder-dismissed";

function dismissStorageKey(email: string, reminderId: string) {
  return `${DISMISS_PREFIX}:${email.trim().toLowerCase()}:${reminderId}`;
}

function isDismissed(email: string, reminderId: string) {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(dismissStorageKey(email, reminderId)) === "1";
}

function isReminderNotification(email: string, notification: unknown): notification is ReminderNotification {
  if (!notification || typeof notification !== "object") {
    return false;
  }

  const candidate = notification as ReminderNotificationResponseItem;
  return (
    typeof candidate.id === "string" &&
    (candidate.type === "LAUNDRY_REMINDER" || candidate.type === "CLEANING_REMINDER") &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.unreadCount === "number" &&
    typeof candidate.href === "string" &&
    !isDismissed(email, candidate.id)
  );
}

function extractParenDate(text: string): string {
  const match = text.match(/\(([^)]+)\)/);
  return match?.[1]?.trim() || "";
}

function extractTaskFromCleaningBody(body: string): string {
  const match = body.match(/Your\s+(.+?)\s+cleaning\s+is/i);
  return match?.[1]?.trim() || "cleaning";
}

function extractLaundrySummary(body: string): string {
  const atIdx = body.search(/\sstarts\s|\sis\sstarting\s|\sis\salmost\s/i);
  if (atIdx > 0) return body.slice(0, atIdx).trim();
  const firstSentence = body.split(/[.!]/)[0]?.trim();
  return firstSentence || "Laundry";
}

function extractTimeLabel(body: string): string {
  const atMatch = body.match(/\bat\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AP]M)?)/i);
  if (atMatch?.[1]) return atMatch[1].trim();
  const paren = extractParenDate(body);
  if (/\d/.test(paren)) return paren;
  return "";
}

function localizeReminder(
  reminder: ReminderNotification,
  email: string,
  lang: "en" | "vi"
): { title: string; body: string; groupLabel: string; actionLabel: string } {
  const seed = `${email}:${reminder.id}`;
  if (reminder.type === "LAUNDRY_REMINDER") {
    const isNow = reminder.id.includes("laundry-now") || /starts now|starting now/i.test(reminder.title + reminder.body);
    const summary = extractLaundrySummary(reminder.body) || reminder.title;
    const time = extractTimeLabel(reminder.body) || extractParenDate(reminder.body) || "—";
    const title = pickRotatingLine(
      isNow ? "laundry-now-title" : "laundry-soon-title",
      seed,
      isNow ? LAUNDRY_NOW_TITLES : LAUNDRY_SOON_TITLES,
      lang
    );
    const body = fillPromoTemplate(
      pickRotatingLine(
        isNow ? "laundry-now-body" : "laundry-soon-body",
        seed,
        isNow ? LAUNDRY_NOW_BODIES : LAUNDRY_SOON_BODIES,
        lang
      ),
      { summary, time }
    );
    return {
      title,
      body,
      groupLabel: pickRotatingLine("laundry-group", seed, LAUNDRY_GROUP_LABELS, lang),
      actionLabel: pickRotatingLine("laundry-action", seed, LAUNDRY_ACTION_LABELS, lang)
    };
  }

  const isToday =
    reminder.id.includes("day_of") || /is today|cleaning is today/i.test(reminder.title + reminder.body);
  const task = extractTaskFromCleaningBody(reminder.body);
  const date = extractParenDate(reminder.body) || "—";
  const title = pickRotatingLine(
    isToday ? "cleaning-today-title" : "cleaning-tomorrow-title",
    seed,
    isToday ? CLEANING_TODAY_TITLES : CLEANING_TOMORROW_TITLES,
    lang
  );
  const body = fillPromoTemplate(
    pickRotatingLine(
      isToday ? "cleaning-today-body" : "cleaning-tomorrow-body",
      seed,
      isToday ? CLEANING_TODAY_BODIES : CLEANING_TOMORROW_BODIES,
      lang
    ),
    { task, date }
  );
  return {
    title,
    body,
    groupLabel: pickRotatingLine("cleaning-group", seed, CLEANING_GROUP_LABELS, lang),
    actionLabel: pickRotatingLine("cleaning-action", seed, CLEANING_ACTION_LABELS, lang)
  };
}

export function CleaningReminderPopup() {
  const { language } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<ReminderNotification[]>([]);
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
  const isNotificationsPage = pathname === "/notifications";

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
    let active = true;

    async function load() {
      if (!isResidentSession || !normalizedEmail || isNotificationsPage) {
        setReminders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/support/notifications?email=${encodeURIComponent(normalizedEmail)}`);
        const data = (await response.json()) as {
          notifications?: unknown[];
          error?: string;
        };

        if (!response.ok) {
          if (active) {
            setReminders([]);
          }
          return;
        }

        const reminderNotifications = (data.notifications ?? [])
          .filter((notification): notification is ReminderNotification =>
            isReminderNotification(normalizedEmail, notification)
          )
          .filter((notification) => !(isHostelGuest && notification.type === "CLEANING_REMINDER"));

        if (active) {
          setReminders(reminderNotifications);
        }
      } catch {
        if (active) {
          setReminders([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    if (!isResidentSession || !normalizedEmail || isNotificationsPage) {
      return () => {
        active = false;
      };
    }

    const timer = window.setInterval(() => {
      void load();
    }, 10 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isResidentSession, normalizedEmail, isNotificationsPage, isHostelGuest]);

  const visibleReminders = useMemo(() => reminders.slice(0, 3), [reminders]);
  const localized = useMemo(
    () =>
      visibleReminders.map((reminder) => ({
        reminder,
        ...localizeReminder(reminder, normalizedEmail, lang)
      })),
    [visibleReminders, normalizedEmail, lang]
  );

  const chrome = useMemo(() => {
    const seed = normalizedEmail || "guest";
    return {
      header: pickRotatingLine("reminder-header", seed, REMINDER_POPUP_HEADERS, lang),
      hide: pickRotatingLine("reminder-hide", seed, REMINDER_HIDE_LABELS, lang),
      moreLabel: lang === "vi" ? "Thêm nhắc khác" : "More reminders"
    };
  }, [normalizedEmail, lang]);

  function dismissReminder(reminderId: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissStorageKey(normalizedEmail, reminderId), "1");
    }
    setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
  }

  if (!isResidentSession || isNotificationsPage || loading || localized.length === 0) {
    return null;
  }

  const primary = localized[0]!;
  const extraCount = localized.length - 1;

  return (
    <div
      className="fixed inset-0 z-[205] flex items-end justify-center bg-black/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-popup-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-sky-200 bg-white shadow-2xl dark:border-sky-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-sky-100 bg-sky-50 px-4 py-3 sm:px-6 dark:border-sky-900/50 dark:bg-sky-950/40">
          <div>
            <div id="reminder-popup-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {chrome.header}
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {localized.length === 1
                ? primary.title
                : lang === "vi"
                  ? `${primary.groupLabel} và ${extraCount} nhắc nữa.`
                  : `${primary.groupLabel} and ${extraCount} more reminder${extraCount === 1 ? "" : "s"}.`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissReminder(primary.reminder.id)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {chrome.hide}
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-6">
          <p className="text-sm text-slate-700 dark:text-slate-200">{primary.body}</p>

          {localized.length > 1 ? (
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{chrome.moreLabel}</div>
              <div className="mt-2 space-y-2">
                {localized.slice(1).map((item) => (
                  <div
                    key={item.reminder.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.groupLabel}</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</div>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.body}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Link
                        href={
                          item.reminder.href ||
                          (item.reminder.type === "LAUNDRY_REMINDER" ? "/bookings" : "/cleaning-schedule")
                        }
                        className="inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
                      >
                        {item.actionLabel}
                      </Link>
                      <button
                        type="button"
                        onClick={() => dismissReminder(item.reminder.id)}
                        className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                      >
                        {chrome.hide}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={
                primary.reminder.href ||
                (primary.reminder.type === "LAUNDRY_REMINDER" ? "/bookings" : "/cleaning-schedule")
              }
              className="inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              {primary.actionLabel}
            </Link>
            <button
              type="button"
              onClick={() => dismissReminder(primary.reminder.id)}
              className="inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {chrome.hide}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
