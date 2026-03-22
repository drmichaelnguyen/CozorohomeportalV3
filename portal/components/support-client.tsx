"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";

type SupportConversation = {
  id: string;
  residentEmail: string;
  residentName: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string;
  createdAt: string;
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

function senderLabel(message: SupportMessage, sessionEmail: string) {
  if (message.senderRole === "OWNER" || message.senderRole === "MANAGER") {
    return "Cozoro";
  }

  return message.senderEmail === sessionEmail ? "You" : message.senderName || "Resident";
}

export function SupportClient() {
  const { sessionEmail } = usePortalSession();
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  async function loadConversation() {
    if (!sessionEmail.trim()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/support/conversation?email=${encodeURIComponent(sessionEmail.trim().toLowerCase())}`
      );
      const data = (await response.json()) as {
        conversation?: SupportConversation;
        messages?: SupportMessage[];
        error?: string;
      };

      if (!response.ok) {
        setStatus(data.error ?? "Unable to load support chat.");
        return;
      }

      setConversation(data.conversation ?? null);
      setMessages(data.messages ?? []);

      if (data.conversation?.id) {
        void fetch(`${API_BASE_URL}/support/conversations/${encodeURIComponent(data.conversation.id)}/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: sessionEmail.trim().toLowerCase()
          })
        });
      }
    } catch {
      setStatus("Unable to load support chat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversation();
  }, [sessionEmail]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = draft.trim();
    if (!body) {
      setStatus("Please enter a message first.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      const response = await fetch(`${API_BASE_URL}/support/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: sessionEmail.trim().toLowerCase(),
          body,
          pagePath: window.location.pathname
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? "Unable to send your message.");
        return;
      }

      setDraft("");
      setStatus("Message sent.");
      await loadConversation();
    } catch {
      setStatus("Unable to send your message.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Support Chat</h1>
        <p className="mt-2 text-sm text-slate-600">
          Send a message here and the owner or any manager can reply in the same conversation.
        </p>
        {conversation ? (
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-slate-100 px-3 py-1">Status: {conversation.status}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              Last update: {formatDateTime(conversation.lastMessageAt)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? <p className="text-sm text-slate-600">Loading your conversation...</p> : null}

        {!loading ? (
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
                No messages yet. Start the conversation and your owner or managers will see it in their shared inbox.
              </div>
            ) : (
              messages.map((message) => {
                const isResident = message.senderRole === "RESIDENT";
                const isCozoroReply = message.senderRole === "OWNER" || message.senderRole === "MANAGER";
                return (
                  <div
                    key={message.id}
                    className={`rounded-2xl border p-4 ${
                      isResident ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {isCozoroReply ? (
                          <span
                            aria-hidden="true"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-lg shadow-sm"
                            title="Cozoro Bee"
                          >
                            🐝
                          </span>
                        ) : null}
                        <span>{senderLabel(message, sessionEmail.trim().toLowerCase())}</span>
                      </div>
                      <div className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
                    {message.pagePath ? (
                      <div className="mt-2 text-xs text-slate-500">Sent from: {message.pagePath}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6">
          <label className="block text-sm font-medium text-slate-700">
            Message
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
              placeholder="Ask a question, report a problem, or request help..."
            />
          </label>

          {status ? <p className="mt-3 text-sm text-slate-700">{status}</p> : null}

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={submitting || !sessionEmail.trim()}
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send message"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
