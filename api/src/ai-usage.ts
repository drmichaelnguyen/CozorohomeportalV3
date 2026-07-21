import { prisma } from "./prisma.js";

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

// Gemini 2.5 Flash standard paid-tier pricing, checked 2026-07-21.
const GEMINI_25_FLASH_PRICING = {
  inputPerMillionUsd: 0.3,
  cachedInputPerMillionUsd: 0.03,
  outputPerMillionUsd: 2.5,
  version: "gemini-2.5-flash-standard-2026-07-21"
} as const;

function safeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function estimateGemini25FlashCostMicros(usage?: GeminiUsageMetadata): number {
  if (!usage) return 0;
  const prompt = safeTokenCount(usage.promptTokenCount);
  const cached = Math.min(prompt, safeTokenCount(usage.cachedContentTokenCount));
  const uncached = prompt - cached;
  const output = safeTokenCount(usage.candidatesTokenCount) + safeTokenCount(usage.thoughtsTokenCount);
  return Math.round(
    uncached * GEMINI_25_FLASH_PRICING.inputPerMillionUsd +
      cached * GEMINI_25_FLASH_PRICING.cachedInputPerMillionUsd +
      output * GEMINI_25_FLASH_PRICING.outputPerMillionUsd
  );
}

export async function recordGeminiUsage(input: {
  feature: string;
  actorEmail?: string | null;
  usage?: GeminiUsageMetadata;
  status?: "SUCCESS" | "ERROR" | "RATE_LIMITED" | "INVALID_RESPONSE";
  latencyMs?: number;
}) {
  const usage = input.usage;
  const promptTokens = safeTokenCount(usage?.promptTokenCount);
  const outputTokens = safeTokenCount(usage?.candidatesTokenCount);
  const thinkingTokens = safeTokenCount(usage?.thoughtsTokenCount);
  const cachedTokens = safeTokenCount(usage?.cachedContentTokenCount);
  const totalTokens = safeTokenCount(usage?.totalTokenCount) || promptTokens + outputTokens + thinkingTokens;

  try {
    await prisma.aiUsageEvent.create({
      data: {
        provider: "GOOGLE",
        model: "gemini-2.5-flash",
        feature: input.feature,
        actorEmail: input.actorEmail?.trim().toLowerCase() || null,
        promptTokens,
        outputTokens,
        thinkingTokens,
        cachedTokens,
        totalTokens,
        estimatedCostMicros: estimateGemini25FlashCostMicros(usage),
        pricingVersion: GEMINI_25_FLASH_PRICING.version,
        status: input.status ?? "SUCCESS",
        latencyMs: input.latencyMs == null ? null : Math.max(0, Math.trunc(input.latencyMs))
      }
    });
  } catch (error) {
    console.warn("[ai-usage] Unable to record usage", error instanceof Error ? error.message : error);
  }
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
      actorEmail: true,
      promptTokens: true,
      outputTokens: true,
      thinkingTokens: true,
      cachedTokens: true,
      totalTokens: true,
      estimatedCostMicros: true,
      status: true,
      latencyMs: true,
      createdAt: true
    }
  });

  type Bucket = { requests: number; promptTokens: number; outputTokens: number; thinkingTokens: number; cachedTokens: number; totalTokens: number; estimatedCostMicros: number; errors: number };
  const empty = (): Bucket => ({ requests: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0, totalTokens: 0, estimatedCostMicros: 0, errors: 0 });
  const add = (bucket: Bucket, row: (typeof rows)[number]) => {
    bucket.requests++;
    bucket.promptTokens += row.promptTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.thinkingTokens += row.thinkingTokens;
    bucket.cachedTokens += row.cachedTokens;
    bucket.totalTokens += row.totalTokens;
    bucket.estimatedCostMicros += row.estimatedCostMicros;
    if (row.status !== "SUCCESS") bucket.errors++;
  };

  const totals = empty();
  const daily = new Map<string, Bucket>();
  const byFeature = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  let latencyTotal = 0;
  let latencyCount = 0;
  for (const row of rows) {
    add(totals, row);
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!daily.has(day)) daily.set(day, empty());
    if (!byFeature.has(row.feature)) byFeature.set(row.feature, empty());
    if (!byModel.has(row.model)) byModel.set(row.model, empty());
    add(daily.get(day)!, row);
    add(byFeature.get(row.feature)!, row);
    add(byModel.get(row.model)!, row);
    if (row.latencyMs != null) { latencyTotal += row.latencyMs; latencyCount++; }
  }

  return {
    days: safeDays,
    since: since.toISOString(),
    totals: {
      ...totals,
      inputTokens: totals.promptTokens,
      cachedInputTokens: totals.cachedTokens,
      estimatedCostUsd: totals.estimatedCostMicros / 1_000_000,
      averageLatencyMs: latencyCount ? Math.round(latencyTotal / latencyCount) : null
    },
    daily: Array.from(daily, ([key, values]) => ({ ...values, key, inputTokens: values.promptTokens, cachedInputTokens: values.cachedTokens, estimatedCostUsd: values.estimatedCostMicros / 1_000_000 })),
    byFeature: Array.from(byFeature, ([key, values]) => ({ ...values, key, inputTokens: values.promptTokens, cachedInputTokens: values.cachedTokens, estimatedCostUsd: values.estimatedCostMicros / 1_000_000 })).sort((a, b) => b.estimatedCostMicros - a.estimatedCostMicros),
    byModel: Array.from(byModel, ([key, values]) => ({ ...values, key, inputTokens: values.promptTokens, cachedInputTokens: values.cachedTokens, estimatedCostUsd: values.estimatedCostMicros / 1_000_000 })).sort((a, b) => b.estimatedCostMicros - a.estimatedCostMicros),
    recent: rows.slice(-50).reverse().map((row) => ({
      id: row.id,
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      actorEmail: row.actorEmail,
      totalTokens: row.totalTokens,
      estimatedCostUsd: row.estimatedCostMicros / 1_000_000,
      createdAt: row.createdAt.toISOString()
    })),
    pricing: {
      gemini25FlashInputUsdPerMillion: GEMINI_25_FLASH_PRICING.inputPerMillionUsd,
      gemini25FlashOutputUsdPerMillion: GEMINI_25_FLASH_PRICING.outputPerMillionUsd
    },
    pricingNote: "Estimated paid-tier cost in USD; actual billing may differ due to free-tier usage, taxes, credits, or provider pricing changes."
  };
}
