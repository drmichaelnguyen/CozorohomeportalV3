import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFallbackReportSummary,
  buildReportChatBody,
  buildReportChatTitle,
  defaultAiManagerConfig,
  formatOpsSnapshotForPrompt,
  disputeDecisionFromGuides,
  formatLearningGuidesForPrompt,
  inferAiManagerCapabilityFromAction,
  mergeAiManagerConfig,
  normalizeAiManagerCapabilities,
  resolveReportRecipients,
  shouldEscalateSupportInsteadOfAutoReply,
  shouldSkipQuietTick,
  type AiManagerLearningGuideLike,
  type AiManagerOpsSnapshot,
  type AiManagerReport
} from "../src/ai-manager-logic.js";
import {
  AI_MANAGER_USAGE_CATEGORIES,
  AI_MANAGER_USAGE_FEATURE_LABELS,
  AI_MANAGER_USAGE_FEATURES,
  isAiManagerUsageFeature
} from "../src/ai-manager-usage-meta.js";

function sampleSnapshot(overrides?: Partial<AiManagerOpsSnapshot>): AiManagerOpsSnapshot {
  return {
    generatedAt: "2026-10-30T12:00:00.000Z",
    supportUnreadThreads: 0,
    supportUnreadMessages: 0,
    supportHighlights: [],
    pendingContractApprovals: 0,
    pendingContractHighlights: [],
    cleaningPendingAudit: 0,
    cleaningOverdueAssigned: 0,
    hostelPendingBookings: 0,
    acComfortAlerts: 0,
    openFineDisputes: 0,
    ...overrides
  };
}

test("mergeAiManagerConfig clamps interval and normalizes emails + capabilities", () => {
  const merged = mergeAiManagerConfig(defaultAiManagerConfig(), {
    enabled: true,
    mode: "assist",
    intervalHours: 500,
    reportEmails: [" Owner@Example.com ", "bad", "owner@example.com"],
    capabilities: { answerChat: true, manageFines: true }
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.mode, "assist");
  assert.equal(merged.intervalHours, 168);
  assert.deepEqual(merged.reportEmails, ["owner@example.com"]);
  assert.equal(merged.capabilities.answerChat, true);
  assert.equal(merged.capabilities.manageFines, true);
  assert.equal(merged.capabilities.ownerReports, true);
  assert.equal(merged.capabilities.scheduleAssignment, false);
});

test("normalizeAiManagerCapabilities fills defaults", () => {
  assert.deepEqual(normalizeAiManagerCapabilities(undefined), {
    ownerReports: true,
    answerChat: false,
    manageFines: false,
    scheduleAssignment: false
  });
  assert.equal(normalizeAiManagerCapabilities({ scheduleAssignment: true }).scheduleAssignment, true);
});

test("resolveReportRecipients falls back to owners", () => {
  const config = defaultAiManagerConfig({ reportEmails: [] });
  assert.deepEqual(resolveReportRecipients(config, ["dr.trongto@gmail.com"]), ["dr.trongto@gmail.com"]);
  assert.deepEqual(
    resolveReportRecipients(defaultAiManagerConfig({ reportEmails: ["ops@cozorohome.com"] }), [
      "dr.trongto@gmail.com"
    ]),
    ["ops@cozorohome.com"]
  );
});

test("quiet ticks respect capability-driven work", () => {
  assert.equal(shouldSkipQuietTick(sampleSnapshot(), false), true);
  assert.equal(shouldSkipQuietTick(sampleSnapshot({ supportUnreadThreads: 1 }), false), false);
  assert.equal(shouldSkipQuietTick(sampleSnapshot(), true), false);
  assert.equal(
    shouldSkipQuietTick(sampleSnapshot(), false, {
      ownerReports: true,
      answerChat: false,
      manageFines: false,
      scheduleAssignment: true
    }),
    false
  );
  assert.equal(
    shouldSkipQuietTick(sampleSnapshot({ supportUnreadThreads: 2 }), false, {
      ownerReports: true,
      answerChat: true,
      manageFines: false,
      scheduleAssignment: false
    }),
    false
  );
});

test("fallback summary and chat title/body reflect hot items", () => {
  const clear = sampleSnapshot();
  assert.match(buildFallbackReportSummary(clear), /All clear/i);
  assert.match(buildReportChatTitle(clear, "2026-10-30T12:00:00.000Z"), /all clear/i);

  const hot = sampleSnapshot({
    supportUnreadThreads: 2,
    supportHighlights: [
      {
        conversationId: "c1",
        residentEmail: "a@example.com",
        residentName: "Ann",
        unreadCount: 2,
        latestBody: "Need help with laundry"
      }
    ],
    pendingContractApprovals: 1,
    openFineDisputes: 1
  });
  const summary = buildFallbackReportSummary(hot);
  assert.match(summary, /support thread/);
  assert.match(summary, /contract approval/);
  assert.match(summary, /fine dispute/);
  assert.match(buildReportChatTitle(hot, "2026-10-30T12:00:00.000Z"), /need attention/i);
  assert.match(formatOpsSnapshotForPrompt(hot), /Ann/);

  const report: AiManagerReport = {
    id: "aimgr-test",
    createdAt: "2026-10-30T12:00:00.000Z",
    trigger: "manual",
    mode: "report_only",
    capabilities: {
      ownerReports: true,
      answerChat: false,
      manageFines: false,
      scheduleAssignment: false
    },
    snapshot: hot,
    summaryText: summary,
    suggestedDrafts: [],
    actionsTaken: [],
    chatConversationId: null,
    chatMessageId: null,
    chatError: null
  };
  const body = buildReportChatBody(report);
  assert.match(body, /need attention/i);
  assert.match(body, /Report id: aimgr-test/);
  assert.match(body, /Open Settings → AI Manager/);
});

test("sensitive chat topics escalate instead of auto-reply", () => {
  assert.equal(shouldEscalateSupportInsteadOfAutoReply("Can you help book laundry?"), false);
  assert.equal(shouldEscalateSupportInsteadOfAutoReply("I want to terminate contract and refund deposit"), true);
  assert.equal(shouldEscalateSupportInsteadOfAutoReply("Xin gặp owner về hoàn cọc"), true);
});

test("infer capability from action names", () => {
  assert.equal(inferAiManagerCapabilityFromAction("ai_manager.chat.reply"), "answerChat");
  assert.equal(inferAiManagerCapabilityFromAction("ai_manager.fines.dispute_keep"), "manageFines");
  assert.equal(inferAiManagerCapabilityFromAction("ai_manager.schedule.assign"), "scheduleAssignment");
  assert.equal(inferAiManagerCapabilityFromAction("ai_manager.tick.report"), "ownerReports");
});

test("AI Manager usage features map 1:1 to capability categories", () => {
  assert.deepEqual([...AI_MANAGER_USAGE_FEATURES], [
    "ai_manager_report",
    "ai_manager_chat_reply",
    "ai_manager_fines",
    "ai_manager_schedule"
  ]);
  assert.equal(isAiManagerUsageFeature("ai_manager_chat_reply"), true);
  assert.equal(isAiManagerUsageFeature("manager_support_reply_draft"), false);
  for (const feature of AI_MANAGER_USAGE_FEATURES) {
    assert.ok(AI_MANAGER_USAGE_FEATURE_LABELS[feature].includes("AI Manager"));
    const category = AI_MANAGER_USAGE_CATEGORIES[feature];
    assert.ok(category.capability);
    assert.ok(category.label);
  }
  assert.equal(AI_MANAGER_USAGE_CATEGORIES.ai_manager_report.capability, "ownerReports");
  assert.equal(AI_MANAGER_USAGE_CATEGORIES.ai_manager_chat_reply.capability, "answerChat");
  assert.equal(AI_MANAGER_USAGE_CATEGORIES.ai_manager_fines.capability, "manageFines");
  assert.equal(AI_MANAGER_USAGE_CATEGORIES.ai_manager_schedule.capability, "scheduleAssignment");
});

test("learning guides format and dispute decisions", () => {
  const guides: AiManagerLearningGuideLike[] = [
    {
      action: "ai_manager.fines.dispute_cancel",
      rating: "dislike",
      guide: "Do not cancel cleaning fines unless the resident already paid.",
      actionDetails: null,
      entityLabel: null
    },
    {
      action: "ai_manager.fines.dispute_cancel",
      rating: "like",
      guide: "Cancel fine when already paid or duplicate ticket.",
      actionDetails: null,
      entityLabel: null
    }
  ];
  assert.match(formatLearningGuidesForPrompt(guides), /Owner learning guides/);
  assert.equal(disputeDecisionFromGuides("I already paid this fine", guides), "CANCEL_FINE");
  assert.equal(
    disputeDecisionFromGuides("I disagree with the amount", [
      {
        ...guides[0]!,
        rating: "like",
        guide: "Always keep disputed cleaning fines unless clearly paid"
      }
    ]),
    "KEEP_FINE"
  );
});
