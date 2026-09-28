import { CleaningTaskType } from "@prisma/client";

export type CleaningReferenceSource = "staff" | "learned" | "none";

export type ResolvedCleaningReferencePhoto = {
  id: string;
  storageName: string;
  fileName: string;
  caption: string | null;
  kind: "reference" | "completion";
  managerRating?: number | null;
  taskId?: string;
  approvedAt?: Date | null;
};

export type ResolvedCleaningReferences = {
  source: CleaningReferenceSource;
  photos: ResolvedCleaningReferencePhoto[];
};

export type LearnedReferenceCandidate = {
  photoId: string;
  storageName: string;
  fileName: string;
  taskId: string;
  managerRating: number;
  approvedAt: Date;
};

export const LEARNED_REFERENCE_MAX_PHOTOS = 5;
export const LEARNED_REFERENCE_MAX_PER_TASK = 2;
export const LEARNED_REFERENCE_MIN_RATING = 4;
export const LEARNED_REFERENCE_LOOKBACK_DAYS = 180;

export type ResolveCleaningReferenceDeps = {
  listStaffPhotos: (input: {
    taskType: CleaningTaskType;
    branchId: string;
    floor?: number | null;
  }) => Promise<Array<{ id: string; storageName: string; fileName: string; caption: string | null }>>;
  listLearnedCandidates: (input: {
    taskType: CleaningTaskType;
    branchId: string;
    floor?: number | null;
    excludeTaskId?: string;
    since: Date;
  }) => Promise<LearnedReferenceCandidate[]>;
  photoFileExists: (storageName: string, kind: "reference" | "completion") => Promise<boolean>;
};

/** Pure selection used by resolveCleaningReferencePhotos (and unit tests). */
export function selectLearnedCleaningReferencePhotos(
  candidates: LearnedReferenceCandidate[],
  options?: { maxPhotos?: number; maxPerTask?: number }
): LearnedReferenceCandidate[] {
  const maxPhotos = options?.maxPhotos ?? LEARNED_REFERENCE_MAX_PHOTOS;
  const maxPerTask = options?.maxPerTask ?? LEARNED_REFERENCE_MAX_PER_TASK;

  const sorted = [...candidates].sort((a, b) => {
    if (b.managerRating !== a.managerRating) {
      return b.managerRating - a.managerRating;
    }
    return b.approvedAt.getTime() - a.approvedAt.getTime();
  });

  const byTask = new Map<string, LearnedReferenceCandidate[]>();
  for (const candidate of sorted) {
    const list = byTask.get(candidate.taskId) ?? [];
    if (list.length >= maxPerTask) continue;
    list.push(candidate);
    byTask.set(candidate.taskId, list);
  }

  const taskOrder = [...byTask.keys()].sort((a, b) => {
    const left = byTask.get(a)![0]!;
    const right = byTask.get(b)![0]!;
    if (right.managerRating !== left.managerRating) {
      return right.managerRating - left.managerRating;
    }
    return right.approvedAt.getTime() - left.approvedAt.getTime();
  });

  // Round-robin across tasks so we prefer ≥2 distinct tasks when possible.
  const picked: LearnedReferenceCandidate[] = [];
  let round = 0;
  while (picked.length < maxPhotos) {
    let added = false;
    for (const taskId of taskOrder) {
      if (picked.length >= maxPhotos) break;
      const list = byTask.get(taskId)!;
      if (round < list.length) {
        picked.push(list[round]!);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }

  return picked;
}

export async function resolveCleaningReferencePhotos(
  input: {
    taskType: CleaningTaskType;
    branchId: string;
    floor?: number | null;
    excludeTaskId?: string;
  },
  deps: ResolveCleaningReferenceDeps
): Promise<ResolvedCleaningReferences> {
  const staff = await deps.listStaffPhotos({
    taskType: input.taskType,
    branchId: input.branchId,
    floor: input.floor
  });

  const staffWithFiles: ResolvedCleaningReferencePhoto[] = [];
  for (const photo of staff) {
    if (!(await deps.photoFileExists(photo.storageName, "reference"))) continue;
    staffWithFiles.push({
      id: photo.id,
      storageName: photo.storageName,
      fileName: photo.fileName,
      caption: photo.caption ?? null,
      kind: "reference"
    });
  }

  if (staffWithFiles.length > 0) {
    return { source: "staff", photos: staffWithFiles };
  }

  const since = new Date(Date.now() - LEARNED_REFERENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await deps.listLearnedCandidates({
    taskType: input.taskType,
    branchId: input.branchId,
    floor: input.floor,
    excludeTaskId: input.excludeTaskId,
    since
  });

  const withFiles: LearnedReferenceCandidate[] = [];
  for (const candidate of candidates) {
    if (!(await deps.photoFileExists(candidate.storageName, "completion"))) continue;
    withFiles.push(candidate);
  }

  const selected = selectLearnedCleaningReferencePhotos(withFiles);
  if (selected.length === 0) {
    return { source: "none", photos: [] };
  }

  return {
    source: "learned",
    photos: selected.map((photo) => ({
      id: photo.photoId,
      storageName: photo.storageName,
      fileName: photo.fileName,
      caption: null,
      kind: "completion" as const,
      managerRating: photo.managerRating,
      taskId: photo.taskId,
      approvedAt: photo.approvedAt
    }))
  };
}

export function describeCleaningReferenceSource(source: CleaningReferenceSource, photoCount: number): string {
  if (source === "staff") {
    return `compared with ${photoCount} staff reference photo${photoCount === 1 ? "" : "s"}`;
  }
  if (source === "learned") {
    return `compared with ${photoCount} manager-approved photo${photoCount === 1 ? "" : "s"} (★4+)`;
  }
  return "no reference photos available";
}
