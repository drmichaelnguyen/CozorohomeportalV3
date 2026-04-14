/**
 * Manager AI Chat — Gemini Flash 2.5 via REST API
 *
 * Supported actions (executed server-side after model confirms intent):
 *   add_coins      — POST /manager/coins/adjust
 *   create_fine    — POST /manager/fines
 *   create_payment — POST /manager/payments/create
 *   navigate       — tell the frontend to switch to a manager view
 *   query_beds     — answer which beds are available / occupied
 */

import { AI_CHAT_CONTEXT_MESSAGE_LIMIT } from "./ai-chat-constants.js";
import { appendAiTrainingExchange } from "./ai-training-log.js";
import { geminiModelDoesNotKnowReply } from "./gemini-capacity-reply.js";
import { tryFounderEasterEggReply } from "./cozoro-founder-easter-egg.js";
import { getManagerClients, getManagerInactiveClients } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";

const GEMINI_ENDPOINT = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiChatMessage = {
  role: "user" | "model";
  text: string;
};

type GeminiPart = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } } | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters?: {
      type: string;
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content: {
      role: string;
      parts: GeminiPart[];
    };
    finishReason?: string;
  }>;
  error?: { message: string };
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: GeminiTool[] = [
  {
    functionDeclarations: [
      {
        name: "add_coins",
        description: "Add or deduct coins from a resident's account. Use positive delta to add, negative to deduct.",
        parameters: {
          type: "OBJECT",
          properties: {
            maHd: { type: "STRING", description: "Contract code (MÃ HD) of the resident" },
            delta: { type: "NUMBER", description: "Number of coins to add (positive) or deduct (negative)" },
            reason: { type: "STRING", description: "Reason for the coin adjustment" }
          },
          required: ["maHd", "delta", "reason"]
        }
      },
      {
        name: "create_fine",
        description: "Create a fine for a resident.",
        parameters: {
          type: "OBJECT",
          properties: {
            maHd: { type: "STRING", description: "Contract code (MÃ HD) of the resident" },
            amount: { type: "NUMBER", description: "Fine amount in VND (must be positive)" },
            content: { type: "STRING", description: "Short description / title of the fine" },
            description: { type: "STRING", description: "Optional detailed explanation" },
            location: { type: "STRING", description: "Optional location (e.g. Kitchen, Room 2.1)" },
            dueDate: { type: "STRING", description: "Optional due date in YYYY-MM-DD format" }
          },
          required: ["maHd", "amount", "content"]
        }
      },
      {
        name: "create_payment",
        description: "Create a rent or service payment receipt for a resident.",
        parameters: {
          type: "OBJECT",
          properties: {
            maHd: { type: "STRING", description: "Contract code (MÃ HD) of the resident" },
            amount: { type: "NUMBER", description: "Payment amount in VND (must be positive)" },
            purpose: { type: "STRING", description: "Purpose label (e.g. 'Tiền thuê tháng 5/2026')" },
            details: { type: "STRING", description: "Optional additional details" },
            payer: { type: "STRING", description: "Optional name of who paid" }
          },
          required: ["maHd", "amount", "purpose"]
        }
      },
      {
        name: "query_beds",
        description:
          "Report bed occupancy against the fixed inventory (D2: beds 1–21, D7: beds 1–63). Active residents (Hiện còn ở = 1) occupy beds. Always use this tool for counts or lists of free beds — do not infer from the chat resident list alone.",
        parameters: {
          type: "OBJECT",
          properties: {
            branch: { type: "STRING", description: "Optional branch filter: D2 or D7", enum: ["D2", "D7"] },
            status: {
              type: "STRING",
              description:
                "'available' returns empty beds; 'occupied' lists active residents on beds; 'all' returns totalInventoryBeds plus available and occupied summaries",
              enum: ["available", "occupied", "all"]
            }
          },
          required: ["status"]
        }
      },
      {
        name: "navigate",
        description:
          "Navigate the manager UI. Top-level views: overview, scheduling, short_term, etc. Values coins/fines/payments open the Client list with that resident's stats tab (same as clicking Coins/Fines/Payments on a selected client — pick client_list + tab when a client is already in context).",
        parameters: {
          type: "OBJECT",
          properties: {
            view: {
              type: "STRING",
              description:
                "Portal view key. Use overview, client_list, scheduling, support_chat, settings, controller, admin_cleaning, short_term, feedbacks, owners_employees for main tabs. Use coins, fines, or payments only to jump to those stats subtabs under Client list.",
              enum: [
                "overview",
                "client_list",
                "scheduling",
                "support_chat",
                "settings",
                "controller",
                "admin_cleaning",
                "short_term",
                "feedbacks",
                "owners_employees",
                "coins",
                "fines",
                "payments"
              ]
            },
            reason: { type: "STRING", description: "Why navigation is needed" }
          },
          required: ["view", "reason"]
        }
      }
    ]
  }
];

// ─── Client context builder ────────────────────────────────────────────────────

async function buildClientContext() {
  const clients = await getManagerClients();
  const active = clients.filter((c) => String(c.activeStay).trim() === "1");

  const summary = active.map((c) => ({
    name: c.name || "(unnamed)",
    email: c.email || "",
    maHd: c.maHd || "",
    bed: String(c.bed || ""),
    branch: String(c.branch || "")
  }));

  return summary;
}

// ─── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  operatorEmail: string
): Promise<{ result: Record<string, unknown>; navigateTo?: string }> {
  const API_BASE = `http://localhost:${process.env.PORT ?? 4000}`;

  if (toolName === "add_coins") {
    const res = await fetch(`${API_BASE}/manager/coins/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maHd: args.maHd,
        delta: Number(args.delta),
        reason: args.reason,
        operator: operatorEmail
      })
    });
    const data = await res.json();
    if (!res.ok) return { result: { error: (data as any).error ?? "Failed to adjust coins" } };
    const delta = Number(args.delta);
    return {
      result: {
        success: true,
        message: `Coins adjusted: ${delta > 0 ? "+" : ""}${delta} for contract ${String(args.maHd ?? "")}`
      }
    };
  }

  if (toolName === "create_fine") {
    const res = await fetch(`${API_BASE}/manager/fines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maHd: args.maHd,
        amount: Number(args.amount),
        content: args.content,
        description: args.description,
        location: args.location,
        dueDate: args.dueDate,
        operator: operatorEmail
      })
    });
    const data = await res.json();
    if (!res.ok) return { result: { error: (data as any).error ?? "Failed to create fine" } };
    return { result: { success: true, message: `Fine created: ${Number(args.amount).toLocaleString()} VND for contract ${args.maHd}` } };
  }

  if (toolName === "create_payment") {
    const res = await fetch(`${API_BASE}/manager/payments/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorEmail: operatorEmail,
        maHd: args.maHd,
        amount: Number(args.amount),
        purpose: args.purpose,
        details: args.details,
        payer: args.payer
      })
    });
    const data = await res.json();
    if (!res.ok) return { result: { error: (data as any).error ?? "Failed to create payment" } };
    return { result: { success: true, message: `Payment receipt created: ${Number(args.amount).toLocaleString()} VND for contract ${args.maHd}` } };
  }

  if (toolName === "query_beds") {
    const clients = await buildClientContext();
    const branchArg = (args.branch as string | undefined)?.trim().toUpperCase();
    const branchFilter: "D2" | "D7" | null =
      branchArg === "D2" || branchArg === "D7" ? branchArg : null;
    const status = String(args.status ?? "available");

    function canonicalBranch(raw: string): "D2" | "D7" {
      const n = String(raw ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      if (n === "7" || n === "D7" || n.includes("D7") || n.includes("AD7")) {
        return "D7";
      }
      return "D2";
    }

    function parseBedNum(bed: string): number | null {
      const n = Number.parseInt(String(bed ?? "").replace(/\D/g, ""), 10);
      if (!Number.isFinite(n) || n < 1) {
        return null;
      }
      return n;
    }

    const scoped = branchFilter ? clients.filter((c) => canonicalBranch(c.branch) === branchFilter) : clients;

    const occupiedKeys = new Set<string>();
    for (const c of scoped) {
      const b = canonicalBranch(c.branch);
      const n = parseBedNum(String(c.bed));
      if (n != null) {
        occupiedKeys.add(`${b}:${n}`);
      }
    }

    const d2Beds = Array.from({ length: 21 }, (_, i) => ({ branch: "D2" as const, bed: i + 1 }));
    const d7Beds = Array.from({ length: 63 }, (_, i) => ({ branch: "D7" as const, bed: i + 1 }));
    const inventory =
      branchFilter === "D2" ? d2Beds : branchFilter === "D7" ? d7Beds : [...d2Beds, ...d7Beds];

    if (status === "occupied") {
      const rows = scoped.map((c) => `${c.name} — ${canonicalBranch(c.branch)} bed ${c.bed} (maHd ${c.maHd})`);
      return {
        result: {
          occupiedCount: rows.length,
          occupied: rows,
          branchFilter: branchFilter ?? "all"
        }
      };
    }

    const available = inventory.filter((slot) => !occupiedKeys.has(`${slot.branch}:${slot.bed}`));
    const availableRows = available.map((slot) => `${slot.branch} bed ${slot.bed}`);

    if (status === "all") {
      const occRows = scoped.map((c) => `${c.name} — ${canonicalBranch(c.branch)} bed ${c.bed} (maHd ${c.maHd})`);
      return {
        result: {
          branchFilter: branchFilter ?? "all",
          totalInventoryBeds: inventory.length,
          occupiedCount: occRows.length,
          occupied: occRows,
          availableCount: available.length,
          availableBeds: availableRows
        }
      };
    }

    return {
      result: {
        branchFilter: branchFilter ?? "all",
        totalInventoryBeds: inventory.length,
        availableCount: available.length,
        availableBeds: availableRows
      }
    };
  }

  if (toolName === "navigate") {
    return {
      result: { navigating: true, view: args.view, reason: args.reason },
      navigateTo: args.view as string
    };
  }

  return { result: { error: `Unknown tool: ${toolName}` } };
}

// ─── System prompt ─────────────────────────────────────────────────────────────

type UiLanguage = "en" | "vi";

function buildSystemPrompt(clients: Awaited<ReturnType<typeof buildClientContext>>, language: UiLanguage) {
  const clientList = clients
    .map((c) => `  • ${c.name} | email: ${c.email} | bed: ${c.bed} | branch: ${c.branch} | maHd: ${c.maHd}`)
    .join("\n");

  if (language === "vi") {
    return `Bạn là trợ lý AI cho quản lý và chủ sở hữu CozoroHome — ký túc xá co-living tại TP. Hồ Chí Minh, Việt Nam. Bạn giúp họ thao tác nhanh qua đoạn chat.

## Cư dân đang ở (${clients.length} người)
${clientList || "  (chưa tải được danh sách)"}

## Việc bạn có thể làm
- Cộng hoặc trừ coin cho cư dân (công cụ add_coins)
- Tạo phiếu phạt (create_fine)
- Tạo biên lai thanh toán / dịch vụ (create_payment)
- Kiểm tra giường trống hoặc đang có người (query_beds — luôn gọi công cụ này khi hỏi số giường trống/đang ở; đừng đoán từ danh sách cư dân)
- Chuyển quản lý sang màn hình phù hợp khi việc phức tạp hơn khả năng tự động (navigate)

## Quy tắc
- Luôn nhận diện cư dân bằng tên, email, số giường, hoặc mã hợp đồng (maHd) trong danh sách trên.
- Nếu không chắc chắn một người, hỏi lại quản lý trước khi gọi công cụ.
- Thiếu số tiền, lý do, v.v. thì hỏi bổ sung trước khi thực hiện.
- Sau khi công cụ chạy thành công, xác nhận ngắn gọn đã làm gì.
- Việc ngoài phạm vi công cụ (sửa ngày hợp đồng, đặt giặt, v.v.) — dùng navigate và hướng dẫn quản lý bước tiếp theo.

## Ngôn ngữ (quan trọng)
- Giao diện đang là **tiếng Việt**: mọi câu trả lời cho quản lý phải bằng **tiếng Việt** rõ ràng, tự nhiên, ưu tiên văn phong quản lý nhà ở chia sẻ (có thể dùng thuật ngữ tiếng Anh chuyên ngành khi cần: coin, bed, branch D2/D7).
- Dù quản lý nhập tiếng Việt hay tiếng Anh, bạn vẫn trả lời bằng **tiếng Việt**.
- Kết quả thô từ công cụ có thể là tiếng Anh — hãy **diễn giải lại** cho quản lý bằng tiếng Việt, ngắn gọn.
- Giữ câu trả lời gọn, dễ đọc trên điện thoại.`;
  }

  return `You are a helpful assistant for the managers and owners of CozoroHome, a co-living apartment in Ho Chi Minh City, Vietnam. You help them take actions quickly via chat.

## Active residents (${clients.length} total)
${clientList || "  (no active residents loaded)"}

## What you can do
- Add or deduct coins for a resident (use the add_coins tool)
- Create a fine for a resident (use the create_fine tool)
- Create a payment receipt for a resident (use the create_payment tool)
- Check which beds are available or occupied (use the query_beds tool — always call it for counts or lists of empty beds; do not infer availability only from the resident list)
- Navigate to a specific manager view for complex actions (use the navigate tool)

## Rules
- Always identify the resident by matching name, email, bed number, or contract code (maHd) from the list above.
- If the resident cannot be uniquely identified, ask the manager for clarification before calling any action tool.
- If required fields are missing (e.g. amount, reason), ask for them before executing.
- After a successful tool call, confirm what was done in plain language.
- For actions beyond your tools (e.g. editing contract dates, booking laundry), use the navigate tool to send the manager to the right view, explaining what to do there.

## Language
- The manager UI is set to **English**: reply in **clear English** unless they explicitly ask for Vietnamese.
- If tool responses are in mixed form, summarize clearly for the manager.
- Keep replies concise.`;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function handleManagerAiChat(
  operatorEmail: string,
  history: AiChatMessage[],
  options?: { language?: UiLanguage }
): Promise<{ reply: string; navigateTo?: string; showStarfieldEffect?: true }> {
  await requirePortalRole(operatorEmail, ["manager", "owner", "app_admin"], "Only managers can use the AI assistant.");

  const language: UiLanguage = options?.language === "vi" ? "vi" : "en";
  const lastUserEgg = [...history].reverse().find((m) => m.role === "user");
  const founderEgg = tryFounderEasterEggReply(lastUserEgg?.text ?? "", language);
  if (founderEgg) {
    void appendAiTrainingExchange({
      channel: "manager",
      identifier: operatorEmail,
      language,
      userText: lastUserEgg?.text ?? "",
      modelText: founderEgg.reply,
      meta: { founderEasterEgg: true }
    });
    return { reply: founderEgg.reply, showStarfieldEffect: founderEgg.showStarfieldEffect };
  }

  const clients = await buildClientContext();
  const systemPrompt = buildSystemPrompt(clients, language);

  const limitedHistory = history.slice(-AI_CHAT_CONTEXT_MESSAGE_LIMIT);
  const contents: GeminiContent[] = limitedHistory.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  let navigateTo: string | undefined;
  let maxRounds = 5; // prevent infinite tool loops

  while (maxRounds-- > 0) {
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: TOOLS,
      tool_config: { function_calling_config: { mode: "AUTO" } },
      generation_config: {
        temperature: 0.3,
        max_output_tokens: 1024
      }
    };

    const res = await fetch(GEMINI_ENDPOINT(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = (await res.json()) as GeminiResponse;

    if (data.error) {
      throw new Error(data.error.message);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No response from AI");

    const parts = candidate.content.parts;

    // Check if the model wants to call a function
    const functionCallPart = parts.find((p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
      "functionCall" in p
    );

    if (!functionCallPart) {
      // Model produced a text response — done
      const textPart = parts.find((p): p is { text: string } => "text" in p);
      const raw = textPart?.text?.trim() ?? "";
      const reply = raw || geminiModelDoesNotKnowReply(language);
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      void appendAiTrainingExchange({
        channel: "manager",
        identifier: operatorEmail,
        language,
        userText: lastUser?.text ?? "",
        modelText: reply,
        meta: navigateTo ? { navigateTo } : undefined
      });
      return { reply, navigateTo };
    }

    // Execute the tool
    const { name, args } = functionCallPart.functionCall;
    const toolResult = await executeTool(name, args, operatorEmail);
    if (toolResult.navigateTo) navigateTo = toolResult.navigateTo;

    // Append model turn (function call) and tool result to contents
    contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name, response: toolResult.result } }]
    });
  }

  const fallback = geminiModelDoesNotKnowReply(language);
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  void appendAiTrainingExchange({
    channel: "manager",
    identifier: operatorEmail,
    language,
    userText: lastUser?.text ?? "",
    modelText: fallback,
    meta: { maxToolRoundsExhausted: true, ...(navigateTo ? { navigateTo } : {}) }
  });
  return { reply: fallback, navigateTo };
}
