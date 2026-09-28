import { CleaningAiVerdict, CleaningTaskType } from "@prisma/client";
import { recordVisionUsage } from "./ai-usage.js";
import { hasPortalLlmConfig, resolveGeminiGenerateUrl } from "./llm-tool-chat.js";
import {
  describeCleaningReferenceSource,
  type CleaningReferenceSource,
  type ResolvedCleaningReferencePhoto
} from "./cleaning-photo-references.js";
import {
  getCleaningPhotoRequirements,
  readCleaningPhotoBytes,
  resolveCleaningReferencePhotos,
  type CleaningPhotoInput
} from "./cleaning-photos.js";
import { call9RouterChatCompletion, prefer9Router } from "./nine-router.js";
import { prisma } from "./prisma.js";

type VerificationResult = {
  verdict: CleaningAiVerdict;
  score: number | null;
  note: string | null;
};

const ELIGIBILITY_SCORE_THRESHOLD = 70;
const GEMINI_TIMEOUT_MS = 45_000;

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

function parseVerificationJson(raw: string): { eligible: boolean; score: number; note: string } | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(candidate) as {
      eligible?: unknown;
      score?: unknown;
      note?: unknown;
    };
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score)
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 0;
    const eligible = parsed.eligible === true || score >= ELIGIBILITY_SCORE_THRESHOLD;
    const note = typeof parsed.note === "string" ? parsed.note.trim().slice(0, 2000) : "";
    return { eligible, score, note };
  } catch {
    return null;
  }
}

function buildVerificationPrompt(input: {
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
  referenceCount: number;
  completionCount: number;
  referenceSource: CleaningReferenceSource;
}) {
  const requirements = getCleaningPhotoRequirements(input.taskType, input.floor);
  const taskLabel =
    input.taskType === CleaningTaskType.KITCHEN_D2
      ? "Kitchen D2"
      : input.taskType === CleaningTaskType.KITCHEN_D7
        ? "Kitchen D7"
        : `Trash D7 floor ${input.floor ?? "?"}`;

  const referenceLabel =
    input.referenceSource === "learned"
      ? "MANAGER-APPROVED (★4+) REFERENCE photos showing acceptable completed work for this area"
      : "STAFF REFERENCE photos showing acceptable completed work for this area";

  return [
    "You are a strict dorm cleaning quality inspector for CozoroHome.",
    `Task area: ${taskLabel} (${input.branchId}).`,
    `Reference source: ${input.referenceSource}.`,
    "",
    requirements,
    "",
    `The first ${input.referenceCount} image(s) are ${referenceLabel}.`,
    `The next ${input.completionCount} image(s) are RESIDENT SUBMISSION photos for the same task.`,
    "",
    "Compare the resident photos against the reference standard and the written requirements.",
    "Decide whether the resident work is good enough to qualify for AI-verified cleaning coin reward.",
    "",
    "Respond ONLY with JSON:",
    '{"eligible": boolean, "score": number, "note": string}',
    "",
    "- eligible: true only if the work clearly meets the reference standard and requirements",
    "- score: 0-100 quality match score",
    "- note: brief bilingual-friendly explanation for staff (English, max 2 sentences)"
  ].join("\n");
}

function resultFromParsedJson(
  parsed: { eligible: boolean; score: number; note: string } | null,
  referenceSource: CleaningReferenceSource,
  referenceCount: number
): VerificationResult {
  if (!parsed) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI returned an unreadable response. Staff will review manually."
    };
  }

  const sourceNote = describeCleaningReferenceSource(referenceSource, referenceCount);
  const note = parsed.note
    ? `${parsed.note} (${sourceNote})`
    : sourceNote;

  return {
    verdict: parsed.eligible ? CleaningAiVerdict.ELIGIBLE : CleaningAiVerdict.NOT_ELIGIBLE,
    score: parsed.score,
    note
  };
}

async function verifyViaNineRouter(input: {
  prompt: string;
  referenceBuffers: Buffer[];
  completionBuffers: Buffer[];
  actorEmail: string;
  referenceSource: CleaningReferenceSource;
}): Promise<VerificationResult> {
  const imageCount = input.referenceBuffers.length + input.completionBuffers.length;
  const started = Date.now();

  const result = await call9RouterChatCompletion({
    userPrompt: input.prompt,
    temperature: 0.2,
    attachments: [...input.referenceBuffers, ...input.completionBuffers].map((buffer) => ({
      buffer,
      mimeType: "image/jpeg"
    }))
  });

  await recordVisionUsage({
    feature: "cleaning_photo_verification",
    provider: "NINE_ROUTER",
    model: result.model,
    actorEmail: input.actorEmail,
    imageCount,
    usage: usageFromNineRouter(result.usage),
    latencyMs: Date.now() - started
  });

  return resultFromParsedJson(
    parseVerificationJson(result.text),
    input.referenceSource,
    input.referenceBuffers.length
  );
}

async function verifyViaGemini(input: {
  prompt: string;
  referenceBuffers: Buffer[];
  completionBuffers: Buffer[];
  actorEmail: string;
  referenceSource: CleaningReferenceSource;
}): Promise<VerificationResult> {
  const geminiUrl = resolveGeminiGenerateUrl("shared");
  if (!geminiUrl) {
    throw new Error("Gemini is not configured.");
  }

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    { text: input.prompt }
  ];

  for (const bytes of input.referenceBuffers) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
  }

  for (const bytes of input.completionBuffers) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
  }

  const imageCount = input.referenceBuffers.length + input.completionBuffers.length;
  const started = Date.now();

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });

  const payload = await response.json();
  const latencyMs = Date.now() - started;

  if (!response.ok) {
    await recordVisionUsage({
      feature: "cleaning_photo_verification",
      provider: "GOOGLE",
      actorEmail: input.actorEmail,
      imageCount,
      status: response.status === 429 ? "RATE_LIMITED" : "ERROR",
      latencyMs
    });
    throw new Error("Gemini verification request failed.");
  }

  const parsed = parseVerificationJson(extractResponseText(payload));
  await recordVisionUsage({
    feature: "cleaning_photo_verification",
    provider: "GOOGLE",
    actorEmail: input.actorEmail,
    imageCount,
    usage: extractUsageMetadata(payload),
    latencyMs
  });

  return resultFromParsedJson(parsed, input.referenceSource, input.referenceBuffers.length);
}

async function readPhotoBuffersSafely(
  photos: Array<{ storageName: string; kind: "reference" | "completion" }>
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const photo of photos) {
    try {
      buffers.push(await readCleaningPhotoBytes(photo.storageName, photo.kind));
    } catch (error) {
      console.warn(
        "[cleaning-photo-verification] skipping missing photo",
        photo.storageName,
        error instanceof Error ? error.message : error
      );
    }
  }
  return buffers;
}

export async function verifyCleaningCompletionPhotos(input: {
  taskId: string;
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
  actorEmail: string;
  referencePhotos: ResolvedCleaningReferencePhoto[];
  referenceSource: CleaningReferenceSource;
  completionStorageNames: string[];
}): Promise<VerificationResult> {
  if (input.referencePhotos.length === 0 || input.completionStorageNames.length === 0) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: input.referencePhotos.length === 0
        ? "No reference photos available for this area yet."
        : "No completion photos were submitted."
    };
  }

  if (!hasPortalLlmConfig("shared")) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI verification skipped because no LLM is configured."
    };
  }

  try {
    const referenceBuffers = await readPhotoBuffersSafely(
      input.referencePhotos.slice(0, 5).map((photo) => ({
        storageName: photo.storageName,
        kind: photo.kind
      }))
    );
    const completionBuffers = await readPhotoBuffersSafely(
      input.completionStorageNames.slice(0, 5).map((storageName) => ({
        storageName,
        kind: "completion" as const
      }))
    );

    if (referenceBuffers.length === 0 || completionBuffers.length === 0) {
      return {
        verdict: CleaningAiVerdict.SKIPPED,
        score: null,
        note:
          referenceBuffers.length === 0
            ? "Reference photo files were missing on disk. Staff will review manually."
            : "Completion photo files were missing on disk. Staff will review manually."
      };
    }

    const prompt = buildVerificationPrompt({
      taskType: input.taskType,
      branchId: input.branchId,
      floor: input.floor,
      referenceCount: referenceBuffers.length,
      completionCount: completionBuffers.length,
      referenceSource: input.referenceSource
    });

    const verifyInput = {
      prompt,
      referenceBuffers,
      completionBuffers,
      actorEmail: input.actorEmail,
      referenceSource: input.referenceSource
    };

    if (prefer9Router()) {
      try {
        return await verifyViaNineRouter(verifyInput);
      } catch (nineRouterError) {
        if (resolveGeminiGenerateUrl("shared")) {
          console.warn(
            "[cleaning-photo-verification] 9router failed, falling back to Gemini:",
            nineRouterError instanceof Error ? nineRouterError.message : nineRouterError
          );
          return await verifyViaGemini(verifyInput);
        }
        throw nineRouterError;
      }
    }

    return await verifyViaGemini(verifyInput);
  } catch (error) {
    console.warn(
      "[cleaning-photo-verification]",
      error instanceof Error ? error.message : error
    );
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI verification could not run. Staff will review manually."
    };
  }
}

export async function runCleaningTaskPhotoVerification(taskId: string, actorEmail: string) {
  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId },
    include: {
      completionPhotos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }
    }
  });

  if (!task) {
    throw new Error("Cleaning task not found.");
  }

  const resolved = await resolveCleaningReferencePhotos({
    taskType: task.type,
    branchId: task.branchId,
    floor: task.floor,
    excludeTaskId: task.id
  });

  const result = await verifyCleaningCompletionPhotos({
    taskId: task.id,
    taskType: task.type,
    branchId: task.branchId,
    floor: task.floor,
    actorEmail,
    referencePhotos: resolved.photos,
    referenceSource: resolved.source,
    completionStorageNames: task.completionPhotos.map((photo) => photo.storageName)
  });

  return prisma.cleaningTask.update({
    where: { id: taskId },
    data: {
      aiVerdict: result.verdict,
      aiScore: result.score,
      aiNote: result.note,
      aiVerifiedAt: new Date()
    }
  });
}

export type { CleaningPhotoInput };
