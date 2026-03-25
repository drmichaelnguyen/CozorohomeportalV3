import "dotenv/config";

import cors from "cors";
import express from "express";
import {
  BookingStatus,
  CleaningAuditDecision,
  CleaningAvailabilityType,
  CoinReason,
  Prisma,
  ResourceType
} from "@prisma/client";
import { z } from "zod";
import {
  getUserAcControllerContext,
  listAllDevices,
  listPrivilegedAcRooms,
  sendAcCommand,
  sendAcCommandToRoom
} from "./ac-controller.js";
import { getUserAirFryerContext, startAirFryerUse } from "./airfryer-controller.js";
import {
  getGooglePortalClientConfig,
  listStaffAccess,
  removeStaffAccess,
  requirePortalRole,
  resolveGooglePortalLogin,
  resolvePortalLogin,
  upsertStaffAccess
} from "./staff-access.js";
import { adminSetPortalPassword, changePortalPassword, loginWithPortalPassword, setPortalPassword } from "./portal-auth.js";
import { getClientGroupContext, getGroupMessages, markGroupRead, postGroupMessage } from "./group-support.js";
import { 
  calculateRentBreakdown 
} from "./calculation-engine.js";
import { 
  recordPaymentReceipt, 
  sendGmailReceipt,
  syncClientsFromSheet,
  readCachedClients,
  createAuthUrl,
  exchangeCodeForTokens,
  getActiveClientByEmail,
  getLaundryAvailabilityForMachine,
  getLaundryBookingContextForEmail,
  getCoinsForEmail,
  getFinesForEmail,
  getManagerClients,
  getManagerFines,
  disputeFine,
  managerAdjustCoins,
  managerCreatePaymentReceipt,
  managerCreateFine,
  managerResolveFineDispute,
  payFineByCoins,
  getPaymentsForEmail,
  getLaundryBookingsForEmail,
  getLaundryBookingsForEmailWithOptions,
  getActiveLaundryBooking,
  listLaundryCalendarsWithEvents,
  upgradeCozoroMemberByCoins,
  readCachedCoins,
  readCachedFines,
  readCachedPayments,
  createLaundryBooking,
  syncCoinsFromSheet,
  syncFinesFromSheet,
  syncPaymentsFromSheet,
  updateCoinSheetEntry,
  updateClientColumns,
  uploadFineImageToDrive,
  updateFineSheetEntry,
  updateLaundryBookingEntry,
  updatePaymentSheetEntry,
  readCachedMaintenance,
  reportMaintenanceTicket,
  startMaintenanceSyncInterval,
  syncMaintenanceFromSheet,
  updateMaintenanceTicket,
  MAINTENANCE_STATUS_COLUMN,
  MAINTENANCE_MECHANIC_EMAIL_COLUMN,
  MAINTENANCE_SOLVED_AT_COLUMN,
  MAINTENANCE_REPAIR_TIME_COLUMN,
  MAINTENANCE_SATISFACTION_COLUMN,
  MAINTENANCE_FEEDBACK_COLUMN
} from "./google-sheets.js";


import {
  adminAssignCleaningTask,
  adminAutoAssignCleaningSlots,
  auditCleaningTask,
  completeCleaningTask,
  checkSelfAssignCleaningTask,
  getAdminCleaningCalendars,
  generateCleaningSchedule,
  getAvailableUsersForAdminSlot,
  getAdminCleaningTasks,
  getCleaningOverviewForUser,
  getUserCleaningContext,
  releaseCleaningTask,
  selfAssignCleaningTask,
  sweepOverdueCleaningTasks,
  setCleaningAvailability
} from "./cleaning.js";
import { prisma } from "./prisma.js";


import {
  getGroupUnreadCounts,
  getResidentSupportConversation,
  getSupportConversationById,
  isPrivilegedSupportOperator,
  listManagerInbox,
  listResidentSupportNotifications,
  listStaffSupportNotifications,
  markSupportConversationRead,
  postOperatorSupportMessage,
  postOperatorSupportMessageToResident,
  postResidentSupportMessage,
  updateSupportConversationStatus
} from "./support.js";


const app = express();
const port = Number(process.env.PORT) || 4000; // AntiGravity: Use env PORT if available, default to 4000

const cleaningSweepIntervalMs = Number(process.env.CLEANING_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000);
const backgroundCleaningSweepEnabled = process.env.ENABLE_CLEANING_SWEEP === "true";
const cleaningSweepOnStartup = process.env.CLEANING_SWEEP_ON_STARTUP === "true";
let overdueCleaningSweepRunning = false;
const SENSITIVE_CLIENT_FIELD_PATTERNS = [
  "ngaysinh",
  "birthday",
  "birthdate",
  "cccd",
  "cmnd",
  "cancuoc",
  "passport",
  "hochieu",
  "idnumber",
  "socccd",
  "socmnd"
];
// AntiGravity: Support dynamic origins via environment variable
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/app\.cozorohome\.com$/i,
  /^https:\/\/api\.cozorohome\.com$/i,
  /^https:\/\/cozorohome\.com$/i,
  /^https:\/\/www\.cozorohome\.com$/i,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok\.app$/i,
  /^https:\/\/[a-z0-9-]+\.loca\.lt$/i
];

const portalOrigins = process.env.PORTAL_ORIGINS?.split(",").map(o => o.trim()).filter(Boolean) || [];
for (const origin of portalOrigins) {
  allowedOriginPatterns.push(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
}

function isAllowedOrigin(origin: string) {
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
}

function parseCalendarDateInput(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

async function runOverdueCleaningSweep(trigger: "startup" | "interval" | "manual") {
  if (overdueCleaningSweepRunning) {
    return {
      skipped: true,
      reason: "A previous overdue cleaning sweep is still running."
    };
  }

  overdueCleaningSweepRunning = true;

  try {
    const result = await sweepOverdueCleaningTasks();
    console.log(
      `[cleaning-overdue-sweep] trigger=${trigger} scanned=${result.scanned} markedMissed=${result.markedMissed}`
    );
    return {
      skipped: false,
      ...result
    };
  } finally {
    overdueCleaningSweepRunning = false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    }
  })
);
app.use((request, response, next) => {
  response.setHeader("Content-Language", "en, vi");
  response.charset = "utf-8";

  const originalJson = response.json.bind(response);
  response.json = (body: unknown) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return originalJson(body);
  };

  const originalSend = response.send.bind(response);
  response.send = (body: unknown) => {
    if (typeof body === "string" && !response.getHeader("Content-Type")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
    }
    return originalSend(body);
  };

  next();
});
app.use(express.json({ limit: "15mb" }));

const bookingInputSchema = z
  .object({
    userId: z.string().min(1),
    resourceId: z.string().min(1),
    startAt: z.string().datetime(),
    endAt: z.string().datetime()
  })
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"]
  });
const laundryMachineQuerySchema = z.object({
  email: z.string().email()
});
const laundryAvailabilityQuerySchema = z.object({
  email: z.string().email(),
  machineId: z.string().min(1)
});
const laundryBookingInputSchema = z.object({
  email: z.string().email(),
  machineId: z.string().min(1),
  start: z.string().datetime(),
  paymentMethod: z.enum(["FREE_LAUNDRY", "COINS", "CASH"]).optional(),
  couponCode: z.string().trim().min(1).optional()
});

const clientLookupSchema = z.object({
  email: z.string().email()
});
const portalPasswordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().trim().min(1)
});
const portalPasswordChangeSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().trim().min(1),
  newPassword: z.string().trim().min(4)
});
const portalPasswordAdminSetSchema = z.object({
  actorEmail: z.string().email(),
  targetEmail: z.string().email(),
  newPassword: z.string().trim().min(4)
});
const googlePortalLoginSchema = z.object({
  credential: z.string().min(1)
});
const staffAccessMutationSchema = z.object({
  actorEmail: z.string().email(),
  targetEmail: z.string().email(),
  role: z.enum(["manager", "owner"]),
  password: z.string().trim().min(4).optional()
});
const staffAccessRemovalSchema = z.object({
  actorEmail: z.string().email(),
  targetEmail: z.string().email()
});
const acCommandSchema = z.object({
  email: z.string().email(),
  action: z.enum(["ON", "OFF"])
});
const airFryerStartSchema = z.object({
  email: z.string().email(),
  inspection: z.string().min(1)
});
const laundryTriggerSchema = z.object({
  email: z.string().email(),
  machineId: z.string().min(1)
});
const privilegedAcCommandSchema = z.object({
  roomId: z.string().min(1),
  action: z.enum(["ON", "OFF"])
});
const fineCoinPaymentSchema = z.object({
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1)
});
const fineDisputeSchema = z.object({
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1),
  disputeText: z.string().trim().min(1)
});
const managerCoinAdjustmentSchema = z.object({
  maHd: z.string().min(1),
  delta: z.coerce.number().int(),
  reason: z.string().trim().min(1),
  operator: z.string().trim().min(1)
});
const managerPaymentReceiptCreateSchema = z.object({
  actorEmail: z.string().email(),
  maHd: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  purpose: z.string().trim().min(1),
  details: z.string().trim().optional(),
  payer: z.string().trim().optional(),
  receiver: z.string().trim().min(1)
});
const cozoroMemberUpgradeSchema = z.object({
  email: z.string().email(),
  targetMember: z.string().trim().min(1)
});
const managerFineCreateSchema = z.object({
  maHd: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  content: z.string().trim().min(1),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  dueDate: z.string().optional(),
  image: z.string().trim().optional(),
  operator: z.string().trim().min(1)
});
const fineImageUploadSchema = z.object({
  actorEmail: z.string().email(),
  maHd: z.string().min(1),
  clientName: z.string().trim().optional(),
  fileName: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  dataBase64: z.string().trim().min(1)
});
const managerFineResolveSchema = z.object({
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1),
  decision: z.enum(["KEEP_FINE", "CANCEL_FINE"]),
  note: z.string().trim().optional(),
  operator: z.string().trim().min(1)
});
const staffClientQuerySchema = z.object({
  actorEmail: z.string().email(),
  maHd: z.string().min(1)
});
const staffClientChatQuerySchema = z.object({
  actorEmail: z.string().email(),
  residentEmail: z.string().email()
});
const staffClientUpdateSchema = z.object({
  actorEmail: z.string().email(),
  maHd: z.string().min(1),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});
const staffSupportDirectMessageSchema = z.object({
  operatorEmail: z.string().email(),
  residentEmail: z.string().email(),
  body: z.string().trim().min(1)
});
const staffCoinUpdateSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  transactionCode: z.string().optional(),
  values: z.record(z.string(), z.string())
});
const staffPaymentUpdateSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  amount: z.string().optional(),
  purpose: z.string().optional(),
  values: z.record(z.string(), z.string())
});
const staffFineUpdateSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1),
  values: z.record(z.string(), z.string())
});
const staffLaundryUpdateSchema = z.object({
  actorEmail: z.string().email(),
  calendarId: z.string().min(1),
  eventId: z.string().min(1),
  summary: z.string(),
  description: z.string(),
  location: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime()
});

const clientUpdateSchema = z.object({
  actorEmail: z.string().email(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});
const cleaningAvailabilitySchema = z.object({
  email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.nativeEnum(CleaningAvailabilityType),
  note: z.string().optional()
});
const generateCleaningSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime()
});
const completeCleaningSchema = z.object({
  email: z.string().email(),
  note: z.string().optional(),
  photo: z.string().optional()
});
const releaseCleaningSchema = z.object({
  email: z.string().email()
});
const selfAssignCleaningSchema = z.object({
  email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"])
});
const auditCleaningSchema = z.object({
  reviewer: z.string().min(1),
  decision: z.nativeEnum(CleaningAuditDecision),
  note: z.string().optional()
});
const adminCleaningAvailabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.coerce.number().int().positive().optional(),
  excludeEmails: z
    .preprocess((value) => {
      if (typeof value !== "string") {
        return [];
      }

      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }, z.array(z.string().email()))
    .optional()
});
const adminAssignCleaningSchema = z.object({
  email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.number().int().positive().optional(),
  force: z.boolean().optional()
});
const adminBulkAutoAssignSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.number().int().positive().optional()
});
const supportResidentQuerySchema = z.object({
  email: z.string().email()
});
const supportResidentMessageSchema = z.object({
  email: z.string().email(),
  body: z.string().trim().min(1),
  pagePath: z.string().trim().optional()
});
const supportReadSchema = z.object({
  email: z.string().email()
});
const supportInboxQuerySchema = z.object({
  operatorEmail: z.string().email()
});
const supportOperatorMessageSchema = z.object({
  conversationId: z.string().min(1),
  operatorEmail: z.string().email(),
  body: z.string().trim().min(1)
});
const supportConversationStatusSchema = z.object({
  operatorEmail: z.string().email(),
  status: z.enum(["OPEN", "CLOSED"])
});
const groupMessageInputSchema = z.object({
  email: z.string().email(),
  groupId: z.string().min(1),
  body: z.string().trim().min(1),
  isAnonymous: z.boolean().optional()
});
const groupReadInputSchema = z.object({
  email: z.string().email(),
  groupId: z.string().min(1)
});


function computePriceCoins(
  resourceType: ResourceType,
  startAt: Date,
  endAt: Date
) {
  const minutes = Math.max(0, (endAt.getTime() - startAt.getTime()) / (1000 * 60));

  if (resourceType === ResourceType.WASHER) {
    return Math.ceil(minutes / 60) * 10;
  }

  if (resourceType === ResourceType.DRYER) {
    return Math.ceil(minutes / 60) * 12;
  }

  return Math.ceil(minutes / 30) * 5;
}

function normalizeSheetUpdateValues(values: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value == null ? "" : String(value)])
  );
}

function normalizePortalFieldLookup(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isSensitiveClientField(field: string) {
  const normalized = normalizePortalFieldLookup(field);
  return SENSITIVE_CLIENT_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

async function getUserBalance(userId: string, tx: Prisma.TransactionClient | typeof prisma) {
  const result = await tx.coinLedger.aggregate({
    _sum: { delta: true },
    where: { userId }
  });

  return result._sum.delta ?? 0;
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "cozorohome-api" });
});

app.post("/fines/pay-by-coins", async (request, response) => {
  const parsed = fineCoinPaymentSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid fine coin payment payload" });
  }

  try {
    const result = await payFineByCoins(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to pay fine by coins"
    });
  }
});

app.post("/fines/dispute", async (request, response) => {
  const parsed = fineDisputeSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid fine dispute payload" });
  }

  try {
    const result = await disputeFine(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to submit fine dispute"
    });
  }
});

app.get("/integrations/google/auth-url", (_request, response) => {
  try {
    const authUrl = createAuthUrl();
    return response.json({ authUrl });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to create Google auth URL"
    });
  }
});

app.get("/integrations/google/oauth/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";

  if (!code) {
    return response.status(400).send("Missing OAuth code");
  }

  try {
    await exchangeCodeForTokens(code);
    await syncClientsFromSheet();
    return response.send("Google Sheets connected. You can close this tab.");
  } catch (error) {
    console.error(error);
    return response.status(500).send("Google OAuth setup failed.");
  }
});

app.post("/clients/sync", async (_request, response) => {
  try {
    const cache = await syncClientsFromSheet();
    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to sync clients from Google Sheets"
    });
  }
});

app.post("/coins/sync", async (_request, response) => {
  try {
    const cache = await syncCoinsFromSheet();
    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to sync coins from Google Sheets"
    });
  }
});

app.post("/payments/sync", async (_request, response) => {
  try {
    const cache = await syncPaymentsFromSheet();
    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to sync payments from Google Sheets"
    });
  }
});

app.post("/fines/sync", async (_request, response) => {
  try {
    const cache = await syncFinesFromSheet();
    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to sync fines from Google Sheets"
    });
  }
});

app.get("/clients/cache", async (_request, response) => {
  const cache = await readCachedClients();

  if (!cache) {
    return response.status(404).json({ error: "No client cache available yet" });
  }

  return response.json(cache);
});

app.get("/coins/cache", async (_request, response) => {
  const cache = await readCachedCoins();

  if (!cache) {
    return response.status(404).json({ error: "No coins cache available yet" });
  }

  return response.json(cache);
});

app.get("/payments/cache", async (_request, response) => {
  const cache = await readCachedPayments();

  if (!cache) {
    return response.status(404).json({ error: "No payment cache available yet" });
  }

  return response.json(cache);
});

app.get("/fines/cache", async (_request, response) => {
  const cache = await readCachedFines();

  if (!cache) {
    return response.status(404).json({ error: "No fine cache available yet" });
  }

  return response.json(cache);
});

app.get("/clients", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  const client = await getActiveClientByEmail(parsed.data.email);

  if (!client) {
    return response.status(404).json({
      error: "No active client found for that email"
    });
  }

  return response.json(client);
});

app.get("/auth/resolve-login", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const result = await resolvePortalLogin(parsed.data.email);
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to resolve portal login"
    });
  }
});

app.post("/auth/login", async (request, response) => {
  const parsed = portalPasswordLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email and password are required."
    });
  }

  try {
    const result = await loginWithPortalPassword(parsed.data);
    return response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to log in.";
    const statusCode =
      message === "Only active users or approved app management emails can log in."
        ? 403
        : message === "Incorrect password for this email."
          ? 401
          : 400;

    return response.status(statusCode).json({ error: message });
  }
});

app.post("/auth/change-password", async (request, response) => {
  const parsed = portalPasswordChangeSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email, current password, and new password are required."
    });
  }

  try {
    const result = await changePortalPassword(parsed.data);
    return response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to change password.";
    const statusCode =
      message === "Only active users or approved app management emails can log in."
        ? 403
        : message === "Incorrect password for this email."
          ? 401
          : 400;

    return response.status(statusCode).json({ error: message });
  }
});

app.post("/auth/admin-set-password", async (request, response) => {
  const parsed = portalPasswordAdminSetSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid actor email, target email, and new password are required."
    });
  }

  try {
    const result = await adminSetPortalPassword(parsed.data);
    return response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to set password.";
    const statusCode = message.includes("Only app admins or owners") ? 403 : 400;
    return response.status(statusCode).json({ error: message });
  }
});

app.get("/support/group-context", async (request, response) => {
  const email = typeof request.query.email === "string" ? request.query.email : "";
  if (!email) {
    return response.status(400).json({ error: "Email is required" });
  }

  try {
    const context = await getClientGroupContext(email);
    return response.json(context);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to get group context"
    });
  }
});

app.get("/support/group-messages", async (request, response) => {
  const groupId = typeof request.query.groupId === "string" ? request.query.groupId : "";
  const email = typeof request.query.email === "string" ? request.query.email : "";

  if (!groupId || !email) {
    return response.status(400).json({ error: "groupId and email are required" });
  }

  try {
    const messages = await getGroupMessages({ groupId, viewerEmail: email });
    return response.json({ messages });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load group messages"
    });
  }
});

app.post("/support/group-messages", async (request, response) => {
  const parsed = groupMessageInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid group message payload" });
  }

  try {
    const result = await postGroupMessage({
      groupId: parsed.data.groupId,
      senderEmail: parsed.data.email,
      body: parsed.data.body,
      isAnonymous: parsed.data.isAnonymous ?? false
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to post group message"
    });
  }
});

app.post("/support/group-read", async (request, response) => {
  const parsed = groupReadInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid group read payload" });
  }

  try {
    const result = await markGroupRead({
      groupId: parsed.data.groupId,
      viewerEmail: parsed.data.email
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to mark group as read"
    });
  }
});

app.get("/auth/google/config", (_request, response) => {
  return response.json(getGooglePortalClientConfig());
});

app.post("/auth/google", async (request, response) => {
  const parsed = googlePortalLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "A Google credential is required" });
  }

  try {
    const result = await resolveGooglePortalLogin(parsed.data.credential);
    return response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify Google sign-in";
    const statusCode = message.includes("not configured") ? 503 : 401;
    return response.status(statusCode).json({ error: message });
  }
});

app.get("/staff-access", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const staff = await listStaffAccess(parsed.data.email);
    return response.json({ staff });
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to load staff access"
    });
  }
});

app.post("/staff-access", async (request, response) => {
  const parsed = staffAccessMutationSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff access payload" });
  }

  try {
    const result = await upsertStaffAccess(parsed.data);
    if (parsed.data.password) {
      await setPortalPassword({
        email: parsed.data.targetEmail,
        password: parsed.data.password,
        mustChangePassword: true
      });
    }
    return response.json(result);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to save staff access"
    });
  }
});

app.delete("/staff-access", async (request, response) => {
  const parsed = staffAccessRemovalSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff access removal payload" });
  }

  try {
    const result = await removeStaffAccess(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to remove staff access"
    });
  }
});

app.get("/controller/ac", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const context = await getUserAcControllerContext(parsed.data.email);
    return response.json(context);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load AC controller context"
    });
  }
});

app.post("/controller/ac/command", async (request, response) => {
  const parsed = acCommandSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid AC command payload" });
  }

  try {
    const result = await sendAcCommand(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to send AC command"
    });
  }
});

app.get("/controller/ac/rooms", async (_request, response) => {
  try {
    const rooms = await listPrivilegedAcRooms();
    return response.json({ rooms });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load AC rooms"
    });
  }
});

app.get("/manager/controller/devices", async (_request, response) => {
  try {
    const devices = await listAllDevices();
    return response.json(devices);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to list devices"
    });
  }
});

app.get("/manager/laundry/schedule", async (_request, response) => {
  try {
    const calendars = await listLaundryCalendarsWithEvents();
    const now = new Date();
    
    const schedule = calendars.map(cal => {
      // Sort events by start date
      const sortedEvents = [...cal.events].sort((a, b) => 
        new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      
      const previous = sortedEvents
        .filter(e => new Date(e.end) < now)
        .slice(-5);
        
      const upcoming = sortedEvents
        .filter(e => new Date(e.end) >= now)
        .slice(0, 2);
        
      return {
        id: cal.id,
        summary: cal.summary,
        previous,
        upcoming
      };
    });
    
    return response.json(schedule);
  } catch (error) {
    return response.status(500).json({ 
      error: error instanceof Error ? error.message : "Unable to load laundry schedule" 
    });
  }
});

app.post("/controller/ac/rooms/command", async (request, response) => {
  const parsed = privilegedAcCommandSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid privileged AC command payload" });
  }

  try {
    const result = await sendAcCommandToRoom(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to send room AC command"
    });
  }
});

app.get("/controller/airfryer", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const context = await getUserAirFryerContext(parsed.data.email);
    return response.json(context);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load air fryer status"
    });
  }
});

app.get("/controller/laundry", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({ email: request.query.email });
  if (!parsed.success) {
    return response.status(400).json({ error: "Email is required" });
  }
  try {
    const data = await getActiveLaundryBooking(parsed.data.email);
    return response.json(data);
  } catch (error) {
    return response.status(500).json({ error: "Unable to check laundry booking" });
  }
});

app.post("/controller/airfryer/start", async (request, response) => {
  const parsed = airFryerStartSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid air fryer start payload" });
  }

  try {
    const result = await startAirFryerUse(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to start air fryer use"
    });
  }
});

app.post("/laundry/manual-trigger", async (request, response) => {
  const parsed = laundryTriggerSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid laundry trigger payload" });
  }

  const { email, machineId } = parsed.data;

  try {
    // 1. Verify active booking window
    const bookings = await getLaundryBookingsForEmail(email);
    const now = new Date();
    const currentBooking = bookings.find((b) => {
      const start = new Date(b.start);
      // const end = new Date(b.end); // No longer strictly needed for the window check
      const graceStart = new Date(start.getTime() - 10 * 60000);   // 10 mins early buffer
      const graceEnd = new Date(start.getTime() + 20 * 60000);     // 20 mins after the START buffer
      return now >= graceStart && now <= graceEnd;
    });

    if (!currentBooking) {
      return response.status(403).json({
        error: "No active booking found for this time slot (within the 10m early/20m late buffer window)."
      });
    }

    // 2. Map machineId to IFTTT Maker Event names provided by user
    let eventName = "";
    const mid = machineId.toLowerCase();
    
    // Check for D2
    if (mid === "d2_laundry" || mid.includes("p5cvikf3pn8292denaig3gmed0")) {
      eventName = "wehbhookd2laundry"; // User provided this specific typo
    } 
    // Check for any D7 machine
    else if (mid.includes("d7") || mid.includes("iqido2c1") || mid.includes("vmtcgatm") || mid.includes("029mijq7")) {
      eventName = "webhookgiatd7";
    }

    if (!eventName) {
      return response.status(400).json({ error: `Unsupported machine ID: ${machineId}` });
    }

    // 3. Trigger IFTTT Webhook
    const key = process.env.IFTTT_WEBHOOK_KEY;
    if (!key) {
      throw new Error("IFTTT_WEBHOOK_KEY is not configured in environment.");
    }

    const iftttUrl = `https://maker.ifttt.com/trigger/${eventName}/with/key/${key}`;
    const result = await fetch(iftttUrl, { method: "POST" });

    if (!result.ok) {
      throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    return response.json({
      ok: true,
      message: `Triggered ${eventName} for ${machineId}`,
      booking: currentBooking.id
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to trigger laundry machine"
    });
  }
});

app.get("/coins", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const entries = await getCoinsForEmail(parsed.data.email);
    return response.json({
      email: parsed.data.email,
      entries
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load coin entries"
    });
  }
});

app.get("/payments", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const entries = await getPaymentsForEmail(parsed.data.email);
    return response.json({
      email: parsed.data.email,
      entries
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load payment entries"
    });
  }
});

app.get("/fines", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const entries = await getFinesForEmail(parsed.data.email);
    return response.json({
      email: parsed.data.email,
      entries
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load fine entries"
    });
  }
});

app.post("/manager/controller/laundry/trigger", async (request, response) => {
  const parsed = laundryTriggerSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid laundry trigger payload" });
  }

  const { machineId } = parsed.data;

  try {
    // 1. Map machineId to IFTTT Maker Event names
    let eventName = "";
    const mid = machineId.toLowerCase();
    
    if (mid === "d2_laundry") {
      eventName = "wehbhookd2laundry";
    } else if (mid.includes("d7")) {
      eventName = "webhookgiatd7";
    }

    if (!eventName) {
      return response.status(400).json({ error: `Unsupported machine ID: ${machineId}` });
    }

    // 2. Trigger IFTTT Webhook (Manager bypasses booking check)
    const key = process.env.IFTTT_WEBHOOK_KEY;
    if (!key) {
      throw new Error("IFTTT_WEBHOOK_KEY is not configured.");
    }

    const iftttUrl = `https://maker.ifttt.com/trigger/${eventName}/with/key/${key}`;
    const result = await fetch(iftttUrl, { method: "POST" });

    if (!result.ok) {
      throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    return response.json({
      ok: true,
      message: `Manager triggered ${eventName} for ${machineId}`
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to trigger laundry machine"
    });
  }
});

app.post("/manager/controller/airfryer/trigger", async (request, response) => {
  try {
    const eventName = process.env.AIRFRYER_D7_IFTTT_EVENT || "webhookairfryer";
    const key = process.env.IFTTT_WEBHOOK_KEY;
    
    const iftttUrl = `https://maker.ifttt.com/trigger/${eventName}/with/key/${key}`;
    const result = await fetch(iftttUrl, { method: "POST" });

    if (!result.ok) {
       throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    return response.json({ ok: true, message: "Airfryer triggered" });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to trigger airfryer"
    });
  }
});

app.get("/support/conversation", async (request, response) => {
  const parsed = supportResidentQuerySchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid email query parameter is required" });
  }

  try {
    const result = await getResidentSupportConversation(parsed.data.email);
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load support conversation"
    });
  }
});

app.post("/support/messages", async (request, response) => {
  const parsed = supportResidentMessageSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid support message payload" });
  }

  try {
    const result = await postResidentSupportMessage(parsed.data);
    return response.status(201).json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to send support message"
    });
  }
});

app.get("/support/notifications", async (request, response) => {
  const parsed = supportResidentQuerySchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid email query parameter is required" });
  }

  try {
    const result = await listResidentSupportNotifications(parsed.data.email);
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load support notifications"
    });
  }
});

app.post("/support/conversations/:id/read", async (request, response) => {
  const parsed = supportReadSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid support read payload" });
  }

  try {
    const readState = await markSupportConversationRead({
      conversationId: request.params.id,
      viewerEmail: parsed.data.email,
      viewerRole: "RESIDENT"
    });
    return response.json({ readState });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to mark support conversation as read"
    });
  }
});

app.get("/manager/support/conversations", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Only Cozoro team accounts can open the support inbox." });
  }

  try {
    const conversations = await listManagerInbox(parsed.data.operatorEmail);
    return response.json({ conversations });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load support inbox"
    });
  }
});

app.get("/manager/support/unread-counts", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Forbidden" });
  }

  try {
    const unreadCounts = await getGroupUnreadCounts(parsed.data.operatorEmail);
    return response.json({ unreadCounts });
  } catch (error) {
    return response.status(500).json({ error: "Unable to load unread counts" });
  }
});

app.get("/manager/support/notifications", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Only Cozoro team accounts can open staff notifications." });
  }

  try {
    const result = await listStaffSupportNotifications(parsed.data.operatorEmail);
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load staff notifications"
    });
  }
});

app.get("/manager/support/conversations/:id", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Only Cozoro team accounts can open this conversation." });
  }

  const id = request.params.id;
  const isGroup = id.startsWith("BRANCH_") || id.startsWith("FLOOR_") || id.startsWith("ROOM_");

  try {
    if (isGroup) {
      const messages = await getGroupMessages({ groupId: id, viewerEmail: parsed.data.operatorEmail });
      return response.json({
        conversation: {
          id,
          residentEmail: "group@cozorohome.com",
          residentName: id, // Frontend will handle formatting
          status: "OPEN",
          type: "GROUP"
        },
        messages
      });
    } else {
      const conversation = await getSupportConversationById(id);
      return response.json(conversation);
    }
  } catch (error) {
    return response.status(404).json({
      error: error instanceof Error ? error.message : "Unable to load conversation"
    });
  }
});

app.post("/manager/support/messages", async (request, response) => {
  const parsed = supportOperatorMessageSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid manager support message payload" });
  }

  const id = parsed.data.conversationId;
  const isGroup = id.startsWith("BRANCH_") || id.startsWith("FLOOR_") || id.startsWith("ROOM_");

  try {
    if (isGroup) {
      const message = await postGroupMessage({
        groupId: id,
        senderEmail: parsed.data.operatorEmail,
        body: parsed.data.body,
        isAnonymous: false
      });
      return response.status(201).json({ message });
    } else {
      const result = await postOperatorSupportMessage(parsed.data);
      return response.status(201).json(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send manager reply";
    const statusCode = message.includes("Only owner or manager") ? 403 : 400;
    return response.status(statusCode).json({ error: message });
  }
});

app.post("/manager/support/conversations/:id/status", async (request, response) => {
  const parsed = supportConversationStatusSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid support status payload" });
  }

  try {
    const conversation = await updateSupportConversationStatus({
      conversationId: request.params.id,
      operatorEmail: parsed.data.operatorEmail,
      status: parsed.data.status
    });
    return response.json({ conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update support conversation";
    const statusCode = message.includes("Only owner or manager") ? 403 : 400;
    return response.status(statusCode).json({ error: message });
  }
});

app.post("/manager/support/conversations/:id/read", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.body?.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Only Cozoro team accounts can mark staff notifications." });
  }

  const id = request.params.id;
  const isGroup = id.startsWith("BRANCH_") || id.startsWith("FLOOR_") || id.startsWith("ROOM_");

  try {
    if (isGroup) {
      await markGroupRead({
        groupId: id,
        viewerEmail: parsed.data.operatorEmail
      });
      return response.json({ ok: true });
    } else {
      const readState = await markSupportConversationRead({
        conversationId: id,
        viewerEmail: parsed.data.operatorEmail,
        viewerRole: "STAFF"
      });
      return response.json({ readState });
    }
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to mark staff conversation as read"
    });
  }
});

app.get("/staff/clients", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.actorEmail
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid actorEmail query parameter is required" });
  }

  try {
    await requirePortalRole(
      parsed.data.email,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can open the client workspace."
    );
    const clients = await getManagerClients();
    return response.json({ clients });
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to load staff clients"
    });
  }
});

app.get("/staff/client-workspace", async (request, response) => {
  const parsed = staffClientQuerySchema.safeParse({
    actorEmail: request.query.actorEmail,
    maHd: request.query.maHd
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid actorEmail and maHd are required" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can open the client workspace."
    );

    const clients = await getManagerClients();
    const client = clients.find((entry) => entry.maHd === parsed.data.maHd);

    if (!client) {
      return response.status(404).json({ error: "Client not found." });
    }

    const [coins, payments, fines, laundry] = await Promise.all([
      getCoinsForEmail(client.email),
      getPaymentsForEmail(client.email),
      getFinesForEmail(client.email),
      getLaundryBookingsForEmail(client.email)
    ]);

    return response.json({
      client,
      stats: {
        laundry: [...laundry].sort((left, right) => right.start.localeCompare(left.start)),
        coins,
        payments,
        fines
      }
    });
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to load the client workspace"
    });
  }
});

app.post("/staff/client-sheet-update", async (request, response) => {
  const parsed = staffClientUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff client update payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can update client records."
    );
    const cache = await updateClientColumns(parsed.data.maHd, normalizeSheetUpdateValues(parsed.data.values));
    return response.json(cache);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to update client data"
    });
  }
});

app.post("/staff/support/messages", async (request, response) => {
  const parsed = staffSupportDirectMessageSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff support message payload" });
  }

  try {
    const result = await postOperatorSupportMessageToResident(parsed.data);
    return response.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send staff message";
    return response.status(message.includes("Only") ? 403 : 400).json({ error: message });
  }
});

app.get("/staff/support/conversation", async (request, response) => {
  const parsed = staffClientChatQuerySchema.safeParse({
    actorEmail: request.query.actorEmail,
    residentEmail: request.query.residentEmail
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff support conversation query" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can open client chat."
    );
    const result = await getResidentSupportConversation(parsed.data.residentEmail);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load client chat"
    });
  }
});

app.post("/staff/coins/update", async (request, response) => {
  const parsed = staffCoinUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff coin update payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can edit coin entries."
    );
    const result = await updateCoinSheetEntry({
      email: parsed.data.email,
      timestamp: parsed.data.timestamp,
      transactionCode: parsed.data.transactionCode,
      values: parsed.data.values
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update coin entry"
    });
  }
});

app.post("/staff/payments/update", async (request, response) => {
  const parsed = staffPaymentUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff payment update payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can edit payment entries."
    );
    const result = await updatePaymentSheetEntry({
      email: parsed.data.email,
      timestamp: parsed.data.timestamp,
      amount: parsed.data.amount,
      purpose: parsed.data.purpose,
      values: parsed.data.values
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update payment entry"
    });
  }
});

app.post("/staff/fines/update", async (request, response) => {
  const parsed = staffFineUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff fine update payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can edit fine entries."
    );
    const result = await updateFineSheetEntry({
      email: parsed.data.email,
      timestamp: parsed.data.timestamp,
      content: parsed.data.content,
      values: parsed.data.values
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update fine entry"
    });
  }
});

app.post("/staff/laundry/update", async (request, response) => {
  const parsed = staffLaundryUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff laundry update payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can edit laundry entries."
    );
    const result = await updateLaundryBookingEntry(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update laundry entry"
    });
  }
});

app.get("/manager/clients", async (_request, response) => {
  try {
    const clients = await getManagerClients();
    return response.json({ clients });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load manager clients"
    });
  }
});

app.get("/manager/fines", async (_request, response) => {
  try {
    const entries = await getManagerFines();
    return response.json({ entries });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load manager fines"
    });
  }
});

app.post("/manager/coins/adjust", async (request, response) => {
  const parsed = managerCoinAdjustmentSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid manager coin adjustment payload" });
  }

  try {
    const result = await managerAdjustCoins(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to adjust client coins"
    });
  }
});

app.post("/manager/payments/create", async (request, response) => {
  const parsed = managerPaymentReceiptCreateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid payment receipt payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner"],
      "Only managers and owners can create payment receipts."
    );
    const result = await managerCreatePaymentReceipt({
      maHd: parsed.data.maHd,
      amount: parsed.data.amount,
      purpose: parsed.data.purpose,
      details: parsed.data.details,
      payer: parsed.data.payer,
      receiver: parsed.data.receiver
    });
    return response.status(201).json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to create payment receipt"
    });
  }
});

app.post("/cozoro-member/upgrade", async (request, response) => {
  const parsed = cozoroMemberUpgradeSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid Cozoro Member upgrade payload" });
  }

  try {
    const result = await upgradeCozoroMemberByCoins(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to upgrade Cozoro Member"
    });
  }
});

app.post("/manager/fines", async (request, response) => {
  const parsed = managerFineCreateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid manager fine payload" });
  }

  try {
    const result = await managerCreateFine(parsed.data);
    return response.status(201).json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to create manager fine"
    });
  }
});

app.post("/staff/fines/upload-image", async (request, response) => {
  const parsed = fineImageUploadSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid fine image upload payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only managers, owners, or the app admin can upload fine evidence."
    );

    const result = await uploadFineImageToDrive({
      maHd: parsed.data.maHd,
      clientName: parsed.data.clientName?.trim() || parsed.data.maHd,
      uploadedBy: parsed.data.actorEmail,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      base64Data: parsed.data.dataBase64
    });

    return response.status(201).json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to upload fine image"
    });
  }
});

app.post("/manager/fines/resolve", async (request, response) => {
  const parsed = managerFineResolveSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid manager fine resolution payload" });
  }

  try {
    const result = await managerResolveFineDispute(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to resolve fine dispute"
    });
  }
});

app.get("/cleaning/me", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid email query parameter is required" });
  }

  const refresh = request.query.refresh === "true";

  try {
    const overview = await getCleaningOverviewForUser(parsed.data.email, { forceRefresh: refresh });
    return response.json(overview);
  } catch (error) {
    return response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to load cleaning schedule"
    });
  }
});

app.post("/cleaning/availability", async (request, response) => {
  const parsed = cleaningAvailabilitySchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning availability payload" });
  }

  const userContext = await getUserCleaningContext(parsed.data.email);
  if (!userContext) {
    return response.status(404).json({ error: "Active user not found for cleaning availability" });
  }

  const availability = await setCleaningAvailability({
    email: parsed.data.email,
    branchId: userContext.branchId,
    floor: userContext.floor,
    date: parseCalendarDateInput(parsed.data.date),
    type: parsed.data.type,
    note: parsed.data.note
  });

  return response.json(availability);
});

app.post("/cleaning/generate", async (request, response) => {
  const parsed = generateCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning generation payload" });
  }

  try {
    const result = await generateCleaningSchedule(new Date(parsed.data.from), new Date(parsed.data.to));
    return response.json({
      imported: result.imported.length,
      created: result.created.length,
      tasks: [...result.imported, ...result.created]
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to generate cleaning schedule"
    });
  }
});

app.get("/admin/cleaning/tasks", async (request, response) => {
  const from = typeof request.query.from === "string" ? new Date(request.query.from) : undefined;
  const to = typeof request.query.to === "string" ? new Date(request.query.to) : undefined;
  const tasks = await getAdminCleaningTasks(from, to);
  return response.json({ tasks });
});

app.get("/admin/cleaning/calendars", async (request, response) => {
  const from = typeof request.query.from === "string" ? new Date(request.query.from) : undefined;
  const to = typeof request.query.to === "string" ? new Date(request.query.to) : undefined;
  const calendars = await getAdminCleaningCalendars(from, to);
  return response.json({ calendars });
});

app.get("/admin/cleaning/available-users", async (request, response) => {
  const parsed = adminCleaningAvailabilitySchema.safeParse({
    date: request.query.date,
    type: request.query.type,
    floor: request.query.floor,
    excludeEmails: request.query.excludeEmails
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid admin cleaning availability query" });
  }

  try {
    const users = await getAvailableUsersForAdminSlot({
      date: parseCalendarDateInput(parsed.data.date),
      type: parsed.data.type,
      floor: parsed.data.floor,
      excludeEmails: parsed.data.excludeEmails
    });
    return response.json({ users });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load available users"
    });
  }
});

app.post("/admin/cleaning/assign", async (request, response) => {
  const parsed = adminAssignCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid admin cleaning assignment payload" });
  }

  try {
    const task = await adminAssignCleaningTask({
      email: parsed.data.email,
      date: parseCalendarDateInput(parsed.data.date),
      type: parsed.data.type,
      floor: parsed.data.floor,
      force: parsed.data.force
    });
    return response.json(task);
  } catch (error) {
    if (error instanceof Error && error.name === "CleaningAssignmentConflictError") {
      const conflicts =
        "conflicts" in error && Array.isArray((error as { conflicts?: unknown[] }).conflicts)
          ? (error as { conflicts: unknown[] }).conflicts
          : [];
      return response.status(409).json({
        error: error.message,
        conflicts
      });
    }
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to assign cleaning task"
    });
  }
});

app.post("/admin/cleaning/auto-assign", async (request, response) => {
  const parsed = adminBulkAutoAssignSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid admin bulk auto-assignment payload" });
  }

  try {
    const tasks = await adminAutoAssignCleaningSlots({
      dates: parsed.data.dates.map((value) => parseCalendarDateInput(value)),
      type: parsed.data.type,
      floor: parsed.data.floor
    });
    return response.json({ assigned: tasks.length, tasks });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to auto-assign cleaning tasks"
    });
  }
});

app.post("/cleaning/tasks/:id/complete", async (request, response) => {
  const parsed = completeCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning completion payload" });
  }

  try {
    const task = await completeCleaningTask(
      request.params.id,
      parsed.data.email,
      parsed.data.note,
      parsed.data.photo
    );
    return response.json(task);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to complete cleaning task"
    });
  }
});

app.post("/cleaning/tasks/:id/release", async (request, response) => {
  const parsed = releaseCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning release payload" });
  }

  try {
    const task = await releaseCleaningTask(request.params.id, parsed.data.email);
    return response.json(task);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to release cleaning task"
    });
  }
});

app.post("/cleaning/self-assign", async (request, response) => {
  const parsed = selfAssignCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning self-assignment payload" });
  }

  try {
    const task = await selfAssignCleaningTask({
      email: parsed.data.email,
      date: parseCalendarDateInput(parsed.data.date),
      type: parsed.data.type
    });
    return response.json(task);
  } catch (error) {
    if (error instanceof Error && error.name === "CleaningSelfAssignConflictError") {
      const suggestions =
        "suggestions" in error && Array.isArray((error as { suggestions?: unknown[] }).suggestions)
          ? (error as { suggestions: unknown[] }).suggestions
          : [];
      return response.status(409).json({
        error: error.message,
        suggestions
      });
    }
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to self-assign cleaning task"
    });
  }
});

app.post("/cleaning/self-assign/check", async (request, response) => {
  const parsed = selfAssignCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid self-assignment payload" });
  }

  try {
    const result = await checkSelfAssignCleaningTask({
      email: parsed.data.email,
      date: parseCalendarDateInput(parsed.data.date),
      type: parsed.data.type
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to check self-assignment"
    });
  }
});

app.post("/admin/cleaning/tasks/:id/audit", async (request, response) => {
  const parsed = auditCleaningSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning audit payload" });
  }

  try {
    const task = await auditCleaningTask({
      taskId: request.params.id,
      reviewer: parsed.data.reviewer,
      decision: parsed.data.decision,
      note: parsed.data.note
    });
    return response.json(task);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to audit cleaning task"
    });
  }
});

app.post("/admin/cleaning/overdue/run", async (_request, response) => {
  try {
    const result = await runOverdueCleaningSweep("manual");
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to run overdue cleaning sweep"
    });
  }
});

app.get("/clients/laundry-bookings", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const refresh = request.query.refresh === "true";
    const bookings = refresh
      ? await getLaundryBookingsForEmailWithOptions(parsed.data.email, { forceRefresh: true })
      : await getLaundryBookingsForEmail(parsed.data.email);
    return response.json({ email: parsed.data.email, bookings });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load Google Calendar bookings"
    });
  }
});

app.get("/laundry/machines", async (request, response) => {
  const parsed = laundryMachineQuerySchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const context = await getLaundryBookingContextForEmail(parsed.data.email);
    if (!context) {
      return response.status(404).json({ error: "No active client found for that email" });
    }

    return response.json({
      email: parsed.data.email,
      branchId: context.branchId,
      coins: context.client?.["Cozoro coins hiện có"] ?? "",
      machines: context.machines,
      allowance: context.allowance,
      timeZone: context.timeZone
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load laundry machines"
    });
  }
});

app.get("/laundry/availability", async (request, response) => {
  const parsed = laundryAvailabilityQuerySchema.safeParse({
    email: request.query.email,
    machineId: request.query.machineId
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email and machineId are required"
    });
  }

  try {
    const result = await getLaundryAvailabilityForMachine({
      email: parsed.data.email,
      machineId: parsed.data.machineId,
      days: 7,
      forceRefresh: request.query.refresh === "true"
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load laundry availability"
    });
  }
});

app.get("/laundry/bookings", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const refresh = request.query.refresh === "true";
    const bookings = refresh
      ? await getLaundryBookingsForEmailWithOptions(parsed.data.email, { forceRefresh: true })
      : await getLaundryBookingsForEmail(parsed.data.email);
    return response.json({ email: parsed.data.email, bookings });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load laundry bookings"
    });
  }
});

app.post("/laundry/bookings", async (request, response) => {
  const parsed = laundryBookingInputSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "Invalid laundry booking payload"
    });
  }

  try {
    const booking = await createLaundryBooking(parsed.data);
    return response.status(201).json(booking);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create laundry booking";
    const statusCode =
      message === "Selected time is no longer available" ||
      message === "Bookings are only available for the next 7 days"
        ? 409
        : 400;
    return response.status(statusCode).json({ error: message });
  }
});

app.get("/admin/laundry-calendars", async (_request, response) => {
  try {
    const calendars = await listLaundryCalendarsWithEvents();
    return response.json({ calendars });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load Google Calendar laundry data"
    });
  }
});

app.post("/clients/:maHd/sheet-update", async (request, response) => {
  const maHd = request.params.maHd;
  const parsed = clientUpdateSchema.safeParse(request.body);

  if (!maHd) {
    return response.status(400).json({ error: "MÃ HD is required" });
  }

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid client update payload" });
  }

  try {
    const actor = await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only managers, owners, or the app admin can update client data."
    );
    const sensitiveFields = Object.keys(parsed.data.values).filter((field) => isSensitiveClientField(field));

    if (actor.role === "manager" && sensitiveFields.length > 0) {
      return response.status(403).json({
        error: "Managers cannot view or edit sensitive identity or birthday fields."
      });
    }

    const normalizedValues = Object.fromEntries(
      Object.entries(parsed.data.values).map(([key, value]) => [key, value == null ? "" : String(value)])
    );
    const cache = await updateClientColumns(maHd, normalizedValues);
    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to update the Google Sheet"
    });
  }
});

app.get("/resources", async (request, response) => {
  const branchId = request.query.branchId;

  if (typeof branchId !== "string" || !branchId) {
    return response.status(400).json({ error: "branchId is required" });
  }

  const resources = await prisma.resource.findMany({
    where: {
      branchId,
      active: true
    },
    orderBy: [{ type: "asc" }, { label: "asc" }]
  });

  return response.json(resources);
});

app.get("/bookings", async (request, response) => {
  const resourceId = typeof request.query.resourceId === "string" ? request.query.resourceId : undefined;
  const from = typeof request.query.from === "string" ? new Date(request.query.from) : undefined;
  const to = typeof request.query.to === "string" ? new Date(request.query.to) : undefined;
  const userId = typeof request.query.userId === "string" ? request.query.userId : undefined;

  const invalidFrom = from && Number.isNaN(from.getTime());
  const invalidTo = to && Number.isNaN(to.getTime());

  if (invalidFrom || invalidTo) {
    return response.status(400).json({ error: "from and to must be valid ISO date strings" });
  }

  const bookings = await prisma.booking.findMany({
    where: {
      ...(resourceId ? { resourceId } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            startAt: {
              ...(to ? { lt: to } : {})
            },
            endAt: {
              ...(from ? { gt: from } : {})
            }
          }
        : {})
    },
    include: {
      resource: true
    },
    orderBy: {
      startAt: "asc"
    }
  });

  return response.json(bookings);
});

app.get("/users/:userId/balance", async (request, response) => {
  const balance = await getUserBalance(request.params.userId, prisma);
  return response.json({ userId: request.params.userId, balance });
});

app.post("/bookings", async (request, response) => {
  const parsed = bookingInputSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "Invalid booking payload",
      issues: parsed.error.flatten()
    });
  }

  const { userId, resourceId, startAt: startAtInput, endAt: endAtInput } = parsed.data;
  const startAt = new Date(startAtInput);
  const endAt = new Date(endAtInput);

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId }
  });

  if (!resource || !resource.active) {
    return response.status(404).json({ error: "Resource not found" });
  }

  const priceCoins = computePriceCoins(resource.type, startAt, endAt);

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const overlappingBooking = await tx.booking.findFirst({
        where: {
          resourceId,
          status: BookingStatus.CONFIRMED,
          startAt: { lt: endAt },
          endAt: { gt: startAt }
        }
      });

      if (overlappingBooking) {
        throw new Error("OVERLAPPING_BOOKING");
      }

      const balance = await getUserBalance(userId, tx);

      if (balance < priceCoins) {
        throw new Error("INSUFFICIENT_COINS");
      }

      const createdBooking = await tx.booking.create({
        data: {
          userId,
          resourceId,
          startAt,
          endAt,
          priceCoins
        },
        include: {
          resource: true
        }
      });

      await tx.coinLedger.create({
        data: {
          userId,
          delta: -priceCoins,
          reason: CoinReason.BOOKING_CHARGE,
          refType: "booking",
          refId: createdBooking.id
        }
      });

      return createdBooking;
    });

    return response.status(201).json(booking);
  } catch (error) {
    if (error instanceof Error && error.message === "OVERLAPPING_BOOKING") {
      return response.status(409).json({ error: "Selected slot overlaps an existing booking" });
    }

    if (error instanceof Error && error.message === "INSUFFICIENT_COINS") {
      return response.status(400).json({ error: "Insufficient coins" });
    }

    console.error(error);
    return response.status(500).json({ error: "Unable to create booking" });
  }
});

app.post("/bookings/:id/cancel", async (request, response) => {
  const booking = await prisma.booking.findUnique({
    where: { id: request.params.id }
  });

  if (!booking) {
    return response.status(404).json({ error: "Booking not found" });
  }

  if (booking.status === BookingStatus.CANCELLED) {
    return response.json(booking);
  }

  const updatedBooking = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED
      },
      include: {
        resource: true
      }
    });

    await tx.coinLedger.create({
      data: {
        userId: booking.userId,
        delta: booking.priceCoins,
        reason: CoinReason.REFUND,
        refType: "booking",
        refId: booking.id
      }
    });

    return cancelled;
  });

  return response.json(updatedBooking);
});

// Maintenance Endpoints
app.post("/client/maintenance/report", async (req, res) => {
  const { email, name, branch, location, issue, machineDevice } = req.body;
  if (!email || !location || !issue) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await reportMaintenanceTicket({
      residentEmail: email,
      residentName: name || email,
      branch: branch || "D7",
      location,
      issue,
      machineDevice
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Reporting failed" });
  }
});

app.get("/client/maintenance/tickets", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const cache = (await readCachedMaintenance()) || (await syncMaintenanceFromSheet());
    const tickets = cache.tickets.filter(t => t.residentEmail === String(email).trim().toLowerCase());
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ error: "Failed to load tickets" });
  }
});

app.get("/staff/maintenance/tickets", async (req, res) => {
  try {
    const cache = (await readCachedMaintenance()) || (await syncMaintenanceFromSheet());
    let tickets = cache.tickets;

    const { status, branch } = req.query;
    if (status) {
      tickets = tickets.filter(t => t.status === String(status).toUpperCase());
    }
    if (branch) {
      tickets = tickets.filter(t => t.branch === String(branch));
    }

    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ error: "Failed to load tickets" });
  }
});

app.post("/staff/maintenance/update", async (req, res) => {
  const { ticketId, status, mechanicEmail, solvedAt, repairTimeMinutes } = req.body;
  if (!ticketId || !status) {
    return res.status(400).json({ error: "ticketId and status are required" });
  }

  try {
    const values: Record<string, string> = {
      [MAINTENANCE_STATUS_COLUMN]: String(status).toUpperCase()
    };
    if (mechanicEmail) values[MAINTENANCE_MECHANIC_EMAIL_COLUMN] = mechanicEmail;
    if (solvedAt) values[MAINTENANCE_SOLVED_AT_COLUMN] = solvedAt;
    if (repairTimeMinutes !== undefined) values[MAINTENANCE_REPAIR_TIME_COLUMN] = String(repairTimeMinutes);

    const result = await updateMaintenanceTicket(ticketId, values);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Update failed" });
  }
});

app.post("/client/maintenance/feedback", async (req, res) => {
  const { ticketId, satisfaction, feedback } = req.body;
  if (!ticketId || !satisfaction) {
    return res.status(400).json({ error: "ticketId and satisfaction are required" });
  }

  try {
    const result = await updateMaintenanceTicket(ticketId, {
      [MAINTENANCE_SATISFACTION_COLUMN]: String(satisfaction).toUpperCase(),
      [MAINTENANCE_FEEDBACK_COLUMN]: feedback || ""
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Feedback failed" });
  }
});

app.post("/calculate-rent", async (req, res) => {
  const { email, targetMonth, managerDiscountVnd } = req.body;
  if (!email || !targetMonth) {
    return res.status(400).json({ error: "email and targetMonth are required" });
  }

  try {
    const cache = (await readCachedClients()) ?? (await syncClientsFromSheet());
    const client = cache.rows.find((r) => r["Địa chỉ email"] === email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const breakdown = await calculateRentBreakdown(client, targetMonth, managerDiscountVnd || 0);
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Calculation failed" });
  }
});

app.post("/pay-rent", async (req, res) => {
  const { email, targetMonth, managerDiscountVnd, coinUsage, payerName, receiverName } = req.body;
  if (!email || !targetMonth || !payerName) {
    return res.status(400).json({ error: "email, targetMonth, and payerName are required" });
  }

  try {
    const cache = (await readCachedClients()) ?? (await syncClientsFromSheet());
    const client = cache.rows.find((r) => r["Địa chỉ email"] === email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const breakdown = await calculateRentBreakdown(client, targetMonth, managerDiscountVnd || 0);
    
    // Record to Google Sheet
    await recordPaymentReceipt({
      email,
      name: client["Tên"] || "",
      amountVnd: breakdown.finalTotalVnd,
      purpose: `Rent Payment - ${targetMonth}`,
      details: JSON.stringify({
        baseRent: breakdown.baseRent,
        surcharges: breakdown.tenureSurchargeVnd,
        discounts: breakdown.professionalDiscountVnd + breakdown.planDiscountVnd + (managerDiscountVnd || 0),
        coinUsage: coinUsage || breakdown.recommendedCoinUsage,
        coinValue: Math.round((coinUsage || breakdown.recommendedCoinUsage) * (breakdown.finalTotalVnd / breakdown.totalBeforeCoinsVnd)) // Simple estimation
      }),
      payer: payerName,
      receiver: receiverName || "Cozoro System"
    });

    // Send Gmail Receipt
    const subject = `[Cozoro Home] Biên nhận thanh toán tháng ${targetMonth}`;
    const body = `
Xin chào ${client["Tên"]},

Cozoro Home đã nhận được thanh toán của bạn cho tháng ${targetMonth}.

Chi tiết biên nhận:
- Email: ${email}
- Số tiền: ${breakdown.finalTotalVnd.toLocaleString("vi-VN")} VND
- Hình thức: Thanh toán qua Manager Portal
- Người nộp: ${payerName}
- Ngày: ${new Date().toLocaleDateString("vi-VN")}

Cảm ơn bạn đã đồng hành cùng Cozoro Home!
    `.trim();

    await sendGmailReceipt({
      to: email,
      subject,
      body
    });

    res.json({ success: true, message: "Payment recorded and receipt sent" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Payment failed" });
  }
});

app.listen(port, () => {
  console.log(`[AntiGravity v2] cozorohome-api listening on http://localhost:${port}`);

  startMaintenanceSyncInterval();

  if (backgroundCleaningSweepEnabled) {
    if (cleaningSweepOnStartup) {
      void runOverdueCleaningSweep("startup").catch((error) => {
        console.error("[cleaning-overdue-sweep] startup failed", error);
      });
    }

    const timer = setInterval(() => {
      void runOverdueCleaningSweep("interval").catch((error) => {
        console.error("[cleaning-overdue-sweep] interval failed", error);
      });
    }, cleaningSweepIntervalMs);

    timer.unref();
  }
});
