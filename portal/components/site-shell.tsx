"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { FeedbackFab } from "./feedback-fab";
import { NotificationBell } from "./notification-bell";
import { PortalLanguageProvider, usePortalLanguage } from "./portal-language";
import { PortalSessionProvider, usePortalSession } from "./portal-session";
import { MobileNav } from "./mobile-nav";
import { VersionBadge } from "./version-badge";

function SiteChrome({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, logout } = usePortalSession();
  const pathname = usePathname();
  const isLoginPage = pathname === "/client-login";
  const isStaffSession = isLoggedIn && !!sessionRole && ["manager", "owner", "app_admin", "mechanic"].includes(sessionRole);
  const isManagerWorkspace = pathname.startsWith("/manager") || pathname.startsWith("/admin-cleaning");
  const isMechanicWorkspace = pathname.startsWith("/mechanic");
  const isStaffWorkspace = isManagerWorkspace || isMechanicWorkspace;

  const primaryLinks = isStaffWorkspace
    ? []
    : [
        { href: "/" as Route, label: t("home"), match: ["/"] },
        { href: "/service/laundry" as Route, label: t("service", "Service"), match: ["/service", "/bookings", "/controller"] },
        { href: "/billings/laundry-fee" as Route, label: t("billingCenter", "Billings"), match: ["/billings", "/payments", "/fines"] },
        { href: "/schedule" as Route, label: t("schedule", "Schedule"), match: ["/schedule", "/cleaning-schedule"] },
        { href: "/coins" as Route, label: t("coins"), match: ["/coins"] }
      ];

  const utilityLinks = isStaffSession
    ? isStaffWorkspace
      ? [{ href: (sessionRole === "mechanic" ? "/mechanic" : "/manager") as Route, label: (sessionRole === "mechanic" ? t("staff") : t("manager")) }]
      : [
          { href: "/notifications" as Route, label: t("notifications") },
          { href: "/support" as Route, label: t("support") }
        ]
    : isLoggedIn
      ? [
          { href: "/notifications" as Route, label: t("notifications") },
          { href: "/support" as Route, label: t("support") }
        ]
      : [{ href: "/client-login" as Route, label: t("clientLogin") }];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              {t("portalTitle")}
            </Link>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {isStaffSession ? (
                <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                  <Link
                    href="/"
                    className={`rounded-full px-3 py-1 text-sm font-medium ${
                      !isStaffWorkspace
                        ? "border border-sky-200 bg-sky-50 text-sky-900 shadow-sm"
                        : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {t("userView", "User view")}
                  </Link>
                  <Link
                    href={sessionRole === "mechanic" ? "/mechanic" : "/manager"}
                    className={`rounded-full px-3 py-1 text-sm font-medium ${
                      isStaffWorkspace
                        ? "border border-sky-200 bg-sky-50 text-sky-900 shadow-sm"
                        : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {sessionRole === "mechanic" ? t("staffView", "Staff view") : t("managerView", "Manager view")}
                  </Link>
                </div>
              ) : null}
              {isLoggedIn ? (
                <div className="max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 break-all sm:rounded-full sm:py-1">
                  {t("signedInAs", "Signed in as")} {sessionEmail}
                  {sessionRole ? ` (${sessionRole})` : ""}
                </div>
              ) : null}
              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:border-slate-300"
                >
                  {t("logout", "Log out")}
                </button>
              ) : null}
              <NotificationBell />
            </div>
          </div>

          {/* Primary and Utility links are now replaced by the Unified Bottom/Floating Nav */}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-32 sm:px-6 sm:pt-10 sm:pb-40">
        {isLoggedIn || isLoginPage ? (
          children
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold text-slate-900">{t("loginRequired", "Login Required")}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {t("loginRequiredSub", "Please sign in with an active user email or a pre-approved Cozoro team email before using the portal.")}
            </p>
            <div className="mt-6">
              <Link
                href="/client-login"
                className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-medium text-sky-900"
              >
                {t("goToLogin", "Go to login")}
              </Link>
            </div>
          </section>
        )}
      </main>
      {isLoggedIn ? <FeedbackFab /> : null}
      {isLoggedIn && !isLoginPage ? <MobileNav /> : null}
      <VersionBadge />
    </div>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <PortalSessionProvider>
      <PortalLanguageProvider>
        <SiteChrome>{children}</SiteChrome>
      </PortalLanguageProvider>
    </PortalSessionProvider>
  );
}
