"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortalSession } from "./portal-session";

export function FeedbackLink() {
  const pathname = usePathname();
  const { sessionEmail } = usePortalSession();
  const href = sessionEmail
    ? `/support?from=${encodeURIComponent(pathname)}&email=${encodeURIComponent(sessionEmail)}`
    : `/support?from=${encodeURIComponent(pathname)}`;

  return (
    <Link
      href={href}
      className="inline-flex rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm ring-2 ring-amber-200/70 transition hover:bg-amber-300"
    >
      Feedback
    </Link>
  );
}
