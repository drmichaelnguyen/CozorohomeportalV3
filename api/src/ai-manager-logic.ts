/**
 * Pure helpers for the Cozoro AI Manager agent (testable without DB / LLM).
 */

export type AiManagerMode = "report_only" | "assist";

export type AiManagerFeedbackRating = "like" | "dislike";

export type AiManagerFeedbackCapability =
  | "answerChat"
  | "manageFines"
  | "scheduleAssignment"
  | "ownerReports"
  | "other";

/** Owner-controlled functions the AI Manager may perform on a tick. */
export type AiManagerCapabilities = {
  /** Post ops digests into manager Messages chat (default on). */
  ownerReports: boolean;
  /** Auto-reply to personal support threads in scope. */
  answerChat: boolean;
  /** Create missed-cleaning fines and resolve open fine disputes. */
  manageFines: boolean;
  /** Fill open cleaning schedule slots via the auto-assign jobs. */
  scheduleAssignment: boolean;
};

export const DEFAULT_AI_MANAGER_CAPABILITIES: AiManagerCapabilities = {
  ownerReports: true,
  answerChat: false,
  manageFines: false,
  scheduleAssignment: false
};

export const AI_MANAGER_CAPABILITY_KEYS = [
  "ownerReports",
  "answerChat",
  "manageFines",
  "scheduleAssignment"
] as const satisfies ReadonlyArray<keyof AiManagerCapabilities>;

export type AiManagerConfig = {
  enabled: boolean;
  email: string;
  displayName: string;
  mode: AiManagerMode;
  capabilities: AiManagerCapabilities;
  reportEmails: string[];
  intervalHours: number;
  accountProvisionedAt: string | null;
  lastTickAt: string | null;
  lastReportId: string | null;
  lastError: string | null;
};

export type AiManagerOpsSnapshot = {
  generatedAt: string;
  supportUnreadThreads: number;
  supportUnreadMessages: number;
  supportHighlights: Array<{
    conversationId: string;
    residentEmail: string;
    residentName: string | null;
    unreadCount: number;
    latestBody: string;
  }>;
  pendingContractApprovals: number;
  pendingContractHighlights: Array<{
    id: string;
    type: string;
    email: string;
    summary: string;
  }>;
  cleaningPendingAudit: number;
  cleaningOverdueAssigned: number;
  hostelPendingBookings: number;
  acComfortAlerts: number;
  openFineDisputes: number;
};

export type AiManagerSuggestedDraft = {
  conversationId: string;
  residentEmail: string;
  draft: string;
};

export type AiManagerActionResult = {
  capability: keyof AiManagerCapabilities;
  ok: boolean;
  summary: string;
  count?: number;
};

export type AiManagerReport = {
  id: string;
  createdAt: string;
  trigger: "startup" | "interval" | "manual";
  mode: AiManagerMode;
  capabilities: AiManagerCapabilities;
  snapshot: AiManagerOpsSnapshot;
  summaryText: string;
  suggestedDrafts: AiManagerSuggestedDraft[];
  actionsTaken: AiManagerActionResult[];
  /** Manager Messages conversation where the digest was posted. */
  chatConversationId: string | null;
  chatMessageId: string | null;
  chatError: string | null;
  /** @deprecated Legacy email delivery — kept so old report JSON still loads. */
  emailedTo?: string[];
  /** @deprecated Legacy email delivery — kept so old report JSON still loads. */
  emailErrors?: string[];
};

export const DEFAULT_AI_MANAGER_EMAIL = "ai.manager@cozorohome.com";
export const DEFAULT_AI_MANAGER_NAME = "Cozoro AI Manager";
export const DEFAULT_AI_MANAGER_INTERVAL_HOURS = 6;
export const MAX_AI_MANAGER_REPORTS = 40;

export function normalizeEmailList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const email = value.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

export function parseAiManagerMode(value: unknown): AiManagerMode {
  return value === "assist" ? "assist" : "report_only";
}

export function normalizeAiManagerCapabilities(value: unknown): AiManagerCapabilities {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ownerReports:
      typeof source.ownerReports === "boolean"
        ? source.ownerReports
        : DEFAULT_AI_MANAGER_CAPABILITIES.ownerReports,
    answerChat:
      typeof source.answerChat === "boolean"
        ? source.answerChat
        : DEFAULT_AI_MANAGER_CAPABILITIES.answerChat,
    manageFines:
      typeof source.manageFines === "boolean"
        ? source.manageFines
        : DEFAULT_AI_MANAGER_CAPABILITIES.manageFines,
    scheduleAssignment:
      typeof source.scheduleAssignment === "boolean"
        ? source.scheduleAssignment
        : DEFAULT_AI_MANAGER_CAPABILITIES.scheduleAssignment
  };
}

export function clampIntervalHours(value: unknown, fallback = DEFAULT_AI_MANAGER_INTERVAL_HOURS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(168, Math.max(1, Math.round(n)));
}

export function defaultAiManagerConfig(overrides?: Partial<AiManagerConfig>): AiManagerConfig {
  const base: AiManagerConfig = {
    enabled: false,
    email: DEFAULT_AI_MANAGER_EMAIL,
    displayName: DEFAULT_AI_MANAGER_NAME,
    mode: "report_only",
    capabilities: { ...DEFAULT_AI_MANAGER_CAPABILITIES },
    reportEmails: [],
    intervalHours: DEFAULT_AI_MANAGER_INTERVAL_HOURS,
    accountProvisionedAt: null,
    lastTickAt: null,
    lastReportId: null,
    lastError: null
  };
  const merged = { ...base, ...overrides };
  merged.capabilities = normalizeAiManagerCapabilities(
    overrides?.capabilities ?? base.capabilities
  );
  return merged;
}

export function mergeAiManagerConfig(
  current: AiManagerConfig,
  patch: Partial<{
    enabled: boolean;
    email: string;
    displayName: string;
    mode: AiManagerMode | string;
    capabilities: Partial<AiManagerCapabilities> | AiManagerCapabilities;
    reportEmails: string[];
    intervalHours: number;
  }>
): AiManagerConfig {
  const next = { ...current, capabilities: { ...current.capabilities } };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.email === "string" && patch.email.trim().includes("@")) {
    next.email = patch.email.trim().toLowerCase();
  }
  if (typeof patch.displayName === "string" && patch.displayName.trim()) {
    next.displayName = patch.displayName.trim().slice(0, 80);
  }
  if (patch.mode != null) next.mode = parseAiManagerMode(patch.mode);
  if (patch.capabilities != null) {
    next.capabilities = normalizeAiManagerCapabilities({
      ...next.capabilities,
      ...patch.capabilities
    });
  }
  if (patch.reportEmails != null) next.reportEmails = normalizeEmailList(patch.reportEmails);
  if (patch.intervalHours != null) next.intervalHours = clampIntervalHours(patch.intervalHours, current.intervalHours);
  return next;
}

export function resolveReportRecipients(config: AiManagerConfig, fallbackOwnerEmails: string[]): string[] {
  const fromConfig = normalizeEmailList(config.reportEmails);
  if (fromConfig.length > 0) return fromConfig;
  return normalizeEmailList(fallbackOwnerEmails);
}

export function formatCapabilitiesForLog(capabilities: AiManagerCapabilities): string {
  return AI_MANAGER_CAPABILITY_KEYS.map((key) => `${key}=${capabilities[key] ? "on" : "off"}`).join(
    "; "
  );
}

export function anyActionCapabilityEnabled(capabilities: AiManagerCapabilities): boolean {
  return capabilities.answerChat || capabilities.manageFines || capabilities.scheduleAssignment;
}

export function formatOpsSnapshotForPrompt(snapshot: AiManagerOpsSnapshot): string {
  const lines: string[] = [
    `Generated at: ${snapshot.generatedAt}`,
    `Support: ${snapshot.supportUnreadThreads} unread thread(s), ${snapshot.supportUnreadMessages} unread resident message(s)`,
    `Pending contract approvals: ${snapshot.pendingContractApprovals}`,
    `Cleaning awaiting photo audit: ${snapshot.cleaningPendingAudit}`,
    `Cleaning overdue (still ASSIGNED past duty date): ${snapshot.cleaningOverdueAssigned}`,
    `Hostel pending bookings (not imported): ${snapshot.hostelPendingBookings}`,
    `Open AC comfort alerts: ${snapshot.acComfortAlerts}`,
    `Open fine disputes awaiting staff resolution: ${snapshot.openFineDisputes}`,
    ""
  ];

  if (snapshot.supportHighlights.length > 0) {
    lines.push("Top unread support threads:");
    for (const item of snapshot.supportHighlights.slice(0, 8)) {
      const who = item.residentName || item.residentEmail;
      lines.push(
        `- [${item.conversationId}] ${who} <${item.residentEmail}> unread=${item.unreadCount}: ${clipText(item.latestBody, 220)}`
      );
    }
    lines.push("");
  }

  if (snapshot.pendingContractHighlights.length > 0) {
    lines.push("Pending contract approvals:");
    for (const item of snapshot.pendingContractHighlights.slice(0, 8)) {
      lines.push(`- [${item.id}] ${item.type} ${item.email}: ${clipText(item.summary, 180)}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function buildFallbackReportSummary(snapshot: AiManagerOpsSnapshot): string {
  const attention: string[] = [];
  if (snapshot.supportUnreadThreads > 0) {
    attention.push(`${snapshot.supportUnreadThreads} support thread(s) waiting`);
  }
  if (snapshot.pendingContractApprovals > 0) {
    attention.push(`${snapshot.pendingContractApprovals} contract approval(s) pending`);
  }
  if (snapshot.cleaningPendingAudit > 0) {
    attention.push(`${snapshot.cleaningPendingAudit} cleaning photo(s) awaiting audit`);
  }
  if (snapshot.cleaningOverdueAssigned > 0) {
    attention.push(`${snapshot.cleaningOverdueAssigned} overdue cleaning duty(ies)`);
  }
  if (snapshot.hostelPendingBookings > 0) {
    attention.push(`${snapshot.hostelPendingBookings} hostel booking(s) in the import queue`);
  }
  if (snapshot.acComfortAlerts > 0) {
    attention.push(`${snapshot.acComfortAlerts} AC comfort alert(s)`);
  }
  if (snapshot.openFineDisputes > 0) {
    attention.push(`${snapshot.openFineDisputes} fine dispute(s) open`);
  }

  if (attention.length === 0) {
    return [
      "AI Manager status report",
      "",
      "All clear for now — no urgent support threads, contract approvals, cleaning audits, overdue duties, hostel queue items, AC comfort alerts, or fine disputes.",
      "",
      "I will keep watching and report again on the next scheduled tick."
    ].join("\n");
  }

  return [
    "AI Manager status report — items needing attention",
    "",
    ...attention.map((line) => `• ${line}`),
    "",
    "Open the manager portal to review details. Enabled capabilities may have already taken allowed actions; see the Actions section of this report."
  ].join("\n");
}

export function shouldSkipQuietTick(
  snapshot: AiManagerOpsSnapshot,
  force: boolean,
  capabilities: AiManagerCapabilities = DEFAULT_AI_MANAGER_CAPABILITIES
): boolean {
  if (force) return false;
  // Schedule fill can still have work even when the ops snapshot looks quiet.
  if (capabilities.scheduleAssignment) return false;
  if (capabilities.answerChat && snapshot.supportUnreadThreads > 0) return false;
  if (capabilities.manageFines && (snapshot.cleaningOverdueAssigned > 0 || snapshot.openFineDisputes > 0)) {
    return false;
  }
  return (
    snapshot.supportUnreadThreads === 0 &&
    snapshot.pendingContractApprovals === 0 &&
    snapshot.cleaningPendingAudit === 0 &&
    snapshot.cleaningOverdueAssigned === 0 &&
    snapshot.hostelPendingBookings === 0 &&
    snapshot.acComfortAlerts === 0 &&
    snapshot.openFineDisputes === 0
  );
}

export function buildReportChatTitle(snapshot: AiManagerOpsSnapshot, createdAt: string): string {
  const hot =
    snapshot.supportUnreadThreads +
    snapshot.pendingContractApprovals +
    snapshot.cleaningPendingAudit +
    snapshot.cleaningOverdueAssigned +
    snapshot.hostelPendingBookings +
    snapshot.acComfortAlerts +
    snapshot.openFineDisputes;
  const day = createdAt.slice(0, 10);
  return hot > 0
    ? `AI Manager report — ${hot} item(s) need attention (${day})`
    : `AI Manager report — all clear (${day})`;
}

/** @deprecated Use buildReportChatTitle */
export const buildReportEmailSubject = buildReportChatTitle;

export function buildReportChatBody(report: AiManagerReport): string {
  const parts = [
    buildReportChatTitle(report.snapshot, report.createdAt),
    "",
    report.summaryText.trim(),
    "",
    "— Capabilities —",
    formatCapabilitiesForLog(report.capabilities),
    "",
    "— Snapshot —",
    formatOpsSnapshotForPrompt(report.snapshot),
    ""
  ];

  if (report.actionsTaken.length > 0) {
    parts.push("— Actions taken —");
    for (const action of report.actionsTaken) {
      parts.push(
        `- [${action.ok ? "ok" : "fail"}] ${action.capability}${
          action.count != null ? ` (n=${action.count})` : ""
        }: ${action.summary}`
      );
    }
    parts.push("");
  }

  if (report.suggestedDrafts.length > 0) {
    parts.push("— Suggested support reply drafts (not sent) —");
    for (const draft of report.suggestedDrafts) {
      parts.push(`Thread ${draft.conversationId} (${draft.residentEmail}):`);
      parts.push(draft.draft.trim());
      parts.push("");
    }
  }

  parts.push(
    "Open Settings → AI Manager for history, capability toggles, and feedback.",
    `Report id: ${report.id}`
  );
  return parts.join("\n");
}

/** @deprecated Use buildReportChatBody */
export const buildReportEmailBody = buildReportChatBody;

/** Conservative gate: escalate instead of auto-replying. */
export function shouldEscalateSupportInsteadOfAutoReply(latestBody: string): boolean {
  const text = latestBody.toLowerCase();
  const patterns = [
    /lawsuit|lawyer|police|công an|kiện/,
    /refund deposit|hoàn cọc|terminate contract|chấm dứt hợp đồng/,
    /transfer bed|chuyển giường|approve extension|gia hạn hợp đồng/,
    /owner only|gặp owner|gặp chủ/
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function inferAiManagerCapabilityFromAction(
  action: string | null | undefined
): AiManagerFeedbackCapability {
  const value = String(action ?? "").toLowerCase();
  if (value.includes("chat.") || value.includes("answer")) return "answerChat";
  if (value.includes("fine") || value.includes("dispute")) return "manageFines";
  if (value.includes("schedule") || value.includes("assign")) return "scheduleAssignment";
  if (value.includes("tick.report") || value.includes("report") || value.includes("settings")) {
    return "ownerReports";
  }
  return "other";
}

export type AiManagerLearningGuideLike = {
  action: string;
  rating: AiManagerFeedbackRating;
  guide: string;
  entityLabel?: string | null;
  actionDetails?: string | null;
};

export function formatLearningGuidesForPrompt(
  entries: AiManagerLearningGuideLike[],
  options?: { maxChars?: number }
): string {
  if (!entries.length) return "";
  const maxChars = options?.maxChars ?? 3500;
  const lines: string[] = [
    "Owner learning guides from past AI Manager actions (follow these for similar events):"
  ];
  for (const entry of entries) {
    const tag = entry.rating === "like" ? "LIKED — do more like this" : "DISLIKED — avoid repeating this";
    const details = entry.actionDetails
      ? `; context=${String(entry.actionDetails).replace(/\s+/g, " ").trim().slice(0, 160)}`
      : "";
    const subject = entry.entityLabel ? `; subject=${entry.entityLabel}` : "";
    const guide = String(entry.guide ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    lines.push(`- [${tag}] action=${entry.action}${subject}${details}\n  Guide: ${guide}`);
  }
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/**
 * Optional override for fine-dispute auto decisions when owner guides are present.
 * Returns null when guides do not clearly dictate keep vs cancel.
 */
export function disputeDecisionFromGuides(
  disputeText: string,
  guides: AiManagerLearningGuideLike[]
): "KEEP_FINE" | "CANCEL_FINE" | null {
  if (!guides.length) return null;
  const haystack = `${disputeText}\n${guides.map((g) => `${g.rating} ${g.guide}`).join("\n")}`.toLowerCase();

  const cancelSignals = guides.filter(
    (g) =>
      g.rating === "like" &&
      /cancel|waive|remove fine|xóa phạt|hủy phạt|đã thanh toán|already paid|duplicate|trùng/i.test(
        g.guide
      )
  );
  const keepSignals = guides.filter(
    (g) =>
      (g.rating === "like" && /keep|retain|do not cancel|không hủy|giữ phạt/i.test(g.guide)) ||
      (g.rating === "dislike" && /should not have cancelled|không nên hủy|wrong cancel/i.test(g.guide))
  );

  if (
    cancelSignals.length &&
    /đã thanh toán|already paid|duplicate|trùng|nhầm người|wrong person/i.test(disputeText)
  ) {
    return "CANCEL_FINE";
  }
  if (keepSignals.length > cancelSignals.length) {
    return "KEEP_FINE";
  }
  if (cancelSignals.length && /paid|duplicate|wrong/i.test(haystack)) {
    return "CANCEL_FINE";
  }
  return null;
}

function clipText(value: string, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
