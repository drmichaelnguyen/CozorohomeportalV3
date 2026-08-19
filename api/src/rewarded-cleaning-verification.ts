import { CleaningAiVerdict } from "@prisma/client";
import { recordVisionUsage } from "./ai-usage.js";
import { hasPortalLlmConfig, resolveGeminiGenerateUrl } from "./llm-tool-chat.js";
import { call9RouterChatCompletion, prefer9Router } from "./nine-router.js";
import { readRewardedCleaningPhotoBytes } from "./rewarded-cleaning-photos.js";

export const MIN_REWARDED_CLEANING_COINS = 5000;
export const MAX_SUGGESTED_REWARDED_CLEANING_COINS = 20000;

type VerificationResult = {
  verdict: CleaningAiVerdict;
  score: number | null;
  note: string | null;
  suggestedCoins: number | null;
};

const ELIGIBILITY_SCORE_THRESHOLD = 65;

function usageFromNineRouter(usage: {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}) {
  return {
    promptTokenCount: usage.promptTokens ?? undefined,
    candidatesTokenCount: usage.completionTokens ?? undefined,
    totalTokenCount: usage.totalTokens ?? undefined
  };
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts.map((part) => part.text ?? "").join("").trim();
}

function extractUsageMetadata(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return (payload as { usageMetadata?: Record<string, number> }).usageMetadata;
}

function parseVerificationJson(raw: string): {
  eligible: boolean;
  score: number;
  note: string;
  suggestedCoins: number;
} | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(candidate) as {
      eligible?: unknown;
      score?: unknown;
      note?: unknown;
      suggestedCoins?: unknown;
    };
    const score =
      typeof parsed.score === "number" && Number.isFinite(parsed.score)
        ? Math.max(0, Math.min(100, Math.round(parsed.score)))
        : 0;
    const eligible = parsed.eligible === true || score >= ELIGIBILITY_SCORE_THRESHOLD;
    const note = typeof parsed.note === "string" ? parsed.note.trim().slice(0, 2000) : "";
    let suggestedCoins =
      typeof parsed.suggestedCoins === "number" && Number.isFinite(parsed.suggestedCoins)
        ? Math.round(parsed.suggestedCoins)
        : eligible
          ? MIN_REWARDED_CLEANING_COINS
          : 0;
    if (eligible) {
      suggestedCoins = Math.max(MIN_REWARDED_CLEANING_COINS, suggestedCoins);
      suggestedCoins = Math.min(MAX_SUGGESTED_REWARDED_CLEANING_COINS, suggestedCoins);
      suggestedCoins = Math.round(suggestedCoins / 500) * 500;
    } else {
      suggestedCoins = 0;
    }
    return { eligible, score, note, suggestedCoins };
  } catch {
    return null;
  }
}

function resultFromParsedJson(
  parsed: { eligible: boolean; score: number; note: string; suggestedCoins: number } | null
): VerificationResult {
  if (!parsed) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI returned an unreadable response. Staff will review manually.",
      suggestedCoins: null
    };
  }

  return {
    verdict: parsed.eligible ? CleaningAiVerdict.ELIGIBLE : CleaningAiVerdict.NOT_ELIGIBLE,
    score: parsed.score,
    note: parsed.note || null,
    suggestedCoins: parsed.eligible ? parsed.suggestedCoins : 0
  };
}

function buildVerificationPrompt(input: {
  siteName: string;
  branchId: string;
  beforeCount: number;
  afterCount: number;
}) {
  return [
    "You are a dorm common-area cleaning inspector for CozoroHome (beta rewarded cleaning).",
    `Site: ${input.siteName} (${input.branchId}).`,
    "",
    `The first ${input.beforeCount} image(s) are BEFORE photos taken before the resident cleaned/organized.`,
    `The next ${input.afterCount} image(s) are AFTER photos taken when the resident finished.`,
    "",
    "Compare before vs after and decide whether the visible improvement is meaningful enough to consider for a coin reward.",
    "Look for: tidier surfaces, removed clutter/trash, better organization, cleaner floors/shelves, emptied bins, aligned items.",
    "Ignore minor camera angle or lighting differences; focus on real cleanliness/organization improvement.",
    "",
    "Respond ONLY with JSON:",
    '{"eligible": boolean, "score": number, "note": string, "suggestedCoins": number}',
    "",
    "- eligible: true only if there is a clear, meaningful improvement",
    "- score: 0-100 improvement quality score",
    "- note: brief bilingual-friendly explanation for staff (English, max 2 sentences)",
    `- suggestedCoins: if eligible, integer between ${MIN_REWARDED_CLEANING_COINS} and ${MAX_SUGGESTED_REWARDED_CLEANING_COINS} in 500-coin steps based on effort/impact; 0 if not eligible`
  ].join("\n");
}

async function verifyViaNineRouter(input: {
  prompt: string;
  beforeBuffers: Buffer[];
  afterBuffers: Buffer[];
  actorEmail: string;
}): Promise<VerificationResult> {
  const imageCount = input.beforeBuffers.length + input.afterBuffers.length;
  const started = Date.now();

  const result = await call9RouterChatCompletion({
    userPrompt: input.prompt,
    temperature: 0.2,
    attachments: [...input.beforeBuffers, ...input.afterBuffers].map((buffer) => ({
      buffer,
      mimeType: "image/jpeg"
    }))
  });

  await recordVisionUsage({
    feature: "rewarded_cleaning_verification",
    provider: "NINE_ROUTER",
    model: result.model,
    actorEmail: input.actorEmail,
    imageCount,
    usage: usageFromNineRouter(result.usage),
    latencyMs: Date.now() - started
  });

  return resultFromParsedJson(parseVerificationJson(result.text));
}

async function verifyViaGemini(input: {
  prompt: string;
  beforeBuffers: Buffer[];
  afterBuffers: Buffer[];
  actorEmail: string;
}): Promise<VerificationResult> {
  const geminiUrl = resolveGeminiGenerateUrl("shared");
  if (!geminiUrl) {
    throw new Error("Gemini is not configured.");
  }

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    { text: input.prompt }
  ];

  for (const bytes of input.beforeBuffers) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
  }

  for (const bytes of input.afterBuffers) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
  }

  const started = Date.now();
  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  const text = extractResponseText(payload);
  const usage = extractUsageMetadata(payload);

  await recordVisionUsage({
    feature: "rewarded_cleaning_verification",
    provider: "GEMINI",
    model: "gemini",
    actorEmail: input.actorEmail,
    imageCount: input.beforeBuffers.length + input.afterBuffers.length,
    usage: {
      promptTokenCount: usage?.promptTokenCount,
      candidatesTokenCount: usage?.candidatesTokenCount,
      totalTokenCount: usage?.totalTokenCount
    },
    latencyMs: Date.now() - started
  });

  return resultFromParsedJson(parseVerificationJson(text));
}

export async function runRewardedCleaningVerification(input: {
  siteName: string;
  branchId: string;
  beforeStorageNames: string[];
  afterStorageNames: string[];
  actorEmail: string;
}): Promise<VerificationResult> {
  if (input.beforeStorageNames.length === 0 || input.afterStorageNames.length === 0) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "Missing before or after photos.",
      suggestedCoins: null
    };
  }

  if (!hasPortalLlmConfig("shared")) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI is not configured. Staff will review manually.",
      suggestedCoins: null
    };
  }

  const beforeBuffers = await Promise.all(
    input.beforeStorageNames.map((name) => readRewardedCleaningPhotoBytes(name))
  );
  const afterBuffers = await Promise.all(
    input.afterStorageNames.map((name) => readRewardedCleaningPhotoBytes(name))
  );

  const prompt = buildVerificationPrompt({
    siteName: input.siteName,
    branchId: input.branchId,
    beforeCount: beforeBuffers.length,
    afterCount: afterBuffers.length
  });

  try {
    if (prefer9Router()) {
      return await verifyViaNineRouter({
        prompt,
        beforeBuffers,
        afterBuffers,
        actorEmail: input.actorEmail
      });
    }
    return await verifyViaGemini({
      prompt,
      beforeBuffers,
      afterBuffers,
      actorEmail: input.actorEmail
    });
  } catch (error) {
    console.error("[rewarded-cleaning-verification]", error);
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI verification failed. Staff will review manually.",
      suggestedCoins: null
    };
  }
}
