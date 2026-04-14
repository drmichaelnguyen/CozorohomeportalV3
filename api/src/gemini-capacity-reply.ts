/**
 * User-facing copy when Gemini is overloaded, rate-limited, or out of quota.
 * Shared by Cozoro Bee and resident support assistant.
 */

export type GeminiCapacityLanguage = "en" | "vi";

export function geminiCapacityReply(language: GeminiCapacityLanguage): string {
  if (language === "vi") {
    return "Anh Trọng hết tiền để trả lương cho tớ rồi, nên tớ đi chơi đây, không hẹn ngày gặp lại, bái bai chờ anh Trọng giàu hơn kiếm được nhiều phú bà rồi tớ quay lại";
  }
  return "Trọng can't afford my salary anymore, so I'm off—no return date. Bye for now; I'll come back when he's richer.";
}

/** True when Gemini signals quota, rate limits, overload, or HTTP busy/unavailable. */
export function isGeminiCapacityOrRateLimit(
  response: Response,
  data: { error?: { message?: string; code?: number } }
): boolean {
  if (response.status === 429 || response.status === 503 || response.status === 502) return true;
  const err = data.error;
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const code = (err as { code?: number }).code;
  if (code === 429) return true;
  if (msg.includes("quota")) return true;
  if (msg.includes("resource exhausted")) return true;
  if (msg.includes("rate limit")) return true;
  if (msg.includes("too many requests")) return true;
  if (msg.includes("high demand")) return true;
  if (msg.includes("overloaded")) return true;
  if (msg.includes("spikes in demand")) return true;
  if (msg.includes("service unavailable")) return true;
  return false;
}

/**
 * When the model returns nothing useful or cannot complete (empty output, max tool rounds, etc.).
 */
export function geminiModelDoesNotKnowReply(language: GeminiCapacityLanguage): string {
  if (language === "vi") {
    return "Anh Trọng già khó tính không cho tớ làm cái này, ảnh đòi tớ phải nghỉ ngơi, phải chăm sóc sắc đẹp, cậu tự làm đi nha :)";
  }
  return "Old-man Trọng won't let me do that — he says I need rest and self-care. You'll have to handle this one yourself :)";
}
