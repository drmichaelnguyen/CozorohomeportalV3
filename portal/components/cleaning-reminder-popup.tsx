"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
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

function getReminderGroupLabel(type: ReminderNotification["type"]) {
  return type === "LAUNDRY_REMINDER" ? "Laundry reminder" : "Cleaning reminder";
}

function getReminderActionLabel(type: ReminderNotification["type"]) {
  return type === "LAUNDRY_REMINDER" ? "Open bookings" : "Open cleaning schedule";
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

export function CleaningReminderPopup() {
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<ReminderNotification[]>([]);
  const normalizedEmail = sessionEmail.trim().toLowerCase();
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

        const reminderNotifications = (data.notifications ?? []).filter((notification): notification is ReminderNotification =>
          isReminderNotification(normalizedEmail, notification)
        );

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
  }, [isResidentSession, normalizedEmail, isNotificationsPage]);

  const visibleReminders = useMemo(() => reminders.slice(0, 3), [reminders]);

  function dismissReminder(reminderId: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissStorageKey(normalizedEmail, reminderId), "1");
    }
    setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
  }

  if (!isResidentSession || isNotificationsPage || loading || visibleReminders.length === 0) {
    return null;
  }

  const primary = visibleReminders[0];
  const primaryLabel = getReminderGroupLabel(primary.type);

  return (
    <div
      className="fixed inset-0 z-[205] flex items-end justify-center bg-black/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-popup-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-sky-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-sky-100 bg-sky-50 px-4 py-3 sm:px-6">
          <div>
            <div id="reminder-popup-title" className="text-lg font-semibold text-slate-900">
              Upcoming reminders
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {visibleReminders.length === 1
                ? primary.title
                : `${primaryLabel} and ${visibleReminders.length - 1} more reminder${
                    visibleReminders.length - 1 === 1 ? "" : "s"
                  }.`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissReminder(primary.id)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Hide
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-6">
          <p className="text-sm text-slate-700">{primary.body}</p>

          {visibleReminders.length > 1 ? (
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">More reminders</div>
              <div className="mt-2 space-y-2">
                {visibleReminders.slice(1).map((reminder) => (
                  <div key={reminder.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {getReminderGroupLabel(reminder.type)}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{reminder.title}</div>
                    <div className="mt-1 text-sm text-slate-600">{reminder.body}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Link
                        href={reminder.href || (reminder.type === "LAUNDRY_REMINDER" ? "/bookings" : "/cleaning-schedule")}
                        className="inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        {getReminderActionLabel(reminder.type)}
                      </Link>
                      <button
                        type="button"
                        onClick={() => dismissReminder(reminder.id)}
                        className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={primary.href || (primary.type === "LAUNDRY_REMINDER" ? "/bookings" : "/cleaning-schedule")}
              className="inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              {getReminderActionLabel(primary.type)}
            </Link>
            <button
              type="button"
              onClick={() => dismissReminder(primary.id)}
              className="inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Hide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
