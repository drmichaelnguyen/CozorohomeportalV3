"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePortalSession } from "./portal-session";

export function FeedbackFab() {
  const pathname = usePathname();
  const { sessionEmail } = usePortalSession();
  const href = sessionEmail
    ? `/support?from=${encodeURIComponent(pathname)}&email=${encodeURIComponent(sessionEmail)}`
    : `/support?from=${encodeURIComponent(pathname)}`;

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      <Link
        href={href}
        className="inline-flex rounded-full bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-2xl shadow-amber-300/50 ring-4 ring-amber-200/70 transition hover:-translate-y-0.5 hover:bg-amber-300 sm:px-5"
      >
        Feedback
      </Link>
    </div>
  );
}
