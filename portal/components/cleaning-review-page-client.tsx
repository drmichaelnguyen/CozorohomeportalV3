"use client";
import { useEffect, useState } from "react";
import { CleaningAssignmentReview } from "./cleaning-assignment-review";
import { usePortalSession } from "./portal-session";
import { usePortalLanguage } from "./portal-language";

export function CleaningReviewPageClient() {
  const { sessionEmail, isSessionLoaded, isLoggedIn } = usePortalSession();
  const { language } = usePortalLanguage();
  const [reviewId, setReviewId] = useState<string | null>(null);
  useEffect(() => { setReviewId(new URLSearchParams(window.location.search).get("id") ?? ""); }, []);
  const vi = language === "vi";
  if (!isSessionLoaded || reviewId === null) return <p>{vi ? "Đang tải…" : "Loading…"}</p>;
  if (!isLoggedIn) return <p>{vi ? "Vui lòng đăng nhập để xem trao đổi." : "Please sign in to view this dispute."} <a href="/" className="underline">{vi ? "Đăng nhập" : "Sign in"}</a></p>;
  if (!reviewId) return <p>{vi ? "Thiếu mã trao đổi." : "Missing dispute ID."}</p>;
  return <section className="mx-auto max-w-3xl rounded-2xl bg-white p-5 shadow-sm">
    <h1 className="text-xl font-semibold">{vi ? "Trao đổi về lịch vệ sinh" : "Cleaning schedule dispute"}</h1>
    <a href="/support" className="my-3 inline-block text-sm underline">{vi ? "Mở chat" : "Open chat"}</a>
    <CleaningAssignmentReview key={`${sessionEmail}|${reviewId}`} reviewId={reviewId} actorEmail={sessionEmail} language={language} initiallyOpen />
  </section>;
}
