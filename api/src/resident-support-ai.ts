/**
 * Resident support thread — Gemini replies stored as SupportMessage (ASSISTANT)
 * so managers see the same conversation and can follow up in the shared inbox.
 */

import { SupportMessageSenderRole } from "@prisma/client";

import { getActiveClientByEmail } from "./google-sheets.js";
import { prisma } from "./prisma.js";

const ASSISTANT_SENDER_EMAIL = "cozoro-assistant@system";

const GEMINI_ENDPOINT = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
};

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    content: {
      role: string;
      parts: GeminiPart[];
    };
  }>;
  error?: { message: string };
};

function looksVietnamese(text: string) {
  return /[\u00C0-\u1EF9]/.test(text);
}

function sanitizePhone(raw: unknown) {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.length < 8 || digits.length > 18) return null;
  return digits.slice(0, 48);
}

function sanitizeFacebook(raw: unknown) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.length > 191) return s.slice(0, 191);
  return s;
}

function sanitizeOther(raw: unknown) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.length > 255) return s.slice(0, 255);
  return s;
}

function compressThreadForGemini(
  rows: Array<{ senderRole: SupportMessageSenderRole; senderName: string | null; body: string }>
) {
  const chunks: { role: "user" | "model"; text: string }[] = [];
  for (const m of rows) {
    const role = m.senderRole === SupportMessageSenderRole.RESIDENT ? "user" : "model";
    const label =
      m.senderRole === SupportMessageSenderRole.ASSISTANT
        ? "Assistant"
        : m.senderRole === SupportMessageSenderRole.RESIDENT
          ? "Resident"
          : m.senderName?.trim() || "Staff";
    const text = m.senderRole === SupportMessageSenderRole.RESIDENT ? m.body : `[${label}] ${m.body}`;
    const last = chunks[chunks.length - 1];
    if (last && last.role === role) {
      last.text += `\n\n${text}`;
    } else {
      chunks.push({ role, text });
    }
  }
  const out: GeminiContent[] = chunks.map((c) => ({ role: c.role, parts: [{ text: c.text }] }));
  return out.slice(-24);
}

function buildResidentContextBlock(email: string, client: Record<string, string> | null) {
  if (!client) {
    return `Resident portal email: ${email}\n(No active contract row found in the roster — they may be a prospect or data may be loading.)`;
  }
  const name =
    client["Họ và tên"] ||
    client["HỌ VÀ TÊN"] ||
    client["Tên"] ||
    client["TÊN"] ||
    "";
  const branch = client["Chi nhánh Cozoro dorm"] || client["BRANCH"] || "";
  const room = client["Số phòng"] || client["SỐ PHÒNG"] || client["Phòng"] || client["PHÒNG"] || "";
  const bed = client["số giường"] || client["Số giường"] || "";
  return [
    `Resident portal email: ${email}`,
    name ? `Name (from contract): ${name}` : null,
    branch ? `Branch: ${branch}` : null,
    room ? `Room: ${room}` : null,
    bed ? `Bed: ${bed}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

async function executeSaveResidentContact(
  conversationId: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; note: string }> {
  const phone = sanitizePhone(args.phone);
  const facebook = sanitizeFacebook(args.facebook);
  const other = sanitizeOther(args.other);

  if (!phone && !facebook && !other) {
    return { ok: false, note: "No contact fields provided; skip database update." };
  }

  const exists = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: { id: true }
  });

  if (!exists) {
    return { ok: false, note: "Conversation not found." };
  }

  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: {
      ...(phone ? { residentContactPhone: phone } : {}),
      ...(facebook ? { residentContactFacebook: facebook } : {}),
      ...(other ? { residentContactOther: other } : {})
    }
  });

  return { ok: true, note: "Saved contact fields on the conversation for staff." };
}

function buildSystemPrompt(input: {
  email: string;
  clientBlock: string;
  contactBlock: string;
  preferVietnamese: boolean;
}) {
  const lang = input.preferVietnamese ? "Vietnamese" : "English";
  return `You are "Cozoro Assistant", the first-line helper in the CozoroHome resident support chat (co-living in Ho Chi Minh City).

## Context
${input.clientBlock}

## Already saved callback details (do not ask again for the same item unless the resident wants to change it)
${input.contactBlock}

## Behaviour
- Reply in **${lang}** for the main answer (match the resident's latest message language; use Vietnamese if their message contains Vietnamese diacritics).
- Be concise and friendly. You are not a lawyer; give practical dorm guidance (laundry, cleaning, policies, how to reach staff).
- **Same thread as human staff:** managers read everything here. If the resident needs a human, say a manager will see the chat and can reply — they do not need a separate channel.
- **Collect contact for follow-up** when it would genuinely help: maintenance that needs a call, lost items, payment edge cases, viewing appointments, or if they ask for a callback. Politely ask for **phone number** and/or **Facebook profile or link** and/or **another contact (e.g. Zalo ID)** — only what is missing from the saved details above. Never demand all three at once; one or two is enough.
- If they share contact info in free text, acknowledge it and use the save_resident_contact tool with the parsed values.
- Never invent contract balances, fines, or personal data not in the context block.
- Do not promise discounts or contract changes; suggest staff will confirm.
- No emojis unless the resident uses them first.

## Tools
- Call **save_resident_contact** when the resident clearly provides or confirms a phone number, Facebook username/link, or other contact (Zalo, etc.). Use partial updates: only pass fields you are saving now.`;
}

export async function runResidentSupportAssistantTurn(input: {
  conversationId: string;
  residentEmail: string;
}): Promise<{ replyText: string | null }> {
  if (process.env.RESIDENT_SUPPORT_AI_DISABLED === "1") {
    return { replyText: null };
  }

  if (!process.env.GEMINI_API_KEY) {
    return { replyText: null };
  }

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: input.conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 80
      }
    }
  });

  if (!conversation || conversation.messages.length === 0) {
    return { replyText: null };
  }

  const last = conversation.messages[conversation.messages.length - 1]!;
  if (last.senderRole !== SupportMessageSenderRole.RESIDENT) {
    return { replyText: null };
  }

  const client = await getActiveClientByEmail(input.residentEmail);
  const clientBlock = buildResidentContextBlock(input.residentEmail, client);
  const contactLines: string[] = [];
  if (conversation.residentContactPhone) contactLines.push(`Phone: ${conversation.residentContactPhone}`);
  if (conversation.residentContactFacebook) contactLines.push(`Facebook: ${conversation.residentContactFacebook}`);
  if (conversation.residentContactOther) contactLines.push(`Other: ${conversation.residentContactOther}`);
  const contactBlock = contactLines.length ? contactLines.join("\n") : "(none yet)";

  const preferVietnamese = looksVietnamese(last.body);
  const systemPrompt = buildSystemPrompt({
    email: input.residentEmail,
    clientBlock,
    contactBlock,
    preferVietnamese
  });

  const contents = compressThreadForGemini(
    conversation.messages.map((m) => ({
      senderRole: m.senderRole,
      senderName: m.senderName,
      body: m.body
    }))
  );

  const tools = [
    {
      functionDeclarations: [
        {
          name: "save_resident_contact",
          description:
            "Persist callback details on this support conversation for managers. Call when the resident provides or confirms a phone number, Facebook profile/link, or other contact (e.g. Zalo). Only pass fields you are updating.",
          parameters: {
            type: "OBJECT",
            properties: {
              phone: { type: "STRING", description: "Phone / WhatsApp number with country code if possible" },
              facebook: { type: "STRING", description: "Facebook profile URL or display name" },
              other: { type: "STRING", description: "Other contact such as Zalo ID or alternate messenger" }
            }
          }
        }
      ]
    }
  ];

  let maxRounds = 4;
  while (maxRounds-- > 0) {
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools,
      tool_config: { function_calling_config: { mode: "AUTO" } },
      generation_config: {
        temperature: 0.35,
        max_output_tokens: 768
      }
    };

    const res = await fetch(GEMINI_ENDPOINT(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = (await res.json()) as GeminiResponse;
    if (data.error) {
      console.warn("[resident-support-ai] Gemini error", data.error.message);
      return { replyText: null };
    }

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      return { replyText: null };
    }

    const parts = candidate.content.parts;
    const functionCallPart = parts.find(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p
    );

    if (!functionCallPart) {
      const textPart = parts.find((p): p is { text: string } => "text" in p);
      const replyText = textPart?.text?.trim() || null;
      return { replyText: replyText && replyText.length > 6000 ? replyText.slice(0, 6000) : replyText };
    }

    const { name, args } = functionCallPart.functionCall;
    let toolResponse: Record<string, unknown>;
    if (name === "save_resident_contact") {
      toolResponse = await executeSaveResidentContact(input.conversationId, args);
    } else {
      toolResponse = { ok: false, note: "Unknown tool." };
    }

    contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name, response: toolResponse } }]
    });
  }

  return { replyText: null };
}

export { ASSISTANT_SENDER_EMAIL };
