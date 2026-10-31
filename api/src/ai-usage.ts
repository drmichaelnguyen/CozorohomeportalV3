import { getGeminiModel } from "./gemini-model.js";
import { prisma } from "./prisma.js";
import {
  AI_MANAGER_USAGE_CATEGORIES,
  AI_MANAGER_USAGE_FEATURE_LABELS,
  AI_MANAGER_USAGE_FEATURES,
  type AiManagerUsageFeature
} from "./ai-manager-usage-meta.js";

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

export type AiModality = "text" | "vision";

export {
  AI_MANAGER_USAGE_CATEGORIES,
  AI_MANAGER_USAGE_FEATURE_LABELS,
  AI_MANAGER_USAGE_FEATURES,
  type AiManagerUsageFeature
};

export const AI_FEATURE_LABELS: Record<string, string> = {
  manager_ai_chat: "Manager AI chat",
  manager_support_reply_draft: "Manager support reply draft",
  resident_portal: "Resident assistant",
  resident_support_thread: "Support assistant",
  cleaning_photo_verification: "Cleaning photo verification",
  ...AI_MANAGER_USAGE_FEATURE_LABELS
};

export const AI_MODALITY_LABELS: Record<AiModality, string> = {
  text: "Text chat",
  vision: "Computer vision"
};

type ModelPricing = {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
  version: string;
  /** Exclusive end of this price tier (ISO); omitted on the latest tier. */
  until?: string;
};

// Gemini standard paid-tier pricing per model, newest tier last. Checked 2026-10-30.
const GEMINI_MODEL_PRICING: Record<string, ModelPricing[]> = {
  "gemini-2.5-flash": [
    {
      inputPerMillionUsd: 0.3,
      cachedInputPerMillionUsd: 0.03,
      outputPerMillionUsd: 2.5,
      version: "gemini-2.5-flash-standard-2026-07-21"
    }
  ],
  "gemini-3.8-flash": [
    {
      inputPerMillionUsd: 0.75,
      cachedInputPerMillionUsd: 0.075,
      outputPerMillionUsd: 3.75,
      version: "gemini-3.8-flash-standard-2026-10-30",
      until: "2027-01-01T00:00:00Z"
    },
    {
      inputPerMillionUsd: 1.5,
      cachedInputPerMillionUsd: 0.15,
      outputPerMillionUsd: 7.5,
      version: "gemini-3.8-flash-standard-2027-01-01"
    }
  ]
};

const UNPRICED_VERSION = "unpriced";

function resolveModelPricing(provider: string, model: string, at = new Date()): ModelPricing | null {
  if (provider !== "GOOGLE") return null;
  const tiers = GEMINI_MODEL_PRICING[model];
  if (!tiers?.length) return null;
  return tiers.find((tier) => !tier.until || at < new Date(tier.until)) ?? tiers[tiers.length - 1];
}

function safeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function normalizeModality(value?: string | null): AiModality {
  return value === "vision" ? "vision" : "text";
}

function estimateCostMicros(pricing: ModelPricing | null, usage?: GeminiUsageMetadata): number {
  if (!pricing || !usage) return 0;
  const prompt = safeTokenCount(usage.promptTokenCount);
  const cached = Math.min(prompt, safeTokenCount(usage.cachedContentTokenCount));
  const uncached = prompt - cached;
  const output = safeTokenCount(usage.candidatesTokenCount) + safeTokenCount(usage.thoughtsTokenCount);
  return Math.round(
    uncached * pricing.inputPerMillionUsd +
      cached * pricing.cachedInputPerMillionUsd +
      output * pricing.outputPerMillionUsd
  );
}

function currentGeminiPricingSummary() {
  const model = getGeminiModel();
  const pricing = resolveModelPricing("GOOGLE", model);
  return {
    geminiModel: model,
    geminiInputUsdPerMillion: pricing?.inputPerMillionUsd ?? null,
    geminiOutputUsdPerMillion: pricing?.outputPerMillionUsd ?? null
  };
}

type UsageStatus = "SUCCESS" | "ERROR" | "RATE_LIMITED" | "INVALID_RESPONSE";

export type RecordAiUsageInput = {
  feature: string;
  modality?: AiModality;
  provider?: string;
  model?: string;
  actorEmail?: string | null;
  usage?: GeminiUsageMetadata;
  imageCount?: number;
  status?: UsageStatus;
  latencyMs?: number;
};

export async function recordAiUsage(input: RecordAiUsageInput) {
  const usage = input.usage;
  const promptTokens = safeTokenCount(usage?.promptTokenCount);
  const outputTokens = safeTokenCount(usage?.candidatesTokenCount);
  const thinkingTokens = safeTokenCount(usage?.thoughtsTokenCount);
  const cachedTokens = safeTokenCount(usage?.cachedContentTokenCount);
  const totalTokens = safeTokenCount(usage?.totalTokenCount) || promptTokens + outputTokens + thinkingTokens;
  const imageCount = Math.max(0, Math.trunc(input.imageCount ?? 0));
  const provider = input.provider?.trim() || "GOOGLE";
  const model = input.model?.trim() || getGeminiModel();
  const pricing = resolveModelPricing(provider, model);

  try {
    await prisma.aiUsageEvent.create({
      data: {
        provider,
        model,
        feature: input.feature,
        modality: normalizeModality(input.modality),
        actorEmail: input.actorEmail?.trim().toLowerCase() || null,
        promptTokens,
        outputTokens,
        thinkingTokens,
        cachedTokens,
        totalTokens,
        imageCount,
        estimatedCostMicros: estimateCostMicros(pricing, usage),
        pricingVersion: pricing?.version ?? UNPRICED_VERSION,
        status: input.status ?? "SUCCESS",
        latencyMs: input.latencyMs == null ? null : Math.max(0, Math.trunc(input.latencyMs))
      }
    });
  } catch (error) {
    console.warn("[ai-usage] Unable to record usage", error instanceof Error ? error.message : error);
  }
}

/** Text Gemini calls. Computer vision should use recordVisionUsage. */
export async function recordGeminiUsage(input: RecordAiUsageInput) {
  await recordAiUsage({
    provider: "GOOGLE",
    modality: "text",
    ...input
  });
}

/** Computer-vision Gemini (or other) calls. Pass imageCount and a distinct feature key. */
export async function recordVisionUsage(input: RecordAiUsageInput) {
  await recordAiUsage({
    provider: "GOOGLE",
    ...input,
    modality: "vision"
  });
}

type Bucket = {
  requests: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalTokens: number;
  imageCount: number;
  estimatedCostMicros: number;
  errors: number;
  modality: AiModality | "mixed";
};

function emptyBucket(modality: Bucket["modality"] = "text"): Bucket {
  return {
    requests: 0,
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    imageCount: 0,
    estimatedCostMicros: 0,
    errors: 0,
    modality
  };
}

function addToBucket(bucket: Bucket, row: {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalTokens: number;
  imageCount: number;
  estimatedCostMicros: number;
  status: string;
  modality: string;
}) {
  bucket.requests++;
  bucket.promptTokens += row.promptTokens;
  bucket.outputTokens += row.outputTokens;
  bucket.thinkingTokens += row.thinkingTokens;
  bucket.cachedTokens += row.cachedTokens;
  bucket.totalTokens += row.totalTokens;
  bucket.imageCount += row.imageCount;
  bucket.estimatedCostMicros += row.estimatedCostMicros;
  if (row.status !== "SUCCESS") bucket.errors++;
  const rowModality = normalizeModality(row.modality);
  if (bucket.requests === 1) bucket.modality = rowModality;
  else if (bucket.modality !== rowModality) bucket.modality = "mixed";
}

function serializeBucket(key: string, values: Bucket) {
  return {
    ...values,
    key,
    label: AI_FEATURE_LABELS[key] ?? AI_MODALITY_LABELS[key as AiModality] ?? key,
    inputTokens: values.promptTokens,
    cachedInputTokens: values.cachedTokens,
    estimatedCostUsd: values.estimatedCostMicros / 1_000_000
  };
}

export async function getAiUsageAnalytics(days: number) {
  const safeDays = Math.min(365, Math.max(1, Math.trunc(days)));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - safeDays + 1);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.aiUsageEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      model: true,
      feature: true,
      modality: true,
      actorEmail: true,
      promptTokens: true,
      outputTokens: true,
      thinkingTokens: true,
      cachedTokens: true,
      totalTokens: true,
      imageCount: true,
      estimatedCostMicros: true,
      status: true,
      latencyMs: true,
      createdAt: true
    }
  });

  const totals = emptyBucket("mixed");
  const daily = new Map<string, Bucket>();
  const byFeature = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byModality = new Map<AiModality, Bucket>([
    ["text", emptyBucket("text")],
    ["vision", emptyBucket("vision")]
  ]);
  let latencyTotal = 0;
  let latencyCount = 0;
  for (const row of rows) {
    addToBucket(totals, row);
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!daily.has(day)) daily.set(day, emptyBucket());
    if (!byFeature.has(row.feature)) byFeature.set(row.feature, emptyBucket());
    if (!byModel.has(row.model)) byModel.set(row.model, emptyBucket());
    addToBucket(daily.get(day)!, row);
    addToBucket(byFeature.get(row.feature)!, row);
    addToBucket(byModel.get(row.model)!, row);
    addToBucket(byModality.get(normalizeModality(row.modality))!, row);
    if (row.latencyMs != null) {
      latencyTotal += row.latencyMs;
      latencyCount++;
    }
  }

  return {
    days: safeDays,
    since: since.toISOString(),
    totals: {
      ...serializeBucket("all", totals),
      averageLatencyMs: latencyCount ? Math.round(latencyTotal / latencyCount) : null
    },
    daily: Array.from(daily, ([key, values]) => serializeBucket(key, values)),
    byFeature: Array.from(byFeature, ([key, values]) => serializeBucket(key, values)).sort(
      (a, b) => b.estimatedCostMicros - a.estimatedCostMicros
    ),
    byModel: Array.from(byModel, ([key, values]) => serializeBucket(key, values)).sort(
      (a, b) => b.estimatedCostMicros - a.estimatedCostMicros
    ),
    byModality: (["text", "vision"] as const).map((key) => serializeBucket(key, byModality.get(key)!)),
    recent: rows.slice(-50).reverse().map((row) => ({
      id: row.id,
      feature: row.feature,
      featureLabel: AI_FEATURE_LABELS[row.feature] ?? row.feature,
      modality: normalizeModality(row.modality),
      modalityLabel: AI_MODALITY_LABELS[normalizeModality(row.modality)],
      provider: row.provider,
      model: row.model,
      actorEmail: row.actorEmail,
      totalTokens: row.totalTokens,
      imageCount: row.imageCount,
      estimatedCostUsd: row.estimatedCostMicros / 1_000_000,
      createdAt: row.createdAt.toISOString()
    })),
    featureLabels: AI_FEATURE_LABELS,
    pricing: currentGeminiPricingSummary(),
    pricingNote:
      "Estimated Gemini paid-tier cost in USD at each call's model rate; 9router calls are not priced. Actual billing may differ due to free-tier usage, taxes, credits, or provider pricing changes. Computer vision is tracked separately from text chat."
  };
}

/** Token/cost analytics scoped to Cozoro AI Manager features only, grouped by task category. */
export async function getAiManagerUsageAnalytics(days: number) {
  const safeDays = Math.min(365, Math.max(1, Math.trunc(days)));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - safeDays + 1);
  since.setUTCHours(0, 0, 0, 0);

  const featureList = [...AI_MANAGER_USAGE_FEATURES];
  const rows = await prisma.aiUsageEvent.findMany({
    where: {
      createdAt: { gte: since },
      feature: { in: featureList }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      model: true,
      feature: true,
      modality: true,
      actorEmail: true,
      promptTokens: true,
      outputTokens: true,
      thinkingTokens: true,
      cachedTokens: true,
      totalTokens: true,
      imageCount: true,
      estimatedCostMicros: true,
      status: true,
      latencyMs: true,
      createdAt: true
    }
  });

  const totals = emptyBucket("mixed");
  const byFeature = new Map<string, Bucket>();
  const byCategory = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();

  for (const feature of featureList) {
    byFeature.set(feature, emptyBucket("text"));
    const category = AI_MANAGER_USAGE_CATEGORIES[feature].capability;
    if (!byCategory.has(category)) byCategory.set(category, emptyBucket("text"));
  }

  for (const row of rows) {
    addToBucket(totals, row);
    if (!byFeature.has(row.feature)) byFeature.set(row.feature, emptyBucket());
    addToBucket(byFeature.get(row.feature)!, row);

    const categoryMeta = AI_MANAGER_USAGE_CATEGORIES[row.feature as AiManagerUsageFeature];
    const categoryKey = categoryMeta?.capability ?? "other";
    if (!byCategory.has(categoryKey)) byCategory.set(categoryKey, emptyBucket());
    addToBucket(byCategory.get(categoryKey)!, row);

    const day = row.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, emptyBucket());
    addToBucket(byDay.get(day)!, row);
  }

  const categoryLabels: Record<string, string> = {
    ownerReports: "Owner reports",
    answerChat: "Answer support chat",
    manageFines: "Create / correct fines",
    scheduleAssignment: "Cleaning schedule assignment",
    other: "Other"
  };

  return {
    days: safeDays,
    since: since.toISOString(),
    totals: serializeBucket("ai_manager_all", totals),
    byTask: featureList.map((feature) => ({
      ...serializeBucket(feature, byFeature.get(feature) ?? emptyBucket("text")),
      capability: AI_MANAGER_USAGE_CATEGORIES[feature].capability,
      categoryLabel: AI_MANAGER_USAGE_CATEGORIES[feature].label
    })),
    byCategory: Array.from(byCategory, ([key, values]) => ({
      ...serializeBucket(key, values),
      label: categoryLabels[key] ?? key
    })).sort((a, b) => b.estimatedCostMicros - a.estimatedCostMicros),
    daily: Array.from(byDay, ([key, values]) => serializeBucket(key, values)).sort((a, b) =>
      a.key.localeCompare(b.key)
    ),
    recent: rows.slice(0, 40).map((row) => ({
      id: row.id,
      feature: row.feature,
      featureLabel: AI_FEATURE_LABELS[row.feature] ?? row.feature,
      category: AI_MANAGER_USAGE_CATEGORIES[row.feature as AiManagerUsageFeature]?.capability ?? "other",
      categoryLabel:
        AI_MANAGER_USAGE_CATEGORIES[row.feature as AiManagerUsageFeature]?.label ??
        categoryLabels.other,
      modality: normalizeModality(row.modality),
      provider: row.provider,
      model: row.model,
      actorEmail: row.actorEmail,
      promptTokens: row.promptTokens,
      outputTokens: row.outputTokens,
      thinkingTokens: row.thinkingTokens,
      totalTokens: row.totalTokens,
      imageCount: row.imageCount,
      estimatedCostUsd: row.estimatedCostMicros / 1_000_000,
      status: row.status,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt.toISOString()
    })),
    pricing: currentGeminiPricingSummary()
  };
}
