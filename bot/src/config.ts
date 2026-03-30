import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().optional(),
  BOT_PUBLIC_BASE_URL: z.string().url().optional(),
  BOT_HOTLINE: z.string().optional(),
  BOT_ADMIN_USERNAME: z.string().optional(),
  BOT_ADMIN_PASSWORD: z.string().optional(),
  BOT_ADMIN_SESSION_TTL_HOURS: z.string().optional(),
  FACEBOOK_VERIFY_TOKEN: z.string().optional(),
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_GRAPH_API_BASE_URL: z.string().url().optional(),
  BOT_LLM_PROVIDER: z.enum(["none", "gemini", "openai"]).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_BASE_URL: z.string().url().optional(),
  BOT_ROUTER_MODEL: z.string().optional(),
  BOT_ANSWER_MODEL: z.string().optional(),
  BOT_ROUTER_TRAINING_FILE: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  BOT_TOP_K: z.string().optional(),
  BOT_KNOWLEDGE_REFRESH_INTERVAL_MS: z.string().optional(),
  BOT_KNOWLEDGE_LOCAL_PATHS: z.string().optional(),
  BOT_KNOWLEDGE_REMOTE_URLS: z.string().optional(),
  BOT_KNOWLEDGE_REMOTE_SOURCE_FILE: z.string().optional(),
  BOT_FANPAGE_TRANSCRIPT_PATHS: z.string().optional(),
  BOT_LEARNING_ENABLED: z.string().optional(),
  BOT_LEARNING_STORE_FILE: z.string().optional(),
  BOT_CHAT_HISTORY_FILE: z.string().optional(),
  BOT_LEARNING_STATE_FILE: z.string().optional(),
  BOT_LEARNING_PAIR_WINDOW_MINUTES: z.string().optional(),
  BOT_API_BASE_URL: z.string().url().optional(),
  BOT_API_SHARED_TOKEN: z.string().optional()
});

function parseList(value: string | undefined, fallback: string[]) {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveLocalPath(entry: string) {
  if (path.isAbsolute(entry)) {
    return entry;
  }

  return path.resolve(process.cwd(), entry);
}

const env = envSchema.parse(process.env);
const inferredProvider =
  env.BOT_LLM_PROVIDER ??
  (env.GEMINI_API_KEY?.trim() ? "gemini" : env.OPENAI_API_KEY?.trim() ? "openai" : "none");

export const config = {
  port: Number(env.PORT ?? 4010),
  publicBaseUrl: env.BOT_PUBLIC_BASE_URL ?? "http://localhost:4010",
  hotline: env.BOT_HOTLINE?.trim() || "0902949682",
  adminUsername: env.BOT_ADMIN_USERNAME?.trim() || "cozoro",
  adminPassword: env.BOT_ADMIN_PASSWORD?.trim() || "Cozoro@6996",
  adminSessionTtlHours: Math.max(1, Number(env.BOT_ADMIN_SESSION_TTL_HOURS ?? 12)),
  facebookVerifyToken: env.FACEBOOK_VERIFY_TOKEN?.trim() ?? "",
  facebookPageAccessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() ?? "",
  facebookAppSecret: env.FACEBOOK_APP_SECRET?.trim() ?? "",
  facebookGraphApiBaseUrl:
    env.FACEBOOK_GRAPH_API_BASE_URL?.replace(/\/+$/, "") ?? "https://graph.facebook.com/v22.0",
  llmProvider: inferredProvider,
  geminiApiKey: env.GEMINI_API_KEY?.trim() ?? "",
  geminiApiBaseUrl:
    env.GEMINI_API_BASE_URL?.replace(/\/+$/, "") ?? "https://generativelanguage.googleapis.com/v1beta",
  routerModel: env.BOT_ROUTER_MODEL?.trim() ?? "gemini-2.5-flash-lite",
  answerModel: env.BOT_ANSWER_MODEL?.trim() ?? "gemini-2.5-flash",
  routerTrainingFile: resolveLocalPath(env.BOT_ROUTER_TRAINING_FILE ?? "./data/router-training.json"),
  openAiApiKey: env.OPENAI_API_KEY?.trim() ?? "",
  openAiModel: env.OPENAI_MODEL?.trim() ?? "gpt-4.1-mini",
  topK: Number(env.BOT_TOP_K ?? 6),
  knowledgeRefreshIntervalMs: Number(env.BOT_KNOWLEDGE_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000),
  knowledgeLocalPaths: parseList(env.BOT_KNOWLEDGE_LOCAL_PATHS, ["../Cozoro Knowledge.md"]).map(resolveLocalPath),
  knowledgeRemoteUrls: parseList(env.BOT_KNOWLEDGE_REMOTE_URLS, []),
  knowledgeRemoteSourceFile: resolveLocalPath(
    env.BOT_KNOWLEDGE_REMOTE_SOURCE_FILE ?? "./sources/remote-sources.json"
  ),
  fanpageTranscriptPaths: parseList(env.BOT_FANPAGE_TRANSCRIPT_PATHS, []).map(
    resolveLocalPath
  ),
  learningEnabled: (env.BOT_LEARNING_ENABLED ?? "true").trim().toLowerCase() !== "false",
  learningStoreFile: resolveLocalPath(env.BOT_LEARNING_STORE_FILE ?? "./data/learned-qa.json"),
  chatHistoryFile: resolveLocalPath(env.BOT_CHAT_HISTORY_FILE ?? "./data/chat-history.jsonl"),
  learningStateFile: resolveLocalPath(env.BOT_LEARNING_STATE_FILE ?? "./data/learning-state.json"),
  learningPairWindowMinutes: Number(env.BOT_LEARNING_PAIR_WINDOW_MINUTES ?? 120),
  apiBaseUrl: env.BOT_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:4000",
  apiSharedToken: env.BOT_API_SHARED_TOKEN?.trim() ?? ""
} as const;

