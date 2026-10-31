"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type AiManagerCapabilities = {
  ownerReports: boolean;
  answerChat: boolean;
  manageFines: boolean;
  scheduleAssignment: boolean;
};

type AiManagerConfig = {
  enabled: boolean;
  email: string;
  displayName: string;
  mode: "report_only" | "assist";
  capabilities: AiManagerCapabilities;
  reportEmails: string[];
  intervalHours: number;
  accountProvisionedAt: string | null;
  lastTickAt: string | null;
  lastReportId: string | null;
  lastError: string | null;
};

type RecentReport = {
  id: string;
  createdAt: string;
  trigger: string;
  mode: string;
  emailedTo: string[];
  emailErrors: string[];
  supportUnreadThreads: number;
  pendingContractApprovals: number;
  cleaningPendingAudit: number;
  cleaningOverdueAssigned: number;
  hostelPendingBookings: number;
  acComfortAlerts: number;
  summaryPreview: string;
};

type ActionLogRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  entityId: string | null;
  entityLabel: string | null;
  details: string | null;
  createdAt: string;
};

type StatusResponse = {
  config: AiManagerConfig;
  effectiveReportEmails: string[];
  recentReports: RecentReport[];
  recentActionLogs?: ActionLogRow[];
  error?: string;
};

type FullReport = {
  id: string;
  createdAt: string;
  summaryText: string;
  suggestedDrafts: Array<{ conversationId: string; residentEmail: string; draft: string }>;
  emailedTo: string[];
  emailErrors: string[];
};

function formatWhen(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const DEFAULT_CAPABILITIES: AiManagerCapabilities = {
  ownerReports: true,
  answerChat: false,
  manageFines: false,
  scheduleAssignment: false
};

function normalizeCapabilities(value?: Partial<AiManagerCapabilities> | null): AiManagerCapabilities {
  return {
    ownerReports: value?.ownerReports ?? DEFAULT_CAPABILITIES.ownerReports,
    answerChat: value?.answerChat ?? DEFAULT_CAPABILITIES.answerChat,
    manageFines: value?.manageFines ?? DEFAULT_CAPABILITIES.manageFines,
    scheduleAssignment: value?.scheduleAssignment ?? DEFAULT_CAPABILITIES.scheduleAssignment
  };
}

export function ManagerAiManagerPanel({ actorEmail }: { actorEmail: string }) {
  const { t } = usePortalLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState<AiManagerConfig | null>(null);
  const [effectiveReportEmails, setEffectiveReportEmails] = useState<string[]>([]);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [recentActionLogs, setRecentActionLogs] = useState<ActionLogRow[]>([]);
  const [reportEmailsText, setReportEmailsText] = useState("");
  const [password, setPassword] = useState("");
  const [selectedReport, setSelectedReport] = useState<FullReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/ai-manager?actorEmail=${encodeURIComponent(actorEmail)}`
      );
      const body = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(body.error ?? "Unable to load AI Manager.");
      setConfig({
        ...body.config,
        capabilities: normalizeCapabilities(body.config.capabilities)
      });
      setEffectiveReportEmails(body.effectiveReportEmails ?? []);
      setRecentReports(body.recentReports ?? []);
      setRecentActionLogs(body.recentActionLogs ?? []);
      setReportEmailsText((body.config.reportEmails ?? []).join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load AI Manager.");
    } finally {
      setLoading(false);
    }
  }, [actorEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    if (!config) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const reportEmails = reportEmailsText
        .split(/[,;\s]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await fetch(`${API_BASE_URL}/manager/ai-manager`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail,
          enabled: config.enabled,
          email: config.email,
          displayName: config.displayName,
          mode: config.mode,
          capabilities: config.capabilities,
          intervalHours: config.intervalHours,
          reportEmails,
          ...(password.trim().length >= 8 ? { password: password.trim() } : {})
        })
      });
      const body = (await response.json()) as { ok?: boolean; config?: AiManagerConfig; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save AI Manager settings.");
      setPassword("");
      setMessage(t("aiManagerSaved"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save AI Manager settings.");
    } finally {
      setSaving(false);
    }
  }

  async function provisionAccount() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/manager/ai-manager/ensure-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail,
          ...(password.trim().length >= 8 ? { password: password.trim() } : {})
        })
      });
      const body = (await response.json()) as {
        ok?: boolean;
        generatedPassword?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to provision account.");
      if (body.generatedPassword) {
        setMessage(`${t("aiManagerAccountReady")} Password: ${body.generatedPassword}`);
      } else {
        setMessage(t("aiManagerAccountReady"));
      }
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to provision account.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/manager/ai-manager/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, force: true })
      });
      const body = (await response.json()) as {
        skipped?: boolean;
        reason?: string;
        report?: { id: string };
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "AI Manager run failed.");
      if (body.skipped) {
        setMessage(body.reason || t("aiManagerRunSkipped"));
      } else {
        setMessage(`${t("aiManagerRunDone")} (${body.report?.id ?? "ok"})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI Manager run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function openReport(id: string) {
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/ai-manager/reports/${encodeURIComponent(id)}?actorEmail=${encodeURIComponent(actorEmail)}`
      );
      const body = (await response.json()) as { report?: FullReport; error?: string };
      if (!response.ok || !body.report) throw new Error(body.error ?? "Report not found.");
      setSelectedReport(body.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open report.");
    }
  }

  if (loading && !config) {
    return <p className="text-sm text-slate-600">{t("refreshing")}</p>;
  }

  if (!config) {
    return <p className="text-sm text-rose-700">{error || t("aiManagerLoadFailed")}</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{t("aiManagerTitle")}</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("aiManagerDesc")}</p>
      </div>

      {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
          />
          <span>
            <span className="font-medium text-slate-900">{t("aiManagerEnabled")}</span>
            <span className="mt-0.5 block text-slate-500">{t("aiManagerEnabledHint")}</span>
          </span>
        </label>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm md:col-span-2">
          <p className="font-medium text-slate-900">{t("aiManagerCapabilities")}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t("aiManagerCapabilitiesHint")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["ownerReports", "aiManagerCapOwnerReports", "aiManagerCapOwnerReportsHint"],
                ["answerChat", "aiManagerCapAnswerChat", "aiManagerCapAnswerChatHint"],
                ["manageFines", "aiManagerCapManageFines", "aiManagerCapManageFinesHint"],
                ["scheduleAssignment", "aiManagerCapSchedule", "aiManagerCapScheduleHint"]
              ] as const
            ).map(([key, labelKey, hintKey]) => (
              <label key={key} className="flex items-start gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={config.capabilities[key]}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      capabilities: { ...config.capabilities, [key]: event.target.checked }
                    })
                  }
                />
                <span>
                  <span className="font-medium text-slate-900">{t(labelKey)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{t(hintKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerMode")}</span>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            value={config.mode}
            onChange={(event) =>
              setConfig({
                ...config,
                mode: event.target.value === "assist" ? "assist" : "report_only"
              })
            }
          >
            <option value="report_only">{t("aiManagerModeReportOnly")}</option>
            <option value="assist">{t("aiManagerModeAssist")}</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerAccountEmail")}</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={config.email}
            onChange={(event) => setConfig({ ...config, email: event.target.value })}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerDisplayName")}</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={config.displayName}
            onChange={(event) => setConfig({ ...config, displayName: event.target.value })}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerIntervalHours")}</span>
          <input
            type="number"
            min={1}
            max={168}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={config.intervalHours}
            onChange={(event) =>
              setConfig({ ...config, intervalHours: Number(event.target.value) || config.intervalHours })
            }
          />
        </label>

        <label className="block text-sm md:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerReportEmails")}</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={reportEmailsText}
            onChange={(event) => setReportEmailsText(event.target.value)}
            placeholder="owner@example.com, other@example.com"
          />
          <span className="mt-1 block text-xs text-slate-500">
            {t("aiManagerReportEmailsHint")}: {effectiveReportEmails.join(", ") || "—"}
          </span>
        </label>

        <label className="block text-sm md:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">{t("aiManagerPassword")}</span>
          <input
            type="password"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("aiManagerPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveSettings()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? t("saving") : t("aiManagerSave")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void provisionAccount()}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
        >
          {t("aiManagerProvision")}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void runNow()}
          className="rounded-md border border-teal-700 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 disabled:opacity-60"
        >
          {running ? t("aiManagerRunning") : t("aiManagerRunNow")}
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
        <p>
          <span className="font-medium">{t("aiManagerLastTick")}:</span> {formatWhen(config.lastTickAt)}
        </p>
        <p className="mt-1">
          <span className="font-medium">{t("aiManagerAccountSince")}:</span>{" "}
          {formatWhen(config.accountProvisionedAt)}
        </p>
        {config.lastError ? (
          <p className="mt-1 text-rose-700">
            <span className="font-medium">{t("aiManagerLastError")}:</span> {config.lastError}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">{t("aiManagerLoginHint")}</p>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">{t("aiManagerActionLogs")}</h4>
        <p className="mb-2 text-xs text-slate-500">{t("aiManagerActionLogsHint")}</p>
        {recentActionLogs.length === 0 ? (
          <p className="text-sm text-slate-500">{t("aiManagerNoActionLogs")}</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-auto">
            {recentActionLogs.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{entry.action}</span>
                  <span className="text-xs text-slate-500">{formatWhen(entry.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {(entry.actorEmail || entry.actorName || "—") +
                    (entry.actorRole ? ` · ${entry.actorRole}` : "")}
                </p>
                {entry.details ? (
                  <p className="mt-1 break-words text-xs text-slate-600">{entry.details}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">{t("aiManagerRecentReports")}</h4>
        {recentReports.length === 0 ? (
          <p className="text-sm text-slate-500">{t("aiManagerNoReports")}</p>
        ) : (
          <ul className="space-y-2">
            {recentReports.map((report) => (
              <li key={report.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatWhen(report.createdAt)} · {report.trigger} · {report.mode}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      support {report.supportUnreadThreads} · contracts {report.pendingContractApprovals} ·
                      audit {report.cleaningPendingAudit} · overdue {report.cleaningOverdueAssigned} · hostel{" "}
                      {report.hostelPendingBookings} · AC {report.acComfortAlerts}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{report.summaryPreview}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                    onClick={() => void openReport(report.id)}
                  >
                    {t("aiManagerOpenReport")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedReport ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-base font-semibold text-slate-900">{t("aiManagerReportDetail")}</h4>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                onClick={() => setSelectedReport(null)}
              >
                {t("close")}
              </button>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              {selectedReport.id} · {formatWhen(selectedReport.createdAt)}
            </p>
            <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">
              {selectedReport.summaryText}
            </pre>
            {selectedReport.suggestedDrafts?.length ? (
              <div className="mt-4 space-y-3">
                <h5 className="text-sm font-semibold text-slate-900">{t("aiManagerSuggestedDrafts")}</h5>
                {selectedReport.suggestedDrafts.map((draft) => (
                  <div key={draft.conversationId} className="rounded-md border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-800">{draft.residentEmail}</p>
                    <pre className="mt-2 whitespace-pre-wrap text-slate-700">{draft.draft}</pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
