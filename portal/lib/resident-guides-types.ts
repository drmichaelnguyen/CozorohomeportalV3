export type ResidentGuideStepDto = {
  bodyVi: string;
  bodyEn: string;
  imageUrl: string | null;
};

export type ResidentGuideCategory = "howto" | "check_in";
export type ResidentGuideAudience = "long_term" | "short_term" | "both";

export type ResidentGuideSectionDto = {
  id: string;
  slug: string;
  titleVi: string;
  titleEn: string;
  sortOrder: number;
  contentType: "steps" | "video";
  category: ResidentGuideCategory;
  audience: ResidentGuideAudience;
  videoUrl: string | null;
  steps: ResidentGuideStepDto[];
  updatedAt: string;
};

export function isShortTermContractCode(maHd: string | null | undefined): boolean {
  return String(maHd ?? "")
    .trim()
    .toUpperCase()
    .startsWith("SHORTTERM");
}
