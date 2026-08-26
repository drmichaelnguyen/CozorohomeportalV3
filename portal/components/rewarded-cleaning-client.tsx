"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

type RewardedCleaningPhoto = {
  id: string;
  storageName: string;
  fileName: string;
  sortOrder: number;
  url: string;
};

type RewardedCleaningSubmission = {
  id: string;
  siteId: string;
  siteName: string;
  workDate: string;
  status: "AWAITING_AFTER" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  beforeNote?: string | null;
  afterNote?: string | null;
  aiVerdict?: "PENDING" | "ELIGIBLE" | "NOT_ELIGIBLE" | "SKIPPED" | null;
  aiScore?: number | null;
  aiNote?: string | null;
  aiSuggestedCoins?: number | null;
  rewardCoins?: number | null;
  reviewerNote?: string | null;
  beforePhotos: RewardedCleaningPhoto[];
  afterPhotos: RewardedCleaningPhoto[];
};

type RewardedCleaningSite = {
  id: string;
  name: string;
  branchId?: string | null;
  isSystem: boolean;
};

type RewardedCleaningOverview = {
  branchId: string;
  minRewardCoins: number;
  maxPhotos: number;
  sites: RewardedCleaningSite[];
  usedSiteIdsToday: string[];
  todaySubmissions: RewardedCleaningSubmission[];
  recentSubmissions: RewardedCleaningSubmission[];
};

type PhotoDraft = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  previewUrl: string;
};

async function fileToPhotoPayload(file: File): Promise<Omit<PhotoDraft, "previewUrl">> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read photo"));
    reader.readAsDataURL(file);
  });
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid photo");
  }
  return {
    fileName: file.name || "photo.jpg",
    mimeType: match[1] || file.type || "image/jpeg",
    dataBase64: match[2]!
  };
}

function statusLabel(
  status: RewardedCleaningSubmission["status"],
  t: (key: string, fallback?: string) => string
) {
  if (status === "AWAITING_AFTER") {
    return t("rewardedCleaningStatusAwaitingAfter", "Waiting for after photos");
  }
  if (status === "PENDING_REVIEW") {
    return t("rewardedCleaningStatusPendingReview", "Pending staff review");
  }
  if (status === "APPROVED") {
    return t("rewardedCleaningStatusApproved", "Approved");
  }
  return t("rewardedCleaningStatusRejected", "Not rewarded");
}

function aiVerdictBadge(
  verdict: RewardedCleaningSubmission["aiVerdict"],
  t: (key: string, fallback?: string) => string
) {
  if (!verdict || verdict === "PENDING") {
    return null;
  }
  if (verdict === "ELIGIBLE") {
    return t("rewardedCleaningAiEligible", "AI: likely eligible");
  }
  if (verdict === "NOT_ELIGIBLE") {
    return t("rewardedCleaningAiNotEligible", "AI: unlikely eligible");
  }
  return t("rewardedCleaningAiSkipped", "AI: manual review");
}

export function RewardedCleaningClient() {
  const { t } = usePortalLanguage();
  const { sessionEmail, isLoggedIn } = usePortalSession();
  const normalizedEmail = sessionEmail.trim().toLowerCase();

  const [overview, setOverview] = useState<RewardedCleaningOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [customSiteName, setCustomSiteName] = useState("");
  const [beforeNote, setBeforeNote] = useState("");
  const [afterNote, setAfterNote] = useState("");
  const [beforePhotos, setBeforePhotos] = useState<PhotoDraft[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<PhotoDraft[]>([]);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(null);

  const awaitingSubmission = useMemo(
    () => overview?.todaySubmissions.find((row) => row.status === "AWAITING_AFTER") ?? null,
    [overview]
  );

  const availableSites = useMemo(() => {
    if (!overview) {
      return [];
    }
    const used = new Set(overview.usedSiteIdsToday);
    return overview.sites.filter((site) => !used.has(site.id));
  }, [overview]);

  const loadOverview = useCallback(async () => {
    if (!isLoggedIn || !normalizedEmail) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/rewarded-cleaning/me?email=${encodeURIComponent(normalizedEmail)}`
      );
      const data = (await response.json()) as RewardedCleaningOverview & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to load rewarded cleaning.");
      }
      setOverview(data);
      if (data.todaySubmissions.some((row) => row.status === "AWAITING_AFTER")) {
        const pending = data.todaySubmissions.find((row) => row.status === "AWAITING_AFTER");
        setActiveSubmissionId(pending?.id ?? null);
      } else {
        setActiveSubmissionId(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load rewarded cleaning.");
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, normalizedEmail]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (awaitingSubmission) {
      setActiveSubmissionId(awaitingSubmission.id);
      setSelectedSiteId(awaitingSubmission.siteId);
    }
  }, [awaitingSubmission]);

  async function addCustomSite() {
    const name = customSiteName.trim();
    if (!name || !normalizedEmail) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/rewarded-cleaning/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, name })
      });
      const data = (await response.json()) as { site?: RewardedCleaningSite; error?: string };
      if (!response.ok || !data.site) {
        throw new Error(data.error || "Unable to add site.");
      }
      setCustomSiteName("");
      setSelectedSiteId(data.site.id);
      await loadOverview();
      setMessage(t("rewardedCleaningSiteAdded", "Site added to the list."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add site.");
    } finally {
      setLoading(false);
    }
  }

  async function addPhoto(
    file: File | null,
    phase: "before" | "after",
    maxPhotos: number
  ) {
    if (!file) {
      return;
    }
    const current = phase === "before" ? beforePhotos : afterPhotos;
    if (current.length >= maxPhotos) {
      setMessage(
        t("rewardedCleaningMaxPhotos", "You can attach up to {count} photos.", {
          count: String(maxPhotos)
        })
      );
      return;
    }
    try {
      const payload = await fileToPhotoPayload(file);
      const previewUrl = URL.createObjectURL(file);
      const draft = { ...payload, previewUrl };
      if (phase === "before") {
        setBeforePhotos((state) => [...state, draft]);
      } else {
        setAfterPhotos((state) => [...state, draft]);
      }
    } catch {
      setMessage(t("rewardedCleaningPhotoReadError", "Unable to read the selected photo."));
    }
  }

  function removePhoto(index: number, phase: "before" | "after") {
    if (phase === "before") {
      setBeforePhotos((state) => {
        const target = state[index];
        if (target) {
          URL.revokeObjectURL(target.previewUrl);
        }
        return state.filter((_, photoIndex) => photoIndex !== index);
      });
      return;
    }
    setAfterPhotos((state) => {
      const target = state[index];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return state.filter((_, photoIndex) => photoIndex !== index);
    });
  }

  async function submitBefore() {
    if (!normalizedEmail || !selectedSiteId || beforePhotos.length === 0) {
      setMessage(t("rewardedCleaningBeforeRequired", "Choose a site and add at least one before photo."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/rewarded-cleaning/submissions/before`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          siteId: selectedSiteId,
          note: beforeNote.trim() || undefined,
          photos: beforePhotos.map(({ fileName, mimeType, dataBase64 }) => ({
            fileName,
            mimeType,
            dataBase64
          }))
        })
      });
      const data = (await response.json()) as { submission?: RewardedCleaningSubmission; error?: string };
      if (!response.ok || !data.submission) {
        throw new Error(data.error || "Unable to submit before photos.");
      }
      beforePhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setBeforePhotos([]);
      setBeforeNote("");
      setActiveSubmissionId(data.submission.id);
      setMessage(
        t(
          "rewardedCleaningBeforeSaved",
          "Before photos saved. Clean the area, then come back to upload after photos."
        )
      );
      await loadOverview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit before photos.");
    } finally {
      setLoading(false);
    }
  }

  async function submitAfter() {
    const submissionId = activeSubmissionId ?? awaitingSubmission?.id;
    if (!normalizedEmail || !submissionId || afterPhotos.length === 0) {
      setMessage(t("rewardedCleaningAfterRequired", "Add at least one after photo to finish."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/rewarded-cleaning/submissions/${encodeURIComponent(submissionId)}/after`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            note: afterNote.trim() || undefined,
            photos: afterPhotos.map(({ fileName, mimeType, dataBase64 }) => ({
              fileName,
              mimeType,
              dataBase64
            }))
          })
        }
      );
      const data = (await response.json()) as { submission?: RewardedCleaningSubmission; error?: string };
      if (!response.ok || !data.submission) {
        throw new Error(data.error || "Unable to submit after photos.");
      }
      afterPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setAfterPhotos([]);
      setAfterNote("");
      setActiveSubmissionId(null);
      const aiNote = data.submission.aiNote?.trim();
      setMessage(
        aiNote
          ? t("rewardedCleaningSubmittedWithAi", "Submitted for staff review. AI note: {note}", { note: aiNote })
          : t("rewardedCleaningSubmitted", "Submitted for staff review. A manager will decide the coin reward.")
      );
      await loadOverview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit after photos.");
    } finally {
      setLoading(false);
    }
  }

  function renderPhotoPicker(
    phase: "before" | "after",
    photos: PhotoDraft[],
    maxPhotos: number,
    disabled: boolean
  ) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((photo, index) => (
            <div key={`${phase}-${index}`} className="relative h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={photo.fileName} className="h-full w-full object-cover" />
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removePhoto(index, phase)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {!disabled && photos.length < maxPhotos ? (
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500 hover:border-slate-400">
              +
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  void addPhoto(event.target.files?.[0] ?? null, phase, maxPhotos);
                  event.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  const maxPhotos = overview?.maxPhotos ?? 3;
  const minCoins = overview?.minRewardCoins ?? 5000;
  const showBeforeForm = !awaitingSubmission;
  const showAfterForm = Boolean(awaitingSubmission || activeSubmissionId);

  return (
    <section id="rewarded-cleaning" className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("rewardedCleaningTitle", "Rewarded cleaning")}
            </h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Beta
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {t(
              "rewardedCleaningDesc",
              "Take before photos, clean or organize a shared site, then upload after photos. AI compares the improvement and staff approve coin rewards (minimum {min} coins). One site per day.",
              { min: String(minCoins) }
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadOverview()}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {t("refreshSchedule", "Refresh")}
        </button>
      </div>

      {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}

      {showBeforeForm ? (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">
            {t("rewardedCleaningStepBefore", "Step 1 — Before photos")}
          </h3>
          <p className="mt-1 text-xs text-emerald-800/80">
            {t(
              "rewardedCleaningStepBeforeDesc",
              "Pick the site and capture up to 3 photos before you start cleaning."
            )}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">{t("rewardedCleaningSite", "Site")}</span>
              <select
                value={selectedSiteId}
                onChange={(event) => setSelectedSiteId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">{t("rewardedCleaningChooseSite", "Choose a site…")}</option>
                {availableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                {t("rewardedCleaningAddSite", "Add a site not in the list")}
              </span>
              <div className="mt-1 flex gap-2">
                <input
                  value={customSiteName}
                  onChange={(event) => setCustomSiteName(event.target.value)}
                  placeholder={t("rewardedCleaningNewSitePlaceholder", "e.g. Room 1.2 corridor")}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addCustomSite()}
                  disabled={loading || customSiteName.trim().length < 2}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("rewardedCleaningAddSiteBtn", "Add")}
                </button>
              </div>
            </label>
          </div>

          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">{t("rewardedCleaningNoteOptional", "Note (optional)")}</span>
            <input
              value={beforeNote}
              onChange={(event) => setBeforeNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={t("rewardedCleaningBeforeNotePlaceholder", "What needs cleaning?")}
            />
          </label>

          {renderPhotoPicker("before", beforePhotos, maxPhotos, false)}

          <button
            type="button"
            onClick={() => void submitBefore()}
            disabled={loading || !selectedSiteId || beforePhotos.length === 0}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("rewardedCleaningSaveBefore", "Save before photos")}
          </button>
        </div>
      ) : null}

      {showAfterForm && awaitingSubmission ? (
        <div className="mt-6 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
          <h3 className="text-sm font-semibold text-sky-900">
            {t("rewardedCleaningStepAfter", "Step 2 — After photos")}
          </h3>
          <p className="mt-1 text-xs text-sky-800/80">
            {t(
              "rewardedCleaningStepAfterDesc",
              "Finish cleaning {site}, then upload up to 3 after photos.",
              { site: awaitingSubmission.siteName }
            )}
          </p>

          {awaitingSubmission.beforePhotos.length > 0 ? (
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("rewardedCleaningYourBeforePhotos", "Your before photos")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {awaitingSubmission.beforePhotos.map((photo) => (
                  <a
                    key={photo.id}
                    href={`${API_BASE_URL}${photo.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block h-16 w-16 overflow-hidden rounded-lg ring-1 ring-slate-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${API_BASE_URL}${photo.url}`} alt={photo.fileName} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">{t("rewardedCleaningNoteOptional", "Note (optional)")}</span>
            <input
              value={afterNote}
              onChange={(event) => setAfterNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={t("rewardedCleaningAfterNotePlaceholder", "What did you clean or organize?")}
            />
          </label>

          {renderPhotoPicker("after", afterPhotos, maxPhotos, false)}

          <button
            type="button"
            onClick={() => void submitAfter()}
            disabled={loading || afterPhotos.length === 0}
            className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("rewardedCleaningSubmitForReview", "Submit for review")}
          </button>
        </div>
      ) : null}

      {overview?.recentSubmissions?.length ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-slate-900">
            {t("rewardedCleaningHistory", "Your submissions")}
          </h3>
          <div className="mt-3 space-y-3">
            {overview.recentSubmissions.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{row.siteName}</div>
                    <div className="text-xs text-slate-500">{row.workDate}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium text-slate-800">{statusLabel(row.status, t)}</div>
                    {row.rewardCoins ? (
                      <div className="text-emerald-700">+{row.rewardCoins.toLocaleString()} coins</div>
                    ) : null}
                    {row.aiSuggestedCoins && row.status === "PENDING_REVIEW" ? (
                      <div className="text-xs text-slate-500">
                        {t("rewardedCleaningAiSuggested", "AI suggests {coins} coins", {
                          coins: String(row.aiSuggestedCoins)
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
                {aiVerdictBadge(row.aiVerdict, t) ? (
                  <div className="mt-2 text-xs text-slate-600">{aiVerdictBadge(row.aiVerdict, t)}</div>
                ) : null}
                {row.aiNote ? <p className="mt-2 text-xs text-slate-600">{row.aiNote}</p> : null}
                {row.reviewerNote ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {t("rewardedCleaningStaffNote", "Staff note")}: {row.reviewerNote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
