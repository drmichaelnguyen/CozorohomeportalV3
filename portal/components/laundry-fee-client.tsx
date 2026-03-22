"use client";

import { useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

type ClientRecord = Record<string, string>;

type LaundryBooking = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: string;
  end: string;
  htmlLink: string;
};

type LaundryMachineMeta = {
  label: string;
  price: number;
};

const machineByCalendarId: Record<string, LaundryMachineMeta> = {
  "p5cvikf3pn8292denaig3gmed0@group.calendar.google.com": {
    label: "D2 Washer",
    price: 7000
  },
  "iqido2c13cb85i2lsgq70qu59g@group.calendar.google.com": {
    label: "D7 Vertical Washer",
    price: 7000
  },
  "vmtcgatmh7irp19qsmrrbjsr34@group.calendar.google.com": {
    label: "D7 Whirlpool Washer",
    price: 7000
  },
  "029mijq7g3katbdhie206q4fk8@group.calendar.google.com": {
    label: "D7 Dryer",
    price: 7000
  }
};

function parsePaymentMethod(description: string) {
  const match = description.match(/Payment method:\s*(FREE_LAUNDRY|COINS|CASH)/i);
  return match?.[1]?.toUpperCase() ?? "UNKNOWN";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function getMonthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function LaundryFeeClient() {
  const { sessionEmail, login } = usePortalSession();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [bookings, setBookings] = useState<LaundryBooking[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("all");

  const activeEmail = sessionEmail.trim().toLowerCase();

  async function loadLaundryFeeData(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setClient(null);
    setBookings([]);

    try {
      const normalizedEmail = activeEmail;
      const [clientResponse, bookingsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/clients?email=${encodeURIComponent(normalizedEmail)}`),
        fetch(`${API_BASE_URL}/clients/laundry-bookings?email=${encodeURIComponent(normalizedEmail)}`)
      ]);

      const clientData = (await clientResponse.json()) as ClientRecord | { error?: string };
      const bookingData = (await bookingsResponse.json()) as
        | { bookings?: LaundryBooking[]; error?: string }
        | undefined;

      if (!clientResponse.ok) {
        setMessage(
          typeof clientData === "object" && clientData !== null && "error" in clientData && typeof clientData.error === "string"
            ? clientData.error
            : "Unable to load client information."
        );
        return;
      }

      if (!bookingsResponse.ok) {
        setMessage(bookingData?.error ?? "Unable to load laundry bookings.");
        return;
      }

      setClient(clientData as ClientRecord);
      setBookings((bookingData?.bookings ?? []).sort((left, right) => right.start.localeCompare(left.start)));
      login(normalizedEmail);
      setSelectedMonth("all");
      setMessage("Laundry billing loaded.");
    } catch {
      setMessage("Unable to load laundry billing right now.");
    } finally {
      setLoading(false);
    }
  }

  const monthOptions = useMemo(
    () =>
      Array.from(new Set(bookings.map((booking) => getMonthKey(booking.start)).filter(Boolean))).sort().reverse(),
    [bookings]
  );

  const decoratedBookings = useMemo(
    () =>
      bookings.map((booking) => {
        const machine = machineByCalendarId[booking.calendarId] ?? {
          label: booking.calendarSummary || "Unknown machine",
          price: 7000
        };
        const paymentMethod = parsePaymentMethod(booking.description);
        const durationMinutes = Math.max(
          0,
          Math.round((new Date(booking.end).getTime() - new Date(booking.start).getTime()) / 60000)
        );
        return {
          ...booking,
          machineLabel: machine.label,
          price: machine.price,
          paymentMethod,
          durationMinutes,
          monthKey: getMonthKey(booking.start)
        };
      }),
    [bookings]
  );

  const filteredBookings = useMemo(
    () => decoratedBookings.filter((booking) => selectedMonth === "all" || booking.monthKey === selectedMonth),
    [decoratedBookings, selectedMonth]
  );

  const monthlySummary = useMemo(() => {
    let totalBookings = 0;
    let totalMinutes = 0;
    let totalNominalCost = 0;
    let cashDue = 0;
    let coinPaidCost = 0;
    let freeLaundryCount = 0;

    for (const booking of filteredBookings) {
      totalBookings += 1;
      totalMinutes += booking.durationMinutes;
      totalNominalCost += booking.price;

      if (booking.paymentMethod === "CASH") {
        cashDue += booking.price;
      } else if (booking.paymentMethod === "COINS") {
        coinPaidCost += booking.price;
      } else if (booking.paymentMethod === "FREE_LAUNDRY") {
        freeLaundryCount += 1;
      }
    }

    return {
      totalBookings,
      totalMinutes,
      totalNominalCost,
      cashDue,
      coinPaidCost,
      freeLaundryCount
    };
  }, [filteredBookings]);

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-xl font-semibold text-slate-900">Laundry Fee</h2>
      <p className="mt-2 text-sm text-slate-600">
        Calculate the user&apos;s monthly laundry usage and how much laundry cost is due.
      </p>

      <form onSubmit={loadLaundryFeeData} className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={loading || !activeEmail}
          className="self-end rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Loading..." : "Load laundry billing"}
        </button>
      </form>

      {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}

      {client ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{client["Tên"] || client["Địa chỉ email"]}</div>
              <div className="mt-1 text-sm text-slate-600">{client["Chi nhánh Cozoro dorm"] || "-"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total bookings</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{monthlySummary.totalBookings}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total laundry time</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {Math.floor(monthlySummary.totalMinutes / 60)}h {monthlySummary.totalMinutes % 60}m
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Laundry fee due</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-900">
                {formatCurrency(monthlySummary.cashDue)} VND
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nominal total cost</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">
                {formatCurrency(monthlySummary.totalNominalCost)} VND
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paid by cash</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">
                {formatCurrency(monthlySummary.cashDue)} VND
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paid by coins</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">
                {formatCurrency(monthlySummary.coinPaidCost)} coins value
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Free laundry uses</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{monthlySummary.freeLaundryCount}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-sm font-medium text-slate-700">
              Month
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">All months</option>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            {filteredBookings.length === 0 ? (
              <p className="text-sm text-slate-600">No laundry bookings found for this selection.</p>
            ) : (
              filteredBookings.map((booking) => (
                <div key={booking.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{booking.machineLabel}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {formatDateTime(booking.start)} to {formatDateTime(booking.end)}
                      </div>
                    </div>
                    <div className="text-right text-sm text-slate-700">
                      <div>{formatCurrency(booking.price)} VND</div>
                      <div className="mt-1 text-slate-500">{booking.paymentMethod}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
