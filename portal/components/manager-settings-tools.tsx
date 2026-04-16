"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { InlineHelp } from "./inline-help";

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
  /** Matches `usePortalLanguage().t` — second arg may be params when omitting fallback. */
  t: (key: string, fallback?: string | Record<string, unknown>, params?: Record<string, string | number>) => string;
  onRefreshClients: () => Promise<void>;
};

type FridgeBranchUi = {
  loading: boolean;
  saving: boolean;
  error: string;
  message: string;
  cleaningDate: string;
  configured: boolean;
  configError: string;
  offAt: string | null;
  onAt: string | null;
};

type FridgeApiRow =
  | { configured: false; branchId: string; error?: string }
  | {
      configured: true;
      branchId: string;
      cleaningDate: string | null;
      offAt: string | null;
      onAt: string | null;
    };

type ToolPanelKey = "cleaning" | "fridge" | "bulk_coins" | "bulk_push";

function ToolCollapsiblePanel({
  title,
  helpBody,
  helpLabel,
  expanded,
  onToggle,
  children
}: {
  title: string;
  helpBody: string;
  helpLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-600/80">
      <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl py-1 text-left text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
        >
          <h3 className="text-lg font-semibold">{title}</h3>
          <span className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden>
            {expanded ? "▲" : "▼"}
          </span>
        </button>
        <InlineHelp label={helpLabel} body={helpBody} className="shrink-0" />
      </div>
      {expanded ? <div className="border-t border-slate-100 px-5 pb-5 pt-2 dark:border-slate-600/80">{children}</div> : null}
    </div>
  );
}

function emptyFridgeRow(loading: boolean): FridgeBranchUi {
  return {
    loading,
    saving: false,
    error: "",
    message: "",
    cleaningDate: "",
    configured: false,
    configError: "",
    offAt: null,
    onAt: null
  };
}

export function ManagerSettingsTools({ normalizedEmail, clients, t, onRefreshClients }: Props) {
  const [openToolPanels, setOpenToolPanels] = useState<Record<ToolPanelKey, boolean>>({
    cleaning: false,
    fridge: false,
    bulk_coins: false,
    bulk_push: false
  });
  const toggleToolPanel = (key: ToolPanelKey) => {
    setOpenToolPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [cleaningLoading, setCleaningLoading] = useState(true);
  const [cleaningSaving, setCleaningSaving] = useState(false);
  const [cleaningError, setCleaningError] = useState("");
  const [cleaningForm, setCleaningForm] = useState<CleaningRewardApi | null>(null);

  const [fridgeD2, setFridgeD2] = useState<FridgeBranchUi>(() => emptyFridgeRow(true));
  const [fridgeD7, setFridgeD7] = useState<FridgeBranchUi>(() => emptyFridgeRow(true));

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

  const loadFridgeSchedules = useCallback(async () => {
    setFridgeD2((f) => ({ ...f, loading: true, error: "" }));
    setFridgeD7((f) => ({ ...f, loading: true, error: "" }));
    try {
      const [res2, res7] = await Promise.all([
        fetch(
          `${API_BASE_URL}/manager/fridge-drain-schedule?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=D2`
        ),
        fetch(
          `${API_BASE_URL}/manager/fridge-drain-schedule?actorEmail=${encodeURIComponent(normalizedEmail)}&branchId=D7`
        )
      ]);
      if (!res2.ok || !res7.ok) {
        const err = t("toolsFridgeDrainLoadError");
        setFridgeD2({ ...emptyFridgeRow(false), error: err });
        setFridgeD7({ ...emptyFridgeRow(false), error: err });
        return;
      }
      const data2 = (await res2.json()) as FridgeApiRow & { error?: string };
      const data7 = (await res7.json()) as FridgeApiRow & { error?: string };
      const mapOne = (data: FridgeApiRow): FridgeBranchUi => {
        if ("configured" in data && data.configured === false) {
          return {
            ...emptyFridgeRow(false),
            configured: false,
            configError: data.error?.trim() || t("toolsFridgeDrainNotConfigured")
          };
        }
        const row = data as Extract<FridgeApiRow, { configured: true }>;
        return {
          ...emptyFridgeRow(false),
          configured: true,
          cleaningDate: row.cleaningDate ?? "",
          offAt: row.offAt ?? null,
          onAt: row.onAt ?? null
        };
      };
      setFridgeD2(mapOne(data2));
      setFridgeD7(mapOne(data7));
    } catch {
      const err = t("toolsFridgeDrainLoadError");
      setFridgeD2((f) => ({ ...f, loading: false, error: err }));
      setFridgeD7((f) => ({ ...f, loading: false, error: err }));
    }
  }, [normalizedEmail, t]);

  useEffect(() => {
    void loadFridgeSchedules();
  }, [loadFridgeSchedules]);

  const saveFridgeBranch = async (branchId: "D2" | "D7") => {
    const row = branchId === "D2" ? fridgeD2 : fridgeD7;
    const setRow = branchId === "D2" ? setFridgeD2 : setFridgeD7;
    const ymd = row.cleaningDate.trim();
    if (!ymd) {
      setRow((f) => ({ ...f, message: "", error: t("toolsFridgeDrainNeedDate") }));
      return;
    }
    setRow((f) => ({ ...f, saving: true, error: "", message: "" }));
    try {
      const res = await fetch(`${API_BASE_URL}/manager/fridge-drain-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: normalizedEmail, branchId, cleaningDate: ymd })
      });
      const data = (await res.json()) as FridgeApiRow & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("requestFailed", "Request failed"));
      }
      if ("configured" in data && data.configured === false) {
        throw new Error(data.error ?? t("toolsFridgeDrainNotConfigured"));
      }
      const ok = data as Extract<FridgeApiRow, { configured: true }>;
      setRow({
        ...emptyFridgeRow(false),
        configured: true,
        cleaningDate: ok.cleaningDate ?? ymd,
        offAt: ok.offAt ?? null,
        onAt: ok.onAt ?? null,
        message: t("toolsFridgeDrainSaved")
      });
    } catch (e) {
      setRow((f) => ({
        ...f,
        saving: false,
        message: "",
        error: e instanceof Error ? e.message : t("requestFailed", "Request failed")
      }));
    }
  };

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
      setPushMessage(t("toolsPushSentTo", undefined, { n: data.attempted ?? emails.length }));
    } catch (e) {
      setPushMessage(e instanceof Error ? e.message : "Bulk push failed");
    } finally {
      setPushWorking(false);
    }
  };

  const cleaningHelpBody = t("toolsCleaningRewardsDesc");
  const fridgeHelpBody = `${t("toolsFridgeDrainDesc")}\n\n${t("toolsFridgeDrainIftttNote")}`;
  const bulkCoinsHelpBody = t("toolsBulkCoinsDesc");
  const bulkPushHelpBody = t("toolsBulkPushDesc");
  const helpAria = t("toolsSectionHelpLabel");

  return (
    <div className="space-y-6">
      <ToolCollapsiblePanel
        title={t("toolsCleaningRewardsTitle")}
        helpBody={cleaningHelpBody}
        helpLabel={helpAria}
        expanded={openToolPanels.cleaning}
        onToggle={() => toggleToolPanel("cleaning")}
      >
        {cleaningError ? <p className="mb-2 text-sm text-rose-600">{cleaningError}</p> : null}
        {cleaningLoading ? (
          <p className="text-sm text-slate-500">{t("refreshing")}</p>
        ) : cleaningForm ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {TASK_KEYS.map((key) => (
                <label key={key} className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{taskLabel(key)}</span>
                  <input
                    type="number"
                    min={0}
                    max={500000}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
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
              <span className="font-medium text-slate-700 dark:text-slate-300">{t("toolsSelfAssignMultiplier")}</span>
              <input
                type="number"
                min={1}
                max={3}
                step={0.05}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
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
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {cleaningSaving ? t("saving") : t("toolsSaveCleaningRewards")}
            </button>
          </div>
        ) : null}
      </ToolCollapsiblePanel>

      <ToolCollapsiblePanel
        title={t("toolsFridgeDrainTitle")}
        helpBody={fridgeHelpBody}
        helpLabel={helpAria}
        expanded={openToolPanels.fridge}
        onToggle={() => toggleToolPanel("fridge")}
      >
        <div className="grid gap-6 sm:grid-cols-2">
          {(
            [
              { id: "D2" as const, row: fridgeD2, setRow: setFridgeD2 },
              { id: "D7" as const, row: fridgeD7, setRow: setFridgeD7 }
            ] as const
          ).map(({ id, row, setRow }) => (
            <div key={id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-600/60 dark:bg-slate-800/40">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("toolsFridgeDrainBranch")} {id}
              </div>
              {row.loading ? (
                <p className="mt-2 text-sm text-slate-500">{t("refreshing")}</p>
              ) : row.error && !row.configured ? (
                <p className="mt-2 text-sm text-rose-600">{row.error}</p>
              ) : !row.configured ? (
                <p className="mt-2 text-sm text-amber-800">{row.configError || t("toolsFridgeDrainNotConfigured")}</p>
              ) : (
                <>
                  <label className="mt-3 block text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{t("toolsFridgeDrainCleaningDay")}</span>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                      value={row.cleaningDate}
                      onChange={(e) => setRow((f) => ({ ...f, cleaningDate: e.target.value, error: "", message: "" }))}
                    />
                  </label>
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{t("toolsFridgeDrainOffNote")}</p>
                  {row.offAt && row.onAt ? (
                    <p className="mt-2 text-xs text-slate-500">
                      OFF: {new Date(row.offAt).toLocaleString(undefined, { timeZone: "Asia/Ho_Chi_Minh" })} · ON:{" "}
                      {new Date(row.onAt).toLocaleString(undefined, { timeZone: "Asia/Ho_Chi_Minh" })}
                    </p>
                  ) : null}
                  {row.message ? <p className="mt-2 text-sm text-emerald-800">{row.message}</p> : null}
                  {row.error ? <p className="mt-2 text-sm text-rose-600">{row.error}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={row.saving}
                      onClick={() => void saveFridgeBranch(id)}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      {row.saving ? t("saving") : t("toolsFridgeDrainSave")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadFridgeSchedules()}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200"
                    >
                      {t("toolsFridgeDrainReload")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </ToolCollapsiblePanel>

      <ToolCollapsiblePanel
        title={t("toolsBulkCoinsTitle")}
        helpBody={bulkCoinsHelpBody}
        helpLabel={helpAria}
        expanded={openToolPanels.bulk_coins}
        onToggle={() => toggleToolPanel("bulk_coins")}
      >
        <div className="flex flex-wrap gap-2">
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
        <p className="mt-2 text-xs text-slate-500">{t("toolsSelectedCount", undefined, { n: selectedMaHds.length })}</p>

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
        {bulkMessage ? <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{bulkMessage}</p> : null}
        <button
          type="button"
          disabled={bulkWorking}
          onClick={() => void runBulkCoins()}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {bulkWorking ? t("saving") : t("toolsApplyBulkCoins")}
        </button>
      </ToolCollapsiblePanel>

      <ToolCollapsiblePanel
        title={t("toolsBulkPushTitle")}
        helpBody={bulkPushHelpBody}
        helpLabel={helpAria}
        expanded={openToolPanels.bulk_push}
        onToggle={() => toggleToolPanel("bulk_push")}
      >
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t("toolsSelectedCount", undefined, { n: selectedMaHds.length })}</p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">{t("toolsPushTitle")}</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={pushTitle}
              onChange={(e) => setPushTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">{t("toolsPushBody")}</span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={pushBody}
              onChange={(e) => setPushBody(e.target.value)}
            />
          </label>
        </div>
        {pushMessage ? <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{pushMessage}</p> : null}
        <button
          type="button"
          disabled={pushWorking}
          onClick={() => void runBulkPush()}
          className="mt-3 rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pushWorking ? t("saving") : t("toolsSendBulkPush")}
        </button>
      </ToolCollapsiblePanel>
    </div>
  );
}
