"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { FeedbackFab } from "./feedback-fab";
import { PortalLanguageProvider, usePortalLanguage } from "./portal-language";
import { PortalSessionProvider, usePortalSession } from "./portal-session";

const ADMIN_EMAILS = new Set(["cozorohome@gmail.com", "dr.trongto@gmail.com"]);

function SiteChrome({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, t } = usePortalLanguage();
  const { sessionEmail, isLoggedIn, logout } = usePortalSession();
  const pathname = usePathname();
  const isLoginPage = pathname === "/client-login";
  const isAdminSession = isLoggedIn && ADMIN_EMAILS.has(sessionEmail.trim().toLowerCase());

  const primaryLinks = [
    { href: "/" as Route, label: t("home"), match: ["/"] },
    { href: "/service/laundry" as Route, label: "Service", match: ["/service", "/bookings", "/controller"] },
    { href: "/billings/laundry-fee" as Route, label: "Billings", match: ["/billings", "/payments", "/fines"] },
    { href: "/schedule" as Route, label: "Schedule", match: ["/schedule", "/cleaning-schedule"] },
    { href: "/coins" as Route, label: t("coins"), match: ["/coins"] }
  ];

  const utilityLinks = isAdminSession
    ? [
        { href: "/manager" as Route, label: t("manager") },
        { href: "/admin-cleaning" as Route, label: t("adminCleaning") }
      ]
    : !isLoggedIn
      ? [{ href: "/client-login" as Route, label: t("clientLogin") }]
      : [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              {t("portalTitle")}
            </Link>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {isLoggedIn ? (
                <div className="max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 break-all sm:rounded-full sm:py-1">
                  Signed in as {sessionEmail}
                </div>
              ) : null}
              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:border-slate-300"
                >
                  Log out
                </button>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span>{t("language")}</span>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as "en" | "vi")}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
                >
                  <option value="en">{t("english")}</option>
                  <option value="vi">{t("vietnamese")}</option>
                </select>
              </label>
            </div>
          </div>

          <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 hide-scrollbar sm:mx-0 sm:px-0">
            <div className="flex min-w-max items-center gap-3">
              {primaryLinks.map((link) => {
                const isActive = link.match.some((segment) =>
                  segment === "/" ? pathname === "/" : pathname.startsWith(segment)
                );

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "border border-sky-200 bg-sky-50 text-sky-900 shadow-sm"
                        : "border border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-slate-50"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {utilityLinks.length > 0 ? (
            <nav className="-mx-4 mt-4 flex overflow-x-auto px-4 pb-1 text-sm text-slate-600 hide-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
              {utilityLinks.map((link) => (
                <Link key={link.href} href={link.href} className="mr-4 shrink-0 whitespace-nowrap last:mr-0">
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        {isLoggedIn || isLoginPage ? (
          children
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold text-slate-900">Login Required</h1>
            <p className="mt-2 text-sm text-slate-600">
              Please sign in with an email from the user list before using the portal.
            </p>
            <div className="mt-6">
              <Link
                href="/client-login"
                className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-medium text-sky-900"
              >
                Go to login
              </Link>
            </div>
          </section>
        )}
      </main>
      {isLoggedIn ? <FeedbackFab /> : null}
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
