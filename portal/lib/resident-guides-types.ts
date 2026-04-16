export type ResidentGuideStepDto = {
  bodyVi: string;
  bodyEn: string;
  imageUrl: string | null;
};

export type ResidentGuideSectionDto = {
  id: string;
  slug: string;
  titleVi: string;
  titleEn: string;
  sortOrder: number;
  contentType: "steps" | "video";
  videoUrl: string | null;
  steps: ResidentGuideStepDto[];
  updatedAt: string;
};
