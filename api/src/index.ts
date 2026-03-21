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
  listPrivilegedAcRooms,
  sendAcCommand,
  sendAcCommandToRoom
} from "./ac-controller.js";

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
import {
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
  managerCreateFine,
  managerResolveFineDispute,
  payFineByCoins,
  getPaymentsForEmail,
  getLaundryBookingsForEmail,
  getLaundryBookingsForEmailWithOptions,
  listLaundryCalendarsWithEvents,
  upgradeCozoroMemberByCoins,
  readCachedCoins,
  readCachedClients,
  readCachedFines,
  readCachedPayments,
  createLaundryBooking,
  syncCoinsFromSheet,
  syncClientsFromSheet,
  syncFinesFromSheet,
  syncPaymentsFromSheet,
  updateClientColumns
} from "./google-sheets.js";
import { prisma } from "./prisma.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const cleaningSweepIntervalMs = Number(process.env.CLEANING_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000);
let overdueCleaningSweepRunning = false;
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok\.app$/i,
  /^https:\/\/[a-z0-9-]+\.loca\.lt$/i
];

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
app.use(express.json());

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
const acCommandSchema = z.object({
  email: z.string().email(),
  action: z.enum(["ON", "OFF"])
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
  operator: z.string().trim().min(1)
});
const managerFineResolveSchema = z.object({
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1),
  decision: z.enum(["KEEP_FINE", "CANCEL_FINE"]),
  note: z.string().trim().optional(),
  operator: z.string().trim().min(1)
});

const clientUpdateSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
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
      coins: context.client["Cozoro coins hiện có"] ?? "",
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
    const normalizedValues = Object.fromEntries(
      Object.entries(parsed.data).map(([key, value]) => [key, value == null ? "" : String(value)])
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

app.listen(port, () => {
  console.log(`cozorohome-api listening on http://localhost:${port}`);
  void runOverdueCleaningSweep("startup").catch((error) => {
    console.error("[cleaning-overdue-sweep] startup failed", error);
  });
  setInterval(() => {
    void runOverdueCleaningSweep("interval").catch((error) => {
      console.error("[cleaning-overdue-sweep] interval failed", error);
    });
  }, cleaningSweepIntervalMs);
});
