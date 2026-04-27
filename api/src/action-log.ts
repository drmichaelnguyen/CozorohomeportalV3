import { prisma } from "./prisma.js";

type ActionLogWriter = {
  actionLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export type ActionLogInput = {
  actorEmail?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: string | null;
  db?: ActionLogWriter;
};

function trimOrNull(value: string | null | undefined, limit = 191): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, limit);
}

export async function logAction(input: ActionLogInput) {
  const db = input.db ?? prisma;
  const actionLogDb = db as {
    actionLog: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
  };
  try {
    await actionLogDb.actionLog.create({
      data: {
        actorEmail: trimOrNull(input.actorEmail),
        actorName: trimOrNull(input.actorName),
        actorRole: trimOrNull(input.actorRole),
        action: trimOrNull(input.action) ?? "unknown",
        entityType: trimOrNull(input.entityType) ?? "Unknown",
        entityId: trimOrNull(input.entityId),
        entityLabel: trimOrNull(input.entityLabel),
        details: trimOrNull(input.details, 4000)
      }
    });
  } catch (error) {
    console.error("[action-log] failed", error instanceof Error ? error.message : error);
  }
}
