"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";

export type ManagerSettingsToolsClient = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
};

type CleaningRewardApi = {
  baseRewards: Record<"KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7", number>;
  selfAssignBonusMultiplier: number;
};

const TASK_KEYS = ["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"] as const;

type Props = {
  normalizedEmail: string;
  clients: ManagerSettingsToolsClient[];
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string;
  onRefreshClients: () => Promise<void>;
};

export function ManagerSettingsTools({ normalizedEmail, clients, t, onRefreshClients }: Props) {
  const [cleaningLoading, setCleaningLoading] = useState(true);
  const [cleaningSaving, setCleaningSaving] = useState(false);
  const [cleaningError, setCleaningError] = useState("");
  const [cleaningForm, setCleaningForm] = useState<CleaningRewardApi | null>(null);

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [bulkDelta, setBulkDelta] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");

  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushWorking, setPushWorking] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  const loadCleaning = useCallback(async () => {
    setCleaningLoading(true);
    setCleaningError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/cleaning-reward-settings?actorEmail=${encodeURIComponent(normalizedEmail)}`
      );
      const data = (await res.json()) as CleaningRewardApi & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("toolsLoadFailed"));
      }
      setCleaningForm({
        baseRewards: { ...data.baseRewards },
        selfAssignBonusMultiplier: data.selfAssignBonusMultiplier
      });
    } catch (e) {
      setCleaningError(e instanceof Error ? e.message : t("toolsLoadFailed"));
      setCleaningForm(null);
    } finally {
      setCleaningLoading(false);
    }
  }, [normalizedEmail, t]);

  useEffect(() => {
    void loadCleaning();
  }, [loadCleaning]);

  const filteredClients = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.maHd.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.name || "").toLowerCase().includes(q)
    );
  }, [clients, filter]);

  const selectedMaHds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected]
  );

  const toggleOne = (maHd: string) => {
    setSelected((prev) => ({ ...prev, [maHd]: !prev[maHd] }));
  };

  const selectFiltered = () => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const c of filteredClients) {
        next[c.maHd] = true;
      }
      return next;
    });
  };

  const clearSelection = () => setSelected({});

  const taskLabel = (key: (typeof TASK_KEYS)[number]) => {
    if (key === "KITCHEN_D2") return t("toolsTaskKitchenD2");
    if (key === "KITCHEN_D7") return t("toolsTaskKitchenD7");
    return t("toolsTaskTrashD7");
  };

  const saveCleaningRewards = async () => {
    if (!cleaningForm) return;
    setCleaningSaving(true);
    setCleaningError("");
    try {
      const res = await fetch(`${API_BASE_URL}/manager/cleaning-reward-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          baseRewards: cleaningForm.baseRewards,
          selfAssignBonusMultiplier: cleaningForm.selfAssignBonusMultiplier
        })
      });
      const data = (await res.json()) as CleaningRewardApi & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("requestFailed", "Request failed"));
      }
      setCleaningForm({
        baseRewards: { ...data.baseRewards },
        selfAssignBonusMultiplier: data.selfAssignBonusMultiplier
      });
    } catch (e) {
      setCleaningError(e instanceof Error ? e.message : t("toolsLoadFailed"));
    } finally {
      setCleaningSaving(false);
    }
  };

  const runBulkCoins = async () => {
    if (!selectedMaHds.length) {
      setBulkMessage(t("toolsSelectResidentsFirst", "Select at least one resident."));
      return;
    }
    const delta = Math.trunc(Number(bulkDelta));
    if (!Number.isFinite(delta) || delta === 0) {
      setBulkMessage(t("toolsEnterNonZeroDelta", "Enter a non-zero coin change."));
      return;
    }
    const reason = bulkReason.trim();
    if (!reason) {
      setBulkMessage(t("toolsEnterReason", "Enter a reason."));
      return;
    }
    setBulkWorking(true);
    setBulkMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/manager/coins/bulk-adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          reason,
          items: selectedMaHds.map((maHd) => ({ maHd, delta }))
        })
      });
      const data = (await res.json()) as {
        error?: string;
        results?: Array<{ maHd: string; ok: boolean; error?: string }>;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Bulk adjust failed");
      }
      const failed = (data.results ?? []).filter((r) => !r.ok);
      const okCount = (data.results ?? []).filter((r) => r.ok).length;
      setBulkMessage(
        failed.length
          ? `${okCount} ok, ${failed.length} failed: ${failed.map((f) => `${f.maHd}: ${f.error ?? "?"}`).join("; ")}`
          : `${okCount} OK`
      );
      await onRefreshClients();
    } catch (e) {
      setBulkMessage(e instanceof Error ? e.message : "Bulk adjust failed");
    } finally {
      setBulkWorking(false);
    }
  };

  const runBulkPush = async () => {
    if (!selectedMaHds.length) {
      setPushMessage(t("toolsSelectResidentsFirst", "Select at least one resident."));
      return;
    }
    const title = pushTitle.trim();
    const body = pushBody.trim();
    if (!title || !body) {
      setPushMessage(t("toolsEnterTitleBody", "Enter title and body."));
      return;
    }
    const emails = [
      ...new Set(
        selectedMaHds
          .map((maHd) => clients.find((c) => c.maHd === maHd)?.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e))
      )
    ];
    if (!emails.length) {
      setPushMessage(t("toolsNoEmailsForSelection", "No email addresses for selection."));
      return;
    }
    setPushWorking(true);
    setPushMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/manager/bulk/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail: normalizedEmail,
          title,
          body,
          emails
        })
      });
      const data = (await res.json()) as { error?: string; attempted?: number };
      if (!res.ok) {
        throw new Error(data.error ?? "Bulk push failed");
      }
      setPushMessage(t("toolsPushSentTo", { n: data.attempted ?? emails.length }));
    } catch (e) {
      setPushMessage(e instanceof Error ? e.message : "Bulk push failed");
    } finally {
      setPushWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t("toolsCleaningRewardsTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("toolsCleaningRewardsDesc")}</p>
        {cleaningError ? <p className="mt-2 text-sm text-rose-600">{cleaningError}</p> : null}
        {cleaningLoading ? (
          <p className="mt-3 text-sm text-slate-500">{t("refreshing")}</p>
        ) : cleaningForm ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {TASK_KEYS.map((key) => (
                <label key={key} className="block text-sm">
                  <span className="font-medium text-slate-700">{taskLabel(key)}</span>
                  <input
                    type="number"
                    min={0}
                    max={500000}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={cleaningForm.baseRewards[key]}
                    onChange={(e) =>
                      setCleaningForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              baseRewards: { ...prev.baseRewards, [key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }
                            }
                          : prev
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <label className="block max-w-xs text-sm">
              <span className="font-medium text-slate-700">{t("toolsSelfAssignMultiplier")}</span>
              <input
                type="number"
                min={1}
                max={3}
                step={0.05}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={cleaningForm.selfAssignBonusMultiplier}
                onChange={(e) =>
                  setCleaningForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          selfAssignBonusMultiplier: Math.min(3, Math.max(1, Number(e.target.value) || 1))
                        }
                      : prev
                  )
                }
              />
            </label>
            <button
              type="button"
              disabled={cleaningSaving}
              onClick={() => void saveCleaningRewards()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {cleaningSaving ? t("saving") : t("toolsSaveCleaningRewards")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t("toolsBulkCoinsTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("toolsBulkCoinsDesc")}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("toolsFilterClients")}
            className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button type="button" onClick={selectFiltered} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            {t("toolsSelectFiltered")}
          </button>
          <button type="button" onClick={clearSelection} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            {t("toolsClearSelection")}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("toolsSelectedCount", { n: selectedMaHds.length })}</p>

        <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-50">
          {filteredClients.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">{t("noMatchFoundCreate", "No matches.")}</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {filteredClients.map((c) => (
                <li key={c.maHd} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(selected[c.maHd])}
                    onChange={() => toggleOne(c.maHd)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate">{c.name || c.email}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {c.maHd} · {c.branch} · {c.bed} · {c.email}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t("toolsCoinDelta")}</span>
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={bulkDelta}
              onChange={(e) => setBulkDelta(e.target.value)}
              placeholder="+5000 or -1000"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">{t("toolsCoinReason")}</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
            />
          </label>
        </div>
        {bulkMessage ? <p className="mt-2 text-sm text-slate-700">{bulkMessage}</p> : null}
        <button
          type="button"
          disabled={bulkWorking}
          onClick={() => void runBulkCoins()}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {bulkWorking ? t("saving") : t("toolsApplyBulkCoins")}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t("toolsBulkPushTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("toolsBulkPushDesc")}</p>
        <p className="mt-2 text-xs text-slate-500">{t("toolsSelectedCount", { n: selectedMaHds.length })}</p>
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t("toolsPushTitle")}</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={pushTitle}
              onChange={(e) => setPushTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t("toolsPushBody")}</span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={pushBody}
              onChange={(e) => setPushBody(e.target.value)}
            />
          </label>
        </div>
        {pushMessage ? <p className="mt-2 text-sm text-slate-700">{pushMessage}</p> : null}
        <button
          type="button"
          disabled={pushWorking}
          onClick={() => void runBulkPush()}
          className="mt-3 rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pushWorking ? t("saving") : t("toolsSendBulkPush")}
        </button>
      </div>
    </div>
  );
}
