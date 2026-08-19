import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type AiActionChannel = "manager" | "resident";

export type AiActionRisk = "low" | "medium" | "high";

export type SuggestedActionPayload = {
  channel: AiActionChannel;
  toolName: string;
  args: Record<string, unknown>;
  actorEmail: string;
  summary: string;
  summaryVi?: string;
  risk: AiActionRisk;
  language: "en" | "vi";
  createdAtMs: number;
  nonce: string;
};

export type PendingSuggestedAction = {
  token: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  risk: AiActionRisk;
};

const TOKEN_TTL_MS = 15 * 60 * 1000;

const MANAGER_READ_ONLY_TOOLS = new Set(["query_beds"]);

const MANAGER_CONFIRM_TOOLS = new Set([
  "add_coins",
  "create_fine",
  "create_payment",
  "delete_coin_sheet_row",
  "delete_payment_sheet_row",
  "delete_fine_sheet_row",
  "delete_laundry_booking",
  "assign_cleaning_task",
  "remove_cleaning_task",
  "navigate"
]);

const RESIDENT_READ_ONLY_TOOLS = new Set([
  "get_my_profile",
  "get_my_cleaning",
  "get_my_laundry_status",
  "get_laundry_open_slots",
  "suggest_closest_laundry_slot",
  "get_my_coins",
  "get_my_financial_overview",
  "get_my_payments",
  "get_my_rent_status"
]);

const RESIDENT_CONFIRM_TOOLS = new Set([
  "book_my_laundry",
  "self_assign_cleaning",
  "release_my_cleaning_task",
  "complete_my_cleaning_task",
  "cancel_my_laundry_booking"
]);

function actionSecret(): string {
  return (
    process.env.AI_ACTION_TOKEN_SECRET?.trim() ||
    process.env.REFERRAL_PROGRAM_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "cozoro-ai-action-dev-secret"
  );
}

function signPayload(payload: SuggestedActionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", actionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function decodeToken(token: string): SuggestedActionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", actionSecret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SuggestedActionPayload;
    if (!parsed?.channel || !parsed.toolName || !parsed.actorEmail || !parsed.createdAtMs) return null;
    if (Date.now() - parsed.createdAtMs > TOKEN_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isReadOnlyAiTool(channel: AiActionChannel, toolName: string): boolean {
  if (channel === "manager") return MANAGER_READ_ONLY_TOOLS.has(toolName);
  return RESIDENT_READ_ONLY_TOOLS.has(toolName);
}

export function requiresAiActionConfirmation(channel: AiActionChannel, toolName: string): boolean {
  if (channel === "manager") return MANAGER_CONFIRM_TOOLS.has(toolName);
  return RESIDENT_CONFIRM_TOOLS.has(toolName);
}

function formatVnd(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount ?? "");
  return `${n.toLocaleString("en-US")} VND`;
}

function cleaningTypeLabel(type: unknown, language: "en" | "vi"): string {
  const t = String(type ?? "").trim();
  if (language === "vi") {
    if (t === "KITCHEN_D2") return "Vệ sinh bếp D2";
    if (t === "KITCHEN_D7") return "Vệ sinh bếp D7";
    if (t === "TRASH_D7") return "Đổ rác D7";
    return t;
  }
  if (t === "KITCHEN_D2") return "Kitchen D2";
  if (t === "KITCHEN_D7") return "Kitchen D7";
  if (t === "TRASH_D7") return "Trash D7";
  return t;
}

export function buildActionRisk(channel: AiActionChannel, toolName: string): AiActionRisk {
  if (toolName.startsWith("delete_") || toolName === "remove_cleaning_task") return "high";
  if (toolName === "create_fine" || toolName === "release_my_cleaning_task") return "medium";
  if (channel === "manager" && (toolName === "add_coins" || toolName === "create_payment")) return "medium";
  return "low";
}

export function buildActionSummary(
  channel: AiActionChannel,
  toolName: string,
  args: Record<string, unknown>,
  language: "en" | "vi"
): { summary: string; summaryVi?: string } {
  const en = language === "en";
  switch (toolName) {
    case "add_coins":
      return en
        ? { summary: `Adjust coins: ${args.delta} for contract ${args.maHd} — ${args.reason}` }
        : { summary: `Điều chỉnh coin: ${args.delta} cho HĐ ${args.maHd} — ${args.reason}` };
    case "create_fine":
      return en
        ? { summary: `Create fine ${formatVnd(args.amount)} for ${args.maHd}: ${args.content}` }
        : { summary: `Tạo phiếu phạt ${formatVnd(args.amount)} cho ${args.maHd}: ${args.content}` };
    case "create_payment":
      return en
        ? { summary: `Create payment ${formatVnd(args.amount)} for ${args.maHd}: ${args.purpose}` }
        : { summary: `Tạo biên lai ${formatVnd(args.amount)} cho ${args.maHd}: ${args.purpose}` };
    case "delete_coin_sheet_row":
      return en
        ? { summary: `Delete coin row for ${args.email} at ${args.timestamp}` }
        : { summary: `Xóa dòng coin của ${args.email} lúc ${args.timestamp}` };
    case "delete_payment_sheet_row":
      return en
        ? { summary: `Delete payment row for ${args.email} at ${args.timestamp}` }
        : { summary: `Xóa dòng thanh toán của ${args.email} lúc ${args.timestamp}` };
    case "delete_fine_sheet_row":
      return en
        ? { summary: `Delete fine "${args.content}" for ${args.email} at ${args.timestamp}` }
        : { summary: `Xóa phiếu phạt "${args.content}" của ${args.email} lúc ${args.timestamp}` };
    case "delete_laundry_booking":
      return en
        ? { summary: `Remove laundry booking (event ${args.eventId})` }
        : { summary: `Xóa lịch giặt (event ${args.eventId})` };
    case "assign_cleaning_task":
      return en
        ? {
            summary: `Assign ${cleaningTypeLabel(args.type, "en")} on ${args.date} to ${args.email}`
          }
        : {
            summary: `Gán ${cleaningTypeLabel(args.type, "vi")} ngày ${args.date} cho ${args.email}`
          };
    case "remove_cleaning_task":
      return en
        ? { summary: `Remove cleaning task ${args.taskId}` }
        : { summary: `Xóa ca vệ sinh ${args.taskId}` };
    case "navigate":
      return en
        ? { summary: `Open manager view: ${args.view}` }
        : { summary: `Mở màn hình quản lý: ${args.view}` };
    case "book_my_laundry":
      return en
        ? { summary: `Book laundry on machine ${args.machineId} starting ${args.start}` }
        : { summary: `Đặt giặt máy ${args.machineId} lúc ${args.start}` };
    case "self_assign_cleaning":
      return en
        ? {
            summary: `Self-assign ${cleaningTypeLabel(args.type, "en")} on ${args.date}`
          }
        : {
            summary: `Tự đăng ký ${cleaningTypeLabel(args.type, "vi")} ngày ${args.date}`
          };
    case "release_my_cleaning_task":
      return en
        ? { summary: `Release cleaning task ${args.taskId}` }
        : { summary: `Hủy ca vệ sinh ${args.taskId}` };
    case "complete_my_cleaning_task":
      return en
        ? { summary: `Mark cleaning task ${args.taskId} as complete` }
        : { summary: `Hoàn thành ca vệ sinh ${args.taskId}` };
    case "cancel_my_laundry_booking":
      return en
        ? { summary: `Cancel laundry booking ${args.eventId}` }
        : { summary: `Hủy lịch giặt ${args.eventId}` };
    default:
      return en
        ? { summary: `Confirm action: ${toolName}` }
        : { summary: `Xác nhận thao tác: ${toolName}` };
  }
}

export function createPendingSuggestedAction(input: {
  channel: AiActionChannel;
  toolName: string;
  args: Record<string, unknown>;
  actorEmail: string;
  language: "en" | "vi";
}): PendingSuggestedAction {
  const { summary } = buildActionSummary(input.channel, input.toolName, input.args, input.language);
  const payload: SuggestedActionPayload = {
    channel: input.channel,
    toolName: input.toolName,
    args: input.args,
    actorEmail: input.actorEmail.trim().toLowerCase(),
    summary,
    risk: buildActionRisk(input.channel, input.toolName),
    language: input.language,
    createdAtMs: Date.now(),
    nonce: randomBytes(8).toString("hex")
  };
  return {
    token: signPayload(payload),
    toolName: input.toolName,
    args: input.args,
    summary,
    risk: payload.risk
  };
}

export function verifyPendingSuggestedAction(
  token: string,
  channel: AiActionChannel,
  actorEmail: string
): SuggestedActionPayload | null {
  const payload = decodeToken(token);
  if (!payload) return null;
  if (payload.channel !== channel) return null;
  if (payload.actorEmail !== actorEmail.trim().toLowerCase()) return null;
  return payload;
}

export function pendingConfirmationToolResponse(
  summary: string,
  language: "en" | "vi"
): Record<string, unknown> {
  if (language === "vi") {
    return {
      status: "awaiting_user_confirmation",
      summary,
      instruction:
        "Thao tác này chưa thực hiện. Ứng dụng sẽ hiện nút Xác nhận. Giải thích ngắn gọn cho quản lý/cư dân và nhắc họ bấm Xác nhận bên dưới."
    };
  }
  return {
    status: "awaiting_user_confirmation",
    summary,
    instruction:
      "This action has NOT been executed yet. The portal will show a Confirm button. Briefly explain what will happen and ask the user to tap Confirm below."
  };
}
