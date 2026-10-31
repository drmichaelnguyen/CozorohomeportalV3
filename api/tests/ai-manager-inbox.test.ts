import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyChoiceToTopic,
  applyOwnerReplyToTopic,
  buildFineDisputeEscalationChoices,
  buildSupportEscalationChoices,
  choiceKeepsTopicOpen,
  closeTopic,
  countOpenTopics,
  countUnreadTopics,
  createInboxMessage,
  findOpenTopicDedupeKey,
  formatOpenTopicsForPrompt,
  isAmbiguousFineDispute,
  markTopicsRead,
  migrateLegacyInboxItems,
  reopenTopic,
  type AiManagerInboxItem,
  type AiManagerInboxTopic
} from "../src/ai-manager-inbox-logic.js";

function sampleTopic(overrides?: Partial<AiManagerInboxTopic>): AiManagerInboxTopic {
  const opening = createInboxMessage({
    id: "msg-1",
    role: "ai_manager",
    kind: "opening",
    fromEmail: "ai.manager@cozorohome.com",
    fromName: "Cozoro AI Manager",
    body: "Sensitive thread — what should I do?",
    createdAt: "2026-10-30T12:00:00.000Z"
  });
  return {
    id: "aime-1",
    kind: "escalation",
    category: "support_chat",
    status: "open",
    title: "Need guidance",
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-10-30T12:00:00.000Z",
    closedAt: null,
    closedByEmail: null,
    fromEmail: "ai.manager@cozorohome.com",
    fromName: "Cozoro AI Manager",
    choices: buildSupportEscalationChoices(),
    selectedChoiceId: null,
    relatedReportId: null,
    relatedConversationId: "conv-1",
    relatedEntityType: "SupportConversation",
    relatedEntityId: "conv-1",
    residentEmail: "resident@example.com",
    readBy: [],
    messages: [opening],
    ...overrides
  };
}

test("support and fine escalations expose multiple choices", () => {
  assert.ok(buildSupportEscalationChoices().length >= 3);
  assert.ok(buildFineDisputeEscalationChoices().some((c) => c.action === "keep_fine"));
  assert.ok(choiceKeepsTopicOpen({ id: "need_more_info", label: "x", action: "need_more_info" }));
  assert.equal(choiceKeepsTopicOpen({ id: "keep_fine", label: "x", action: "keep_fine" }), false);
});

test("ambiguous fine disputes escalate; clear paid text does not", () => {
  assert.equal(isAmbiguousFineDispute("I disagree with this fine"), true);
  assert.equal(isAmbiguousFineDispute("already paid last week"), false);
});

test("owner choice posts into topic and closes it", () => {
  const resolved = applyChoiceToTopic(sampleTopic(), {
    choiceId: "handle_myself",
    actorEmail: "owner@cozorohome.com",
    ownerReply: "I will reply tonight",
    nowIso: "2026-10-30T13:00:00.000Z",
    choiceMessageId: "msg-choice",
    replyMessageId: "msg-reply",
    closeMessageId: "msg-close"
  });
  assert.equal(resolved.status, "closed");
  assert.equal(resolved.selectedChoiceId, "handle_myself");
  assert.ok(resolved.messages.some((m) => m.kind === "choice"));
  assert.ok(resolved.messages.some((m) => m.kind === "reply" && m.body.includes("tonight")));
  assert.ok(resolved.messages.some((m) => m.kind === "close"));
});

test("owner reply stays inside open topic unless closeTopic", () => {
  const open = applyOwnerReplyToTopic(sampleTopic(), {
    actorEmail: "admin@cozorohome.com",
    ownerReply: "Ask for ID scan first",
    closeTopic: false,
    nowIso: "2026-10-30T13:00:00.000Z",
    replyMessageId: "msg-reply"
  });
  assert.equal(open.status, "open");
  assert.equal(open.messages.filter((m) => m.role === "owner").length, 1);

  const closed = applyOwnerReplyToTopic(sampleTopic(), {
    actorEmail: "admin@cozorohome.com",
    ownerReply: "Done — close this",
    closeTopic: true,
    nowIso: "2026-10-30T13:00:00.000Z",
    replyMessageId: "msg-reply",
    closeMessageId: "msg-close"
  });
  assert.equal(closed.status, "closed");
});

test("close and reopen topic", () => {
  const closed = closeTopic(sampleTopic(), {
    actorEmail: "owner@cozorohome.com",
    nowIso: "2026-10-30T14:00:00.000Z",
    messageId: "msg-close",
    systemBody: "Closed"
  });
  assert.equal(closed.status, "closed");
  const opened = reopenTopic(closed, {
    actorEmail: "owner@cozorohome.com",
    nowIso: "2026-10-30T15:00:00.000Z",
    messageId: "msg-reopen",
    systemBody: "Reopened"
  });
  assert.equal(opened.status, "open");
  assert.ok(opened.messages.some((m) => m.kind === "reopen"));
});

test("dedupe finds open topic by conversation", () => {
  const topics = [sampleTopic(), sampleTopic({ id: "aime-2", status: "closed" })];
  const found = findOpenTopicDedupeKey(topics, {
    category: "support_chat",
    relatedConversationId: "conv-1"
  });
  assert.equal(found?.id, "aime-1");
});

test("open topic prompt includes owner replies for the model", () => {
  const withReply = applyOwnerReplyToTopic(sampleTopic(), {
    actorEmail: "owner@cozorohome.com",
    ownerReply: "Do not auto-refund; draft a careful apology",
    closeTopic: false,
    replyMessageId: "msg-reply",
    nowIso: "2026-10-30T13:00:00.000Z"
  });
  const text = formatOpenTopicsForPrompt([withReply]);
  assert.match(text, /Open AI Manager owner topics/);
  assert.match(text, /careful apology/);
  assert.match(text, /aime-1/);
});

test("unread counts open topics until read", () => {
  const topics = [
    sampleTopic(),
    sampleTopic({
      id: "aimr-1",
      kind: "report",
      category: "report",
      choices: [],
      relatedConversationId: null
    })
  ];
  assert.equal(countOpenTopics(topics), 2);
  assert.equal(countUnreadTopics(topics, "owner@cozorohome.com"), 2);
  const marked = markTopicsRead(topics, "owner@cozorohome.com");
  assert.equal(countUnreadTopics(marked, "owner@cozorohome.com"), 0);
});

test("legacy flat items migrate into topics with messages", () => {
  const legacy: AiManagerInboxItem[] = [
    {
      id: "aime-old",
      kind: "escalation",
      category: "fines",
      status: "resolved",
      createdAt: "2026-10-30T10:00:00.000Z",
      fromEmail: "ai.manager@cozorohome.com",
      fromName: "AI",
      title: "Fine dispute",
      body: "Please decide",
      choices: buildFineDisputeEscalationChoices(),
      selectedChoiceId: "keep_fine",
      ownerReply: "Keep it",
      resolvedAt: "2026-10-30T11:00:00.000Z",
      resolvedByEmail: "owner@cozorohome.com",
      relatedReportId: null,
      relatedConversationId: null,
      relatedEntityType: "FineDispute",
      relatedEntityId: "a|b|||c",
      residentEmail: "r@x.com",
      readBy: ["owner@cozorohome.com"]
    }
  ];
  const topics = migrateLegacyInboxItems(legacy);
  assert.equal(topics.length, 1);
  assert.equal(topics[0]!.status, "closed");
  assert.ok(topics[0]!.messages.some((m) => m.kind === "opening"));
  assert.ok(topics[0]!.messages.some((m) => m.kind === "choice"));
  assert.ok(topics[0]!.messages.some((m) => m.kind === "reply"));
});
