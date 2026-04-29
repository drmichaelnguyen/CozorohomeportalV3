"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePortalSession } from "./portal-session";
import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDateTime } from "../lib/date-format";

type LaundryBooking = {
  id: string;
  calendarSummary: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  status: string;
};

export function NextLaundryPreviewClient() {
  const { sessionEmail, login } = usePortalSession();
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<LaundryBooking[]>([]);
  const activeEmail = sessionEmail.trim().toLowerCase();

  const nextBooking = useMemo(
    () =>
      [...bookings]
        .filter((booking) => new Date(booking.end).getTime() >= Date.now())
        .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())[0] ?? null,
    [bookings]
  );

  async function loadBookings() {
    if (!activeEmail) return;

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`);
      const data = (await response.json()) as { bookings?: LaundryBooking[]; error?: string };
      if (response.ok) {
        setBookings(data.bookings ?? []);
        login(activeEmail);
      }
    } catch {
      // silently fail — empty state is shown
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!activeEmail) {
      return;
    }
    void loadBookings();
  }, [activeEmail]);

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Next Laundry</h2>
        <Link
          href="/service/laundry"
          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900"
        >
          Book / manage
        </Link>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="text-sm text-slate-500">Loading...</div>
        ) : !nextBooking ? (
          <div className="text-sm text-slate-500">No upcoming laundry booking.</div>
        ) : (
          <Link
            href="/service/laundry"
            className="block rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-sky-200 hover:bg-sky-50"
          >
            <div className="font-medium text-slate-900">{nextBooking.summary || nextBooking.calendarSummary}</div>
            <div className="mt-1 text-sm text-slate-600">
              {formatCozoroDateTime(nextBooking.start)} – {formatCozoroDateTime(nextBooking.end)}
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
