"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { detectMobileOs, type MobileOsKind } from "../lib/mobile-platform";
import type { ResidentGuideSectionDto } from "../lib/resident-guides-types";
import { embeddableVideoSrc } from "../lib/video-embed";
import { usePortalLanguage } from "./portal-language";

export function AddToHomeStepsContent({ os }: { os: MobileOsKind }) {
  const { t } = usePortalLanguage();
  const steps =
    os === "ios"
      ? [t("addToHomeIos1"), t("addToHomeIos2"), t("addToHomeIos3")]
      : os === "android"
        ? [t("addToHomeAndroid1"), t("addToHomeAndroid2"), t("addToHomeAndroid3")]
        : [t("addToHomeOtherMobile"), t("addToHomeDesktop")];
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
      {steps.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ol>
  );
}

function GuideBody({ guide }: { guide: ResidentGuideSectionDto }) {
  const { language } = usePortalLanguage();

  if (guide.contentType === "video" && guide.videoUrl) {
    const embedded = embeddableVideoSrc(guide.videoUrl);
    return (
      <div className="mt-3 space-y-3">
        {embedded?.kind === "iframe" ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe title={guide.titleEn} className="absolute inset-0 h-full w-full" src={embedded.src} allowFullScreen />
          </div>
        ) : embedded?.kind === "video" ? (
          <video className="w-full rounded-xl" controls src={embedded.src} />
        ) : (
          <a
            href={guide.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-sky-700 underline underline-offset-2"
          >
            {language === "vi" ? "Mở video" : "Open video"}
          </a>
        )}
      </div>
    );
  }

  return (
    <ol className="mt-3 list-decimal space-y-4 pl-5 text-sm leading-relaxed text-slate-700">
      {guide.steps.map((step, idx) => (
        <li key={idx} className="space-y-2">
          <p>{language === "vi" ? step.bodyVi : step.bodyEn}</p>
          {step.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={step.imageUrl} alt="" className="max-h-64 w-full max-w-md rounded-lg border border-slate-200 object-contain" loading="lazy" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function CollapseBlock({
  sectionKey,
  title,
  expanded,
  onToggle,
  children
}: {
  sectionKey: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 py-4 text-left"
        aria-expanded={expanded}
        aria-controls={`guide-section-${sectionKey}`}
      >
        <span className="text-base font-semibold text-slate-900">{title}</span>
        <svg
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded ? (
        <div id={`guide-section-${sectionKey}`} className="pb-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ResidentInstructionsPanel() {
  const { t, language } = usePortalLanguage();
  const [guides, setGuides] = useState<ResidentGuideSectionDto[]>([]);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const mobileOs = useMemo(() => detectMobileOs(), []);

  const loadGuides = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(`${API_BASE_URL}/resident/guides`);
      const data = (await res.json()) as { guides?: ResidentGuideSectionDto[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load guides");
      }
      setGuides(data.guides ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load guides");
      setGuides([]);
    }
  }, []);

  useEffect(() => {
    void loadGuides();
  }, [loadGuides]);

  const toggle = (key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">{t("residentGuidesPanelTitle")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("residentGuidesPanelHint")}</p>
      {loadError ? <p className="mt-2 text-sm text-amber-800">{loadError}</p> : null}
      <div className="mt-2 divide-y divide-slate-100">
        <CollapseBlock
          sectionKey="add-home"
          title={t("addToHomeSectionTitle")}
          expanded={Boolean(open["add-home"])}
          onToggle={() => toggle("add-home")}
        >
          <AddToHomeStepsContent os={mobileOs} />
        </CollapseBlock>
        {guides.map((g) => (
          <CollapseBlock
            key={g.id}
            sectionKey={g.slug}
            title={language === "vi" ? g.titleVi : g.titleEn}
            expanded={Boolean(open[g.slug])}
            onToggle={() => toggle(g.slug)}
          >
            <GuideBody guide={g} />
          </CollapseBlock>
        ))}
      </div>
    </section>
  );
}
