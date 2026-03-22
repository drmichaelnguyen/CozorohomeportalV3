"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

export function NotificationBell() {
  const { sessionEmail, sessionRole, isLoggedIn } = usePortalSession();
  const [unreadCount, setUnreadCount] = useState(0);
  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isAdminSession = Boolean(sessionRole && sessionRole !== "user");

  useEffect(() => {
    let cancelled = false;

    async function loadUnreadCount() {
      if (!isLoggedIn || !normalizedEmail) {
        setUnreadCount(0);
        return;
      }

      try {
        const url = isAdminSession
          ? `${API_BASE_URL}/manager/support/notifications?operatorEmail=${encodeURIComponent(normalizedEmail)}`
          : `${API_BASE_URL}/support/notifications?email=${encodeURIComponent(normalizedEmail)}`;
        const response = await fetch(url);
        const data = (await response.json()) as { unreadCount?: number };

        if (!cancelled) {
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        if (!cancelled) {
          setUnreadCount(0);
        }
      }
    }

    void loadUnreadCount();

    function handleVisibilityOrFocus() {
      if (document.visibilityState === "visible") {
        void loadUnreadCount();
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [isAdminSession, isLoggedIn, normalizedEmail]);

  if (!isLoggedIn) {
    return null;
  }

  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:border-slate-300"
    >
      Notifications
      {unreadCount > 0 ? (
        <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-slate-950">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
