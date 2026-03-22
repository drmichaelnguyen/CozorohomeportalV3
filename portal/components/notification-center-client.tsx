"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

type ResidentNotification = {
  id: string;
  type: "SUPPORT_REPLY" | "PAYMENT_DUE" | "NEW_FINE" | "LAUNDRY_REMINDER" | "CLEANING_REMINDER";
  conversationId?: string;
  title: string;
  body: string;
  createdAt: string;
  unreadCount: number;
  href: string;
};

type StaffNotification = {
  id: string;
  type: "SUPPORT_REQUEST";
  conversationId: string;
  residentEmail: string;
  residentName: string | null;
  title: string;
  body: string;
  createdAt: string;
  unreadCount: number;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function NotificationCenterClient() {
  const { sessionEmail, sessionRole } = usePortalSession();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [residentNotifications, setResidentNotifications] = useState<ResidentNotification[]>([]);
  const [staffNotifications, setStaffNotifications] = useState<StaffNotification[]>([]);
  const normalizedEmail = sessionEmail.trim().toLowerCase();
  const isAdminSession = Boolean(sessionRole && sessionRole !== "user");

  useEffect(() => {
    async function loadNotifications() {
      if (!normalizedEmail) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setStatus("");

      try {
        const url = isAdminSession
          ? `${API_BASE_URL}/manager/support/notifications?operatorEmail=${encodeURIComponent(normalizedEmail)}`
          : `${API_BASE_URL}/support/notifications?email=${encodeURIComponent(normalizedEmail)}`;
        const response = await fetch(url);
        const data = (await response.json()) as {
          notifications?: ResidentNotification[] | StaffNotification[];
          error?: string;
        };

        if (!response.ok) {
          setStatus(data.error ?? "Unable to load notifications.");
          return;
        }

        if (isAdminSession) {
          setStaffNotifications((data.notifications as StaffNotification[] | undefined) ?? []);
        } else {
          setResidentNotifications((data.notifications as ResidentNotification[] | undefined) ?? []);
        }
      } catch {
        setStatus("Unable to load notifications.");
      } finally {
        setLoading(false);
      }
    }

    void loadNotifications();
  }, [isAdminSession, normalizedEmail]);

  const notifications = isAdminSession ? staffNotifications : residentNotifications;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Notification Center</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isAdminSession
            ? "See which residents have unread support requests for your Cozoro team."
            : "See support replies plus reminders for payment, fines, laundry, and cleaning schedules."}
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? <p className="text-sm text-slate-600">Loading notifications...</p> : null}
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
        {!loading && notifications.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">You are all caught up.</div>
        ) : null}

        {!loading && notifications.length > 0 ? (
          <div className="space-y-3">
            {notifications.map((notification) => {
              const href = isAdminSession ? "/manager" : (notification as ResidentNotification).href || "/support";
              return (
                <Link
                  key={notification.id}
                  href={href}
                  className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-sky-200 hover:bg-white"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{notification.title}</div>
                      <p className="mt-2 text-sm text-slate-600">{notification.body}</p>
                    </div>
                    <div className="text-right">
                      <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        {notification.unreadCount} unread
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{formatDateTime(notification.createdAt)}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
