"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDateTime } from "../lib/date-format";
import { usePortalLanguage } from "./portal-language";

type DeductionLine = {
  labelVi: string;
  labelEn: string;
  amountVnd: number;
};

type CheckoutFinancial = {
  depositVnd: number;
  unpaidFinesVnd: number;
  unpaidGateVnd: number;
  suggestedRefundVnd: number;
  unpaidFineLines?: DeductionLine[];
  unpaidGateLines?: DeductionLine[];
};

type CheckoutReviewCase = {
  id: string;
  status: "pending" | "archived";
  source: "termination" | "contract_due" | "resident";
  email: string;
  maHd: string;
  name: string;
  branch: string;
  bed: string;
  submittedAt: string;
  deactivateAt: string;
  deactivatedAt?: string;
  steps: {
    luggage: boolean;
    bedding: boolean;
    keys: boolean;
    photoNote: string;
    optionalStepPhotos?: Record<string, string[]>;
  };
  detailsAvailable: boolean;
  photos: string[];
  reviewedAt?: string;
  reviewedBy?: string;
  refundAmountVnd?: number;
  refundEmailSentAt?: string;
  refundEmailSentTo?: string;
  awaitingRedo: boolean;
  compensationAmountVnd: number;
  revisionNumber: number;
  reviewNotices: Array<{
    action: "redo_checkout" | "compensation";
    message: string;
    compensationAmountVnd?: number;
    sentAt: string;
    sentBy: string;
    emailSentTo: string;
  }>;
  financial: CheckoutFinancial | null;
  financialError?: string;
};

type CheckoutReviewPayload = {
  pending?: CheckoutReviewCase[];
  archived?: CheckoutReviewCase[];
  error?: string;
};

function formatVnd(value: number) {
  return `${Math.max(0, Math.round(value)).toLocaleString("vi-VN")} ₫`;
}

function checkoutPhotoUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${API_BASE_URL}/checkout-photo/${encodeURIComponent(trimmed)}`;
}

export function CheckoutReviewClient({
  actorEmail,
  canApprove
}: {
  actorEmail: string;
  canApprove: boolean;
}) {
  const { language } = usePortalLanguage();
  const isVi = language === "vi";
  const [payload, setPayload] = useState<CheckoutReviewPayload>({ pending: [], archived: [] });
  const [queue, setQueue] = useState<"pending" | "archived">("pending");
  const [selectedId, setSelectedId] = useState("");
  const [refundInput, setRefundInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [sendingNotice, setSendingNotice] = useState(false);
  const [noticeAction, setNoticeAction] = useState<"redo_checkout" | "compensation">("redo_checkout");
  const [ownerFindings, setOwnerFindings] = useState("");
  const [compensationInput, setCompensationInput] = useState("");
  const [message, setMessage] = useState("");

  async function loadReviews(preferredId?: string, preferredQueue: "pending" | "archived" = queue) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/checkout-reviews?actorEmail=${encodeURIComponent(actorEmail)}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as CheckoutReviewPayload;
      if (!response.ok) throw new Error(data.error ?? "Unable to load check-out reviews.");
      setPayload({ pending: data.pending ?? [], archived: data.archived ?? [] });
      const nextCases = preferredQueue === "pending" ? data.pending ?? [] : data.archived ?? [];
      const nextSelected = preferredId && nextCases.some((entry) => entry.id === preferredId)
        ? preferredId
        : nextCases.some((entry) => entry.id === selectedId)
          ? selectedId
          : nextCases[0]?.id ?? "";
      setSelectedId(nextSelected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load check-out reviews.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorEmail]);

  const cases = queue === "pending" ? payload.pending ?? [] : payload.archived ?? [];
  const selected = cases.find((entry) => entry.id === selectedId) ?? cases[0] ?? null;

  useEffect(() => {
    const nextCases = queue === "pending" ? payload.pending ?? [] : payload.archived ?? [];
    const next = nextCases.find((entry) => entry.id === selectedId) ?? nextCases[0] ?? null;
    setSelectedId(next?.id ?? "");
    setRefundInput(
      next
        ? String(
            next.refundAmountVnd ?? Math.max(
              0,
              (next.financial?.suggestedRefundVnd ?? 0) - (next.compensationAmountVnd ?? 0)
            )
          )
        : ""
    );
    setCompensationInput(next?.compensationAmountVnd ? String(next.compensationAmountVnd) : "");
    setOwnerFindings("");
  }, [queue, payload, selectedId]);

  const photos = useMemo(() => {
    if (!selected) return [];
    return Array.from(
      new Set([
        ...Object.values(selected.steps.optionalStepPhotos ?? {}).flat(),
        ...(selected.photos ?? [])
      ].map((entry) => entry.trim()).filter(Boolean))
    );
  }, [selected]);

  async function approveSelected() {
    if (!selected || !selected.financial) return;
    if (selected.awaitingRedo) {
      setMessage(isVi ? "Cư dân phải gửi lại check-out trước khi duyệt." : "The resident must resubmit before approval.");
      return;
    }
    const refundAmountVnd = Number.parseInt(refundInput.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(refundAmountVnd) || refundAmountVnd < 0) {
      setMessage(isVi ? "Vui lòng nhập số tiền hoàn cọc hợp lệ." : "Enter a valid refund amount.");
      return;
    }
    if (refundAmountVnd > selected.financial.depositVnd) {
      setMessage(isVi ? "Số tiền hoàn không được vượt quá tiền cọc." : "Refund cannot exceed the deposit.");
      return;
    }
    const confirmed = window.confirm(
      isVi
        ? `Duyệt check-out của ${selected.name}?\n\nHoàn cọc: ${formatVnd(refundAmountVnd)}\nEmail chi tiết hoàn cọc sẽ được gửi ngay đến ${selected.email}.`
        : `Approve ${selected.name}'s check-out?\n\nDeposit refund: ${formatVnd(refundAmountVnd)}\nThe refund breakdown email will be sent immediately to ${selected.email}.`
    );
    if (!confirmed) return;

    setApproving(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/checkout-reviews/${encodeURIComponent(selected.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorEmail, refundAmountVnd })
        }
      );
      const data = (await response.json()) as { error?: string; emailSentTo?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to approve check-out.");
      setQueue("archived");
      await loadReviews(selected.id, "archived");
      setMessage(
        isVi
          ? `Đã duyệt, lưu trữ hồ sơ và gửi email hoàn cọc đến ${data.emailSentTo ?? selected.email}.`
          : `Approved, archived, and sent the refund email to ${data.emailSentTo ?? selected.email}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve check-out.");
    } finally {
      setApproving(false);
    }
  }

  async function sendReviewNotice() {
    if (!selected || !canApprove) return;
    const findings = ownerFindings.trim();
    if (findings.length < 10) {
      setMessage(isVi ? "Vui lòng nhập mô tả phát hiện ít nhất 10 ký tự." : "Enter at least 10 characters describing the findings.");
      return;
    }
    const compensationAmountVnd = Number.parseInt(compensationInput.replace(/[^0-9]/g, ""), 10) || 0;
    if (noticeAction === "compensation" && compensationAmountVnd <= 0) {
      setMessage(isVi ? "Vui lòng nhập số tiền bồi thường lớn hơn 0." : "Enter a compensation amount greater than zero.");
      return;
    }
    if (selected.financial && compensationAmountVnd > selected.financial.depositVnd) {
      setMessage(isVi ? "Khoản bồi thường không được vượt quá tiền cọc." : "Compensation cannot exceed the deposit on file.");
      return;
    }
    const confirmed = window.confirm(
      noticeAction === "redo_checkout"
        ? (isVi
            ? `Gửi yêu cầu ${selected.name} thực hiện lại check-out? Biểu mẫu sẽ được mở lại và email cảnh báo sẽ gửi ngay.`
            : `Ask ${selected.name} to redo check-out? The form will reopen and a warning email will be sent immediately.`)
        : (isVi
            ? `Gửi yêu cầu bồi thường ${formatVnd(compensationAmountVnd)} đến ${selected.email}? Hồ sơ vẫn ở trạng thái chờ duyệt.`
            : `Send a ${formatVnd(compensationAmountVnd)} compensation request to ${selected.email}? The case will remain pending.`)
    );
    if (!confirmed) return;

    setSendingNotice(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/checkout-reviews/${encodeURIComponent(selected.id)}/notice`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail,
            action: noticeAction,
            message: findings,
            compensationAmountVnd: noticeAction === "compensation" ? compensationAmountVnd : undefined
          })
        }
      );
      const data = (await response.json()) as { error?: string; emailSentTo?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to send review notice.");
      await loadReviews(selected.id, "pending");
      setOwnerFindings("");
      setMessage(
        noticeAction === "redo_checkout"
          ? (isVi
              ? `Đã gửi yêu cầu làm lại đến ${data.emailSentTo ?? selected.email}; biểu mẫu check-out đã được mở lại.`
              : `Redo request sent to ${data.emailSentTo ?? selected.email}; the check-out form is open again.`)
          : (isVi
              ? `Đã gửi cảnh báo bồi thường đến ${data.emailSentTo ?? selected.email}.`
              : `Compensation warning sent to ${data.emailSentTo ?? selected.email}.`)
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send review notice.");
    } finally {
      setSendingNotice(false);
    }
  }

  const sourceLabel = (source: CheckoutReviewCase["source"]) => {
    if (source === "termination") return isVi ? "Chấm dứt hợp đồng" : "Contract termination";
    if (source === "contract_due") return isVi ? "Hết hạn hợp đồng" : "Contract due";
    return isVi ? "Cư dân tự check-out" : "Resident check-out";
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isVi ? "Duyệt hồ sơ check-out" : "Check-out review"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {isVi
                ? "Kiểm tra biểu mẫu, hình ảnh, khoản phí/phạt còn lại và gửi thông báo hoàn cọc."
                : "Review forms, photos, remaining fees/fines, and send the deposit-refund notice."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadReviews()}
            disabled={loading}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {loading ? (isVi ? "Đang tải…" : "Loading…") : (isVi ? "Làm mới" : "Refresh")}
          </button>
        </div>
        <div className="mt-4 flex gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setQueue("pending")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${queue === "pending" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"}`}
          >
            {isVi ? "Chờ duyệt" : "Pending"} ({payload.pending?.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setQueue("archived")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${queue === "archived" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500"}`}
          >
            {isVi ? "Đã lưu trữ" : "Archived"} ({payload.archived?.length ?? 0})
          </button>
        </div>
        {message ? <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</p> : null}
      </section>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {isVi ? "Đang tải hồ sơ…" : "Loading check-out cases…"}
        </div>
      ) : cases.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {queue === "pending"
            ? (isVi ? "Không có hồ sơ check-out đang chờ duyệt." : "No check-out cases are waiting for approval.")
            : (isVi ? "Chưa có hồ sơ đã lưu trữ." : "No archived check-out cases yet.")}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.55fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            {cases.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setSelectedId(entry.id);
                  setRefundInput(String(
                    entry.refundAmountVnd ?? Math.max(
                      0,
                      (entry.financial?.suggestedRefundVnd ?? 0) - (entry.compensationAmountVnd ?? 0)
                    )
                  ));
                }}
                className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === entry.id ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900">{entry.name || entry.email}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${entry.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {entry.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{entry.branch || "—"} · {isVi ? "Giường" : "Bed"} {entry.bed || "—"}</div>
                <div className="mt-1 text-xs text-slate-500">{formatCozoroDateTime(entry.submittedAt)}</div>
                <div className="mt-2 text-xs font-medium text-sky-700">{sourceLabel(entry.source)}</div>
                {entry.awaitingRedo ? (
                  <div className="mt-2 rounded-lg bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">
                    {isVi ? "Đang chờ cư dân làm lại" : "Waiting for resubmission"}
                  </div>
                ) : entry.reviewNotices.length > 0 ? (
                  <div className="mt-2 text-xs font-medium text-violet-700">
                    {isVi ? `${entry.reviewNotices.length} thông báo đã gửi` : `${entry.reviewNotices.length} notice(s) sent`}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selected.name || selected.email}</h3>
                  <p className="text-sm text-slate-600">{selected.email}</p>
                  <p className="mt-1 text-xs text-slate-500">{selected.maHd} · {selected.branch || "—"} · {isVi ? "Giường" : "Bed"} {selected.bed || "—"}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>{isVi ? "Gửi lúc" : "Submitted"}: {formatCozoroDateTime(selected.submittedAt)}</div>
                  <div className="mt-1">{sourceLabel(selected.source)}</div>
                  <div className="mt-1">{isVi ? "Lần gửi" : "Submission"}: {selected.revisionNumber}</div>
                </div>
              </div>

              {selected.awaitingRedo ? (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
                  <div className="font-bold">{isVi ? "Đang chờ cư dân gửi lại check-out" : "Waiting for resident resubmission"}</div>
                  <p className="mt-1">{isVi ? "Không thể duyệt hoàn cọc cho đến khi cư dân hoàn tất biểu mẫu mới." : "Refund approval is locked until the resident completes a new form."}</p>
                </div>
              ) : null}

              <section>
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">{isVi ? "Nội dung biểu mẫu" : "Submitted checklist"}</h4>
                {selected.detailsAvailable ? (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {[
                        [isVi ? "Hành lý" : "Luggage", selected.steps.luggage],
                        [isVi ? "Chăn ga" : "Bedding", selected.steps.bedding],
                        [isVi ? "Chìa khóa" : "Keys", selected.steps.keys]
                      ].map(([label, checked]) => (
                        <div key={String(label)} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${checked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                          {checked ? "✓" : "✕"} {label}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                      <span className="font-semibold">{isVi ? "Ghi chú" : "Note"}: </span>
                      {selected.steps.photoNote?.trim() || "—"}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {isVi
                      ? "Hồ sơ cũ không lưu chi tiết ô đánh dấu; hình ảnh đã tải lên vẫn được hiển thị bên dưới."
                      : "This legacy submission did not retain checklist values; uploaded photos are still shown below."}
                  </p>
                )}
              </section>

              <section>
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  {isVi ? "Hình ảnh" : "Photos"} ({photos.length})
                </h4>
                {photos.length > 0 ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                    {photos.map((photo) => (
                      <a key={photo} href={checkoutPhotoUrl(photo)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={checkoutPhotoUrl(photo)} alt="Check-out evidence" className="h-44 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-slate-500">{isVi ? "Không có hình ảnh." : "No photos attached."}</p>}
              </section>

              <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 sm:p-5">
                <h4 className="text-sm font-bold uppercase tracking-wide text-violet-900">
                  {isVi ? "Kết quả kiểm tra của Owner" : "Owner inspection and follow-up"}
                </h4>
                <p className="mt-1 text-sm text-violet-800">
                  {isVi
                    ? "Ghi chi tiết tình trạng thực tế, hư hỏng, đồ thất lạc hoặc phần hồ sơ chưa đạt. Nội dung gửi sẽ được lưu vào lịch sử."
                    : "Record the actual condition, damage, missing items, or incomplete evidence. Sent messages are retained in the case history."}
                </p>

                {selected.reviewNotices.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {[...selected.reviewNotices].reverse().map((notice, index) => (
                      <div key={`${notice.sentAt}-${index}`} className="rounded-xl border border-violet-100 bg-white p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${notice.action === "redo_checkout" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                            {notice.action === "redo_checkout"
                              ? (isVi ? "Yêu cầu làm lại" : "Redo requested")
                              : (isVi ? "Yêu cầu bồi thường" : "Compensation requested")}
                          </span>
                          <span className="text-xs text-slate-500">{formatCozoroDateTime(notice.sentAt)}</span>
                        </div>
                        {notice.compensationAmountVnd ? (
                          <div className="mt-2 font-bold text-rose-700">{formatVnd(notice.compensationAmountVnd)}</div>
                        ) : null}
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-700">{notice.message}</p>
                        <div className="mt-2 text-xs text-slate-500">
                          {notice.sentBy} → {notice.emailSentTo}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-violet-700">{isVi ? "Chưa gửi phản hồi nào cho cư dân." : "No resident follow-up has been sent."}</p>
                )}

                {selected.status === "pending" && canApprove ? (
                  <div className="mt-5 border-t border-violet-200 pt-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setNoticeAction("redo_checkout")}
                        className={`rounded-xl border p-4 text-left ${noticeAction === "redo_checkout" ? "border-rose-400 bg-rose-50 ring-2 ring-rose-100" : "border-slate-200 bg-white"}`}
                      >
                        <div className="font-bold text-slate-900">{isVi ? "Yêu cầu làm lại check-out" : "Request check-out redo"}</div>
                        <div className="mt-1 text-xs text-slate-600">{isVi ? "Mở lại biểu mẫu và chờ hình ảnh/thông tin mới." : "Reopen the form and wait for new details and photos."}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoticeAction("compensation")}
                        className={`rounded-xl border p-4 text-left ${noticeAction === "compensation" ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : "border-slate-200 bg-white"}`}
                      >
                        <div className="font-bold text-slate-900">{isVi ? "Cảnh báo / yêu cầu bồi thường" : "Warn / request compensation"}</div>
                        <div className="mt-1 text-xs text-slate-600">{isVi ? "Thông báo tổn thất dự kiến và điều chỉnh hoàn cọc." : "Notify possible loss and adjust the expected refund."}</div>
                      </button>
                    </div>

                    <label className="mt-4 block text-xs font-semibold text-slate-700">
                      {isVi ? "Phát hiện và yêu cầu chi tiết gửi cho cư dân" : "Detailed findings and instructions for the resident"}
                    </label>
                    <textarea
                      value={ownerFindings}
                      onChange={(event) => setOwnerFindings(event.target.value.slice(0, 5000))}
                      rows={9}
                      placeholder={isVi
                        ? "Ví dụ: Ảnh giường chưa thể hiện locker đã dọn sạch; vui lòng chụp lại toàn cảnh..."
                        : "Example: The bed photo does not show that the locker is empty; please submit a new wide photo..."}
                      className="mt-2 min-h-52 w-full resize-y rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                    />
                    <div className="mt-1 text-right text-xs text-slate-500">{ownerFindings.length}/5000</div>

                    {noticeAction === "compensation" ? (
                      <div className="mt-3">
                        <label className="text-xs font-semibold text-slate-700">{isVi ? "Tổng bồi thường dự kiến (VNĐ)" : "Proposed compensation total (VND)"}</label>
                        <input
                          inputMode="numeric"
                          value={compensationInput}
                          onChange={(event) => setCompensationInput(event.target.value.replace(/[^0-9]/g, ""))}
                          placeholder="0"
                          className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-lg font-bold text-slate-900"
                        />
                        <p className="mt-1 text-xs text-slate-600">
                          {isVi ? "Khoản mới này sẽ thay thế tổng bồi thường dự kiến trước đó và được trừ khỏi mức hoàn cọc gợi ý." : "This replaces the previous proposed compensation total and is deducted from the suggested refund."}
                        </p>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void sendReviewNotice()}
                      disabled={sendingNotice || approving}
                      className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50 ${noticeAction === "redo_checkout" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-600 hover:bg-amber-700"}`}
                    >
                      {sendingNotice
                        ? (isVi ? "Đang gửi email…" : "Sending email…")
                        : noticeAction === "redo_checkout"
                          ? (isVi ? "Gửi cảnh báo và mở lại biểu mẫu" : "Send warning and reopen form")
                          : (isVi ? "Gửi yêu cầu bồi thường" : "Send compensation request")}
                    </button>
                  </div>
                ) : selected.status === "pending" ? (
                  <p className="mt-4 rounded-xl bg-white p-3 text-xs text-violet-800">
                    {isVi ? "Chỉ Owner/App Admin có thể gửi yêu cầu làm lại hoặc bồi thường." : "Only an Owner/App Admin can send redo or compensation requests."}
                  </p>
                ) : null}
              </section>

              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h4 className="text-sm font-bold uppercase tracking-wide text-amber-900">{isVi ? "Đối soát hoàn cọc" : "Deposit refund review"}</h4>
                {selected.financial ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-xl bg-white p-3 text-sm"><span className="text-slate-500">{isVi ? "Tiền cọc" : "Deposit"}</span><div className="font-bold text-slate-900">{formatVnd(selected.financial.depositVnd)}</div></div>
                      <div className="rounded-xl bg-white p-3 text-sm"><span className="text-slate-500">{isVi ? "Phạt chưa trả" : "Unpaid fines"}</span><div className="font-bold text-rose-700">{formatVnd(selected.financial.unpaidFinesVnd)}</div></div>
                      <div className="rounded-xl bg-white p-3 text-sm"><span className="text-slate-500">{isVi ? "Phí vé cổng" : "Gate fees"}</span><div className="font-bold text-rose-700">{formatVnd(selected.financial.unpaidGateVnd)}</div></div>
                      <div className="rounded-xl bg-white p-3 text-sm"><span className="text-slate-500">{isVi ? "Hoàn trước bồi thường" : "Refund before compensation"}</span><div className="font-bold text-slate-900">{formatVnd(selected.financial.suggestedRefundVnd)}</div></div>
                      <div className="rounded-xl bg-white p-3 text-sm"><span className="text-slate-500">{isVi ? "Bồi thường dự kiến" : "Proposed compensation"}</span><div className="font-bold text-rose-700">−{formatVnd(selected.compensationAmountVnd)}</div></div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm"><span className="text-emerald-700">{isVi ? "Đề xuất hoàn sau cùng" : "Adjusted suggested refund"}</span><div className="font-bold text-emerald-800">{formatVnd(Math.max(0, selected.financial.suggestedRefundVnd - selected.compensationAmountVnd))}</div></div>
                    </div>
                    {[...(selected.financial.unpaidFineLines ?? []), ...(selected.financial.unpaidGateLines ?? [])].length > 0 ? (
                      <div className="rounded-xl bg-white p-3 text-sm text-slate-700">
                        {[...(selected.financial.unpaidFineLines ?? []), ...(selected.financial.unpaidGateLines ?? [])].map((line, index) => (
                          <div key={`${line.labelEn}-${index}`} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
                            <span>{isVi ? line.labelVi : line.labelEn}</span>
                            <span className="font-semibold text-rose-700">−{formatVnd(line.amountVnd)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {selected.status === "pending" ? (
                      <div>
                        <label className="text-xs font-semibold text-slate-700">{isVi ? "Số tiền hoàn cọc được duyệt" : "Approved refund amount"}</label>
                        <input
                          inputMode="numeric"
                          value={refundInput}
                          onChange={(event) => setRefundInput(event.target.value.replace(/[^0-9]/g, ""))}
                          disabled={selected.awaitingRedo}
                          className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-4 py-4 text-xl font-bold text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                        />
                        {canApprove ? (
                          <button
                            type="button"
                            onClick={() => void approveSelected()}
                            disabled={approving || sendingNotice || selected.awaitingRedo}
                            className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {approving
                              ? (isVi ? "Đang gửi email…" : "Sending email…")
                              : (isVi ? "Duyệt, gửi email hoàn cọc và lưu trữ" : "Approve, email refund, and archive")}
                          </button>
                        ) : (
                          <p className="mt-3 text-xs text-amber-800">{isVi ? "Chỉ Owner/App Admin có thể duyệt và gửi email hoàn cọc." : "Only an Owner/App Admin can approve and send the refund email."}</p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        <div className="font-bold">{isVi ? "Đã duyệt và lưu trữ" : "Approved and archived"}</div>
                        <div className="mt-1">{isVi ? "Hoàn cọc" : "Refund"}: {formatVnd(selected.refundAmountVnd ?? 0)}</div>
                        <div>{isVi ? "Email" : "Email"}: {selected.refundEmailSentTo ?? selected.email}</div>
                        <div>{isVi ? "Người duyệt" : "Reviewed by"}: {selected.reviewedBy ?? "—"}</div>
                        <div>{isVi ? "Thời gian" : "Reviewed"}: {selected.reviewedAt ? formatCozoroDateTime(selected.reviewedAt) : "—"}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-rose-700">{selected.financialError || (isVi ? "Không tải được dữ liệu phí/phạt." : "Financial data could not be loaded.")}</p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
