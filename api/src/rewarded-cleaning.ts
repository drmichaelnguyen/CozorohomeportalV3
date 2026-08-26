import {
  CleaningAiVerdict,
  CoinReason,
  RewardedCleaningPhotoPhase,
  RewardedCleaningStatus
} from "@prisma/client";
import { getActiveClientByEmail } from "./google-sheets.js";
import { prisma } from "./prisma.js";
import {
  assertResidentEmail,
  buildRewardedCleaningPhotoUrl,
  MAX_REWARDED_CLEANING_PHOTOS,
  saveRewardedCleaningPhotos,
  type RewardedCleaningPhotoInput
} from "./rewarded-cleaning-photos.js";
import {
  MIN_REWARDED_CLEANING_COINS,
  runRewardedCleaningVerification
} from "./rewarded-cleaning-verification.js";
import { requirePortalRole } from "./staff-access.js";
import { awardRewardedCleaningCoinsToSheet } from "./google-sheets.js";

const DEFAULT_SITES: Array<{ name: string; branchId: string | null }> = [
  { name: "Kitchen common area", branchId: null },
  { name: "Laundry room", branchId: null },
  { name: "Corridor / hallway", branchId: null },
  { name: "Trash / recycling area", branchId: null },
  { name: "Entrance / lobby", branchId: null },
  { name: "Shared bathroom", branchId: null },
  { name: "Bike parking area", branchId: null },
  { name: "Storage / utility room", branchId: null },
  { name: "Rooftop / balcony common area", branchId: null },
  { name: "Stairwell", branchId: null }
];

function normalizeBranch(value: string | undefined) {
  const normalized = (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7")) {
    return "D7" as const;
  }
  return "D2" as const;
}

function startOfTodayInHoChiMinh() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

async function ensureDefaultSites() {
  for (const site of DEFAULT_SITES) {
    const existing = await prisma.rewardedCleaningSite.findFirst({
      where: { name: site.name, branchId: site.branchId }
    });
    if (!existing) {
      await prisma.rewardedCleaningSite.create({
        data: {
          name: site.name,
          branchId: site.branchId,
          isSystem: true,
          isActive: true
        }
      });
    }
  }
}

async function resolveResidentBranch(email: string) {
  const client = await getActiveClientByEmail(email);
  if (!client) {
    throw new Error("Active resident account required.");
  }
  const branchId = normalizeBranch(String(client["Chi nhánh Cozoro dorm"] ?? client["BRANCH"] ?? ""));
  const userName = String(client["Họ và tên"] ?? client["NAME"] ?? "").trim() || null;
  return { branchId, userName, client };
}

function serializeSubmission(
  row: Awaited<ReturnType<typeof loadSubmissionById>>,
  viewerEmail: string
) {
  if (!row) {
    return null;
  }

  const beforePhotos = row.photos
    .filter((photo) => photo.phase === RewardedCleaningPhotoPhase.BEFORE)
    .map((photo) => ({
      id: photo.id,
      storageName: photo.storageName,
      fileName: photo.fileName,
      sortOrder: photo.sortOrder,
      url: buildRewardedCleaningPhotoUrl(photo.storageName, viewerEmail)
    }));
  const afterPhotos = row.photos
    .filter((photo) => photo.phase === RewardedCleaningPhotoPhase.AFTER)
    .map((photo) => ({
      id: photo.id,
      storageName: photo.storageName,
      fileName: photo.fileName,
      sortOrder: photo.sortOrder,
      url: buildRewardedCleaningPhotoUrl(photo.storageName, viewerEmail)
    }));

  return {
    id: row.id,
    userEmail: row.userEmail,
    userName: row.userName,
    branchId: row.branchId,
    siteId: row.siteId,
    siteName: row.site.name,
    workDate: row.workDate.toISOString().slice(0, 10),
    status: row.status,
    beforeNote: row.beforeNote,
    afterNote: row.afterNote,
    aiVerdict: row.aiVerdict,
    aiScore: row.aiScore,
    aiNote: row.aiNote,
    aiSuggestedCoins: row.aiSuggestedCoins,
    aiVerifiedAt: row.aiVerifiedAt?.toISOString() ?? null,
    rewardCoins: row.rewardCoins,
    reviewerEmail: row.reviewerEmail,
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    afterSubmittedAt: row.afterSubmittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    beforePhotos,
    afterPhotos
  };
}

async function loadSubmissionById(id: string) {
  return prisma.rewardedCleaningSubmission.findUnique({
    where: { id },
    include: {
      site: true,
      photos: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] }
    }
  });
}

export async function listRewardedCleaningSites(input: { email: string; branchId?: string }) {
  await assertResidentEmail(input.email);
  await ensureDefaultSites();

  const { branchId } = input.branchId
    ? { branchId: normalizeBranch(input.branchId) }
    : await resolveResidentBranch(input.email);

  const sites = await prisma.rewardedCleaningSite.findMany({
    where: {
      isActive: true,
      OR: [{ branchId: null }, { branchId }]
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }]
  });

  return sites.map((site) => ({
    id: site.id,
    name: site.name,
    branchId: site.branchId,
    isSystem: site.isSystem,
    createdBy: site.createdBy
  }));
}

export async function addRewardedCleaningSite(input: {
  email: string;
  name: string;
  branchId?: string;
}) {
  await assertResidentEmail(input.email);
  const normalizedEmail = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 191);
  if (name.length < 2) {
    throw new Error("Site name must be at least 2 characters.");
  }

  const { branchId } = input.branchId
    ? { branchId: normalizeBranch(input.branchId) }
    : await resolveResidentBranch(normalizedEmail);

  const existing = await prisma.rewardedCleaningSite.findFirst({
    where: {
      name: { equals: name },
      OR: [{ branchId: null }, { branchId }]
    }
  });
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      branchId: existing.branchId,
      isSystem: existing.isSystem,
      createdBy: existing.createdBy
    };
  }

  const site = await prisma.rewardedCleaningSite.create({
    data: {
      name,
      branchId,
      createdBy: normalizedEmail,
      isSystem: false,
      isActive: true
    }
  });

  return {
    id: site.id,
    name: site.name,
    branchId: site.branchId,
    isSystem: site.isSystem,
    createdBy: site.createdBy
  };
}

export async function getRewardedCleaningOverview(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  await assertResidentEmail(normalizedEmail);
  const { branchId } = await resolveResidentBranch(normalizedEmail);
  const workDate = startOfTodayInHoChiMinh();

  const [sites, todaySubmissions, recentSubmissions] = await Promise.all([
    listRewardedCleaningSites({ email: normalizedEmail, branchId }),
    prisma.rewardedCleaningSubmission.findMany({
      where: { userEmail: normalizedEmail, workDate },
      include: {
        site: true,
        photos: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.rewardedCleaningSubmission.findMany({
      where: { userEmail: normalizedEmail },
      include: {
        site: true,
        photos: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  const usedSiteIdsToday = new Set(todaySubmissions.map((row) => row.siteId));

  return {
    branchId,
    minRewardCoins: MIN_REWARDED_CLEANING_COINS,
    maxPhotos: MAX_REWARDED_CLEANING_PHOTOS,
    sites,
    usedSiteIdsToday: [...usedSiteIdsToday],
    todaySubmissions: todaySubmissions.map((row) => serializeSubmission(row, normalizedEmail)),
    recentSubmissions: recentSubmissions.map((row) => serializeSubmission(row, normalizedEmail))
  };
}

export async function submitRewardedCleaningBefore(input: {
  email: string;
  siteId: string;
  photos: RewardedCleaningPhotoInput[];
  note?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  await assertResidentEmail(normalizedEmail);
  const { branchId, userName } = await resolveResidentBranch(normalizedEmail);
  const workDate = startOfTodayInHoChiMinh();

  const site = await prisma.rewardedCleaningSite.findFirst({
    where: {
      id: input.siteId,
      isActive: true,
      OR: [{ branchId: null }, { branchId }]
    }
  });
  if (!site) {
    throw new Error("Cleaning site not found.");
  }

  const existing = await prisma.rewardedCleaningSubmission.findUnique({
    where: {
      userEmail_siteId_workDate: {
        userEmail: normalizedEmail,
        siteId: site.id,
        workDate
      }
    }
  });
  if (existing) {
    throw new Error("You already submitted cleaning for this site today.");
  }

  const submission = await prisma.rewardedCleaningSubmission.create({
    data: {
      userEmail: normalizedEmail,
      userName,
      branchId,
      siteId: site.id,
      workDate,
      status: RewardedCleaningStatus.AWAITING_AFTER,
      beforeNote: input.note?.trim().slice(0, 500) || null
    }
  });

  await saveRewardedCleaningPhotos({
    submissionId: submission.id,
    phase: RewardedCleaningPhotoPhase.BEFORE,
    photos: input.photos
  });

  const loaded = await loadSubmissionById(submission.id);
  return serializeSubmission(loaded, normalizedEmail);
}

export async function submitRewardedCleaningAfter(input: {
  email: string;
  submissionId: string;
  photos: RewardedCleaningPhotoInput[];
  note?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  await assertResidentEmail(normalizedEmail);

  const submission = await loadSubmissionById(input.submissionId);
  if (!submission || submission.userEmail !== normalizedEmail) {
    throw new Error("Submission not found.");
  }
  if (submission.status !== RewardedCleaningStatus.AWAITING_AFTER) {
    throw new Error("This submission is no longer waiting for after photos.");
  }

  const beforePhotos = submission.photos.filter(
    (photo) => photo.phase === RewardedCleaningPhotoPhase.BEFORE
  );
  if (beforePhotos.length === 0) {
    throw new Error("Before photos are missing.");
  }

  await saveRewardedCleaningPhotos({
    submissionId: submission.id,
    phase: RewardedCleaningPhotoPhase.AFTER,
    photos: input.photos
  });

  const afterPhotos = input.photos.length
    ? await prisma.rewardedCleaningPhoto.findMany({
        where: {
          submissionId: submission.id,
          phase: RewardedCleaningPhotoPhase.AFTER
        },
        orderBy: { sortOrder: "asc" }
      })
    : [];

  const verification = await runRewardedCleaningVerification({
    siteName: submission.site.name,
    branchId: submission.branchId,
    beforeStorageNames: beforePhotos.map((photo) => photo.storageName),
    afterStorageNames: afterPhotos.map((photo) => photo.storageName),
    actorEmail: normalizedEmail
  });

  await prisma.rewardedCleaningSubmission.update({
    where: { id: submission.id },
    data: {
      status: RewardedCleaningStatus.PENDING_REVIEW,
      afterNote: input.note?.trim().slice(0, 500) || null,
      afterSubmittedAt: new Date(),
      aiVerdict: verification.verdict,
      aiScore: verification.score,
      aiNote: verification.note,
      aiSuggestedCoins: verification.suggestedCoins,
      aiVerifiedAt: new Date()
    }
  });

  const loaded = await loadSubmissionById(submission.id);
  return serializeSubmission(loaded, normalizedEmail);
}

export async function listRewardedCleaningReviewQueue(actorEmail: string) {
  await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
  const rows = await prisma.rewardedCleaningSubmission.findMany({
    where: { status: RewardedCleaningStatus.PENDING_REVIEW },
    include: {
      site: true,
      photos: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] }
    },
    orderBy: { afterSubmittedAt: "asc" }
  });

  const viewer = actorEmail.trim().toLowerCase();
  return rows.map((row) => serializeSubmission(row, viewer));
}

export async function auditRewardedCleaningSubmission(input: {
  submissionId: string;
  reviewerEmail: string;
  approve: boolean;
  rewardCoins?: number;
  note?: string;
}) {
  const reviewer = input.reviewerEmail.trim().toLowerCase();
  await requirePortalRole(reviewer, ["manager", "owner", "app_admin"], "Staff only.");

  const submission = await loadSubmissionById(input.submissionId);
  if (!submission) {
    throw new Error("Submission not found.");
  }
  if (submission.status !== RewardedCleaningStatus.PENDING_REVIEW) {
    throw new Error("This submission is not pending review.");
  }

  if (input.approve) {
    const rewardCoins = Math.round(Number(input.rewardCoins ?? submission.aiSuggestedCoins ?? MIN_REWARDED_CLEANING_COINS));
    if (!Number.isFinite(rewardCoins) || rewardCoins < MIN_REWARDED_CLEANING_COINS) {
      throw new Error(`Minimum reward is ${MIN_REWARDED_CLEANING_COINS} coins.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.rewardedCleaningSubmission.update({
        where: { id: submission.id },
        data: {
          status: RewardedCleaningStatus.APPROVED,
          rewardCoins,
          reviewerEmail: reviewer,
          reviewerNote: input.note?.trim().slice(0, 500) || null,
          reviewedAt: new Date()
        }
      });

      await tx.coinLedger.create({
        data: {
          userId: submission.userEmail,
          delta: rewardCoins,
          reason: CoinReason.REWARDED_CLEANING_REWARD,
          refType: "rewarded_cleaning_submission",
          refId: submission.id
        }
      });

      await (tx as typeof prisma).actionLog.create({
        data: {
          actorEmail: reviewer,
          actorName: reviewer,
          actorRole: "manager",
          action: "rewarded_cleaning.approve",
          entityType: "RewardedCleaningSubmission",
          entityId: submission.id,
          entityLabel: `${submission.site.name}|${submission.workDate.toISOString().slice(0, 10)}`,
          details: `APPROVE ${rewardCoins} coins${input.note ? `; note=${input.note}` : ""}`
        }
      });
    });

    await awardRewardedCleaningCoinsToSheet({
      userEmail: submission.userEmail,
      userName: submission.userName,
      branchId: submission.branchId,
      rewardCoins,
      submissionId: submission.id,
      siteName: submission.site.name,
      reviewedBy: reviewer
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.rewardedCleaningSubmission.update({
        where: { id: submission.id },
        data: {
          status: RewardedCleaningStatus.REJECTED,
          rewardCoins: 0,
          reviewerEmail: reviewer,
          reviewerNote: input.note?.trim().slice(0, 500) || null,
          reviewedAt: new Date()
        }
      });

      await (tx as typeof prisma).actionLog.create({
        data: {
          actorEmail: reviewer,
          actorName: reviewer,
          actorRole: "manager",
          action: "rewarded_cleaning.reject",
          entityType: "RewardedCleaningSubmission",
          entityId: submission.id,
          entityLabel: `${submission.site.name}|${submission.workDate.toISOString().slice(0, 10)}`,
          details: `REJECT${input.note ? `; note=${input.note}` : ""}`
        }
      });
    });
  }

  const loaded = await loadSubmissionById(submission.id);
  return serializeSubmission(loaded, reviewer);
}

export { MIN_REWARDED_CLEANING_COINS, MAX_REWARDED_CLEANING_PHOTOS };
