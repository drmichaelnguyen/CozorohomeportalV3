import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { config } from "./config.js";
import { KnowledgeDocument } from "./knowledge/types.js";

const learnedQaEntrySchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  source: z.string(),
  channel: z.string(),
  createdAt: z.string(),
  conversationKey: z.string().optional(),
  adminAuthor: z.string().optional(),
  tags: z.array(z.string()).optional(),
  active: z.boolean().default(true),
  status: z.enum(["pending", "approved", "rejected"]).default("approved"),
  reviewedAt: z.string().optional(),
  reviewedBy: z.string().optional()
});

const chatMessageSchema = z.object({
  id: z.string(),
  conversationKey: z.string(),
  role: z.enum(["customer", "admin", "bot"]),
  text: z.string(),
  channel: z.string(),
  createdAt: z.string(),
  source: z.string()
});

const learningStateSchema = z.object({
  recentCustomerByConversation: z.record(z.string(), chatMessageSchema).default({}),
  recentMessagesByConversation: z.record(z.string(), z.array(chatMessageSchema)).default({}),
  handoffByConversation: z
    .record(
      z.string(),
      z.object({
        active: z.boolean(),
        startedAt: z.string(),
        updatedAt: z.string(),
        reason: z.string().optional(),
        lastBotNoticeAt: z.string().optional()
      })
    )
    .default({}),
  botReplyFingerprints: z
    .array(
      z.object({
        conversationKey: z.string(),
        text: z.string(),
        createdAt: z.string()
      })
    )
    .default([])
});

export type LearnedQaEntry = z.infer<typeof learnedQaEntrySchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type LearnedEntryStatus = "pending" | "approved" | "rejected";

type LearningState = z.infer<typeof learningStateSchema>;

type NewLearnedEntryInput = {
  question: string;
  answer: string;
  source: string;
  channel: string;
  createdAt?: string;
  conversationKey?: string;
  adminAuthor?: string;
  tags?: string[];
  status?: LearnedEntryStatus;
  reviewedAt?: string;
  reviewedBy?: string;
};

type RecordChatMessageInput = {
  conversationKey: string;
  role: "customer" | "admin" | "bot";
  text: string;
  channel: string;
  source: string;
  createdAt?: string;
};

type ImportConversationInput = {
  channel?: string;
  source?: string;
  adminAuthor?: string;
  conversationKey?: string;
  messages: Array<{
    role: "customer" | "admin";
    text: string;
    createdAt?: string;
  }>;
};

function hashValue(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function scrubTextForLearning(text: string) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    // Mask phone-like sequences while keeping prices/amounts readable.
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .trim();
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureParentDir(filePath);
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readLearnedEntries() {
  const parsed = await readJsonFile<unknown[]>(config.learningStoreFile, []);
  if (!Array.isArray(parsed)) {
    return [] as LearnedQaEntry[];
  }

  return parsed
    .map((entry) => learnedQaEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

async function writeLearnedEntries(entries: LearnedQaEntry[]) {
  await writeJsonFile(config.learningStoreFile, entries);
}

async function readLearningState() {
  const parsed = await readJsonFile<unknown>(config.learningStateFile, {});
  const result = learningStateSchema.safeParse(parsed);
  if (!result.success) {
    return learningStateSchema.parse({});
  }

  return result.data;
}

async function writeLearningState(state: LearningState) {
  await writeJsonFile(config.learningStateFile, state);
}

async function appendChatHistory(message: ChatMessage) {
  await ensureParentDir(config.chatHistoryFile);
  await appendFile(config.chatHistoryFile, `${JSON.stringify(message)}\n`, "utf8");
}

function createChatMessage(input: RecordChatMessageInput): ChatMessage {
  const createdAt = input.createdAt ?? nowIso();
  return {
    id: hashValue(
      JSON.stringify([input.conversationKey, input.role, input.text, input.channel, createdAt])
    ),
    conversationKey: input.conversationKey,
    role: input.role,
    text: input.text.trim(),
    channel: input.channel,
    createdAt,
    source: input.source
  };
}

function createLearnedEntry(input: NewLearnedEntryInput): LearnedQaEntry {
  const createdAt = input.createdAt ?? nowIso();
  const inferredStatus: LearnedEntryStatus =
    input.status ??
    (input.source.includes("admin-reply") || input.source.includes("admin-correction")
      ? "pending"
      : "approved");

  return {
    id: hashValue(
      JSON.stringify([input.question, input.answer, input.source, input.channel, input.conversationKey ?? ""])
    ),
    question: scrubTextForLearning(input.question),
    answer: scrubTextForLearning(input.answer),
    source: input.source,
    channel: input.channel,
    createdAt,
    conversationKey: input.conversationKey,
    adminAuthor: input.adminAuthor,
    tags: input.tags?.filter(Boolean),
    active: true,
    status: inferredStatus,
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy
  };
}

function pruneState(state: LearningState) {
  const cutoff = Date.now() - config.learningPairWindowMinutes * 60 * 1000;

  state.botReplyFingerprints = state.botReplyFingerprints.filter(
    (entry) => Date.parse(entry.createdAt) >= cutoff
  );

  state.recentCustomerByConversation = Object.fromEntries(
    (Object.entries(state.recentCustomerByConversation) as Array<[string, ChatMessage]>).filter(([, message]) => {
      return Date.parse(message.createdAt) >= cutoff;
    })
  );

  state.recentMessagesByConversation = Object.fromEntries(
    Object.entries(state.recentMessagesByConversation)
      .map(([key, messages]) => {
        const kept = (messages ?? []).filter((message) => Date.parse(message.createdAt) >= cutoff);
        return [key, kept] as const;
      })
      .filter(([, messages]) => messages.length > 0)
  );

  return state;
}

function appendRecentMessage(state: LearningState, message: ChatMessage) {
  const existing = state.recentMessagesByConversation[message.conversationKey] ?? [];
  const next = [...existing, message].slice(-12);
  state.recentMessagesByConversation[message.conversationKey] = next;
}

async function appendLearnedEntry(entry: LearnedQaEntry) {
  const entries = await readLearnedEntries();
  if (entries.some((candidate) => candidate.id === entry.id)) {
    return false;
  }

  entries.push(entry);
  await writeLearnedEntries(entries);
  return true;
}

export async function loadLearnedKnowledgeDocuments() {
  if (!config.learningEnabled) {
    return [] as KnowledgeDocument[];
  }

  const entries = (await readLearnedEntries()).filter(
    (entry) => entry.active && entry.status === "approved"
  );
  return entries
    .filter((entry) => entry.question.trim() && entry.answer.trim())
    .map((entry) => ({
      id: `learned:${entry.id}`,
      title: `Learned Q&A ${entry.channel}`,
      source: `learned://${entry.channel}/${entry.source}/${entry.id}`,
      content: [
        `Question: ${entry.question}`,
        `Answer: ${entry.answer}`,
        `Source: ${entry.source}`,
        `Created at: ${entry.createdAt}`,
        `Status: ${entry.status}`,
        entry.reviewedBy ? `Reviewed by: ${entry.reviewedBy}` : "",
        entry.reviewedAt ? `Reviewed at: ${entry.reviewedAt}` : "",
        entry.tags?.length ? `Tags: ${entry.tags.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    })) satisfies KnowledgeDocument[];
}

export async function recordCustomerMessage(input: RecordChatMessageInput) {
  if (!config.learningEnabled) {
    return;
  }

  const message = createChatMessage(input);
  await appendChatHistory(message);

  const state = pruneState(await readLearningState());
  state.recentCustomerByConversation[input.conversationKey] = message;
  appendRecentMessage(state, message);
  await writeLearningState(state);
}

export async function recordBotReply(input: RecordChatMessageInput) {
  if (!config.learningEnabled) {
    return;
  }

  const message = createChatMessage(input);
  await appendChatHistory(message);

  const state = pruneState(await readLearningState());
  appendRecentMessage(state, message);
  state.botReplyFingerprints.push({
    conversationKey: input.conversationKey,
    text: input.text.trim(),
    createdAt: message.createdAt
  });
  await writeLearningState(state);
}

export async function recordAdminReplyAndLearn(
  input: RecordChatMessageInput & { adminAuthor?: string }
) {
  if (!config.learningEnabled) {
    return { learned: false };
  }

  const message = createChatMessage(input);
  await appendChatHistory(message);

  const state = pruneState(await readLearningState());
  appendRecentMessage(state, message);
  const botMatchIndex = state.botReplyFingerprints.findIndex(
    (entry) =>
      entry.conversationKey === input.conversationKey &&
      entry.text.trim() === input.text.trim() &&
      Math.abs(Date.parse(entry.createdAt) - Date.parse(message.createdAt)) <= 10 * 60 * 1000
  );

  if (botMatchIndex >= 0) {
    state.botReplyFingerprints.splice(botMatchIndex, 1);
    await writeLearningState(state);
    return { learned: false, reason: "bot_echo" as const };
  }

  const customerMessage =
    state.recentCustomerByConversation[input.conversationKey] ??
    (state.recentMessagesByConversation[input.conversationKey] ?? [])
      .slice()
      .reverse()
      .find((message) => message.role === "customer");
  if (!customerMessage?.text.trim()) {
    await writeLearningState(state);
    return { learned: false, reason: "no_recent_customer_message" as const };
  }

  state.recentCustomerByConversation[input.conversationKey] = customerMessage;

  const entry = createLearnedEntry({
    question: customerMessage.text,
    answer: input.text,
    source: input.source,
    channel: input.channel,
    createdAt: input.createdAt,
    conversationKey: input.conversationKey,
    adminAuthor: input.adminAuthor,
    tags: ["auto-learned", input.channel]
  });

  const inserted = await appendLearnedEntry(entry);
  await writeLearningState(state);
  return inserted
    ? { learned: true, entry }
    : { learned: false, reason: "duplicate" as const };
}

export async function importLearnedQaEntries(entries: NewLearnedEntryInput[]) {
  const created: LearnedQaEntry[] = [];

  for (const item of entries) {
    if (!item.question.trim() || !item.answer.trim()) {
      continue;
    }

    const entry = createLearnedEntry({
      ...item,
      source: item.source || "manual-import",
      channel: item.channel || "manual"
    });

    if (await appendLearnedEntry(entry)) {
      created.push(entry);
    }
  }

  return created;
}

export async function importConversationHistory(conversations: ImportConversationInput[]) {
  const imported: LearnedQaEntry[] = [];

  for (const conversation of conversations) {
    let pendingQuestion = "";

    for (const message of conversation.messages) {
      if (message.role === "customer") {
        pendingQuestion = message.text.trim();
        continue;
      }

      if (message.role === "admin" && pendingQuestion && message.text.trim()) {
        const entry = createLearnedEntry({
          question: pendingQuestion,
          answer: message.text,
          source: conversation.source || "history-import",
          channel: conversation.channel || "manual-history",
          createdAt: message.createdAt,
          conversationKey: conversation.conversationKey,
          adminAuthor: conversation.adminAuthor,
          tags: ["history-import"]
        });

        if (await appendLearnedEntry(entry)) {
          imported.push(entry);
        }

        pendingQuestion = "";
      }
    }
  }

  return imported;
}

export async function getLearningStatus() {
  const [entries, state] = await Promise.all([readLearnedEntries(), readLearningState()]);
  return {
    enabled: config.learningEnabled,
    learnedCount: entries.length,
    activeLearnedCount: entries.filter((entry) => entry.active).length,
    approvedCount: entries.filter((entry) => entry.active && entry.status === "approved").length,
    pendingCount: entries.filter((entry) => entry.active && entry.status === "pending").length,
    rejectedCount: entries.filter((entry) => entry.active && entry.status === "rejected").length,
    recentConversationCount: Object.keys(state.recentCustomerByConversation).length,
    handoffActiveCount: Object.values(state.handoffByConversation).filter((entry) => entry.active).length,
    storeFile: config.learningStoreFile,
    chatHistoryFile: config.chatHistoryFile
  };
}

export async function getRecentLearnedEntries(limit = 40) {
  const entries = await readLearnedEntries();
  return entries
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function getLearnedEntries(
  options?: {
    status?: LearnedEntryStatus | "all";
    limit?: number;
  }
) {
  const status = options?.status ?? "all";
  const limit = Math.max(1, Math.min(500, options?.limit ?? 200));
  const entries = await readLearnedEntries();
  const filtered = status === "all" ? entries : entries.filter((entry) => entry.status === status);
  return filtered
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function setLearnedEntryStatus(
  id: string,
  status: LearnedEntryStatus,
  reviewedBy?: string
) {
  const entries = await readLearnedEntries();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return { updated: false as const };
  }

  entries[index] = {
    ...entries[index],
    status,
    reviewedAt: nowIso(),
    reviewedBy: reviewedBy?.trim() || entries[index].reviewedBy
  };

  await writeLearnedEntries(entries);
  return { updated: true as const, entry: entries[index] };
}

export async function getRecentConversationMessages(conversationKey: string, limit = 12) {
  const state = pruneState(await readLearningState());
  const messages = state.recentMessagesByConversation[conversationKey] ?? [];
  return messages.slice(-Math.max(1, Math.min(30, limit)));
}

export async function isHandoffActive(conversationKey: string) {
  const state = await readLearningState();
  return Boolean(state.handoffByConversation[conversationKey]?.active);
}

export async function setHandoffActive(conversationKey: string, reason?: string) {
  const state = await readLearningState();
  const now = nowIso();
  state.handoffByConversation[conversationKey] = {
    active: true,
    startedAt: state.handoffByConversation[conversationKey]?.startedAt ?? now,
    updatedAt: now,
    reason: reason?.trim() || state.handoffByConversation[conversationKey]?.reason,
    lastBotNoticeAt: state.handoffByConversation[conversationKey]?.lastBotNoticeAt
  };
  await writeLearningState(state);
}

export async function clearHandoff(conversationKey: string) {
  const state = await readLearningState();
  if (!state.handoffByConversation[conversationKey]) {
    return;
  }
  const now = nowIso();
  state.handoffByConversation[conversationKey] = {
    ...state.handoffByConversation[conversationKey],
    active: false,
    updatedAt: now
  };
  await writeLearningState(state);
}

export async function markHandoffNoticed(conversationKey: string) {
  const state = await readLearningState();
  const now = nowIso();
  if (!state.handoffByConversation[conversationKey]?.active) {
    return;
  }

  state.handoffByConversation[conversationKey] = {
    ...state.handoffByConversation[conversationKey],
    lastBotNoticeAt: now,
    updatedAt: now
  };
  await writeLearningState(state);
}
