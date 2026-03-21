"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type PortalLanguage = "en" | "vi";

type PortalLanguageContextValue = {
  language: PortalLanguage;
  setLanguage: (language: PortalLanguage) => void;
  t: (key: string, fallback?: string) => string;
};

const PORTAL_LANGUAGE_STORAGE_KEY = "cozorohome-portal-language";

const translations: Record<string, { en: string; vi: string }> = {
  portalTitle: { en: "CozoroHome Portal", vi: "Cổng thông tin CozoroHome" },
  home: { en: "Home", vi: "Trang chủ" },
  clientServices: { en: "Client Services", vi: "Dịch vụ khách hàng" },
  billingCenter: { en: "Billing & Fines", vi: "Thanh toán và phạt" },
  bookings: { en: "Bookings", vi: "Đặt lịch" },
  controller: { en: "Controller", vi: "Điều khiển" },
  accountOverview: { en: "Account Overview", vi: "Tổng quan tài khoản" },
  coins: { en: "Coins", vi: "Cozoro Coins" },
  payments: { en: "Payments", vi: "Thanh toán" },
  fines: { en: "Fines", vi: "Phí vi phạm" },
  cleaningSchedule: { en: "Cleaning Schedule", vi: "Lịch vệ sinh" },
  adminCleaning: { en: "Admin Cleaning", vi: "Quản lý vệ sinh" },
  manager: { en: "Manager", vi: "Quản lý" },
  clientLogin: { en: "Client Login", vi: "Đăng nhập khách" },
  language: { en: "Language", vi: "Ngôn ngữ" },
  english: { en: "English", vi: "Tiếng Anh" },
  vietnamese: { en: "Vietnamese", vi: "Tiếng Việt" },
  homepageTitle: { en: "CozoroHome Portal", vi: "Cổng thông tin CozoroHome" },
  paymentHistory: { en: "Payment History", vi: "Lịch sử thanh toán" },
  viewPaymentHistory: { en: "View payment history", vi: "Xem lịch sử thanh toán" },
  refreshPayments: { en: "Refresh payments", vi: "Làm mới thanh toán" },
  myPaymentEntries: { en: "My Payment Entries", vi: "Các khoản thanh toán của tôi" },
  purpose: { en: "Purpose", vi: "Mục đích" },
  sort: { en: "Sort", vi: "Sắp xếp" },
  nextPayment: { en: "Next Payment", vi: "Kỳ thanh toán tiếp theo" },
  coinsTitle: { en: "Coins", vi: "Cozoro Coins" },
  viewCoinHistory: { en: "View coin history", vi: "Xem lịch sử coins" },
  refreshCoins: { en: "Refresh coins", vi: "Làm mới coins" },
  myCoinEntries: { en: "My Coin Entries", vi: "Các giao dịch coins của tôi" },
  recentHistory: { en: "Recent history", vi: "Lịch sử gần đây" },
  showFilters: { en: "Show filters and more history", vi: "Hiện bộ lọc và thêm lịch sử" },
  hideFilters: { en: "Hide filters and full history", vi: "Ẩn bộ lọc và toàn bộ lịch sử" },
  showMore10: { en: "Show 10 more", vi: "Xem thêm 10 dòng" },
  showFewer: { en: "Show fewer", vi: "Thu gọn" },
  event: { en: "Event", vi: "Sự kiện" },
  timestamp: { en: "Timestamp", vi: "Dấu thời gian" },
  operator: { en: "Operator", vi: "Người thao tác" },
  finesTitle: { en: "Fines", vi: "Phí vi phạm" },
  viewFineHistory: { en: "View fine history", vi: "Xem lịch sử phí vi phạm" },
  refreshFines: { en: "Refresh fines", vi: "Làm mới phí vi phạm" },
  laundryBookingsTitle: { en: "Laundry Bookings", vi: "Đặt lịch giặt sấy" },
  acControllerTitle: { en: "Room Controller", vi: "Điều khiển máy lạnh" },
  loadBookingOptions: { en: "Load booking options", vi: "Tải tùy chọn đặt lịch" },
  bookLaundrySlot: { en: "Book laundry slot", vi: "Đặt lịch giặt sấy" },
  accountOverviewTitle: { en: "Account Overview", vi: "Tổng quan tài khoản" }
};

const PortalLanguageContext = createContext<PortalLanguageContextValue | null>(null);

export function PortalLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<PortalLanguage>("en");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(PORTAL_LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "vi") {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PORTAL_LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "vi" ? "vi" : "en";
  }, [language]);

  const value = useMemo<PortalLanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => setLanguageState(nextLanguage),
      t: (key, fallback) => translations[key]?.[language] ?? fallback ?? key
    }),
    [language]
  );

  return <PortalLanguageContext.Provider value={value}>{children}</PortalLanguageContext.Provider>;
}

export function usePortalLanguage() {
  const context = useContext(PortalLanguageContext);
  if (!context) {
    throw new Error("usePortalLanguage must be used inside PortalLanguageProvider");
  }

  return context;
}
