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

type InboxMessage = {
  id: string;
  role: "ai_manager" | "owner" | "system";
  kind: "opening" | "reply" | "choice" | "close" | "reopen" | "follow_up";
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: string;
  choiceId: string | null;
};

type InboxTopic = {
  id: string;
  kind: "report" | "escalation";
  category: string;
  status: "open" | "closed";
  title: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByEmail: string | null;
  fromEmail: string;
  fromName: string;
  choices: InboxChoice[];
  selectedChoiceId: string | null;
  relatedReportId: string | null;
  relatedConversationId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  residentEmail: string | null;
  readBy: string[];
  messages: InboxMessage[];
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

function previewText(topic: InboxTopic) {
  const last = topic.messages[topic.messages.length - 1];
  return (last?.body || topic.title).replace(/\s+/g, " ").trim().slice(0, 90);
}

export function ManagerAiManagerInbox({
  operatorEmail,
  enabled
}: {
  operatorEmail: string;
  enabled: boolean;
}) {
  const { t, language } = usePortalLanguage();
  const [topics, setTopics] = useState<InboxTopic[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [closeAfterReply, setCloseAfterReply] = useState(false);
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
        topics?: InboxTopic[];
        items?: InboxTopic[];
        openCount?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const next = data.topics ?? data.items ?? [];
      setTopics(next);
      setOpenCount(data.openCount ?? next.filter((topic) => topic.status === "open").length);
      setSelectedId((prev) => {
        if (prev && next.some((topic) => topic.id === prev)) return prev;
        const firstOpen = next.find((topic) => topic.status === "open");
        return firstOpen?.id ?? next[0]?.id ?? null;
      });
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
    if (!enabled || !operatorEmail || markedReadRef.current || topics.length === 0) return;
    markedReadRef.current = true;
    void fetch(`${API_BASE_URL}/manager/ai-manager/inbox/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorEmail: operatorEmail })
    }).catch(() => {
      // ignore
    });
  }, [enabled, operatorEmail, topics.length]);

  const visibleTopics = useMemo(() => {
    const filtered = filter === "open" ? topics.filter((topic) => topic.status === "open") : topics;
    return [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [topics, filter]);

  const selected = useMemo(
    () => topics.find((topic) => topic.id === selectedId) ?? null,
    [topics, selectedId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selected?.id, selected?.messages.length]);

  async function postJson(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setReplyDraft("");
      setCloseAfterReply(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
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

  const showThreadOnly = Boolean(selected);

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("aiManagerChatTab", "AI Manager")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {language === "vi"
              ? "Mỗi chủ đề mở/đóng riêng. Trả lời trong chủ đề để AI Manager biết phải làm gì."
              : "Each topic opens and closes on its own. Reply inside a topic so the AI Manager knows what to do."}
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

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(220px,320px)_1fr]">
        <aside
          className={`min-h-0 overflow-y-auto border-slate-100 md:border-r ${
            showThreadOnly ? "hidden md:block" : "block"
          }`}
        >
          {loading && topics.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">
              {language === "vi" ? "Đang tải…" : "Loading…"}
            </div>
          ) : null}
          {!loading && visibleTopics.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">
              {language === "vi" ? "Chưa có chủ đề." : "No topics yet."}
            </div>
          ) : null}
          <ul className="divide-y divide-slate-100">
            {visibleTopics.map((topic) => {
              const active = topic.id === selectedId;
              return (
                <li key={topic.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(topic.id)}
                    className={`w-full px-3 py-3 text-left transition ${
                      active ? "bg-teal-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          topic.status === "open"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {topic.status === "open"
                          ? language === "vi"
                            ? "Mở"
                            : "Open"
                          : language === "vi"
                            ? "Đóng"
                            : "Closed"}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {categoryLabel(topic.category, language)}
                      </span>
                      <span className="ml-auto text-[10px] text-slate-400">
                        {formatWhen(topic.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-900">
                      {topic.title}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {previewText(topic)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div
          className={`flex min-h-0 flex-col bg-gradient-to-b from-slate-50 to-teal-50/30 ${
            showThreadOnly ? "flex" : "hidden md:flex"
          }`}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
              {language === "vi" ? "Chọn một chủ đề để xem." : "Select a topic to view."}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 border-b border-slate-100 bg-white/90 px-3 py-3">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 md:hidden"
                  onClick={() => setSelectedId(null)}
                >
                  {language === "vi" ? "Quay lại" : "Back"}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{selected.title}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        selected.status === "open"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {selected.status === "open"
                        ? language === "vi"
                          ? "Đang mở"
                          : "Open"
                        : language === "vi"
                          ? "Đã đóng"
                          : "Closed"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {categoryLabel(selected.category, language)}
                    {selected.residentEmail ? ` · ${selected.residentEmail}` : ""}
                  </div>
                </div>
                {selected.status === "open" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void postJson(
                        `/manager/ai-manager/inbox/${encodeURIComponent(selected.id)}/close`,
                        { actorEmail: operatorEmail }
                      )
                    }
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {language === "vi" ? "Đóng chủ đề" : "Close topic"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void postJson(
                        `/manager/ai-manager/inbox/${encodeURIComponent(selected.id)}/reopen`,
                        { actorEmail: operatorEmail }
                      )
                    }
                    className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 disabled:opacity-50"
                  >
                    {language === "vi" ? "Mở lại" : "Reopen"}
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
                {selected.messages.map((message) => {
                  const isOwner = message.role === "owner";
                  const isSystem = message.role === "system";
                  return (
                    <article
                      key={message.id}
                      className={`max-w-[95%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[85%] ${
                        isSystem
                          ? "mx-auto border border-dashed border-slate-200 bg-white/70 text-center text-xs text-slate-500"
                          : isOwner
                            ? "ml-auto border border-slate-200 bg-slate-900 text-white"
                            : "mr-auto border border-teal-100 bg-white text-slate-800"
                      }`}
                    >
                      {!isSystem ? (
                        <div
                          className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${
                            isOwner ? "text-slate-300" : "text-teal-700"
                          }`}
                        >
                          {message.fromName}
                          <span className={`ml-2 font-normal normal-case tracking-normal ${isOwner ? "text-slate-400" : "text-slate-400"}`}>
                            {formatWhen(message.createdAt)}
                          </span>
                        </div>
                      ) : null}
                      {isSystem ? (
                        <span>{message.body}</span>
                      ) : (
                        <ChatFormattedText text={message.body} />
                      )}
                    </article>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {selected.status === "open" ? (
                <div className="border-t border-slate-100 bg-white px-3 py-3 sm:px-4">
                  {selected.kind === "escalation" && selected.choices.length > 0 ? (
                    <div className="mb-3 space-y-2">
                      <p className="text-xs font-medium text-slate-600">
                        {language === "vi"
                          ? "Chọn một phương án (có thể kèm ghi chú bên dưới):"
                          : "Pick one option (optional note below):"}
                      </p>
                      <div className="flex flex-col gap-2">
                        {selected.choices.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void postJson(
                                `/manager/ai-manager/inbox/${encodeURIComponent(selected.id)}/choose`,
                                {
                                  actorEmail: operatorEmail,
                                  choiceId: choice.id,
                                  ownerReply: replyDraft.trim() || undefined
                                }
                              )
                            }
                            className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-left text-sm font-medium text-teal-900 transition hover:bg-teal-100 disabled:opacity-50"
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={2}
                      placeholder={
                        language === "vi"
                          ? "Trả lời trong chủ đề này — AI Manager sẽ đọc để biết phải làm gì…"
                          : "Reply inside this topic — the AI Manager reads it to know what to do…"
                      }
                      className="min-h-[64px] w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-400"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={closeAfterReply}
                          onChange={(e) => setCloseAfterReply(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        {language === "vi" ? "Đóng chủ đề sau khi gửi" : "Close topic after send"}
                      </label>
                      <button
                        type="button"
                        disabled={busy || !replyDraft.trim()}
                        onClick={() =>
                          void postJson(
                            `/manager/ai-manager/inbox/${encodeURIComponent(selected.id)}/reply`,
                            {
                              actorEmail: operatorEmail,
                              ownerReply: replyDraft.trim(),
                              closeTopic: closeAfterReply
                            }
                          )
                        }
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy
                          ? language === "vi"
                            ? "AI đang trả lời…"
                            : "AI Manager is replying…"
                          : language === "vi"
                            ? "Gửi trả lời"
                            : "Send reply"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-100 bg-white px-4 py-3 text-center text-xs text-slate-500">
                  {language === "vi"
                    ? "Chủ đề đã đóng. Mở lại nếu cần tiếp tục."
                    : "Topic is closed. Reopen if you need to continue."}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
