"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDate, formatCozoroDateTime } from "../lib/date-format";

type Explanation = {
  selectionFactor?: string;
  version: number; availability: string; countedTasks: number; fairnessFrom: string;
  correctionPenalty: number; candidateCount: number; decidedAt: string; reason: string;
};
type Review = {
  id: string; status: string;
  messages: { id: string; authorRole: string; body: string; createdAt: string }[];
};
type Payload = { explanation: Explanation | null; review: Review | null; canResolve: boolean };

function explanationValue(value: unknown): Explanation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Explanation;
  return item.version === 1 && typeof item.countedTasks === "number" && typeof item.fairnessFrom === "string" ? item : null;
}

export function CleaningAssignmentReview({ taskId, reviewId, actorEmail, language, explanation, initiallyOpen = false }: {
  taskId?: string; reviewId?: string; actorEmail: string; language: string; explanation?: unknown; initiallyOpen?: boolean;
}) {
  const vi = language === "vi";
  const [open, setOpen] = useState(initiallyOpen);
  const [data, setData] = useState<Payload | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = explanationValue(data?.explanation ?? explanation);
  const factors: Record<string, string> = vi
    ? { only_candidate: "người duy nhất đủ điều kiện", availability: "mức ưu tiên ngày rảnh", workload: "ít lịch cùng loại hơn", correction: "ít điểm điều chỉnh hơn", name: "đồng hạng, chọn theo tên" }
    : { only_candidate: "only eligible resident", availability: "availability priority", workload: "fewer same-type assignments", correction: "lower correction penalty", name: "tied scores, name order" };
  const factor = saved?.selectionFactor ? factors[saved.selectionFactor] : null;
  const availability = saved?.availability === "PREFERRED" ? (vi ? "ngày ưu tiên" : "preferred day")
    : saved?.availability === "AVAILABLE" ? (vi ? "ngày rảnh" : "available day")
    : (vi ? "chưa đánh dấu bận" : "no away date recorded");

  const load = useCallback(async () => {
    try {
      const path = reviewId ? `/cleaning/assignment-reviews/${reviewId}` : `/cleaning/tasks/${taskId}/assignment-review`;
      const response = await fetch(`${API_BASE_URL}${path}?${new URLSearchParams({ actorEmail })}`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to load assignment review.");
      setData(value); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load assignment review."); }
  }, [actorEmail, taskId, reviewId]);
  useEffect(() => {
    if (!open) return;
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(interval);
  }, [open, load]);

  async function post(action: "comment" | "resolve" | "reopen") {
    setSaving(true); setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/cleaning/assignment-reviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, taskId, reviewId: data?.review?.id ?? reviewId, body, action })
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to save assignment review.");
      setData(value); setBody(""); window.dispatchEvent(new Event("cleaning-assignment-review-updated"));
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save assignment review."); }
    finally { setSaving(false); }
  }

  return <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/70 p-2 text-xs text-slate-700">
    <p>{saved
      ? (vi ? `Tự động chọn trong ${saved.candidateCount} người đủ điều kiện: ${availability}; đã tính ${saved.countedTasks} lịch cùng loại.`
        : `Automatically selected from ${saved.candidateCount} eligible residents: ${availability}; ${saved.countedTasks} assignments of this type counted.`)
      : (vi ? "Chưa lưu lý do lựa chọn tại thời điểm xếp lịch này." : "The original selection details were not recorded for this assignment.")}</p>
    {factor && <p>{vi ? "Yếu tố quyết định: " : "Deciding factor: "}{factor}.</p>}
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="mt-1 font-semibold text-sky-800 underline">
      {vi ? "Vì sao chọn lịch này? · Trao đổi / phản đối" : "Why this assignment? · Discuss / dispute"}
    </button>
    {open && <div className="mt-2 space-y-2">
      {saved && <>
        <p>{vi
          ? "Thứ tự chọn: đúng chi nhánh/tầng, không bận, không trùng lịch, không được miễn; ngày ưu tiên → ngày rảnh → chưa đánh dấu; ít lịch cùng loại hơn; ít điểm điều chỉnh từ quản lý hơn; cuối cùng theo tên."
          : "Selection order: eligible branch/floor, no away date or same-day task, no exemption; preferred → available → unmarked; fewer same-type assignments; lower correction penalty; finally name order."}</p>
        <p>{vi
          ? `Số lịch tính từ ${formatCozoroDate(new Date(saved.fairnessFrom))}, gồm cả lịch tương lai đã xếp và bỏ qua lịch MISSED. Điểm điều chỉnh: ${saved.correctionPenalty}. Quyết định lưu lúc ${formatCozoroDateTime(new Date(saved.decidedAt))}.`
          : `Count starts ${formatCozoroDate(new Date(saved.fairnessFrom))}, includes already scheduled future duties and excludes MISSED tasks. Correction penalty: ${saved.correctionPenalty}. Decision saved ${formatCozoroDateTime(new Date(saved.decidedAt))}.`}</p>
        {saved.reason === "replacement" && <p>{vi ? "Bạn được chọn thay người vừa hủy lịch." : "You were selected to cover a cancellation."}</p>}
        {saved.reason === "rescheduled" && <p>{vi ? "Đây là lịch thay thế sau khi bạn hủy lịch trước và xác nhận ngày mới." : "This is the replacement date you confirmed after cancelling an earlier assignment."}</p>}
        {saved.reason === "bulk" && <p>{vi ? "Quản lý đã yêu cầu hệ thống chọn người cho nhiều ngày." : "The host requested automatic selection for a batch of dates."}</p>}
      </>}
      <p className="font-medium">{vi ? "Trao đổi này cũng được gửi vào chat riêng giữa cư dân và chủ nhà." : "Updates here also appear in the private resident–host chat."}</p>
      <p>{vi ? "Nêu lý do, ví dụ: đã thỏa thuận miễn, ngày bận bị sai, hoặc bị xếp quá nhiều. Cư dân và chủ nhà đều có thể trao đổi tại đây. Lịch vẫn giữ nguyên cho đến khi được điều chỉnh."
        : "Explain what seems wrong—for example an agreed exemption, incorrect availability, or too many duties. Resident and host can reply here. The task stays in place until it is changed."}</p>
      {data?.review && <>
        <p className="font-semibold">{data.review.status === "OPEN" ? (vi ? "Đang chờ giải quyết" : "Open dispute") : (vi ? "Đã giải quyết" : "Resolved")}</p>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {data.review.messages.map(message => <div key={message.id} className="rounded bg-white p-2">
            <p className="font-medium">{message.authorRole === "host" ? (vi ? "Chủ nhà / quản lý" : "Host") : (vi ? "Cư dân" : "Resident")} · {formatCozoroDateTime(new Date(message.createdAt))}</p>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>)}
        </div>
      </>}
      <textarea value={body} onChange={event => setBody(event.target.value)} maxLength={2000}
        aria-label={vi ? "Lý do hoặc phản hồi" : "Reason or reply"}
        placeholder={vi ? "Lý do phản đối, đề xuất ngày khác hoặc phản hồi…" : "Reason, preferred alternative date, or reply…"}
        className="min-h-20 w-full rounded border border-slate-300 bg-white p-2" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || !body.trim() || !data} onClick={() => void post(data?.review?.status === "RESOLVED" ? "reopen" : "comment")}
          className="rounded bg-sky-800 px-3 py-2 text-white disabled:opacity-50">
          {saving ? (vi ? "Đang lưu…" : "Saving…") : data?.review?.status === "RESOLVED" ? (vi ? "Mở lại và gửi" : "Reopen and reply") : data?.review ? (vi ? "Gửi phản hồi" : "Reply") : (vi ? "Gửi phản đối" : "Open dispute")}
        </button>
        {data?.canResolve && data.review?.status === "OPEN" && <button type="button" disabled={saving || !body.trim()}
          onClick={() => void post("resolve")} className="rounded border border-slate-400 bg-white px-3 py-2 disabled:opacity-50">
          {vi ? "Ghi lý do và đóng trao đổi" : "Save resolution and close"}
        </button>}
      </div>
      {data?.canResolve && <p>{vi ? "Nếu đồng ý đổi lịch, hãy dùng công cụ sửa lịch trước khi đóng trao đổi." : "If a schedule change is agreed, use the scheduling controls before closing the dispute."}</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
    </div>}
  </div>;
}

type InboxItem = { id: string; userName: string | null; taskType: string; scheduledDate: string; branchId: string; status: string };
export function CleaningAssignmentReviewInbox({ actorEmail, language }: { actorEmail: string; language: string }) {
  const vi = language === "vi";
  const [reviews, setReviews] = useState<InboxItem[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/cleaning/assignment-reviews?${new URLSearchParams({ actorEmail, includeResolved: String(includeResolved) })}`);
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Unable to load assignment disputes.");
        if (active) { setReviews(value.reviews); setError(""); }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "Unable to load assignment disputes."); }
    };
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    window.addEventListener("cleaning-assignment-review-updated", load);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("cleaning-assignment-review-updated", load); };
  }, [actorEmail, includeResolved]);
  return <details className="rounded-xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer text-sm font-semibold">{vi ? "Trao đổi về lịch tự động" : "Automatic assignment disputes"} ({reviews.length})</summary>
    <label className="my-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={includeResolved} onChange={event => setIncludeResolved(event.target.checked)} />{vi ? "Gồm trao đổi đã đóng" : "Include resolved disputes"}</label>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {!error && !reviews.length && <p className="text-xs text-slate-500">{vi ? "Chưa có trao đổi." : "No disputes to show."}</p>}
    {reviews.map(review => <div key={review.id} className="my-3">
      <p className="text-sm font-medium">{review.userName} · {review.branchId} · {review.taskType.startsWith("TRASH") ? (vi ? "Đổ rác" : "Trash duty") : (vi ? "Vệ sinh bếp" : "Kitchen cleaning")} · {formatCozoroDate(new Date(review.scheduledDate))} · {review.status === "OPEN" ? (vi ? "Đang mở" : "Open") : (vi ? "Đã đóng" : "Resolved")}</p>
      <CleaningAssignmentReview reviewId={review.id} actorEmail={actorEmail} language={language} />
    </div>)}
  </details>;
}
