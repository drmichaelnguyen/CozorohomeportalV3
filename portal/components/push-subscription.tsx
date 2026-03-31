"use client";

import { useEffect, useRef } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

async function getVapidKey(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/push/vapid-public-key`);
  const data = await res.json();
  return data.publicKey as string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function PushSubscription({ email }: { email: string }) {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;

    async function subscribe() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        // Check if already subscribed
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          // Re-save in case email changed
          await fetch(`${API_BASE_URL}/push/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, subscription: existing.toJSON() })
          });
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const vapidKey = await getVapidKey();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        });

        await fetch(`${API_BASE_URL}/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, subscription: subscription.toJSON() })
        });
      } catch {
        // Push subscription is best-effort — silently ignore errors
      }
    }

    void subscribe();
  }, [email]);

  return null;
}
