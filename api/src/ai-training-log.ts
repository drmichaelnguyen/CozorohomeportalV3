import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_FIELD_CHARS = 48_000;
const MAX_TOOL_JSON_CHARS = 24_000;

function clip(s: string, max = MAX_FIELD_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated]`;
}

function clipJsonString(value: unknown, max = MAX_TOOL_JSON_CHARS): string {
  try {
    const s = JSON.stringify(value);
    return s.length <= max ? s : `${s.slice(0, max)}…[truncated]`;
  } catch {
    return "[unserializable]";
  }
}

export type AiTrainingChannel = "manager" | "resident_portal" | "resident_support_thread";

const UNIFIED_BEHAVIOR_DIR = path.join(process.cwd(), "data", "ai-behavior");

/**
 * Cross-channel JSONL: every exchange + tool invocation (one line per event).
 * See `docs/ai-behavior-log.md`. Disabled when `AI_TRAINING_LOG_DISABLED=1`.
 */
async function appendUnifiedBehaviorRecord(payload: Record<string, unknown>): Promise<void> {
  if (process.env.AI_TRAINING_LOG_DISABLED === "1") {
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(UNIFIED_BEHAVIOR_DIR, `unified-${day}.jsonl`);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n";
  try {
    await mkdir(UNIFIED_BEHAVIOR_DIR, { recursive: true });
    await appendFile(file, line, "utf8");
  } catch (err) {
    console.warn("[ai-behavior-log] unified append failed", err);
  }
}

/**
 * Append one training row (JSONL) under `api/data/ai-chat-training/` (folder is gitignored with `api/data`).
 * Also appends a normalized line to `api/data/ai-behavior/unified-YYYY-MM-DD.jsonl`.
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
  const payload = {
    ts: new Date().toISOString(),
    channel: input.channel,
    identifier: input.identifier.trim().toLowerCase().slice(0, 320),
    language: input.language,
    conversationId: input.conversationId,
    userText: clip(input.userText),
    modelText: clip(input.modelText),
    ...(input.meta && Object.keys(input.meta).length ? { meta: input.meta } : {})
  };
  const line = JSON.stringify(payload) + "\n";

  try {
    await mkdir(dir, { recursive: true });
    await appendFile(file, line, "utf8");
  } catch (err) {
    console.warn("[ai-training-log] append failed", err);
  }

  void appendUnifiedBehaviorRecord({
    kind: "exchange",
    channel: input.channel,
    identifier: payload.identifier,
    language: input.language,
    conversationId: input.conversationId,
    userText: payload.userText,
    modelText: payload.modelText,
    ...(input.meta && Object.keys(input.meta).length ? { meta: input.meta } : {})
  });
}

/**
 * Log a single Gemini tool invocation (manager AI, resident Bee, support assistant).
 */
export async function appendAiToolInvocation(input: {
  channel: AiTrainingChannel;
  identifier: string;
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  language?: string;
  conversationId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (process.env.AI_TRAINING_LOG_DISABLED === "1") {
    return;
  }
  void appendUnifiedBehaviorRecord({
    kind: "tool_call",
    channel: input.channel,
    identifier: input.identifier.trim().toLowerCase().slice(0, 320),
    language: input.language,
    conversationId: input.conversationId,
    toolName: input.toolName,
    argsJson: clipJsonString(input.args),
    resultJson: clipJsonString(input.result),
    ...(input.meta && Object.keys(input.meta).length ? { meta: input.meta } : {})
  });
}
