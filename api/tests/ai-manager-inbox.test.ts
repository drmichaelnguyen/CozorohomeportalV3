import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyChoiceToInboxItem,
  applyFreeTextReplyToInboxItem,
  buildFineDisputeEscalationChoices,
  buildSupportEscalationChoices,
  countOpenInboxItems,
  countUnreadInboxItems,
  findOpenEscalationDedupeKey,
  isAmbiguousFineDispute,
  markInboxItemsRead,
  type AiManagerInboxItem
} from "../src/ai-manager-inbox-logic.js";

function sampleItem(overrides?: Partial<AiManagerInboxItem>): AiManagerInboxItem {
  return {
    id: "aime-1",
    kind: "escalation",
    category: "support_chat",
    status: "open",
    createdAt: "2026-10-30T12:00:00.000Z",
    fromEmail: "ai.manager@cozorohome.com",
    fromName: "Cozoro AI Manager",
    title: "Need guidance",
    body: "Sensitive thread",
    choices: buildSupportEscalationChoices(),
    selectedChoiceId: null,
    ownerReply: null,
    resolvedAt: null,
    resolvedByEmail: null,
    relatedReportId: null,
    relatedConversationId: "conv-1",
    relatedEntityType: "SupportConversation",
    relatedEntityId: "conv-1",
    residentEmail: "resident@example.com",
    readBy: [],
    ...overrides
  };
}

test("support and fine escalations expose multiple choices", () => {
  assert.ok(buildSupportEscalationChoices().length >= 3);
  assert.ok(buildFineDisputeEscalationChoices().some((c) => c.action === "keep_fine"));
  assert.ok(buildFineDisputeEscalationChoices().some((c) => c.action === "cancel_fine"));
});

test("ambiguous fine disputes escalate; clear paid text does not", () => {
  assert.equal(isAmbiguousFineDispute("I disagree with this fine"), true);
  assert.equal(isAmbiguousFineDispute("already paid last week"), false);
  assert.equal(isAmbiguousFineDispute("trùng phạt"), false);
});

test("owner choice resolves open escalation", () => {
  const resolved = applyChoiceToInboxItem(sampleItem(), {
    choiceId: "handle_myself",
    actorEmail: "owner@cozorohome.com",
    ownerReply: "I will reply tonight",
    nowIso: "2026-10-30T13:00:00.000Z"
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.selectedChoiceId, "handle_myself");
  assert.equal(resolved.ownerReply, "I will reply tonight");
  assert.equal(resolved.resolvedByEmail, "owner@cozorohome.com");
  assert.ok(resolved.readBy.includes("owner@cozorohome.com"));
});

test("free-text reply resolves without a choice", () => {
  const resolved = applyFreeTextReplyToInboxItem(sampleItem(), {
    actorEmail: "admin@cozorohome.com",
    ownerReply: "Refund half and apologize",
    nowIso: "2026-10-30T13:00:00.000Z"
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.selectedChoiceId, null);
  assert.equal(resolved.ownerReply, "Refund half and apologize");
});

test("dedupe finds open escalation by conversation", () => {
  const items = [sampleItem(), sampleItem({ id: "aime-2", status: "resolved" })];
  const found = findOpenEscalationDedupeKey(items, {
    category: "support_chat",
    relatedConversationId: "conv-1"
  });
  assert.equal(found?.id, "aime-1");
});

test("unread counts open reports/escalations until read", () => {
  const items = [
    sampleItem(),
    sampleItem({
      id: "aimr-1",
      kind: "report",
      category: "report",
      choices: [],
      relatedConversationId: null
    })
  ];
  assert.equal(countOpenInboxItems(items), 2);
  assert.equal(countUnreadInboxItems(items, "owner@cozorohome.com"), 2);
  const marked = markInboxItemsRead(items, "owner@cozorohome.com");
  assert.equal(countUnreadInboxItems(marked, "owner@cozorohome.com"), 0);
});
