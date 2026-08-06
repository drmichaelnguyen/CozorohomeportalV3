"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";
import { API_BASE_URL } from "../lib/api-base-url";
import { isContractExpiryAccessLimited, isResidentPortalAccessLimited } from "../lib/account-lock-status";
import { useAccountLockOverride } from "../hooks/use-account-lock-override";
import { isShortTermContractCode } from "../lib/resident-guides-types";

type NavBadges = {
  laundry: number;   // schedule button top-right
  cleaning: number;  // schedule button top-left
  message: number;   // support button top-left
  account: number;   // account button top-right
  managerMessage: number; // manager message button top-left
  managerMaintenance: number; // open maintenance tickets (manager Messages nav, badge right)
};

const BADGE_CACHE_TTL = 30 * 1000; // 30 seconds
const BADGE_POLL_INTERVAL = 30 * 1000; // poll every 30 seconds

type SetNavBadges = (next: NavBadges | ((prev: NavBadges) => NavBadges)) => void;

function useCachedBadges(cacheKey: string): [NavBadges, SetNavBadges] {
  const empty: NavBadges = { laundry: 0, cleaning: 0, message: 0, account: 0, managerMessage: 0, managerMaintenance: 0 };

  function load(): NavBadges {
    if (typeof window === "undefined") return empty;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return empty;
      const { data, timestamp } = JSON.parse(raw) as { data: NavBadges; timestamp: number };
      if (Date.now() - timestamp < BADGE_CACHE_TTL) return data;
    } catch {}
    return empty;
  }

  const [badges, setBadgesState] = useState<NavBadges>(load);

  function setBadges(next: NavBadges | ((prev: NavBadges) => NavBadges)) {
    setBadgesState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data: resolved, timestamp: Date.now() }));
      } catch {}
      return resolved;
    });
  }

  return [badges, setBadges];
}

function useNavBadges(
  sessionEmail: string,
  isLoggedIn: boolean,
  sessionRole: string | null | undefined,
  isManagerWorkspace: boolean
) {
  const cacheKey = `nav_badges_${sessionEmail}`;
  const [badges, setBadges] = useCachedBadges(cacheKey);
  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isAdminSession = Boolean(sessionRole && sessionRole !== "user");

  async function fetchBadges() {
    if (!isLoggedIn || !normalizedEmail) return;

    try {
      if (isAdminSession) {
        // Manager: unread support + open maintenance tickets
        const [supportRes, maintRes] = await Promise.all([
          fetch(`${API_BASE_URL}/manager/support/notifications?operatorEmail=${encodeURIComponent(normalizedEmail)}`),
          fetch(`${API_BASE_URL}/staff/maintenance/tickets`)
        ]);
        let managerMessage = 0;
        if (supportRes.ok) {
          const data = (await supportRes.json()) as {
            unreadCount?: number;
            notifications?: { unreadCount?: number }[];
          };
          managerMessage =
            data.notifications?.reduce((sum, n) => sum + (n.unreadCount ?? 0), 0) ??
            data.unreadCount ??
            0;
        }
        let managerMaintenance = 0;
        if (maintRes.ok) {
          const maintData = (await maintRes.json()) as { tickets?: { status?: string }[] };
          const tickets = maintData.tickets ?? [];
          managerMaintenance = tickets.filter(
            (t) => String(t.status).toUpperCase() === "REPORTED" || String(t.status).toUpperCase() === "ASSIGNED"
          ).length;
        }
        setBadges((prev) => ({ ...prev, managerMessage, managerMaintenance }));
      } else {
        // Resident: split by notification type
        const res = await fetch(
          `${API_BASE_URL}/support/notifications?email=${encodeURIComponent(normalizedEmail)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          notifications?: { type: string; unreadCount?: number }[];
        };
        const notifs = data.notifications ?? [];

        const sum = (types: string[]) =>
          notifs
            .filter((n) => types.includes(n.type))
            .reduce((s, n) => s + (n.unreadCount ?? 0), 0);

        setBadges((prev) => ({
          ...prev,
          laundry: sum(["LAUNDRY_REMINDER"]),
          cleaning: sum(["CLEANING_REMINDER", "CLEANING_AUDIT_RESULT", "FRIDGE_DRAIN_REMINDER"]),
          message: sum(["SUPPORT_REPLY"]),
          account: sum(["PAYMENT_DUE", "NEW_FINE", "PREPAID_PACKAGE"]),
          managerMessage: 0,
          managerMaintenance: 0,
        }));
      }
    } catch {}
  }

  useEffect(() => {
    if (isLoggedIn && normalizedEmail) {
      void fetchBadges();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, normalizedEmail, isAdminSession]);

  useEffect(() => {
    if (!isLoggedIn || !normalizedEmail) return;

    function onFocus() {
      void fetchBadges();
    }

    function onNewGroupMessage() {
      void fetchBadges();
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("new-group-message", onNewGroupMessage);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchBadges();
      }
    }, BADGE_POLL_INTERVAL);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("new-group-message", onNewGroupMessage);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, normalizedEmail, isAdminSession]);

  return badges;
}

function BadgeDot({
  count,
  side,
  color = "red",
}: {
  count: number;
  side: "left" | "right";
  color?: "red" | "sky" | "amber";
}) {
  if (count <= 0) return null;
  const colorClass =
    color === "sky"
      ? "bg-sky-500"
      : color === "amber"
        ? "bg-amber-500"
        : "bg-red-500";
  const pos = side === "right" ? "-right-1.5 -top-1.5" : "-left-1.5 -top-1.5";
  return (
    <span
      className={`pointer-events-none absolute ${pos} flex h-4 min-w-4 items-center justify-center rounded-full ${colorClass} px-0.5 text-[9px] font-bold leading-none text-white ring-[1.5px] ring-white`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = usePortalLanguage();
  const { sessionRole, sessionEmail, isLoggedIn } = usePortalSession();
  const [client, setClient] = useState<Record<string, string> | null>(null);
  const { override: accountLockOverride } = useAccountLockOverride(
    isLoggedIn && sessionRole === "user" ? sessionEmail : null
  );

  useEffect(() => {
    if (isLoggedIn && sessionEmail && sessionRole === "user") {
      fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(sessionEmail)}`)
        .then((res) => res.json())
        .then((data) => setClient(data as Record<string, string>))
        .catch(console.error);
    } else {
      setClient(null);
    }
  }, [isLoggedIn, sessionEmail, sessionRole]);

  const isExpired = useMemo(() => {
    if (sessionRole !== "user") {
      return false;
    }
    return isContractExpiryAccessLimited(client?.["Ngày hết hạn hợp đồng"], accountLockOverride);
  }, [accountLockOverride, client, sessionRole]);

  const isPortalAccessLimited = useMemo(() => {
    if (sessionRole !== "user") {
      return false;
    }
    return isResidentPortalAccessLimited(client, accountLockOverride);
  }, [accountLockOverride, client, sessionRole]);

  const isRemoved = useMemo(() => {
    if (sessionRole !== "user") return false;
    return client?.["Hiện còn ở"] === "-1";
  }, [client, sessionRole]);

  const isHostelGuest = useMemo(() => {
    if (sessionRole !== "user") return false;
    return isShortTermContractCode(client?.["MÃ HD"]);
  }, [client, sessionRole]);

  const isManagerWorkspace =
    (sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin") &&
    (pathname.startsWith("/manager") || pathname.startsWith("/admin-cleaning"));
  const isMechanicWorkspace = sessionRole === "mechanic" && pathname.startsWith("/mechanic");

  const badges = useNavBadges(sessionEmail, isLoggedIn, sessionRole, isManagerWorkspace);

  const residentItems = [
    {
      href: "/bookings",
      label: t("booking", "Booking"),
      disabled: isPortalAccessLimited,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    },
    {
      href: "/schedule",
      label: t("schedule", "Schedule"),
      badgeRight: badges.laundry,
      badgeLeft: isHostelGuest ? 0 : badges.cleaning,
      disabled: isRemoved,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      )
    },
    {
      href: "/controller",
      label: t("controller", "Control"),
      disabled: isPortalAccessLimited || isRemoved,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M12 6v6" />
          <path d="M9 9h6" />
        </svg>
      )
    },
    {
      href: "/support",
      label: t("message", "Message"),
      badgeLeft: badges.message,
      disabled: isRemoved,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: isRemoved ? "#" : (isExpired ? "/" : "/account-overview"),
      label: isExpired ? t("home", "Home") : t("account", "Account"),
      badgeRight: badges.account,
      disabled: isRemoved,
      icon: isExpired ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    }
  ];

  const managerItems = [
    {
      href: "/manager?view=client_list",
      label: t("clients", "Clients"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    {
      href: "/manager?view=scheduling",
      label: t("schedule", "Schedule"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    },
    {
      href: "/manager?view=controller",
      label: t("controller", "Control"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path x="4.93" y="19.07" width="2.83" height="2.83" />
          <path d="M16.24 7.76l2.83-2.83" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
    },
    {
      href: "/manager?view=support_chat",
      label: t("message", "Message"),
      badgeLeft: badges.managerMessage,
      badgeRight: badges.managerMaintenance,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: "/manager?view=settings",
      label: t("settings", "Settings"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    }
  ];

  const mechanicItems = [
    {
      href: "/mechanic",
      label: t("tickets", "Tickets"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    },
    {
      href: "/support",
      label: t("message", "Message"),
      badgeLeft: badges.message,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: "/account-overview",
      label: t("account", "Account"),
      badgeRight: badges.account,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    }
  ];

  const navItems = isMechanicWorkspace ? mechanicItems : isManagerWorkspace ? managerItems : residentItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center justify-center border-t border-slate-200/95 bg-white/95 px-4 py-3 shadow-[0_-6px_24px_rgba(15,23,42,0.07)] backdrop-blur-md dark:border-white/10 dark:bg-slate-900/85 dark:shadow-[0_-8px_28px_rgba(0,0,0,0.35)] sm:bottom-6 sm:border-none sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none dark:sm:shadow-none">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between sm:rounded-3xl sm:border sm:border-slate-200 sm:bg-white sm:p-2 sm:shadow-[0_8px_30px_rgba(15,23,42,0.1)] sm:backdrop-blur-xl dark:sm:border-white/10 dark:sm:bg-slate-900/85 dark:sm:shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        {navItems.map((item) => {
          let isActive = false;

          if (item.href.includes("?")) {
            const [path, query] = item.href.split("?");
            const itemParams = new URLSearchParams(query);
            const viewParam = itemParams.get("view");
            isActive = pathname === path && searchParams.get("view") === viewParam;
          } else {
            isActive = pathname === item.href;
          }

          const badgeRight = Number(("badgeRight" in item ? (item as { badgeRight?: number }).badgeRight : undefined) ?? 0);
          const badgeLeft = Number(("badgeLeft" in item ? (item as { badgeLeft?: number }).badgeLeft : undefined) ?? 0);
          const isDisabled = "disabled" in item && (item as any).disabled;

          return (
            <Link
              key={item.href}
              href={isDisabled ? "#" : (item.href as any)}
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                if (isDisabled) e.preventDefault();
              }}
              className={`group flex flex-col items-center gap-1 transition-all duration-300 ${
                isDisabled ? "opacity-30 cursor-not-allowed" :
                isActive
                  ? "scale-105 text-sky-600 dark:text-sky-400"
                  : "text-slate-600 dark:text-slate-100 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <div
                className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-500 ${
                  isActive
                    ? "bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_5px_12px_-3px_rgba(14,165,233,0.4)] ring-2 ring-sky-50 dark:ring-sky-500/30"
                    : "bg-transparent group-hover:bg-slate-100 dark:group-hover:bg-white/10"
                }`}
              >
                <div className="scale-75">{item.icon}</div>
                {!isDisabled && <BadgeDot count={badgeRight} side="right" color="red" />}
                {!isDisabled && <BadgeDot count={badgeLeft} side="left" color="sky" />}
              </div>
              <span
                className={`text-[9px] font-bold uppercase tracking-wider transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-50"}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      {/* Bottom safe area for iOS */}
      <div className="h-safe-bottom mt-2 sm:hidden" />
    </nav>
  );
}
