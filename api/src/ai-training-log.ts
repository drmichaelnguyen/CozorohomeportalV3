import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_FIELD_CHARS = 48_000;

function clip(s: string, max = MAX_FIELD_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated]`;
}

export type AiTrainingChannel = "manager" | "resident_portal" | "resident_support_thread";

/**
 * Append one training row (JSONL) under `api/data/ai-chat-training/` (folder is gitignored with `api/data`).
 * Fire-and-forget from handlers; failures are logged and ignored.
 */
export async function appendAiTrainingExchange(input: {
  channel: AiTrainingChannel;
  identifier: string;
  userText: string;
  modelText: string;
  language?: string;
  conversationId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (process.env.AI_TRAINING_LOG_DISABLED === "1") {
    return;
  }
  const dir = path.join(process.cwd(), "data", "ai-chat-training");
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${input.channel}-${day}.jsonl`);
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      channel: input.channel,
      identifier: input.identifier.trim().toLowerCase().slice(0, 320),
      language: input.language,
      conversationId: input.conversationId,
      userText: clip(input.userText),
      modelText: clip(input.modelText),
      ...(input.meta && Object.keys(input.meta).length ? { meta: input.meta } : {})
    }) + "\n";

  try {
    await mkdir(dir, { recursive: true });
    await appendFile(file, line, "utf8");
  } catch (err) {
    console.warn("[ai-training-log] append failed", err);
  }
}
