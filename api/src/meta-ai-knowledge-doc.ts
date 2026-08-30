import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { google } from "googleapis";

import { getD2ClosureNotice } from "./branch-closure.js";
import {
  getProspectAssistantPublicSettings,
  getProspectBedAvailability
} from "./prospect-assistant.js";

const repoRoot = path.resolve(process.cwd(), "..");
const sourceFilePath = path.join(repoRoot, "bot", "knowledge", "meta-ai-fanpage-knowledge.md");
const customInstructionsFilePath = path.join(repoRoot, "bot", "knowledge", "meta-ai-custom-instructions.txt");
const syncStateFilePath = path.join(process.cwd(), "data", "meta-ai-knowledge-sync.json");

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const defaultDocId = "1Dn9gI9AqW6T_zYmM3Heul5ECaK0Nu1JUtKHmat3-r7k";

const META_AI_KNOWLEDGE_ADMIN_EMAILS = (
  process.env.META_AI_KNOWLEDGE_ADMIN_EMAILS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [
    "dr.trongto@gmail.com"
  ]
).map((email) => email.toLowerCase());

type SyncState = {
  lastSyncedAt: string | null;
  documentId: string | null;
  contentLength: number;
};

function getDocumentId() {
  return (process.env.META_AI_KNOWLEDGE_DOC_ID ?? defaultDocId).trim();
}

function isSyncEnabled() {
  const flag = (process.env.META_AI_KNOWLEDGE_SYNC_ENABLED ?? "true").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

export function isMetaAiKnowledgeAdmin(email: string) {
  return META_AI_KNOWLEDGE_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export async function requireMetaAiKnowledgeAdmin(email: string) {
  if (!isMetaAiKnowledgeAdmin(email)) {
    throw new Error("Only the Meta AI knowledge admin can manage this feature.");
  }
}

async function readGoogleOAuthTokens() {
  const tokenFilePath = path.join(process.cwd(), ".google-oauth.json");
  try {
    return JSON.parse(await readFile(tokenFilePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getGoogleDocsScopeGranted() {
  const tokens = await readGoogleOAuthTokens();
  return hasDocumentsScope(tokens);
}

async function readSyncState(): Promise<SyncState> {
  try {
    const raw = await readFile(syncStateFilePath, "utf8");
    return JSON.parse(raw) as SyncState;
  } catch {
    return { lastSyncedAt: null, documentId: null, contentLength: 0 };
  }
}

async function writeSyncState(state: SyncState) {
  await mkdir(path.dirname(syncStateFilePath), { recursive: true });
  await writeFile(syncStateFilePath, JSON.stringify(state, null, 2), "utf8");
}

function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} VND`;
}

function formatSyncTimestamp(date: Date) {
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "full",
    timeStyle: "short"
  });
}

async function buildLiveAppendix(syncedAt: Date) {
  const lines: string[] = [
    "",
    "---",
    "",
    "## CẬP NHẬT TỰ ĐỘNG (đồng bộ từ app Cozoro)",
    "",
    `Cập nhật lần cuối: ${formatSyncTimestamp(syncedAt)} (giờ Việt Nam)`,
    `Chu kỳ: mỗi 3 ngày`,
    ""
  ];

  const d2Notice = getD2ClosureNotice("vi");
  lines.push(`**${d2Notice.title}** — ${d2Notice.body}`, "");

  try {
    const settings = await getProspectAssistantPublicSettings();
    lines.push(`Giảm giá giới thiệu hiện tại: ${formatVnd(settings.referralDiscountVnd)}`, "");
  } catch (error) {
    lines.push(
      "Giảm giá giới thiệu: 2.000.000 VND (mặc định — không tải được cài đặt mới nhất từ app).",
      ""
    );
    console.warn("[meta-ai-knowledge] Failed to load prospect settings", error);
  }

  for (const sex of ["male", "female"] as const) {
    const label = sex === "male" ? "Nam" : "Nữ";
    try {
      const snapshot = await getProspectBedAvailability({ branchId: "D7", sex });
      lines.push(`### D7 — giường trống (${label}) — tính đến ${snapshot.syncedAt}`, "");
      lines.push(`Tổng: **${snapshot.availableBeds}** giường có thể nhận trong 30 ngày tới.`, "");

      if (!snapshot.rooms.length) {
        lines.push("Hiện không có giường trống phù hợp trong cửa sổ 30 ngày — mời khách liên hệ nhân viên.", "");
        continue;
      }

      for (const room of snapshot.rooms.slice(0, 12)) {
        const bedSummaries = room.beds
          .slice(0, 8)
          .map((bed) => {
            const status = bed.status === "available_now" ? "trống ngay" : `từ ${bed.availableOn}`;
            return `giường ${bed.bedNumber} (${status}, ~${formatVnd(bed.pricing.monthlyPrice)}/tháng)`;
          })
          .join("; ");
        lines.push(`- Tầng ${room.floor}, phòng ${room.room}: ${bedSummaries}`);
      }

      if (snapshot.rooms.length > 12) {
        lines.push(`- … và thêm ${snapshot.rooms.length - 12} phòng nữa (xem app hoặc hỏi nhân viên).`);
      }

      lines.push("");
    } catch (error) {
      lines.push(`### D7 — giường trống (${label})`, "", "Không tải được dữ liệu live — mời khách liên hệ 0902 949 682.", "");
      console.warn(`[meta-ai-knowledge] Failed to load D7 ${sex} availability`, error);
    }
  }

  lines.push(
    "Lưu ý: Chỉ liệt kê số giường và giá niêm yết tham khảo — không nêu tên người đang ở. Giá thực trả có thể thấp hơn khi có gói/ưu đãi.",
    ""
  );

  return lines.join("\n");
}

export async function getMetaAiCustomInstructions() {
  try {
    return (await readFile(customInstructionsFilePath, "utf8")).trim();
  } catch {
    return "";
  }
}

export async function buildMetaAiKnowledgeDocumentContent(syncedAt = new Date()) {
  const [base, customInstructions, appendix] = await Promise.all([
    readFile(sourceFilePath, "utf8"),
    getMetaAiCustomInstructions(),
    buildLiveAppendix(syncedAt)
  ]);

  const customSection = customInstructions
    ? [
        "# META AI — CUSTOM INSTRUCTIONS",
        "",
        "Dán nội dung dưới đây vào mục **Custom instructions** trên Meta Business Suite (AI trả lời Fanpage).",
        "Phần còn lại của file là **Knowledge** (tài liệu kiến thức).",
        "",
        "---",
        "",
        customInstructions,
        "",
        "---",
        ""
      ].join("\n")
    : "";

  return `${customSection}${base.trim()}\n${appendix}`;
}

async function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/integrations/google/oauth/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured");
  }

  const tokens = await readGoogleOAuthTokens();
  if (!tokens) {
    throw new Error("Google OAuth tokens are missing. Connect Google in Manager → Settings → Tools → Meta AI knowledge.");
  }

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauthClient.setCredentials(tokens);
  return oauthClient;
}

function hasDocumentsScope(tokens: Record<string, unknown> | null) {
  if (!tokens) {
    return false;
  }

  const scopes = (typeof tokens.scope === "string" ? tokens.scope : "").split(/\s+/).filter(Boolean);
  return scopes.some(
    (scope) =>
      scope === "https://www.googleapis.com/auth/documents" ||
      scope === "https://www.googleapis.com/auth/drive"
  );
}

export async function getMetaAiKnowledgeStatus() {
  const state = await readSyncState();
  const documentId = getDocumentId();
  const googleDocsScopeGranted = await getGoogleDocsScopeGranted();

  return {
    documentId,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    lastSyncedAt: state.lastSyncedAt,
    contentLength: state.contentLength,
    syncEnabled: isSyncEnabled(),
    autoSyncIntervalDays: 3,
    googleDocsScopeGranted,
    googleOAuthConnected: Boolean(await readGoogleOAuthTokens()),
    sourceFile: "bot/knowledge/meta-ai-fanpage-knowledge.md",
    nextSyncEligible: shouldRunMetaAiKnowledgeSync(state)
  };
}

async function replaceGoogleDocText(documentId: string, text: string) {
  const tokens = await readGoogleOAuthTokens();

  if (!tokens) {
    throw new Error("Google OAuth tokens are missing. Connect Google in Manager → Settings → Tools → Meta AI knowledge.");
  }

  if (!hasDocumentsScope(tokens)) {
    throw new Error(
      "Google Docs access has not been granted yet. Reconnect Google OAuth in the manager portal to add Documents scope."
    );
  }

  const auth = await getOAuthClient();
  const docs = google.docs({ version: "v1", auth });

  const existing = await docs.documents.get({ documentId });
  const endIndex = existing.data.body?.content?.at(-1)?.endIndex ?? 1;

  const requests: Array<Record<string, unknown>> = [];
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: endIndex - 1
        }
      }
    });
  }

  requests.push({
    insertText: {
      location: { index: 1 },
      text
    }
  });

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests }
  });
}

function formatGoogleDocSyncError(error: unknown) {
  const status =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: number } }).response?.status === "number"
      ? (error as { response: { status: number } }).response.status
      : null;

  if (status === 404) {
    return "Google Doc not found or not shared with the Google account used for Cozoro OAuth. Open the doc in Drive and share Editor access with that account, then try again.";
  }

  return error instanceof Error ? error.message : "Unable to update Google Doc";
}

export function shouldRunMetaAiKnowledgeSync(state: SyncState, now = Date.now()) {
  if (!state.lastSyncedAt) {
    return true;
  }

  const last = Date.parse(state.lastSyncedAt);
  if (!Number.isFinite(last)) {
    return true;
  }

  return now - last >= THREE_DAYS_MS;
}

export async function syncMetaAiKnowledgeDocument(options?: { force?: boolean }) {
  if (!isSyncEnabled()) {
    return { skipped: true, reason: "META_AI_KNOWLEDGE_SYNC_ENABLED is off" };
  }

  const documentId = getDocumentId();
  if (!documentId) {
    return { skipped: true, reason: "META_AI_KNOWLEDGE_DOC_ID is empty" };
  }

  const state = await readSyncState();
  if (!options?.force && !shouldRunMetaAiKnowledgeSync(state)) {
    return {
      skipped: true,
      reason: "Last sync was less than 3 days ago",
      lastSyncedAt: state.lastSyncedAt,
      documentId
    };
  }

  const syncedAt = new Date();
  const content = await buildMetaAiKnowledgeDocumentContent(syncedAt);

  try {
    await replaceGoogleDocText(documentId, content);
  } catch (error) {
    throw new Error(formatGoogleDocSyncError(error));
  }

  const nextState: SyncState = {
    lastSyncedAt: syncedAt.toISOString(),
    documentId,
    contentLength: content.length
  };
  await writeSyncState(nextState);

  console.log(
    `[meta-ai-knowledge] Synced ${content.length} chars to Google Doc ${documentId} at ${nextState.lastSyncedAt}`
  );

  return {
    skipped: false,
    documentId,
    syncedAt: nextState.lastSyncedAt,
    contentLength: content.length,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`
  };
}

export function startMetaAiKnowledgeSyncScheduler() {
  if (!isSyncEnabled()) {
    return;
  }

  const run = (trigger: "startup" | "interval") => {
    void syncMetaAiKnowledgeDocument()
      .then((result) => {
        if (!result.skipped) {
          console.log(`[meta-ai-knowledge] ${trigger} sync complete`);
        }
      })
      .catch((error) => {
        console.error(`[meta-ai-knowledge] ${trigger} sync failed`, error);
      });
  };

  run("startup");

  const timer = setInterval(() => run("interval"), THREE_DAYS_MS);
  timer.unref();
}
