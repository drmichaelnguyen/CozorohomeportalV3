"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { ChatFormattedText } from "../lib/chat-markdown";
import { usePortalLanguage } from "./portal-language";

type Message = {
  role: "user" | "model";
  text: string;
};

const MAX_PERSISTED_MESSAGES = 80;
const MAX_CONTEXT_MESSAGES = 10;

function storageKey(actorEmail: string, language: "en" | "vi") {
  return `cozoro-ai-manager-owner-chat:${actorEmail.trim().toLowerCase()}:${language}`;
}

function parseStoredMessages(raw: string): Message[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Message[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      if (m.role !== "user" && m.role !== "model") continue;
      if (typeof m.text !== "string") continue;
      out.push({ role: m.role, text: m.text });
    }
    return out;
  } catch {
    return [];
  }
}

function loadStoredMessages(actorEmail: string, language: "en" | "vi"): Message[] {
  const email = actorEmail.trim().toLowerCase();
  if (!email) return [];
  try {
    const raw = localStorage.getItem(storageKey(email, language));
    if (!raw) return [];
    return parseStoredMessages(raw);
  } catch {
    return [];
  }
}

function saveMessages(actorEmail: string, language: "en" | "vi", messages: Message[]) {
  const email = actorEmail.trim().toLowerCase();
  if (!email) return;
  try {
    localStorage.setItem(storageKey(email, language), JSON.stringify(messages.slice(-MAX_PERSISTED_MESSAGES)));
  } catch {
    // ignore
  }
}

function removeStoredMessages(actorEmail: string, language: "en" | "vi") {
  const email = actorEmail.trim().toLowerCase();
  if (!email) return;
  try {
    localStorage.removeItem(storageKey(email, language));
  } catch {
    // ignore
  }
}

export function ManagerAiManagerOwnerChat({
  actorEmail,
  onActionComplete
}: {
  actorEmail: string;
  /** Refresh Settings / action logs after tools that change state. */
  onActionComplete?: () => void;
}) {
  const { t, language } = usePortalLanguage();
  const quickPrompts = useMemo(
    () => [
      t("aiManagerChatQuick1"),
      t("aiManagerChatQuick2"),
      t("aiManagerChatQuick3"),
      t("aiManagerChatQuick4")
    ],
    [language, t]
  );

  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages(actorEmail, language));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(loadStoredMessages(actorEmail, language));
  }, [actorEmail, language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function updateMessages(next: Message[]) {
    setMessages(next);
    saveMessages(actorEmail, language, next);
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", text: userText }];
    updateMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const contextWindow = nextMessages.slice(-MAX_CONTEXT_MESSAGES);
      const response = await fetch(`${API_BASE_URL}/manager/ai-manager/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail,
          language,
          history: contextWindow.map((m) => ({ role: m.role, text: m.text }))
        })
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || data.error) {
        updateMessages([
          ...nextMessages,
          { role: "model", text: data.error ?? t("errorSomethingWrong") }
        ]);
        return;
      }
      updateMessages([...nextMessages, { role: "model", text: data.reply ?? "(no response)" }]);
      onActionComplete?.();
    } catch {
      updateMessages([...nextMessages, { role: "model", text: t("errorConnection") }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    removeStoredMessages(actorEmail, language);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-teal-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-teal-100 bg-teal-700 px-3 py-2 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t("aiManagerChatTitle")}</p>
          <p className="truncate text-[11px] text-teal-100">{t("aiManagerChatHint")}</p>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={clearChat}
            className="shrink-0 rounded-md border border-white/40 bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
          >
            {t("aiManagerChatClear")}
          </button>
        ) : null}
      </div>

      <div className="flex max-h-80 min-h-44 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-slate-500">{t("aiManagerChatEmpty")}</p>
            <div className="flex flex-col gap-1.5">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:border-teal-300 hover:bg-teal-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={`${msg.role}-${index}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-teal-700 text-white"
                    : "rounded-tl-sm bg-slate-100 text-slate-900"
                }`}
              >
                {msg.role === "model" ? (
                  <ChatFormattedText text={msg.text} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                )}
              </div>
            </div>
          ))
        )}
        {loading ? <p className="text-xs text-slate-500">{t("aiManagerChatThinking")}</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("aiManagerChatPlaceholder")}
            className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={loading}
          />
          <button
            type="button"
            disabled={loading || !input.trim()}
            onClick={() => void sendMessage()}
            className="self-end rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("aiManagerChatSend")}
          </button>
        </div>
      </div>
    </div>
  );
}
