"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

function detectDevice(): "mobile" | "desktop" | "tablet" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Fire-and-forget portal visit beacon for logged-in users.
 * Server dedupes the same email+path within ~20 minutes.
 */
export function PortalVisitTracker() {
  const { sessionEmail, sessionRole, isLoggedIn, isSessionLoaded } = usePortalSession();
  const pathname = usePathname();
  const lastSentKey = useRef("");

  useEffect(() => {
    if (!isSessionLoaded || !isLoggedIn) return;
    const email = sessionEmail.trim().toLowerCase();
    if (!email || !pathname) return;

    const key = `${email}|${pathname}`;
    if (lastSentKey.current === key) return;
    lastSentKey.current = key;

    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/portal/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        role: sessionRole || "user",
        path: pathname,
        device: detectDevice()
      }),
      signal: controller.signal,
      keepalive: true
    }).catch(() => {
      // Non-blocking — analytics must never break the portal.
      lastSentKey.current = "";
    });

    return () => controller.abort();
  }, [isSessionLoaded, isLoggedIn, sessionEmail, sessionRole, pathname]);

  return null;
}
