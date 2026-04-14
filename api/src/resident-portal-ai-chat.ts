/**
 * Resident-only **Cozoro Bee** chat (Messages tab) — Gemini 2.5 Flash with a **separate** API key
 * from manager AI (`GEMINI_API_KEY`). Uses `GEMINI_RESIDENT_PORTAL_AI_API_KEY`.
 *
 * Tools only return data scoped to the authenticated resident email (server-enforced).
 */

import { CleaningAvailabilityType } from "@prisma/client";

import { AI_CHAT_CONTEXT_MESSAGE_LIMIT } from "./ai-chat-constants.js";
import { appendAiTrainingExchange } from "./ai-training-log.js";

import { calculateRentBreakdown, computePrepaidNextPaymentEstimate } from "./calculation-engine.js";
import { getCleaningOverviewForUser } from "./cleaning.js";
import {
  createLaundryBooking,
  getActiveClientByEmail,
  getCoinsForEmail,
  getLaundryAvailabilityForMachine,
  getLaundryBookingContextForEmail,
  getLaundryBookingsForEmail,
  getPaymentsForEmail,
  type LaundryPaymentMethod
} from "./google-sheets.js";
import { getConfirmedPrepaidBillingForResident } from "./manager-prepaid-package.js";
import { applyPrepaidBreakdownOverridesToEstimate } from "./prepaid-breakdown-overrides.js";
import type { PrepaidBreakdownOverrides } from "./prepaid-breakdown-overrides.js";
import { prisma } from "./prisma.js";
import { getPortalUxSettings } from "./portal-ux-settings.js";
import { resolvePortalLogin } from "./staff-access.js";

export type ResidentPortalAiMessage = {
  role: "user" | "model";
  text: string;
};

type UiLanguage = "en" | "vi";

function residentGeminiEndpoint(): string {
  const key = process.env.GEMINI_RESIDENT_PORTAL_AI_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_RESIDENT_PORTAL_AI_API_KEY is not configured");
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

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

function clipJson(value: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}\n…(truncated)`;
  } catch {
    return "(unserializable)";
  }
}

/** Resident sheet row **or** portal staff (managers browsing user view use the same Messages tab). */
function assertEligibleForResidentPortalAi(email: string) {
  return resolvePortalLogin(email).then((login) => {
    if (!login.allowed || !login.role) {
      throw new Error("Cozoro Bee: this login is not allowed.");
    }
    if (login.source === "client" && login.role === "user") return;
    if (login.source === "staff") return;
    throw new Error("Cozoro Bee: this login is not allowed.");
  });
}

const PROFILE_COLUMNS = [
  "Họ và tên",
  "HỌ VÀ TÊN",
  "Địa chỉ email",
  "Chi nhánh Cozoro dorm",
  "Số phòng",
  "SỐ PHÒNG",
  "số giường",
  "MÃ HD",
  "Ngày bắt đầu hợp đồng",
  "Ngày hết hạn hợp đồng",
  "Số tiền cọc",
  "Cozoro coins hiện có",
  "Bạn muốn thanh toán chi phí như thế nào?"
];

async function buildRentSnapshot(email: string): Promise<Record<string, unknown>> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [record, portalUx] = await Promise.all([
    prisma.monthlyRentStatus.findUnique({ where: { email_month: { email, month } } }),
    getPortalUxSettings()
  ]);
  const applyCoinsTowardRent = record?.applyCoinsTowardRent === true;
  const client = await getActiveClientByEmail(email);
  if (!client) {
    return {
      email,
      month,
      isPaid: record?.isPaid ?? false,
      applyCoinsTowardRent,
      breakdown: null,
      onPrepaidPlan: false,
      note: "No active roster row for this email."
    };
  }
  const paymentPlan = String(client["Bạn muốn thanh toán chi phí như thế nào?"] ?? "");
  const onPrepaidPlan = paymentPlan.includes("03 tháng") || paymentPlan.includes("06 tháng");

  if (onPrepaidPlan || (record?.isPaid ?? false)) {
    const baseEstimate = onPrepaidPlan ? await computePrepaidNextPaymentEstimate(client, month) : null;
    let prepaidNextPaymentEstimate = baseEstimate;
    if (baseEstimate) {
      const billing = await getConfirmedPrepaidBillingForResident(email, month);
      if (billing?.confirmed) {
        const withLines =
          billing.breakdownOverrides != null
            ? applyPrepaidBreakdownOverridesToEstimate(
                baseEstimate,
                billing.breakdownOverrides as PrepaidBreakdownOverrides
              )
            : baseEstimate;
        prepaidNextPaymentEstimate = {
          ...withLines,
          engineEstimatedTotalVnd: baseEstimate.estimatedTotalVnd,
          estimatedTotalVnd: billing.managerPackageTotalVnd,
          managerPackageNote: billing.managerNote ?? null,
          prepaidManagerConfirmed: true
        };
      }
    }
    return {
      email,
      month,
      isPaid: record?.isPaid ?? onPrepaidPlan,
      applyCoinsTowardRent,
      onPrepaidPlan,
      prepaidNextPaymentEstimate,
      blockingRentDuePopupEnabled: portalUx.blockingRentDuePopupEnabled
    };
  }

  const breakdown = await calculateRentBreakdown(client, month, {
    managerDiscountVnd: 0,
    applyCoinsTowardRent
  });
  return {
    email,
    month,
    isPaid: false,
    applyCoinsTowardRent,
    breakdown,
    onPrepaidPlan: false,
    blockingRentDuePopupEnabled: portalUx.blockingRentDuePopupEnabled
  };
}

async function executeResidentTool(
  name: string,
  args: Record<string, unknown>,
  residentEmail: string
): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_my_profile": {
      const client = await getActiveClientByEmail(residentEmail);
      if (!client) {
        return { ok: false, message: "No active contract row for your email." };
      }
      const profile: Record<string, string> = {};
      for (const col of PROFILE_COLUMNS) {
        const v = client[col];
        if (v != null && String(v).trim()) {
          profile[col] = String(v).trim();
        }
      }
      return { ok: true, profile };
    }
    case "get_my_cleaning": {
      const overview = await getCleaningOverviewForUser(residentEmail, { forceRefresh: false });
      return { ok: true, overviewJson: clipJson(overview, 14000) };
    }
    case "get_my_laundry_status": {
      const ctx = await getLaundryBookingContextForEmail(residentEmail);
      if (!ctx) {
        return { ok: false, message: "Laundry is not available (no active client row)." };
      }
      const bookings = await getLaundryBookingsForEmail(residentEmail);
      const upcoming = bookings
        .filter((b) => new Date(b.start).getTime() >= Date.now() - 60 * 60 * 1000)
        .slice(0, 8);
      return {
        ok: true,
        branchId: ctx.branchId,
        allowance: ctx.allowance,
        machines: ctx.machines.map((m) => ({
          id: m.id,
          label: m.label,
          type: m.type,
          durationMinutes: m.durationMinutes,
          coinPrice: m.coinPrice,
          allowsFreeLaundry: m.allowsFreeLaundry
        })),
        recentOrUpcomingBookings: upcoming.map((b) => ({
          id: b.id,
          summary: b.summary,
          start: b.start,
          end: b.end,
          calendarSummary: b.calendarSummary
        }))
      };
    }
    case "get_laundry_open_slots": {
      const machineId = String(args.machineId ?? "").trim();
      if (!machineId) {
        return { ok: false, message: "machineId is required." };
      }
      const result = await getLaundryAvailabilityForMachine({
        email: residentEmail,
        machineId,
        days: 7,
        forceRefresh: true
      });
      return { ok: true, availabilityJson: clipJson(result, 14000) };
    }
    case "book_my_laundry": {
      const machineId = String(args.machineId ?? "").trim();
      const start = String(args.start ?? "").trim();
      if (!machineId || !start) {
        return { ok: false, message: "machineId and start (ISO datetime) are required." };
      }
      const bookingStart = new Date(start);
      if (Number.isNaN(bookingStart.getTime())) {
        return { ok: false, message: "Invalid start datetime." };
      }
      const bookingDate = new Date(
        Date.UTC(bookingStart.getFullYear(), bookingStart.getMonth(), bookingStart.getDate())
      );
      const nextDate = new Date(bookingDate.getTime() + 24 * 60 * 60 * 1000);
      const unavailable = await prisma.cleaningAvailability.findFirst({
        where: {
          userEmail: residentEmail.trim().toLowerCase(),
          type: CleaningAvailabilityType.UNAVAILABLE,
          date: { gte: bookingDate, lt: nextDate }
        }
      });
      if (unavailable) {
        return {
          ok: false,
          message:
            "You marked this date as away/unavailable for cleaning. Remove that mark before booking laundry on this day."
        };
      }
      const pm = args.paymentMethod;
      const paymentMethod =
        pm === "FREE_LAUNDRY" || pm === "COINS" || pm === "CASH" ? (pm as LaundryPaymentMethod) : undefined;
      try {
        const booking = await createLaundryBooking({
          email: residentEmail,
          machineId,
          start,
          paymentMethod
        });
        return {
          ok: true,
          booking: {
            id: booking.id,
            summary: booking.summary,
            start: booking.start,
            end: booking.end,
            htmlLink: booking.htmlLink,
            syncWarnings: booking.syncWarnings ?? []
          }
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Booking failed." };
      }
    }
    case "get_my_coins": {
      const entries = await getCoinsForEmail(residentEmail);
      const slim = entries.slice(0, 18).map(({ row, parsedTimestamp }) => ({
        time: parsedTimestamp,
        row: Object.fromEntries(
          Object.entries(row)
            .filter(([, v]) => String(v ?? "").trim())
            .slice(0, 12)
        )
      }));
      return { ok: true, recentEntriesJson: clipJson(slim, 12000) };
    }
    case "get_my_payments": {
      const entries = await getPaymentsForEmail(residentEmail);
      const slim = entries.slice(0, 12).map(({ row, parsedTimestamp }) => ({
        time: parsedTimestamp,
        row: Object.fromEntries(
          Object.entries(row)
            .filter(([, v]) => String(v ?? "").trim())
            .slice(0, 12)
        )
      }));
      return { ok: true, recentPaymentsJson: clipJson(slim, 12000) };
    }
    case "get_my_rent_status": {
      const snap = await buildRentSnapshot(residentEmail.trim().toLowerCase());
      return { ok: true, rentJson: clipJson(snap, 14000) };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}

const TOOLS: GeminiTool[] = [
  {
    functionDeclarations: [
      {
        name: "get_my_profile",
        description:
          "Load this resident's own contract row fields (name, branch, room, bed, contract dates, deposit, coins on sheet, payment plan). No other residents.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_my_cleaning",
        description: "Cleaning schedule overview for this resident only (tasks, availability context).",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_my_laundry_status",
        description:
          "Laundry machines for their branch, allowance/coins for laundry, and a few upcoming bookings for this email only.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_laundry_open_slots",
        description: "Open time slots for a specific machine over the next 7 days. Always pick machineId from get_my_laundry_status.",
        parameters: {
          type: "OBJECT",
          properties: {
            machineId: { type: "STRING", description: "Machine id from the portal laundry list" }
          },
          required: ["machineId"]
        }
      },
      {
        name: "book_my_laundry",
        description:
          "Create a laundry booking for this resident. Use an ISO start time that appears in get_laundry_open_slots for the same machine.",
        parameters: {
          type: "OBJECT",
          properties: {
            machineId: { type: "STRING", description: "Machine id" },
            start: { type: "STRING", description: "Start time ISO 8601 (must match an open slot)" },
            paymentMethod: {
              type: "STRING",
              description: "Optional: FREE_LAUNDRY, COINS, or CASH — omit to let the server choose.",
              enum: ["FREE_LAUNDRY", "COINS", "CASH"]
            }
          },
          required: ["machineId", "start"]
        }
      },
      {
        name: "get_my_coins",
        description: "Recent coin ledger rows for this resident's email only.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_my_payments",
        description: "Recent payment receipt rows for this resident's email only.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_my_rent_status",
        description:
          "Current month rent status, breakdown or prepaid next-payment estimate — only for this resident.",
        parameters: { type: "OBJECT", properties: {} }
      }
    ]
  }
];

function buildSystemPrompt(language: UiLanguage, residentEmail: string) {
  const common = `You are **Cozoro Bee**, the friendly bee mascot of CozoroHome — a co-living resident portal in Ho Chi Minh City. You speak in first person as Cozoro Bee (warm, concise, never arrogant).

## Authenticated portal email
- The only account you may access (resident **or** staff in user view): ${residentEmail}

## Hard rules
- You must **never** reveal or infer other residents' names, emails, rooms, fines, or schedules.
- Only use facts returned by your tools (each tool is server-scoped to this email's sheet rows and portal data).
- If tools return nothing or an error, say so honestly; do not invent numbers.
- Prefer **concise** answers. Offer step-by-step only when booking laundry or interpreting a schedule.
- For laundry booking: first call get_my_laundry_status, then get_laundry_open_slots for the chosen machine, then book_my_laundry with an exact slot. Confirm date/time in local wording.
- Payments/rent: summarize amounts and due status clearly; mention if figures are estimates from the roster.
- This Bee chat is **not** the same as the human **Messages / Support** thread — still be professional; for disputes or sensitive issues, suggest that thread.
- When introducing yourself, say you are **Cozoro Bee**, CozoroHome's bee mascot (in Vietnamese you may say "mình là Cozoro Bee, linh vật ong của CozoroHome").`;

  if (language === "vi") {
    return `${common}

## Ngôn ngữ
- Trả lời chính bằng **tiếng Việt** rõ ràng, thân thiện; xưng hô là Cozoro Bee ("mình") như linh vật ong nhỏ (có thể giữ từ tiếng Anh ngắn: laundry, coins).`;
  }

  return `${common}

## Language
- Reply in **clear English** as Cozoro Bee (friendly "I" voice). Short Vietnamese words in the resident's message are fine to mirror.`;
}

export async function handleResidentPortalAiChat(
  residentEmail: string,
  history: ResidentPortalAiMessage[],
  options?: { language?: UiLanguage }
): Promise<{ reply: string }> {
  if (process.env.RESIDENT_PORTAL_AI_DISABLED === "1") {
    throw new Error("Cozoro Bee is temporarily disabled.");
  }

  await assertEligibleForResidentPortalAi(residentEmail);
  const language: UiLanguage = options?.language === "vi" ? "vi" : "en";
  const systemPrompt = buildSystemPrompt(language, residentEmail.trim().toLowerCase());

  const limitedHistory = history.slice(-AI_CHAT_CONTEXT_MESSAGE_LIMIT);
  const contents: GeminiContent[] = limitedHistory.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const normalizedEmail = residentEmail.trim().toLowerCase();
  let maxRounds = 6;

  while (maxRounds-- > 0) {
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: TOOLS,
      tool_config: { function_calling_config: { mode: "AUTO" } },
      generation_config: {
        temperature: 0.25,
        max_output_tokens: 1024
      }
    };

    const res = await fetch(residentGeminiEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = (await res.json()) as GeminiResponse;
    if (data.error) {
      throw new Error(data.error.message ?? "Gemini error");
    }

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error("No response from AI");
    }

    const parts = candidate.content.parts;
    const functionCallPart = parts.find(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p
    );

    if (!functionCallPart) {
      const textPart = parts.find((p): p is { text: string } => "text" in p);
      const reply = textPart?.text?.trim() || "(no response)";
      const trimmed = reply.length > 8000 ? reply.slice(0, 8000) : reply;
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      void appendAiTrainingExchange({
        channel: "resident_portal",
        identifier: normalizedEmail,
        language,
        userText: lastUser?.text ?? "",
        modelText: trimmed
      });
      return { reply: trimmed };
    }

    const { name, args } = functionCallPart.functionCall;
    const toolResponse = await executeResidentTool(name, args ?? {}, normalizedEmail);

    contents.push({ role: "model", parts: [{ functionCall: { name, args: args ?? {} } }] });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name, response: toolResponse } }]
    });
  }

  const fallback = "I could not finish that in one go. Please ask again or narrow your question.";
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  void appendAiTrainingExchange({
    channel: "resident_portal",
    identifier: normalizedEmail,
    language,
    userText: lastUser?.text ?? "",
    modelText: fallback,
    meta: { maxToolRoundsExhausted: true }
  });
  return { reply: fallback };
}
