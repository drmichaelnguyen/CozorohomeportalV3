"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type WebLeadListItem = {
  id: string;
  conversationKey: string;
  guestName: string | null;
  phone: string | null;
  facebook: string | null;
  otherContact: string | null;
  preferredBranch: string | null;
  stayMonths: number | null;
  moveInHint: string | null;
  occupationHint: string | null;
  lastQuoteVnd: number | null;
  summary: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string;
  latestMessage: { role: string; body: string; createdAt: string } | null;
};

type WebLeadDetail = {
  conversation: WebLeadListItem & { createdAt: string };
  messages: Array<{ id: string; role: "GUEST" | "BOT" | "STAFF"; body: string; createdAt: string }>;
};

function formatMoney(vnd: number | null | undefined, lang: string) {
  if (vnd == null) return "—";
  return new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US").format(vnd) + "₫";
}

function formatWhen(value: string) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ManagerWebLeadInbox({
  operatorEmail,
  enabled
}: {
  operatorEmail: string;
  enabled: boolean;
}) {
  const { t, language } = usePortalLanguage();
  const [items, setItems] = useState<WebLeadListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebLeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!enabled || !operatorEmail) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/web-leads?operatorEmail=${encodeURIComponent(operatorEmail)}`
      );
      const data = (await res.json()) as { conversations?: WebLeadListItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data.conversations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enabled, operatorEmail]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!operatorEmail) return;
      setSelectedId(id);
      try {
        const res = await fetch(
          `${API_BASE_URL}/manager/web-leads/${encodeURIComponent(id)}?operatorEmail=${encodeURIComponent(operatorEmail)}`
        );
        const data = (await res.json()) as WebLeadDetail & { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to open");
        setDetail(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open");
      }
    },
    [operatorEmail]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function setStatus(status: "OPEN" | "CLOSED") {
    if (!selectedId || !operatorEmail) return;
    const res = await fetch(`${API_BASE_URL}/manager/web-leads/${encodeURIComponent(selectedId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorEmail, status })
    });
    if (res.ok) {
      await loadList();
      await loadDetail(selectedId);
    }
  }

  const c = detail?.conversation;

  return (
    <div className="flex h-[min(70vh,720px)] min-h-[420px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <aside className="flex w-full max-w-[320px] flex-col border-r border-slate-200">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("webAiChatTab")}</p>
            <p className="text-xs text-slate-500">
              {language === "vi" ? "Chat AI từ www.cozorohome.com" : "AI chats from www.cozorohome.com"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {language === "vi" ? "Làm mới" : "Refresh"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !items.length ? (
            <p className="p-4 text-sm text-slate-400">{language === "vi" ? "Đang tải…" : "Loading…"}</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-600">{error}</p> : null}
          {!loading && !items.length ? (
            <p className="p-4 text-sm text-slate-400">
              {language === "vi" ? "Chưa có hội thoại web AI." : "No web AI conversations yet."}
            </p>
          ) : null}
          {items.map((item) => {
            const label =
              item.guestName ||
              item.phone ||
              item.facebook ||
              item.conversationKey.slice(0, 18);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void loadDetail(item.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedId === item.id ? "bg-sky-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
                  <span className="shrink-0 text-[10px] text-slate-400">{formatWhen(item.lastMessageAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {item.latestMessage?.body || item.summary || "—"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.status === "CLOSED" ? (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      Closed
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      Open
                    </span>
                  )}
                  {item.lastQuoteVnd != null ? (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      {formatMoney(item.lastQuoteVnd, language)}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!c ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-400">
            {language === "vi" ? "Chọn một hội thoại để xem." : "Select a conversation."}
          </div>
        ) : (
          <>
            <header className="border-b border-slate-100 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {c.guestName || c.phone || c.facebook || c.conversationKey}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {[
                      c.phone ? `☎ ${c.phone}` : null,
                      c.facebook ? `FB ${c.facebook}` : null,
                      c.stayMonths ? `${c.stayMonths} mo` : null,
                      c.occupationHint,
                      c.preferredBranch,
                      c.moveInHint
                    ]
                      .filter(Boolean)
                      .join(" · ") || (language === "vi" ? "Chưa có liên hệ" : "No contact yet")}
                  </p>
                  {c.lastQuoteVnd != null ? (
                    <p className="mt-1 text-xs font-medium text-amber-800">
                      {language === "vi" ? "Báo giá gần nhất" : "Latest quote"}:{" "}
                      {formatMoney(c.lastQuoteVnd, language)}/mo
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {c.status === "OPEN" ? (
                    <button
                      type="button"
                      onClick={() => void setStatus("CLOSED")}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {language === "vi" ? "Đóng" : "Close"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void setStatus("OPEN")}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {language === "vi" ? "Mở lại" : "Reopen"}
                    </button>
                  )}
                </div>
              </div>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
              {detail?.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "GUEST"
                      ? "ml-auto bg-teal-600 text-white"
                      : m.role === "STAFF"
                        ? "bg-indigo-100 text-indigo-950"
                        : "bg-white text-slate-800 shadow-sm"
                  }`}
                >
                  <p className="mb-0.5 text-[10px] font-semibold uppercase opacity-70">
                    {m.role === "GUEST"
                      ? language === "vi"
                        ? "Khách"
                        : "Guest"
                      : m.role === "BOT"
                        ? "Cozoro AI"
                        : "Staff"}
                  </p>
                  {m.body}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
