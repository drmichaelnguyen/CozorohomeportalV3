"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import type {
  ResidentGuideAudience,
  ResidentGuideCategory,
  ResidentGuideSectionDto,
  ResidentGuideStepDto
} from "../lib/resident-guides-types";
import { embeddableVideoSrc } from "../lib/video-embed";
type Props = {
  normalizedEmail: string;
  language: "en" | "vi";
  t: (key: string, fallback?: string) => string;
};

function emptyStep(): ResidentGuideStepDto {
  return { bodyVi: "", bodyEn: "", imageUrl: null };
}

function audienceLabel(audience: ResidentGuideAudience, language: "en" | "vi") {
  if (audience === "long_term") return language === "vi" ? "Dài hạn" : "Long-term";
  if (audience === "short_term") return language === "vi" ? "Ngắn hạn / Hostel" : "Short-term / Hostel";
  return language === "vi" ? "Cả hai" : "Both";
}

function categoryLabel(category: ResidentGuideCategory, language: "en" | "vi") {
  if (category === "check_in") return language === "vi" ? "Check-in" : "Check-in";
  return language === "vi" ? "Hướng dẫn dùng app" : "How-to";
}

export function ManagerResidentGuidesEditor({ normalizedEmail, language, t }: Props) {
  const [guides, setGuides] = useState<ResidentGuideSectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [listFilter, setListFilter] = useState<"all" | "howto" | "check_in">("all");

  const [slug, setSlug] = useState("");
  const [titleVi, setTitleVi] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [contentType, setContentType] = useState<"steps" | "video">("steps");
  const [category, setCategory] = useState<ResidentGuideCategory>("howto");
  const [audience, setAudience] = useState<ResidentGuideAudience>("both");
  const [videoUrl, setVideoUrl] = useState("");
  const [steps, setSteps] = useState<ResidentGuideStepDto[]>([emptyStep()]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/resident-guides?actorEmail=${encodeURIComponent(normalizedEmail)}`
      );
      const data = (await res.json()) as { guides?: ResidentGuideSectionDto[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Load failed");
      }
      setGuides(data.guides ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [normalizedEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setSlug("");
    setTitleVi("");
    setTitleEn("");
    setSortOrder("100");
    setContentType("steps");
    setCategory("howto");
    setAudience("both");
    setVideoUrl("");
    setSteps([emptyStep()]);
  }

  function startEdit(g: ResidentGuideSectionDto) {
    setEditingId(g.id);
    setSlug(g.slug);
    setTitleVi(g.titleVi);
    setTitleEn(g.titleEn);
    setSortOrder(String(g.sortOrder));
    setContentType(g.contentType);
    setCategory(g.category ?? "howto");
    setAudience(g.audience ?? "both");
    setVideoUrl(g.videoUrl ?? "");
    setSteps(g.steps.length ? g.steps.map((s) => ({ ...s })) : [emptyStep()]);
  }

  function startNew(preferCategory: ResidentGuideCategory = "howto") {
    setEditingId("new");
    setSlug("");
    setTitleVi("");
    setTitleEn("");
    setSortOrder(String((guides[guides.length - 1]?.sortOrder ?? 0) + 10));
    setContentType("steps");
    setCategory(preferCategory);
    setAudience(preferCategory === "check_in" ? "both" : "both");
    setVideoUrl("");
    setSteps([emptyStep()]);
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const so = Number(sortOrder);
      if (!Number.isFinite(so) || so < 0) {
        throw new Error(language === "vi" ? "Thứ tự không hợp lệ." : "Invalid sort order.");
      }
      if (editingId === "new") {
        const res = await fetch(`${API_BASE_URL}/manager/resident-guides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail: normalizedEmail,
            slug: slug.trim().toLowerCase(),
            titleVi: titleVi.trim(),
            titleEn: titleEn.trim(),
            sortOrder: so,
            contentType,
            category,
            audience,
            videoUrl: contentType === "video" ? videoUrl.trim() : null,
            steps:
              contentType === "steps"
                ? steps.map((s) => ({
                    bodyVi: s.bodyVi.trim(),
                    bodyEn: s.bodyEn.trim(),
                    imageUrl: s.imageUrl?.trim() || null
                  }))
                : undefined
          })
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Save failed");
        }
      } else if (editingId) {
        const res = await fetch(`${API_BASE_URL}/manager/resident-guides/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail: normalizedEmail,
            titleVi: titleVi.trim(),
            titleEn: titleEn.trim(),
            sortOrder: so,
            contentType,
            category,
            audience,
            videoUrl: contentType === "video" ? videoUrl.trim() : null,
            steps:
              contentType === "steps"
                ? steps.map((s) => ({
                    bodyVi: s.bodyVi.trim(),
                    bodyEn: s.bodyEn.trim(),
                    imageUrl: s.imageUrl?.trim() || null
                  }))
                : undefined
          })
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Save failed");
        }
      }
      resetForm();
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(language === "vi" ? "Xóa mục này?" : "Delete this section?")) {
      return;
    }
    setMessage("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/manager/resident-guides/${encodeURIComponent(id)}?actorEmail=${encodeURIComponent(normalizedEmail)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Delete failed");
      }
      if (editingId === id) {
        resetForm();
      }
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = guides.findIndex((g) => g.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= guides.length) {
      return;
    }
    const a = guides[idx];
    const b = guides[swapIdx];
    setMessage("");
    try {
      await Promise.all([
        fetch(`${API_BASE_URL}/manager/resident-guides/${encodeURIComponent(a.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorEmail: normalizedEmail, sortOrder: b.sortOrder })
        }),
        fetch(`${API_BASE_URL}/manager/resident-guides/${encodeURIComponent(b.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorEmail: normalizedEmail, sortOrder: a.sortOrder })
        })
      ]);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Reorder failed");
    }
  }

  const hint =
    language === "vi"
      ? "Dùng mục Check-in cho hướng dẫn nhận phòng (dài hạn / hostel). Ảnh: URL https. Video: YouTube, Vimeo hoặc .mp4."
      : "Use Check-in sections for arrival instructions (long-term / hostel). Images: https URL. Video: YouTube, Vimeo, or .mp4.";

  const visibleGuides = guides.filter((g) => listFilter === "all" || (g.category ?? "howto") === listFilter);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{hint}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              disabled={loading}
            >
              {loading ? t("refreshing") : t("refreshData")}
            </button>
            <button
              type="button"
              onClick={() => startNew("check_in")}
              className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white"
            >
              {language === "vi" ? "+ Check-in" : "+ Check-in"}
            </button>
            <button type="button" onClick={() => startNew("howto")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              {language === "vi" ? "Thêm hướng dẫn" : "Add how-to"}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["all", language === "vi" ? "Tất cả" : "All"],
              ["check_in", "Check-in"],
              ["howto", language === "vi" ? "How-to" : "How-to"]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setListFilter(key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                listFilter === key ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {message ? <p className="mt-3 text-sm text-amber-800">{message}</p> : null}
      </div>

      {editingId ? (
        <div className="rounded-3xl border border-sky-200 bg-sky-50/40 p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            {editingId === "new" ? (language === "vi" ? "Mục mới" : "New section") : (language === "vi" ? "Sửa mục" : "Edit section")}
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {editingId === "new" ? (
              <label className="block text-sm md:col-span-2">
                <span className="font-medium text-slate-700">slug</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="laundry_tips"
                />
              </label>
            ) : (
              <div className="text-sm text-slate-600 md:col-span-2">
                slug: <code className="rounded bg-white px-2 py-0.5">{slug}</code>
              </div>
            )}
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Title (VI)</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={titleVi} onChange={(e) => setTitleVi(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Title (EN)</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">{language === "vi" ? "Thứ tự" : "Sort order"}</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </label>
            <fieldset className="text-sm">
              <legend className="font-medium text-slate-700">{language === "vi" ? "Loại mục" : "Section kind"}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={category === "check_in"} onChange={() => setCategory("check_in")} />
                  Check-in
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={category === "howto"} onChange={() => setCategory("howto")} />
                  {language === "vi" ? "Hướng dẫn dùng app" : "How-to"}
                </label>
              </div>
            </fieldset>
            <fieldset className="text-sm md:col-span-2">
              <legend className="font-medium text-slate-700">{language === "vi" ? "Đối tượng" : "Audience"}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={audience === "long_term"} onChange={() => setAudience("long_term")} />
                  {audienceLabel("long_term", language)}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={audience === "short_term"} onChange={() => setAudience("short_term")} />
                  {audienceLabel("short_term", language)}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={audience === "both"} onChange={() => setAudience("both")} />
                  {audienceLabel("both", language)}
                </label>
              </div>
            </fieldset>
            <fieldset className="text-sm md:col-span-2">
              <legend className="font-medium text-slate-700">{language === "vi" ? "Loại nội dung" : "Content type"}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={contentType === "steps"} onChange={() => setContentType("steps")} />
                  {language === "vi" ? "Các bước + ảnh (URL)" : "Steps + image URLs"}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={contentType === "video"} onChange={() => setContentType("video")} />
                  {language === "vi" ? "Video (URL)" : "Video (URL)"}
                </label>
              </div>
            </fieldset>
            {contentType === "video" ? (
              <label className="block text-sm md:col-span-2">
                <span className="font-medium text-slate-700">Video URL</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>
            ) : (
              <div className="space-y-3 md:col-span-2">
                {steps.map((step, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        {language === "vi" ? `Bước ${i + 1}` : `Step ${i + 1}`}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-red-600"
                        onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}
                        disabled={steps.length <= 1}
                      >
                        {language === "vi" ? "Xóa bước" : "Remove step"}
                      </button>
                    </div>
                    <textarea
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      rows={2}
                      placeholder="VI"
                      value={step.bodyVi}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSteps((s) => s.map((row, j) => (j === i ? { ...row, bodyVi: v } : row)));
                      }}
                    />
                    <textarea
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      rows={2}
                      placeholder="EN"
                      value={step.bodyEn}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSteps((s) => s.map((row, j) => (j === i ? { ...row, bodyEn: v } : row)));
                      }}
                    />
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="https://… image (optional)"
                      value={step.imageUrl ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSteps((s) => s.map((row, j) => (j === i ? { ...row, imageUrl: v || null } : row)));
                      }}
                    />
                  </div>
                ))}
                <button type="button" className="text-sm font-medium text-sky-700" onClick={() => setSteps((s) => [...s, emptyStep()])}>
                  + {language === "vi" ? "Thêm bước" : "Add step"}
                </button>
              </div>
            )}
          </div>
          {contentType === "video" && videoUrl.trim() ? (
            <div className="mt-4">
              {(() => {
                const emb = embeddableVideoSrc(videoUrl);
                if (emb?.kind === "iframe") {
                  return (
                    <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl bg-black">
                      <iframe title="preview" className="absolute inset-0 h-full w-full" src={emb.src} />
                    </div>
                  );
                }
                if (emb?.kind === "video") {
                  return <video className="mt-2 max-h-48 w-full max-w-md rounded-lg" controls src={emb.src} />;
                }
                return null;
              })()}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? t("saving") : language === "vi" ? "Lưu" : "Save"}
            </button>
            <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
              {language === "vi" ? "Hủy" : "Cancel"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-100">
          {visibleGuides.map((g) => (
            <div key={g.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{language === "vi" ? g.titleVi : g.titleEn}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                    {categoryLabel(g.category ?? "howto", language)}
                  </span>
                  <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">
                    {audienceLabel(g.audience ?? "both", language)}
                  </span>
                  <span>
                    <code>{g.slug}</code> · {g.contentType} · sort {g.sortOrder}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => move(g.id, -1)}>
                  ↑
                </button>
                <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => move(g.id, 1)}>
                  ↓
                </button>
                <button type="button" className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm text-sky-800" onClick={() => startEdit(g)}>
                  {t("editLabel")}
                </button>
                <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={() => void remove(g.id)}>
                  {language === "vi" ? "Xóa" : "Delete"}
                </button>
              </div>
            </div>
          ))}
          {!visibleGuides.length && !loading ? (
            <p className="p-6 text-sm text-slate-500">{language === "vi" ? "Chưa có mục nào." : "No sections yet."}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
