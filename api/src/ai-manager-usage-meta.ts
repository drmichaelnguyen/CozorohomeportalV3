/**
 * Pure metadata for AI Manager LLM usage attribution (no Prisma / IO).
 * Keep in sync with recordGeminiUsage / generateManagerSupportReplyDraft feature keys.
 */

export const AI_MANAGER_USAGE_FEATURES = [
  "ai_manager_report",
  "ai_manager_chat_reply",
  "ai_manager_fines",
  "ai_manager_schedule",
  "ai_manager_owner_chat"
] as const;

export type AiManagerUsageFeature = (typeof AI_MANAGER_USAGE_FEATURES)[number];

export const AI_MANAGER_USAGE_CATEGORIES: Record<
  AiManagerUsageFeature,
  { capability: string; label: string }
> = {
  ai_manager_report: { capability: "ownerReports", label: "Owner reports" },
  ai_manager_chat_reply: { capability: "answerChat", label: "Answer support chat" },
  ai_manager_fines: { capability: "manageFines", label: "Create / correct fines" },
  ai_manager_schedule: { capability: "scheduleAssignment", label: "Cleaning schedule assignment" },
  ai_manager_owner_chat: { capability: "ownerChat", label: "Owner chat" }
};

export const AI_MANAGER_USAGE_FEATURE_LABELS: Record<AiManagerUsageFeature, string> = {
  ai_manager_report: "AI Manager · owner reports",
  ai_manager_chat_reply: "AI Manager · answer chat",
  ai_manager_fines: "AI Manager · fines",
  ai_manager_schedule: "AI Manager · schedule assignment",
  ai_manager_owner_chat: "AI Manager · owner chat"
};

export function isAiManagerUsageFeature(value: string): value is AiManagerUsageFeature {
  return (AI_MANAGER_USAGE_FEATURES as readonly string[]).includes(value);
}
