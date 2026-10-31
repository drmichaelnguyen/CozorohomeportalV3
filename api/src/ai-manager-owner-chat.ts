/**
 * Owner ↔ AI Manager chat: owners tell the agent what to do (one-shot actions,
 * capability toggles, standing instructions). Distinct from human Manager AI chat.
 */

import { AI_CHAT_CONTEXT_MESSAGE_LIMIT } from "./ai-chat-constants.js";
import { recordGeminiUsage } from "./ai-usage.js";
import { appendAiToolInvocation, appendAiTrainingExchange } from "./ai-training-log.js";
import { geminiModelDoesNotKnowReply } from "./gemini-capacity-reply.js";
import { completeToolChatRound, type LlmChatContent, type LlmChatTool } from "./llm-tool-chat.js";
import { requirePortalRole } from "./staff-access.js";
import {
  addAiManagerStandingGuide,
  getLearningPromptBlock,
  listAiManagerFeedback
} from "./ai-manager-feedback.js";
import {
  runAnswerChatActions,
  runManageFinesActions,
  runScheduleAssignmentActions
} from "./ai-manager-actions.js";
import {
  formatCapabilitiesForLog,
  formatOpsSnapshotForPrompt,
  type AiManagerCapabilities,
  type AiManagerFeedbackCapability
} from "./ai-manager-logic.js";
import {
  gatherAiManagerOpsSnapshot,
  listAiManagerActionLogs,
  readAiManagerConfig,
  runAiManagerTick,
  updateAiManagerSettings
} from "./ai-manager.js";

export type AiManagerOwnerChatMessage = {
  role: "user" | "model";
  text: string;
};

type UiLanguage = "en" | "vi";

const TOOLS: LlmChatTool[] = [
  {
    functionDeclarations: [
      {
        name: "get_ops_status",
        description:
          "Load current AI Manager settings and a live operations snapshot (support, contracts, cleaning, hostel, AC, fine disputes).",
        parameters: { type: "OBJECT", properties: {}, required: [] }
      },
      {
        name: "run_owner_report",
        description:
          "Run an AI Manager tick now and email/store an owner digest when ownerReports is enabled. Use when the owner asks for a report or status digest.",
        parameters: {
          type: "OBJECT",
          properties: {
            force: {
              type: "BOOLEAN",
              description: "Force the tick even if quiet (default true)"
            }
          },
          required: []
        }
      },
      {
        name: "run_answer_support_chat",
        description:
          "One-shot: draft and send AI Manager replies on personal support threads waiting for staff (same limits/safety as the Answer chat capability). Owner-instructed; does not require the scheduled toggle to be on.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
      },
      {
        name: "run_manage_fines",
        description:
          "One-shot: run missed-cleaning fine sweep and resolve open fine disputes with conservative rules / learning guides.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
      },
      {
        name: "run_schedule_assignment",
        description:
          "One-shot: fill open cleaning schedule slots via the shared auto-assign fairness algorithm (no-ops if admin auto-scheduler is disabled).",
        parameters: { type: "OBJECT", properties: {}, required: [] }
      },
      {
        name: "set_agent_enabled",
        description: "Turn the scheduled AI Manager agent on or off permanently.",
        parameters: {
          type: "OBJECT",
          properties: {
            enabled: { type: "BOOLEAN", description: "true = enable scheduled ticks" }
          },
          required: ["enabled"]
        }
      },
      {
        name: "set_capability",
        description:
          "Enable or disable a scheduled capability: ownerReports, answerChat, manageFines, scheduleAssignment.",
        parameters: {
          type: "OBJECT",
          properties: {
            capability: {
              type: "STRING",
              description: "Which function to toggle",
              enum: ["ownerReports", "answerChat", "manageFines", "scheduleAssignment"]
            },
            enabled: { type: "BOOLEAN", description: "true = allow on scheduled ticks" }
          },
          required: ["capability", "enabled"]
        }
      },
      {
        name: "set_mode",
        description:
          "Set working mode: report_only (safest) or assist (unsent support drafts when answerChat is off).",
        parameters: {
          type: "OBJECT",
          properties: {
            mode: { type: "STRING", enum: ["report_only", "assist"] }
          },
          required: ["mode"]
        }
      },
      {
        name: "set_interval_hours",
        description: "Set scheduled report/tick interval in hours (1–168).",
        parameters: {
          type: "OBJECT",
          properties: {
            hours: { type: "NUMBER", description: "Interval hours between 1 and 168" }
          },
          required: ["hours"]
        }
      },
      {
        name: "add_standing_instruction",
        description:
          "Save a standing owner instruction / learning guide for a capability so future ticks follow it (like Settings feedback guides).",
        parameters: {
          type: "OBJECT",
          properties: {
            capability: {
              type: "STRING",
              enum: ["ownerReports", "answerChat", "manageFines", "scheduleAssignment", "other"]
            },
            guide: {
              type: "STRING",
              description: "Clear instruction the AI Manager should follow for similar future events"
            },
            rating: {
              type: "STRING",
              description: "like = do more of this; dislike = avoid this pattern",
              enum: ["like", "dislike"]
            }
          },
          required: ["capability", "guide"]
        }
      },
      {
        name: "list_recent_actions",
        description: "List recent AI Manager ActionLog rows (what the agent already did).",
        parameters: {
          type: "OBJECT",
          properties: {
            limit: { type: "NUMBER", description: "How many rows (1–20, default 8)" }
          },
          required: []
        }
      },
      {
        name: "list_learning_guides",
        description: "List active owner learning guides / standing instructions.",
        parameters: {
          type: "OBJECT",
          properties: {
            limit: { type: "NUMBER", description: "How many guides (1–20, default 10)" }
          },
          required: []
        }
      }
    ]
  }
];

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asCapabilityKey(value: unknown): keyof AiManagerCapabilities | null {
  const key = String(value ?? "").trim();
  if (
    key === "ownerReports" ||
    key === "answerChat" ||
    key === "manageFines" ||
    key === "scheduleAssignment"
  ) {
    return key;
  }
  return null;
}

function asFeedbackCapability(value: unknown): AiManagerFeedbackCapability {
  const key = String(value ?? "").trim();
  if (
    key === "ownerReports" ||
    key === "answerChat" ||
    key === "manageFines" ||
    key === "scheduleAssignment" ||
    key === "other"
  ) {
    return key;
  }
  return "other";
}

function buildSystemPrompt(
  language: UiLanguage,
  configSummary: string,
  learningHints: string
): string {
  const commonRules = `
You are Cozoro AI Manager speaking with the OWNER (or app admin). You are the same agent that runs scheduled ticks and ActionLog.

Current settings:
${configSummary}

${learningHints ? `Standing / learning guides already on file:\n${learningHints}\n` : ""}

## What you can do (via tools)
- get_ops_status — live ops snapshot + settings
- run_owner_report — produce/email an owner digest now
- run_answer_support_chat — one-shot reply to waiting personal support threads
- run_manage_fines — one-shot missed-cleaning fines + dispute review
- run_schedule_assignment — one-shot cleaning auto-assign
- set_agent_enabled / set_capability / set_mode / set_interval_hours — persist Settings
- add_standing_instruction — save a guide for future similar events
- list_recent_actions / list_learning_guides — audit what you did / what you were taught

## Rules
- You work for the owner. Confirm clearly after every tool that changed something.
- Prefer tools over guessing. Call get_ops_status before claiming how busy ops are.
- One-shot run_* tools execute immediately when the owner asks you to do that work now — even if the scheduled capability toggle is off.
- For ongoing policy ("always…", "never…", "from now on…"), use set_capability and/or add_standing_instruction.
- Do not invent money movements, contract approvals, or bed transfers. Those stay with humans / other portals.
- Sensitive resident topics (deposit refund, terminate, bed transfer, legal) must escalate — never auto-promise those in chat replies you send.
- Keep replies concise for mobile.
`.trim();

  if (language === "vi") {
    return `${commonRules}

## Ngôn ngữ
- Giao diện đang **tiếng Việt**: trả lời owner bằng **tiếng Việt** rõ ràng, tự nhiên.
- Kết quả công cụ có thể tiếng Anh — diễn giải ngắn bằng tiếng Việt.`;
  }

  return `${commonRules}

## Language
- UI is **English**: reply in clear English unless the owner asks for Vietnamese.`;
}

async function executeOwnerChatTool(
  name: string,
  args: Record<string, unknown>,
  actorEmail: string
): Promise<Record<string, unknown>> {
  const config = await readAiManagerConfig();

  switch (name) {
    case "get_ops_status": {
      const snapshot = await gatherAiManagerOpsSnapshot();
      return {
        ok: true,
        enabled: config.enabled,
        mode: config.mode,
        email: config.email,
        displayName: config.displayName,
        intervalHours: config.intervalHours,
        capabilities: config.capabilities,
        lastTickAt: config.lastTickAt,
        lastError: config.lastError,
        snapshot,
        snapshotPrompt: formatOpsSnapshotForPrompt(snapshot)
      };
    }
    case "run_owner_report": {
      const result = await runAiManagerTick({
        trigger: "manual",
        force: asBool(args.force, true)
      });
      return {
        ok: !result.skipped,
        skipped: result.skipped,
        reason: result.reason ?? null,
        reportId: result.report?.id ?? null,
        summaryPreview: result.report?.summaryText?.slice(0, 600) ?? null,
        emailedTo: result.report?.emailedTo ?? [],
        actionsTaken: result.report?.actionsTaken ?? []
      };
    }
    case "run_answer_support_chat": {
      const snapshot = await gatherAiManagerOpsSnapshot();
      const action = await runAnswerChatActions({
        snapshot,
        operatorEmail: config.email,
        displayName: config.displayName
      });
      return { ...action };
    }
    case "run_manage_fines": {
      const action = await runManageFinesActions({
        operatorEmail: config.email,
        displayName: config.displayName
      });
      return { ...action };
    }
    case "run_schedule_assignment": {
      const action = await runScheduleAssignmentActions({
        operatorEmail: config.email,
        displayName: config.displayName
      });
      return { ...action };
    }
    case "set_agent_enabled": {
      const enabled = asBool(args.enabled, config.enabled);
      const next = await updateAiManagerSettings(actorEmail, { enabled });
      return { ok: true, enabled: next.enabled, capabilities: next.capabilities };
    }
    case "set_capability": {
      const capability = asCapabilityKey(args.capability);
      if (!capability) {
        return { ok: false, error: "Unknown capability." };
      }
      const enabled = asBool(args.enabled, false);
      const next = await updateAiManagerSettings(actorEmail, {
        capabilities: { [capability]: enabled }
      });
      return {
        ok: true,
        capability,
        enabled: next.capabilities[capability],
        capabilities: next.capabilities
      };
    }
    case "set_mode": {
      const mode = String(args.mode ?? "").trim() === "assist" ? "assist" : "report_only";
      const next = await updateAiManagerSettings(actorEmail, { mode });
      return { ok: true, mode: next.mode };
    }
    case "set_interval_hours": {
      const hours = Number(args.hours);
      if (!Number.isFinite(hours)) {
        return { ok: false, error: "hours must be a number." };
      }
      const next = await updateAiManagerSettings(actorEmail, { intervalHours: hours });
      return { ok: true, intervalHours: next.intervalHours };
    }
    case "add_standing_instruction": {
      const guide = String(args.guide ?? "").trim();
      if (!guide) return { ok: false, error: "guide is required." };
      const entry = await addAiManagerStandingGuide({
        actorEmail,
        capability: asFeedbackCapability(args.capability),
        guide,
        rating: String(args.rating ?? "").trim() === "dislike" ? "dislike" : "like"
      });
      return {
        ok: true,
        id: entry.id,
        capability: entry.capability,
        rating: entry.rating,
        guide: entry.guide
      };
    }
    case "list_recent_actions": {
      const limit = Math.min(20, Math.max(1, Math.trunc(Number(args.limit) || 8)));
      const actionLogs = await listAiManagerActionLogs(limit);
      return {
        ok: true,
        count: actionLogs.length,
        actions: actionLogs.map((row) => ({
          id: row.id,
          action: row.action,
          details: row.details,
          entityLabel: row.entityLabel,
          createdAt: row.createdAt,
          feedback: row.feedback
            ? { rating: row.feedback.rating, guide: row.feedback.guide }
            : null
        }))
      };
    }
    case "list_learning_guides": {
      const limit = Math.min(20, Math.max(1, Math.trunc(Number(args.limit) || 10)));
      const feedback = await listAiManagerFeedback(limit);
      return {
        ok: true,
        count: feedback.length,
        guides: feedback
          .filter((entry) => entry.guide.trim())
          .map((entry) => ({
            id: entry.id,
            capability: entry.capability,
            rating: entry.rating,
            guide: entry.guide,
            updatedAt: entry.updatedAt
          }))
      };
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export async function handleAiManagerOwnerChat(
  actorEmail: string,
  history: AiManagerOwnerChatMessage[],
  options?: { language?: UiLanguage }
): Promise<{ reply: string }> {
  await requirePortalRole(
    actorEmail,
    ["owner", "app_admin"],
    "Only owners or app admins can chat with the AI Manager."
  );

  const language: UiLanguage = options?.language === "vi" ? "vi" : "en";
  const config = await readAiManagerConfig();
  const configSummary = [
    `enabled=${config.enabled}`,
    `mode=${config.mode}`,
    `email=${config.email}`,
    `displayName=${config.displayName}`,
    `intervalHours=${config.intervalHours}`,
    formatCapabilitiesForLog(config.capabilities),
    `lastTickAt=${config.lastTickAt ?? "never"}`,
    config.lastError ? `lastError=${config.lastError}` : null
  ]
    .filter(Boolean)
    .join("; ");

  const learningHints = (
    await Promise.all([
      getLearningPromptBlock("ownerReports"),
      getLearningPromptBlock("answerChat"),
      getLearningPromptBlock("manageFines"),
      getLearningPromptBlock("scheduleAssignment")
    ])
  )
    .filter(Boolean)
    .join("\n")
    .slice(0, 2500);

  const systemPrompt = buildSystemPrompt(language, configSummary, learningHints);
  const limitedHistory = history.slice(-AI_CHAT_CONTEXT_MESSAGE_LIMIT);
  const contents: LlmChatContent[] = limitedHistory.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  let maxRounds = 6;
  while (maxRounds-- > 0) {
    const requestStartedAt = Date.now();
    const round = await completeToolChatRound({
      systemPrompt,
      contents,
      tools: TOOLS,
      temperature: 0.25,
      maxOutputTokens: 1024,
      geminiKind: "shared"
    });

    void recordGeminiUsage({
      feature: "ai_manager_owner_chat",
      modality: "text",
      actorEmail,
      usage: round.usage,
      provider: round.provider,
      model: round.model,
      status: round.rateLimited
        ? "RATE_LIMITED"
        : round.errorMessage || round.invalidJson
          ? "ERROR"
          : "SUCCESS",
      latencyMs: Date.now() - requestStartedAt
    });

    if (round.errorMessage) {
      throw new Error(round.errorMessage);
    }

    if (round.functionCall) {
      const { name, args } = round.functionCall;
      const toolResult = await executeOwnerChatTool(
        name,
        (args ?? {}) as Record<string, unknown>,
        actorEmail
      );

      void appendAiToolInvocation({
        channel: "manager",
        identifier: actorEmail,
        toolName: name,
        args: (args ?? {}) as Record<string, unknown>,
        result: toolResult,
        language,
        meta: { feature: "ai_manager_owner_chat" }
      });

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response: toolResult } }]
      });
      continue;
    }

    const raw = round.text?.trim() ?? "";
    const reply = raw || geminiModelDoesNotKnowReply(language);
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    void appendAiTrainingExchange({
      channel: "manager",
      identifier: actorEmail,
      language,
      userText: lastUser?.text ?? "",
      modelText: reply,
      meta: { feature: "ai_manager_owner_chat" }
    });
    return { reply };
  }

  const fallback = geminiModelDoesNotKnowReply(language);
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  void appendAiTrainingExchange({
    channel: "manager",
    identifier: actorEmail,
    language,
    userText: lastUser?.text ?? "",
    modelText: fallback,
    meta: { feature: "ai_manager_owner_chat", maxToolRoundsExhausted: true }
  });
  return { reply: fallback };
}
