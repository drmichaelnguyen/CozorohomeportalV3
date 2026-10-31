/**
 * AI Manager ↔ owner/admin chat inbox: open/closed topics with threaded replies.
 * Stored in api/data/ai-manager-inbox.json (preserve across production refreshes).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { logAction } from "./action-log.js";
import { managerResolveFineDispute } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";
import {
  appendMessageToTopic,
  applyChoiceToTopic,
  applyOwnerReplyToTopic,
  buildContractEscalationChoices,
  buildFineDisputeEscalationChoices,
  buildSupportEscalationChoices,
  choiceKeepsTopicOpen,
  closeTopic,
  countOpenTopics,
  countUnreadTopics,
  createInboxMessage,
  findOpenTopicDedupeKey,
  formatOpenTopicsForPrompt,
  isTopicRecord,
  markTopicsRead,
  MAX_AI_MANAGER_INBOX_TOPICS,
  migrateLegacyInboxItems,
  reopenTopic,
  summarizeTopicForLearning,
  type AiManagerInboxCategory,
  type AiManagerInboxChoice,
  type AiManagerInboxItem,
  type AiManagerInboxTopic,
  type AiManagerInboxTopicKind
} from "./ai-manager-inbox-logic.js";

const inboxPath = path.join(process.cwd(), "data", "ai-manager-inbox.json");

type InboxFile = { topics: AiManagerInboxTopic[]; items?: AiManagerInboxItem[] };

async function readInboxFile(): Promise<InboxFile> {
  try {
    const raw = await readFile(inboxPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<InboxFile> & { items?: AiManagerInboxItem[] };
    if (Array.isArray(parsed.topics) && parsed.topics.length) {
      return {
        topics: parsed.topics.filter(isTopicRecord)
      };
    }
    // Migrate legacy flat items → topics once.
    if (Array.isArray(parsed.items) && parsed.items.length) {
      const topics = migrateLegacyInboxItems(parsed.items);
      const migrated: InboxFile = { topics };
      await writeInboxFile(migrated);
      return migrated;
    }
    return { topics: [] };
  } catch {
    return { topics: [] };
  }
}

async function writeInboxFile(file: InboxFile) {
  await mkdir(path.dirname(inboxPath), { recursive: true });
  await writeFile(
    inboxPath,
    JSON.stringify({ topics: file.topics.slice(0, MAX_AI_MANAGER_INBOX_TOPICS) }, null, 2),
    "utf8"
  );
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

async function createTopic(input: {
  kind: AiManagerInboxTopicKind;
  category: AiManagerInboxCategory;
  fromEmail: string;
  fromName: string;
  title: string;
  body: string;
  choices?: AiManagerInboxChoice[];
  relatedReportId?: string | null;
  relatedConversationId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  residentEmail?: string | null;
}): Promise<AiManagerInboxTopic> {
  const now = new Date().toISOString();
  const id = newId(input.kind === "escalation" ? "aime" : "aimr");
  const topic: AiManagerInboxTopic = {
    id,
    kind: input.kind,
    category: input.category,
    status: "open",
    title: input.title.trim().slice(0, 200),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedByEmail: null,
    fromEmail: input.fromEmail.trim().toLowerCase(),
    fromName: input.fromName.trim() || "Cozoro AI Manager",
    choices: input.choices ?? [],
    selectedChoiceId: null,
    relatedReportId: input.relatedReportId ?? null,
    relatedConversationId: input.relatedConversationId ?? null,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    residentEmail: input.residentEmail?.trim().toLowerCase() || null,
    readBy: [],
    messages: [
      createInboxMessage({
        id: newId("msg"),
        role: "ai_manager",
        kind: "opening",
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        body: input.body,
        createdAt: now
      })
    ]
  };
  const file = await readInboxFile();
  file.topics = [topic, ...file.topics].slice(0, MAX_AI_MANAGER_INBOX_TOPICS);
  await writeInboxFile(file);
  return topic;
}

export async function listAiManagerInboxTopics(limit = 80): Promise<AiManagerInboxTopic[]> {
  const file = await readInboxFile();
  const take = Math.max(1, Math.min(200, Math.trunc(limit) || 80));
  return file.topics.slice(0, take);
}

/** @deprecated Prefer listAiManagerInboxTopics */
export async function listAiManagerInbox(limit = 80): Promise<AiManagerInboxTopic[]> {
  return listAiManagerInboxTopics(limit);
}

export async function getAiManagerInboxTopic(id: string): Promise<AiManagerInboxTopic | null> {
  const file = await readInboxFile();
  return file.topics.find((topic) => topic.id === id) ?? null;
}

/** @deprecated Prefer getAiManagerInboxTopic */
export async function getAiManagerInboxItem(id: string): Promise<AiManagerInboxTopic | null> {
  return getAiManagerInboxTopic(id);
}

export async function getAiManagerInboxSummary(actorEmail: string) {
  await requirePortalRole(
    actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can view the AI Manager inbox."
  );
  const topics = await listAiManagerInboxTopics(120);
  return {
    topics,
    // Backward-compatible alias for older clients
    items: topics,
    openCount: countOpenTopics(topics),
    unreadCount: countUnreadTopics(topics, actorEmail)
  };
}

export async function getOpenTopicsPromptBlock(): Promise<string> {
  const topics = await listAiManagerInboxTopics(40);
  return formatOpenTopicsForPrompt(topics);
}

export async function postAiManagerReportToInbox(input: {
  fromEmail: string;
  fromName: string;
  reportId: string;
  title: string;
  body: string;
}): Promise<AiManagerInboxTopic> {
  return createTopic({
    kind: "report",
    category: "report",
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    title: input.title,
    body: input.body,
    relatedReportId: input.reportId,
    relatedEntityType: "AiManagerReport",
    relatedEntityId: input.reportId,
    choices: []
  });
}

export async function postAiManagerEscalation(input: {
  fromEmail: string;
  fromName: string;
  category: AiManagerInboxCategory;
  title: string;
  body: string;
  choices: AiManagerInboxChoice[];
  relatedReportId?: string | null;
  relatedConversationId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  residentEmail?: string | null;
  dedupe?: boolean;
}): Promise<AiManagerInboxTopic | null> {
  const file = await readInboxFile();
  if (input.dedupe !== false) {
    const existing = findOpenTopicDedupeKey(file.topics, {
      category: input.category,
      relatedConversationId: input.relatedConversationId,
      relatedEntityId: input.relatedEntityId
    });
    if (existing) {
      // Append a follow-up inside the open topic so context stays in one thread.
      const index = file.topics.findIndex((topic) => topic.id === existing.id);
      if (index >= 0) {
        const updated = appendMessageToTopic(
          file.topics[index],
          createInboxMessage({
            id: newId("msg"),
            role: "ai_manager",
            kind: "follow_up",
            fromEmail: input.fromEmail,
            fromName: input.fromName,
            body: input.body
          })
        );
        file.topics[index] = updated;
        // Bump to top
        file.topics = [updated, ...file.topics.filter((t) => t.id !== updated.id)];
        await writeInboxFile(file);
        return updated;
      }
      return existing;
    }
  }

  const topic = await createTopic({
    kind: "escalation",
    category: input.category,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    title: input.title,
    body: input.body,
    choices: input.choices,
    relatedReportId: input.relatedReportId ?? null,
    relatedConversationId: input.relatedConversationId ?? null,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    residentEmail: input.residentEmail ?? null
  });

  await logAction({
    actorEmail: input.fromEmail,
    actorName: input.fromName,
    actorRole: "manager",
    action: "ai_manager.inbox.escalate",
    entityType: "AiManagerInbox",
    entityId: topic.id,
    entityLabel: input.residentEmail ?? input.category,
    details: `category=${input.category}; title=${input.title.slice(0, 120)}; topic=open`
  });
  return topic;
}

export async function escalateSupportChatToOwner(input: {
  fromEmail: string;
  fromName: string;
  conversationId: string;
  residentEmail: string;
  residentName?: string | null;
  latestBody: string;
  reason?: string;
  relatedReportId?: string | null;
}) {
  const name = input.residentName?.trim() || input.residentEmail;
  return postAiManagerEscalation({
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    category: "support_chat",
    title: `Need guidance: support chat with ${name}`,
    body: [
      `I am unsure how to auto-reply on this personal support thread.`,
      input.reason ? `Reason: ${input.reason}` : "Reason: sensitive / high-stakes topic.",
      "",
      `Resident: ${name} <${input.residentEmail}>`,
      `Conversation: ${input.conversationId}`,
      "",
      "Latest resident message:",
      input.latestBody.trim().slice(0, 1200) || "(empty)"
    ].join("\n"),
    choices: buildSupportEscalationChoices(),
    relatedConversationId: input.conversationId,
    relatedEntityType: "SupportConversation",
    relatedEntityId: input.conversationId,
    relatedReportId: input.relatedReportId ?? null,
    residentEmail: input.residentEmail,
    dedupe: true
  });
}

export async function escalateFineDisputeToOwner(input: {
  fromEmail: string;
  fromName: string;
  email: string;
  timestamp: string;
  content: string;
  amount: string;
  dispute: string;
  relatedReportId?: string | null;
}) {
  const entityId = `${input.email}|${input.timestamp}|||${input.content}`;
  return postAiManagerEscalation({
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    category: "fines",
    title: `Need decision: fine dispute for ${input.email}`,
    body: [
      "I am unsure whether to keep or cancel this fine.",
      "",
      `Resident: ${input.email}`,
      `Fine: ${input.content || "(no content)"}`,
      `Amount: ${input.amount || "—"}`,
      `Timestamp: ${input.timestamp}`,
      "",
      "Resident dispute text:",
      input.dispute.trim().slice(0, 1200) || "(empty)"
    ].join("\n"),
    choices: buildFineDisputeEscalationChoices(),
    relatedEntityType: "FineDispute",
    relatedEntityId: entityId,
    relatedReportId: input.relatedReportId ?? null,
    residentEmail: input.email,
    dedupe: true
  });
}

export async function escalatePendingContractToOwner(input: {
  fromEmail: string;
  fromName: string;
  approvalId: string;
  type: string;
  email: string;
  summary: string;
  relatedReportId?: string | null;
}) {
  return postAiManagerEscalation({
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    category: "contracts",
    title: `Pending ${input.type || "contract"} approval for ${input.email}`,
    body: [
      "A contract approval needs a human owner/admin decision. I cannot approve or reject this myself.",
      "",
      `Approval id: ${input.approvalId}`,
      `Type: ${input.type}`,
      `Client: ${input.email}`,
      "",
      input.summary.trim().slice(0, 1200) || "(no summary)"
    ].join("\n"),
    choices: buildContractEscalationChoices(),
    relatedEntityType: "ContractApproval",
    relatedEntityId: input.approvalId,
    relatedReportId: input.relatedReportId ?? null,
    residentEmail: input.email,
    dedupe: true
  });
}

async function executeResolvedTopic(topic: AiManagerInboxTopic) {
  const choice = topic.choices.find((entry) => entry.id === topic.selectedChoiceId);
  const action = choice?.action ?? null;
  const latestOwnerReply =
    [...topic.messages].reverse().find((m) => m.role === "owner" && m.kind === "reply")?.body ?? "";

  if (topic.category === "fines" && (action === "keep_fine" || action === "cancel_fine")) {
    const entityId = String(topic.relatedEntityId ?? "");
    const [meta, contentFromId] = entityId.split("|||");
    const [email, ...timestampParts] = (meta || "").split("|");
    const timestamp = timestampParts.join("|");
    const opening = topic.messages.find((m) => m.kind === "opening")?.body ?? "";
    const contentMatch = /^Fine:\s*(.+)$/im.exec(opening);
    const content = (contentFromId || contentMatch?.[1] || "").trim();
    if (email && timestamp && content) {
      await managerResolveFineDispute({
        email,
        timestamp,
        content,
        decision: action === "cancel_fine" ? "CANCEL_FINE" : "KEEP_FINE",
        note:
          action === "cancel_fine"
            ? `Owner via AI Manager topic: cancel. ${latestOwnerReply}`.trim()
            : `Owner via AI Manager topic: keep. ${latestOwnerReply}`.trim(),
        operator: topic.closedByEmail || topic.messages.find((m) => m.role === "owner")?.fromEmail || "owner"
      });
    }
  }

  await logAction({
    actorEmail: topic.closedByEmail || topic.messages.find((m) => m.role === "owner")?.fromEmail,
    actorName: "Owner",
    actorRole: "owner",
    action: "ai_manager.inbox.resolve",
    entityType: "AiManagerInbox",
    entityId: topic.id,
    entityLabel: topic.residentEmail ?? topic.category,
    details: summarizeTopicForLearning(topic).slice(0, 1800)
  });

  try {
    const { upsertAiManagerActionFeedback } = await import("./ai-manager-feedback.js");
    const { prisma } = await import("./prisma.js");
    const log = await prisma.actionLog.findFirst({
      where: {
        action: "ai_manager.inbox.resolve",
        entityId: topic.id
      },
      orderBy: { createdAt: "desc" }
    });
    const actor =
      topic.closedByEmail || topic.messages.find((m) => m.role === "owner")?.fromEmail || null;
    if (log && actor) {
      await upsertAiManagerActionFeedback({
        actorEmail: actor,
        actionLogId: log.id,
        rating: "like",
        guide: summarizeTopicForLearning(topic)
      });
    }
  } catch {
    // Learning write is best-effort.
  }
}

export async function resolveAiManagerInboxChoice(input: {
  actorEmail: string;
  itemId: string;
  choiceId: string;
  ownerReply?: string | null;
  actorName?: string;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can decide AI Manager escalations."
  );
  const file = await readInboxFile();
  const index = file.topics.findIndex((topic) => topic.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Topic not found."), { statusCode: 404 });
  }
  const updated = applyChoiceToTopic(file.topics[index], {
    choiceId: input.choiceId,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    ownerReply: input.ownerReply,
    choiceMessageId: newId("msg"),
    replyMessageId: input.ownerReply?.trim() ? newId("msg") : undefined,
    closeMessageId: newId("msg")
  });
  file.topics[index] = updated;
  file.topics = [updated, ...file.topics.filter((t) => t.id !== updated.id)];
  await writeInboxFile(file);

  const choice = updated.choices.find((entry) => entry.id === updated.selectedChoiceId);
  if (!choiceKeepsTopicOpen(choice) || updated.status === "closed") {
    await executeResolvedTopic(updated);
  } else {
    await logAction({
      actorEmail: input.actorEmail,
      actorName: input.actorName || "Owner",
      actorRole: "owner",
      action: "ai_manager.inbox.choice",
      entityType: "AiManagerInbox",
      entityId: updated.id,
      entityLabel: updated.residentEmail ?? updated.category,
      details: `choice=${choice?.id}; keepsOpen=1; ${summarizeTopicForLearning(updated).slice(0, 400)}`
    });
  }
  return updated;
}

export async function replyAiManagerInboxItem(input: {
  actorEmail: string;
  itemId: string;
  ownerReply: string;
  closeTopic?: boolean;
  actorName?: string;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can reply in the AI Manager inbox."
  );
  const file = await readInboxFile();
  const index = file.topics.findIndex((topic) => topic.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Topic not found."), { statusCode: 404 });
  }
  const updated = applyOwnerReplyToTopic(file.topics[index], {
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    ownerReply: input.ownerReply,
    closeTopic: input.closeTopic === true,
    replyMessageId: newId("msg"),
    closeMessageId: newId("msg")
  });
  file.topics[index] = updated;
  file.topics = [updated, ...file.topics.filter((t) => t.id !== updated.id)];
  await writeInboxFile(file);

  if (updated.status === "closed") {
    await executeResolvedTopic(updated);
  } else {
    await logAction({
      actorEmail: input.actorEmail,
      actorName: input.actorName || "Owner",
      actorRole: "owner",
      action: "ai_manager.inbox.reply",
      entityType: "AiManagerInbox",
      entityId: updated.id,
      entityLabel: updated.residentEmail ?? updated.category,
      details: `replyChars=${input.ownerReply.trim().length}; topic=open`
    });
  }
  return updated;
}

export async function closeAiManagerInboxTopic(input: {
  actorEmail: string;
  itemId: string;
  note?: string | null;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can close AI Manager topics."
  );
  const file = await readInboxFile();
  const index = file.topics.findIndex((topic) => topic.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Topic not found."), { statusCode: 404 });
  }
  let updated = file.topics[index];
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (note) {
    updated = appendMessageToTopic(
      updated,
      createInboxMessage({
        id: newId("msg"),
        role: "owner",
        kind: "reply",
        fromEmail: input.actorEmail,
        fromName: "Owner",
        body: note
      })
    );
  }
  updated = closeTopic(updated, {
    actorEmail: input.actorEmail,
    messageId: newId("msg"),
    systemBody: "Topic closed by owner/admin."
  });
  file.topics[index] = updated;
  file.topics = [updated, ...file.topics.filter((t) => t.id !== updated.id)];
  await writeInboxFile(file);
  await executeResolvedTopic(updated);
  return updated;
}

export async function reopenAiManagerInboxTopic(input: {
  actorEmail: string;
  itemId: string;
  note?: string | null;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can reopen AI Manager topics."
  );
  const file = await readInboxFile();
  const index = file.topics.findIndex((topic) => topic.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Topic not found."), { statusCode: 404 });
  }
  let updated = reopenTopic(file.topics[index], {
    actorEmail: input.actorEmail,
    messageId: newId("msg"),
    systemBody: "Topic reopened by owner/admin."
  });
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (note) {
    updated = appendMessageToTopic(
      updated,
      createInboxMessage({
        id: newId("msg"),
        role: "owner",
        kind: "reply",
        fromEmail: input.actorEmail,
        fromName: "Owner",
        body: note
      })
    );
  }
  file.topics[index] = updated;
  file.topics = [updated, ...file.topics.filter((t) => t.id !== updated.id)];
  await writeInboxFile(file);
  await logAction({
    actorEmail: input.actorEmail,
    actorName: "Owner",
    actorRole: "owner",
    action: "ai_manager.inbox.reopen",
    entityType: "AiManagerInbox",
    entityId: updated.id,
    entityLabel: updated.residentEmail ?? updated.category,
    details: `title=${updated.title.slice(0, 120)}`
  });
  return updated;
}

/** @deprecated Prefer closeAiManagerInboxTopic */
export async function acknowledgeAiManagerInboxItem(input: {
  actorEmail: string;
  itemId: string;
}) {
  return closeAiManagerInboxTopic(input);
}

export async function markAiManagerInboxRead(input: {
  actorEmail: string;
  ids?: string[];
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can mark the AI Manager inbox read."
  );
  const file = await readInboxFile();
  file.topics = markTopicsRead(file.topics, input.actorEmail, input.ids);
  await writeInboxFile(file);
  return {
    ok: true,
    unreadCount: countUnreadTopics(file.topics, input.actorEmail)
  };
}

export async function listOpenAiManagerEscalations(limit = 20): Promise<AiManagerInboxTopic[]> {
  const file = await readInboxFile();
  return file.topics
    .filter((topic) => topic.kind === "escalation" && topic.status === "open")
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export {
  buildSupportEscalationChoices,
  buildFineDisputeEscalationChoices,
  buildContractEscalationChoices,
  formatOpenTopicsForPrompt,
  isAmbiguousFineDispute
} from "./ai-manager-inbox-logic.js";

export type {
  AiManagerInboxTopic,
  AiManagerInboxChoice,
  AiManagerInboxCategory,
  AiManagerInboxTopicKind,
  AiManagerInboxMessage,
  AiManagerInboxItem,
  AiManagerInboxItemKind
} from "./ai-manager-inbox-logic.js";
