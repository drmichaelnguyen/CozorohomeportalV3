"use client";

import { useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

export type AiSuggestedAction = {
  token: string;
  toolName: string;
  summary: string;
  risk: "low" | "medium" | "high";
};

type Props = {
  action: AiSuggestedAction;
  actorEmail: string;
  channel: "manager" | "resident";
  onConfirmed?: (result: { success: boolean; message: string; navigateTo?: string }) => void;
  onDismiss?: () => void;
  navigateTo?: string;
  onNavigate?: (view: string) => void;
};

export function AiSuggestedActionCard({
  action,
  actorEmail,
  channel,
  onConfirmed,
  onDismiss,
  navigateTo,
  onNavigate
}: Props) {
  const { t } = usePortalLanguage();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<"confirmed" | "dismissed" | null>(null);
  const [resultMessage, setResultMessage] = useState("");

  const riskClass =
    action.risk === "high"
      ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40"
      : action.risk === "medium"
        ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
        : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40";

  async function confirm() {
    if (loading || done) return;
    setLoading(true);
    try {
      const url =
        channel === "manager"
          ? `${API_BASE_URL}/manager/ai-chat/confirm-action`
          : `${API_BASE_URL}/resident/portal-ai-chat/confirm-action`;
      const body =
        channel === "manager"
          ? { operatorEmail: actorEmail, actionToken: action.token }
          : { email: actorEmail, actionToken: action.token };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        navigateTo?: string;
      };
      if (!res.ok || data.error) {
        setResultMessage(data.error ?? t("errorSomethingWrong"));
        setDone("confirmed");
        onConfirmed?.({ success: false, message: data.error ?? t("errorSomethingWrong") });
        return;
      }
      const message = data.message ?? t("aiActionConfirmed");
      setResultMessage(message);
      setDone("confirmed");
      onConfirmed?.({ success: Boolean(data.success), message, navigateTo: data.navigateTo });
      if (data.navigateTo && onNavigate) {
        onNavigate(data.navigateTo);
      } else if (navigateTo && onNavigate && action.toolName === "navigate") {
        onNavigate(navigateTo);
      }
    } catch {
      const msg = t("errorConnection");
      setResultMessage(msg);
      setDone("confirmed");
      onConfirmed?.({ success: false, message: msg });
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    if (loading) return;
    setDone("dismissed");
    onDismiss?.();
  }

  if (done === "dismissed") {
    return (
      <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">{t("aiActionDismissed")}</p>
    );
  }

  if (done === "confirmed") {
    return (
      <p
        className={`mt-2 text-xs font-medium ${resultMessage.includes(t("errorSomethingWrong")) || resultMessage.includes(t("errorConnection")) ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}
      >
        {resultMessage}
      </p>
    );
  }

  return (
    <div className={`mt-2 rounded-xl border px-3 py-2 ${riskClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {t("aiActionSuggested")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-800 dark:text-slate-100">{action.summary}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={loading}
          className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950"
        >
          {loading ? "…" : t("aiActionConfirm")}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={loading}
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {t("aiActionCancel")}
        </button>
      </div>
    </div>
  );
}
