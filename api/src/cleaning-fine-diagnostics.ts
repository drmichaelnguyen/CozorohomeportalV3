/**
 * Report-only diagnostic for duplicate / orphaned cleaning fine tickets.
 * Never mutates sheet or SQL data. Does not print raw resident emails.
 */
import { createHash } from "node:crypto";

import {
  AUTO_CLEANING_FINE_DESCRIPTION_PREFIX,
  FINE_CONTENT_COLUMN,
  FINE_DESCRIPTION_COLUMN,
  parseTaskIdFromAutomaticCleaningFineDescription
} from "./cleaning-missed-fine-amount.js";
import { prisma } from "./prisma.js";
import { readFinesSheetRows } from "./google-sheets.js";

const EVASION_CONTENT = "Cleaning duty evasion";

function emailFingerprint(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);
}

function monthFromEvasionDescription(description: string): string | null {
  const match = description.match(/Cleaning duty evasion for (\d{4}-\d{2})/);
  return match?.[1] ?? null;
}

export type CleaningFineDuplicateReport = {
  generatedAt: string;
  mode: "report-only";
  duplicateTaskIdMarkers: Array<{ taskId: string; count: number }>;
  duplicateEvasionMonths: Array<{ emailFingerprint: string; month: string; count: number }>;
  actionLogCreationsMissingFromSheet: Array<{
    taskId: string;
    actionAt: string;
    actorRole: string | null;
  }>;
  summary: {
    duplicateTaskIdGroups: number;
    duplicateEvasionGroups: number;
    orphanActionLogCreations: number;
    automaticMissedFineRowsScanned: number;
    evasionFineRowsScanned: number;
  };
};

export async function reportDuplicateCleaningFines(options?: {
  actionLogLookbackDays?: number;
}): Promise<CleaningFineDuplicateReport> {
  const lookbackDays = Math.max(1, Math.min(365, options?.actionLogLookbackDays ?? 120));
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await readFinesSheetRows();

  const taskIdCounts = new Map<string, number>();
  let automaticMissedFineRowsScanned = 0;
  for (const row of rows) {
    const description = row[FINE_DESCRIPTION_COLUMN] ?? "";
    if (!description.includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX)) continue;
    automaticMissedFineRowsScanned += 1;
    const taskId = parseTaskIdFromAutomaticCleaningFineDescription(description);
    if (!taskId) continue;
    taskIdCounts.set(taskId, (taskIdCounts.get(taskId) ?? 0) + 1);
  }

  const duplicateTaskIdMarkers = [...taskIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([taskId, count]) => ({ taskId, count }))
    .sort((a, b) => b.count - a.count || a.taskId.localeCompare(b.taskId));

  const evasionCounts = new Map<string, number>();
  let evasionFineRowsScanned = 0;
  for (const row of rows) {
    if ((row[FINE_CONTENT_COLUMN] ?? "").trim() !== EVASION_CONTENT) continue;
    evasionFineRowsScanned += 1;
    const email = (row.EMAIL ?? "").trim().toLowerCase();
    const month = monthFromEvasionDescription(row[FINE_DESCRIPTION_COLUMN] ?? "");
    if (!email || !month) continue;
    const key = `${emailFingerprint(email)}|${month}`;
    evasionCounts.set(key, (evasionCounts.get(key) ?? 0) + 1);
  }

  const duplicateEvasionMonths = [...evasionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [emailFingerprintValue, month] = key.split("|");
      return { emailFingerprint: emailFingerprintValue, month, count };
    })
    .sort((a, b) => b.count - a.count || a.month.localeCompare(b.month));

  const sheetTaskIds = new Set(
    [...taskIdCounts.keys()]
  );

  const actionLogs = await prisma.actionLog.findMany({
    where: {
      action: "cleaning.task.missed_fine",
      createdAt: { gte: since }
    },
    select: {
      entityId: true,
      createdAt: true,
      actorRole: true
    },
    orderBy: { createdAt: "desc" },
    take: 5000
  });

  const actionLogCreationsMissingFromSheet = actionLogs
    .filter((entry) => entry.entityId && !sheetTaskIds.has(entry.entityId))
    .map((entry) => ({
      taskId: entry.entityId!,
      actionAt: entry.createdAt.toISOString(),
      actorRole: entry.actorRole
    }));

  return {
    generatedAt: new Date().toISOString(),
    mode: "report-only",
    duplicateTaskIdMarkers,
    duplicateEvasionMonths,
    actionLogCreationsMissingFromSheet,
    summary: {
      duplicateTaskIdGroups: duplicateTaskIdMarkers.length,
      duplicateEvasionGroups: duplicateEvasionMonths.length,
      orphanActionLogCreations: actionLogCreationsMissingFromSheet.length,
      automaticMissedFineRowsScanned,
      evasionFineRowsScanned
    }
  };
}
