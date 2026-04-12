"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Message = {
  role: "user" | "model";
  text: string;
  navigateTo?: string;
};

type ManagerView =
  | "overview"
  | "client_list"
  | "owners_employees"
  | "support_chat"
  | "feedbacks"
  | "admin_cleaning"
  | "scheduling"
  | "controller"
  | "short_term"
  | "settings"
  | "coins"
  | "fines"
  | "payments";

const getLocalizedViewLabels = (t: (key: any, ...args: any[]) => string) => ({
  client_list: t("clientListTab", "Client List"),
  coins: t("coinsTab", "Coins"),
  fines: t("finesTab", "Fines"),
  payments: t("paymentsTab", "Payments"),
  support_chat: t("supportChatTab", "Support Chat"),
  admin_cleaning: t("cleaningTab", "Cleaning"),
  settings: t("settingsTab", "Settings"),
  controller: t("controllerTab", "Device Controller")
});

const QUICK_PROMPTS = [
  "Which beds are available in D7?",
  "Add 5 coins to bed 12 D7",
  "Fine bed 3 D2 — 50,000 VND for messy kitchen",
  "Create rent receipt for bed 7 D7 — 1,500,000 VND"
];

export function ManagerAiChat({
  operatorEmail,
  onNavigate
}: {
  operatorEmail: string;
  onNavigate?: (view: string) => void;
}) {
  const { t } = usePortalLanguage();
  const VIEW_LABELS = getLocalizedViewLabels(t);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      textareaRef.current?.focus();
    }
  }, [open, messages]);

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", text: userText }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/manager/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorEmail,
          history: nextMessages.map((m) => ({ role: m.role, text: m.text }))
        })
      });

      const data = await res.json() as { reply?: string; navigateTo?: string; error?: string };

      if (!res.ok || data.error) {
        setMessages((prev) => [...prev, { role: "model", text: data.error ?? t("errorSomethingWrong") }]);
        return;
      }

      const modelMsg: Message = {
        role: "model",
        text: data.reply ?? "(no response)",
        navigateTo: data.navigateTo
      };
      setMessages((prev) => [...prev, modelMsg]);

      if (data.navigateTo && onNavigate) {
        onNavigate(data.navigateTo);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "model", text: t("errorConnection") }]);
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

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 transition-colors sm:bottom-6 sm:right-6"
        aria-label={t("aiAssistantLabel")}
        title={t("aiAssistantLabel")}
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

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-40 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-20 sm:right-6">
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-100 bg-sky-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span className="text-sm font-semibold">Cozoro AI</span>
              <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{t("aiAssistantBeta")}</span>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium text-sky-200 hover:bg-sky-500 transition-colors"
                >
                  {t("clearChat")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-sky-200 hover:bg-sky-500 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 text-center">{t("aiAssistantPrompt")}</p>
                <div className="flex flex-col gap-1.5">
                  {QUICK_PROMPTS.map((q) => (
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
                        {t("goToLabel", { view: VIEW_LABELS[msg.navigateTo] ?? msg.navigateTo })}
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
          </div>
        </div>
      )}
    </>
  );
}
