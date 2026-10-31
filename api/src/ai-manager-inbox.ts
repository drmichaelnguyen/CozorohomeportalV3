/**
 * AI Manager ↔ owner/admin chat inbox: reports, escalations, multiple-choice decisions.
 * Stored in api/data/ai-manager-inbox.json (preserve across production refreshes).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { logAction } from "./action-log.js";
import { managerResolveFineDispute } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";
import {
  acknowledgeInboxItem,
  applyChoiceToInboxItem,
  applyFreeTextReplyToInboxItem,
  buildContractEscalationChoices,
  buildFineDisputeEscalationChoices,
  buildSupportEscalationChoices,
  countOpenInboxItems,
  countUnreadInboxItems,
  findOpenEscalationDedupeKey,
  markInboxItemsRead,
  MAX_AI_MANAGER_INBOX_ITEMS,
  summarizeChoiceForLearning,
  type AiManagerInboxCategory,
  type AiManagerInboxChoice,
  type AiManagerInboxItem
} from "./ai-manager-inbox-logic.js";

const inboxPath = path.join(process.cwd(), "data", "ai-manager-inbox.json");

type InboxFile = { items: AiManagerInboxItem[] };

async function readInboxFile(): Promise<InboxFile> {
  try {
    const raw = await readFile(inboxPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<InboxFile>;
    return { items: Array.isArray(parsed.items) ? (parsed.items as AiManagerInboxItem[]) : [] };
  } catch {
    return { items: [] };
  }
}

async function writeInboxFile(file: InboxFile) {
  await mkdir(path.dirname(inboxPath), { recursive: true });
  await writeFile(
    inboxPath,
    JSON.stringify({ items: file.items.slice(0, MAX_AI_MANAGER_INBOX_ITEMS) }, null, 2),
    "utf8"
  );
}

function newInboxId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

async function appendInboxItem(
  draft: Omit<
    AiManagerInboxItem,
    | "id"
    | "createdAt"
    | "status"
    | "selectedChoiceId"
    | "ownerReply"
    | "resolvedAt"
    | "resolvedByEmail"
    | "readBy"
    | "choices"
  > & {
    choices?: AiManagerInboxChoice[];
    status?: AiManagerInboxItem["status"];
    id?: string;
  }
): Promise<AiManagerInboxItem> {
  const file = await readInboxFile();
  const item: AiManagerInboxItem = {
    id: draft.id ?? newInboxId(draft.kind === "escalation" ? "aime" : draft.kind === "report" ? "aimr" : "aimn"),
    kind: draft.kind,
    category: draft.category,
    status: draft.status ?? "open",
    createdAt: new Date().toISOString(),
    fromEmail: draft.fromEmail.trim().toLowerCase(),
    fromName: draft.fromName.trim() || "Cozoro AI Manager",
    title: draft.title.trim().slice(0, 200),
    body: draft.body.trim().slice(0, 8000),
    choices: draft.choices ?? [],
    selectedChoiceId: null,
    ownerReply: null,
    resolvedAt: null,
    resolvedByEmail: null,
    relatedReportId: draft.relatedReportId ?? null,
    relatedConversationId: draft.relatedConversationId ?? null,
    relatedEntityType: draft.relatedEntityType ?? null,
    relatedEntityId: draft.relatedEntityId ?? null,
    residentEmail: draft.residentEmail?.trim().toLowerCase() || null,
    readBy: []
  };
  file.items = [item, ...file.items].slice(0, MAX_AI_MANAGER_INBOX_ITEMS);
  await writeInboxFile(file);
  return item;
}

export async function listAiManagerInbox(limit = 80): Promise<AiManagerInboxItem[]> {
  const file = await readInboxFile();
  const take = Math.max(1, Math.min(200, Math.trunc(limit) || 80));
  return file.items.slice(0, take);
}

export async function getAiManagerInboxItem(id: string): Promise<AiManagerInboxItem | null> {
  const file = await readInboxFile();
  return file.items.find((item) => item.id === id) ?? null;
}

export async function getAiManagerInboxSummary(actorEmail: string) {
  await requirePortalRole(
    actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can view the AI Manager inbox."
  );
  const items = await listAiManagerInbox(120);
  return {
    items,
    openCount: countOpenInboxItems(items),
    unreadCount: countUnreadInboxItems(items, actorEmail)
  };
}

export async function postAiManagerReportToInbox(input: {
  fromEmail: string;
  fromName: string;
  reportId: string;
  title: string;
  body: string;
}): Promise<AiManagerInboxItem> {
  return appendInboxItem({
    kind: "report",
    category: "report",
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    title: input.title,
    body: input.body,
    relatedReportId: input.reportId,
    relatedConversationId: null,
    relatedEntityType: "AiManagerReport",
    relatedEntityId: input.reportId,
    residentEmail: null,
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
}): Promise<AiManagerInboxItem | null> {
  const file = await readInboxFile();
  if (input.dedupe !== false) {
    const existing = findOpenEscalationDedupeKey(file.items, {
      category: input.category,
      relatedConversationId: input.relatedConversationId,
      relatedEntityId: input.relatedEntityId
    });
    if (existing) {
      return existing;
    }
  }
  const item = await appendInboxItem({
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
    entityId: item.id,
    entityLabel: input.residentEmail ?? input.category,
    details: `category=${input.category}; title=${input.title.slice(0, 120)}`
  });
  return item;
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
  // email|timestamp|||content — content must match the fines sheet exactly on resolve.
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

async function executeResolvedEscalation(item: AiManagerInboxItem) {
  const choice = item.choices.find((entry) => entry.id === item.selectedChoiceId);
  const action = choice?.action ?? null;

  if (item.category === "fines" && (action === "keep_fine" || action === "cancel_fine")) {
    const entityId = String(item.relatedEntityId ?? "");
    const [meta, contentFromId] = entityId.split("|||");
    const [email, ...timestampParts] = (meta || "").split("|");
    const timestamp = timestampParts.join("|");
    const contentMatch = /^Fine:\s*(.+)$/im.exec(item.body);
    const content = (contentFromId || contentMatch?.[1] || "").trim();
    if (email && timestamp && content) {
      await managerResolveFineDispute({
        email,
        timestamp,
        content,
        decision: action === "cancel_fine" ? "CANCEL_FINE" : "KEEP_FINE",
        note:
          action === "cancel_fine"
            ? `Owner via AI Manager inbox: cancel. ${item.ownerReply ?? ""}`.trim()
            : `Owner via AI Manager inbox: keep. ${item.ownerReply ?? ""}`.trim(),
        operator: item.resolvedByEmail || "owner"
      });
    }
  }

  // Persist a learning-style note on ActionLog for future ticks / Settings feedback.
  await logAction({
    actorEmail: item.resolvedByEmail,
    actorName: "Owner",
    actorRole: "owner",
    action: "ai_manager.inbox.resolve",
    entityType: "AiManagerInbox",
    entityId: item.id,
    entityLabel: item.residentEmail ?? item.category,
    details: summarizeChoiceForLearning(item).slice(0, 1800)
  });

  try {
    const { upsertAiManagerActionFeedback } = await import("./ai-manager-feedback.js");
    // Find the resolve log we just wrote and attach a like + guide from the owner decision.
    const { prisma } = await import("./prisma.js");
    const log = await prisma.actionLog.findFirst({
      where: {
        action: "ai_manager.inbox.resolve",
        entityId: item.id
      },
      orderBy: { createdAt: "desc" }
    });
    if (log && item.resolvedByEmail) {
      await upsertAiManagerActionFeedback({
        actorEmail: item.resolvedByEmail,
        actionLogId: log.id,
        rating: "like",
        guide: summarizeChoiceForLearning(item)
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
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can decide AI Manager escalations."
  );
  const file = await readInboxFile();
  const index = file.items.findIndex((item) => item.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Inbox item not found."), { statusCode: 404 });
  }
  const updated = applyChoiceToInboxItem(file.items[index], {
    choiceId: input.choiceId,
    actorEmail: input.actorEmail,
    ownerReply: input.ownerReply
  });
  file.items[index] = updated;
  await writeInboxFile(file);
  await executeResolvedEscalation(updated);
  return updated;
}

export async function replyAiManagerInboxItem(input: {
  actorEmail: string;
  itemId: string;
  ownerReply: string;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can reply in the AI Manager inbox."
  );
  const file = await readInboxFile();
  const index = file.items.findIndex((item) => item.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Inbox item not found."), { statusCode: 404 });
  }
  const updated = applyFreeTextReplyToInboxItem(file.items[index], {
    actorEmail: input.actorEmail,
    ownerReply: input.ownerReply
  });
  file.items[index] = updated;
  await writeInboxFile(file);
  await executeResolvedEscalation(updated);
  return updated;
}

export async function acknowledgeAiManagerInboxItem(input: {
  actorEmail: string;
  itemId: string;
}) {
  await requirePortalRole(
    input.actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can acknowledge AI Manager inbox items."
  );
  const file = await readInboxFile();
  const index = file.items.findIndex((item) => item.id === input.itemId);
  if (index < 0) {
    throw Object.assign(new Error("Inbox item not found."), { statusCode: 404 });
  }
  const updated = acknowledgeInboxItem(file.items[index], { actorEmail: input.actorEmail });
  file.items[index] = updated;
  await writeInboxFile(file);
  return updated;
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
  file.items = markInboxItemsRead(file.items, input.actorEmail, input.ids);
  await writeInboxFile(file);
  return {
    ok: true,
    unreadCount: countUnreadInboxItems(file.items, input.actorEmail)
  };
}

export async function listOpenAiManagerEscalations(limit = 20): Promise<AiManagerInboxItem[]> {
  const file = await readInboxFile();
  return file.items
    .filter((item) => item.kind === "escalation" && item.status === "open")
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export {
  buildSupportEscalationChoices,
  buildFineDisputeEscalationChoices,
  buildContractEscalationChoices,
  isAmbiguousFineDispute
} from "./ai-manager-inbox-logic.js";

export type {
  AiManagerInboxItem,
  AiManagerInboxChoice,
  AiManagerInboxCategory,
  AiManagerInboxItemKind
} from "./ai-manager-inbox-logic.js";
