"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDate, formatCozoroDateTime } from "../lib/date-format";
import { CleaningAssignmentReview } from "./cleaning-assignment-review";

type Summary = {
  total: number; upcoming: number; byStatus: Record<string, number>; bySource: Record<string, number>;
  next: { scheduledDate: string; type: string } | null; automaticAssignmentExempt: boolean;
};
type Task = {
  id: string; scheduledDate: string; type: string; branchId: string; floor: number | null;
  status: string; assignmentSource: string | null; isSelfAssigned: boolean; assignmentExplanation: unknown;
  assignedByName: string | null; rewardCoins: number; completedAt: string | null; auditorNote: string | null;
};
export function ClientCleaningStatistics({ actorEmail, maHd, language }: { actorEmail: string; maHd: string; language: string }) {
  const vi = language === "vi";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const detailsRequest = useRef<AbortController | null>(null);
  const [refresh, setRefresh] = useState(0);
  const url = useCallback((details = false, offset = 0) => `${API_BASE_URL}/staff/client-cleaning-statistics?${new URLSearchParams({ actorEmail, maHd, details: String(details), offset: String(offset) })}`, [actorEmail, maHd]);
  useEffect(() => {
    const controller = new AbortController();
    detailsRequest.current?.abort();
    setLoading(true); setError(""); setSummary(null); setShowDetails(false); setTasks([]); setDetailsLoaded(false); setDetailsLoading(false); setDetailsError("");
    void fetch(url(), { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load cleaning statistics.");
      if (!controller.signal.aborted) setSummary(data.summary);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load cleaning statistics."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); detailsRequest.current?.abort(); };
  }, [url, refresh]);

  async function loadDetails(offset = 0) {
    detailsRequest.current?.abort();
    const controller = new AbortController(); detailsRequest.current = controller;
    setDetailsLoading(true); setDetailsError("");
    try {
      const response = await fetch(url(true, offset), { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load cleaning entries.");
      if (controller.signal.aborted) return;
      setTasks(previous => offset === 0 ? data.tasks : [...new Map([...previous, ...data.tasks].map((task: Task) => [task.id, task])).values()]);
      setNextOffset(data.nextOffset); setDetailsLoaded(true);
    } catch (error) { if (!controller.signal.aborted) setDetailsError(error instanceof Error ? error.message : "Unable to load cleaning entries."); }
    finally { if (!controller.signal.aborted) setDetailsLoading(false); }
  }
  const taskName = (type: string) => type.startsWith("TRASH") ? (vi ? "Đổ rác" : "Trash duty") : (vi ? "Vệ sinh bếp" : "Kitchen cleaning");
  const statusNames: Record<string, string> = vi
    ? { ASSIGNED: "Đã phân công", DONE_PENDING_AUDIT: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Không duyệt / bỏ qua", MISSED: "Bỏ lỡ" }
    : { ASSIGNED: "Assigned", DONE_PENDING_AUDIT: "Awaiting audit", APPROVED: "Approved", REJECTED: "Rejected / dismissed", MISSED: "Missed" };
  const sourceNames: Record<string, string> = vi
    ? { SELF: "Tự đăng ký", SYSTEM: "Tự động", MANAGER: "Quản lý", LEGACY: "Chưa ghi nguồn" }
    : { SELF: "Self-assigned", SYSTEM: "Automatic", MANAGER: "Manager", LEGACY: "Unrecorded source" };
  const cards = summary ? [
    [vi ? "Tổng công việc" : "Total tasks", summary.total],
    [vi ? "Hôm nay và sắp tới" : "Today and upcoming", summary.upcoming],
    [statusNames.DONE_PENDING_AUDIT, summary.byStatus.DONE_PENDING_AUDIT ?? 0],
    [statusNames.APPROVED, summary.byStatus.APPROVED ?? 0],
    [statusNames.MISSED, summary.byStatus.MISSED ?? 0],
    [statusNames.REJECTED, summary.byStatus.REJECTED ?? 0]
  ] : [];
  return <div className="mt-4 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{vi ? "Toàn bộ lịch vệ sinh đã lưu của cư dân, qua các hợp đồng, trong phạm vi bạn được xem." : "All recorded cleaning tasks for this resident across contracts, within your access permissions."}</p>
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading || detailsLoading} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{vi ? "Làm mới" : "Refresh"}</button>
    </div>
    {loading && <p role="status" className="text-sm text-slate-500">{vi ? "Đang tải tổng quan…" : "Loading summary…"}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {summary && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
      </div>)}</div>
      <div className="flex flex-wrap gap-2">{Object.entries(sourceNames).map(([source, label]) => <span key={source} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{label}: {summary.bySource[source] ?? 0}</span>)}</div>
      <p className="text-sm text-slate-700">{vi ? "Lịch tiếp theo: " : "Next duty: "}{summary.next ? `${taskName(summary.next.type)} · ${formatCozoroDate(new Date(summary.next.scheduledDate))}` : (vi ? "Chưa có" : "None scheduled")}</p>
      <p className="text-sm text-slate-600">{vi ? "Miễn tự động xếp lịch theo thỏa thuận: " : "Owner-agreed automatic assignment exemption: "}{summary.automaticAssignmentExempt ? (vi ? "Có" : "Yes") : (vi ? "Không" : "No")}</p>
      <button type="button" onClick={() => { const next = !showDetails; setShowDetails(next); if (next && !detailsLoaded && !detailsLoading) void loadDetails(); }}
        aria-expanded={showDetails} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
        {showDetails ? (vi ? "Ẩn chi tiết" : "Hide details") : (vi ? "Xem chi tiết" : "Show details")}
      </button>
    </>}
    {showDetails && <div className="space-y-3">
      {tasks.map(task => <article key={task.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{formatCozoroDate(new Date(task.scheduledDate))} · {taskName(task.type)} · {task.branchId}{task.floor ? ` · ${vi ? "Tầng" : "Floor"} ${task.floor}` : ""}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{statusNames[task.status] ?? task.status}</span>
        </div>
        <p className="mt-1 text-xs text-slate-600">{sourceNames[task.isSelfAssigned || task.assignmentSource === "SELF" ? "SELF" : task.assignmentSource ?? "LEGACY"]}{task.assignedByName ? ` · ${task.assignedByName}` : ""}</p>
        {task.completedAt && <p className="mt-1 text-xs text-slate-600">{vi ? "Gửi hoàn thành: " : "Completion submitted: "}{formatCozoroDateTime(new Date(task.completedAt))}</p>}
        {task.auditorNote && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">{task.auditorNote}</p>}
        {(task.assignmentSource === "SYSTEM" || Boolean(task.assignmentExplanation)) && <CleaningAssignmentReview taskId={task.id} actorEmail={actorEmail} language={language} explanation={task.assignmentExplanation} />}
      </article>)}
      {detailsLoading && <p role="status" className="text-sm text-slate-500">{vi ? "Đang tải chi tiết…" : "Loading details…"}</p>}
      {detailsError && <div role="alert" className="text-sm text-rose-700">{detailsError} <button type="button" onClick={() => void loadDetails(detailsLoaded ? nextOffset ?? 0 : 0)} className="underline">{vi ? "Thử lại" : "Retry"}</button></div>}
      {detailsLoaded && !tasks.length && <p className="text-sm text-slate-500">{vi ? "Chưa có lịch vệ sinh." : "No cleaning tasks recorded."}</p>}
      {detailsLoaded && nextOffset !== null && <button type="button" disabled={detailsLoading} onClick={() => void loadDetails(nextOffset)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">{vi ? "Xem thêm" : "Load more"}</button>}
    </div>}
  </div>;
}
