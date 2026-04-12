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
        description: "Find available or occupied beds. Can filter by branch (D2 or D7).",
        parameters: {
          type: "OBJECT",
          properties: {
            branch: { type: "STRING", description: "Optional branch filter: D2 or D7", enum: ["D2", "D7"] },
            status: { type: "STRING", description: "Filter: 'available' (empty beds) or 'occupied' (all active clients)", enum: ["available", "occupied", "all"] }
          },
          required: ["status"]
        }
      },
      {
        name: "navigate",
        description: "Navigate the manager to a specific view in the portal when the action is too complex for AI to complete automatically.",
        parameters: {
          type: "OBJECT",
          properties: {
            view: {
              type: "STRING",
              description: "The manager view to navigate to",
              enum: ["client_list", "coins", "fines", "payments", "support_chat", "admin_cleaning", "settings", "controller"]
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
    return { result: { success: true, message: `Coins adjusted: ${args.delta > 0 ? "+" : ""}${args.delta} for contract ${args.maHd}` } };
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
    const branch = args.branch as string | undefined;
    const status = args.status as string;

    function normBranch(b: string) {
      return b.toUpperCase().replace(/^D/, "");
    }
    const filtered = branch
      ? clients.filter((c) => normBranch(c.branch) === normBranch(branch))
      : clients;
    const occupiedBeds = new Set(filtered.map((c) => `${normBranch(c.branch)}:${c.bed}`));

    if (status === "occupied" || status === "all") {
      const rows = filtered.map((c) => `${c.name} — Bed ${c.bed}, Branch ${c.branch} (${c.maHd})`);
      return { result: { occupied: rows, count: rows.length } };
    }

    // Available beds: enumerate all known beds per branch and subtract occupied
    const allBeds: { branch: string; bed: number }[] = [];
    const d2Beds = Array.from({ length: 21 }, (_, i) => ({ branch: "D2", bed: i + 1 }));
    const d7Beds = Array.from({ length: 63 }, (_, i) => ({ branch: "D7", bed: i + 1 }));
    (branch === "D2" ? d2Beds : branch === "D7" ? d7Beds : [...d2Beds, ...d7Beds]).forEach((b) => allBeds.push(b));

    const available = allBeds.filter((b) => !occupiedBeds.has(`${b.branch}:${b.bed}`) && !occupiedBeds.has(`${b.branch}:${String(b.bed)}`));
    const rows = available.map((b) => `Branch ${b.branch} Bed ${b.bed}`);
    return { result: { available: rows, count: rows.length } };
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

function buildSystemPrompt(clients: Awaited<ReturnType<typeof buildClientContext>>) {
  const clientList = clients
    .map((c) => `  • ${c.name} | email: ${c.email} | bed: ${c.bed} | branch: ${c.branch} | maHd: ${c.maHd}`)
    .join("\n");

  return `You are a helpful assistant for the managers and owners of CozoroHome, a co-living apartment in Ho Chi Minh City, Vietnam. You help them take actions quickly via chat.

## Active residents (${clients.length} total)
${clientList || "  (no active residents loaded)"}

## What you can do
- Add or deduct coins for a resident (use the add_coins tool)
- Create a fine for a resident (use the create_fine tool)
- Create a payment receipt for a resident (use the create_payment tool)
- Check which beds are available or occupied (use the query_beds tool)
- Navigate to a specific manager view for complex actions (use the navigate tool)

## Rules
- Always identify the resident by matching name, email, bed number, or contract code (maHd) from the list above.
- If the resident cannot be uniquely identified, ask the manager for clarification before calling any action tool.
- If required fields are missing (e.g. amount, reason), ask for them before executing.
- After a successful tool call, confirm what was done in plain language.
- For actions beyond your tools (e.g. editing contract dates, booking laundry), use the navigate tool to send the manager to the right view, explaining what to do there.
- Respond in the same language the manager uses (Vietnamese or English).
- Keep replies concise.`;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function handleManagerAiChat(
  operatorEmail: string,
  history: AiChatMessage[]
): Promise<{ reply: string; navigateTo?: string }> {
  await requirePortalRole(operatorEmail, ["manager", "owner", "app_admin"], "Only managers can use the AI assistant.");

  const clients = await buildClientContext();
  const systemPrompt = buildSystemPrompt(clients);

  // Convert chat history to Gemini content format
  const contents: GeminiContent[] = history.map((msg) => ({
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
      return { reply: textPart?.text ?? "(no response)", navigateTo };
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

  return { reply: "I ran into an issue processing your request. Please try again.", navigateTo };
}
