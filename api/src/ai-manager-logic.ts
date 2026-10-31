/**
 * Pure helpers for the Cozoro AI Manager agent (testable without DB / LLM).
 */

export type AiManagerMode = "report_only" | "assist";

export type AiManagerConfig = {
  enabled: boolean;
  email: string;
  displayName: string;
  mode: AiManagerMode;
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
};

export type AiManagerSuggestedDraft = {
  conversationId: string;
  residentEmail: string;
  draft: string;
};

export type AiManagerReport = {
  id: string;
  createdAt: string;
  trigger: "startup" | "interval" | "manual";
  mode: AiManagerMode;
  snapshot: AiManagerOpsSnapshot;
  summaryText: string;
  suggestedDrafts: AiManagerSuggestedDraft[];
  emailedTo: string[];
  emailErrors: string[];
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

export function clampIntervalHours(value: unknown, fallback = DEFAULT_AI_MANAGER_INTERVAL_HOURS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(168, Math.max(1, Math.round(n)));
}

export function defaultAiManagerConfig(overrides?: Partial<AiManagerConfig>): AiManagerConfig {
  return {
    enabled: false,
    email: DEFAULT_AI_MANAGER_EMAIL,
    displayName: DEFAULT_AI_MANAGER_NAME,
    mode: "report_only",
    reportEmails: [],
    intervalHours: DEFAULT_AI_MANAGER_INTERVAL_HOURS,
    accountProvisionedAt: null,
    lastTickAt: null,
    lastReportId: null,
    lastError: null,
    ...overrides
  };
}

export function mergeAiManagerConfig(
  current: AiManagerConfig,
  patch: Partial<{
    enabled: boolean;
    email: string;
    displayName: string;
    mode: AiManagerMode | string;
    reportEmails: string[];
    intervalHours: number;
  }>
): AiManagerConfig {
  const next = { ...current };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.email === "string" && patch.email.trim().includes("@")) {
    next.email = patch.email.trim().toLowerCase();
  }
  if (typeof patch.displayName === "string" && patch.displayName.trim()) {
    next.displayName = patch.displayName.trim().slice(0, 80);
  }
  if (patch.mode != null) next.mode = parseAiManagerMode(patch.mode);
  if (patch.reportEmails != null) next.reportEmails = normalizeEmailList(patch.reportEmails);
  if (patch.intervalHours != null) next.intervalHours = clampIntervalHours(patch.intervalHours, current.intervalHours);
  return next;
}

export function resolveReportRecipients(config: AiManagerConfig, fallbackOwnerEmails: string[]): string[] {
  const fromConfig = normalizeEmailList(config.reportEmails);
  if (fromConfig.length > 0) return fromConfig;
  return normalizeEmailList(fallbackOwnerEmails);
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

  if (attention.length === 0) {
    return [
      "AI Manager status report",
      "",
      "All clear for now — no urgent support threads, contract approvals, cleaning audits, overdue duties, hostel queue items, or AC comfort alerts.",
      "",
      "I will keep watching and report again on the next scheduled tick."
    ].join("\n");
  }

  return [
    "AI Manager status report — items needing attention",
    "",
    ...attention.map((line) => `• ${line}`),
    "",
    "Open the manager portal to review details. I prepared this digest for the owner; I did not change resident data in report-only mode."
  ].join("\n");
}

export function shouldSkipQuietTick(snapshot: AiManagerOpsSnapshot, force: boolean): boolean {
  if (force) return false;
  return (
    snapshot.supportUnreadThreads === 0 &&
    snapshot.pendingContractApprovals === 0 &&
    snapshot.cleaningPendingAudit === 0 &&
    snapshot.cleaningOverdueAssigned === 0 &&
    snapshot.hostelPendingBookings === 0 &&
    snapshot.acComfortAlerts === 0
  );
}

export function buildReportEmailSubject(snapshot: AiManagerOpsSnapshot, createdAt: string): string {
  const hot =
    snapshot.supportUnreadThreads +
    snapshot.pendingContractApprovals +
    snapshot.cleaningPendingAudit +
    snapshot.cleaningOverdueAssigned +
    snapshot.hostelPendingBookings +
    snapshot.acComfortAlerts;
  const day = createdAt.slice(0, 10);
  return hot > 0
    ? `[Cozoro AI Manager] ${hot} item(s) need attention — ${day}`
    : `[Cozoro AI Manager] All clear — ${day}`;
}

export function buildReportEmailBody(report: AiManagerReport): string {
  const parts = [
    report.summaryText.trim(),
    "",
    "— Snapshot —",
    formatOpsSnapshotForPrompt(report.snapshot),
    ""
  ];

  if (report.suggestedDrafts.length > 0) {
    parts.push("— Suggested support reply drafts (not sent) —");
    for (const draft of report.suggestedDrafts) {
      parts.push(`Thread ${draft.conversationId} (${draft.residentEmail}):`);
      parts.push(draft.draft.trim());
      parts.push("");
    }
  }

  parts.push(
    "Portal: open Settings → AI Manager for history, or Messages / Client list for the items above.",
    `Report id: ${report.id}`
  );
  return parts.join("\n");
}

function clipText(value: string, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
