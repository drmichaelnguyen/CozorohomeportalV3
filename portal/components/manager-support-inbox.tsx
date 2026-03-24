"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";

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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function roleLabel(role: SupportMessage["senderRole"]) {
  if (role === "OWNER") {
    return "Owner";
  }

  if (role === "MANAGER") {
    return "Manager";
  }

  return "Resident";
}

function authorLabel(message: SupportMessage) {
  const role = roleLabel(message.senderRole);
  const identity = message.senderName?.trim() || message.senderEmail;
  return identity ? `${role} - ${identity}` : role;
}

export function ManagerSupportInbox({
  operatorEmail,
  enabled
}: {
  operatorEmail: string;
  enabled: boolean;
}) {
  const [conversations, setConversations] = useState<SupportConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const selectedPreview = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

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
        setStatus(inboxData.error ?? "Unable to load support inbox.");
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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          operatorEmail
        })
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

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedConversationId || !draft.trim()) {
      setStatus("Choose a conversation and write a reply first.");
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      const response = await fetch(`${API_BASE_URL}/manager/support/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
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
      setStatus("Reply sent.");
      await loadInbox(selectedConversationId);
    } catch {
      setStatus("Unable to send reply.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(nextStatus: "OPEN" | "CLOSED") {
    if (!selectedConversationId) {
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/support/conversations/${encodeURIComponent(selectedConversationId)}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            operatorEmail,
            status: nextStatus
          })
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

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Support Inbox</h2>
          <p className="mt-2 text-sm text-slate-600">
            Residents send one conversation per account, and any owner or manager can reply from this shared inbox.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadInbox(selectedConversationId)}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
        >
          Refresh inbox
        </button>
      </div>

      {status ? <p className="mt-4 text-sm text-slate-700">{status}</p> : null}

      {/* Quick Group Access */}
      <div className="mt-6 flex flex-wrap gap-2">
        {["BRANCH_D2", "BRANCH_D7"].map(groupId => {
          const conv = conversations.find(c => c.id === groupId);
          const unreadCount = conv?.unreadCount || 0;
          const label = groupId.replace("BRANCH_", "Branch ");
          const isSelected = selectedConversationId === groupId;

          return (
            <button
              key={groupId}
              type="button"
              onClick={() => void loadInbox(groupId)}
              className={`relative flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
                isSelected
                  ? "bg-slate-900 text-white border-slate-900 shadow-md"
                  : unreadCount > 0
                    ? "bg-sky-50 border-sky-300 text-sky-700 ring-1 ring-sky-300"
                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              {label}
              {unreadCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm ring-1 ring-white">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-3">
          {conversations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No resident chats yet.
            </div>
          ) : (
            conversations.map((conversation) => {
              const isSelected = conversation.id === selectedConversationId;
              const hasUnread = conversation.unreadCount > 0;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void loadInbox(conversation.id)}
                  className={`relative w-full rounded-xl border p-4 text-left transition-all ${
                    isSelected 
                      ? "border-slate-900 bg-slate-900 text-white shadow-md" 
                      : hasUnread
                        ? "border-sky-300 bg-sky-50 text-slate-900 ring-1 ring-sky-300"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                  }`}
                >
                  {hasUnread && !isSelected && (
                    <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm">
                      {conversation.unreadCount}
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium">
                      {conversation.type === "GROUP" && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                          Group
                        </span>
                      )}
                      <span className="truncate">{conversation.label}</span>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                        isSelected
                          ? "bg-white/10 text-white"
                          : conversation.status === "OPEN"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {conversation.status}
                    </span>
                  </div>
                  <div className={`mt-1 truncate text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                    {conversation.subLabel}
                  </div>
                  {conversation.latestMessage ? (
                    <div className={`mt-3 line-clamp-2 text-sm ${isSelected ? "text-slate-200" : "text-slate-600"} ${!isSelected && hasUnread ? "font-medium text-slate-900" : ""}`}>
                      {conversation.latestMessage.body}
                    </div>
                  ) : null}
                  <div className={`mt-3 flex items-center justify-between text-[10px] ${isSelected ? "text-slate-400" : "text-slate-400"}`}>
                    <span>{conversation.latestMessage?.senderName || ""}</span>
                    <span>{formatDateTime(conversation.lastMessageAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          {!selectedConversation && !selectedPreview ? (
            <p className="text-sm text-slate-600">Choose a conversation to read and reply.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {selectedConversation?.residentName || selectedPreview?.label || "Conversation"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedConversation?.residentEmail || selectedPreview?.subLabel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateStatus("OPEN")}
                    disabled={loading || selectedConversation?.status === "OPEN"}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                  >
                    Reopen
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateStatus("CLOSED")}
                    disabled={loading || selectedConversation?.status === "CLOSED"}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl border p-4 ${
                      message.senderRole === "RESIDENT"
                        ? "border-sky-200 bg-sky-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{authorLabel(message)}</div>
                      <div className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
                    {message.pagePath ? (
                      <div className="mt-2 text-xs text-slate-500">Sent from: {message.pagePath}</div>
                    ) : null}
                  </div>
                ))}
              </div>

              <form onSubmit={sendReply} className="mt-4">
                <label className="block text-sm font-medium text-slate-700">
                  Reply
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={4}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                    placeholder="Write a reply as owner or manager..."
                  />
                </label>
                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={loading || !selectedConversationId}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {loading ? "Saving..." : "Send reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
