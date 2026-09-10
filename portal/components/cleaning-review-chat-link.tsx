"use client";
import { usePortalLanguage } from "./portal-language";

export function CleaningReviewChatLink({ pagePath }: { pagePath?: string | null }) {
  const { language } = usePortalLanguage();
  if (!pagePath || !/^\/cleaning-review\?id=[a-zA-Z0-9_-]+$/.test(pagePath)) return null;
  return <a href={pagePath} className="mt-2 inline-block font-semibold underline">
    {language === "vi" ? "Mở trao đổi về lịch vệ sinh" : "Open cleaning dispute"}
  </a>;
}
