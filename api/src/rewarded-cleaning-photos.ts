import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RewardedCleaningPhotoPhase } from "@prisma/client";
import { compressFineEvidence } from "./fine-evidence-compress.js";
import { prisma } from "./prisma.js";
import { requirePortalRole, resolvePortalLogin } from "./staff-access.js";

export type RewardedCleaningPhotoInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

const photosDir = path.join(process.cwd(), "data", "rewarded-cleaning-photos");
export const MAX_REWARDED_CLEANING_PHOTOS = 3;
const MAX_RAW_BYTES = 12 * 1024 * 1024;

async function saveCompressedPhoto(input: RewardedCleaningPhotoInput, namePrefix: string) {
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
  await mkdir(photosDir, { recursive: true });
  const storageName = `${namePrefix}-${randomUUID()}.jpg`;
  await writeFile(path.join(photosDir, storageName), compressed.buffer);

  return {
    storageName,
    fileName: input.fileName.trim().slice(0, 191) || "photo.jpg"
  };
}

export async function saveRewardedCleaningPhotos(input: {
  submissionId: string;
  phase: RewardedCleaningPhotoPhase;
  photos: RewardedCleaningPhotoInput[];
}) {
  if (input.photos.length === 0) {
    throw new Error("At least one photo is required.");
  }
  if (input.photos.length > MAX_REWARDED_CLEANING_PHOTOS) {
    throw new Error(`A maximum of ${MAX_REWARDED_CLEANING_PHOTOS} photos is allowed.`);
  }

  const existingCount = await prisma.rewardedCleaningPhoto.count({
    where: { submissionId: input.submissionId, phase: input.phase }
  });
  if (existingCount > 0) {
    throw new Error("Photos for this phase were already submitted.");
  }

  const prefix = input.phase === RewardedCleaningPhotoPhase.BEFORE ? "rc-before" : "rc-after";
  const saved = [];
  for (let index = 0; index < input.photos.length; index += 1) {
    const photo = input.photos[index]!;
    const file = await saveCompressedPhoto(photo, prefix);
    saved.push(
      await prisma.rewardedCleaningPhoto.create({
        data: {
          submissionId: input.submissionId,
          phase: input.phase,
          storageName: file.storageName,
          fileName: file.fileName,
          sortOrder: index
        }
      })
    );
  }

  return saved;
}

export async function readRewardedCleaningPhotoBytes(storageName: string) {
  const safeName = path.basename(storageName);
  if (!/^rc-(before|after)-[0-9a-f-]+\.jpg$/i.test(safeName)) {
    throw new Error("Invalid photo name.");
  }
  return readFile(path.join(photosDir, safeName));
}

export async function canViewRewardedCleaningPhoto(storageName: string, viewerEmail: string) {
  const normalized = viewerEmail.trim().toLowerCase();
  const photo = await prisma.rewardedCleaningPhoto.findFirst({
    where: { storageName },
    include: { submission: true }
  });
  if (!photo) {
    return false;
  }

  if (photo.submission.userEmail === normalized) {
    return true;
  }

  try {
    await requirePortalRole(normalized, ["manager", "owner", "app_admin"], "Staff only.");
    return true;
  } catch {
    return false;
  }
}

export function buildRewardedCleaningPhotoUrl(storageName: string, email: string) {
  return `/rewarded-cleaning/photos/${encodeURIComponent(storageName)}?email=${encodeURIComponent(email)}`;
}

export async function assertResidentEmail(email: string) {
  const login = await resolvePortalLogin(email);
  if (!login || login.role !== "user") {
    throw new Error("Active resident session required.");
  }
  return login;
}
