"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type SupportConversationListItem = {
  id: string;
  type: "DIRECT" | "GROUP";
  label: string;
  subLabel: string;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string;
  unreadCount: number;
  latestMessage: {
    body: string;
    senderName: string | null;
    createdAt: string;
  } | null;
};

type SupportConversation = {
  id: string;
  type: "DIRECT" | "GROUP";
  residentEmail: string;
  residentName: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string;
  createdAt?: string;
};

type SupportMessage = {
  id: string;
  senderEmail: string;
  senderName: string | null;
  senderRole: "RESIDENT" | "MANAGER" | "OWNER";
  body: string;
  pagePath: string | null;
  createdAt: string;
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value: string, t: (key: any, ...args: any[]) => string) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return t("todayLabel");
  if (d.toDateString() === yesterday.toDateString()) return t("yesterdayLabel");
  return d.toLocaleDateString("vi-VN", { month: "short", day: "numeric", year: "numeric" });
}

function formatConversationTime(value: string) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isStaffRole(role: SupportMessage["senderRole"]) {
  return role === "MANAGER" || role === "OWNER";
}

function senderShortName(message: SupportMessage, t: (key: any, ...args: any[]) => string) {
  if (isStaffRole(message.senderRole)) {
    return message.senderName?.trim() || (message.senderRole === "OWNER" ? t("roleOwner", "Owner") : t("roleManager", "Manager"));
  }
  return message.senderName?.trim() || t("residentLabelShort");
}

export function ManagerSupportInbox({
  operatorEmail,
  enabled,
  onViewClient
}: {
  operatorEmail: string;
  enabled: boolean;
  onViewClient?: (email: string) => void;
}) {
  const { t } = usePortalLanguage();
  const [conversations, setConversations] = useState<SupportConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedPreview = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function loadInbox(targetConversationId?: string) {
    if (!enabled || !operatorEmail.trim()) {
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      const inboxResponse = await fetch(
        `${API_BASE_URL}/manager/support/conversations?operatorEmail=${encodeURIComponent(operatorEmail)}`
      );
      const inboxData = (await inboxResponse.json()) as {
        conversations?: SupportConversationListItem[];
        error?: string;
      };

      if (!inboxResponse.ok) {
        setStatus(inboxData.error ?? t("loadingInboxError", "Unable to load support inbox."));
        return;
      }

      const nextConversations = inboxData.conversations ?? [];
      setConversations(nextConversations);

      const nextConversationId =
        targetConversationId ?? selectedConversationId ?? nextConversations[0]?.id ?? "";
      setSelectedConversationId(nextConversationId);

      if (!nextConversationId) {
        setSelectedConversation(null);
        setMessages([]);
        return;
      }

      const threadResponse = await fetch(
        `${API_BASE_URL}/manager/support/conversations/${encodeURIComponent(
          nextConversationId
        )}?operatorEmail=${encodeURIComponent(operatorEmail)}`
      );
      const threadData = (await threadResponse.json()) as {
        conversation?: SupportConversation;
        messages?: SupportMessage[];
        error?: string;
      };

      if (!threadResponse.ok) {
        setStatus(threadData.error ?? "Unable to load this conversation.");
        return;
      }

      setSelectedConversation(threadData.conversation ?? null);
      setMessages(threadData.messages ?? []);

      void fetch(`${API_BASE_URL}/manager/support/conversations/${encodeURIComponent(nextConversationId)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorEmail })
      });
    } catch {
      setStatus("Unable to load support inbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (enabled && operatorEmail.trim()) {
      void loadInbox();
    }
  }, [enabled, operatorEmail]);

  async function sendReply(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!selectedConversationId || !draft.trim()) return;

    setLoading(true);
    setStatus("");

    try {
      const response = await fetch(`${API_BASE_URL}/manager/support/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          operatorEmail,
          body: draft.trim()
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? "Unable to send reply.");
        return;
      }

      setDraft("");
      await loadInbox(selectedConversationId);
    } catch {
      setStatus("Unable to send reply.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendReply();
    }
  }

  async function updateStatus(nextStatus: "OPEN" | "CLOSED") {
    if (!selectedConversationId) return;

    setLoading(true);
    setStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/support/conversations/${encodeURIComponent(selectedConversationId)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorEmail, status: nextStatus })
        }
      );

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? "Unable to update conversation status.");
        return;
      }

      setStatus(nextStatus === "CLOSED" ? "Conversation closed." : "Conversation reopened.");
      await loadInbox(selectedConversationId);
    } catch {
      setStatus("Unable to update conversation status.");
    } finally {
      setLoading(false);
    }
  }

  if (!enabled) {
    return null;
  }

  // Group messages by date for separators
  function renderMessages() {
    const items: React.ReactNode[] = [];
    let lastDateLabel = "";

    messages.forEach((message, index) => {
      const dateLabel = formatDateLabel(message.createdAt, t);
      const isStaff = isStaffRole(message.senderRole);
      const prevMessage = messages[index - 1];
      const nextMessage = messages[index + 1];

      // Date separator
      if (dateLabel !== lastDateLabel) {
        lastDateLabel = dateLabel;
        items.push(
          <div key={`date-${message.id}`} className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-medium text-slate-500">
              {dateLabel}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        );
      }

      // Show sender name if first in a group (role changed or first message)
      const isFirstInGroup = !prevMessage || prevMessage.senderRole !== message.senderRole;
      const isLastInGroup = !nextMessage || nextMessage.senderRole !== message.senderRole;

      items.push(
        <div key={message.id} className={`flex ${isStaff ? "justify-end" : "justify-start"} ${isLastInGroup ? "mb-3" : "mb-0.5"}`}>
          <div className={`flex max-w-[75%] flex-col ${isStaff ? "items-end" : "items-start"}`}>
            {isFirstInGroup && (
              !isStaff && onViewClient ? (
                <button
                  type="button"
                  onClick={() => onViewClient(message.senderEmail)}
                  className="mb-1 px-1 text-[11px] font-medium text-sky-600 hover:underline text-left"
                >
                  {senderShortName(message, t)}
                </button>
              ) : (
                <span className="mb-1 px-1 text-[11px] font-medium text-slate-400">
                  {senderShortName(message, t)}
                </span>
              )
            )}
            <div
              className={`rounded-2xl px-4 py-2.5 ${
                isStaff
                  ? `bg-blue-500 text-white ${isFirstInGroup ? "rounded-tr-sm" : ""}`
                  : `bg-slate-100 text-slate-900 ${isFirstInGroup ? "rounded-tl-sm" : ""}`
              }`}
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
              {message.pagePath ? (
                <p className={`mt-1 text-[10px] ${isStaff ? "text-blue-200" : "text-slate-400"}`}>
                  {t("fromLabel", "from")} {message.pagePath}
                </p>
              ) : null}
            </div>
            {isLastInGroup && (
              <span className={`mt-1 px-1 text-[10px] text-slate-400 ${isStaff ? "text-right" : "text-left"}`}>
                {formatTime(message.createdAt)}
              </span>
            )}
          </div>
        </div>
      );
    });

    return items;
  }

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("supportInboxTitle")}</h2>
          <p className="text-xs text-slate-500">{t("supportInboxDesc")}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadInbox(selectedConversationId)}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? t("refreshing") : t("refreshLabel")}
        </button>
      </div>

      {/* Quick Group Access */}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-3">
        {["BRANCH_D2", "BRANCH_D7"].map((groupId) => {
          const conv = conversations.find((c) => c.id === groupId);
          const unreadCount = conv?.unreadCount || 0;
          const label = groupId.replace("BRANCH_", `${t("branchLabelShort", "Branch")} `);
          const isSelected = selectedConversationId === groupId;

          return (
            <button
              key={groupId}
              type="button"
              onClick={() => void loadInbox(groupId)}
              className={`relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                isSelected
                  ? "border-blue-600 bg-blue-500 text-white shadow"
                  : unreadCount > 0
                    ? "border-sky-300 bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {label}
              {unreadCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-0.5 text-[9px] font-bold text-white shadow-sm ring-1 ring-white">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-[22rem_1fr]" style={{ minHeight: "540px" }}>
        {/* Conversation list */}
        <div className="overflow-y-auto border-r border-slate-100 lg:max-h-[600px]">
          {conversations.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">{t("noConversationsYet")}</div>
          ) : (
            conversations.map((conversation) => {
              const isSelected = conversation.id === selectedConversationId;
              const hasUnread = conversation.unreadCount > 0;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void loadInbox(conversation.id)}
                  className={`relative w-full border-b px-4 py-3.5 text-left transition-colors ${
                    isSelected
                      ? "bg-blue-500 text-white"
                      : hasUnread
                        ? "bg-sky-50 hover:bg-sky-100"
                        : "bg-white hover:bg-slate-50"
                  }`}
                >
                  {hasUnread && !isSelected && (
                    <span className="absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
                      {conversation.unreadCount}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    {conversation.type === "GROUP" && (
                      <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isSelected ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>
                        {t("groupLabelShort")}
                      </span>
                    )}
                    <span className={`truncate text-sm font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>
                      {conversation.label}
                    </span>
                    <span className={`ml-auto shrink-0 text-[9px] font-semibold uppercase ${isSelected ? "text-white/70" : conversation.status === "OPEN" ? "text-emerald-600" : "text-slate-400"}`}>
                      {t(`${conversation.status.toLowerCase()}Status`)}
                    </span>
                  </div>
                  <div className={`mt-0.5 truncate text-xs ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                    {conversation.subLabel}
                  </div>
                  {conversation.latestMessage ? (
                    <div className={`mt-1.5 flex items-end justify-between gap-2`}>
                      <p className={`line-clamp-1 flex-1 text-xs ${isSelected ? "text-blue-100" : hasUnread ? "font-semibold text-slate-800" : "text-slate-500"}`}>
                        {conversation.latestMessage.body}
                      </p>
                      <span className={`shrink-0 text-[10px] ${isSelected ? "text-blue-200" : "text-slate-400"}`}>
                        {formatConversationTime(conversation.lastMessageAt)}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {/* Message thread */}
        <div className="flex flex-col">
          {!selectedConversation && !selectedPreview ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-slate-400">{t("selectConversationPrompt", "Select a conversation to start reading")}</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {selectedConversation?.residentName || selectedPreview?.label || t("conversationLabel", "Conversation")}
                  </p>
                  <p className="text-xs text-slate-400">
                    {selectedConversation?.residentEmail || selectedPreview?.subLabel}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void updateStatus("OPEN")}
                    disabled={loading || selectedConversation?.status === "OPEN"}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    {t("reopenLabel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateStatus("CLOSED")}
                    disabled={loading || selectedConversation?.status === "CLOSED"}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    {t("closeLabel")}
                  </button>
                </div>
              </div>

              {status ? (
                <p className="px-5 py-2 text-xs text-slate-500">{status}</p>
              ) : null}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: "420px" }}>
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-400">{t("noMessagesYet")}</p>
                ) : (
                  <>
                    {renderMessages()}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* iMessage-style input */}
              <div className="border-t border-slate-100 px-4 py-3">
                <form onSubmit={sendReply} className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={t("messagePlaceholder")}
                    className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-200"
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                    }}
                  />
                  <button
                    type="submit"
                    disabled={loading || !draft.trim() || !selectedConversationId}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow transition hover:bg-blue-600 disabled:opacity-40"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  </button>
                </form>
                <p className="mt-1.5 text-center text-[10px] text-slate-300">{t("chatKeyboardHint", "Enter to send · Shift+Enter for new line")}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
