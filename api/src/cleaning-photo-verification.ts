import { CleaningAiVerdict, CleaningTaskType } from "@prisma/client";
import { recordVisionUsage } from "./ai-usage.js";
import {
  getCleaningPhotoRequirements,
  readCleaningPhotoBytes,
  type CleaningPhotoInput
} from "./cleaning-photos.js";
import { prisma } from "./prisma.js";

type ReferencePhotoRow = {
  id: string;
  storageName: string;
  fileName: string;
  caption: string | null;
};

type VerificationResult = {
  verdict: CleaningAiVerdict;
  score: number | null;
  note: string | null;
};

const ELIGIBILITY_SCORE_THRESHOLD = 70;

function resolveGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_RESIDENT_PORTAL_AI_API_KEY?.trim() || null;
}

function buildGeminiUrl() {
  const key = resolveGeminiApiKey();
  if (!key) {
    return null;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
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

export async function verifyCleaningCompletionPhotos(input: {
  taskId: string;
  taskType: CleaningTaskType;
  branchId: string;
  floor?: number | null;
  actorEmail: string;
  referencePhotos: ReferencePhotoRow[];
  completionStorageNames: string[];
}): Promise<VerificationResult> {
  if (input.referencePhotos.length === 0 || input.completionStorageNames.length === 0) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: input.referencePhotos.length === 0
        ? "No staff reference photos configured for this area yet."
        : "No completion photos were submitted."
    };
  }

  const geminiUrl = buildGeminiUrl();
  if (!geminiUrl) {
    return {
      verdict: CleaningAiVerdict.SKIPPED,
      score: null,
      note: "AI verification skipped because Gemini is not configured."
    };
  }

  const requirements = getCleaningPhotoRequirements(input.taskType, input.floor);
  const taskLabel =
    input.taskType === CleaningTaskType.KITCHEN_D2
      ? "Kitchen D2"
      : input.taskType === CleaningTaskType.KITCHEN_D7
        ? "Kitchen D7"
        : `Trash D7 floor ${input.floor ?? "?"}`;

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    {
      text: [
        "You are a strict dorm cleaning quality inspector for CozoroHome.",
        `Task area: ${taskLabel} (${input.branchId}).`,
        "",
        requirements,
        "",
        "The first images are STAFF REFERENCE photos showing acceptable completed work for this area.",
        "The following images are RESIDENT SUBMISSION photos for the same task.",
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
      ].join("\n")
    }
  ];

  let imageCount = 0;
  for (const reference of input.referencePhotos.slice(0, 5)) {
    const bytes = await readCleaningPhotoBytes(reference.storageName, "reference");
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
    imageCount += 1;
  }

  for (const storageName of input.completionStorageNames.slice(0, 5)) {
    const bytes = await readCleaningPhotoBytes(storageName, "completion");
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: bytes.toString("base64")
      }
    });
    imageCount += 1;
  }

  const started = Date.now();
  try {
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    const payload = await response.json();
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      await recordVisionUsage({
        feature: "cleaning_photo_verification",
        actorEmail: input.actorEmail,
        imageCount,
        status: response.status === 429 ? "RATE_LIMITED" : "ERROR",
        latencyMs
      });
      return {
        verdict: CleaningAiVerdict.SKIPPED,
        score: null,
        note: "AI verification failed due to a provider error. Staff will review manually."
      };
    }

    const parsed = parseVerificationJson(extractResponseText(payload));
    await recordVisionUsage({
      feature: "cleaning_photo_verification",
      actorEmail: input.actorEmail,
      imageCount,
      usage: extractUsageMetadata(payload),
      latencyMs
    });

    if (!parsed) {
      return {
        verdict: CleaningAiVerdict.SKIPPED,
        score: null,
        note: "AI returned an unreadable response. Staff will review manually."
      };
    }

    return {
      verdict: parsed.eligible ? CleaningAiVerdict.ELIGIBLE : CleaningAiVerdict.NOT_ELIGIBLE,
      score: parsed.score,
      note: parsed.note || null
    };
  } catch (error) {
    await recordVisionUsage({
      feature: "cleaning_photo_verification",
      actorEmail: input.actorEmail,
      imageCount,
      status: "ERROR",
      latencyMs: Date.now() - started
    });
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

  const referencePhotos = await prisma.cleaningReferencePhoto.findMany({
    where: {
      taskType: task.type,
      branchId: task.branchId,
      floor: task.type === CleaningTaskType.TRASH_D7 ? task.floor : null,
      isActive: true
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });

  const result = await verifyCleaningCompletionPhotos({
    taskId: task.id,
    taskType: task.type,
    branchId: task.branchId,
    floor: task.floor,
    actorEmail,
    referencePhotos,
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
