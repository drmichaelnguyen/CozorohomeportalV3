"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { detectMobileOs, type MobileOsKind } from "../lib/mobile-platform";
import type { ResidentGuideAudience, ResidentGuideSectionDto } from "../lib/resident-guides-types";
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
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
        aria-expanded={expanded}
        aria-controls={`guide-section-${sectionKey}`}
        onClick={onToggle}
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
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

type Props = {
  /** long_term | short_term — filters check-in + how-to guides for this client type */
  audience?: ResidentGuideAudience;
};

export function ResidentInstructionsPanel({ audience = "long_term" }: Props) {
  const { t, language } = usePortalLanguage();
  const [guides, setGuides] = useState<ResidentGuideSectionDto[]>([]);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const mobileOs = useMemo(() => detectMobileOs(), []);
  const resolvedAudience: ResidentGuideAudience = audience === "short_term" ? "short_term" : "long_term";

  const loadGuides = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/resident/guides?audience=${encodeURIComponent(resolvedAudience)}&category=all`
      );
      const data = (await res.json()) as { guides?: ResidentGuideSectionDto[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load guides");
      }
      setGuides(data.guides ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load guides");
      setGuides([]);
    }
  }, [resolvedAudience]);

  useEffect(() => {
    void loadGuides();
  }, [loadGuides]);

  const toggle = (key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const checkInGuides = guides.filter((g) => (g.category ?? "howto") === "check_in");
  const howToGuides = guides.filter((g) => (g.category ?? "howto") !== "check_in");

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">{t("residentGuidesPanelTitle")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("residentGuidesPanelHint")}</p>
      {loadError ? <p className="mt-2 text-sm text-amber-800">{loadError}</p> : null}

      {checkInGuides.length > 0 ? (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <h3 className="text-sm font-semibold text-violet-900">
            {language === "vi" ? "Hướng dẫn check-in / nhận phòng" : "Check-in instructions"}
          </h3>
          <div className="mt-1 divide-y divide-violet-100">
            {checkInGuides.map((g) => (
              <CollapseBlock
                key={g.id}
                sectionKey={`checkin-${g.slug}`}
                title={language === "vi" ? g.titleVi : g.titleEn}
                expanded={Boolean(open[`checkin-${g.slug}`])}
                onToggle={() => toggle(`checkin-${g.slug}`)}
              >
                <GuideBody guide={g} />
              </CollapseBlock>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-2 divide-y divide-slate-100">
        <CollapseBlock
          sectionKey="add-home"
          title={t("addToHomeSectionTitle")}
          expanded={Boolean(open["add-home"])}
          onToggle={() => toggle("add-home")}
        >
          <AddToHomeStepsContent os={mobileOs} />
        </CollapseBlock>
        {howToGuides.map((g) => (
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
