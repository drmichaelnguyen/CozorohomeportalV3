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
  portalTitle: { en: "CozoroHome Portal", vi: "C\u1ed5ng th\u00f4ng tin CozoroHome" },
  home: { en: "Home", vi: "Trang ch\u1ee7" },
  clientServices: { en: "Client Services", vi: "D\u1ecbch v\u1ee5 kh\u00e1ch h\u00e0ng" },
  billingCenter: { en: "Billing & Fines", vi: "Thanh to\u00e1n v\u00e0 ti\u1ec1n ph\u1ea1t" },
  bookings: { en: "Bookings", vi: "\u0110\u1eb7t l\u1ecbch" },
  controller: { en: "Controller", vi: "\u0110i\u1ec1u khi\u1ec3n" },
  accountOverview: { en: "Account Overview", vi: "T\u1ed5ng quan t\u00e0i kho\u1ea3n" },
  coins: { en: "Coins", vi: "Cozoro Coins" },
  payments: { en: "Payments", vi: "Thanh to\u00e1n" },
  fines: { en: "Fines", vi: "Ti\u1ec1n ph\u1ea1t" },
  cleaningSchedule: { en: "Cleaning Schedule", vi: "L\u1ecbch v\u1ec7 sinh" },
  adminCleaning: { en: "Admin Cleaning", vi: "Ph\u00e2n c\u00f4ng l\u1ecbch v\u1ec7 sinh" },
  manager: { en: "Manager", vi: "Qu\u1ea3n l\u00fd" },
  notifications: { en: "Notifications", vi: "Th\u00f4ng b\u00e1o" },
  support: { en: "Support", vi: "H\u1ed7 tr\u1ee3" },
  clientLogin: { en: "Client Login", vi: "\u0110\u0103ng nh\u1eadp kh\u00e1ch h\u00e0ng" },
  language: { en: "Language", vi: "Ng\u00f4n ng\u1eef" },
  english: { en: "English", vi: "Ti\u1ebfng Anh" },
  vietnamese: { en: "Vietnamese", vi: "Ti\u1ebfng Vi\u1ec7t" },
  homepageTitle: { en: "CozoroHome Portal", vi: "C\u1ed5ng th\u00f4ng tin CozoroHome" },
  paymentHistory: { en: "Payment History", vi: "L\u1ecbch s\u1eed thanh to\u00e1n" },
  viewPaymentHistory: { en: "View payment history", vi: "Xem l\u1ecbch s\u1eed thanh to\u00e1n" },
  refreshPayments: { en: "Refresh payments", vi: "L\u00e0m m\u1edbi thanh to\u00e1n" },
  myPaymentEntries: { en: "My Payment Entries", vi: "C\u00e1c kho\u1ea3n thanh to\u00e1n c\u1ee7a t\u00f4i" },
  purpose: { en: "Purpose", vi: "M\u1ee5c \u0111\u00edch" },
  sort: { en: "Sort", vi: "S\u1eafp x\u1ebfp" },
  nextPayment: { en: "Next Payment", vi: "K\u1ef3 thanh to\u00e1n ti\u1ebfp theo" },
  coinsTitle: { en: "Coins", vi: "Cozoro Coins" },
  viewCoinHistory: { en: "View coin history", vi: "Xem l\u1ecbch s\u1eed coin" },
  refreshCoins: { en: "Refresh coins", vi: "L\u00e0m m\u1edbi coin" },
  myCoinEntries: { en: "My Coin Entries", vi: "Giao d\u1ecbch coin c\u1ee7a t\u00f4i" },
  recentHistory: { en: "Recent history", vi: "L\u1ecbch s\u1eed g\u1ea7n \u0111\u00e2y" },
  showFilters: { en: "Show filters and more history", vi: "Hi\u1ec7n b\u1ed9 l\u1ecdc v\u00e0 th\u00eam l\u1ecbch s\u1eed" },
  hideFilters: { en: "Hide filters and full history", vi: "\u1ea8n b\u1ed9 l\u1ecdc v\u00e0 to\u00e0n b\u1ed9 l\u1ecbch s\u1eed" },
  showMore10: { en: "Show 10 more", vi: "Xem th\u00eam 10 d\u00f2ng" },
  showFewer: { en: "Show fewer", vi: "Thu g\u1ecdn" },
  event: { en: "Event", vi: "S\u1ef1 ki\u1ec7n" },
  timestamp: { en: "Timestamp", vi: "Th\u1eddi gian" },
  operator: { en: "Operator", vi: "Ng\u01b0\u1eddi thao t\u00e1c" },
  finesTitle: { en: "Fines", vi: "Ti\u1ec1n ph\u1ea1t" },
  viewFineHistory: { en: "View fine history", vi: "Xem l\u1ecbch s\u1eed ti\u1ec1n ph\u1ea1t" },
  refreshFines: { en: "Refresh fines", vi: "L\u00e0m m\u1edbi ti\u1ec1n ph\u1ea1t" },
  laundryBookingsTitle: { en: "Laundry Bookings", vi: "\u0110\u1eb7t l\u1ecbch gi\u1eb7t s\u1ea5y" },
  acControllerTitle: { en: "Room Controller", vi: "\u0110i\u1ec1u khi\u1ec3n m\u00e1y l\u1ea1nh" },
  loadBookingOptions: { en: "Load booking options", vi: "T\u1ea3i t\u00f9y ch\u1ecdn \u0111\u1eb7t l\u1ecbch" },
  bookLaundrySlot: { en: "Book laundry slot", vi: "\u0110\u1eb7t l\u1ecbch gi\u1eb7t s\u1ea5y" },
  accountOverviewTitle: { en: "Account Overview", vi: "T\u1ed5ng quan t\u00e0i kho\u1ea3n" }
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
