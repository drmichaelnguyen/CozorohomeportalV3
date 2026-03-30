import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { config } from "./config.js";
import { loadFanpageTranscriptExamples } from "./fanpage-transcript.js";
import { getLearnedEntries, type LearnedQaEntry } from "./learning.js";
import { normalizeVietnameseChatText } from "./language.js";

const routerTrainingExampleSchema = z.object({
  id: z.string(),
  input: z.string(),
  context: z.string().optional(),
  decision: z.enum(["allow", "deny"]),
  route: z.enum(["simple_policy", "deep_policy", "off_topic"]),
  reason: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export type RouterTrainingExample = z.infer<typeof routerTrainingExampleSchema>;

export type NewRouterTrainingExample = {
  input: string;
  context?: string;
  decision: "allow" | "deny";
  route: "simple_policy" | "deep_policy" | "off_topic";
  reason?: string;
  tags?: string[];
  source?: string;
};

export type UpdateRouterTrainingExample = {
  input: string;
  context?: string;
  decision: "allow" | "deny";
  route: "simple_policy" | "deep_policy" | "off_topic";
  reason?: string;
  tags?: string[];
  source?: string;
};

export type AnswerTrainingExample = {
  question: string;
  answer: string;
  source: string;
  tags: string[];
  createdAt: string;
};

type ScoredAnswerTrainingExample = {
  entry: AnswerTrainingExample;
  score: number;
};

function hashValue(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function tokenize(value: string) {
  return normalizeVietnameseChatText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreSimilarity(query: string, candidate: string) {
  const queryTokens = tokenize(query);
  const candidateTokens = new Set(tokenize(candidate));

  if (!queryTokens.length || !candidateTokens.size) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += 2;
    } else if (candidate.includes(token)) {
      score += 1;
    }
  }

  if (candidate.includes(normalizeVietnameseChatText(query))) {
    score += 4;
  }

  return score;
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readRouterTrainingFile() {
  try {
    const raw = await readFile(config.routerTrainingFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as RouterTrainingExample[];
    }

    return parsed
      .map((item) => routerTrainingExampleSchema.safeParse(item))
      .filter((result) => result.success)
      .map((result) => result.data);
  } catch {
    return [] as RouterTrainingExample[];
  }
}

async function writeRouterTrainingFile(entries: RouterTrainingExample[]) {
  await ensureParentDir(config.routerTrainingFile);
  await writeFile(config.routerTrainingFile, JSON.stringify(entries, null, 2), "utf8");
}

function scoreRouterExample(
  example: RouterTrainingExample,
  question: string,
  conversationContext?: string
) {
  let score = scoreSimilarity(question, example.input);
  if (example.context?.trim() && conversationContext?.trim()) {
    score += scoreSimilarity(conversationContext, example.context) * 0.75;
  }

  if (example.decision === "allow") {
    score += 0.2;
  }

  return score;
}

function isGoodAnswerExample(entry: AnswerTrainingExample) {
  const answer = entry.answer.trim();
  const question = entry.question.trim();

  if (!question || !answer) {
    return false;
  }

  if (answer.length < 12 || answer.length > 500) {
    return false;
  }

  return true;
}

function toAnswerTrainingExample(entry: LearnedQaEntry): AnswerTrainingExample {
  return {
    question: entry.question,
    answer: entry.answer,
    source: entry.source,
    tags: entry.tags ?? [],
    createdAt: entry.createdAt
  };
}

function scoreAnswerExample(entry: AnswerTrainingExample, question: string) {
  let score = scoreSimilarity(question, entry.question);
  if (entry.source === "admin-trainer-manual") {
    score += 3;
  }
  if (entry.tags?.includes("manual-trainer")) {
    score += 2;
  }
  if (entry.tags?.includes("fanpage-transcript")) {
    score -= 0.5;
  }
  return score;
}

export async function getRelevantRouterExamples(
  question: string,
  conversationContext?: string,
  limit = 8
) {
  const entries = await readRouterTrainingFile();
  return entries
    .map((entry) => ({
      entry,
      score: scoreRouterExample(entry, question, conversationContext)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

export async function getRecentRouterExamples(limit = 30) {
  const entries = await readRouterTrainingFile();
  return entries
    .slice()
    .sort((left, right) =>
      String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
        String(left.updatedAt ?? left.createdAt ?? "")
      )
    )
    .slice(0, limit);
}

export async function addRouterTrainingExample(input: NewRouterTrainingExample) {
  const entries = await readRouterTrainingFile();
  const nextEntry: RouterTrainingExample = {
    id: hashValue(
      JSON.stringify([
        normalizeVietnameseChatText(input.input),
        normalizeVietnameseChatText(input.context ?? ""),
        input.decision,
        input.route
      ])
    ),
    input: normalizeVietnameseChatText(input.input),
    context: input.context?.trim() ? normalizeVietnameseChatText(input.context) : undefined,
    decision: input.decision,
    route: input.route,
    reason: input.reason?.trim() || undefined,
    tags: input.tags?.filter(Boolean),
    source: input.source?.trim() || "admin-router-trainer",
    createdAt: new Date().toISOString()
  };

  if (entries.some((entry) => entry.id === nextEntry.id)) {
    return { created: false as const };
  }

  entries.push(nextEntry);
  await writeRouterTrainingFile(entries);
  return { created: true as const, entry: nextEntry };
}

export async function updateRouterTrainingExample(
  id: string,
  input: UpdateRouterTrainingExample
) {
  const entries = await readRouterTrainingFile();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return { updated: false as const, reason: "not_found" as const };
  }

  const normalizedInput = normalizeVietnameseChatText(input.input);
  const normalizedContext = input.context?.trim()
    ? normalizeVietnameseChatText(input.context)
    : undefined;
  const duplicateId = hashValue(
    JSON.stringify([normalizedInput, normalizedContext ?? "", input.decision, input.route])
  );

  if (entries.some((entry, candidateIndex) => candidateIndex !== index && entry.id === duplicateId)) {
    return { updated: false as const, reason: "duplicate" as const };
  }

  entries[index] = {
    ...entries[index],
    id: duplicateId,
    input: normalizedInput,
    context: normalizedContext,
    decision: input.decision,
    route: input.route,
    reason: input.reason?.trim() || undefined,
    tags: input.tags?.filter(Boolean),
    source: input.source?.trim() || entries[index].source,
    updatedAt: new Date().toISOString()
  };

  await writeRouterTrainingFile(entries);
  return { updated: true as const, entry: entries[index] };
}

export async function deleteRouterTrainingExample(id: string) {
  const entries = await readRouterTrainingFile();
  const nextEntries = entries.filter((entry) => entry.id !== id);
  if (nextEntries.length === entries.length) {
    return { deleted: false as const };
  }

  await writeRouterTrainingFile(nextEntries);
  return { deleted: true as const };
}

export async function getRelevantAnswerTrainingExamples(question: string, limit = 4) {
  const [entries, fanpageExamples] = await Promise.all([
    getLearnedEntries({ status: "approved", limit: 400 }),
    loadFanpageTranscriptExamples(config.fanpageTranscriptPaths)
  ]);

  const manualEntries = entries.filter(
    (entry) => entry.source === "admin-trainer-manual" || entry.tags?.includes("manual-trainer")
  );

  const learnedPool = (manualEntries.length ? manualEntries : entries).map(toAnswerTrainingExample);
  const candidatePool = [...learnedPool, ...fanpageExamples];
  const deduped = new Map<string, AnswerTrainingExample>();

  for (const entry of candidatePool) {
    const key = normalizeVietnameseChatText(entry.question);
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()]
    .filter(isGoodAnswerExample)
    .map(
      (entry) =>
        ({
          entry,
          score: scoreAnswerExample(entry, question)
        }) satisfies ScoredAnswerTrainingExample
    )
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}
