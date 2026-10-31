/**
 * Cozoro AI Manager — dedicated manager staff account + scheduled owner reports.
 *
 * The agent logs in as a real portal manager (default ai.manager@cozorohome.com),
 * surveys ops (support, contracts, cleaning, hostel, AC), writes an LLM digest,
 * emails owners, and optionally prepares unsent support reply drafts (assist mode).
 * It does not auto-mutate resident money/sheets in v1.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { CleaningTaskStatus, SupportMessageSenderRole } from "@prisma/client";

import { logAction } from "./action-log.js";
import { loadOpenAcComfortAlertsForStaff } from "./ac-comfort-votes.js";
import { recordGeminiUsage } from "./ai-usage.js";
import { appendAiTrainingExchange } from "./ai-training-log.js";
import { getHostelArchivedIds } from "./hostel-pending-bookings.js";
import { completeToolChatRound } from "./llm-tool-chat.js";
import { upsertStoredPassword } from "./portal-auth.js";
import { prisma } from "./prisma.js";
import { generateManagerSupportReplyDraft } from "./resident-support-ai.js";
import { sendGmailReceipt } from "./google-sheets.js";
import {
  ensureSystemStaffAccount,
  listOwnerAndAdminEmails,
  requirePortalRole
} from "./staff-access.js";
import {
  countOpenFineDisputes,
  runAnswerChatActions,
  runManageFinesActions,
  runScheduleAssignmentActions
} from "./ai-manager-actions.js";
import {
  type AiManagerCapabilities,
  type AiManagerConfig,
  type AiManagerOpsSnapshot,
  type AiManagerReport,
  type AiManagerSuggestedDraft,
  MAX_AI_MANAGER_REPORTS,
  buildFallbackReportSummary,
  buildReportEmailBody,
  buildReportEmailSubject,
  defaultAiManagerConfig,
  formatCapabilitiesForLog,
  formatOpsSnapshotForPrompt,
  mergeAiManagerConfig,
  normalizeAiManagerCapabilities,
  resolveReportRecipients,
  shouldSkipQuietTick
} from "./ai-manager-logic.js";

const AI_MANAGER_ENTITY_TYPE = "AiManager";
const AI_MANAGER_ACTION_PREFIX = "ai_manager.";

async function logAiManagerAction(input: {
  action: string;
  actorEmail?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: string | null;
}) {
  const action = input.action.startsWith(AI_MANAGER_ACTION_PREFIX)
    ? input.action
    : `${AI_MANAGER_ACTION_PREFIX}${input.action}`;
  await logAction({
    actorEmail: input.actorEmail,
    actorName: input.actorName ?? "Cozoro AI Manager",
    actorRole: input.actorRole ?? "manager",
    action,
    entityType: AI_MANAGER_ENTITY_TYPE,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    details: input.details
  });
}

function summarizeSnapshotForLog(snapshot: AiManagerOpsSnapshot): string {
  return [
    `support=${snapshot.supportUnreadThreads}`,
    `contracts=${snapshot.pendingContractApprovals}`,
    `audit=${snapshot.cleaningPendingAudit}`,
    `overdue=${snapshot.cleaningOverdueAssigned}`,
    `hostel=${snapshot.hostelPendingBookings}`,
    `ac=${snapshot.acComfortAlerts}`,
    `fineDisputes=${snapshot.openFineDisputes}`
  ].join("; ");
}

export async function listAiManagerActionLogs(limit = 40) {
  const take = Math.max(1, Math.min(100, Math.trunc(limit) || 40));
  const rows = await prisma.actionLog.findMany({
    where: {
      OR: [
        { action: { startsWith: AI_MANAGER_ACTION_PREFIX } },
        { entityType: AI_MANAGER_ENTITY_TYPE }
      ]
    },
    orderBy: { createdAt: "desc" },
    take
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
    actorRole: row.actorRole,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    details: row.details,
    createdAt: row.createdAt.toISOString()
  }));
}

const dataDir = path.join(process.cwd(), "data");
const configPath = path.join(dataDir, "ai-manager-config.json");
const reportsPath = path.join(dataDir, "ai-manager-reports.json");
const contractApprovalsPath = path.join(dataDir, "contract-approvals.json");
const hostelImportedIdsPath =
  process.env.HOSTEL_IMPORTED_IDS_PATH ?? path.join(dataDir, "hostel-imported-ids.json");
const HOSTEL_BOOKING_TABLE = process.env.HOSTEL_BOOKING_TABLE ?? "guest_stay_bookings";

type ReportsFile = { reports: AiManagerReport[] };

let tickRunning = false;
let lastScheduledTickMs = 0;

function envFlagTrue(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function envAiManagerDefaults(): Partial<AiManagerConfig> {
  const email = process.env.AI_MANAGER_EMAIL?.trim().toLowerCase();
  const displayName = process.env.AI_MANAGER_NAME?.trim();
  const mode = process.env.AI_MANAGER_MODE?.trim();
  const intervalHoursRaw = process.env.AI_MANAGER_INTERVAL_HOURS?.trim();
  const reportEmails = (process.env.AI_MANAGER_REPORT_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ...(envFlagTrue("AI_MANAGER_ENABLED") ? { enabled: true } : {}),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(mode ? { mode: mode === "assist" ? "assist" : "report_only" } : {}),
    ...(intervalHoursRaw ? { intervalHours: Number(intervalHoursRaw) } : {}),
    ...(reportEmails.length ? { reportEmails } : {})
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function readAiManagerConfig(): Promise<AiManagerConfig> {
  const stored = await readJsonFile<Partial<AiManagerConfig>>(configPath, {});
  const envDefaults = envAiManagerDefaults();
  return defaultAiManagerConfig({
    ...envDefaults,
    ...stored,
    email: String(stored.email ?? envDefaults.email ?? defaultAiManagerConfig().email)
      .trim()
      .toLowerCase(),
    reportEmails: Array.isArray(stored.reportEmails)
      ? stored.reportEmails
      : envDefaults.reportEmails ?? [],
    capabilities: normalizeAiManagerCapabilities(stored.capabilities ?? envDefaults.capabilities)
  });
}

export async function writeAiManagerConfig(config: AiManagerConfig): Promise<AiManagerConfig> {
  const next = defaultAiManagerConfig(config);
  await writeJsonFile(configPath, next);
  return next;
}

async function readReportsFile(): Promise<ReportsFile> {
  const file = await readJsonFile<Partial<ReportsFile>>(reportsPath, { reports: [] });
  return { reports: Array.isArray(file.reports) ? file.reports : [] };
}

async function writeReportsFile(file: ReportsFile) {
  await writeJsonFile(reportsPath, {
    reports: file.reports.slice(0, MAX_AI_MANAGER_REPORTS)
  });
}

export async function listAiManagerReports(limit = 20): Promise<AiManagerReport[]> {
  const file = await readReportsFile();
  return file.reports.slice(0, Math.max(1, Math.min(100, limit)));
}

export async function getAiManagerReport(id: string): Promise<AiManagerReport | null> {
  const file = await readReportsFile();
  return file.reports.find((report) => report.id === id) ?? null;
}

/** Recent reports for owner Notification Center (last 7 days). */
export async function listRecentAiManagerReportsForOwner(withinDays = 7): Promise<AiManagerReport[]> {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const file = await readReportsFile();
  return file.reports.filter((report) => new Date(report.createdAt).getTime() >= cutoff);
}

export async function ensureAiManagerAccount(options?: {
  password?: string;
  actorEmail?: string;
}): Promise<{ config: AiManagerConfig; passwordSet: boolean; generatedPassword?: string }> {
  const config = await readAiManagerConfig();
  const wasProvisioned = Boolean(config.accountProvisionedAt);
  const explicitActor = options?.actorEmail?.trim().toLowerCase() || null;

  await ensureSystemStaffAccount({
    email: config.email,
    role: "manager",
    name: config.displayName,
    addedBy: explicitActor || "system:ai-manager",
    permissions: {
      branches: [],
      data: {
        clients: { read: true, write: false },
        fines: { read: true, write: false },
        payments: { read: true, write: false },
        cleaning: { read: true, write: true },
        laundry: { read: true, write: false },
        support: { read: true, write: true },
        coins: { read: true, write: false },
        stats: { read: true, write: false }
      }
    }
  });

  let passwordSet = false;
  let generatedPassword: string | undefined;
  const passwordFromEnv = process.env.AI_MANAGER_PASSWORD?.trim();
  const password = options?.password?.trim() || passwordFromEnv || "";

  if (password) {
    await upsertStoredPassword(config.email, password, { mustChangePassword: false });
    passwordSet = true;
  } else if (!config.accountProvisionedAt) {
    generatedPassword = randomBytes(9).toString("base64url");
    await upsertStoredPassword(config.email, generatedPassword, { mustChangePassword: false });
    passwordSet = true;
  }

  const next = await writeAiManagerConfig({
    ...config,
    accountProvisionedAt: config.accountProvisionedAt ?? new Date().toISOString()
  });

  const shouldLog = Boolean(explicitActor) || passwordSet || !wasProvisioned;
  if (shouldLog) {
    await logAiManagerAction({
      action: "account.ensure",
      actorEmail: explicitActor || next.email,
      actorName: next.displayName,
      actorRole: explicitActor ? "owner" : "manager",
      entityId: next.email,
      entityLabel: next.displayName,
      details: [
        `firstProvision=${wasProvisioned ? "false" : "true"}`,
        `passwordSet=${passwordSet ? "true" : "false"}`,
        `generatedPassword=${generatedPassword ? "true" : "false"}`
      ].join("; ")
    });
  }

  return { config: next, passwordSet, generatedPassword };
}

export async function updateAiManagerSettings(
  actorEmail: string,
  patch: Partial<{
    enabled: boolean;
    email: string;
    displayName: string;
    mode: string;
    capabilities: Partial<AiManagerCapabilities>;
    reportEmails: string[];
    intervalHours: number;
    password: string;
  }>
) {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners or app admins can configure the AI Manager.");
  const current = await readAiManagerConfig();
  const { password, ...configPatch } = patch;
  let next = mergeAiManagerConfig(current, configPatch);
  const passwordUpdated = typeof password === "string" && password.trim().length >= 8;

  if (passwordUpdated) {
    await ensureAiManagerAccount({ password: password!.trim(), actorEmail });
    next = await readAiManagerConfig();
    next = mergeAiManagerConfig(next, configPatch);
  } else {
    await ensureSystemStaffAccount({
      email: next.email,
      role: "manager",
      name: next.displayName,
      addedBy: actorEmail.trim().toLowerCase(),
      permissions: {
        branches: [],
        data: {
          clients: { read: true, write: false },
          fines: { read: true, write: next.capabilities.manageFines },
          payments: { read: true, write: false },
          cleaning: { read: true, write: next.capabilities.scheduleAssignment },
          laundry: { read: true, write: false },
          support: { read: true, write: next.capabilities.answerChat },
          coins: { read: true, write: false },
          stats: { read: true, write: false }
        }
      }
    });
  }

  next = await writeAiManagerConfig({
    ...next,
    accountProvisionedAt: next.accountProvisionedAt ?? new Date().toISOString()
  });

  await logAiManagerAction({
    action: "settings.update",
    actorEmail: actorEmail.trim().toLowerCase(),
    actorRole: "owner",
    entityId: next.email,
    entityLabel: next.displayName,
    details: [
      `enabled=${next.enabled}`,
      `mode=${next.mode}`,
      `intervalHours=${next.intervalHours}`,
      `reportEmails=${next.reportEmails.join(",") || "(owners)"}`,
      `passwordUpdated=${passwordUpdated ? "true" : "false"}`,
      `email=${next.email}`,
      formatCapabilitiesForLog(next.capabilities)
    ].join("; ")
  });

  return next;
}

function vietnamTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

async function countHostelPendingBookings(): Promise<number> {
  try {
    const [rows, archived, importedRaw] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ id: unknown; status: unknown }>>(
        `SELECT id, status FROM \`${HOSTEL_BOOKING_TABLE}\` ORDER BY created_at DESC LIMIT 500`
      ),
      getHostelArchivedIds(),
      readJsonFile<string[]>(hostelImportedIdsPath, [])
    ]);
    const imported = new Set(
      (Array.isArray(importedRaw) ? importedRaw : []).map((id) => String(id).trim()).filter(Boolean)
    );
    return rows.filter((row) => {
      const id = String(row.id ?? "").trim();
      if (!id || archived.has(id) || imported.has(id)) return false;
      const status = String(row.status ?? "").trim().toUpperCase();
      return status !== "CANCELED" && status !== "CANCELLED";
    }).length;
  } catch {
    return 0;
  }
}

export async function gatherAiManagerOpsSnapshot(): Promise<AiManagerOpsSnapshot> {
  const todayKey = vietnamTodayKey();

  const conversations = await prisma.supportConversation.findMany({
    where: { messages: { some: {} } },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 40
      }
    },
    orderBy: { lastMessageAt: "desc" },
    take: 80
  });

  const supportHighlights: AiManagerOpsSnapshot["supportHighlights"] = [];
  let supportUnreadMessages = 0;

  for (const conversation of conversations) {
    // Needs staff reply when the latest message is from the resident.
    const latest = conversation.messages[0];
    if (!latest || latest.senderRole !== SupportMessageSenderRole.RESIDENT) continue;
    let unreadCount = 0;
    for (const message of conversation.messages) {
      if (message.senderRole !== SupportMessageSenderRole.RESIDENT) break;
      unreadCount += 1;
    }
    unreadCount = Math.max(1, unreadCount);
    supportUnreadMessages += unreadCount;
    supportHighlights.push({
      conversationId: conversation.id,
      residentEmail: conversation.residentEmail,
      residentName: conversation.residentName,
      unreadCount,
      latestBody: latest.body
    });
  }

  supportHighlights.sort((a, b) => b.unreadCount - a.unreadCount);

  const approvalsFile = await readJsonFile<{
    approvals?: Array<{
      id?: string;
      type?: string;
      status?: string;
      registration?: { email?: string; fullName?: string };
      extension?: { email?: string; residentName?: string; extensionMonths?: number };
      transfer?: { email?: string; residentName?: string };
    }>;
  }>(contractApprovalsPath, { approvals: [] });

  const pendingApprovals = (approvalsFile.approvals ?? []).filter((item) => item.status === "pending");
  const pendingContractHighlights = pendingApprovals.slice(0, 8).map((item) => {
    const email =
      item.registration?.email ||
      item.extension?.email ||
      item.transfer?.email ||
      "unknown";
    const name =
      item.registration?.fullName ||
      item.extension?.residentName ||
      item.transfer?.residentName ||
      "";
    const summary =
      item.type === "extension"
        ? `Extension ${item.extension?.extensionMonths ?? "?"} mo — ${name || email}`
        : item.type === "transfer"
          ? `Bed transfer — ${name || email}`
          : `Registration — ${name || email}`;
    return {
      id: String(item.id ?? ""),
      type: String(item.type ?? "unknown"),
      email: String(email).toLowerCase(),
      summary
    };
  });

  const [
    cleaningPendingAudit,
    cleaningOverdueAssigned,
    hostelPendingBookings,
    acAlerts,
    openFineDisputes
  ] = await Promise.all([
    prisma.cleaningTask.count({ where: { status: CleaningTaskStatus.DONE_PENDING_AUDIT } }),
    prisma.cleaningTask.count({
      where: {
        status: CleaningTaskStatus.ASSIGNED,
        scheduledDate: { lt: new Date(`${todayKey}T00:00:00.000Z`) }
      }
    }),
    countHostelPendingBookings(),
    loadOpenAcComfortAlertsForStaff().catch(() => []),
    countOpenFineDisputes()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    supportUnreadThreads: supportHighlights.length,
    supportUnreadMessages,
    supportHighlights: supportHighlights.slice(0, 8),
    pendingContractApprovals: pendingApprovals.length,
    pendingContractHighlights,
    cleaningPendingAudit,
    cleaningOverdueAssigned,
    hostelPendingBookings,
    acComfortAlerts: acAlerts.length,
    openFineDisputes
  };
}

async function summarizeSnapshotWithLlm(
  snapshot: AiManagerOpsSnapshot,
  actorEmail: string
): Promise<string> {
  const systemPrompt = [
    "You are Cozoro AI Manager, a dutiful co-living operations manager for CozoroHome (D2/D7).",
    "Write a concise status report for the OWNER (not residents).",
    "Use clear English. Bullet priorities first, then brief notes.",
    "Do not invent facts outside the snapshot. Do not claim you already fixed things.",
    "If everything is clear, say so briefly and note you are still monitoring.",
    "Keep under 350 words."
  ].join(" ");

  const started = Date.now();
  try {
    const round = await completeToolChatRound({
      systemPrompt,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Produce today's owner report from this operations snapshot:\n\n${formatOpsSnapshotForPrompt(snapshot)}`
            }
          ]
        }
      ],
      tools: [],
      temperature: 0.3,
      maxOutputTokens: 900,
      geminiKind: "shared"
    });

    void recordGeminiUsage({
      feature: "ai_manager_report",
      modality: "text",
      provider: round.provider,
      model: round.model,
      actorEmail,
      usage: round.usage,
      status: round.rateLimited ? "RATE_LIMITED" : round.text ? "SUCCESS" : "INVALID_RESPONSE",
      latencyMs: Date.now() - started
    });

    const text = round.text?.trim();
    if (text) {
      void appendAiTrainingExchange({
        channel: "manager",
        identifier: actorEmail,
        userText: "AI Manager scheduled owner report",
        modelText: text,
        meta: { feature: "ai_manager_report" }
      });
      return text;
    }
  } catch (error) {
    console.warn(
      "[ai-manager] LLM summary failed, using fallback:",
      error instanceof Error ? error.message : error
    );
  }

  return buildFallbackReportSummary(snapshot);
}

async function buildAssistDrafts(
  snapshot: AiManagerOpsSnapshot,
  operatorEmail: string
): Promise<AiManagerSuggestedDraft[]> {
  const drafts: AiManagerSuggestedDraft[] = [];
  for (const thread of snapshot.supportHighlights.slice(0, 3)) {
    try {
      const draft = await generateManagerSupportReplyDraft({
        conversationId: thread.conversationId,
        operatorEmail
      });
      if (draft?.trim()) {
        drafts.push({
          conversationId: thread.conversationId,
          residentEmail: thread.residentEmail,
          draft: draft.trim()
        });
      }
    } catch (error) {
      console.warn(
        `[ai-manager] support draft failed for ${thread.conversationId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return drafts;
}

export type AiManagerTickResult = {
  skipped: boolean;
  reason?: string;
  report?: AiManagerReport;
};

export async function runAiManagerTick(options?: {
  trigger?: "startup" | "interval" | "manual";
  force?: boolean;
}): Promise<AiManagerTickResult> {
  if (tickRunning) {
    await logAiManagerAction({
      action: "tick.skip",
      details: "reason=already_running"
    });
    return { skipped: true, reason: "An AI Manager tick is already running." };
  }

  tickRunning = true;
  const trigger = options?.trigger ?? "manual";
  const force = options?.force === true || trigger === "manual";

  try {
    let config = await readAiManagerConfig();
    if (!config.enabled && !force) {
      await logAiManagerAction({
        action: "tick.skip",
        actorEmail: config.email,
        actorName: config.displayName,
        entityId: config.email,
        entityLabel: config.displayName,
        details: `trigger=${trigger}; reason=disabled`
      });
      return { skipped: true, reason: "AI Manager is disabled." };
    }

    await ensureAiManagerAccount();
    config = await readAiManagerConfig();

    const snapshot = await gatherAiManagerOpsSnapshot();
    if (shouldSkipQuietTick(snapshot, force, config.capabilities) && trigger === "interval") {
      await writeAiManagerConfig({
        ...config,
        lastTickAt: new Date().toISOString(),
        lastError: null
      });
      await logAiManagerAction({
        action: "tick.skip",
        actorEmail: config.email,
        actorName: config.displayName,
        entityId: config.email,
        entityLabel: config.displayName,
        details: `trigger=${trigger}; reason=quiet; ${summarizeSnapshotForLog(snapshot)}`
      });
      return { skipped: true, reason: "No outstanding items; quiet interval tick skipped." };
    }

    const actionsTaken: AiManagerReport["actionsTaken"] = [];

    if (config.capabilities.scheduleAssignment) {
      actionsTaken.push(
        await runScheduleAssignmentActions({
          operatorEmail: config.email,
          displayName: config.displayName
        })
      );
    }

    if (config.capabilities.manageFines) {
      actionsTaken.push(
        await runManageFinesActions({
          operatorEmail: config.email,
          displayName: config.displayName
        })
      );
    }

    if (config.capabilities.answerChat) {
      actionsTaken.push(
        await runAnswerChatActions({
          snapshot,
          operatorEmail: config.email,
          displayName: config.displayName
        })
      );
    }

    const summaryText = config.capabilities.ownerReports
      ? await summarizeSnapshotWithLlm(snapshot, config.email)
      : buildFallbackReportSummary(snapshot);
    const suggestedDrafts =
      !config.capabilities.answerChat && config.mode === "assist"
        ? await buildAssistDrafts(snapshot, config.email)
        : [];

    const owners = await listOwnerAndAdminEmails();
    const recipients = config.capabilities.ownerReports
      ? resolveReportRecipients(config, owners)
      : [];
    const report: AiManagerReport = {
      id: `aimgr-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      createdAt: new Date().toISOString(),
      trigger,
      mode: config.mode,
      capabilities: config.capabilities,
      snapshot,
      summaryText,
      suggestedDrafts,
      actionsTaken,
      emailedTo: [],
      emailErrors: []
    };

    if (config.capabilities.ownerReports) {
      const subject = buildReportEmailSubject(snapshot, report.createdAt);
      const body = buildReportEmailBody(report);

      for (const to of recipients) {
        try {
          await sendGmailReceipt({ to, subject, body });
          report.emailedTo.push(to);
        } catch (error) {
          report.emailErrors.push(
            `${to}: ${error instanceof Error ? error.message : "email failed"}`
          );
        }
      }
    }

    const file = await readReportsFile();
    file.reports = [report, ...file.reports].slice(0, MAX_AI_MANAGER_REPORTS);
    await writeReportsFile(file);

    await writeAiManagerConfig({
      ...config,
      lastTickAt: report.createdAt,
      lastReportId: report.id,
      lastError: report.emailErrors.length
        ? report.emailErrors.slice(0, 3).join("; ")
        : null
    });

    await logAiManagerAction({
      action: "tick.report",
      actorEmail: config.email,
      actorName: config.displayName,
      entityId: report.id,
      entityLabel: config.email,
      details: [
        `trigger=${trigger}`,
        `mode=${config.mode}`,
        formatCapabilitiesForLog(config.capabilities),
        summarizeSnapshotForLog(snapshot),
        `actions=${actionsTaken.map((a) => `${a.capability}:${a.ok ? "ok" : "fail"}`).join(",") || "none"}`,
        `drafts=${suggestedDrafts.length}`,
        `emailedTo=${report.emailedTo.join(",") || "none"}`,
        `emailErrors=${report.emailErrors.length}`
      ].join("; ")
    });

    console.log(
      `[ai-manager] tick trigger=${trigger} report=${report.id} emailed=${report.emailedTo.length} errors=${report.emailErrors.length}`
    );

    return { skipped: false, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI Manager tick failed";
    try {
      const config = await readAiManagerConfig();
      await writeAiManagerConfig({ ...config, lastError: message, lastTickAt: new Date().toISOString() });
      await logAiManagerAction({
        action: "tick.fail",
        actorEmail: config.email,
        actorName: config.displayName,
        entityId: config.email,
        entityLabel: config.displayName,
        details: `trigger=${trigger}; error=${message}`
      });
    } catch {
      // ignore secondary write failure
    }
    throw error;
  } finally {
    tickRunning = false;
  }
}

export function getAiManagerIntervalMs(config: AiManagerConfig): number {
  return Math.max(60 * 60 * 1000, config.intervalHours * 60 * 60 * 1000);
}

export async function maybeRunScheduledAiManagerTick(): Promise<AiManagerTickResult | null> {
  const config = await readAiManagerConfig();
  if (!config.enabled) return null;
  const intervalMs = getAiManagerIntervalMs(config);
  const now = Date.now();
  if (now - lastScheduledTickMs < intervalMs) {
    return { skipped: true, reason: "Interval not elapsed yet." };
  }
  lastScheduledTickMs = now;
  return runAiManagerTick({ trigger: "interval", force: false });
}

export async function getAiManagerStatus(actorEmail: string) {
  await requirePortalRole(
    actorEmail,
    ["owner", "app_admin", "manager"],
    "Only staff can view AI Manager status."
  );
  const config = await readAiManagerConfig();
  const [reports, actionLogs] = await Promise.all([
    listAiManagerReports(10),
    listAiManagerActionLogs(40)
  ]);
  const owners = await listOwnerAndAdminEmails();
  return {
    config: {
      ...config,
      // Never expose password material
    },
    effectiveReportEmails: resolveReportRecipients(config, owners),
    recentReports: reports.map((report) => ({
      id: report.id,
      createdAt: report.createdAt,
      trigger: report.trigger,
      mode: report.mode,
      emailedTo: report.emailedTo,
      emailErrors: report.emailErrors,
      supportUnreadThreads: report.snapshot.supportUnreadThreads,
      pendingContractApprovals: report.snapshot.pendingContractApprovals,
      cleaningPendingAudit: report.snapshot.cleaningPendingAudit,
      cleaningOverdueAssigned: report.snapshot.cleaningOverdueAssigned,
      hostelPendingBookings: report.snapshot.hostelPendingBookings,
      acComfortAlerts: report.snapshot.acComfortAlerts,
      summaryPreview: report.summaryText.slice(0, 280)
    })),
    recentActionLogs: actionLogs
  };
}
