/**
 * Owner feedback on AI Manager ActionLog rows: like/dislike + learning guides.
 * Guides are injected into later ticks for similar capabilities.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { prisma } from "./prisma.js";
import { logAction } from "./action-log.js";
import {
  disputeDecisionFromGuides as disputeDecisionFromGuidesPure,
  formatLearningGuidesForPrompt as formatLearningGuidesForPromptPure,
  inferAiManagerCapabilityFromAction,
  type AiManagerFeedbackCapability,
  type AiManagerFeedbackRating
} from "./ai-manager-logic.js";

export {
  disputeDecisionFromGuidesPure as disputeDecisionFromGuides,
  formatLearningGuidesForPromptPure as formatLearningGuidesForPrompt
};

const feedbackPath = path.join(process.cwd(), "data", "ai-manager-feedback.json");
const MAX_FEEDBACK_ENTRIES = 500;

export type AiManagerFeedbackEntry = {
  id: string;
  actionLogId: string;
  action: string;
  capability: AiManagerFeedbackCapability;
  rating: AiManagerFeedbackRating;
  guide: string;
  actorEmail: string;
  createdAt: string;
  updatedAt: string;
  actionDetails: string | null;
  entityLabel: string | null;
};

type FeedbackFile = { entries: AiManagerFeedbackEntry[] };

async function readFeedbackFile(): Promise<FeedbackFile> {
  try {
    const raw = await readFile(feedbackPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FeedbackFile>;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeFeedbackFile(file: FeedbackFile) {
  await mkdir(path.dirname(feedbackPath), { recursive: true });
  await writeFile(
    feedbackPath,
    JSON.stringify({ entries: file.entries.slice(0, MAX_FEEDBACK_ENTRIES) }, null, 2),
    "utf8"
  );
}

export async function listAiManagerFeedback(limit = 100): Promise<AiManagerFeedbackEntry[]> {
  const file = await readFeedbackFile();
  return file.entries.slice(0, Math.max(1, Math.min(200, limit)));
}

export async function getFeedbackByActionLogIds(
  actionLogIds: string[]
): Promise<Map<string, AiManagerFeedbackEntry>> {
  const wanted = new Set(actionLogIds.map((id) => id.trim()).filter(Boolean));
  const file = await readFeedbackFile();
  const map = new Map<string, AiManagerFeedbackEntry>();
  for (const entry of file.entries) {
    if (wanted.has(entry.actionLogId)) {
      map.set(entry.actionLogId, entry);
    }
  }
  return map;
}

export async function upsertAiManagerActionFeedback(input: {
  actorEmail: string;
  actionLogId: string;
  rating: AiManagerFeedbackRating;
  guide?: string;
}): Promise<AiManagerFeedbackEntry> {
  const actorEmail = input.actorEmail.trim().toLowerCase();
  const actionLogId = input.actionLogId.trim();
  if (!actionLogId) {
    throw new Error("Action log id is required.");
  }
  if (input.rating !== "like" && input.rating !== "dislike") {
    throw new Error("Rating must be like or dislike.");
  }

  const actionLog = await prisma.actionLog.findUnique({ where: { id: actionLogId } });
  if (!actionLog) {
    throw new Error("Action log entry not found.");
  }
  if (
    actionLog.entityType !== "AiManager" &&
    !(actionLog.action ?? "").startsWith("ai_manager.")
  ) {
    throw new Error("Feedback is only allowed on AI Manager actions.");
  }

  const guide = String(input.guide ?? "").trim().slice(0, 2000);
  const capability = inferAiManagerCapabilityFromAction(actionLog.action);
  const now = new Date().toISOString();
  const file = await readFeedbackFile();
  const existingIndex = file.entries.findIndex((entry) => entry.actionLogId === actionLogId);

  const nextEntry: AiManagerFeedbackEntry = {
    id:
      existingIndex >= 0
        ? file.entries[existingIndex]!.id
        : `aimfb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    actionLogId,
    action: actionLog.action,
    capability,
    rating: input.rating,
    guide,
    actorEmail,
    createdAt: existingIndex >= 0 ? file.entries[existingIndex]!.createdAt : now,
    updatedAt: now,
    actionDetails: actionLog.details ?? null,
    entityLabel: actionLog.entityLabel ?? null
  };

  if (existingIndex >= 0) {
    file.entries[existingIndex] = nextEntry;
  } else {
    file.entries.unshift(nextEntry);
  }
  await writeFeedbackFile(file);

  await logAction({
    actorEmail,
    actorRole: "owner",
    actorName: actorEmail,
    action: "ai_manager.feedback.upsert",
    entityType: "AiManagerFeedback",
    entityId: nextEntry.id,
    entityLabel: actionLogId,
    details: `rating=${input.rating}; capability=${capability}; guideChars=${guide.length}; action=${actionLog.action}`
  });

  return nextEntry;
}

/**
 * Standing instruction from owner chat (not tied to a prior ActionLog row).
 * Injected into later ticks the same way as like/dislike guides.
 */
export async function addAiManagerStandingGuide(input: {
  actorEmail: string;
  capability: AiManagerFeedbackCapability;
  guide: string;
  rating?: AiManagerFeedbackRating;
}): Promise<AiManagerFeedbackEntry> {
  const actorEmail = input.actorEmail.trim().toLowerCase();
  const guide = String(input.guide ?? "").trim().slice(0, 2000);
  if (!guide) {
    throw new Error("Guide text is required.");
  }
  const capability = input.capability;
  const allowed: AiManagerFeedbackCapability[] = [
    "answerChat",
    "manageFines",
    "scheduleAssignment",
    "ownerReports",
    "other"
  ];
  if (!allowed.includes(capability)) {
    throw new Error("Invalid capability for standing guide.");
  }
  const rating: AiManagerFeedbackRating = input.rating === "dislike" ? "dislike" : "like";
  const now = new Date().toISOString();
  const id = `aimfb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const nextEntry: AiManagerFeedbackEntry = {
    id,
    actionLogId: `standing-${id}`,
    action: "ai_manager.owner_chat.instruction",
    capability,
    rating,
    guide,
    actorEmail,
    createdAt: now,
    updatedAt: now,
    actionDetails: "source=owner_chat",
    entityLabel: null
  };

  const file = await readFeedbackFile();
  file.entries.unshift(nextEntry);
  await writeFeedbackFile(file);

  await logAction({
    actorEmail,
    actorRole: "owner",
    actorName: actorEmail,
    action: "ai_manager.owner_chat.instruction",
    entityType: "AiManagerFeedback",
    entityId: nextEntry.id,
    entityLabel: capability,
    details: `rating=${rating}; capability=${capability}; guideChars=${guide.length}`
  });

  return nextEntry;
}

/** Active learning notes for a capability (guides with text), newest first. */
export async function listLearningGuidesForCapability(
  capability: AiManagerFeedbackCapability,
  limit = 12
): Promise<AiManagerFeedbackEntry[]> {
  const file = await readFeedbackFile();
  return file.entries
    .filter(
      (entry) =>
        entry.capability === capability &&
        entry.guide.trim().length > 0
    )
    .slice(0, Math.max(1, Math.min(40, limit)));
}

export async function getLearningPromptBlock(
  capability: AiManagerFeedbackCapability
): Promise<string> {
  const guides = await listLearningGuidesForCapability(capability, 12);
  return formatLearningGuidesForPromptPure(guides);
}
