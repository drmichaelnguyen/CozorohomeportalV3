"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { ChatFormattedText } from "../lib/chat-markdown";
import { usePortalLanguage } from "./portal-language";

type InboxChoice = {
  id: string;
  label: string;
  action?: string;
};

type InboxItem = {
  id: string;
  kind: "report" | "escalation" | "owner_note";
  category: string;
  status: "open" | "resolved" | "acknowledged";
  createdAt: string;
  fromEmail: string;
  fromName: string;
  title: string;
  body: string;
  choices: InboxChoice[];
  selectedChoiceId: string | null;
  ownerReply: string | null;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
  relatedReportId: string | null;
  relatedConversationId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  residentEmail: string | null;
  readBy: string[];
};

function formatWhen(value: string) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function categoryLabel(category: string, language: string) {
  const map: Record<string, { en: string; vi: string }> = {
    report: { en: "Report", vi: "Báo cáo" },
    support_chat: { en: "Support chat", vi: "Chat hỗ trợ" },
    fines: { en: "Fine", vi: "Phạt" },
    schedule: { en: "Schedule", vi: "Lịch" },
    contracts: { en: "Contract", vi: "Hợp đồng" },
    ops: { en: "Ops", vi: "Vận hành" },
    other: { en: "Other", vi: "Khác" }
  };
  const entry = map[category] ?? map.other;
  return language === "vi" ? entry.vi : entry.en;
}

export function ManagerAiManagerInbox({
  operatorEmail,
  enabled
}: {
  operatorEmail: string;
  enabled: boolean;
}) {
  const { t, language } = usePortalLanguage();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"open" | "all">("open");
  const bottomRef = useRef<HTMLDivElement>(null);
  const markedReadRef = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || !operatorEmail) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/ai-manager/inbox?actorEmail=${encodeURIComponent(operatorEmail)}`
      );
      const data = (await res.json()) as {
        items?: InboxItem[];
        openCount?: number;
        unreadCount?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data.items ?? []);
      setOpenCount(data.openCount ?? 0);
      setUnreadCount(data.unreadCount ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enabled, operatorEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !operatorEmail || markedReadRef.current || items.length === 0) return;
    markedReadRef.current = true;
    void fetch(`${API_BASE_URL}/manager/ai-manager/inbox/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorEmail: operatorEmail })
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { unreadCount?: number };
        if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
      })
      .catch(() => {
        // ignore
      });
  }, [enabled, operatorEmail, items.length]);

  const visibleItems = useMemo(() => {
    const filtered = filter === "open" ? items.filter((item) => item.status === "open") : items;
    // Chat order: oldest first
    return [...filtered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [items, filter]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleItems.length, filter]);

  async function choose(itemId: string, choiceId: string) {
    setBusyId(itemId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/ai-manager/inbox/${encodeURIComponent(itemId)}/choose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail: operatorEmail,
            choiceId,
            ownerReply: replyDrafts[itemId]?.trim() || undefined
          })
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save choice");
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save choice");
    } finally {
      setBusyId(null);
    }
  }

  async function sendReply(itemId: string) {
    const ownerReply = replyDrafts[itemId]?.trim() ?? "";
    if (!ownerReply) return;
    setBusyId(itemId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/ai-manager/inbox/${encodeURIComponent(itemId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorEmail: operatorEmail, ownerReply })
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to reply");
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reply");
    } finally {
      setBusyId(null);
    }
  }

  async function ack(itemId: string) {
    setBusyId(itemId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/ai-manager/inbox/${encodeURIComponent(itemId)}/ack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorEmail: operatorEmail })
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to acknowledge");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge");
    } finally {
      setBusyId(null);
    }
  }

  if (!enabled) {
    return (
      <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
        {language === "vi"
          ? "Chỉ owner / app admin mới xem được tab Quản lý AI."
          : "Only owners and app admins can open the AI Manager tab."}
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("aiManagerChatTab", "AI Manager")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {language === "vi"
              ? "Báo cáo định kỳ và các câu hỏi khi AI Manager không chắc — chọn một phương án hoặc viết hướng dẫn."
              : "Scheduled reports and asks when the AI Manager is unsure — pick a choice or write guidance."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-slate-100 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilter("open")}
              className={`rounded-full px-3 py-1.5 ${
                filter === "open" ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              {language === "vi" ? "Đang mở" : "Open"}
              {openCount > 0 ? ` (${openCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1.5 ${
                filter === "all" ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              {language === "vi" ? "Tất cả" : "All"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
          >
            {t("refreshLabel", "Refresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-slate-50 to-teal-50/40 px-3 py-4 sm:px-4">
        {loading && items.length === 0 ? (
          <div className="rounded-2xl bg-white/80 p-4 text-sm text-slate-600">
            {language === "vi" ? "Đang tải…" : "Loading…"}
          </div>
        ) : null}

        {!loading && visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-6 text-center text-sm text-slate-600">
            {language === "vi"
              ? "Chưa có báo cáo hoặc yêu cầu quyết định từ Quản lý AI."
              : "No AI Manager reports or decision asks yet."}
            {unreadCount > 0 ? (
              <span className="mt-1 block text-xs text-slate-500">
                {language === "vi" ? `${unreadCount} chưa đọc` : `${unreadCount} unread`}
              </span>
            ) : null}
          </div>
        ) : null}

        {visibleItems.map((item) => {
          const isAi = item.kind !== "owner_note";
          const isOpenEscalation = item.kind === "escalation" && item.status === "open";
          const selected = item.choices.find((c) => c.id === item.selectedChoiceId);
          return (
            <article
              key={item.id}
              className={`max-w-[95%] rounded-2xl px-3.5 py-3 shadow-sm sm:max-w-[85%] ${
                isAi
                  ? "mr-auto border border-teal-100 bg-white"
                  : "ml-auto border border-slate-200 bg-slate-900 text-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                <span className="rounded-full bg-teal-50 px-2 py-0.5">
                  {item.fromName || "AI Manager"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 normal-case tracking-normal">
                  {categoryLabel(item.category, language)}
                </span>
                {item.kind === "escalation" ? (
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      item.status === "open"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {item.status === "open"
                      ? language === "vi"
                        ? "Cần quyết định"
                        : "Needs decision"
                      : language === "vi"
                        ? "Đã xử lý"
                        : "Resolved"}
                  </span>
                ) : null}
                <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">
                  {formatWhen(item.createdAt)}
                </span>
              </div>

              <h3 className="mt-2 text-sm font-semibold text-slate-900">{item.title}</h3>
              <div className="mt-2 text-sm leading-relaxed text-slate-700">
                <ChatFormattedText text={item.body} />
              </div>

              {item.residentEmail ? (
                <div className="mt-2 text-xs text-slate-500">{item.residentEmail}</div>
              ) : null}

              {item.kind === "report" && item.status === "open" ? (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void ack(item.id)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {language === "vi" ? "Đã xem" : "Acknowledge"}
                  </button>
                </div>
              ) : null}

              {isOpenEscalation ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-slate-600">
                    {language === "vi"
                      ? "Chọn một phương án, hoặc viết hướng dẫn bên dưới:"
                      : "Pick one option, or write your own guidance below:"}
                  </p>
                  <div className="flex flex-col gap-2">
                    {item.choices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void choose(item.id, choice.id)}
                        className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-left text-sm font-medium text-teal-900 transition hover:bg-teal-100 disabled:opacity-50"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <textarea
                      value={replyDrafts[item.id] ?? ""}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder={
                        language === "vi"
                          ? "Hướng dẫn tự viết (tuỳ chọn nếu đã chọn phương án)…"
                          : "Custom guidance (optional if you pick a choice)…"
                      }
                      className="min-h-[64px] flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-400"
                    />
                    <button
                      type="button"
                      disabled={busyId === item.id || !(replyDrafts[item.id] ?? "").trim()}
                      onClick={() => void sendReply(item.id)}
                      className="self-end rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {language === "vi" ? "Gửi" : "Send"}
                    </button>
                  </div>
                </div>
              ) : null}

              {!isOpenEscalation && (selected || item.ownerReply) ? (
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {selected ? (
                    <div>
                      <span className="font-semibold text-slate-800">
                        {language === "vi" ? "Đã chọn: " : "Chose: "}
                      </span>
                      {selected.label}
                    </div>
                  ) : null}
                  {item.ownerReply ? (
                    <div className={selected ? "mt-1" : undefined}>
                      <span className="font-semibold text-slate-800">
                        {language === "vi" ? "Ghi chú: " : "Note: "}
                      </span>
                      {item.ownerReply}
                    </div>
                  ) : null}
                  {item.resolvedByEmail ? (
                    <div className="mt-1 text-slate-400">
                      {item.resolvedByEmail}
                      {item.resolvedAt ? ` · ${formatWhen(item.resolvedAt)}` : ""}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
