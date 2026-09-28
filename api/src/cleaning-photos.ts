import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CleaningAuditDecision, CleaningTaskStatus, CleaningTaskType } from "@prisma/client";
import { CLEANING_AI_AUTO_REVIEWER } from "./cleaning-ai-benchmark.js";
import {
  LEARNED_REFERENCE_LOOKBACK_DAYS,
  LEARNED_REFERENCE_MIN_RATING,
  resolveCleaningReferencePhotos as resolveCleaningReferencePhotosWithDeps,
  selectLearnedCleaningReferencePhotos,
  type LearnedReferenceCandidate,
  type ResolveCleaningReferenceDeps,
  type ResolvedCleaningReferences
} from "./cleaning-photo-references.js";
import { compressFineEvidence } from "./fine-evidence-compress.js";
import { prisma } from "./prisma.js";
import { resolvePortalLogin } from "./staff-access.js";

export type CleaningPhotoInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type {
  CleaningReferenceSource,
  LearnedReferenceCandidate,
  ResolveCleaningReferenceDeps,
  ResolvedCleaningReferencePhoto,
  ResolvedCleaningReferences
} from "./cleaning-photo-references.js";

export {
  describeCleaningReferenceSource,
  selectLearnedCleaningReferencePhotos
} from "./cleaning-photo-references.js";

const referencePhotosDir = path.join(process.cwd(), "data", "cleaning-reference-photos");
const completionPhotosDir = path.join(process.cwd(), "data", "cleaning-completion-photos");

const MAX_PHOTOS_PER_UPLOAD = 5;
const MAX_RAW_BYTES = 12 * 1024 * 1024;

export function getCleaningPhotoRequirements(taskType: CleaningTaskType, floor?: number | null): string {
  if (taskType === CleaningTaskType.KITCHEN_D2) {
    return [
      "Kitchen D2 cleaning requirements:",
      "- Stove/cooktop surfaces wiped clean with no visible grease or food residue",
      "- Sink and faucet cleaned; no dirty dishes left in sink",
      "- Countertops and prep areas clear and wiped down",
      "- Floor swept/mopped in kitchen area; no visible trash or spills",
      "- Trash bins emptied if present in kitchen area"
    ].join("\n");
  }

  if (taskType === CleaningTaskType.KITCHEN_D7) {
    return [
      "Kitchen D7 cleaning requirements (evening shift 17:00–23:00):",
      "- Stove/cooktop surfaces wiped clean with no visible grease or food residue",
      "- Sink and faucet cleaned; no dirty dishes left in sink",
      "- Countertops and prep areas clear and wiped down",
      "- Floor swept/mopped in kitchen area; no visible trash or spills",
      "- Trash bins emptied if present in kitchen area",
      "- Both Cooker 1 and Cooker 2 areas should look tidy if visible in photos"
    ].join("\n");
  }

  return [
    `Trash D7 cleaning requirements (floor ${floor ?? "assigned"}):`,
    "- All trash bins on the assigned floor emptied",
    "- Bin areas wiped/cleaned; no overflow or bags left on floor",
    "- Common corridor/trash collection area on the floor looks tidy",
    "- No large items or hazardous waste left beside bins"
  ].join("\n");
}

async function saveCompressedPhoto(
  input: CleaningPhotoInput,
  targetDir: string,
  namePrefix: string
): Promise<{ storageName: string; fileName: string }> {
  const raw = Buffer.from(input.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!raw.length) {
    throw new Error("The uploaded photo is empty.");
  }
  if (raw.byteLength > MAX_RAW_BYTES) {
    throw new Error("Each photo must be 12 MB or smaller before compression.");
  }

  const compressed = await compressFineEvidence(
    raw,
    input.mimeType || "image/jpeg",
    input.fileName || "photo.jpg"
  );
  await mkdir(targetDir, { recursive: true });
  const storageName = `${namePrefix}-${randomUUID()}.jpg`;
  await writeFile(path.join(targetDir, storageName), compressed.buffer);

  return {
    storageName,
    fileName: input.fileName.trim().slice(0, 191) || "photo.jpg"
  };
}

export async function listCleaningReferencePhotos(input: {
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
}) {
  return prisma.cleaningReferencePhoto.findMany({
    where: {
      taskType: input.taskType,
      branchId: input.branchId,
      floor: input.taskType === CleaningTaskType.TRASH_D7 ? (input.floor ?? null) : null,
      isActive: true
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

async function defaultPhotoFileExists(storageName: string, kind: "reference" | "completion") {
  try {
    await access(resolvePhotoPath(storageName, kind));
    return true;
  } catch {
    return false;
  }
}

async function defaultListLearnedCandidates(input: {
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
  excludeTaskId?: string;
  since: Date;
}): Promise<LearnedReferenceCandidate[]> {
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      type: input.taskType,
      branchId: input.branchId,
      ...(input.taskType === CleaningTaskType.TRASH_D7 ? { floor: input.floor ?? null } : {}),
      status: CleaningTaskStatus.APPROVED,
      managerRating: { gte: LEARNED_REFERENCE_MIN_RATING },
      ...(input.excludeTaskId ? { id: { not: input.excludeTaskId } } : {}),
      OR: [{ completedAt: { gte: input.since } }, { updatedAt: { gte: input.since } }],
      audits: {
        some: {
          decision: CleaningAuditDecision.APPROVE,
          qualityRating: { gte: LEARNED_REFERENCE_MIN_RATING },
          NOT: { reviewer: CLEANING_AI_AUTO_REVIEWER }
        }
      }
    },
    select: {
      id: true,
      managerRating: true,
      updatedAt: true,
      completedAt: true,
      audits: {
        where: {
          decision: CleaningAuditDecision.APPROVE,
          qualityRating: { gte: LEARNED_REFERENCE_MIN_RATING },
          NOT: { reviewer: CLEANING_AI_AUTO_REVIEWER }
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, qualityRating: true }
      },
      completionPhotos: {
        where: { excludedFromReference: false },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, storageName: true, fileName: true }
      }
    },
    orderBy: [{ managerRating: "desc" }, { updatedAt: "desc" }],
    take: 40
  });

  const candidates: LearnedReferenceCandidate[] = [];
  for (const task of tasks) {
    const rating = task.managerRating ?? task.audits[0]?.qualityRating;
    if (rating == null || rating < LEARNED_REFERENCE_MIN_RATING) continue;
    const approvedAt = task.audits[0]?.createdAt ?? task.completedAt ?? task.updatedAt;
    if (approvedAt.getTime() < input.since.getTime()) continue;
    for (const photo of task.completionPhotos) {
      candidates.push({
        photoId: photo.id,
        storageName: photo.storageName,
        fileName: photo.fileName,
        taskId: task.id,
        managerRating: rating,
        approvedAt
      });
    }
  }
  return candidates;
}

const defaultResolveDeps: ResolveCleaningReferenceDeps = {
  listStaffPhotos: listCleaningReferencePhotos,
  listLearnedCandidates: defaultListLearnedCandidates,
  photoFileExists: defaultPhotoFileExists
};

export async function resolveCleaningReferencePhotos(
  input: {
    taskType: CleaningTaskType;
    branchId: string;
    floor?: number | null;
    excludeTaskId?: string;
  },
  deps: ResolveCleaningReferenceDeps = defaultResolveDeps
): Promise<ResolvedCleaningReferences> {
  return resolveCleaningReferencePhotosWithDeps(input, deps);
}

export async function listLearnedCleaningReferencePhotos(input: {
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
}) {
  const resolved = await resolveCleaningReferencePhotos(input);
  if (resolved.source !== "learned") {
    // Still show learned candidates for manager UI even when staff refs exist.
    const since = new Date(Date.now() - LEARNED_REFERENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await defaultListLearnedCandidates({ ...input, since });
    const withFiles: LearnedReferenceCandidate[] = [];
    for (const candidate of candidates) {
      if (!(await defaultPhotoFileExists(candidate.storageName, "completion"))) continue;
      withFiles.push(candidate);
    }
    return selectLearnedCleaningReferencePhotos(withFiles).map((photo) => ({
      id: photo.photoId,
      storageName: photo.storageName,
      fileName: photo.fileName,
      taskId: photo.taskId,
      managerRating: photo.managerRating,
      approvedAt: photo.approvedAt
    }));
  }
  return resolved.photos.map((photo) => ({
    id: photo.id,
    storageName: photo.storageName,
    fileName: photo.fileName,
    taskId: photo.taskId ?? "",
    managerRating: photo.managerRating ?? null,
    approvedAt: photo.approvedAt ?? null
  }));
}

export async function setCleaningCompletionPhotoExcludedFromReference(
  photoId: string,
  excluded: boolean,
  actorEmail: string
) {
  const photo = await prisma.cleaningCompletionPhoto.findUnique({ where: { id: photoId } });
  if (!photo) {
    throw new Error("Completion photo not found.");
  }

  const viewer = await resolvePortalLogin(actorEmail.trim().toLowerCase());
  if (!viewer.allowed || !viewer.role || viewer.role === "user") {
    throw new Error("Staff only.");
  }

  return prisma.cleaningCompletionPhoto.update({
    where: { id: photoId },
    data: { excludedFromReference: excluded }
  });
}

export async function uploadCleaningReferencePhotos(input: {
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
  uploadedBy: string;
  photos: CleaningPhotoInput[];
  caption?: string;
}) {
  if (input.photos.length === 0) {
    throw new Error("At least one reference photo is required.");
  }
  if (input.photos.length > MAX_PHOTOS_PER_UPLOAD) {
    throw new Error(`A maximum of ${MAX_PHOTOS_PER_UPLOAD} photos is allowed per upload.`);
  }

  const existingCount = await prisma.cleaningReferencePhoto.count({
    where: {
      taskType: input.taskType,
      branchId: input.branchId,
      floor: input.taskType === CleaningTaskType.TRASH_D7 ? (input.floor ?? null) : null,
      isActive: true
    }
  });

  const saved = [];
  for (let index = 0; index < input.photos.length; index += 1) {
    const photo = input.photos[index]!;
    const file = await saveCompressedPhoto(photo, referencePhotosDir, "ref");
    saved.push(
      await prisma.cleaningReferencePhoto.create({
        data: {
          taskType: input.taskType,
          branchId: input.branchId,
          floor: input.taskType === CleaningTaskType.TRASH_D7 ? (input.floor ?? null) : null,
          storageName: file.storageName,
          fileName: file.fileName,
          caption: input.caption?.trim().slice(0, 191) || null,
          uploadedBy: input.uploadedBy.trim().toLowerCase(),
          sortOrder: existingCount + index
        }
      })
    );
  }

  return saved;
}

export async function deactivateCleaningReferencePhoto(id: string, actorEmail: string) {
  const photo = await prisma.cleaningReferencePhoto.findUnique({ where: { id } });
  if (!photo || !photo.isActive) {
    throw new Error("Reference photo not found.");
  }

  void actorEmail;
  return prisma.cleaningReferencePhoto.update({
    where: { id },
    data: { isActive: false, updatedAt: new Date() }
  });
}

/** Write compressed JPEG files to disk only (no DB rows). Caller must clean up on failure. */
export async function persistCleaningCompletionPhotoFiles(photos: CleaningPhotoInput[]) {
  if (photos.length === 0) {
    throw new Error("At least one completion photo is required.");
  }
  if (photos.length > MAX_PHOTOS_PER_UPLOAD) {
    throw new Error(`A maximum of ${MAX_PHOTOS_PER_UPLOAD} photos is allowed per completion.`);
  }

  const saved: Array<{ storageName: string; fileName: string }> = [];
  try {
    for (const photo of photos) {
      saved.push(await saveCompressedPhoto(photo, completionPhotosDir, "done"));
    }
    return saved;
  } catch (error) {
    await deleteCleaningCompletionPhotoFiles(saved.map((entry) => entry.storageName));
    throw error;
  }
}

export async function deleteCleaningCompletionPhotoFiles(storageNames: string[]) {
  await Promise.all(
    storageNames.map(async (storageName) => {
      try {
        await unlink(resolvePhotoPath(storageName, "completion"));
      } catch {
        // ignore missing files during cleanup
      }
    })
  );
}

/** @deprecated Prefer persistCleaningCompletionPhotoFiles + DB transaction. Kept for compatibility. */
export async function saveCleaningCompletionPhotos(taskId: string, photos: CleaningPhotoInput[]) {
  const files = await persistCleaningCompletionPhotoFiles(photos);
  try {
    const saved = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      saved.push(
        await prisma.cleaningCompletionPhoto.create({
          data: {
            taskId,
            storageName: file.storageName,
            fileName: file.fileName,
            sortOrder: index
          }
        })
      );
    }
    return saved;
  } catch (error) {
    await deleteCleaningCompletionPhotoFiles(files.map((file) => file.storageName));
    throw error;
  }
}

export async function getCleaningCompletionPhotosForTask(taskId: string) {
  return prisma.cleaningCompletionPhoto.findMany({
    where: { taskId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

function resolvePhotoPath(storageName: string, kind: "reference" | "completion"): string {
  const safeName = path.basename(storageName);
  if (!/^[a-zA-Z0-9._-]+\.jpg$/.test(safeName)) {
    throw new Error("Invalid photo file name.");
  }
  const dir = kind === "reference" ? referencePhotosDir : completionPhotosDir;
  return path.join(dir, safeName);
}

export async function readCleaningPhotoBytes(storageName: string, kind: "reference" | "completion") {
  const absolutePath = resolvePhotoPath(storageName, kind);
  return readFile(absolutePath);
}

export async function canViewCleaningCompletionPhoto(storageName: string, viewerEmail: string) {
  const photo = await prisma.cleaningCompletionPhoto.findUnique({
    where: { storageName },
    include: { task: { select: { userEmail: true } } }
  });
  if (!photo) {
    return false;
  }

  const normalized = viewerEmail.trim().toLowerCase();
  if (photo.task.userEmail.trim().toLowerCase() === normalized) {
    return true;
  }

  const viewer = await resolvePortalLogin(normalized);
  return Boolean(viewer.allowed && viewer.role && viewer.role !== "user");
}

export async function canViewCleaningReferencePhoto(viewerEmail: string) {
  const viewer = await resolvePortalLogin(viewerEmail.trim().toLowerCase());
  return Boolean(viewer.allowed && viewer.role && viewer.role !== "user");
}

export function buildCleaningPhotoUrl(storageName: string, email: string) {
  return `/cleaning/photos/${encodeURIComponent(storageName)}?email=${encodeURIComponent(email)}`;
}
