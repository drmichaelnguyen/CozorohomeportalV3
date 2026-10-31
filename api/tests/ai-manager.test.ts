import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFallbackReportSummary,
  buildReportEmailSubject,
  defaultAiManagerConfig,
  formatOpsSnapshotForPrompt,
  mergeAiManagerConfig,
  resolveReportRecipients,
  shouldSkipQuietTick,
  type AiManagerOpsSnapshot
} from "../src/ai-manager-logic.js";

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
    ...overrides
  };
}

test("mergeAiManagerConfig clamps interval and normalizes emails", () => {
  const merged = mergeAiManagerConfig(defaultAiManagerConfig(), {
    enabled: true,
    mode: "assist",
    intervalHours: 500,
    reportEmails: [" Owner@Example.com ", "bad", "owner@example.com"]
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.mode, "assist");
  assert.equal(merged.intervalHours, 168);
  assert.deepEqual(merged.reportEmails, ["owner@example.com"]);
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

test("quiet ticks skip when nothing is outstanding", () => {
  assert.equal(shouldSkipQuietTick(sampleSnapshot(), false), true);
  assert.equal(shouldSkipQuietTick(sampleSnapshot({ supportUnreadThreads: 1 }), false), false);
  assert.equal(shouldSkipQuietTick(sampleSnapshot(), true), false);
});

test("fallback summary and email subject reflect hot items", () => {
  const clear = sampleSnapshot();
  assert.match(buildFallbackReportSummary(clear), /All clear/i);
  assert.match(buildReportEmailSubject(clear, "2026-10-30T12:00:00.000Z"), /All clear/);

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
    pendingContractApprovals: 1
  });
  const summary = buildFallbackReportSummary(hot);
  assert.match(summary, /support thread/);
  assert.match(summary, /contract approval/);
  assert.match(buildReportEmailSubject(hot, "2026-10-30T12:00:00.000Z"), /need attention/i);
  assert.match(formatOpsSnapshotForPrompt(hot), /Ann/);
});
