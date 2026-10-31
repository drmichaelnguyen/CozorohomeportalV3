/**
 * Capability-gated actions for the Cozoro AI Manager tick.
 * Each runner checks nothing itself — callers pass only when the owner enabled the capability.
 */

import {
  getManagerFines,
  managerCreateFine,
  managerResolveFineDispute,
  sendFineTicketEmail
} from "./google-sheets.js";
import {
  autoScheduleCleaningTasksByJob,
  sweepOverdueCleaningTasks
} from "./cleaning.js";
import { getCleaningAutoSchedulerConfig } from "./cleaning-scheduler-config.js";
import { generateManagerSupportReplyDraft } from "./resident-support-ai.js";
import { postOperatorSupportMessage } from "./support.js";
import { logAction } from "./action-log.js";
import {
  getLearningPromptBlock,
  listLearningGuidesForCapability
} from "./ai-manager-feedback.js";
import {
  disputeDecisionFromGuides,
  type AiManagerActionResult,
  type AiManagerOpsSnapshot,
  shouldEscalateSupportInsteadOfAutoReply
} from "./ai-manager-logic.js";
import {
  escalateFineDisputeToOwner,
  escalateSupportChatToOwner,
  isAmbiguousFineDispute
} from "./ai-manager-inbox.js";

// Must match api/src/google-sheets.ts fine sheet headers.
const FINE_DISPUTE_COLUMN = "Khieu nai tu khach hang";
const FINE_EMAIL_COLUMN = "EMAIL";
const FINE_TIMESTAMP_COLUMN = "DẤU THỜI GIAN";
const FINE_CONTENT_COLUMN = "NỘI DUNG VI PHẠM";
const FINE_AMOUNT_COLUMN = "CHI PHÍ THANH TOÁN CHO VI PHẠM";
const MAX_CHAT_REPLIES_PER_TICK = 5;
const MAX_FINE_DISPUTE_RESOLUTIONS_PER_TICK = 3;

async function logCapabilityAction(input: {
  action: string;
  actorEmail: string;
  actorName: string;
  entityId?: string;
  entityLabel?: string;
  details?: string;
}) {
  await logAction({
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    actorRole: "manager",
    action: input.action.startsWith("ai_manager.") ? input.action : `ai_manager.${input.action}`,
    entityType: "AiManager",
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    details: input.details
  });
}

export async function countOpenFineDisputes(): Promise<number> {
  try {
    const fines = await getManagerFines();
    return fines.filter((entry) => {
      const dispute = String(entry.row[FINE_DISPUTE_COLUMN] ?? "").trim();
      if (!dispute) return false;
      return !/manager resolution/i.test(dispute);
    }).length;
  } catch {
    return 0;
  }
}

export async function runAnswerChatActions(input: {
  snapshot: AiManagerOpsSnapshot;
  operatorEmail: string;
  displayName: string;
}): Promise<AiManagerActionResult> {
  let sent = 0;
  let escalated = 0;
  const errors: string[] = [];

  const learningBlock = await getLearningPromptBlock("answerChat");

  for (const thread of input.snapshot.supportHighlights.slice(0, MAX_CHAT_REPLIES_PER_TICK)) {
    if (shouldEscalateSupportInsteadOfAutoReply(thread.latestBody)) {
      escalated += 1;
      try {
        await escalateSupportChatToOwner({
          fromEmail: input.operatorEmail,
          fromName: input.displayName,
          conversationId: thread.conversationId,
          residentEmail: thread.residentEmail,
          residentName: thread.residentName,
          latestBody: thread.latestBody,
          reason: "sensitive_topic"
        });
      } catch {
        // Inbox write is best-effort; action log still records the escalate.
      }
      await logCapabilityAction({
        action: "chat.escalate",
        actorEmail: input.operatorEmail,
        actorName: input.displayName,
        entityId: thread.conversationId,
        entityLabel: thread.residentEmail,
        details: "reason=sensitive_topic; auto_reply_skipped; inbox=1"
      });
      continue;
    }

    try {
      const draft = await generateManagerSupportReplyDraft({
        conversationId: thread.conversationId,
        operatorEmail: input.operatorEmail,
        extraGuidance: learningBlock || undefined,
        usageFeature: "ai_manager_chat_reply"
      });
      if (!draft?.trim()) {
        errors.push(`${thread.residentEmail}: empty draft`);
        continue;
      }

      await postOperatorSupportMessage({
        conversationId: thread.conversationId,
        operatorEmail: input.operatorEmail,
        body: draft.trim()
      });
      sent += 1;
      await logCapabilityAction({
        action: "chat.reply",
        actorEmail: input.operatorEmail,
        actorName: input.displayName,
        entityId: thread.conversationId,
        entityLabel: thread.residentEmail,
        details: `chars=${draft.trim().length}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "reply failed";
      errors.push(`${thread.residentEmail}: ${message}`);
      await logCapabilityAction({
        action: "chat.reply_fail",
        actorEmail: input.operatorEmail,
        actorName: input.displayName,
        entityId: thread.conversationId,
        entityLabel: thread.residentEmail,
        details: message
      });
    }
  }

  return {
    capability: "answerChat",
    ok: errors.length === 0,
    count: sent,
    summary: `Sent ${sent} support reply(ies); escalated ${escalated}; errors ${errors.length}${
      errors.length ? ` (${errors.slice(0, 2).join(" | ")})` : ""
    }`
  };
}

export async function runManageFinesActions(input: {
  operatorEmail: string;
  displayName: string;
}): Promise<AiManagerActionResult> {
  const parts: string[] = [];
  let ok = true;
  let count = 0;

  try {
    const batchId = `ai-manager-overdue-${Date.now().toString(36)}`;
    const missed = await sweepOverdueCleaningTasks(new Date(), {
      createFines: true,
      batchId
    });
    const created = Number(missed.created ?? 0);
    count += created;
    parts.push(
      `missedCleaningFines created=${created} scanned=${missed.scanned} alreadyExists=${missed.alreadyExists ?? 0}`
    );
    await logCapabilityAction({
      action: "fines.missed_cleaning_sweep",
      actorEmail: input.operatorEmail,
      actorName: input.displayName,
      entityId: batchId,
      details: parts[parts.length - 1]
    });
  } catch (error) {
    ok = false;
    const message = error instanceof Error ? error.message : "missed fine sweep failed";
    parts.push(`missedCleaningFines error=${message}`);
    await logCapabilityAction({
      action: "fines.missed_cleaning_sweep_fail",
      actorEmail: input.operatorEmail,
      actorName: input.displayName,
      details: message
    });
  }

  try {
    const fines = await getManagerFines();
    const openDisputes = fines.filter((entry) => {
      const dispute = String(entry.row[FINE_DISPUTE_COLUMN] ?? "").trim();
      if (!dispute) return false;
      return !/manager resolution/i.test(dispute);
    });
    const fineGuides = await listLearningGuidesForCapability("manageFines", 12);

    let resolved = 0;
    for (const entry of openDisputes.slice(0, MAX_FINE_DISPUTE_RESOLUTIONS_PER_TICK)) {
      const email = String(entry.row[FINE_EMAIL_COLUMN] ?? "").trim().toLowerCase();
      const timestamp = String(entry.row[FINE_TIMESTAMP_COLUMN] ?? "").trim();
      const content = String(entry.row[FINE_CONTENT_COLUMN] ?? "").trim();
      const amount = String(entry.row[FINE_AMOUNT_COLUMN] ?? "").trim();
      const dispute = String(entry.row[FINE_DISPUTE_COLUMN] ?? "").trim();
      if (!email || !timestamp || !content) continue;

      const guided = disputeDecisionFromGuides(dispute, fineGuides);
      const clearCancel =
        guided === "CANCEL_FINE" ||
        (guided == null &&
          /đã thanh toán|already paid|duplicate|trùng|nhầm người|wrong person|sai người/i.test(
            dispute
          ));
      const clearKeep = guided === "KEEP_FINE";

      // When unsure, ask the human owner/admin in the AI Manager chat tab.
      if (!clearCancel && !clearKeep && isAmbiguousFineDispute(dispute)) {
        try {
          await escalateFineDisputeToOwner({
            fromEmail: input.operatorEmail,
            fromName: input.displayName,
            email,
            timestamp,
            content,
            amount,
            dispute
          });
        } catch {
          // Inbox write is best-effort.
        }
        await logCapabilityAction({
          action: "fines.dispute_escalate",
          actorEmail: input.operatorEmail,
          actorName: input.displayName,
          entityId: `${email}|${timestamp}`,
          entityLabel: email,
          details: `content=${content.slice(0, 80)}; amount=${amount}; reason=ambiguous`
        });
        continue;
      }

      const cancel = clearCancel;
      const decision = cancel ? "CANCEL_FINE" : "KEEP_FINE";

      await managerResolveFineDispute({
        email,
        timestamp,
        content,
        decision,
        note: cancel
          ? guided
            ? "AI Manager: cancelled using owner learning guides + dispute text."
            : "AI Manager: cancelled after dispute indicated duplicate/wrong/paid."
          : guided
            ? "AI Manager: kept fine using owner learning guides."
            : "AI Manager: reviewed dispute and kept the fine. Owner can reverse if needed.",
        operator: input.operatorEmail
      });
      resolved += 1;
      count += 1;
      await logCapabilityAction({
        action: cancel ? "fines.dispute_cancel" : "fines.dispute_keep",
        actorEmail: input.operatorEmail,
        actorName: input.displayName,
        entityId: `${email}|${timestamp}`,
        entityLabel: email,
        details: `content=${content.slice(0, 80)}; amount=${amount}; guided=${guided ?? "none"}`
      });
    }
    parts.push(`fineDisputesResolved=${resolved} openSeen=${openDisputes.length}`);
  } catch (error) {
    ok = false;
    const message = error instanceof Error ? error.message : "dispute resolution failed";
    parts.push(`fineDisputes error=${message}`);
    await logCapabilityAction({
      action: "fines.dispute_fail",
      actorEmail: input.operatorEmail,
      actorName: input.displayName,
      details: message
    });
  }

  return {
    capability: "manageFines",
    ok,
    count,
    summary: parts.join("; ")
  };
}

export async function runScheduleAssignmentActions(input: {
  operatorEmail: string;
  displayName: string;
}): Promise<AiManagerActionResult> {
  try {
    const learningBlock = await getLearningPromptBlock("scheduleAssignment");
    const config = await getCleaningAutoSchedulerConfig();
    if (!config.enabled) {
      await logCapabilityAction({
        action: "schedule.skip",
        actorEmail: input.operatorEmail,
        actorName: input.displayName,
        details: "reason=auto_scheduler_disabled"
      });
      return {
        capability: "scheduleAssignment",
        ok: true,
        count: 0,
        summary: "Cleaning auto-scheduler is disabled in admin settings; no assignments made."
      };
    }

    // Learning guides for schedule are recorded on the action log for owner visibility;
    // assignment still uses the shared fairness algorithm (guides inform future owner reviews).
    const result = await autoScheduleCleaningTasksByJob(config.jobs);
    await logCapabilityAction({
      action: "schedule.assign",
      actorEmail: input.operatorEmail,
      actorName: input.displayName,
      details: `created=${result.created}; skipped=${result.skipped}; learningGuides=${learningBlock ? "yes" : "no"}`
    });
    return {
      capability: "scheduleAssignment",
      ok: true,
      count: result.created,
      summary: `Auto-assigned ${result.created} cleaning slot(s); skipped ${result.skipped}.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "schedule assignment failed";
    await logCapabilityAction({
      action: "schedule.assign_fail",
      actorEmail: input.operatorEmail,
      actorName: input.displayName,
      details: message
    });
    return {
      capability: "scheduleAssignment",
      ok: false,
      count: 0,
      summary: message
    };
  }
}

/** Optional helper for future chat-driven fine creation with hard caps. */
export async function createCappedOperationalFine(input: {
  maHd: string;
  amount: number;
  content: string;
  description?: string;
  operatorEmail: string;
  maxAmountVnd?: number;
}) {
  const maxAmount = input.maxAmountVnd ?? 200_000;
  const amount = Math.min(maxAmount, Math.max(0, Math.trunc(input.amount)));
  if (!amount) {
    throw new Error("Fine amount must be greater than 0.");
  }
  const result = await managerCreateFine({
    maHd: input.maHd,
    amount,
    content: input.content,
    description: input.description,
    operator: input.operatorEmail
  });
  try {
    await sendFineTicketEmail({
      to: result.clientEmail,
      clientName: result.clientName,
      amountVnd: result.amount,
      content: result.content,
      description: result.description,
      location: result.location,
      dueDate: result.dueDate,
      eventAt: result.eventAt,
      operator: input.operatorEmail,
      attachments: result.attachments
    });
  } catch {
    // Email is best-effort; fine row already created.
  }
  return result;
}
