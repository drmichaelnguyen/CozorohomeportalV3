"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Message = {
  role: "user" | "model";
  text: string;
};

const MAX_STORED_MESSAGES = 10;

type UiLang = "en" | "vi";

function storageKey(email: string, language: UiLang) {
  return `cozoro-resident-bee:${email.trim().toLowerCase()}:${language}`;
}

function loadStored(email: string, language: UiLang): Message[] {
  const key = storageKey(email, language);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Message[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => (m.role === "user" || m.role === "model") && typeof m.text === "string");
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return [];
  }
}

async function parseJsonResponse(res: Response): Promise<{ ok: true; data: unknown } | { ok: false }> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

function saveStored(email: string, language: UiLang, messages: Message[]) {
  try {
    localStorage.setItem(storageKey(email, language), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // ignore
  }
}

/** CozoroHome mascot — cute bee for chat launcher and header */
function CozoroBeeLogo({ className = "h-8 w-8" }: { className?: string }) {
  const uid = useId().replace(/:/g, "_");
  const gradId = `cozoroBeeBody_${uid}`;
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="22" y1="10" x2="22" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FEF9C3" />
          <stop offset="0.45" stopColor="#FDE047" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <ellipse cx="14" cy="26" rx="8" ry="11" fill="white" fillOpacity="0.93" transform="rotate(-26 14 26)" />
      <ellipse cx="30" cy="26" rx="8" ry="11" fill="white" fillOpacity="0.93" transform="rotate(26 30 26)" />
      <ellipse cx="22" cy="28" rx="11" ry="10" fill={`url(#${gradId})`} stroke="#B45309" strokeWidth="1.15" />
      <path d="M12.5 26.5h19" stroke="#0f172a" strokeWidth="1.85" strokeLinecap="round" />
      <path d="M11.5 30.5h21" stroke="#0f172a" strokeWidth="1.85" strokeLinecap="round" />
      <circle cx="17.5" cy="25" r="2.1" fill="#0f172a" />
      <circle cx="26.5" cy="25" r="2.1" fill="#0f172a" />
      <circle cx="18.1" cy="24.35" r="0.65" fill="white" />
      <circle cx="27.1" cy="24.35" r="0.65" fill="white" />
      <path d="M16.5 32.5c1.9 1.5 4.1 2.2 6.5 1.7" stroke="#0f172a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <ellipse cx="13.5" cy="29" rx="1.9" ry="1.1" fill="#fb7185" fillOpacity="0.4" />
      <ellipse cx="30.5" cy="29" rx="1.9" ry="1.1" fill="#fb7185" fillOpacity="0.4" />
      <ellipse cx="22" cy="14" rx="10" ry="9" fill="#FDE047" stroke="#CA8A04" strokeWidth="1" />
      <path d="M14 6.5l-2.5-4.8" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 6.5l2.5-4.8" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17.5" cy="13" r="1.9" fill="#0f172a" />
      <circle cx="26.5" cy="13" r="1.9" fill="#0f172a" />
      <circle cx="18.1" cy="12.35" r="0.6" fill="white" />
      <circle cx="27.1" cy="12.35" r="0.6" fill="white" />
      <path d="M18 16.5q4 1.8 8 0" stroke="#0f172a" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  );
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

  const welcome = useMemo(() => t("residentAiWelcome"), [t, language]);

  useEffect(() => {
    if (!open || !normalized) return;
    const stored = loadStored(normalized, language);
    setMessages(stored.length > 0 ? stored : [{ role: "model", text: welcome }]);
  }, [open, normalized, welcome, language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const updateMessages = useCallback(
    (next: Message[]) => {
      setMessages(next);
      if (normalized) saveStored(normalized, language, next);
    },
    [normalized, language]
  );

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading || !normalized) return;

    const prior: Message[] = messages.length > 0 ? messages : [{ role: "model", text: welcome }];
    const base: Message[] = [...prior, { role: "user", text: userText }];

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
      const parsedBody = await parseJsonResponse(res);
      if (!parsedBody.ok) {
        const hint = t("residentAiNonJsonResponse");
        setErrorBanner(hint);
        updateMessages([...base, { role: "model", text: hint }]);
        return;
      }
      const data = parsedBody.data as { reply?: string; error?: string };
      if (!res.ok || data.error) {
        setErrorBanner(data.error ?? t("errorSomethingWrong"));
        updateMessages([...base, { role: "model", text: data.error ?? t("errorSomethingWrong") }]);
        return;
      }
      const reply = (data.reply ?? "").trim() || "…";
      updateMessages([...base, { role: "model", text: reply }]);
    } catch {
      const msg = t("errorSomethingWrong");
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
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-100 shadow-md transition-transform hover:scale-105 hover:bg-amber-50 active:scale-95"
        aria-label={t("residentAiBeeTitle")}
      >
        <CozoroBeeLogo className="h-7 w-7" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] dark:bg-slate-950"
              role="dialog"
              aria-modal="true"
              aria-label={t("residentAiBeeTitle")}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/90">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-400 bg-amber-50 p-0.5 dark:border-amber-600 dark:bg-amber-900/60">
                    <CozoroBeeLogo className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold text-amber-950 dark:text-amber-100">{t("residentAiTitle")}</h2>
                    <p className="truncate text-[10px] font-medium text-amber-900/80 dark:text-amber-200/80">{t("residentAiSubtitle")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-200/80 dark:text-amber-100 dark:hover:bg-amber-800/80"
                >
                  {t("close")}
                </button>
              </header>

              <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 p-4 dark:bg-slate-900">
                {messages.map((m, i) => (
                  <div key={`${i}-${m.text.slice(0, 24)}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[min(90%,36rem)] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        m.role === "user"
                          ? "bg-slate-900 text-white rounded-tr-sm dark:bg-amber-400 dark:text-amber-950"
                          : "border border-amber-200 bg-white text-slate-800 rounded-tl-sm dark:border-amber-700/60 dark:bg-slate-800 dark:text-slate-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                    </div>
                  </div>
                ))}
                {loading ? (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-amber-700/60 dark:bg-slate-800 dark:text-slate-400">
                      <CozoroBeeLogo className="h-5 w-5 animate-pulse" />
                      <span>…</span>
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
              </main>

              {errorBanner ? (
                <p className="shrink-0 bg-rose-50 px-4 py-2 text-center text-xs font-medium text-rose-700 dark:bg-rose-950/80 dark:text-rose-200">
                  {errorBanner}
                </p>
              ) : null}

              <footer className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
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
                    rows={3}
                    disabled={loading}
                    className="min-h-[52px] max-h-40 flex-1 resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-amber-500 dark:focus:ring-amber-600/40"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="shrink-0 rounded-full bg-amber-500 px-4 py-2.5 text-xs font-bold text-amber-950 shadow disabled:opacity-40 dark:bg-amber-400 dark:text-amber-950"
                  >
                    {t("send")}
                  </button>
                </form>
              </footer>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
