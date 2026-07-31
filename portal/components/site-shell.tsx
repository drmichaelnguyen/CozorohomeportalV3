"use client";

import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { NotificationBell } from "./notification-bell";
import { PortalLanguageProvider, usePortalLanguage } from "./portal-language";
import { PortalSessionProvider, usePortalSession } from "./portal-session";
import { PortalThemeProvider } from "./portal-theme";
import { MobileNav } from "./mobile-nav";
import { ChatNotifier } from "./chat-notifier";
import { VersionBadge } from "./version-badge";
import { PushSubscription } from "./push-subscription";
import { InlineHelp } from "./inline-help";
import { CleaningReminderPopup } from "./cleaning-reminder-popup";
import { RentDueBlockingOverlay } from "./rent-due-blocking-overlay";
import { AddToHomeScreenPrompt } from "./add-to-home-screen-prompt";
import { BranchBroadcastPrompt } from "./branch-broadcast-prompt";
import { PaymentRequirementPrompt } from "./payment-requirement-prompt";
import { SelfAssignPromoPopup } from "./self-assign-promo-popup";

function SiteChrome({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const isPublicStandalonePage = pathname === "/client-login" || pathname === "/register";
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
        <div className={`mx-auto max-w-5xl px-3 sm:px-6 ${isStaffSession ? "py-1.5 sm:py-2" : "py-2 sm:py-3"}`}>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="inline-flex shrink-0 items-center rounded-lg outline-offset-4 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              <Image
                src="/cozorohome-logo.png"
                alt={t("portalTitle")}
                width={220}
                height={88}
                className="h-7 w-auto sm:h-9 sm:h-10"
                priority
              />
              <span className="sr-only">{t("portalTitle")}</span>
            </Link>
            {isStaffSession ? (
              <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
                <Link
                  href="/"
                  className={`rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:px-2.5 sm:text-xs ${
                    !isStaffWorkspace
                      ? "border border-sky-200 bg-sky-50 text-sky-900 shadow-sm"
                      : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {t("userView", "User view")}
                </Link>
                <Link
                  href={sessionRole === "mechanic" ? "/mechanic" : "/manager"}
                  className={`rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:px-2.5 sm:text-xs ${
                    isStaffWorkspace
                      ? "border border-sky-200 bg-sky-50 text-sky-900 shadow-sm"
                      : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {sessionRole === "mechanic" ? t("staffView", "Staff view") : t("managerView", "Manager view")}
                </Link>
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
              {isLoggedIn ? (
                <div className="flex min-w-0 max-w-[min(100%,52vw)] flex-1 items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-1.5 pr-0.5 sm:max-w-[min(100%,22rem)] sm:pl-2 sm:pr-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700 sm:text-xs md:text-sm" title={sessionEmail}>
                    {sessionEmail}
                  </span>
                  <InlineHelp
                    className="shrink-0"
                    label={t("sessionDetailsHelpLabel")}
                    title={t("portalTitle")}
                    body={`${t("signedInAs", "Signed in as")} ${sessionEmail}${sessionRole ? `\n${language === "vi" ? "Vai trò" : "Role"}: ${sessionRole}` : ""}`}
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setLanguage(language === "vi" ? "en" : "vi")}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 sm:px-3 sm:py-1 sm:text-sm"
              >
                {language === "vi" ? "EN" : "VI"}
              </button>
              <div className="shrink-0">
                <NotificationBell />
              </div>
            </div>
          </div>

          {/* Primary and Utility links are now replaced by the Unified Bottom/Floating Nav */}
        </div>
      </header>
      <main
        className={`mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:pt-10 ${
          isSessionLoaded && isLoggedIn ? "pb-32 sm:pb-40" : "pb-8 sm:pb-10"
        }`}
      >
        {!isSessionLoaded ? null : isLoggedIn || isPublicStandalonePage ? (
          children
        ) : (
          <div className="space-y-6">
            {/* Hero */}
            <section className="rounded-3xl bg-gradient-to-br from-sky-600 to-slate-800 p-7 text-white shadow-lg sm:p-10">
              <div className="max-w-2xl">
                <div className="mb-5 inline-block rounded-2xl bg-white p-4 shadow-md ring-1 ring-white/40">
                  <Image
                    src="/cozorohome-logo.png"
                    alt={language === "vi" ? "Cozoro Home — ký túc xá co-living" : "Cozoro Home — co-living housing"}
                    width={320}
                    height={128}
                    className="h-24 w-auto sm:h-28"
                    priority
                  />
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">
                  {language === "vi" ? "Hostel tự động giá rẻ tại TP.HCM" : "Automated budget hostel in Ho Chi Minh City"}
                </p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-5xl">
                  {language === "vi"
                    ? "Thuê giường tầng hostel giá rẻ từ 70.000 VND/ngày"
                    : "Cheap hostel bunk bed rental from 70,000 VND/day"}
                </h1>
                <p className="mt-3 text-base leading-relaxed text-sky-100">
                  {language === "vi"
                    ? "CozoroHome quảng bá là một trong những hostel giường tầng tự động hóa cao và giá rẻ tại Thành phố Hồ Chí Minh, phù hợp cho người cần chỗ ở tiết kiệm, đặt chỗ nhanh và quản lý tiện nghi bằng hệ thống số."
                    : "CozoroHome is built to be one of the most automated and cheap hostel bunk bed rentals in Ho Chi Minh City, ideal for budget stays with fast booking and streamlined digital operations."}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 rounded-full bg-[#ffffff] px-6 py-3 text-sm font-semibold !text-[#0f172a] shadow-md shadow-slate-900/10 ring-1 ring-slate-200/90 transition-colors hover:bg-slate-100 hover:!text-[#020617] dark:bg-[#f8fafc] dark:shadow-black/25 dark:ring-white/25 dark:hover:bg-slate-200 dark:hover:!text-[#020617]"
                  >
                    {language === "vi" ? "Đặt giường ngay" : "Book a bunk bed"}
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                  <Link
                    href="/client-login"
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15"
                  >
                    {language === "vi" ? "Đăng nhập cư dân" : "Resident login"}
                  </Link>
                </div>
              </div>
            </section>

            {/* Vision */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-lg font-semibold text-slate-900">
                {language === "vi" ? "Vì sao CozoroHome nổi bật" : "Why CozoroHome stands out"}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                {language === "vi"
                  ? "Trang này được viết để khách tìm trên Google có thể hiểu nhanh: CozoroHome cung cấp chỗ ngủ giường tầng hostel giá rẻ tại TP.HCM, nhấn mạnh vận hành tự động, đặt chỗ thuận tiện và mức giá khởi điểm từ 70.000 VND/ngày."
                  : "This page is written so Google visitors can quickly understand the offer: CozoroHome provides cheap hostel bunk bed stays in Ho Chi Minh City with heavy automation, convenient booking, and rates starting from 70,000 VND/day."}
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: "✦",
                    en: "Starting From 70,000 VND/Day",
                    vi: "Từ 70.000 VND/ngày",
                    descEn: "Entry-level daily pricing designed for travelers, workers, and residents who need a cheap bed in Ho Chi Minh City.",
                    descVi: "Mức giá mở đầu hướng tới khách ở ngắn ngày, người lao động và người cần một chỗ ngủ tiết kiệm tại TP.HCM."
                  },
                  {
                    icon: "◈",
                    en: "Automated Operations",
                    vi: "Vận hành tự động hóa",
                    descEn: "Digital systems support booking, billing, maintenance, and resident communication to reduce friction and cost.",
                    descVi: "Hệ thống số hỗ trợ đặt chỗ, thu tiền, bảo trì và giao tiếp với cư dân để giảm thao tác thủ công và giảm chi phí."
                  },
                  {
                    icon: "❋",
                    en: "Cheap Hostel Beds In Ho Chi Minh City",
                    vi: "Giường hostel giá rẻ tại TP.HCM",
                    descEn: "The landing copy now clearly targets the search phrases people actually use when looking for cheap hostel bunk beds in the city.",
                    descVi: "Nội dung trang đã nhắm rõ các cụm từ khách thật dùng khi tìm hostel giường tầng giá rẻ tại Thành phố Hồ Chí Minh."
                  },
                  {
                    icon: "⬡",
                    en: "Fast Self-Service Journey",
                    vi: "Hành trình tự phục vụ nhanh",
                    descEn: "Visitors can move from discovery to registration without a long manual back-and-forth process.",
                    descVi: "Khách có thể đi từ bước tìm hiểu đến đăng ký mà không cần quy trình trao đổi thủ công quá dài."
                  }
                ].map((item) => (
                  <div key={item.en} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-xl text-sky-600 select-none">{item.icon}</div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{language === "vi" ? item.vi : item.en}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{language === "vi" ? item.descVi : item.descEn}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Developer */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-lg font-semibold text-slate-900">
                {language === "vi" ? "Về người sáng lập & phát triển" : "Founder & Developer"}
              </h2>
              <div className="mt-4 flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-2xl font-bold select-none">T</div>
                <div>
                  <p className="text-base font-semibold text-slate-900">Dr. Trong Nguyen</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {language === "vi"
                      ? "Bác sĩ tại Việt Nam · Nhà phát triển AI · Vancouver, Canada"
                      : "Doctor in Vietnam · AI-driven Developer · Vancouver, Canada"}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    {language === "vi"
                      ? "Bác sĩ Trọng Nguyễn sáng lập CozoroHome vào năm 2019 với tầm nhìn xây dựng hệ thống nhà ở được tự động hóa cao nhất có thể. Là người luôn tin vào sức mạnh của công nghệ để cải thiện chất lượng sống, ông phát triển toàn bộ hệ thống quản lý này từ đầu — từ việc tự động hóa lịch dọn dẹp, quản lý tiền thuê đến hệ thống hỗ trợ cư dân theo thời gian thực."
                      : "Dr. Trong Nguyen founded CozoroHome in 2019 driven by a belief that technology can fundamentally improve the way people live together. As a doctor in Vietnam and an AI-driven developer based in Vancouver, Canada, he built this entire management system from scratch — automating everything from cleaning schedules and rent tracking to real-time resident support — to give every resident a futuristic, high-quality living experience at an honest price."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href="https://www.facebook.com/nguyentrong265"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                      </svg>
                      {language === "vi" ? "Kết nối với Dr. Trọng" : "Connect with Dr. Trong"}
                    </a>
                    <a
                      href="https://cozorohome.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253M3 12c0 .778.099 1.533.284 2.253" />
                      </svg>
                      cozorohome.com
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
      {isSessionLoaded && isLoggedIn ? (
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      ) : null}
      {isLoggedIn ? <ChatNotifier /> : null}
      {isLoggedIn && sessionEmail ? <PushSubscription email={sessionEmail} /> : null}
      {isLoggedIn && sessionEmail ? (
        <BranchBroadcastPrompt
          email={sessionEmail}
          enabled={!isStaffSession}
        />
      ) : null}
      {isLoggedIn && sessionEmail ? (
        <PaymentRequirementPrompt email={sessionEmail} enabled={!isStaffSession} />
      ) : null}
      <CleaningReminderPopup />
      <SelfAssignPromoPopup />
      <RentDueBlockingOverlay />
      <AddToHomeScreenPrompt />
      <VersionBadge />
    </div>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <PortalThemeProvider>
      <PortalSessionProvider>
        <PortalLanguageProvider>
          <SiteChrome>{children}</SiteChrome>
        </PortalLanguageProvider>
      </PortalSessionProvider>
    </PortalThemeProvider>
  );
}
