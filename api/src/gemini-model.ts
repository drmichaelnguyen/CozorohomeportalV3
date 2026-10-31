/**
 * Gemini model used directly (and as the fallback when 9router fails).
 * Override with GEMINI_MODEL; thinking effort for Gemini 3+ with GEMINI_THINKING_LEVEL.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Accepted by Gemini 3+ tool-call parts when the original thought signature is unavailable (e.g. 9router turns). */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

function supportsThinkingLevel(model: string): boolean {
  const major = Number(/^gemini-(\d+)/.exec(model)?.[1]);
  return Number.isFinite(major) && major >= 3;
}

/**
 * Gemini 3+ counts thinking tokens against max_output_tokens, so default thinking can
 * exhaust small reply budgets. Gemini 2.5 rejects thinking_level, so omit it there.
 */
export function geminiThinkingConfig(model: string): { thinking_level: string } | undefined {
  if (!supportsThinkingLevel(model)) return undefined;
  return { thinking_level: process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase() || "low" };
}
