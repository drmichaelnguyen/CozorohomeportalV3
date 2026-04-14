"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Message = {
  role: "user" | "model";
  text: string;
};

const MAX_STORED_MESSAGES = 10;

function storageKey(email: string) {
  return `cozoro-resident-portal-ai:${email.trim().toLowerCase()}`;
}

function loadStored(email: string): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Message[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => (m.role === "user" || m.role === "model") && typeof m.text === "string");
  } catch {
    return [];
  }
}

function saveStored(email: string, messages: Message[]) {
  try {
    localStorage.setItem(storageKey(email), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // ignore
  }
}

export function ResidentPortalAiBee({ email }: { email: string }) {
  const { language, t } = usePortalLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const normalized = email.trim().toLowerCase();

  const welcome = useMemo(
    () =>
      language === "vi"
        ? "Xin chào! Mình là Cozoro AI. Mình chỉ truy cập dữ liệu của đúng email đăng nhập của bạn (giặt sấy, lịch vệ sinh, tiền thuê/coins, thanh toán). Bạn muốn hỏi gì?"
        : "Hi! I'm Cozoro AI. I only access data tied to your logged-in email (laundry, cleaning schedule, rent/coins, payments). What would you like to know?",
    [language]
  );

  useEffect(() => {
    if (!open || !normalized) return;
    const stored = loadStored(normalized);
    setMessages(stored.length > 0 ? stored : [{ role: "model", text: welcome }]);
  }, [open, normalized, welcome]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const updateMessages = useCallback(
    (next: Message[]) => {
      setMessages(next);
      if (normalized) saveStored(normalized, next);
    },
    [normalized]
  );

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading || !normalized) return;

    const prior = messages.length > 0 ? messages : [{ role: "model" as const, text: welcome }];
    const base = [...prior, { role: "user", text: userText }];

    updateMessages(base);
    setInput("");
    setLoading(true);
    setErrorBanner("");

    try {
      const contextWindow = base.slice(-MAX_STORED_MESSAGES);
      const res = await fetch(`${API_BASE_URL}/resident/portal-ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          language,
          history: contextWindow.map((m) => ({ role: m.role, text: m.text }))
        })
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || data.error) {
        setErrorBanner(data.error ?? t("errorSomethingWrong", "Something went wrong."));
        updateMessages([...base, { role: "model", text: data.error ?? t("errorSomethingWrong", "Something went wrong.") }]);
        return;
      }
      const reply = (data.reply ?? "").trim() || "…";
      updateMessages([...base, { role: "model", text: reply }]);
    } catch {
      const msg = t("errorSomethingWrong", "Something went wrong.");
      setErrorBanner(msg);
      updateMessages([...base, { role: "model", text: msg }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("residentAiBeeTitle")}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-300 text-lg shadow-md transition-transform hover:scale-105 hover:bg-amber-200 active:scale-95"
        aria-label={t("residentAiBeeTitle")}
      >
        <span aria-hidden className="select-none">
          🐝
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[120] flex flex-col bg-white">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500 bg-amber-300 text-lg">🐝</span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-amber-950">{t("residentAiTitle")}</h2>
                <p className="truncate text-[10px] font-medium text-amber-900/80">{t("residentAiSubtitle")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-200/80"
            >
              {t("close")}
            </button>
          </header>

          <main className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={`${i}-${m.text.slice(0, 24)}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    m.role === "user" ? "bg-slate-900 text-white rounded-tr-sm" : "border border-amber-200 bg-white text-slate-800 rounded-tl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-500">…</div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </main>

          {errorBanner ? <p className="shrink-0 bg-rose-50 px-4 py-2 text-center text-xs font-medium text-rose-700">{errorBanner}</p> : null}

          <footer className="shrink-0 border-t border-slate-200 bg-white p-3">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("residentAiPlaceholder")}
                rows={2}
                disabled={loading}
                className="min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-amber-950 shadow disabled:opacity-40"
              >
                {t("send")}
              </button>
            </form>
          </footer>
        </div>
      ) : null}
    </>
  );
}
