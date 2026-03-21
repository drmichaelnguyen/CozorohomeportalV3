"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePortalSession } from "./portal-session";
import { API_BASE_URL } from "../lib/api-base-url";

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
  const [message, setMessage] = useState("");
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
    if (!activeEmail) {
      setMessage("Sign in first to view the next laundry booking.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(activeEmail)}`);
      const data = (await response.json()) as { bookings?: LaundryBooking[]; error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Unable to load laundry bookings.");
        return;
      }

      setBookings(data.bookings ?? []);
      login(activeEmail);
      setMessage(data.bookings?.length ? "" : "No laundry bookings found yet.");
    } catch {
      setMessage("Unable to load laundry bookings.");
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Next Laundry</h2>
          <p className="mt-1 text-sm text-slate-600">
            View your next laundry booking here, then open the laundry tab for full details.
          </p>
        </div>
        <Link
          href="/service/laundry"
          className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900"
        >
          Open laundry tab
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void loadBookings()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
        >
          {loading ? "Loading..." : "Load next laundry"}
        </button>
      </div>

      {activeEmail ? <p className="mt-3 text-xs text-slate-500">Viewing bookings for {activeEmail}</p> : null}
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}

      <div className="mt-4">
        {!nextBooking ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No upcoming laundry booking is scheduled.
          </div>
        ) : (
          <Link
            href="/service/laundry"
            className="block rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-sky-200 hover:bg-sky-50"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-sky-700">Upcoming booking</div>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {nextBooking.summary || nextBooking.calendarSummary}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {new Date(nextBooking.start).toLocaleString()} to {new Date(nextBooking.end).toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-slate-500">Status: {nextBooking.status}</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                View in laundry tab
              </span>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
