"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Message = {
  role: "user" | "model";
  text: string;
  navigateTo?: string;
};

const MAX_STORED_MESSAGES = 20;
const STORAGE_KEY = "cozoro-manager-ai-chat";

const VIEW_LABEL_KEYS: Record<string, string> = {
  client_list: "managerAiViewClientList",
  coins: "managerAiViewCoins",
  fines: "managerAiViewFines",
  payments: "managerAiViewPayments",
  support_chat: "managerAiViewSupportChat",
  admin_cleaning: "managerAiViewAdminCleaning",
  settings: "managerAiViewSettings",
  controller: "managerAiViewController"
};

function loadStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

function saveMessages(messages: Message[]) {
  try {
    // Keep only the last MAX_STORED_MESSAGES
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage unavailable — silently ignore
  }
}

function ChatBody({
  operatorEmail,
  onNavigate,
  onClose
}: {
  operatorEmail: string;
  onNavigate?: (view: string) => void;
  onClose?: () => void;
}) {
  const { t, language } = usePortalLanguage();
  const quickPrompts = useMemo(
    () => [t("managerAiQuick1"), t("managerAiQuick2"), t("managerAiQuick3"), t("managerAiQuick4")],
    [language, t]
  );

  function viewLabel(viewKey: string) {
    const key = VIEW_LABEL_KEYS[viewKey];
    return key ? t(key) : viewKey;
  }

  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function updateMessages(next: Message[]) {
    setMessages(next);
    saveMessages(next);
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", text: userText }];
    updateMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      // Send only last 20 messages as context to avoid huge payloads
      const contextWindow = nextMessages.slice(-MAX_STORED_MESSAGES);
      const res = await fetch(`${API_BASE_URL}/manager/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorEmail,
          language,
          history: contextWindow.map((m) => ({ role: m.role, text: m.text }))
        })
      });

      const data = await res.json() as { reply?: string; navigateTo?: string; error?: string };

      if (!res.ok || data.error) {
        const errMessages = [...nextMessages, { role: "model" as const, text: data.error ?? t("errorSomethingWrong") }];
        updateMessages(errMessages);
        return;
      }

      const modelMsg: Message = {
        role: "model",
        text: data.reply ?? "(no response)",
        navigateTo: data.navigateTo
      };
      const withReply = [...nextMessages, modelMsg];
      updateMessages(withReply);

      if (data.navigateTo && onNavigate) {
        onNavigate(data.navigateTo);
      }
    } catch {
      const errMessages = [...nextMessages, { role: "model" as const, text: t("errorConnection") }];
      updateMessages(errMessages);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function clearChat() {
    updateMessages([]);
  }

  return (
    <>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-sky-600 px-4 py-3 text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className="text-sm font-semibold">{t("managerAiTitle")}</span>
          <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            {t("managerAiBadgeBeta")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-sky-200 hover:bg-sky-500 transition-colors"
            >
              {t("managerAiClear")}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-sky-200 hover:bg-sky-500 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex max-h-96 min-h-48 flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 text-center">{t("managerAiHintEmpty")}</p>
            <div className="flex flex-col gap-1.5">
              {quickPrompts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendMessage(q)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 hover:bg-sky-50 hover:border-sky-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-sky-600 text-white rounded-tr-sm"
                    : "bg-slate-100 text-slate-900 rounded-tl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.navigateTo && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate(msg.navigateTo!)}
                    className="mt-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-200 transition-colors"
                  >
                    {t("managerAiGoTo", undefined, { view: msg.navigateTo ? viewLabel(msg.navigateTo) : "" })}
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5">
              <div className="flex gap-1 items-center">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("askAnythingPlaceholder")}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400 max-h-24 overflow-y-auto"
            style={{ minHeight: "38px" }}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-600 text-white disabled:opacity-40 hover:bg-sky-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        {messages.length > 0 && (
          <p className="mt-1 text-[10px] text-slate-400">
            {t("managerAiHistoryNote", undefined, { count: String(messages.length), max: String(MAX_STORED_MESSAGES) })}
          </p>
        )}
      </div>
    </>
  );
}

export function ManagerAiChat({
  operatorEmail,
  onNavigate,
  inline = false
}: {
  operatorEmail: string;
  onNavigate?: (view: string) => void;
  inline?: boolean;
}) {
  const { t } = usePortalLanguage();
  const [open, setOpen] = useState(false);

  // Inline mode: render the chat body directly (no floating button)
  if (inline) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <ChatBody operatorEmail={operatorEmail} onNavigate={onNavigate} />
      </div>
    );
  }

  // Floating mode (kept for future use)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-4 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 transition-colors sm:bottom-24 sm:right-6"
        aria-label={t("managerAiOpenAria")}
        title={t("managerAiOpenAria")}
      >
        {open ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed bottom-40 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-40 sm:right-6">
          <ChatBody operatorEmail={operatorEmail} onNavigate={onNavigate} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
