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

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadUnreadCount();
      }
    }, 30000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      clearInterval(interval);
    };
  }, [isAdminSession, isLoggedIn, normalizedEmail]);

  if (!isLoggedIn) {
    return null;
  }

  return (
    <Link
      href="/notifications"
      className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-all hover:border-sky-300 hover:bg-sky-50"
      title="Notifications"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600 transition-colors group-hover:text-sky-600">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
