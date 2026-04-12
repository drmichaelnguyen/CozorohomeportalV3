"use client";

import { useEffect, useRef } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

const POLL_MS = 10000;
const SOUND_PREF_KEY = "chat_sound_enabled";
const LAST_SEEN_KEY_PREFIX = "chat_last_seen_";

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available
  }
}

function showBrowserNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: "chat-message" });
    setTimeout(() => n.close(), 5000);
  } catch {
    // ignore
  }
}

function getLastSeen(groupId: string): string | null {
  try { return localStorage.getItem(LAST_SEEN_KEY_PREFIX + groupId); } catch { return null; }
}

function setLastSeen(groupId: string, messageId: string) {
  try { localStorage.setItem(LAST_SEEN_KEY_PREFIX + groupId, messageId); } catch {}
}

function isSoundEnabled(): boolean {
  try {
    const v = localStorage.getItem(SOUND_PREF_KEY);
    return v === null ? true : v === "true";
  } catch { return true; }
}

export function ChatNotifier() {
  const { sessionEmail, sessionRole, isLoggedIn } = usePortalSession();
  const groupContextRef = useRef<{ groupIds: Record<string, string> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Staff accounts (manager/owner/app_admin/mechanic) are not residents — skip group chat polling
    const isStaff = sessionRole === "manager" || sessionRole === "owner" || sessionRole === "app_admin" || sessionRole === "mechanic";
    if (!isLoggedIn || !sessionEmail.trim() || isStaff) return;

    const email = sessionEmail.trim().toLowerCase();

    // Request browser notification permission
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    async function loadGroupContext() {
      if (groupContextRef.current) return;
      try {
        const res = await fetch(`${API_BASE_URL}/support/group-context?email=${encodeURIComponent(email)}`);
        if (res.ok) groupContextRef.current = await res.json();
      } catch {}
    }

    async function pollGroups() {
      await loadGroupContext();
      const ctx = groupContextRef.current;
      if (!ctx) return;

      for (const groupId of Object.values(ctx.groupIds)) {
        try {
          const res = await fetch(
            `${API_BASE_URL}/support/group-messages?groupId=${encodeURIComponent(groupId)}&email=${encodeURIComponent(email)}`
          );
          if (!res.ok) continue;
          const data = (await res.json()) as { messages?: { id: string; senderEmail: string; senderName: string | null; body: string; isAnonymous?: boolean; createdAt: string }[] };
          const messages = data.messages ?? [];
          if (messages.length === 0) continue;

          const lastSeenId = getLastSeen(groupId);
          const latestId = messages[messages.length - 1]!.id;

          if (lastSeenId === null) {
            // First time — just record current state, don't notify
            setLastSeen(groupId, latestId);
            continue;
          }

          if (latestId === lastSeenId) continue;

          // Find messages after lastSeen that are from others
          const lastSeenIndex = messages.findIndex(m => m.id === lastSeenId);
          const newMsgs = (lastSeenIndex === -1 ? messages : messages.slice(lastSeenIndex + 1))
            .filter(m => m.senderEmail !== email);

          if (newMsgs.length > 0) {
            const latest = newMsgs[newMsgs.length - 1]!;
            const sender = latest.isAnonymous ? "Anonymous" : (latest.senderName || "Neighbor");
            if (isSoundEnabled()) playNotificationSound();
            showBrowserNotification(sender, latest.body);
            window.dispatchEvent(new Event("new-group-message"));
          }

          setLastSeen(groupId, latestId);
        } catch {}
      }
    }

    void pollGroups();
    timerRef.current = setInterval(() => void pollGroups(), POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLoggedIn, sessionEmail]);

  return null;
}
