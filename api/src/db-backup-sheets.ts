import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { google, sheets_v4 } from "googleapis";

import { Prisma } from "@prisma/client";

import { prisma } from "./prisma.js";
import { repairUnknownText } from "./text-encoding.js";

const APP_VERSION = process.env.npm_package_version ?? "unknown";
const tokenFilePath = path.join(process.cwd(), ".google-oauth.json");
const dataDirPath = path.join(process.cwd(), "data");
const configFilePath = path.join(dataDirPath, "db-backup-config.json");
const stateFilePath = path.join(dataDirPath, "db-backup-state.json");
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/integrations/google/oauth/callback";

const META_TAB = "_DB_META";
const ROW_CHUNK = 4000;

const JSON_FIELDS = new Set([
  "calculatedSnapshot",
  "breakdownOverrides",
  "eligibility",
  "stepsJson"
]);

const DATE_FIELDS = new Set([
  "startAt",
  "endAt",
  "createdAt",
  "updatedAt",
  "date",
  "scheduledDate",
  "completedAt",
  "checkIn",
  "checkOut",
  "sessionStartAt",
  "chargedAt",
  "paidAt",
  "rentCoinRedeemAt",
  "paidRecordedAt",
  "nextPaymentDate",
  "confirmedAt",
  "lastAppNotifyAt",
  "lastEmailNotifyAt",
  "lastMessageAt",
  "lastReadAt",
  "taskScheduledDate",
  "respondedAt",
  "cancelledAt",
  "startDate",
  "endDate"
]);

type PrismaTableDelegate = {
  findMany: () => Promise<Record<string, unknown>[]>;
  deleteMany: (args?: object) => Promise<{ count: number }>;
  createMany: (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
};

type TableDelegateName =
  | "branch"
  | "resource"
  | "booking"
  | "coinLedger"
  | "actionLog"
  | "cleaningAvailability"
  | "cleaningTask"
  | "cleaningAudit"
  | "cleaningScheduleCorrectionReason"
  | "cleaningScheduleCorrection"
  | "cleaningScheduleCorrectionReasonLink"
  | "supportConversation"
  | "supportMessage"
  | "supportReadState"
  | "groupMessage"
  | "groupReadState"
  | "cleaningOptOut"
  | "cleaningContractOptOut"
  | "stayBooking"
  | "pushSubscription"
  | "gateParkingTicket"
  | "monthlyRentStatus"
  | "prepaidPackageBilling"
  | "accountNextPayment"
  | "branchPricingSettings"
  | "bedParkingFeeOverride"
  | "parkingPricingTier"
  | "bedPriceOverride"
  | "pricingDiscount"
  | "residentGuideSection"
  | "cleaningSwapRequest";

type BackupTableDef = {
  tabName: string;
  delegate: TableDelegateName;
  fields: string[];
};

/** Insert order respects foreign keys; delete uses reverse order. */
const BACKUP_TABLES: BackupTableDef[] = [
  { tabName: "Branch", delegate: "branch", fields: ["id", "name"] },
  {
    tabName: "Resource",
    delegate: "resource",
    fields: ["id", "branchId", "type", "label", "calendarId", "slotMinutes", "bufferMinutes", "active"]
  },
  {
    tabName: "Booking",
    delegate: "booking",
    fields: ["id", "userId", "resourceId", "startAt", "endAt", "status", "gcalEventId", "priceCoins", "createdAt"]
  },
  {
    tabName: "CoinLedger",
    delegate: "coinLedger",
    fields: ["id", "userId", "delta", "reason", "refType", "refId", "createdAt"]
  },
  {
    tabName: "ActionLog",
    delegate: "actionLog",
    fields: [
      "id",
      "actorEmail",
      "actorName",
      "actorRole",
      "action",
      "entityType",
      "entityId",
      "entityLabel",
      "details",
      "createdAt"
    ]
  },
  {
    tabName: "CleaningAvailability",
    delegate: "cleaningAvailability",
    fields: ["id", "userEmail", "branchId", "floor", "date", "type", "note", "createdAt", "updatedAt"]
  },
  {
    tabName: "CleaningTask",
    delegate: "cleaningTask",
    fields: [
      "id",
      "userEmail",
      "userName",
      "assignedByEmail",
      "assignedByName",
      "branchId",
      "floor",
      "type",
      "scheduledDate",
      "slotKey",
      "calendarId",
      "calendarEventId",
      "status",
      "rewardCoins",
      "isSelfAssigned",
      "assignmentSource",
      "completedAt",
      "completionNote",
      "completionPhoto",
      "auditorNote",
      "createdAt",
      "updatedAt"
    ]
  },
  {
    tabName: "CleaningScheduleCorrectionReason",
    delegate: "cleaningScheduleCorrectionReason",
    fields: [
      "id",
      "code",
      "labelVi",
      "labelEn",
      "isSystem",
      "isActive",
      "sortOrder",
      "createdBy",
      "createdAt",
      "updatedAt"
    ]
  },
  {
    tabName: "CleaningScheduleCorrection",
    delegate: "cleaningScheduleCorrection",
    fields: [
      "id",
      "action",
      "taskId",
      "slotKey",
      "taskType",
      "scheduledDate",
      "floor",
      "previousUserEmail",
      "previousUserName",
      "previousSource",
      "newUserEmail",
      "actorEmail",
      "actorName",
      "customNote",
      "createdAt"
    ]
  },
  {
    tabName: "CleaningScheduleCorrectionReasonLink",
    delegate: "cleaningScheduleCorrectionReasonLink",
    fields: ["correctionId", "reasonId"]
  },
  {
    tabName: "CleaningAudit",
    delegate: "cleaningAudit",
    fields: ["id", "taskId", "reviewer", "decision", "note", "createdAt"]
  },
  {
    tabName: "SupportConversation",
    delegate: "supportConversation",
    fields: [
      "id",
      "residentEmail",
      "residentName",
      "status",
      "lastMessageAt",
      "createdAt",
      "updatedAt",
      "residentContactPhone",
      "residentContactFacebook",
      "residentContactOther"
    ]
  },
  {
    tabName: "SupportMessage",
    delegate: "supportMessage",
    fields: ["id", "conversationId", "senderEmail", "senderName", "senderRole", "body", "pagePath", "createdAt"]
  },
  {
    tabName: "SupportReadState",
    delegate: "supportReadState",
    fields: ["id", "conversationId", "viewerEmail", "viewerRole", "lastReadAt", "createdAt", "updatedAt"]
  },
  {
    tabName: "GroupMessage",
    delegate: "groupMessage",
    fields: ["id", "groupId", "senderEmail", "senderName", "senderRole", "isAnonymous", "body", "createdAt"]
  },
  {
    tabName: "GroupReadState",
    delegate: "groupReadState",
    fields: ["id", "groupId", "viewerEmail", "lastReadAt", "createdAt", "updatedAt"]
  },
  {
    tabName: "CleaningOptOut",
    delegate: "cleaningOptOut",
    fields: ["id", "userEmail", "branchId", "month", "paymentMethod", "chargedAt", "createdAt", "updatedAt"]
  },
  {
    tabName: "CleaningContractOptOut",
    delegate: "cleaningContractOptOut",
    fields: ["id", "userEmail", "branchId", "contractCode", "cleaningFeeVnd", "startDate", "endDate", "createdAt", "updatedAt"]
  },
  {
    tabName: "StayBooking",
    delegate: "stayBooking",
    fields: [
      "id",
      "branchId",
      "roomCode",
      "bedNumber",
      "guestName",
      "guestEmail",
      "guestPhone",
      "checkIn",
      "checkOut",
      "nights",
      "notes",
      "status",
      "source",
      "createdAt",
      "updatedAt"
    ]
  },
  {
    tabName: "PushSubscription",
    delegate: "pushSubscription",
    fields: ["id", "email", "endpoint", "p256dh", "auth", "createdAt"]
  },
  {
    tabName: "GateParkingTicket",
    delegate: "gateParkingTicket",
    fields: [
      "id",
      "residentEmail",
      "periodMonth",
      "amountVnd",
      "sessionStartAt",
      "durationHours",
      "note",
      "createdBy",
      "createdAt",
      "paidAt"
    ]
  },
  {
    tabName: "MonthlyRentStatus",
    delegate: "monthlyRentStatus",
    fields: [
      "id",
      "email",
      "month",
      "isPaid",
      "updatedAt",
      "updatedBy",
      "applyCoinsTowardRent",
      "rentCoinRedeemCoins",
      "rentCoinRedeemValueVnd",
      "rentCoinRedeemAt",
      "paidRecordedAt",
      "snapshotRentSubtotalVnd",
      "snapshotParkingVnd",
      "snapshotGateParkingVnd",
      "snapshotLaundryVnd",
      "snapshotFinesVnd",
      "snapshotFinalTotalVnd",
      "snapshotCoinValueVnd"
    ]
  },
  {
    tabName: "PrepaidPackageBilling",
    delegate: "prepaidPackageBilling",
    fields: [
      "id",
      "residentEmail",
      "billingMonth",
      "calculatedSnapshot",
      "breakdownOverrides",
      "managerPackageTotalVnd",
      "managerNote",
      "confirmed",
      "confirmedAt",
      "confirmedBy",
      "lastAppNotifyAt",
      "lastEmailNotifyAt",
      "createdAt",
      "updatedAt"
    ]
  },
  {
    tabName: "AccountNextPayment",
    delegate: "accountNextPayment",
    fields: [
      "email",
      "nextPaymentDate",
      "planKind",
      "sourceContractCode",
      "updatedBy",
      "updatedAt",
      "createdAt"
    ]
  },
  {
    tabName: "BranchPricingSettings",
    delegate: "branchPricingSettings",
    fields: ["id", "branchId", "cleaningOptOutFeeVnd", "parkingFeeVnd", "updatedBy", "updatedAt", "createdAt"]
  },
  {
    tabName: "BedParkingFeeOverride",
    delegate: "bedParkingFeeOverride",
    fields: ["id", "branchId", "bedNumber", "parkingFeeVnd", "updatedBy", "updatedAt", "createdAt"]
  },
  {
    tabName: "ParkingPricingTier",
    delegate: "parkingPricingTier",
    fields: ["id", "branchId", "labelEn", "labelVi", "feeVnd", "sortOrder", "active", "updatedBy", "updatedAt", "createdAt"]
  },
  {
    tabName: "BedPriceOverride",
    delegate: "bedPriceOverride",
    fields: ["id", "branchId", "bedNumber", "termType", "monthlyPrice", "deposit", "nightlyPrice", "updatedBy", "updatedAt", "createdAt"]
  },
  {
    tabName: "PricingDiscount",
    delegate: "pricingDiscount",
    fields: [
      "id",
      "termType",
      "label",
      "description",
      "amountVnd",
      "percentOff",
      "minNights",
      "durationMonths",
      "eligibility",
      "enabled",
      "createdBy",
      "updatedBy",
      "updatedAt",
      "createdAt"
    ]
  },
  {
    tabName: "ResidentGuideSection",
    delegate: "residentGuideSection",
    fields: [
      "id",
      "slug",
      "titleVi",
      "titleEn",
      "sortOrder",
      "contentType",
      "category",
      "audience",
      "videoUrl",
      "stepsJson",
      "updatedBy",
      "createdAt",
      "updatedAt"
    ]
  },
  {
    tabName: "CleaningSwapRequest",
    delegate: "cleaningSwapRequest",
    fields: [
      "id",
      "taskId",
      "requesterEmail",
      "requesterName",
      "targetEmail",
      "targetName",
      "offeredCoins",
      "status",
      "taskType",
      "taskScheduledDate",
      "taskBranchId",
      "taskRewardCoins",
      "respondedAt",
      "cancelledAt",
      "createdAt",
      "updatedAt"
    ]
  }
];

type BackupConfig = {
  spreadsheetId: string;
  createdAt: string;
};

type BackupState = {
  lastExportedAt?: string;
  lastExportedBy?: string;
  lastRestoredAt?: string;
  lastRestoredBy?: string;
  lastExportCounts?: Record<string, number>;
  lastRestoreCounts?: Record<string, number>;
};

export type DbBackupStatus = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  lastExportedAt: string | null;
  lastExportedBy: string | null;
  lastRestoredAt: string | null;
  lastRestoredBy: string | null;
  tableCounts: Record<string, number>;
  tables: string[];
};

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientSecret === "REPLACE_WITH_YOUR_CLIENT_SECRET") {
    throw new Error("Google OAuth credentials are not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function readSavedTokens() {
  try {
    const file = await readFile(tokenFilePath, "utf8");
    return repairUnknownText(JSON.parse(file) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function getAuthorizedSheetsClient() {
  const oauthClient = getOAuthClient();
  const tokens = await readSavedTokens();

  if (!tokens) {
    throw new Error("Google OAuth tokens are missing");
  }

  oauthClient.setCredentials(tokens);
  return google.sheets({ version: "v4", auth: oauthClient });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const file = await readFile(filePath, "utf8");
    return repairUnknownText(JSON.parse(file) as T);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function spreadsheetUrl(spreadsheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function serializeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function coerceCell(raw: string, field: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (JSON_FIELDS.has(field)) {
    return JSON.parse(trimmed);
  }
  if (DATE_FIELDS.has(field)) {
    return new Date(trimmed);
  }
  if (trimmed === "TRUE") {
    return true;
  }
  if (trimmed === "FALSE") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }
  return trimmed;
}

function getDelegate(name: BackupTableDef["delegate"]): PrismaTableDelegate {
  return prisma[name] as unknown as PrismaTableDelegate;
}

async function resolveSpreadsheetId(sheets: sheets_v4.Sheets): Promise<string> {
  const fromEnv = (process.env.GOOGLE_DB_BACKUP_SPREADSHEET_ID ?? "").trim();
  if (fromEnv) {
    return fromEnv;
  }

  const config = await readJsonFile<BackupConfig | null>(configFilePath, null);
  if (config?.spreadsheetId) {
    return config.spreadsheetId;
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `CozoroHome DB Backup (${new Date().toISOString().slice(0, 10)})`
      },
      sheets: [{ properties: { title: META_TAB } }]
    }
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Google Sheets did not return a spreadsheet id");
  }

  await writeJsonFile(configFilePath, {
    spreadsheetId,
    createdAt: new Date().toISOString()
  } satisfies BackupConfig);

  return spreadsheetId;
}

async function listExistingTabs(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return new Set((meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "").filter(Boolean));
}

async function ensureTab(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string, existing: Set<string>) {
  if (existing.has(title)) {
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
  existing.add(title);
}

async function clearTabValues(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${title.replace(/'/g, "''")}'!A:ZZ`
  });
}

async function writeTabRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: string[][]
) {
  const safeTitle = `'${title.replace(/'/g, "''")}'`;
  if (rows.length === 0) {
    return;
  }

  for (let offset = 0; offset < rows.length; offset += ROW_CHUNK) {
    const chunk = rows.slice(offset, offset + ROW_CHUNK);
    const startRow = offset + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${safeTitle}!A${startRow}`,
      valueInputOption: "RAW",
      requestBody: { values: chunk }
    });
  }
}

async function readTabRows(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string) {
  const safeTitle = `'${title.replace(/'/g, "''")}'`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${safeTitle}!A:ZZ`
  });
  return (response.data.values ?? []) as string[][];
}

async function writeMetaTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  metaRows: string[][]
) {
  await writeTabRows(sheets, spreadsheetId, META_TAB, metaRows);
}

function buildMetaRows(input: {
  exportedAt?: string;
  exportedBy?: string;
  restoredAt?: string;
  restoredBy?: string;
  counts: Record<string, number>;
}) {
  const rows: string[][] = [["key", "value"]];
  rows.push(["appVersion", APP_VERSION]);
  if (input.exportedAt) {
    rows.push(["exportedAt", input.exportedAt]);
  }
  if (input.exportedBy) {
    rows.push(["exportedBy", input.exportedBy]);
  }
  if (input.restoredAt) {
    rows.push(["restoredAt", input.restoredAt]);
  }
  if (input.restoredBy) {
    rows.push(["restoredBy", input.restoredBy]);
  }
  for (const table of BACKUP_TABLES) {
    rows.push([`count:${table.tabName}`, String(input.counts[table.tabName] ?? 0)]);
  }
  return rows;
}

export async function exportDatabaseToGoogleSheet(actorEmail: string) {
  const sheets = await getAuthorizedSheetsClient();
  const spreadsheetId = await resolveSpreadsheetId(sheets);
  const existingTabs = await listExistingTabs(sheets, spreadsheetId);

  await ensureTab(sheets, spreadsheetId, META_TAB, existingTabs);

  const counts: Record<string, number> = {};
  const exportedAt = new Date().toISOString();

  for (const table of BACKUP_TABLES) {
    await ensureTab(sheets, spreadsheetId, table.tabName, existingTabs);
    await clearTabValues(sheets, spreadsheetId, table.tabName);

    const delegate = getDelegate(table.delegate);
    const records = await delegate.findMany();
    counts[table.tabName] = records.length;

    const sheetRows: string[][] = [table.fields];
    for (const record of records) {
      sheetRows.push(table.fields.map((field) => serializeCell(record[field])));
    }

    await writeTabRows(sheets, spreadsheetId, table.tabName, sheetRows);
  }

  await clearTabValues(sheets, spreadsheetId, META_TAB);
  await writeMetaTab(
    sheets,
    spreadsheetId,
    buildMetaRows({ exportedAt, exportedBy: actorEmail, counts })
  );

  const state = await readJsonFile<BackupState>(stateFilePath, {});
  await writeJsonFile(stateFilePath, {
    ...state,
    lastExportedAt: exportedAt,
    lastExportedBy: actorEmail,
    lastExportCounts: counts
  } satisfies BackupState);

  await prisma.actionLog.create({
    data: {
      actorEmail,
      action: "DB_BACKUP_EXPORT",
      entityType: "GoogleSheet",
      entityId: spreadsheetId,
      entityLabel: "CozoroHome DB Backup",
      details: JSON.stringify({ counts, exportedAt })
    }
  });

  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    exportedAt,
    counts
  };
}

function parseSheetRows(headers: string[], dataRows: string[][]) {
  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const record: Record<string, unknown> = {};
      for (let index = 0; index < headers.length; index += 1) {
        const field = headers[index];
        if (!field) {
          continue;
        }
        record[field] = coerceCell(row[index] ?? "", field);
      }
      return record;
    });
}

type PrismaTx = Prisma.TransactionClient;

function getTxDelegate(tx: PrismaTx, name: BackupTableDef["delegate"]): PrismaTableDelegate {
  return tx[name] as unknown as PrismaTableDelegate;
}

async function deleteAllBackupTables(tx: PrismaTx) {
  for (const table of [...BACKUP_TABLES].reverse()) {
    await getTxDelegate(tx, table.delegate).deleteMany({});
  }
}

async function insertTableRows(tx: PrismaTx, table: BackupTableDef, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return 0;
  }

  const delegate = getTxDelegate(tx, table.delegate);
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const result = await delegate.createMany({ data: chunk });
    inserted += result.count;
  }

  return inserted;
}

export async function restoreDatabaseFromGoogleSheet(input: {
  actorEmail: string;
  spreadsheetId?: string;
}) {
  const sheets = await getAuthorizedSheetsClient();
  const spreadsheetId =
    (input.spreadsheetId ?? "").trim() ||
    (process.env.GOOGLE_DB_BACKUP_SPREADSHEET_ID ?? "").trim() ||
    (await readJsonFile<BackupConfig | null>(configFilePath, null))?.spreadsheetId ||
    "";

  if (!spreadsheetId) {
    throw new Error(
      "No backup spreadsheet configured. Run export first or set GOOGLE_DB_BACKUP_SPREADSHEET_ID."
    );
  }

  const tableData = new Map<string, Record<string, unknown>[]>();

  for (const table of BACKUP_TABLES) {
    const values = await readTabRows(sheets, spreadsheetId, table.tabName);
    if (values.length === 0) {
      tableData.set(table.tabName, []);
      continue;
    }

    const headers = values[0].map((cell) => cell.trim());
    const records = parseSheetRows(headers, values.slice(1));
    tableData.set(table.tabName, records);
  }

  const restoredAt = new Date().toISOString();
  const counts: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      await deleteAllBackupTables(tx);

      for (const table of BACKUP_TABLES) {
        const rows = tableData.get(table.tabName) ?? [];
        counts[table.tabName] = await insertTableRows(tx, table, rows);
      }
    },
    { timeout: 120_000 }
  );

  await clearTabValues(sheets, spreadsheetId, META_TAB);
  await writeMetaTab(
    sheets,
    spreadsheetId,
    buildMetaRows({ restoredAt, restoredBy: input.actorEmail, counts })
  );

  const state = await readJsonFile<BackupState>(stateFilePath, {});
  await writeJsonFile(stateFilePath, {
    ...state,
    lastRestoredAt: restoredAt,
    lastRestoredBy: input.actorEmail,
    lastRestoreCounts: counts
  } satisfies BackupState);

  await prisma.actionLog.create({
    data: {
      actorEmail: input.actorEmail,
      action: "DB_BACKUP_RESTORE",
      entityType: "GoogleSheet",
      entityId: spreadsheetId,
      entityLabel: "CozoroHome DB Backup",
      details: JSON.stringify({ counts, restoredAt })
    }
  });

  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    restoredAt,
    counts
  };
}

export async function getDatabaseBackupStatus(): Promise<DbBackupStatus> {
  const config = await readJsonFile<BackupConfig | null>(configFilePath, null);
  const state = await readJsonFile<BackupState>(stateFilePath, {});
  const spreadsheetId =
    (process.env.GOOGLE_DB_BACKUP_SPREADSHEET_ID ?? "").trim() || config?.spreadsheetId || "";

  if (!spreadsheetId) {
    return {
      spreadsheetId: "",
      spreadsheetUrl: "",
      lastExportedAt: state.lastExportedAt ?? null,
      lastExportedBy: state.lastExportedBy ?? null,
      lastRestoredAt: state.lastRestoredAt ?? null,
      lastRestoredBy: state.lastRestoredBy ?? null,
      tableCounts: state.lastExportCounts ?? {},
      tables: BACKUP_TABLES.map((table) => table.tabName)
    };
  }

  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    lastExportedAt: state.lastExportedAt ?? null,
    lastExportedBy: state.lastExportedBy ?? null,
    lastRestoredAt: state.lastRestoredAt ?? null,
    lastRestoredBy: state.lastRestoredBy ?? null,
    tableCounts: state.lastExportCounts ?? {},
    tables: BACKUP_TABLES.map((table) => table.tabName)
  };
}
