"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

type InboxFolder = "potential" | "ai_notes";

function hasPhone(item: Pick<WebLeadListItem, "phone">) {
  return Boolean(item.phone?.trim());
}

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
  const [folder, setFolder] = useState<InboxFolder>("potential");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebLeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const potentialItems = useMemo(() => items.filter((item) => hasPhone(item)), [items]);
  const aiNoteItems = useMemo(() => items.filter((item) => !hasPhone(item)), [items]);
  const visibleItems = folder === "potential" ? potentialItems : aiNoteItems;

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
        if (hasPhone(data.conversation)) setFolder("potential");
        else setFolder("ai_notes");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open");
      }
    },
    [operatorEmail]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    if (!visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setDetail(null);
    }
  }, [selectedId, visibleItems]);

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

  const backToList = (
    <button
      type="button"
      onClick={() => {
        setSelectedId(null);
        setDetail(null);
      }}
      className="-ml-1 flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 lg:hidden"
    >
      <span aria-hidden="true">←</span>
      {language === "vi" ? "Hộp thư" : "Inbox"}
    </button>
  );

  return (
    <div className="flex h-[min(75dvh,720px)] min-h-[420px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <aside
        className={`${selectedId ? "hidden" : "flex"} w-full flex-col border-slate-200 lg:flex lg:w-[20rem] lg:shrink-0 lg:border-r`}
      >
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

        <div className="grid grid-cols-2 gap-1 border-b border-slate-100 p-2">
          <button
            type="button"
            onClick={() => setFolder("potential")}
            className={`rounded-2xl px-2.5 py-2 text-left transition ${
              folder === "potential" ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-slate-50"
            }`}
          >
            <p
              className={`text-[11px] font-semibold ${
                folder === "potential" ? "text-emerald-800" : "text-slate-700"
              }`}
            >
              {language === "vi" ? "Tiềm năng" : "Potential"}
            </p>
            <p className={`mt-0.5 text-[10px] ${folder === "potential" ? "text-emerald-700" : "text-slate-400"}`}>
              {language === "vi" ? `Có SĐT · ${potentialItems.length}` : `Has phone · ${potentialItems.length}`}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setFolder("ai_notes")}
            className={`rounded-2xl px-2.5 py-2 text-left transition ${
              folder === "ai_notes" ? "bg-slate-100 ring-1 ring-slate-300" : "hover:bg-slate-50"
            }`}
          >
            <p
              className={`text-[11px] font-semibold ${
                folder === "ai_notes" ? "text-slate-800" : "text-slate-700"
              }`}
            >
              {language === "vi" ? "Ghi chú AI" : "AI notes"}
            </p>
            <p className={`mt-0.5 text-[10px] ${folder === "ai_notes" ? "text-slate-600" : "text-slate-400"}`}>
              {language === "vi" ? `Chưa SĐT · ${aiNoteItems.length}` : `No phone · ${aiNoteItems.length}`}
            </p>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !items.length ? (
            <p className="p-4 text-sm text-slate-400">{language === "vi" ? "Đang tải…" : "Loading…"}</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-600">{error}</p> : null}
          {!loading && !visibleItems.length ? (
            <p className="p-4 text-sm text-slate-400">
              {folder === "potential"
                ? language === "vi"
                  ? "Chưa có khách để lại số điện thoại."
                  : "No chats with a phone number yet."
                : language === "vi"
                  ? "Chưa có hội thoại không có SĐT."
                  : "No phone-less chats yet."}
            </p>
          ) : null}
          {visibleItems.map((item) => {
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
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{label}</p>
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
                  {hasPhone(item) ? (
                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">
                      {language === "vi" ? "Có SĐT" : "Phone"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {language === "vi" ? "Chưa SĐT" : "No phone"}
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

      <section className={`${selectedId ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
        {!c ? (
          <>
            {selectedId ? (
              <header className="border-b border-slate-100 px-3 py-2 lg:hidden">{backToList}</header>
            ) : null}
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
              {selectedId
                ? language === "vi"
                  ? "Đang tải hội thoại…"
                  : "Loading conversation…"
                : language === "vi"
                  ? "Chọn một hội thoại để xem."
                  : "Select a conversation."}
            </div>
          </>
        ) : (
          <>
            <header className="border-b border-slate-100 px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-1.5">
                  {backToList}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                      {c.guestName || c.phone || c.facebook || c.conversationKey}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
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
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      {hasPhone(c)
                        ? language === "vi"
                          ? "Thư mục: Tiềm năng (có SĐT)"
                          : "Folder: Potential (has phone)"
                        : language === "vi"
                          ? "Thư mục: Ghi chú AI (chưa SĐT)"
                          : "Folder: AI notes (no phone)"}
                    </p>
                    {c.lastQuoteVnd != null ? (
                      <p className="mt-1 text-xs font-medium text-amber-800">
                        {language === "vi" ? "Báo giá gần nhất" : "Latest quote"}:{" "}
                        {formatMoney(c.lastQuoteVnd, language)}/mo
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
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
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-4">
              {detail?.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
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
