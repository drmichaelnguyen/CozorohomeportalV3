/**
 * Pure helpers for the AI Manager ↔ owner/admin chat inbox.
 * Topics are open/closed; replies live inside each topic so the agent has clear context.
 */

export type AiManagerInboxChoice = {
  id: string;
  label: string;
  /** Optional machine hint used when the owner picks this choice. */
  action?: string;
};

export type AiManagerInboxTopicKind = "report" | "escalation";

export type AiManagerInboxTopicStatus = "open" | "closed";

export type AiManagerInboxMessageRole = "ai_manager" | "owner" | "system";

export type AiManagerInboxMessageKind = "opening" | "reply" | "choice" | "close" | "reopen" | "follow_up";

export type AiManagerInboxCategory =
  | "report"
  | "support_chat"
  | "fines"
  | "schedule"
  | "contracts"
  | "ops"
  | "other";

export type AiManagerInboxMessage = {
  id: string;
  role: AiManagerInboxMessageRole;
  kind: AiManagerInboxMessageKind;
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: string;
  choiceId: string | null;
};

export type AiManagerInboxTopic = {
  id: string;
  kind: AiManagerInboxTopicKind;
  category: AiManagerInboxCategory;
  status: AiManagerInboxTopicStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByEmail: string | null;
  fromEmail: string;
  fromName: string;
  choices: AiManagerInboxChoice[];
  selectedChoiceId: string | null;
  relatedReportId: string | null;
  relatedConversationId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  residentEmail: string | null;
  readBy: string[];
  messages: AiManagerInboxMessage[];
};

/** @deprecated Legacy flat item shape — migrated to topics on read. */
export type AiManagerInboxItem = {
  id: string;
  kind: "report" | "escalation" | "owner_note";
  category: AiManagerInboxCategory;
  status: "open" | "resolved" | "acknowledged";
  createdAt: string;
  fromEmail: string;
  fromName: string;
  title: string;
  body: string;
  choices: AiManagerInboxChoice[];
  selectedChoiceId: string | null;
  ownerReply: string | null;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
  relatedReportId: string | null;
  relatedConversationId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  residentEmail: string | null;
  readBy: string[];
};

export type AiManagerInboxItemKind = AiManagerInboxItem["kind"];

export const MAX_AI_MANAGER_INBOX_TOPICS = 200;
export const MAX_AI_MANAGER_INBOX_MESSAGES_PER_TOPIC = 80;
/** @deprecated use MAX_AI_MANAGER_INBOX_TOPICS */
export const MAX_AI_MANAGER_INBOX_ITEMS = MAX_AI_MANAGER_INBOX_TOPICS;

export function normalizeInboxChoiceId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 64);
}

export function buildSupportEscalationChoices(): AiManagerInboxChoice[] {
  return [
    {
      id: "handle_myself",
      label: "I'll handle this thread myself",
      action: "handle_myself"
    },
    {
      id: "ask_more_details",
      label: "Ask the resident for more details first",
      action: "ask_more_details"
    },
    {
      id: "careful_draft",
      label: "Prepare a careful draft; I'll review before sending",
      action: "careful_draft"
    },
    {
      id: "escalate_owner_call",
      label: "This needs a direct owner call / meeting",
      action: "owner_call"
    }
  ];
}

export function buildFineDisputeEscalationChoices(): AiManagerInboxChoice[] {
  return [
    {
      id: "keep_fine",
      label: "Keep the fine",
      action: "keep_fine"
    },
    {
      id: "cancel_fine",
      label: "Cancel / waive the fine",
      action: "cancel_fine"
    },
    {
      id: "need_more_info",
      label: "Need more info — keep this topic open",
      action: "need_more_info"
    }
  ];
}

export function buildContractEscalationChoices(): AiManagerInboxChoice[] {
  return [
    {
      id: "review_queue",
      label: "I'll review it in the contract approvals queue",
      action: "review_queue"
    },
    {
      id: "remind_later",
      label: "Keep topic open and remind me later",
      action: "remind_later"
    }
  ];
}

/** Choices that leave the topic open for more discussion. */
export function choiceKeepsTopicOpen(choice: AiManagerInboxChoice | null | undefined): boolean {
  const action = choice?.action ?? "";
  return action === "need_more_info" || action === "remind_later";
}

export function isAmbiguousFineDispute(disputeText: string): boolean {
  const text = String(disputeText ?? "").trim();
  if (!text) return true;
  if (/đã thanh toán|already paid|duplicate|trùng|nhầm người|wrong person|sai người/i.test(text)) {
    return false;
  }
  if (/đúng|correct|keep|accept fine|đồng ý phạt|ok fine/i.test(text)) {
    return false;
  }
  return true;
}

export function createInboxMessage(input: {
  id: string;
  role: AiManagerInboxMessageRole;
  kind: AiManagerInboxMessageKind;
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt?: string;
  choiceId?: string | null;
}): AiManagerInboxMessage {
  return {
    id: input.id,
    role: input.role,
    kind: input.kind,
    fromEmail: input.fromEmail.trim().toLowerCase(),
    fromName: input.fromName.trim() || (input.role === "owner" ? "Owner" : "Cozoro AI Manager"),
    body: String(input.body ?? "").trim().slice(0, 8000),
    createdAt: input.createdAt ?? new Date().toISOString(),
    choiceId: input.choiceId ?? null
  };
}

export function appendMessageToTopic(
  topic: AiManagerInboxTopic,
  message: AiManagerInboxMessage
): AiManagerInboxTopic {
  const messages = [...topic.messages, message].slice(-MAX_AI_MANAGER_INBOX_MESSAGES_PER_TOPIC);
  return {
    ...topic,
    messages,
    updatedAt: message.createdAt,
    readBy: message.role === "owner" ? topic.readBy : []
  };
}

export function closeTopic(
  topic: AiManagerInboxTopic,
  input: { actorEmail: string; nowIso?: string; systemBody?: string; messageId?: string }
): AiManagerInboxTopic {
  if (topic.status === "closed") return topic;
  const now = input.nowIso ?? new Date().toISOString();
  const email = input.actorEmail.trim().toLowerCase();
  let next = {
    ...topic,
    status: "closed" as const,
    closedAt: now,
    closedByEmail: email,
    updatedAt: now,
    readBy: Array.from(new Set([...topic.readBy.map((v) => v.toLowerCase()), email]))
  };
  if (input.systemBody && input.messageId) {
    next = appendMessageToTopic(
      next,
      createInboxMessage({
        id: input.messageId,
        role: "system",
        kind: "close",
        fromEmail: email,
        fromName: "System",
        body: input.systemBody,
        createdAt: now
      })
    );
  }
  return next;
}

export function reopenTopic(
  topic: AiManagerInboxTopic,
  input: { actorEmail: string; nowIso?: string; systemBody?: string; messageId?: string }
): AiManagerInboxTopic {
  if (topic.status === "open") return topic;
  const now = input.nowIso ?? new Date().toISOString();
  const email = input.actorEmail.trim().toLowerCase();
  let next: AiManagerInboxTopic = {
    ...topic,
    status: "open",
    closedAt: null,
    closedByEmail: null,
    selectedChoiceId: null,
    updatedAt: now,
    readBy: Array.from(new Set([...topic.readBy.map((v) => v.toLowerCase()), email]))
  };
  if (input.systemBody && input.messageId) {
    next = appendMessageToTopic(
      next,
      createInboxMessage({
        id: input.messageId,
        role: "system",
        kind: "reopen",
        fromEmail: email,
        fromName: "System",
        body: input.systemBody,
        createdAt: now
      })
    );
  }
  return next;
}

export function applyChoiceToTopic(
  topic: AiManagerInboxTopic,
  input: {
    choiceId: string;
    actorEmail: string;
    actorName?: string;
    ownerReply?: string | null;
    nowIso?: string;
    choiceMessageId: string;
    replyMessageId?: string;
    closeMessageId?: string;
  }
): AiManagerInboxTopic {
  if (topic.status !== "open") {
    throw new Error("This topic is closed. Reopen it to add a decision.");
  }
  const choiceId = normalizeInboxChoiceId(input.choiceId);
  const choice = topic.choices.find((entry) => entry.id === choiceId);
  if (!choice) {
    throw new Error("That choice is not available on this topic.");
  }
  const now = input.nowIso ?? new Date().toISOString();
  const email = input.actorEmail.trim().toLowerCase();
  const name = input.actorName?.trim() || "Owner";
  const reply = String(input.ownerReply ?? "").trim().slice(0, 2000) || null;

  let next = appendMessageToTopic(
    {
      ...topic,
      selectedChoiceId: choice.id,
      readBy: Array.from(new Set([...topic.readBy.map((v) => v.toLowerCase()), email]))
    },
    createInboxMessage({
      id: input.choiceMessageId,
      role: "owner",
      kind: "choice",
      fromEmail: email,
      fromName: name,
      body: `Chose: ${choice.label}`,
      createdAt: now,
      choiceId: choice.id
    })
  );

  if (reply && input.replyMessageId) {
    next = appendMessageToTopic(
      next,
      createInboxMessage({
        id: input.replyMessageId,
        role: "owner",
        kind: "reply",
        fromEmail: email,
        fromName: name,
        body: reply,
        createdAt: now
      })
    );
  }

  if (!choiceKeepsTopicOpen(choice)) {
    next = closeTopic(next, {
      actorEmail: email,
      nowIso: now,
      messageId: input.closeMessageId,
      systemBody: `Topic closed after owner chose “${choice.label}”.`
    });
  }

  return next;
}

export function applyOwnerReplyToTopic(
  topic: AiManagerInboxTopic,
  input: {
    actorEmail: string;
    actorName?: string;
    ownerReply: string;
    closeTopic?: boolean;
    nowIso?: string;
    replyMessageId: string;
    closeMessageId?: string;
  }
): AiManagerInboxTopic {
  const reply = String(input.ownerReply ?? "").trim().slice(0, 2000);
  if (!reply) {
    throw new Error("Reply text is required.");
  }
  if (topic.status !== "open") {
    throw new Error("This topic is closed. Reopen it to reply.");
  }
  const now = input.nowIso ?? new Date().toISOString();
  const email = input.actorEmail.trim().toLowerCase();
  const name = input.actorName?.trim() || "Owner";

  let next = appendMessageToTopic(
    {
      ...topic,
      readBy: Array.from(new Set([...topic.readBy.map((v) => v.toLowerCase()), email]))
    },
    createInboxMessage({
      id: input.replyMessageId,
      role: "owner",
      kind: "reply",
      fromEmail: email,
      fromName: name,
      body: reply,
      createdAt: now
    })
  );

  if (input.closeTopic) {
    next = closeTopic(next, {
      actorEmail: email,
      nowIso: now,
      messageId: input.closeMessageId,
      systemBody: "Topic closed after owner reply."
    });
  }

  return next;
}

export function countOpenTopics(topics: AiManagerInboxTopic[]): number {
  return topics.filter((topic) => topic.status === "open").length;
}

export function countUnreadTopics(topics: AiManagerInboxTopic[], actorEmail: string): number {
  const email = actorEmail.trim().toLowerCase();
  return topics.filter((topic) => {
    if (topic.status !== "open") return false;
    return !topic.readBy.some((entry) => entry.toLowerCase() === email);
  }).length;
}

export function markTopicsRead(
  topics: AiManagerInboxTopic[],
  actorEmail: string,
  ids?: string[]
): AiManagerInboxTopic[] {
  const email = actorEmail.trim().toLowerCase();
  const wanted = ids?.length ? new Set(ids) : null;
  return topics.map((topic) => {
    if (wanted && !wanted.has(topic.id)) return topic;
    if (topic.readBy.some((entry) => entry.toLowerCase() === email)) return topic;
    return { ...topic, readBy: [...topic.readBy, email] };
  });
}

export function findOpenTopicDedupeKey(
  topics: AiManagerInboxTopic[],
  key: {
    category: AiManagerInboxCategory;
    relatedConversationId?: string | null;
    relatedEntityId?: string | null;
  }
): AiManagerInboxTopic | null {
  return (
    topics.find((topic) => {
      if (topic.status !== "open") return false;
      if (topic.kind !== "escalation") return false;
      if (topic.category !== key.category) return false;
      if (key.relatedConversationId && topic.relatedConversationId === key.relatedConversationId) {
        return true;
      }
      if (key.relatedEntityId && topic.relatedEntityId === key.relatedEntityId) {
        return true;
      }
      return false;
    }) ?? null
  );
}

export function summarizeTopicForLearning(topic: AiManagerInboxTopic): string {
  const choice = topic.choices.find((entry) => entry.id === topic.selectedChoiceId);
  const ownerReplies = topic.messages
    .filter((m) => m.role === "owner" && m.kind === "reply")
    .map((m) => m.body)
    .join(" | ");
  const parts = [
    `Owner decision on AI Manager topic (${topic.category}): ${topic.title}.`,
    `Status: ${topic.status}.`
  ];
  if (choice) {
    parts.push(`Chose: ${choice.label}${choice.action ? ` [${choice.action}]` : ""}.`);
  }
  if (ownerReplies) {
    parts.push(`Owner replies in topic: ${ownerReplies}`);
  }
  return parts.join(" ").slice(0, 1800);
}

/**
 * Inject open-topic owner guidance into AI Manager prompts so it knows what to do.
 */
export function formatOpenTopicsForPrompt(
  topics: AiManagerInboxTopic[],
  options?: { maxChars?: number; maxTopics?: number }
): string {
  const open = topics
    .filter((topic) => topic.status === "open")
    .slice(0, options?.maxTopics ?? 12);
  if (!open.length) return "";
  const maxChars = options?.maxChars ?? 4000;
  const lines: string[] = [
    "Open AI Manager owner topics (follow owner replies inside each topic; do not invent a new decision while a topic is still open):"
  ];
  for (const topic of open) {
    const latestOwner = [...topic.messages].reverse().find((m) => m.role === "owner");
    const latestAi = [...topic.messages].reverse().find((m) => m.role === "ai_manager");
    lines.push(
      [
        `- [${topic.category}] ${topic.title} (id=${topic.id}${
          topic.residentEmail ? `; resident=${topic.residentEmail}` : ""
        })`,
        latestAi ? `  Latest AI: ${latestAi.body.replace(/\s+/g, " ").trim().slice(0, 220)}` : "",
        latestOwner
          ? `  Latest owner: ${latestOwner.body.replace(/\s+/g, " ").trim().slice(0, 280)}`
          : "  Latest owner: (waiting for owner)"
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Migrate legacy flat inbox items into topic threads. */
export function migrateLegacyInboxItems(items: AiManagerInboxItem[]): AiManagerInboxTopic[] {
  return items
    .filter((item) => item.kind === "report" || item.kind === "escalation")
    .map((item) => {
      const status: AiManagerInboxTopicStatus =
        item.status === "open" ? "open" : "closed";
      const messages: AiManagerInboxMessage[] = [
        createInboxMessage({
          id: `${item.id}-opening`,
          role: "ai_manager",
          kind: "opening",
          fromEmail: item.fromEmail,
          fromName: item.fromName,
          body: item.body,
          createdAt: item.createdAt
        })
      ];
      if (item.selectedChoiceId) {
        const choice = item.choices.find((c) => c.id === item.selectedChoiceId);
        messages.push(
          createInboxMessage({
            id: `${item.id}-choice`,
            role: "owner",
            kind: "choice",
            fromEmail: item.resolvedByEmail || "owner",
            fromName: "Owner",
            body: choice ? `Chose: ${choice.label}` : `Chose: ${item.selectedChoiceId}`,
            createdAt: item.resolvedAt || item.createdAt,
            choiceId: item.selectedChoiceId
          })
        );
      }
      if (item.ownerReply?.trim()) {
        messages.push(
          createInboxMessage({
            id: `${item.id}-reply`,
            role: "owner",
            kind: "reply",
            fromEmail: item.resolvedByEmail || "owner",
            fromName: "Owner",
            body: item.ownerReply,
            createdAt: item.resolvedAt || item.createdAt
          })
        );
      }
      if (status === "closed") {
        messages.push(
          createInboxMessage({
            id: `${item.id}-close`,
            role: "system",
            kind: "close",
            fromEmail: item.resolvedByEmail || "system",
            fromName: "System",
            body: "Topic closed.",
            createdAt: item.resolvedAt || item.createdAt
          })
        );
      }
      return {
        id: item.id,
        kind: item.kind === "report" ? "report" : "escalation",
        category: item.category,
        status,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.resolvedAt || item.createdAt,
        closedAt: status === "closed" ? item.resolvedAt || item.createdAt : null,
        closedByEmail: status === "closed" ? item.resolvedByEmail : null,
        fromEmail: item.fromEmail,
        fromName: item.fromName,
        choices: item.choices ?? [],
        selectedChoiceId: item.selectedChoiceId,
        relatedReportId: item.relatedReportId,
        relatedConversationId: item.relatedConversationId,
        relatedEntityType: item.relatedEntityType,
        relatedEntityId: item.relatedEntityId,
        residentEmail: item.residentEmail,
        readBy: item.readBy ?? [],
        messages
      } satisfies AiManagerInboxTopic;
    });
}

export function isTopicRecord(value: unknown): value is AiManagerInboxTopic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.messages) && typeof row.title === "string" && typeof row.status === "string";
}

// ---- Backward-compatible aliases used by older tests / imports ----

export function countOpenInboxItems(topics: AiManagerInboxTopic[]): number {
  return countOpenTopics(topics);
}

export function countUnreadInboxItems(topics: AiManagerInboxTopic[], actorEmail: string): number {
  return countUnreadTopics(topics, actorEmail);
}

export function markInboxItemsRead(
  topics: AiManagerInboxTopic[],
  actorEmail: string,
  ids?: string[]
): AiManagerInboxTopic[] {
  return markTopicsRead(topics, actorEmail, ids);
}

export function findOpenEscalationDedupeKey(
  topics: AiManagerInboxTopic[],
  key: {
    category: AiManagerInboxCategory;
    relatedConversationId?: string | null;
    relatedEntityId?: string | null;
  }
): AiManagerInboxTopic | null {
  return findOpenTopicDedupeKey(topics, key);
}

export function applyChoiceToInboxItem(
  topic: AiManagerInboxTopic,
  input: {
    choiceId: string;
    actorEmail: string;
    ownerReply?: string | null;
    nowIso?: string;
  }
): AiManagerInboxTopic {
  return applyChoiceToTopic(topic, {
    ...input,
    choiceMessageId: `choice-${Date.now().toString(36)}`,
    replyMessageId: input.ownerReply ? `reply-${Date.now().toString(36)}` : undefined,
    closeMessageId: `close-${Date.now().toString(36)}`
  });
}

export function applyFreeTextReplyToInboxItem(
  topic: AiManagerInboxTopic,
  input: {
    actorEmail: string;
    ownerReply: string;
    nowIso?: string;
  }
): AiManagerInboxTopic {
  // Legacy behavior closed on free-text; new default keeps open unless closeTopic.
  return applyOwnerReplyToTopic(topic, {
    actorEmail: input.actorEmail,
    ownerReply: input.ownerReply,
    nowIso: input.nowIso,
    closeTopic: true,
    replyMessageId: `reply-${Date.now().toString(36)}`,
    closeMessageId: `close-${Date.now().toString(36)}`
  });
}

export function acknowledgeInboxItem(
  topic: AiManagerInboxTopic,
  input: { actorEmail: string; nowIso?: string }
): AiManagerInboxTopic {
  return closeTopic(topic, {
    actorEmail: input.actorEmail,
    nowIso: input.nowIso,
    messageId: `close-${Date.now().toString(36)}`,
    systemBody: "Topic acknowledged / closed."
  });
}

export function summarizeChoiceForLearning(topic: AiManagerInboxTopic): string {
  return summarizeTopicForLearning(topic);
}
