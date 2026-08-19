"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

type RewardedCleaningPhoto = {
  id: string;
  storageName: string;
  fileName: string;
  url: string;
};

type RewardedCleaningReviewItem = {
  id: string;
  userEmail: string;
  userName?: string | null;
  branchId: string;
  siteName: string;
  workDate: string;
  status: "PENDING_REVIEW";
  beforeNote?: string | null;
  afterNote?: string | null;
  aiVerdict?: "ELIGIBLE" | "NOT_ELIGIBLE" | "SKIPPED" | "PENDING" | null;
  aiScore?: number | null;
  aiNote?: string | null;
  aiSuggestedCoins?: number | null;
  beforePhotos: RewardedCleaningPhoto[];
  afterPhotos: RewardedCleaningPhoto[];
};

export function RewardedCleaningReviewClient() {
  const { t } = usePortalLanguage();
  const { sessionEmail, sessionRole, isLoggedIn } = usePortalSession();
  const actorEmail = sessionEmail.trim().toLowerCase();
  const isStaff = Boolean(sessionRole && sessionRole !== "user");

  const [queue, setQueue] = useState<RewardedCleaningReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rewardCoinsById, setRewardCoinsById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const loadQueue = useCallback(async () => {
    if (!isLoggedIn || !isStaff || !actorEmail) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/rewarded-cleaning/review-queue?actorEmail=${encodeURIComponent(actorEmail)}`
      );
      const data = (await response.json()) as { queue?: RewardedCleaningReviewItem[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to load review queue.");
      }
      const rows = data.queue ?? [];
      setQueue(rows);
      setRewardCoinsById((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!next[row.id]) {
            next[row.id] = String(row.aiSuggestedCoins ?? 5000);
          }
        }
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load review queue.");
    } finally {
      setLoading(false);
    }
  }, [actorEmail, isLoggedIn, isStaff]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function auditSubmission(id: string, approve: boolean) {
    if (!actorEmail) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/manager/rewarded-cleaning/submissions/${encodeURIComponent(id)}/audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail,
            approve,
            rewardCoins: approve ? Number(rewardCoinsById[id] ?? 5000) : undefined,
            note: noteById[id]?.trim() || undefined
          })
        }
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to update submission.");
      }
      setMessage(
        approve
          ? t("rewardedCleaningReviewApproved", "Reward approved.")
          : t("rewardedCleaningReviewRejected", "Submission rejected.")
      );
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update submission.");
    } finally {
      setLoading(false);
    }
  }

  if (!isStaff) {
    return null;
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-amber-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("rewardedCleaningReviewTitle", "Rewarded cleaning review")}
            </h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Beta
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {t(
              "rewardedCleaningReviewDesc",
              "Review resident before/after photos. AI suggests eligibility; you decide the final coin reward (minimum 5,000)."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadQueue()}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {t("refreshSchedule", "Refresh")}
        </button>
      </div>

      {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}

      {!queue.length ? (
        <p className="mt-4 text-sm text-slate-500">
          {t("rewardedCleaningReviewEmpty", "No pending rewarded cleaning submissions.")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {queue.map((row) => (
            <article key={row.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">
                    {row.userName || row.userEmail} · {row.siteName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.branchId} · {row.workDate}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-600">
                  {row.aiVerdict ? <div>{row.aiVerdict}</div> : null}
                  {typeof row.aiScore === "number" ? <div>Score {row.aiScore}</div> : null}
                  {row.aiSuggestedCoins ? (
                    <div>
                      {t("rewardedCleaningAiSuggested", "AI suggests {coins} coins", {
                        coins: String(row.aiSuggestedCoins)
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              {row.aiNote ? <p className="mt-2 text-sm text-slate-600">{row.aiNote}</p> : null}
              {row.beforeNote ? (
                <p className="mt-1 text-xs text-slate-500">
                  {t("rewardedCleaningBeforeNoteLabel", "Before note")}: {row.beforeNote}
                </p>
              ) : null}
              {row.afterNote ? (
                <p className="mt-1 text-xs text-slate-500">
                  {t("rewardedCleaningAfterNoteLabel", "After note")}: {row.afterNote}
                </p>
              ) : null}

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("rewardedCleaningBeforePhotos", "Before")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.beforePhotos.map((photo) => (
                      <a
                        key={photo.id}
                        href={`${API_BASE_URL}${photo.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block h-24 w-24 overflow-hidden rounded-lg ring-1 ring-slate-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`${API_BASE_URL}${photo.url}`} alt={photo.fileName} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("rewardedCleaningAfterPhotos", "After")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.afterPhotos.map((photo) => (
                      <a
                        key={photo.id}
                        href={`${API_BASE_URL}${photo.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block h-24 w-24 overflow-hidden rounded-lg ring-1 ring-slate-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`${API_BASE_URL}${photo.url}`} alt={photo.fileName} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    {t("rewardedCleaningRewardCoins", "Reward coins")}
                  </span>
                  <input
                    type="number"
                    min={5000}
                    step={500}
                    value={rewardCoinsById[row.id] ?? "5000"}
                    onChange={(event) =>
                      setRewardCoinsById((state) => ({ ...state, [row.id]: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    {t("rewardedCleaningStaffNote", "Staff note")}
                  </span>
                  <input
                    value={noteById[row.id] ?? ""}
                    onChange={(event) => setNoteById((state) => ({ ...state, [row.id]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void auditSubmission(row.id, true)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t("rewardedCleaningApproveReward", "Approve reward")}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void auditSubmission(row.id, false)}
                  className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
                >
                  {t("rewardedCleaningReject", "Reject")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
