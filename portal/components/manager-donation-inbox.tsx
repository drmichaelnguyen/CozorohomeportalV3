"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type DonationStatus = "PENDING" | "APPROVED" | "REJECTED";
type TermType = "SHORT_TERM" | "LONG_TERM";

type DonationCoupon = {
  id: string;
  code: string;
  termType: TermType;
  status: "ISSUED" | "REDEEMED";
  redeemedAt: string | null;
  redeemedByEmail: string | null;
  redemptionRef: string | null;
  discountVnd: number | null;
};

type DonationFollowUp = {
  id: string;
  kind: "PRE_EVENT" | "POST_EVENT";
  scheduledFor: string;
  status: "SCHEDULED" | "SENT" | "SKIPPED" | "FAILED";
  sentAt: string | null;
  lastError: string | null;
  attempts: number;
};

type DonationRequest = {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  donationType: "CASH" | "IN_KIND";
  donationDetail: string;
  eventName: string | null;
  eventDetails: string | null;
  eventDate: string | null;
  socialPlatform: string | null;
  socialHandle: string | null;
  socialLink: string | null;
  returnOffer: string;
  status: DonationStatus;
  rejectNote: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  couponCount: number | null;
  termType: TermType | null;
  couponEmailSentAt: string | null;
  couponEmailError: string | null;
  createdAt: string;
  coupons: DonationCoupon[];
  followUps: DonationFollowUp[];
};

const copy = {
  en: {
    title: "Donation partnerships",
    desc: "Requests from cozorohome.com/donate. Approving emails stay coupons and schedules reminders 3 days before and 10 days after the event.",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    all: "All",
    empty: "No donation requests in this list.",
    refresh: "Refresh",
    contact: "Contact",
    donation: "Donation",
    event: "Event",
    social: "Social",
    offer: "What they will post",
    coupons: "Coupons",
    followUps: "Follow-up emails",
    count: "How many coupons",
    short: "Short-term (one free night each)",
    long: "Long-term (one month of rent each)",
    approve: "Approve and email codes",
    reject: "Reject",
    note: "Note to keep on file (optional)",
    eventDate: "Event date",
    saveDate: "Save event date",
    resend: "Resend coupon email",
    needDate: "An event date is required so the reminders can be scheduled.",
    emailSent: "Coupon email sent.",
    emailFailed: "Approved, but the coupon email did not send.",
    issued: "Issued",
    redeemed: "Redeemed",
    pre: "3 days before",
    post: "10 days after"
  },
  vi: {
    title: "Hợp tác quyên góp",
    desc: "Yêu cầu từ cozorohome.com/donate. Khi duyệt, hệ thống gửi mã lưu trú và hẹn email nhắc 3 ngày trước cùng 10 ngày sau sự kiện.",
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Từ chối",
    all: "Tất cả",
    empty: "Không có yêu cầu trong danh sách này.",
    refresh: "Làm mới",
    contact: "Liên hệ",
    donation: "Quyên góp",
    event: "Sự kiện",
    social: "Mạng xã hội",
    offer: "Nội dung họ sẽ đăng",
    coupons: "Mã ưu đãi",
    followUps: "Email nhắc",
    count: "Số mã",
    short: "Ngắn hạn (mỗi mã miễn một đêm)",
    long: "Dài hạn (mỗi mã miễn một tháng tiền phòng)",
    approve: "Duyệt và gửi mã",
    reject: "Từ chối",
    note: "Ghi chú lưu lại (không bắt buộc)",
    eventDate: "Ngày sự kiện",
    saveDate: "Lưu ngày sự kiện",
    resend: "Gửi lại email mã",
    needDate: "Cần ngày sự kiện để hẹn email nhắc.",
    emailSent: "Đã gửi email mã.",
    emailFailed: "Đã duyệt, nhưng email mã chưa gửi được.",
    issued: "Chưa dùng",
    redeemed: "Đã dùng",
    pre: "Trước 3 ngày",
    post: "Sau 10 ngày"
  }
} as const;

function formatWhen(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ManagerDonationInbox({
  operatorEmail,
  enabled
}: {
  operatorEmail: string;
  enabled: boolean;
}) {
  const { language } = usePortalLanguage();
  const t = language === "vi" ? copy.vi : copy.en;
  const [items, setItems] = useState<DonationRequest[]>([]);
  const [filter, setFilter] = useState<DonationStatus | "ALL">("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [couponCount, setCouponCount] = useState(1);
  const [termType, setTermType] = useState<TermType>("SHORT_TERM");
  const [eventDate, setEventDate] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const loadList = useCallback(async () => {
    if (!enabled || !operatorEmail) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/donations?operatorEmail=${encodeURIComponent(operatorEmail)}`
      );
      const data = (await response.json()) as { requests?: DonationRequest[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to load");
      setItems(data.requests ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enabled, operatorEmail]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const visible = useMemo(
    () => (filter === "ALL" ? items : items.filter((item) => item.status === filter)),
    [filter, items]
  );
  const selected = items.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setEventDate(selected.eventDate ?? "");
    setCouponCount(selected.couponCount && selected.couponCount > 0 ? selected.couponCount : 1);
    setTermType(selected.termType ?? "SHORT_TERM");
    setRejectNote(selected.rejectNote ?? "");
  }, [selected?.id]);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorEmail, ...body })
      });
      const data = (await response.json()) as {
        error?: string;
        emailSent?: boolean;
        emailError?: string | null;
        request?: DonationRequest;
      };
      if (!response.ok) throw new Error(data.error || "Request failed");
      if (data.request) {
        setItems((current) => current.map((item) => (item.id === data.request?.id ? data.request : item)));
        setSelectedId(data.request.id);
      } else {
        await loadList();
      }
      if (data.emailSent === true) setNotice(t.emailSent);
      if (data.emailSent === false) setNotice(`${t.emailFailed} ${data.emailError ?? ""}`.trim());
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const filters: Array<{ id: DonationStatus | "ALL"; label: string }> = [
    { id: "PENDING", label: t.pending },
    { id: "APPROVED", label: t.approved },
    { id: "REJECTED", label: t.rejected },
    { id: "ALL", label: t.all }
  ];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.desc}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
        >
          {t.refresh}
        </button>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto">
        {filters.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === entry.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="max-h-[32rem] space-y-2 overflow-y-auto">
          {visible.length ? (
            visible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left ${
                  selected?.id === item.id ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{item.name}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.status}</span>
                </div>
                <div className="mt-1 text-xs text-slate-600">{item.email}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.donationType === "CASH" ? "Cash" : "In-kind"}
                  {item.eventDate ? ` · ${item.eventDate}` : ""}
                </div>
              </button>
            ))
          ) : (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{loading ? "…" : t.empty}</p>
          )}
        </div>

        {selected ? (
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{selected.name}</h3>
              <p className="text-sm text-slate-600">{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p>
            </div>
            <Field label={t.donation} value={`${selected.donationType === "CASH" ? "Cash" : "In-kind"}\n${selected.donationDetail}`} />
            <Field
              label={t.event}
              value={[selected.eventName, selected.eventDate, selected.eventDetails].filter(Boolean).join("\n") || "—"}
            />
            <Field
              label={t.social}
              value={[selected.socialPlatform, selected.socialHandle, selected.socialLink].filter(Boolean).join("\n") || "—"}
            />
            <Field label={t.offer} value={selected.returnOffer} />

            <label className="block text-sm">
              <span className="font-medium text-slate-700">{t.eventDate}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
                <button
                  type="button"
                  disabled={busy || !eventDate}
                  onClick={() => void post(`/manager/donations/${selected.id}/event-date`, { eventDate })}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t.saveDate}
                </button>
              </div>
            </label>

            {selected.status === "PENDING" ? (
              <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">{t.count}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={couponCount}
                    onChange={(event) => setCouponCount(Number(event.target.value))}
                    className="mt-1 w-24 rounded-xl border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={termType === "SHORT_TERM"} onChange={() => setTermType("SHORT_TERM")} />
                    {t.short}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={termType === "LONG_TERM"} onChange={() => setTermType("LONG_TERM")} />
                    {t.long}
                  </label>
                </div>
                {!eventDate ? <p className="text-xs text-amber-700">{t.needDate}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !eventDate || couponCount < 1}
                    onClick={() =>
                      void post(`/manager/donations/${selected.id}/approve`, {
                        couponCount,
                        termType,
                        eventDate
                      })
                    }
                    className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {t.approve}
                  </button>
                </div>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">{t.note}</span>
                  <textarea
                    value={rejectNote}
                    onChange={(event) => setRejectNote(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    rows={2}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post(`/manager/donations/${selected.id}/reject`, { note: rejectNote })}
                  className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                >
                  {t.reject}
                </button>
              </div>
            ) : null}

            {selected.status === "REJECTED" && selected.rejectNote ? (
              <Field label={t.note} value={selected.rejectNote} />
            ) : null}

            {selected.coupons.length ? (
              <div>
                <h4 className="text-sm font-semibold text-slate-900">{t.coupons}</h4>
                <ul className="mt-2 space-y-2 text-sm">
                  {selected.coupons.map((coupon) => (
                    <li key={coupon.id} className="rounded-xl border border-slate-200 px-3 py-2">
                      <span className="font-mono font-semibold">{coupon.code}</span>
                      <span className="ml-2 text-xs uppercase text-slate-500">
                        {coupon.status === "REDEEMED" ? t.redeemed : t.issued}
                      </span>
                      <div className="text-xs text-slate-600">
                        {coupon.termType === "SHORT_TERM" ? t.short : t.long}
                        {coupon.discountVnd ? ` · ${coupon.discountVnd.toLocaleString("vi-VN")}₫` : ""}
                        {coupon.redeemedByEmail ? ` · ${coupon.redeemedByEmail}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post(`/manager/donations/${selected.id}/resend-coupon-email`, {})}
                  className="mt-2 rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t.resend}
                </button>
                {selected.couponEmailError ? (
                  <p className="mt-2 text-xs text-rose-700">{selected.couponEmailError}</p>
                ) : null}
              </div>
            ) : null}

            {selected.followUps.length ? (
              <div>
                <h4 className="text-sm font-semibold text-slate-900">{t.followUps}</h4>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {selected.followUps.map((followUp) => (
                    <li key={followUp.id} className="rounded-xl bg-slate-50 px-3 py-2">
                      <span className="font-medium">{followUp.kind === "PRE_EVENT" ? t.pre : t.post}</span>
                      <span className="ml-2 text-xs uppercase text-slate-500">{followUp.status}</span>
                      <div className="text-xs text-slate-600">
                        {formatWhen(followUp.scheduledFor)}
                        {followUp.sentAt ? ` · sent ${formatWhen(followUp.sentAt)}` : ""}
                        {followUp.lastError ? ` · ${followUp.lastError}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{value}</p>
    </div>
  );
}
