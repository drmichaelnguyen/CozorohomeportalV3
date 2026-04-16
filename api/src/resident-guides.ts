import { Prisma, ResidentGuideContentType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "./prisma.js";
import { requirePortalRole } from "./staff-access.js";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Slug: letters, numbers, underscore, hyphen only.");

const optionalHttpsUrl = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v == null || v === "" ? null : String(v).trim()))
  .refine((s) => s == null || /^https?:\/\/.+/i.test(s), "Must be a valid http(s) URL when set.");

const guideStepSchema = z.object({
  bodyVi: z.string().trim().max(8000),
  bodyEn: z.string().trim().max(8000),
  imageUrl: optionalHttpsUrl
});

const createGuideSchema = z.object({
  actorEmail: z.string().trim().email(),
  slug: slugSchema,
  titleVi: z.string().trim().min(1).max(200),
  titleEn: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  contentType: z.enum(["steps", "video"]),
  videoUrl: optionalHttpsUrl,
  steps: z.array(guideStepSchema).max(40).optional()
});

const updateGuideSchema = z.object({
  actorEmail: z.string().trim().email(),
  titleVi: z.string().trim().min(1).max(200).optional(),
  titleEn: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  contentType: z.enum(["steps", "video"]).optional(),
  videoUrl: optionalHttpsUrl,
  steps: z.array(guideStepSchema).max(40).optional()
});

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

function mapContentType(v: ResidentGuideContentType): "steps" | "video" {
  return v === ResidentGuideContentType.VIDEO ? "video" : "steps";
}

function toPrismaContentType(v: "steps" | "video"): ResidentGuideContentType {
  return v === "video" ? ResidentGuideContentType.VIDEO : ResidentGuideContentType.STEPS;
}

function normalizeSteps(raw: unknown): ResidentGuideStepDto[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ResidentGuideStepDto[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const bodyVi = typeof o.bodyVi === "string" ? o.bodyVi : "";
    const bodyEn = typeof o.bodyEn === "string" ? o.bodyEn : "";
    const imageUrl = typeof o.imageUrl === "string" && o.imageUrl.trim() ? o.imageUrl.trim() : null;
    if (!bodyVi.trim() && !bodyEn.trim()) {
      continue;
    }
    out.push({ bodyVi, bodyEn, imageUrl });
  }
  return out;
}

function serialize(row: {
  id: string;
  slug: string;
  titleVi: string;
  titleEn: string;
  sortOrder: number;
  contentType: ResidentGuideContentType;
  videoUrl: string | null;
  stepsJson: unknown;
  updatedAt: Date;
}): ResidentGuideSectionDto {
  return {
    id: row.id,
    slug: row.slug,
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    sortOrder: row.sortOrder,
    contentType: mapContentType(row.contentType),
    videoUrl: row.videoUrl,
    steps: normalizeSteps(row.stepsJson),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listResidentGuidesPublic(): Promise<ResidentGuideSectionDto[]> {
  const rows = await prisma.residentGuideSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }]
  });
  return rows.map(serialize);
}

export async function createResidentGuide(input: z.infer<typeof createGuideSchema>): Promise<ResidentGuideSectionDto> {
  await requirePortalRole(
    input.actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can edit resident guides."
  );

  const contentType = toPrismaContentType(input.contentType);
  if (contentType === ResidentGuideContentType.VIDEO) {
    if (!input.videoUrl?.trim()) {
      throw new Error("videoUrl is required when contentType is video.");
    }
  } else if (!input.steps?.length) {
    throw new Error("At least one step is required when contentType is steps.");
  }

  const row = await prisma.residentGuideSection.create({
    data: {
      slug: input.slug.trim().toLowerCase(),
      titleVi: input.titleVi.trim(),
      titleEn: input.titleEn.trim(),
      sortOrder: input.sortOrder ?? 100,
      contentType,
      videoUrl: contentType === ResidentGuideContentType.VIDEO ? input.videoUrl!.trim() : null,
      stepsJson:
        contentType === ResidentGuideContentType.STEPS
          ? (input.steps ?? []).map((s) => ({
              bodyVi: s.bodyVi.trim(),
              bodyEn: s.bodyEn.trim(),
              imageUrl: s.imageUrl?.trim() || null
            }))
          : Prisma.JsonNull,
      updatedBy: input.actorEmail.trim().toLowerCase()
    }
  });
  return serialize(row);
}

export async function updateResidentGuide(
  id: string,
  input: z.infer<typeof updateGuideSchema>
): Promise<ResidentGuideSectionDto> {
  await requirePortalRole(
    input.actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can edit resident guides."
  );

  const existing = await prisma.residentGuideSection.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Guide not found.");
  }

  const nextType = input.contentType ? toPrismaContentType(input.contentType) : existing.contentType;
  let nextVideo =
    input.videoUrl !== undefined ? (input.videoUrl?.trim() ?? null) : existing.videoUrl;
  let nextStepsJson: unknown = existing.stepsJson;
  if (input.steps) {
    nextStepsJson = input.steps.map((s) => ({
      bodyVi: s.bodyVi.trim(),
      bodyEn: s.bodyEn.trim(),
      imageUrl: s.imageUrl?.trim() || null
    }));
  }
  if (input.contentType === "video") {
    nextStepsJson = Prisma.JsonNull;
  } else if (input.contentType === "steps") {
    nextVideo = null;
  }

  if (nextType === ResidentGuideContentType.VIDEO) {
    if (!nextVideo?.trim()) {
      throw new Error("videoUrl is required when contentType is video.");
    }
  } else {
    const stepsArr = normalizeSteps(nextStepsJson);
    if (!stepsArr.length) {
      throw new Error("At least one step is required when contentType is steps.");
    }
  }

  const data: Prisma.ResidentGuideSectionUpdateInput = {
    titleVi: input.titleVi?.trim() ?? undefined,
    titleEn: input.titleEn?.trim() ?? undefined,
    sortOrder: input.sortOrder ?? undefined,
    contentType: input.contentType ? toPrismaContentType(input.contentType) : undefined,
    updatedBy: input.actorEmail.trim().toLowerCase()
  };
  if (input.videoUrl !== undefined || input.contentType === "steps" || input.contentType === "video") {
    data.videoUrl = nextVideo;
  }
  if (input.steps || input.contentType === "steps" || input.contentType === "video") {
    data.stepsJson = nextStepsJson === Prisma.JsonNull ? Prisma.JsonNull : nextStepsJson;
  }

  const row = await prisma.residentGuideSection.update({
    where: { id },
    data
  });
  return serialize(row);
}

export async function deleteResidentGuide(actorEmail: string, id: string): Promise<void> {
  await requirePortalRole(
    actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can edit resident guides."
  );
  await prisma.residentGuideSection.delete({ where: { id } });
}

export { createGuideSchema, updateGuideSchema };
