import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CleaningAiVerdict,
  CleaningAuditDecision,
  CleaningTaskType,
  CleaningTaskStatus
} from "@prisma/client";

import { prisma } from "./prisma.js";
import { requirePortalRole } from "./staff-access.js";

export const CLEANING_AI_AUTO_REVIEWER = "AI_AUTO";

const settingsFilePath = path.join(process.cwd(), "data", "cleaning-ai-benchmark-settings.json");

export type CleaningAiBenchmarkSettings = {
  evaluationWindowDays: number;
  accuracyThresholdPercent: number;
  minSampleSize: number;
  autoSkipManualAuditEnabled: boolean;
};

const DEFAULT_SETTINGS: CleaningAiBenchmarkSettings = {
  evaluationWindowDays: 90,
  accuracyThresholdPercent: 90,
  minSampleSize: 50,
  autoSkipManualAuditEnabled: false
};

type BenchmarkTaskSnapshot = {
  id: string;
  type: CleaningTaskType;
  branchId: string;
  floor: number | null;
  aiVerdict: CleaningAiVerdict | null;
  aiScore: number | null;
};

function clampPercent(value: unknown, fallback: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(50, Math.min(100, Math.round(n)));
}

function clampPositiveInt(value: unknown, fallback: number, max = 365) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, Math.min(max, n));
}

function mergeSettings(partial: Partial<CleaningAiBenchmarkSettings>): CleaningAiBenchmarkSettings {
  return {
    evaluationWindowDays: clampPositiveInt(partial.evaluationWindowDays, DEFAULT_SETTINGS.evaluationWindowDays),
    accuracyThresholdPercent: clampPercent(partial.accuracyThresholdPercent, DEFAULT_SETTINGS.accuracyThresholdPercent),
    minSampleSize: clampPositiveInt(partial.minSampleSize, DEFAULT_SETTINGS.minSampleSize, 10_000),
    autoSkipManualAuditEnabled: partial.autoSkipManualAuditEnabled === true
  };
}

async function ensureSettingsFile(): Promise<CleaningAiBenchmarkSettings> {
  try {
    const raw = await readFile(settingsFilePath, "utf8");
    return mergeSettings(JSON.parse(raw) as Partial<CleaningAiBenchmarkSettings>);
  } catch {
    await mkdir(path.dirname(settingsFilePath), { recursive: true });
    await writeFile(settingsFilePath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf8");
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getCleaningAiBenchmarkSettings() {
  return ensureSettingsFile();
}

export async function updateCleaningAiBenchmarkSettings(
  actorEmail: string,
  partial: Partial<CleaningAiBenchmarkSettings>
) {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners can change AI benchmark settings.");
  const current = await ensureSettingsFile();
  const next = mergeSettings({ ...current, ...partial });
  await mkdir(path.dirname(settingsFilePath), { recursive: true });
  await writeFile(settingsFilePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function humanDecisionMatchesAiVerdict(
  aiVerdict: CleaningAiVerdict,
  humanDecision: CleaningAuditDecision
) {
  if (aiVerdict === CleaningAiVerdict.ELIGIBLE) {
    return humanDecision === CleaningAuditDecision.APPROVE;
  }
  if (aiVerdict === CleaningAiVerdict.NOT_ELIGIBLE) {
    return humanDecision === CleaningAuditDecision.REJECT;
  }
  return null;
}

export function isBenchmarkableAiVerdict(aiVerdict: CleaningAiVerdict | null | undefined) {
  return aiVerdict === CleaningAiVerdict.ELIGIBLE || aiVerdict === CleaningAiVerdict.NOT_ELIGIBLE;
}

export async function recordCleaningAiBenchmark(input: {
  task: BenchmarkTaskSnapshot;
  humanDecision: CleaningAuditDecision;
  reviewer: string;
}) {
  if (input.reviewer.trim() === CLEANING_AI_AUTO_REVIEWER) {
    return null;
  }
  if (!isBenchmarkableAiVerdict(input.task.aiVerdict)) {
    return null;
  }

  const aiVerdict = input.task.aiVerdict!;
  const aiMatchedHuman = humanDecisionMatchesAiVerdict(aiVerdict, input.humanDecision);
  if (aiMatchedHuman == null) {
    return null;
  }

  return prisma.cleaningAiBenchmark.create({
    data: {
      taskId: input.task.id,
      taskType: input.task.type,
      branchId: input.task.branchId,
      floor: input.task.floor,
      aiVerdict,
      aiScore: input.task.aiScore,
      humanDecision: input.humanDecision,
      aiMatchedHuman,
      reviewer: input.reviewer.trim().toLowerCase()
    }
  });
}

type WindowStats = {
  windowDays: number;
  sampleSize: number;
  matches: number;
  mismatches: number;
  accuracyPercent: number | null;
  eligibleHumanApprove: number;
  eligibleHumanReject: number;
  notEligibleHumanApprove: number;
  notEligibleHumanReject: number;
};

async function aggregateWindowStats(windowDays: number): Promise<WindowStats> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.cleaningAiBenchmark.findMany({
    where: { createdAt: { gte: since } },
    select: {
      aiVerdict: true,
      humanDecision: true,
      aiMatchedHuman: true
    }
  });

  const sampleSize = rows.length;
  const matches = rows.filter((row) => row.aiMatchedHuman).length;

  return {
    windowDays,
    sampleSize,
    matches,
    mismatches: sampleSize - matches,
    accuracyPercent: sampleSize > 0 ? Math.round((matches / sampleSize) * 1000) / 10 : null,
    eligibleHumanApprove: rows.filter(
      (row) => row.aiVerdict === CleaningAiVerdict.ELIGIBLE && row.humanDecision === CleaningAuditDecision.APPROVE
    ).length,
    eligibleHumanReject: rows.filter(
      (row) => row.aiVerdict === CleaningAiVerdict.ELIGIBLE && row.humanDecision === CleaningAuditDecision.REJECT
    ).length,
    notEligibleHumanApprove: rows.filter(
      (row) => row.aiVerdict === CleaningAiVerdict.NOT_ELIGIBLE && row.humanDecision === CleaningAuditDecision.APPROVE
    ).length,
    notEligibleHumanReject: rows.filter(
      (row) => row.aiVerdict === CleaningAiVerdict.NOT_ELIGIBLE && row.humanDecision === CleaningAuditDecision.REJECT
    ).length
  };
}

export async function getCleaningAiBenchmarkReport(input?: { days?: number }) {
  const settings = await getCleaningAiBenchmarkSettings();
  const evaluationDays = input?.days ?? settings.evaluationWindowDays;
  const [evaluationWindow, last30Days, allTime] = await Promise.all([
    aggregateWindowStats(evaluationDays),
    aggregateWindowStats(30),
    aggregateWindowStats(3650)
  ]);

  const autoSkipReady =
    evaluationWindow.sampleSize >= settings.minSampleSize &&
    evaluationWindow.accuracyPercent != null &&
    evaluationWindow.accuracyPercent >= settings.accuracyThresholdPercent;

  const recentMismatches = await prisma.cleaningAiBenchmark.findMany({
    where: { aiMatchedHuman: false },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      taskId: true,
      taskType: true,
      branchId: true,
      floor: true,
      aiVerdict: true,
      aiScore: true,
      humanDecision: true,
      reviewer: true,
      createdAt: true
    }
  });

  const since = new Date(Date.now() - evaluationDays * 24 * 60 * 60 * 1000);
  const groupedRows = await prisma.cleaningAiBenchmark.findMany({
    where: { createdAt: { gte: since } },
    select: { taskType: true, aiMatchedHuman: true }
  });

  const byTaskTypeMap = new Map<CleaningTaskType, { sampleSize: number; matches: number }>();
  for (const row of groupedRows) {
    const current = byTaskTypeMap.get(row.taskType) ?? { sampleSize: 0, matches: 0 };
    current.sampleSize += 1;
    if (row.aiMatchedHuman) current.matches += 1;
    byTaskTypeMap.set(row.taskType, current);
  }

  return {
    settings,
    evaluationWindow,
    last30Days,
    allTime,
    autoSkipReady,
    autoSkipActive: settings.autoSkipManualAuditEnabled && autoSkipReady,
    progressToAutoSkip: {
      sampleSize: evaluationWindow.sampleSize,
      sampleSizeRequired: settings.minSampleSize,
      accuracyPercent: evaluationWindow.accuracyPercent,
      accuracyRequired: settings.accuracyThresholdPercent
    },
    byTaskType: [...byTaskTypeMap.entries()].map(([taskType, stats]) => ({
      taskType,
      sampleSize: stats.sampleSize,
      matches: stats.matches,
      accuracyPercent:
        stats.sampleSize > 0 ? Math.round((stats.matches / stats.sampleSize) * 1000) / 10 : null
    })),
    recentMismatches
  };
}

export async function shouldAutoSkipManualCleaningAudit() {
  const settings = await getCleaningAiBenchmarkSettings();
  if (!settings.autoSkipManualAuditEnabled) {
    return { allowed: false as const, reason: "Auto-skip is disabled in settings." };
  }

  const report = await getCleaningAiBenchmarkReport({ days: settings.evaluationWindowDays });
  if (report.evaluationWindow.sampleSize < settings.minSampleSize) {
    return {
      allowed: false as const,
      reason: `Need at least ${settings.minSampleSize} human-reviewed AI comparisons (currently ${report.evaluationWindow.sampleSize}).`
    };
  }
  if (
    report.evaluationWindow.accuracyPercent == null ||
    report.evaluationWindow.accuracyPercent < settings.accuracyThresholdPercent
  ) {
    return {
      allowed: false as const,
      reason: `AI accuracy is ${report.evaluationWindow.accuracyPercent ?? 0}% — threshold is ${settings.accuracyThresholdPercent}%.`
    };
  }

  return {
    allowed: true as const,
    accuracyPercent: report.evaluationWindow.accuracyPercent,
    sampleSize: report.evaluationWindow.sampleSize
  };
}

export async function maybeAutoApproveEligibleCleaningTask(taskId: string) {
  const task = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== CleaningTaskStatus.DONE_PENDING_AUDIT) {
    return { autoApproved: false as const };
  }
  if (task.aiVerdict !== CleaningAiVerdict.ELIGIBLE) {
    return { autoApproved: false as const };
  }

  const gate = await shouldAutoSkipManualCleaningAudit();
  if (!gate.allowed) {
    return { autoApproved: false as const, reason: gate.reason };
  }

  return {
    autoApproved: true as const,
    accuracyPercent: gate.accuracyPercent,
    sampleSize: gate.sampleSize,
    note: `Auto-approved: AI eligible and benchmark accuracy ${gate.accuracyPercent}% over ${gate.sampleSize} human reviews.`
  };
}
