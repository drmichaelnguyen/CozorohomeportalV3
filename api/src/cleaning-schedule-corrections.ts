import {
  CleaningAssignmentSource,
  CleaningScheduleCorrectionAction,
  CleaningTaskType,
  Prisma
} from "@prisma/client";

import { logAction } from "./action-log.js";
import { prisma } from "./prisma.js";

export type CorrectionReasonDto = {
  id: string;
  code: string | null;
  labelVi: string;
  labelEn: string | null;
  isSystem: boolean;
  sortOrder: number;
};

export type CorrectionPayload = {
  reasonIds?: string[];
  customNote?: string | null;
  newReasonLabel?: string | null;
};

const DEFAULT_REASONS: Array<{
  code: string;
  labelVi: string;
  labelEn: string;
  sortOrder: number;
}> = [
  {
    code: "overlap",
    labelVi: "Vẫn phân trùng lịch (chồng chéo)",
    labelEn: "Still assigns overlapping schedules",
    sortOrder: 10
  },
  {
    code: "overlap_random",
    labelVi: "Trùng lịch không theo quy luật nào",
    labelEn: "Overlaps with no clear pattern",
    sortOrder: 20
  },
  {
    code: "never_assigned",
    labelVi: "Có bạn thì hệ thống không phân",
    labelEn: "Some people never get assigned",
    sortOrder: 30
  },
  {
    code: "over_assigned_week",
    labelVi: "Có bạn 1 tuần bị phân 3 lần",
    labelEn: "Some people get assigned 3 times in one week",
    sortOrder: 40
  },
  {
    code: "wrong_person",
    labelVi: "Phân sai người",
    labelEn: "Wrong person assigned",
    sortOrder: 50
  },
  {
    code: "other",
    labelVi: "Lý do khác",
    labelEn: "Other reason",
    sortOrder: 90
  }
];

function normalizeLabel(label: string) {
  return label.trim().replace(/\s+/g, " ");
}

export async function ensureDefaultCorrectionReasons() {
  for (const reason of DEFAULT_REASONS) {
    await prisma.cleaningScheduleCorrectionReason.upsert({
      where: { code: reason.code },
      update: {
        labelVi: reason.labelVi,
        labelEn: reason.labelEn,
        isSystem: true,
        isActive: true,
        sortOrder: reason.sortOrder
      },
      create: {
        code: reason.code,
        labelVi: reason.labelVi,
        labelEn: reason.labelEn,
        isSystem: true,
        isActive: true,
        sortOrder: reason.sortOrder
      }
    });
  }
}

export async function listActiveCorrectionReasons(): Promise<CorrectionReasonDto[]> {
  await ensureDefaultCorrectionReasons();
  const rows = await prisma.cleaningScheduleCorrectionReason.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    labelVi: row.labelVi,
    labelEn: row.labelEn,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder
  }));
}

export async function createCustomCorrectionReason(input: {
  labelVi: string;
  labelEn?: string | null;
  createdBy?: string | null;
}): Promise<CorrectionReasonDto> {
  const labelVi = normalizeLabel(input.labelVi);
  if (!labelVi) {
    throw new Error("Reason label is required");
  }
  if (labelVi.length > 200) {
    throw new Error("Reason label is too long");
  }

  const existing = await prisma.cleaningScheduleCorrectionReason.findFirst({
    where: {
      isActive: true,
      labelVi: { equals: labelVi }
    }
  });
  if (existing) {
    return {
      id: existing.id,
      code: existing.code,
      labelVi: existing.labelVi,
      labelEn: existing.labelEn,
      isSystem: existing.isSystem,
      sortOrder: existing.sortOrder
    };
  }

  const maxSort = await prisma.cleaningScheduleCorrectionReason.aggregate({
    _max: { sortOrder: true }
  });
  const sortOrder = Math.max(100, (maxSort._max.sortOrder ?? 100) + 10);

  const created = await prisma.cleaningScheduleCorrectionReason.create({
    data: {
      labelVi,
      labelEn: input.labelEn?.trim() || labelVi,
      isSystem: false,
      isActive: true,
      sortOrder,
      createdBy: input.createdBy?.trim().toLowerCase() || null
    }
  });

  return {
    id: created.id,
    code: created.code,
    labelVi: created.labelVi,
    labelEn: created.labelEn,
    isSystem: created.isSystem,
    sortOrder: created.sortOrder
  };
}

async function resolveReasonIds(payload: CorrectionPayload, actorEmail?: string | null) {
  const reasonIds = new Set<string>((payload.reasonIds ?? []).filter(Boolean));

  const newLabel = payload.newReasonLabel ? normalizeLabel(payload.newReasonLabel) : "";
  if (newLabel) {
    const created = await createCustomCorrectionReason({
      labelVi: newLabel,
      createdBy: actorEmail
    });
    reasonIds.add(created.id);
  }

  if (reasonIds.size === 0) {
    throw new Error("Select at least one correction reason");
  }

  const found = await prisma.cleaningScheduleCorrectionReason.findMany({
    where: {
      id: { in: Array.from(reasonIds) },
      isActive: true
    }
  });

  if (found.length !== reasonIds.size) {
    throw new Error("One or more correction reasons are invalid");
  }

  return found;
}

export async function recordCleaningScheduleCorrection(input: {
  action: CleaningScheduleCorrectionAction;
  taskId?: string | null;
  slotKey?: string | null;
  taskType: CleaningTaskType;
  scheduledDate: Date;
  floor?: number | null;
  previousUserEmail?: string | null;
  previousUserName?: string | null;
  previousSource?: CleaningAssignmentSource | null;
  newUserEmail?: string | null;
  actorEmail: string;
  actorName?: string | null;
  correction: CorrectionPayload;
}) {
  const reasons = await resolveReasonIds(input.correction, input.actorEmail);
  const customNote = input.correction.customNote?.trim() || null;

  const correction = await prisma.cleaningScheduleCorrection.create({
    data: {
      action: input.action,
      taskId: input.taskId ?? null,
      slotKey: input.slotKey ?? null,
      taskType: input.taskType,
      scheduledDate: input.scheduledDate,
      floor: input.floor ?? null,
      previousUserEmail: input.previousUserEmail?.trim().toLowerCase() || null,
      previousUserName: input.previousUserName?.trim() || null,
      previousSource: input.previousSource ?? null,
      newUserEmail: input.newUserEmail?.trim().toLowerCase() || null,
      actorEmail: input.actorEmail.trim().toLowerCase(),
      actorName: input.actorName?.trim() || null,
      customNote,
      reasons: {
        create: reasons.map((reason) => ({
          reasonId: reason.id
        }))
      }
    },
    include: {
      reasons: {
        include: { reason: true }
      }
    }
  });

  const reasonCodes = correction.reasons
    .map((link) => link.reason.code || link.reason.labelVi)
    .join(",");

  await logAction({
    actorEmail: input.actorEmail.trim().toLowerCase(),
    actorName: input.actorName?.trim() || "Cozoro",
    actorRole: "manager",
    action: "cleaning.task.correction",
    entityType: "CleaningScheduleCorrection",
    entityId: correction.id,
    entityLabel: `${input.taskType}|${input.scheduledDate.toISOString().slice(0, 10)}`,
    details: [
      `action=${input.action}`,
      `reasons=${reasonCodes}`,
      input.previousUserEmail ? `from=${input.previousUserEmail}` : null,
      input.newUserEmail ? `to=${input.newUserEmail}` : null,
      input.previousSource ? `prevSource=${input.previousSource}` : null,
      customNote ? `note=${customNote.slice(0, 200)}` : null
    ]
      .filter(Boolean)
      .join("; ")
  });

  return correction;
}

export function inferCorrectionAction(input: {
  force?: boolean;
  previousSource?: CleaningAssignmentSource | null;
  hadPreviousAssignee: boolean;
}): CleaningScheduleCorrectionAction {
  if (input.force) {
    return CleaningScheduleCorrectionAction.ASSIGN_OVERRIDE;
  }
  if (input.previousSource === CleaningAssignmentSource.SYSTEM) {
    return CleaningScheduleCorrectionAction.REPLACE_SYSTEM;
  }
  if (input.hadPreviousAssignee) {
    return CleaningScheduleCorrectionAction.REASSIGN;
  }
  return CleaningScheduleCorrectionAction.REPLACE_SYSTEM;
}

export type { CleaningScheduleCorrectionAction };

export const correctionPayloadSchemaShape = {
  reasonIds: true as const,
  customNote: true as const,
  newReasonLabel: true as const
};

/** Narrow Prisma error when tables are not migrated yet. */
export function isMissingCorrectionTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}
