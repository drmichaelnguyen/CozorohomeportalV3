/**
 * Resident-only **Cozoro Bee** chat (Messages tab) — Gemini 2.5 Flash.
 * Prefers `GEMINI_RESIDENT_PORTAL_AI_API_KEY`; if unset, falls back to `GEMINI_API_KEY` (same as manager / support AI).
 *
 * Tools only return data scoped to the authenticated resident email (server-enforced).
 */

import { CleaningAvailabilityType } from "@prisma/client";

import { AI_CHAT_CONTEXT_MESSAGE_LIMIT } from "./ai-chat-constants.js";
import { appendAiTrainingExchange } from "./ai-training-log.js";
import { tryFounderEasterEggReply } from "./cozoro-founder-easter-egg.js";
import {
  tryVentHammerConsentReply,
  tryVentHammerHateReply,
  tryVentHammerPendingRefusalReply
} from "./cozoro-vent-hammer-easter-egg.js";

import { computePrepaidNextPaymentEstimate } from "./calculation-engine.js";
import { calculateRentBreakdownForBillingMonth } from "./monthly-rent-breakdown.js";
import { getCleaningOverviewForUser } from "./cleaning.js";
import {
  createLaundryBooking,
  getActiveClientByEmail,
  getCoinsForEmail,
  getFinesForEmail,
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

/** Shown when Gemini returns quota / rate-limit errors (exact copy per product request). */
const GEMINI_QUOTA_HOLIDAY_REPLY =
  "Anh Trong is bankcrupted and cannot afford me, so i'm on holiday and unavailable";

function isGeminiQuotaExceeded(response: Response, data: GeminiResponse): boolean {
  if (response.status === 429) return true;
  const err = data.error;
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const code = (err as { code?: number }).code;
  if (code === 429) return true;
  if (msg.includes("quota")) return true;
  if (msg.includes("resource exhausted")) return true;
  if (msg.includes("rate limit")) return true;
  if (msg.includes("too many requests")) return true;
  return false;
}

function residentGeminiEndpoint(): string {
  const dedicated = process.env.GEMINI_RESIDENT_PORTAL_AI_API_KEY?.trim();
  const shared = process.env.GEMINI_API_KEY?.trim();
  const key = dedicated || shared;
  if (!key) {
    throw new Error(
      "Gemini API key is not configured for Cozoro Bee (set GEMINI_RESIDENT_PORTAL_AI_API_KEY or GEMINI_API_KEY)"
    );
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
  error?: { message: string; code?: number; status?: string };
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

/** Coin / fine sheet header keys (aligned with `google-sheets.ts` roster). */
const COIN_DELTA = "COINS";
const COIN_EVENT = "S\u1ef1 ki\u1ec7n";
const COIN_BAL_AFTER = "S\u1ed1 Coins hi\u1ec7n c\u00f3";
const COIN_OPERATOR = "Ng\u01b0\u1eddi thao t\u00e1c";
const CLIENT_COINS_COL = "Cozoro coins hi\u1ec7n c\u00f3";
const FINE_AMT = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
const FINE_BODY = "N\u1ed8I DUNG VI PH\u1ea0M";
const FINE_PAID = "\u0110\u00c3 THANH TO\u00c1N?";

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

  const { breakdown } = await calculateRentBreakdownForBillingMonth(client, month, {
    managerDiscountVnd: 0
  });
  return {
    email,
    month,
    isPaid: false,
    applyCoinsTowardRent,
    rentCoinRedeemCoins: record?.rentCoinRedeemCoins ?? null,
    rentCoinRedeemValueVnd: record?.rentCoinRedeemValueVnd ?? null,
    rentCoinRedeemAt: record?.rentCoinRedeemAt?.toISOString() ?? null,
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
    case "suggest_closest_laundry_slot": {
      const machineType = String(args.machineType ?? "").trim().toUpperCase();
      if (machineType !== "WASHER" && machineType !== "DRYER") {
        return { ok: false, message: "machineType must be WASHER or DRYER." };
      }
      const preferredRaw = String(args.preferredStartIso ?? "").trim();
      const preferred = preferredRaw ? new Date(preferredRaw) : null;
      if (preferredRaw && (preferred == null || Number.isNaN(preferred.getTime()))) {
        return { ok: false, message: "Invalid preferredStartIso (use ISO 8601)." };
      }
      const ctx = await getLaundryBookingContextForEmail(residentEmail);
      if (!ctx) {
        return { ok: false, message: "Laundry is not available (no active client row)." };
      }
      const machines = ctx.machines.filter((m) => m.type === machineType);
      if (!machines.length) {
        return { ok: false, message: `No ${machineType} machines at your branch (${ctx.branchId}).` };
      }
      const nowMs = Date.now();
      const hasPreferred = Boolean(preferred && !Number.isNaN(preferred.getTime()));
      type Cand = { machineId: string; machineLabel: string; startIso: string; sortKey: number };
      const cands: Cand[] = [];
      for (const m of machines) {
        const av = await getLaundryAvailabilityForMachine({
          email: residentEmail,
          machineId: m.id,
          days: 7,
          forceRefresh: true
        });
        for (const day of av.availability) {
          for (const iso of day.slots) {
            const t = new Date(iso).getTime();
            if (Number.isNaN(t) || t < nowMs) continue;
            const sortKey = hasPreferred ? Math.abs(t - preferred!.getTime()) : t;
            cands.push({
              machineId: m.id,
              machineLabel: m.label,
              startIso: iso,
              sortKey
            });
          }
        }
      }
      cands.sort((a, b) => a.sortKey - b.sortKey || new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
      const suggestions = cands.slice(0, 8).map(({ machineId: mid, machineLabel, startIso }) => ({
        machineId: mid,
        machineLabel,
        startIso
      }));
      if (!suggestions.length) {
        return {
          ok: true,
          branchId: ctx.branchId,
          machineType,
          suggestions: [],
          message: "No open slots in the next 7 days for this machine type at your branch."
        };
      }
      return {
        ok: true,
        branchId: ctx.branchId,
        machineType,
        preferredProvided: hasPreferred,
        suggestions,
        hint: hasPreferred
          ? "Pick the first suggestion if the resident's exact time was unavailable; times are in Asia/Ho_Chi_Minh calendar logic from the server."
          : "Earliest available slots for this machine type on the resident's branch only."
      };
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
      const client = await getActiveClientByEmail(residentEmail);
      const totalOnContract =
        Number.parseInt(String(client?.[CLIENT_COINS_COL] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
      const entries = await getCoinsForEmail(residentEmail);
      const last5 = entries.slice(0, 5).map(({ row, parsedTimestamp }) => ({
        time: parsedTimestamp,
        deltaCoins: String(row[COIN_DELTA] ?? "").trim(),
        event: String(row[COIN_EVENT] ?? "").trim(),
        balanceAfter: String(row[COIN_BAL_AFTER] ?? "").trim(),
        operator: String(row[COIN_OPERATOR] ?? "").trim()
      }));
      const slimLegacy = entries.slice(0, 12).map(({ row, parsedTimestamp }) => ({
        time: parsedTimestamp,
        row: Object.fromEntries(
          Object.entries(row)
            .filter(([, v]) => String(v ?? "").trim())
            .slice(0, 12)
        )
      }));
      return {
        ok: true,
        totalCoinsOnContractSheet: totalOnContract,
        fiveMostRecentCoinEntries: last5,
        recentEntriesJson: clipJson(slimLegacy, 12000)
      };
    }
    case "get_my_financial_overview": {
      const normalized = residentEmail.trim().toLowerCase();
      const client = await getActiveClientByEmail(normalized);
      const totalOnContract =
        Number.parseInt(String(client?.[CLIENT_COINS_COL] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
      const entries = await getCoinsForEmail(normalized);
      const last5 = entries.slice(0, 5).map(({ row, parsedTimestamp }) => ({
        time: parsedTimestamp,
        deltaCoins: String(row[COIN_DELTA] ?? "").trim(),
        event: String(row[COIN_EVENT] ?? "").trim(),
        balanceAfter: String(row[COIN_BAL_AFTER] ?? "").trim(),
        operator: String(row[COIN_OPERATOR] ?? "").trim()
      }));
      const [rentSnap, fines, laundryCtx] = await Promise.all([
        buildRentSnapshot(normalized),
        getFinesForEmail(normalized),
        getLaundryBookingContextForEmail(normalized)
      ]);
      const topFine = fines[0];
      const mostRecentFine = topFine
        ? {
            recordedAt: topFine.parsedTimestamp,
            amountVnd: String(topFine.row[FINE_AMT] ?? "").trim(),
            content: String(topFine.row[FINE_BODY] ?? "").trim(),
            paymentStatusCell: String(topFine.row[FINE_PAID] ?? "").trim(),
            isPaid: topFine.coinPayment.isPaid,
            coinCostIfPayingByCoins: topFine.coinPayment.coinCost
          }
        : null;
      return {
        ok: true,
        totalCoinsOnContractSheet: totalOnContract,
        laundryAvailableCoinBalance: laundryCtx?.allowance.availableCoinBalance ?? null,
        laundryCurrentCoinsBalance: laundryCtx?.allowance.currentCoinsBalance ?? null,
        fiveMostRecentCoinEntries: last5,
        nextPaymentAndRentJson: clipJson(rentSnap, 14000),
        mostRecentFine
      };
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
        description:
          "Open time slots for a specific machine over the next 7 days. machineId MUST belong to the resident's branch from get_my_laundry_status (never another branch).",
        parameters: {
          type: "OBJECT",
          properties: {
            machineId: { type: "STRING", description: "Machine id from the portal laundry list" }
          },
          required: ["machineId"]
        }
      },
      {
        name: "suggest_closest_laundry_slot",
        description:
          "Find the closest open laundry slots for WASHER or DRYER on the resident's branch only. Use when they want 'soonest' or when their requested time is not in get_laundry_open_slots — then suggest the nearest alternative from this tool.",
        parameters: {
          type: "OBJECT",
          properties: {
            machineType: {
              type: "STRING",
              description: "WASHER or DRYER",
              enum: ["WASHER", "DRYER"]
            },
            preferredStartIso: {
              type: "STRING",
              description: "Optional ISO 8601 start time the resident asked for; omit to get earliest available."
            }
          },
          required: ["machineType"]
        }
      },
      {
        name: "book_my_laundry",
        description:
          "Create a laundry booking for this resident. Use an ISO start time that appears in get_laundry_open_slots for the same machine (or from suggest_closest_laundry_slot).",
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
        description:
          "Coin ledger for this resident: total on contract sheet plus the five most recent entries. Prefer get_my_financial_overview if they also ask about rent or fines.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "get_my_financial_overview",
        description:
          "One call: total coins on contract, five latest coin ledger lines, laundry-available coin balance, next payment / rent snapshot, and the most recent fine row. Use for account/balance questions.",
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
  const uiLang = language === "vi" ? "Vietnamese (tiếng Việt)" : "English";
  const common = `You are **Cozoro Bee**, the friendly bee mascot of CozoroHome — a co-living resident portal in Ho Chi Minh City. You speak in first person as Cozoro Bee (warm, concise, never arrogant).

## Portal UI language (mandatory)
- The resident chose **${uiLang}** in the app. **Every** visible reply (including after tool calls and when summarizing errors) must be written in ${uiLang}.
- Do not switch languages unless the user clearly asks for the other language.

## Authenticated portal email
- The only account you may access (resident **or** staff in user view): ${residentEmail}

## Hard rules
- You must **never** reveal or infer other residents' names, emails, rooms, fines, or schedules.
- **You cannot delete or alter official records** (Google Sheet roster rows, contracts, fines, payments, coins ledger, other residents' bookings, or chat history). Your tools are read-only except **book_my_laundry**, which only creates a booking for this email. If someone asks to delete data, say clearly that only staff can do that through the office — do not imply you deleted anything or that they succeeded without staff.
- Only use facts returned by your tools (each tool is server-scoped to this email's sheet rows and portal data).
- If tools return nothing or an error, say so honestly; do not invent numbers.
- Prefer **concise** answers. Offer step-by-step only when booking laundry or interpreting a schedule.
- **Laundry booking workflow (mandatory):**
  1. Call **get_my_laundry_status** first — machines are already limited to **the resident's branch**; never use another branch's machineId.
  2. Ask whether they want a **washer** or **dryer** (if not already clear).
  3. Ask for a **date and time**, OR if they want the **soonest** slot — then call **suggest_closest_laundry_slot** (omit preferredStartIso) or pass their requested time as **preferredStartIso** to find the nearest open slot on an eligible machine of that type.
  4. If their exact time is not open, call **get_laundry_open_slots** for the chosen machineId and/or **suggest_closest_laundry_slot** and **propose the closest available** start time in plain language (local timezone context: Vietnam).
  5. Only then call **book_my_laundry** with a start ISO that is still open for that machineId (re-check slots if needed).
- For **coins / rent / fines**: call **get_my_financial_overview** when they ask about balance, payments, or penalties together; otherwise **get_my_coins** or **get_my_rent_status** as appropriate.
- Payments/rent: summarize amounts and due status clearly; mention if figures are estimates from the roster.
- This Bee chat is **not** the same as the human **Messages / Support** thread — still be professional; for disputes or sensitive issues, suggest that thread.
- When introducing yourself, say you are **Cozoro Bee**, CozoroHome's bee mascot (in Vietnamese you may say "mình là Cozoro Bee, linh vật ong của CozoroHome").`;

  if (language === "vi") {
    return `${common}

## Giặt sấy (laundry) — quy trình
- Chỉ máy thuộc **chi nhánh đang ở** (dữ liệu từ get_my_laundry_status). Hỏi rõ **máy giặt hay máy sấy** nếu chưa rõ.
- Hỏi **ngày giờ** hoặc nếu muốn **sớm nhất** thì dùng suggest_closest_laundry_slot (bỏ preferredStartIso). Nếu giờ họ chọn không còn trống, đề xuất **khung giờ gần nhất** còn mở (có thể gọi suggest_closest_laundry_slot với preferredStartIso).

## Ngôn ngữ
- Luôn trả lời bằng **tiếng Việt** rõ ràng, thân thiện (kể cả khi lịch sử chat có câu tiếng Anh); xưng hô là Cozoro Bee ("mình") như linh vật ong nhỏ (có thể giữ từ tiếng Anh ngắn: laundry, coins).`;
  }

  return `${common}

## Language
- Always reply in **clear English** as Cozoro Bee (friendly "I" voice), even if earlier turns in the chat were Vietnamese. Short Vietnamese words in the resident's message are fine to mirror.`;
}

export async function handleResidentPortalAiChat(
  residentEmail: string,
  history: ResidentPortalAiMessage[],
  options?: { language?: UiLanguage }
): Promise<{
  reply: string;
  showStarfieldEffect?: true;
  ventGameOfferPending?: true;
  startVentHammerGame?: true;
}> {
  if (process.env.RESIDENT_PORTAL_AI_DISABLED === "1") {
    throw new Error("Cozoro Bee is temporarily disabled.");
  }

  await assertEligibleForResidentPortalAi(residentEmail);
  const language: UiLanguage = options?.language === "vi" ? "vi" : "en";
  const lastUserEgg = [...history].reverse().find((m) => m.role === "user");
  const normalizedEmailEarly = residentEmail.trim().toLowerCase();
  const lastUserText = lastUserEgg?.text ?? "";

  const ventRefusal = tryVentHammerPendingRefusalReply(normalizedEmailEarly, lastUserText, language);
  if (ventRefusal) {
    void appendAiTrainingExchange({
      channel: "resident_portal",
      identifier: normalizedEmailEarly,
      language,
      userText: lastUserText,
      modelText: ventRefusal.reply,
      meta: { ventHammerRefusal: true }
    });
    return { reply: ventRefusal.reply };
  }

  const ventConsent = tryVentHammerConsentReply(normalizedEmailEarly, lastUserText, language);
  if (ventConsent) {
    void appendAiTrainingExchange({
      channel: "resident_portal",
      identifier: normalizedEmailEarly,
      language,
      userText: lastUserText,
      modelText: ventConsent.reply,
      meta: { ventHammerStart: true }
    });
    return { reply: ventConsent.reply, startVentHammerGame: ventConsent.startVentHammerGame };
  }

  const ventHate = tryVentHammerHateReply(lastUserText, language, normalizedEmailEarly);
  if (ventHate) {
    void appendAiTrainingExchange({
      channel: "resident_portal",
      identifier: normalizedEmailEarly,
      language,
      userText: lastUserText,
      modelText: ventHate.reply,
      meta: { ventHammerOffer: true }
    });
    return { reply: ventHate.reply, ventGameOfferPending: ventHate.ventGameOfferPending };
  }

  const founderEgg = tryFounderEasterEggReply(lastUserText, language);
  if (founderEgg) {
    const normalizedEmail = residentEmail.trim().toLowerCase();
    void appendAiTrainingExchange({
      channel: "resident_portal",
      identifier: normalizedEmail,
      language,
      userText: lastUserText,
      modelText: founderEgg.reply,
      meta: { founderEasterEgg: true }
    });
    return { reply: founderEgg.reply, showStarfieldEffect: founderEgg.showStarfieldEffect };
  }

  const systemPrompt = buildSystemPrompt(language, residentEmail.trim().toLowerCase());

  const limitedHistory = history.slice(-AI_CHAT_CONTEXT_MESSAGE_LIMIT);
  const contents: GeminiContent[] = limitedHistory.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const normalizedEmail = residentEmail.trim().toLowerCase();
  let maxRounds = 8;

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

    const raw = await res.text();
    let data: GeminiResponse;
    try {
      data = JSON.parse(raw) as GeminiResponse;
    } catch {
      throw new Error("Cozoro Bee: invalid response from AI gateway.");
    }

    if (isGeminiQuotaExceeded(res, data)) {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      void appendAiTrainingExchange({
        channel: "resident_portal",
        identifier: normalizedEmail,
        language,
        userText: lastUser?.text ?? "",
        modelText: GEMINI_QUOTA_HOLIDAY_REPLY,
        meta: { geminiQuotaExceeded: true }
      });
      return { reply: GEMINI_QUOTA_HOLIDAY_REPLY };
    }

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

  const fallback =
    language === "vi"
      ? "Mình chưa xử lý xong trong một lượt. Bạn hỏi lại hoặc thu hẹp câu hỏi nhé."
      : "I could not finish that in one go. Please ask again or narrow your question.";
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
