"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

export function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = usePortalLanguage();
  const { sessionRole } = usePortalSession();

  const isManagerWorkspace = (sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin") && 
    (pathname.startsWith("/manager") || pathname.startsWith("/admin-cleaning"));
  const isMechanicWorkspace = sessionRole === "mechanic" && pathname.startsWith("/mechanic");
  const isStaffWorkspace = isManagerWorkspace || isMechanicWorkspace;

  const residentItems = [
    {
      href: "/bookings",
      label: t("booking", "Booking"),
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
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: "/account-overview",
      label: t("account", "Account"),
      icon: (
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
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: "/manager?view=owners_employees",
      label: t("employees", "Employees"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <polyline points="17 11 19 13 23 9" />
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
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      href: "/account-overview",
      label: t("account", "Account"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    }
  ];

  const navItems = isMechanicWorkspace ? mechanicItems : isManagerWorkspace ? managerItems : residentItems;

  const canSeeStaffView = ["manager", "owner", "app_admin", "mechanic"].includes(sessionRole || "");

  const displayItems = navItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center justify-center border-t border-white/20 bg-white/70 px-4 py-3 backdrop-blur-lg sm:bottom-6 sm:border-none sm:bg-transparent sm:px-0 sm:py-0">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between sm:rounded-3xl sm:border sm:border-white/40 sm:bg-white/80 sm:p-2 sm:shadow-[0_8px_32px_rgba(0,0,0,0.1)] sm:backdrop-blur-xl">
        {displayItems.map((item) => {
          let isActive = false;
          
          if (item.href.includes("?")) {
            const [path, query] = item.href.split("?");
            const itemParams = new URLSearchParams(query);
            const viewParam = itemParams.get("view");
            isActive = pathname === path && searchParams.get("view") === viewParam;
          } else {
            isActive = pathname === item.href;
          }
          return (
            <Link
              key={item.href}
              href={item.href as any}
              className={`group flex flex-col items-center gap-1 transition-all duration-300 ${
                isActive
                  ? "scale-105 text-sky-600"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-500 ${
                  isActive 
                    ? "bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_5px_12px_-3px_rgba(14,165,233,0.4)] ring-2 ring-sky-50" 
                    : "bg-transparent group-hover:bg-slate-50"
                }`}
              >
                {/* Adjust icon wrapper to h-5 w-5 equivalent */}
                <div className="scale-75">
                  {item.icon}
                </div>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wider transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-50"}`}>
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
