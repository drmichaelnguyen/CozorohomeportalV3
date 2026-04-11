"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { NotificationBell } from "./notification-bell";
import { PortalLanguageProvider, usePortalLanguage } from "./portal-language";
import { PortalSessionProvider, usePortalSession } from "./portal-session";
import { MobileNav } from "./mobile-nav";
import { ChatNotifier } from "./chat-notifier";
import { VersionBadge } from "./version-badge";
import { PushSubscription } from "./push-subscription";

function SiteChrome({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded, logout } = usePortalSession();
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
              <button
                type="button"
                onClick={() => setLanguage(language === "vi" ? "en" : "vi")}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                {language === "vi" ? "EN" : "VI"}
              </button>
              <NotificationBell />
            </div>
          </div>

          {/* Primary and Utility links are now replaced by the Unified Bottom/Floating Nav */}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-32 sm:px-6 sm:pt-10 sm:pb-40">
        {!isSessionLoaded ? null : isLoggedIn || isPublicStandalonePage ? (
          children
        ) : (
          <div className="space-y-6">
            {/* Hero */}
            <section className="rounded-3xl bg-gradient-to-br from-sky-600 to-slate-800 p-7 text-white shadow-lg sm:p-10">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">
                  {language === "vi" ? "Chào mừng đến với" : "Welcome to"}
                </p>
                <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">CozoroHome</h1>
                <p className="mt-3 text-base leading-relaxed text-sky-100">
                  {language === "vi"
                    ? "Không gian sống cộng đồng hiện đại — giá cả phải chăng, tiện nghi đầy đủ, môi trường bình yên và văn minh, được vận hành bởi hệ thống tự động hóa và công nghệ quản lý tiên tiến."
                    : "A modern co-living space — affordable for everyone, fully equipped with quality amenities, peaceful and respectful environment, powered by a highly automated and high-tech management system."}
                </p>
                <Link
                  href="/client-login"
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold shadow hover:bg-sky-50 transition-colors"
                  style={{ color: "#0f172a" }}
                >
                  {language === "vi" ? "Đăng nhập tài khoản" : "Sign in to your account"}
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </section>

            {/* Vision */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-lg font-semibold text-slate-900">
                {language === "vi" ? "Tầm nhìn của chúng tôi" : "Our Vision"}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                {language === "vi"
                  ? "CozoroHome được xây dựng từ ước mơ tạo ra một không gian sống cộng đồng thực sự tiên tiến — nơi mà bất kỳ ai cũng có thể tiếp cận với mức giá thấp và hợp lý, trong khi vẫn được hưởng đầy đủ tiện nghi chất lượng cao."
                  : "CozoroHome was built from a dream — to create a truly futuristic co-living space that is genuinely low-cost and affordable for everyone, while still offering high-quality, sufficient amenities that make daily life comfortable and dignified."}
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: "✦",
                    en: "Affordable for Everyone",
                    vi: "Giá cả phải chăng cho tất cả",
                    descEn: "Low and transparent pricing so quality co-living is accessible to anyone, not just the privileged few.",
                    descVi: "Giá minh bạch, thấp nhất có thể để bất kỳ ai cũng có thể tiếp cận không gian sống chất lượng."
                  },
                  {
                    icon: "◈",
                    en: "High-Quality Amenities",
                    vi: "Tiện nghi đầy đủ & chất lượng",
                    descEn: "Fully equipped shared spaces — laundry, kitchen, and more — maintained to a high standard for everyone.",
                    descVi: "Không gian chung được trang bị đầy đủ — giặt sấy, bếp và nhiều tiện ích khác — duy trì theo tiêu chuẩn cao."
                  },
                  {
                    icon: "❋",
                    en: "Peaceful & Respectful Community",
                    vi: "Cộng đồng bình yên & văn minh",
                    descEn: "A culture of mutual respect — for each other, for shared spaces, and for the living environment.",
                    descVi: "Văn hóa tôn trọng lẫn nhau — tôn trọng con người, không gian chung và môi trường sống."
                  },
                  {
                    icon: "⬡",
                    en: "High-Tech Automation",
                    vi: "Tự động hóa & công nghệ cao",
                    descEn: "Smart systems handle scheduling, billing, maintenance, and communications — so residents can focus on living.",
                    descVi: "Hệ thống thông minh xử lý lịch trình, thanh toán, bảo trì và liên lạc — để cư dân tập trung vào cuộc sống."
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
      {isLoggedIn && !isLoginPage ? <MobileNav /> : null}
      {isLoggedIn ? <ChatNotifier /> : null}
      {isLoggedIn && sessionEmail ? <PushSubscription email={sessionEmail} /> : null}
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
