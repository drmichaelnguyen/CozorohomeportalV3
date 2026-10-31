/**
 * Pure helpers for the AI Manager ↔ owner/admin chat inbox (reports + escalations).
 */

export type AiManagerInboxChoice = {
  id: string;
  label: string;
  /** Optional machine hint used when the owner picks this choice. */
  action?: string;
};

export type AiManagerInboxItemKind = "report" | "escalation" | "owner_note";

export type AiManagerInboxItemStatus = "open" | "resolved" | "acknowledged";

export type AiManagerInboxCategory =
  | "report"
  | "support_chat"
  | "fines"
  | "schedule"
  | "contracts"
  | "ops"
  | "other";

export type AiManagerInboxItem = {
  id: string;
  kind: AiManagerInboxItemKind;
  category: AiManagerInboxCategory;
  status: AiManagerInboxItemStatus;
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

export const MAX_AI_MANAGER_INBOX_ITEMS = 200;

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
      label: "Need more info — I'll follow up with the resident",
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
      label: "Remind me again on the next report",
      action: "remind_later"
    }
  ];
}

export function isAmbiguousFineDispute(disputeText: string): boolean {
  const text = String(disputeText ?? "").trim();
  if (!text) return true;
  // Clear cancel signals — not ambiguous.
  if (/đã thanh toán|already paid|duplicate|trùng|nhầm người|wrong person|sai người/i.test(text)) {
    return false;
  }
  // Explicit keep / accept — not ambiguous.
  if (/đúng|correct|keep|accept fine|đồng ý phạt|ok fine/i.test(text)) {
    return false;
  }
  return true;
}

export function countOpenInboxItems(items: AiManagerInboxItem[]): number {
  return items.filter((item) => item.status === "open").length;
}

export function countUnreadInboxItems(items: AiManagerInboxItem[], actorEmail: string): number {
  const email = actorEmail.trim().toLowerCase();
  return items.filter((item) => {
    if (item.status !== "open" && item.kind === "escalation") return false;
    if (item.kind === "owner_note") return false;
    if (item.readBy.some((entry) => entry.toLowerCase() === email)) return false;
    // Open escalations always count; reports count until acknowledged/read.
    if (item.kind === "escalation") return item.status === "open";
    if (item.kind === "report") return item.status === "open";
    return false;
  }).length;
}

export function applyChoiceToInboxItem(
  item: AiManagerInboxItem,
  input: {
    choiceId: string;
    actorEmail: string;
    ownerReply?: string | null;
    nowIso?: string;
  }
): AiManagerInboxItem {
  const choiceId = normalizeInboxChoiceId(input.choiceId);
  const choice = item.choices.find((entry) => entry.id === choiceId);
  if (!choice) {
    throw new Error("That choice is not available on this escalation.");
  }
  if (item.status !== "open") {
    throw new Error("This escalation is already resolved.");
  }
  const now = input.nowIso ?? new Date().toISOString();
  const reply = String(input.ownerReply ?? "").trim().slice(0, 2000) || null;
  return {
    ...item,
    status: "resolved",
    selectedChoiceId: choice.id,
    ownerReply: reply,
    resolvedAt: now,
    resolvedByEmail: input.actorEmail.trim().toLowerCase(),
    readBy: Array.from(
      new Set([...item.readBy.map((v) => v.toLowerCase()), input.actorEmail.trim().toLowerCase()])
    )
  };
}

export function applyFreeTextReplyToInboxItem(
  item: AiManagerInboxItem,
  input: {
    actorEmail: string;
    ownerReply: string;
    nowIso?: string;
  }
): AiManagerInboxItem {
  const reply = String(input.ownerReply ?? "").trim().slice(0, 2000);
  if (!reply) {
    throw new Error("Reply text is required.");
  }
  if (item.status !== "open") {
    throw new Error("This item is already resolved.");
  }
  const now = input.nowIso ?? new Date().toISOString();
  return {
    ...item,
    status: "resolved",
    selectedChoiceId: null,
    ownerReply: reply,
    resolvedAt: now,
    resolvedByEmail: input.actorEmail.trim().toLowerCase(),
    readBy: Array.from(
      new Set([...item.readBy.map((v) => v.toLowerCase()), input.actorEmail.trim().toLowerCase()])
    )
  };
}

export function acknowledgeInboxItem(
  item: AiManagerInboxItem,
  input: { actorEmail: string; nowIso?: string }
): AiManagerInboxItem {
  const now = input.nowIso ?? new Date().toISOString();
  const email = input.actorEmail.trim().toLowerCase();
  return {
    ...item,
    status: item.kind === "report" ? "acknowledged" : item.status,
    resolvedAt: item.kind === "report" ? now : item.resolvedAt,
    resolvedByEmail: item.kind === "report" ? email : item.resolvedByEmail,
    readBy: Array.from(new Set([...item.readBy.map((v) => v.toLowerCase()), email]))
  };
}

export function markInboxItemsRead(
  items: AiManagerInboxItem[],
  actorEmail: string,
  ids?: string[]
): AiManagerInboxItem[] {
  const email = actorEmail.trim().toLowerCase();
  const wanted = ids?.length ? new Set(ids) : null;
  return items.map((item) => {
    if (wanted && !wanted.has(item.id)) return item;
    if (item.readBy.some((entry) => entry.toLowerCase() === email)) return item;
    return { ...item, readBy: [...item.readBy, email] };
  });
}

export function findOpenEscalationDedupeKey(
  items: AiManagerInboxItem[],
  key: {
    category: AiManagerInboxCategory;
    relatedConversationId?: string | null;
    relatedEntityId?: string | null;
  }
): AiManagerInboxItem | null {
  return (
    items.find((item) => {
      if (item.kind !== "escalation" || item.status !== "open") return false;
      if (item.category !== key.category) return false;
      if (key.relatedConversationId && item.relatedConversationId === key.relatedConversationId) {
        return true;
      }
      if (key.relatedEntityId && item.relatedEntityId === key.relatedEntityId) {
        return true;
      }
      return false;
    }) ?? null
  );
}

export function summarizeChoiceForLearning(item: AiManagerInboxItem): string {
  const choice = item.choices.find((entry) => entry.id === item.selectedChoiceId);
  const parts = [
    `Owner decision on AI Manager escalation (${item.category}): ${item.title}.`
  ];
  if (choice) {
    parts.push(`Chose: ${choice.label}${choice.action ? ` [${choice.action}]` : ""}.`);
  }
  if (item.ownerReply?.trim()) {
    parts.push(`Owner note: ${item.ownerReply.trim()}`);
  }
  return parts.join(" ").slice(0, 1800);
}
