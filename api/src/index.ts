import "./load-env.js";

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
import {
  dismissAcComfortAlert,
  getAcComfortPublicStatus,
  submitAcComfortVote,
  type AcComfortPublicStatus
} from "./ac-comfort-votes.js";
import { appendControllerHistoryEntry, listControllerHistory } from "./controller-history.js";
import { getUserAirFryerContext, startAirFryerUse } from "./airfryer-controller.js";
import { getUserMicrowaveContext, startMicrowaveUse } from "./microwave-controller.js";
import {
  getGooglePortalClientConfig,
  getManagerPermissions,
  getStaffName,
  listStaffAccess,
  removeStaffAccess,
  requirePortalRole,
  resolveGooglePortalLogin,
  resolvePortalLogin,
  setManagerPermissions,
  updateSelfName,
  upsertStaffAccess
} from "./staff-access.js";
import { adminSetPortalPassword, changePortalPassword, loginWithPortalPassword, setPortalPassword, upsertStoredPassword } from "./portal-auth.js";
import { getAccountLockOverride, setAccountLockOverride } from "./account-lock-overrides.js";
import { getClientGroupContext, getGroupMessages, markGroupRead, postGroupMessage } from "./group-support.js";
import { VAPID_PUBLIC_KEY, savePushSubscription, deletePushSubscription, sendPushToEmail } from "./push.js";
import { getCleaningRewardSettings, updateCleaningRewardSettings } from "./cleaning-reward-settings.js";
import { getManagerFridgeDrainSchedule, upsertFridgeDrainCleaningDate } from "./fridge-drain-schedule.js";
import { getPortalUxSettings, updatePortalUxSettings } from "./portal-ux-settings.js";
import {
  createGuideSchema,
  createResidentGuide,
  deleteResidentGuide,
  listResidentGuidesPublic,
  updateGuideSchema,
  updateResidentGuide
} from "./resident-guides.js";
import { calculateRentBreakdown, computePrepaidNextPaymentEstimate } from "./calculation-engine.js";
import { calculateRentBreakdownForBillingMonth } from "./monthly-rent-breakdown.js";
import {
  managerGetPrepaidPackageBilling,
  managerUpsertPrepaidPackageBilling,
  managerConfirmPrepaidPackageBilling,
  managerNotifyPrepaidPackageBilling,
  getConfirmedPrepaidBillingForResident
} from "./manager-prepaid-package.js";
import { applyPrepaidBreakdownOverridesToEstimate } from "./prepaid-breakdown-overrides.js";
import type { PrepaidBreakdownOverrides } from "./prepaid-breakdown-overrides.js";
import { 
  createAutomaticFineForEmail,
  sendGmailReceipt,
  syncClientsFromSheet,
  submitPublicRegistration,
  anyClientRowExistsForEmail,
  applyReferralRegistrationRewards,
  upsertPaidGuestBookingClient,
  readCachedClients,
  createAuthUrl,
  exchangeCodeForTokens,
  getActiveClientByEmail,
  getLaundryAvailabilityForMachine,
  getLaundryBookingContextForEmail,
  getCoinsForEmail,
  getFinesForEmail,
  getManagerClients,
  getManagerInactiveClients,
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
  getConfiguredLaundryMachines,
  upgradeCozoroMemberByCoins,
  readCachedCoins,
  readCachedFines,
  readCachedPayments,
  createLaundryBooking,
  cancelLaundryBooking,
  staffDeleteLaundryBooking,
  syncCoinsFromSheet,
  syncFinesFromSheet,
  syncPaymentsFromSheet,
  updateCoinSheetEntry,
  deleteCoinSheetEntry,
  updateClientColumns,
  uploadFineImageToDrive,
  updateFineSheetEntry,
  deleteFineSheetEntry,
  updateLaundryBookingEntry,
  updateLaundryMachineSettings,
  setLaundryMachineMaintenanceMode,
  updatePaymentSheetEntry,
  deletePaymentSheetEntry,
  readCachedMaintenance,
  reportMaintenanceTicket,
  startMaintenanceSyncInterval,
  syncMaintenanceFromSheet,
  updateMaintenanceTicket,
  extendClientContract,
  CLIENT_BED_COLUMN,
  CLIENT_BRANCH_COLUMN,
  normalizeClientBranch,
  MAINTENANCE_STATUS_COLUMN,
  MAINTENANCE_MECHANIC_EMAIL_COLUMN,
  MAINTENANCE_SOLVED_AT_COLUMN,
  MAINTENANCE_REPAIR_TIME_COLUMN,
  MAINTENANCE_SATISFACTION_COLUMN,
  MAINTENANCE_FEEDBACK_COLUMN,
  logMicrowaveUse,
  getDuplicateActiveClients,
  appendCheckoutSheetRow,
  awardVentHammerGameCoinsToSheet
} from "./google-sheets.js";
import {
  checkProspectReferralEligibility,
  getProspectAssistantPublicSettings,
  getProspectBedAvailability,
  resolveLongTermListPriceForBed,
  updateProspectAssistantSettings
} from "./prospect-assistant.js";
import type { ReferralProgramSettings } from "./referral-program.js";
import {
  computeReferralCodeForEmail,
  getReferralProgramPublicMarketing,
  getReferralProgramSettings,
  quoteReferralOffer,
  resolveReferralForHostelImport,
  resolveReferralForNewRegistration,
  resolveReferrerFromCode,
  updateReferralProgramSettings
} from "./referral-program.js";


import {
  adminAssignCleaningTask,
  adminAutoAssignCleaningSlots,
  adminRemoveCleaningTask,
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
  sweepMonthlyEvasionPenalties,
  autoScheduleCleaningTasksByJob,
  setCleaningAvailability,
  setBulkCleaningAvailability,
  getCleaningOptOutForEmail,
  setCleaningOptOut,
  cancelCleaningOptOut,
  upsertContractCleaningOptOut,
  recoverDeferredCleaningCalendarCreates
} from "./cleaning.js";
import {
  getCleaningAutoSchedulerConfig,
  updateCleaningAutoSchedulerConfig
} from "./cleaning-scheduler-config.js";
import { prisma } from "./prisma.js";
import { billingPeriodMonthForGateSession, markGateParkingTicketsPaidForBilling } from "./gate-parking-tickets.js";
import {
  terminateContract,
  getTerminationByEmail,
  getTerminationByMaHd,
  submitCheckOut,
  ensureCheckoutPhotosDir,
  checkoutPhotosDirPath,
  getCheckoutContext,
  verifyCheckoutPhotoAccess
} from "./checkout.js";
import { getShortTermConfig, updateShortTermConfig } from "./short-term-config.js";
import { handleManagerAiChat, type AiChatMessage } from "./manager-ai-chat.js";
import { handleResidentPortalAiChat, type ResidentPortalAiMessage } from "./resident-portal-ai-chat.js";
import { getVentHammerRedeemToday, markVentHammerRedeemedToday } from "./vent-hammer-redeem-guard.js";
import {
  managerGetDepositRefundPreview,
  managerSendDepositRefundEmail
} from "./manager-deposit-refund.js";
import {
  getBedOverrides,
  getDiscounts,
  upsertBedOverride,
  deleteBedOverride,
  upsertDiscount,
  deleteDiscount,
  getAllBranchPricingSettings,
  getBranchPricingSettings,
  upsertBranchPricingSettings,
  getBedParkingFeeOverrides,
  upsertBedParkingFeeOverride,
  deleteBedParkingFeeOverride,
  listParkingPricingTiers,
  upsertParkingPricingTier,
  deleteParkingPricingTier,
  resolveParkingTierChoicesForBed,
  type TermType
} from "./pricing-config.js";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";


import {
  getGroupUnreadCounts,
  getResidentSupportConversation,
  getSupportConversationById,
  isPrivilegedSupportOperator,
  listManagerInbox,
  clearAllResidentNotificationCaches,
  listResidentSupportNotifications,
  listStaffSupportNotifications,
  invalidateStaffSupportNotificationCache,
  markSupportConversationRead,
  ownerDeleteSupportConversation,
  ownerDeleteSupportMessage,
  postOperatorSupportMessage,
  postOperatorSupportMessageToResident,
  postResidentSupportMessage,
  tryAppendAssistantAfterResidentMessage,
  updateSupportConversationStatus
} from "./support.js";


const app = express();
const port = Number(process.env.PORT) || 4000; // AntiGravity: Use env PORT if available, default to 4000
const GUEST_AUTH_RATE_PATH = path.join(process.cwd(), "data", "guest-auth-rate.json");
const GUEST_AUTH_MIN_INTERVAL_MS = 60 * 1000;
const GUEST_AUTH_MAX_PER_EMAIL_PER_HOUR = 3;
const GUEST_AUTH_MAX_PER_EMAIL_PER_DAY = 10;
const GUEST_AUTH_MAX_PER_IP_PER_HOUR = 10;

const cleaningSweepIntervalMs = Number(process.env.CLEANING_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000);
const backgroundCleaningSweepEnabled = process.env.ENABLE_CLEANING_SWEEP === "true";
const cleaningSweepOnStartup = process.env.CLEANING_SWEEP_ON_STARTUP === "true";
let overdueCleaningSweepRunning = false;

const autoScheduleIntervalMs = Number(process.env.AUTO_SCHEDULE_INTERVAL_MS ?? 60 * 60 * 1000); // default 1 hour
let autoScheduleRunning = false;
const WRITE_GUARD_DEFAULT_WINDOW_MS = Number(process.env.WRITE_GUARD_DEFAULT_WINDOW_MS ?? 8000);
const writeGuardInFlightKeys = new Set<string>();
const writeGuardRecentKeys = new Map<string, number>();
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

function isLoopbackAddress(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIp(value: string | null | undefined) {
  return String(value ?? "").trim().split(",")[0]?.trim() || "unknown";
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

async function readGuestAuthRateFile() {
  try {
    const raw = await readFile(GUEST_AUTH_RATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      email?: Record<string, { lastSentAt?: string; hourly?: Record<string, number>; daily?: Record<string, number> }>;
      ip?: Record<string, { hourly?: Record<string, number> }>;
    };
    return {
      email: parsed.email ?? {},
      ip: parsed.ip ?? {}
    };
  } catch {
    return { email: {}, ip: {} };
  }
}

async function writeGuestAuthRateFile(file: { email: Record<string, any>; ip: Record<string, any> }) {
  await writeFile(GUEST_AUTH_RATE_PATH, JSON.stringify(file, null, 2), "utf8");
}

function getGuestAuthRateLimitError(message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 429;
  return error;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function createWriteGuardKey(route: string, payload: unknown) {
  const digest = createHash("sha1").update(stableStringify(payload)).digest("hex");
  return `${route}:${digest}`;
}

async function runWithWriteGuard<T>(input: {
  key: string;
  action: () => Promise<T>;
  duplicateMessage?: string;
  cooldownMs?: number;
}) {
  const now = Date.now();
  const existingExpiry = writeGuardRecentKeys.get(input.key) ?? 0;
  if (existingExpiry > now || writeGuardInFlightKeys.has(input.key)) {
    throw getGuestAuthRateLimitError(
      input.duplicateMessage ?? "Please wait a moment before repeating the same write request."
    );
  }

  writeGuardRecentKeys.forEach((expiresAt, key) => {
    if (expiresAt <= now) {
      writeGuardRecentKeys.delete(key);
    }
  });

  writeGuardInFlightKeys.add(input.key);
  try {
    const result = await input.action();
    writeGuardRecentKeys.set(input.key, Date.now() + (input.cooldownMs ?? WRITE_GUARD_DEFAULT_WINDOW_MS));
    return result;
  } finally {
    writeGuardInFlightKeys.delete(input.key);
  }
}

async function assertGuestAuthRateLimit(email: string, ip: string) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedIp = normalizeIp(ip);
  if (!normalizedEmail) {
    throw new Error("A valid email is required.");
  }

  const now = new Date();
  const nowMs = now.getTime();
  const hour = hourKey(now);
  const day = dayKey(now);
  const store = await readGuestAuthRateFile();
  const emailEntry = store.email[normalizedEmail] ?? { hourly: {}, daily: {} };
  const ipEntry = store.ip[normalizedIp] ?? { hourly: {} };

  const lastSentAt = emailEntry.lastSentAt ? new Date(emailEntry.lastSentAt).getTime() : 0;
  if (lastSentAt && nowMs - lastSentAt < GUEST_AUTH_MIN_INTERVAL_MS) {
    throw getGuestAuthRateLimitError("Please wait 1 minute before requesting another code.");
  }

  const hourly = emailEntry.hourly ?? {};
  const daily = emailEntry.daily ?? {};
  hourly[hour] = Number(hourly[hour] || 0);
  daily[day] = Number(daily[day] || 0);
  const ipHourly = ipEntry.hourly ?? {};
  ipHourly[hour] = Number(ipHourly[hour] || 0);

  if (hourly[hour] >= GUEST_AUTH_MAX_PER_EMAIL_PER_HOUR) {
    throw getGuestAuthRateLimitError("Too many verification codes requested for this email. Please try again later.");
  }

  if (daily[day] >= GUEST_AUTH_MAX_PER_EMAIL_PER_DAY) {
    throw getGuestAuthRateLimitError("This email has reached the daily verification limit. Please try again tomorrow.");
  }

  if (ipHourly[hour] >= GUEST_AUTH_MAX_PER_IP_PER_HOUR) {
    throw getGuestAuthRateLimitError("Too many verification requests from this network. Please try again later.");
  }

  emailEntry.lastSentAt = new Date(nowMs).toISOString();
  emailEntry.hourly = hourly;
  emailEntry.daily = daily;
  ipEntry.hourly = ipHourly;

  hourly[hour] += 1;
  daily[day] += 1;
  ipHourly[hour] += 1;

  store.email[normalizedEmail] = emailEntry;
  store.ip[normalizedIp] = ipEntry;
  await writeGuestAuthRateFile(store);
}

function isAuthorizedInternalRequest(request: express.Request) {
  const configuredKey = process.env.INTERNAL_API_KEY?.trim();
  const providedKey = request.get("x-internal-api-key")?.trim();

  if (configuredKey) {
    return providedKey === configuredKey;
  }

  const forwardedFor = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    ?.trim();

  return [request.ip, request.socket.remoteAddress, forwardedFor].some((value) => isLoopbackAddress(value));
}

function parseCalendarDateInput(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

async function runAutoSchedule(trigger: "startup" | "interval" | "manual") {
  if (autoScheduleRunning) {
    return { skipped: true, reason: "A previous auto-schedule run is still in progress." };
  }

  autoScheduleRunning = true;

  try {
    const config = await getCleaningAutoSchedulerConfig();
    if (!config.enabled) {
      return { skipped: true, reason: "Cleaning auto-scheduler is disabled." };
    }
    if (!config.jobs.some((job) => job.enabled && job.fillUnassignedDates)) {
      return { skipped: true, reason: "Auto-allocation for unassigned dates is disabled for all jobs." };
    }

    const result = await autoScheduleCleaningTasksByJob(config.jobs);
    console.log(
      `[cleaning-auto-schedule] trigger=${trigger} created=${result.created} skipped=${result.skipped}`
    );
    return { ...result };
  } finally {
    autoScheduleRunning = false;
  }
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

    const evasionResult = await sweepMonthlyEvasionPenalties();
    if (evasionResult.charged > 0) {
      console.log(
        `[cleaning-evasion-sweep] trigger=${trigger} scanned=${evasionResult.scanned} charged=${evasionResult.charged}`
      );
    }

    return {
      skipped: false,
      ...result,
      evasion: evasionResult
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
app.use(express.json({ limit: "50mb" }));

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
const accountLockOverrideSchema = z.object({
  actorEmail: z.string().email(),
  targetEmail: z.string().email(),
  unlocked: z.boolean(),
  note: z.string().trim().optional()
});
const googlePortalLoginSchema = z.object({
  credential: z.string().min(1)
});
const staffAccessMutationSchema = z.object({
  actorEmail: z.string().email(),
  targetEmail: z.string().email(),
  role: z.enum(["manager", "owner"]),
  name: z.string().trim().optional(),
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
const acComfortVoteSchema = z.object({
  email: z.string().email(),
  vote: z.enum(["HOT", "COLD"])
});
const acComfortDismissSchema = z.object({
  actorEmail: z.string().email(),
  alertId: z.string().min(1)
});
const airFryerStartSchema = z.object({
  email: z.string().email(),
  inspection: z.string().min(1)
});
const laundryTriggerSchema = z.object({
  email: z.string().email().optional(),
  machineId: z.string().min(1).optional(),
  calendarId: z.string().min(1).optional()
}).transform((value) => ({
  email: value.email,
  machineId: value.machineId ?? value.calendarId ?? ""
}));
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
const cleaningRewardSettingsPutSchema = z.object({
  actorEmail: z.string().email(),
  baseRewards: z
    .object({
      KITCHEN_D2: z.coerce.number().int().min(0).max(500000).optional(),
      KITCHEN_D7: z.coerce.number().int().min(0).max(500000).optional(),
      TRASH_D7: z.coerce.number().int().min(0).max(500000).optional()
    })
    .optional(),
  selfAssignBonusMultiplier: z.coerce.number().min(1).max(3).optional()
});
const fridgeDrainSchedulePutSchema = z.object({
  actorEmail: z.string().email(),
  branchId: z.enum(["D2", "D7"]),
  cleaningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:mm in Asia/Ho_Chi_Minh — day before cleaning (power off). Default 17:00. */
  offTime: z.string().trim().max(8).optional(),
  /** HH:mm in Asia/Ho_Chi_Minh — cleaning day (power on). Default 17:00. */
  onTime: z.string().trim().max(8).optional()
});
const managerBulkCoinAdjustSchema = z
  .object({
    actorEmail: z.string().email(),
    reason: z.string().trim().min(1).max(500),
    items: z
      .array(
        z.object({
          maHd: z.string().min(1),
          delta: z.coerce.number().int().refine((n) => n !== 0, "delta must not be 0")
        })
      )
      .min(1)
      .max(150)
  })
  .superRefine((data, ctx) => {
    const set = new Set(data.items.map((i) => i.maHd));
    if (set.size !== data.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each contract (Mã HD) must appear only once in the batch."
      });
    }
  });
const managerBulkPushSchema = z
  .object({
    actorEmail: z.string().email(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    emails: z.array(z.string().email()).min(1).max(400)
  })
  .superRefine((data, ctx) => {
    const lower = data.emails.map((e) => e.trim().toLowerCase());
    if (new Set(lower).size !== lower.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate emails are not allowed." });
    }
  });
const managerPaymentReceiptCreateSchema = z.object({
  actorEmail: z.string().email(),
  maHd: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  purpose: z.string().trim().min(1),
  details: z.string().trim().optional(),
  payer: z.string().trim().optional(),
  receiver: z.string().trim().optional(),
  branch: z.string().trim().optional(),
  recipientEmail: z.string().trim().optional(),
  memberTier: z.string().trim().optional(),
  currentCoins: z.string().trim().optional(),
  discountAmount: z.coerce.number().int().nonnegative().optional(),
  discountCondition: z.string().trim().optional()
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
  /** When the violation occurred (ISO or datetime-local); stored in fine sheet timestamp column */
  eventAt: z.string().optional(),
  image: z.string().trim().optional(),
  operator: z.string().trim().min(1)
});
const fineImageUploadSchema = z
  .object({
    actorEmail: z.string().email(),
    maHd: z.string().min(1),
    clientName: z.string().trim().optional(),
    fileName: z.string().trim().min(1),
    mimeType: z.string().trim().min(1),
    dataBase64: z.string().trim().min(1)
  })
  .refine(
    (data) => {
      const mt = data.mimeType.toLowerCase().split(";")[0]!.trim();
      return mt.startsWith("image/") || mt.startsWith("video/");
    },
    { message: "Only image or video files are allowed for fine evidence." }
  );
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
const staffCoinDeleteSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  transactionCode: z.string().optional()
});
const staffPaymentDeleteSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  amount: z.string().optional(),
  purpose: z.string().optional()
});
const staffFineDeleteSchema = z.object({
  actorEmail: z.string().email(),
  email: z.string().email(),
  timestamp: z.string().min(1),
  content: z.string().min(1)
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
const laundryMachineSettingsUpdateSchema = z.object({
  actorEmail: z.string().email(),
  machineId: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(10).max(24 * 60),
  cooldownMinutes: z.coerce.number().int().min(0).max(24 * 60)
});

const laundryMachineMaintenanceSchema = z.object({
  actorEmail: z.string().email(),
  machineId: z.string().min(1),
  offlineForMaintenance: z.boolean()
});

const clientUpdateSchema = z.object({
  actorEmail: z.string().email(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});
const paidGuestBookingSyncSchema = z.object({
  bookingId: z.string().trim().min(1),
  guestEmail: z.string().email(),
  guestName: z.string().trim().min(1),
  guestPhone: z.string().optional(),
  bioSex: z.string().trim().optional().default(""),
  branchId: z.enum(["D2", "D7"]),
  bedNumber: z.coerce.number().int().positive(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pricingTotal: z.coerce.number().int().nonnegative(),
  notes: z.string().optional(),
  referralCode: z.string().trim().optional(),
  /** Set false when re-syncing an existing paid booking (e.g. date change) to avoid duplicate coin grants. */
  applyReferralCoins: z.boolean().optional().default(true)
});
const referralQuoteSchema = z.object({
  code: z.string().trim().min(1),
  product: z.enum(["long_term", "hostel"]),
  contractMonths: z.coerce.number().min(0).max(48).optional(),
  nights: z.coerce.number().min(0).max(800).optional()
});
const prospectAvailabilityQuerySchema = z.object({
  branchId: z.enum(["D2", "D7"]),
  sex: z.enum(["male", "female"])
});
const publicRegistrationSchema = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().email(),
  sex: z.enum(["male", "female"]),
  branchId: z.enum(["D2", "D7"]),
  bedNumber: z.coerce.number().int().positive(),
  phone: z.string().trim().min(6),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  permanentAddress: z.string().trim().optional(),
  governmentId: z.string().trim().optional(),
  idIssuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idIssuedPlace: z.string().trim().optional(),
  contractStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contractMonths: z.coerce.number().int().min(1).max(36),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyPrice: z.coerce.number().int().nonnegative(),
  deposit: z.coerce.number().int().nonnegative(),
  paymentFrequency: z.string().trim().optional(),
  currentStatus: z.string().trim().optional(),
  schoolOrWorkplace: z.string().trim().optional(),
  referralSource: z.string().trim().optional(),
  emergencyPhone: z.string().trim().optional(),
  additionalTerms: z.string().trim().optional(),
  contractCleaningOptOut: z.boolean().optional().default(false),
  hasMotorbike: z.boolean().optional().default(false),
  motorbikePlate: z.string().trim().optional(),
  /** Required when hasMotorbike and more than one parking tier exists; otherwise server picks the only option. */
  parkingOptionId: z.string().trim().optional(),
  idScanUrl: z.string().trim().optional(),
  referralCode: z.string().trim().optional(),
  /** Pre-referral first payment total (rent prepay slice + full deposit); required when referralCode is set. */
  firstPaymentSubtotalBeforeReferral: z.coerce.number().int().nonnegative().optional()
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
  note: z.string().optional(),
  createFine: z.boolean().optional(),
  fineAmount: z.coerce.number().int().positive().optional()
});
const adminCleaningAvailabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.coerce.number().int().positive().optional(),
  showAll: z.preprocess((v) => v === "true" || v === true, z.boolean()).optional(),
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
  actorEmail: z.string().email(),
  email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.number().int().positive().optional(),
  force: z.boolean().optional()
});
const adminBulkAutoAssignSchema = z.object({
  actorEmail: z.string().email(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  type: z.enum(["KITCHEN_D2", "KITCHEN_D7", "TRASH_D7"]),
  floor: z.number().int().positive().optional()
});
const cleaningAutoSchedulerConfigQuerySchema = z.object({
  actorEmail: z.string().email()
});
const cleaningAutoSchedulerConfigUpdateSchema = z.object({
  actorEmail: z.string().email(),
  enabled: z.boolean(),
  jobs: z.array(
    z.object({
      key: z.string().min(1),
      enabled: z.boolean(),
      fillUnassignedDates: z.boolean(),
      horizonDays: z.number().int().min(1).max(60)
    })
  )
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

app.post("/clients/contracts/extend", async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    extensionMonths: z.number().int().positive()
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid contract extension payload" });
  }

  try {
    const active = await getActiveClientByEmail(parsed.data.email);
    if (!active) {
      return response.status(400).json({ error: "Could not find an active client record to extend." });
    }
    const branchId = normalizeClientBranch(String(active[CLIENT_BRANCH_COLUMN] ?? ""));
    const bedNumber = Number.parseInt(String(active[CLIENT_BED_COLUMN] ?? "").replace(/[^0-9]/g, ""), 10);
    let listPricing: { listMonthlyPriceVnd: number } | undefined;
    if (bedNumber > 0) {
      const { monthlyPrice } = await resolveLongTermListPriceForBed(branchId, bedNumber);
      if (monthlyPrice > 0) {
        listPricing = { listMonthlyPriceVnd: monthlyPrice };
      }
    }

    await runWithWriteGuard({
      key: createWriteGuardKey("/clients/contracts/extend", parsed.data),
      duplicateMessage: "This contract extension request was just submitted. Please wait a few seconds.",
      cooldownMs: 15000,
      action: () => extendClientContract(parsed.data.email, parsed.data.extensionMonths, listPricing)
    });
    return response.json({ ok: true });
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 500).json({
      error: error instanceof Error ? error.message : "Unable to extend contract."
    });
  }
});

app.post("/internal/guest-bookings/import-paid", async (request, response) => {
  if (!isAuthorizedInternalRequest(request)) {
    return response.status(403).json({ error: "This endpoint only accepts internal requests." });
  }

  const parsed = paidGuestBookingSyncSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid paid guest booking payload." });
  }

  try {
    const checkInMs = new Date(`${parsed.data.checkIn}T12:00:00`).getTime();
    const checkOutMs = new Date(`${parsed.data.checkOut}T12:00:00`).getTime();
    const stayNights = Math.max(0, Math.round((checkOutMs - checkInMs) / 86400000));

    let mergedNotes = parsed.data.notes;
    let referralRewards: {
      newUserCoins: number;
      referrerCoins: number;
      referrerMaHd: string;
    } | null = null;

    const referralCodeRaw = parsed.data.referralCode?.trim();
    if (referralCodeRaw) {
      const referralResolution = await resolveReferralForHostelImport({
        guestEmail: parsed.data.guestEmail,
        referralCode: referralCodeRaw,
        nights: stayNights
      });
      if (!referralResolution.ok) {
        return response.status(400).json({ error: referralResolution.error });
      }
      const refNote = `Referral (hostel, ${stayNights}n ≈ ${referralResolution.effectiveMonths.toFixed(2)} mo eff.; scale ${referralResolution.scale.toFixed(2)} vs ${referralResolution.basisMonths} mo baseline; referrer ${referralResolution.referrer.email} ${referralResolution.referrer.maHd})`;
      mergedNotes = [mergedNotes, refNote].filter(Boolean).join(" | ");
      referralRewards = {
        newUserCoins: referralResolution.newUserCoins,
        referrerCoins: referralResolution.referrerCoins,
        referrerMaHd: referralResolution.referrer.maHd
      };
    }

    const cache = await upsertPaidGuestBookingClient({
      bookingId: parsed.data.bookingId,
      guestEmail: parsed.data.guestEmail,
      guestName: parsed.data.guestName,
      guestPhone: parsed.data.guestPhone ?? "",
      bioSex: parsed.data.bioSex,
      branchId: parsed.data.branchId,
      bedNumber: parsed.data.bedNumber,
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      pricingTotal: parsed.data.pricingTotal,
      notes: mergedNotes
    });

    if (
      parsed.data.applyReferralCoins !== false &&
      referralRewards &&
      (referralRewards.newUserCoins > 0 || referralRewards.referrerCoins > 0)
    ) {
      try {
        const newUserMaHd = `SHORTTERM-${parsed.data.bookingId.trim()}`;
        await applyReferralRegistrationRewards({
          newUserMaHd,
          newUserCoins: referralRewards.newUserCoins,
          referrerMaHd: referralRewards.referrerMaHd,
          referrerCoins: referralRewards.referrerCoins
        });
      } catch (coinError) {
        console.error("[internal/guest-bookings/import-paid] Referral coin grants failed", coinError);
        return response.json({
          ...cache,
          referralCoinsWarning: coinError instanceof Error ? coinError.message : "Referral coin grants failed"
        });
      }
    }

    return response.json(cache);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to import paid guest booking."
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

app.get("/clients/referral", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const client = await getActiveClientByEmail(parsed.data.email);
    if (!client) {
      return response.status(404).json({
        error: "No active client found for that email"
      });
    }

    const marketing = await getReferralProgramPublicMarketing();
    return response.json({
      code: computeReferralCodeForEmail(parsed.data.email),
      ...marketing
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load referral info"
    });
  }
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
    const statusCode = message.includes("Only app admins") || message.includes("Managers can only") ? 403 : 400;
    return response.status(statusCode).json({ error: message });
  }
});

app.get("/account-lock-override", async (request, response) => {
  const parsed = clientLookupSchema.safeParse({
    email: request.query.email
  });

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid email query parameter is required"
    });
  }

  try {
    const override = await getAccountLockOverride(parsed.data.email);
    return response.json({ override });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load account lock override"
    });
  }
});

app.post("/manager/account-lock-override", async (request, response) => {
  const parsed = accountLockOverrideSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "A valid actor email, target email, and unlocked flag are required."
    });
  }

  try {
    const result = await setAccountLockOverride(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
      error: error instanceof Error ? error.message : "Unable to update account lock override"
    });
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
    clearAllResidentNotificationCaches();
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

app.patch("/staff-access/self", async (request, response) => {
  const parsed = z.object({ actorEmail: z.string().email(), name: z.string().min(1) }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "actorEmail and name are required" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin", "mechanic"],
      "Only staff members can update their display name."
    );
    const result = await updateSelfName(parsed.data.actorEmail, parsed.data.name);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update display name"
    });
  }
});

app.get("/staff-access/permissions", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  const targetEmail = String(request.query.targetEmail ?? "");
  try {
    const permissions = await getManagerPermissions(actorEmail, targetEmail);
    return response.json({ permissions });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load permissions" });
  }
});

app.put("/staff-access/permissions", async (request, response) => {
  const { actorEmail, targetEmail, permissions } = request.body as {
    actorEmail: string;
    targetEmail: string;
    permissions: import("./staff-access.js").ManagerPermissions;
  };
  if (!actorEmail || !targetEmail || !permissions) {
    return response.status(400).json({ error: "actorEmail, targetEmail, and permissions are required" });
  }
  try {
    await setManagerPermissions(actorEmail, targetEmail, permissions);
    return response.json({ ok: true });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save permissions" });
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
    let comfort: AcComfortPublicStatus | null = null;
    try {
      comfort = await getAcComfortPublicStatus(parsed.data.email);
    } catch {
      comfort = null;
    }
    return response.json({ ...context, comfort });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load AC controller context"
    });
  }
});

app.post("/controller/ac/comfort-vote", async (request, response) => {
  const parsed = acComfortVoteSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "email and vote (HOT or COLD) are required" });
  }
  try {
    const result = await submitAcComfortVote(parsed.data);
    if (result.didCreateAlert) {
      invalidateStaffSupportNotificationCache();
    }
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to save comfort vote"
    });
  }
});

app.post("/manager/ac-comfort/dismiss", async (request, response) => {
  const parsed = acComfortDismissSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "actorEmail and alertId are required" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    await dismissAcComfortAlert({ alertId: parsed.data.alertId });
    invalidateStaffSupportNotificationCache();
    return response.json({ ok: true });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to dismiss alert"
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
    const client = await getActiveClientByEmail(parsed.data.email);
    await appendControllerHistoryEntry({
      actorRole: "resident",
      actorEmail: parsed.data.email.trim().toLowerCase(),
      actorName: getResidentHistoryName(client, parsed.data.email),
      deviceType: "ac",
      deviceId: result.room.id,
      deviceLabel: result.room.label,
      branchId: result.room.id.toUpperCase().includes("D7") ? "D7" : "D2",
      action: result.action,
      timestamp: result.requestedAt
    });
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
    const [devices, laundryConfigured] = await Promise.all([listAllDevices(), getConfiguredLaundryMachines()]);
    const mapById = new Map(laundryConfigured.map((m) => [m.id, m]));
    const laundry = (devices.laundry as Array<Record<string, unknown>>).map((entry) => {
      const id = String(entry.id ?? "");
      const cfg = mapById.get(id);
      return {
        ...entry,
        offlineForMaintenance: cfg?.offlineForMaintenance ?? false,
        durationMinutes: cfg?.durationMinutes ?? entry.durationMinutes,
        cooldownMinutes: cfg?.cooldownMinutes ?? entry.cooldownMinutes,
        updatedAt: cfg?.updatedAt ?? entry.updatedAt,
        updatedBy: cfg?.updatedBy ?? entry.updatedBy
      };
    });
    return response.json({ ...devices, laundry });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to list devices"
    });
  }
});

app.get("/manager/laundry/schedule", async (_request, response) => {
  try {
    const [calendars, machines] = await Promise.all([
      listLaundryCalendarsWithEvents(),
      getConfiguredLaundryMachines()
    ]);
    const now = new Date();
    const machineByCalendarId = new Map<string, (typeof machines)[number]>(
      machines.map((machine) => [machine.calendarId, machine])
    );
    
    const schedule = calendars.map(cal => {
      const machine = machineByCalendarId.get(cal.id) ?? null;
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
        machineId: machine?.id ?? cal.id,
        label: machine?.label ?? cal.summary,
        branchId: machine?.branchId ?? null,
        type: machine?.type ?? null,
        durationMinutes: machine?.durationMinutes ?? null,
        cooldownMinutes: machine?.cooldownMinutes ?? 0,
        offlineForMaintenance: machine?.offlineForMaintenance ?? false,
        updatedAt: machine?.updatedAt ?? null,
        updatedBy: machine?.updatedBy ?? null,
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
    await appendControllerHistoryEntry({
      actorRole: "manager",
      actorEmail: null,
      actorName: "Manager",
      deviceType: "ac",
      deviceId: result.room.id,
      deviceLabel: result.room.label,
      branchId: result.room.id.toUpperCase().includes("D7") ? "D7" : "D2",
      action: result.action,
      timestamp: result.requestedAt
    });
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

app.post("/manager/laundry/machines/settings", async (request, response) => {
  const parsed = laundryMachineSettingsUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid laundry machine settings payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can update laundry machine settings."
    );
    const machine = await updateLaundryMachineSettings(parsed.data);
    return response.json({ machine });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update laundry machine settings"
    });
  }
});

app.post("/manager/laundry/machines/maintenance", async (request, response) => {
  const parsed = laundryMachineMaintenanceSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid laundry maintenance payload" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only Cozoro team members can change laundry machine maintenance mode."
    );
    const machine = await setLaundryMachineMaintenanceMode(parsed.data);
    return response.json({ machine });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update laundry maintenance mode"
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
    const client = await getActiveClientByEmail(parsed.data.email);
    await appendControllerHistoryEntry({
      actorRole: "resident",
      actorEmail: parsed.data.email.trim().toLowerCase(),
      actorName: getResidentHistoryName(client, parsed.data.email),
      deviceType: "airfryer",
      deviceId: "d7-airfryer",
      deviceLabel: "Airfryer D7",
      branchId: "D7",
      action: "TRIGGER",
      details: parsed.data.inspection,
      timestamp: result.usage.startedAt
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to start air fryer use"
    });
  }
});

app.get("/manager/controller/history", async (request, response) => {
  const limit = Number.parseInt(String(request.query.limit ?? "50"), 10);
  try {
    const entries = await listControllerHistory(limit);
    return response.json({ entries });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load controller history"
    });
  }
});

function resolveLaundryWebhookTarget(machineId: string) {
  const normalizedMachineId = machineId.toLowerCase();
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();

  const buildWebhookTarget = (eventName: string) => ({
    eventName,
    url: key ? `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName)}/with/key/${key}` : ""
  });

  if (
    normalizedMachineId === "d7-dryer" ||
    normalizedMachineId === "d7_dryer" ||
    normalizedMachineId.includes("029mijq7")
  ) {
    return {
      eventName: "webhookdryerd7",
      url: "https://maker.ifttt.com/trigger/webhookdryerd7/json/with/key/cEVPzyXIMPZXbS8K5gZ2-KHWdKZgSRl_DspZFRHOvH2"
    };
  }

  if (
    normalizedMachineId === "d2-washer" ||
    normalizedMachineId === "d2_laundry" ||
    normalizedMachineId === "d2 laundry" ||
    normalizedMachineId.includes("p5cvikf3pn8292denaig3gmed0")
  ) {
    return buildWebhookTarget("wehbhookd2laundry");
  }

  if (
    normalizedMachineId === "d7-washer-horizontal" ||
    normalizedMachineId === "d7_washer_horizontal" ||
    normalizedMachineId === "d7_laundry" ||
    normalizedMachineId === "d7 laundry" ||
    normalizedMachineId.includes("iqido2c13cb85i2lsgq70qu59g")
  ) {
    return buildWebhookTarget(process.env.LAUNDRY_D7_WASHER_IFTTT_EVENT?.trim() || "d7washer");
  }

  if (
    normalizedMachineId === "d7-washer-paid" ||
    normalizedMachineId === "d7_washer_paid" ||
    normalizedMachineId === "d7_laundry_paid" ||
    normalizedMachineId === "d7_laundry_paid_(whirlpool)" ||
    normalizedMachineId === "d7 laundry paid" ||
    normalizedMachineId === "d7 laundry paid (whirlpool)" ||
    normalizedMachineId.includes("vmtcgatmh7irp19qsmrrbjsr34")
  ) {
    return {
      eventName: "webhookwasherpaidd7",
      url: "https://maker.ifttt.com/trigger/webhookwasherpaidd7/json/with/key/cEVPzyXIMPZXbS8K5gZ2-KHWdKZgSRl_DspZFRHOvH2"
    };
  }

  return {
    eventName: "",
    url: ""
  };
}

function getLaundryMachinePresentation(machineId: string) {
  const normalizedMachineId = machineId.trim().toLowerCase();

  if (
    normalizedMachineId === "d7-dryer" ||
    normalizedMachineId === "d7_dryer" ||
    normalizedMachineId.includes("029mijq7")
  ) {
    return { label: "Máy sấy D7", branchId: "D7" };
  }

  if (
    normalizedMachineId === "d7-washer-paid" ||
    normalizedMachineId === "d7_washer_paid" ||
    normalizedMachineId === "d7_laundry_paid" ||
    normalizedMachineId === "d7_laundry_paid_(whirlpool)" ||
    normalizedMachineId.includes("vmtcgatmh7irp19qsmrrbjsr34")
  ) {
    return { label: "Giặt D7 trả phí (Whirlpool)", branchId: "D7" };
  }

  if (
    normalizedMachineId === "d7-washer-horizontal" ||
    normalizedMachineId === "d7_washer_horizontal" ||
    normalizedMachineId === "d7_laundry" ||
    normalizedMachineId.includes("iqido2c13cb85i2lsgq70qu59g")
  ) {
    return { label: "Giặt lồng đứng D7", branchId: "D7" };
  }

  if (
    normalizedMachineId === "d2-washer" ||
    normalizedMachineId === "d2_laundry" ||
    normalizedMachineId.includes("p5cvikf3pn8292denaig3gmed0")
  ) {
    return { label: "Máy giặt D2", branchId: "D2" };
  }

  return { label: machineId, branchId: normalizedMachineId.includes("d7") ? "D7" : "D2" };
}

function getResidentHistoryName(client: Record<string, string> | null, fallbackEmail: string) {
  const candidate =
    client?.["Tên"] ??
    client?.["TÃªn"] ??
    client?.["Họ và tên"] ??
    client?.["Ho va ten"] ??
    "";

  return String(candidate).trim() || fallbackEmail.trim().toLowerCase();
}

app.post("/laundry/manual-trigger", async (request, response) => {
  const parsed = laundryTriggerSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid laundry trigger payload" });
  }

  const { email, machineId } = parsed.data;
  if (!email) {
    return response.status(400).json({ error: "Email is required for resident laundry trigger" });
  }
  if (!machineId) {
    return response.status(400).json({ error: "Machine ID is required for laundry trigger" });
  }

  try {
    const client = await getActiveClientByEmail(email);
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

    // 2. Map machineId to the correct webhook target
    const { eventName, url: iftttUrl } = resolveLaundryWebhookTarget(machineId);

    if (!eventName) {
      return response.status(400).json({ error: `Unsupported machine ID: ${machineId}` });
    }

    // 3. Trigger IFTTT Webhook
    if (!iftttUrl) {
      throw new Error("IFTTT_WEBHOOK_KEY is not configured in environment.");
    }
    const result = await fetch(iftttUrl, { method: "POST" });

    if (!result.ok) {
      throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    const machinePresentation = getLaundryMachinePresentation(machineId);
    await appendControllerHistoryEntry({
      actorRole: "resident",
      actorEmail: email,
      actorName: getResidentHistoryName(client, email),
      deviceType: "laundry",
      deviceId: machineId,
      deviceLabel: machinePresentation.label,
      branchId: machinePresentation.branchId,
      action: "TRIGGER",
      details: eventName
    });

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
  if (!machineId) {
    return response.status(400).json({ error: "Machine ID is required for laundry trigger" });
  }

  try {
    // 1. Map machineId to the correct webhook target
    const { eventName, url: iftttUrl } = resolveLaundryWebhookTarget(machineId);

    if (!eventName) {
      return response.status(400).json({ error: `Unsupported machine ID: ${machineId}` });
    }

    // 2. Trigger IFTTT Webhook (Manager bypasses booking check)
    if (!iftttUrl) {
      throw new Error("IFTTT_WEBHOOK_KEY is not configured.");
    }
    const result = await fetch(iftttUrl, { method: "POST" });

    if (!result.ok) {
      throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    const machinePresentation = getLaundryMachinePresentation(machineId);
    await appendControllerHistoryEntry({
      actorRole: "manager",
      actorEmail: null,
      actorName: "Manager",
      deviceType: "laundry",
      deviceId: machineId,
      deviceLabel: machinePresentation.label,
      branchId: machinePresentation.branchId,
      action: "TRIGGER",
      details: eventName
    });

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

    const machineId = String(request.body?.machineId ?? "d7-airfryer").trim() || "d7-airfryer";
    await appendControllerHistoryEntry({
      actorRole: "manager",
      actorEmail: null,
      actorName: "Manager",
      deviceType: "airfryer",
      deviceId: machineId,
      deviceLabel: "Airfryer D7",
      branchId: "D7",
      action: "TRIGGER",
      details: eventName
    });

    return response.json({ ok: true, message: "Airfryer triggered" });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to trigger airfryer"
    });
  }
});

app.post("/manager/controller/microwave/trigger", async (_request, response) => {
  try {
    const eventName = process.env.MICROWAVE_D2_IFTTT_EVENT || "microwaveD2";
    const key = process.env.IFTTT_WEBHOOK_KEY;
    if (!key) {
      throw new Error("IFTTT_WEBHOOK_KEY is not configured.");
    }
    const iftttUrl = `https://maker.ifttt.com/trigger/${eventName}/json/with/key/${key}`;
    const result = await fetch(iftttUrl, { method: "POST" });
    if (!result.ok) {
      throw new Error(`IFTTT trigger failed with status ${result.status}`);
    }

    await appendControllerHistoryEntry({
      actorRole: "manager",
      actorEmail: null,
      actorName: "Manager",
      deviceType: "microwave",
      deviceId: "d2-microwave",
      deviceLabel: "Microwave D2",
      branchId: "D2",
      action: "TRIGGER",
      details: eventName
    });

    return response.json({ ok: true, message: "Microwave triggered" });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to trigger microwave"
    });
  }
});

app.get("/controller/microwave/d2", async (request, response) => {
  const email = String(request.query.email ?? "").trim().toLowerCase();
  if (!email) return response.status(400).json({ error: "email required" });
  try {
    const context = await getUserMicrowaveContext(email);
    return response.json(context);
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Unable to load microwave status" });
  }
});

app.post("/controller/microwave/d2/trigger", async (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLowerCase();
  const inspection = String(request.body?.inspection ?? "").trim();

  try {
    const result = await startMicrowaveUse({ email, inspection });
    const client = await getActiveClientByEmail(email);

    // Fire IFTTT webhook
    const eventName = process.env.MICROWAVE_D2_IFTTT_EVENT || "microwaveD2";
    const key = process.env.IFTTT_WEBHOOK_KEY;
    if (!key) throw new Error("IFTTT_WEBHOOK_KEY is not configured.");
    const iftttUrl = `https://maker.ifttt.com/trigger/${eventName}/json/with/key/${key}`;
    const iftttResult = await fetch(iftttUrl, { method: "POST" });
    if (!iftttResult.ok) throw new Error(`IFTTT trigger failed with status ${iftttResult.status}`);

    await appendControllerHistoryEntry({
      actorRole: "resident",
      actorEmail: email,
      actorName: getResidentHistoryName(client, email),
      deviceType: "microwave",
      deviceId: "d2-microwave",
      deviceLabel: "Microwave D2",
      branchId: "D2",
      action: "TRIGGER",
      details: inspection,
      timestamp: result.usage.startedAt
    });

    // Log to Google Sheet (best-effort)
    logMicrowaveUse(email, result.usage.startedByName, inspection).catch((err) => {
      console.error("[Microwave] Sheet log failed:", err);
    });

    return response.json({ ok: true, message: "Microwave triggered", cooldownMinutes: result.cooldownMinutes });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to trigger microwave"
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
    let assistantMessage: Awaited<ReturnType<typeof tryAppendAssistantAfterResidentMessage>> = null;
    try {
      assistantMessage = await tryAppendAssistantAfterResidentMessage({
        conversationId: result.conversation.id,
        residentEmail: parsed.data.email
      });
    } catch (assistantError) {
      console.warn("[support/messages] Assistant reply skipped", assistantError);
    }
    return response.status(201).json({ ...result, assistantMessage });
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

app.delete("/manager/support/conversations/:id", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await ownerDeleteSupportConversation({
      operatorEmail: parsed.data.operatorEmail,
      conversationOrGroupId: request.params.id ?? ""
    });
    return response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to delete conversation";
    const status = msg.includes("Only owners") ? 403 : msg.toLowerCase().includes("not found") ? 404 : 400;
    return response.status(status).json({ error: msg });
  }
});

app.delete("/manager/support/messages/:messageId", async (request, response) => {
  const parsed = supportInboxQuerySchema.safeParse({
    operatorEmail: request.query.operatorEmail
  });

  if (!parsed.success || !(await isPrivilegedSupportOperator(parsed.data.operatorEmail))) {
    return response.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await ownerDeleteSupportMessage({
      operatorEmail: parsed.data.operatorEmail,
      messageId: request.params.messageId ?? ""
    });
    return response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to delete message";
    const status = msg.includes("Only owners") ? 403 : msg.toLowerCase().includes("not found") ? 404 : 400;
    return response.status(status).json({ error: msg });
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

app.get("/staff/inactive-clients", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const clients = await getManagerInactiveClients();
    return response.json({ clients });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load inactive clients" });
  }
});

app.get("/staff/clients/duplicates", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const duplicates = await getDuplicateActiveClients();
    return response.json({ duplicates });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load duplicate clients" });
  }
});

app.post("/staff/clients/set-inactive", async (request, response) => {
  const actorEmail = String(request.body?.actorEmail ?? "");
  const maHd = String(request.body?.maHd ?? "").trim();
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    if (!maHd) return response.status(400).json({ error: "maHd is required" });
    await updateClientColumns(maHd, { "Hiện còn ở": "-1" });
    return response.json({ ok: true });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Unable to mark contract inactive" });
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
    const normalizedValues = normalizeSheetUpdateValues(parsed.data.values);
    const cache = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/client-sheet-update", {
        actorEmail: parsed.data.actorEmail,
        maHd: parsed.data.maHd,
        values: normalizedValues
      }),
      duplicateMessage: "The same client update was just submitted. Please wait a few seconds.",
      action: () => updateClientColumns(parsed.data.maHd, normalizedValues)
    });
    return response.json(cache);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 403).json({
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
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/coins/update", parsed.data),
      duplicateMessage: "The same coin update was just submitted. Please wait a few seconds.",
      action: () => updateCoinSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        transactionCode: parsed.data.transactionCode,
        values: parsed.data.values
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
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
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/payments/update", parsed.data),
      duplicateMessage: "The same payment update was just submitted. Please wait a few seconds.",
      action: () => updatePaymentSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        amount: parsed.data.amount,
        purpose: parsed.data.purpose,
        values: parsed.data.values
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
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
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/fines/update", parsed.data),
      duplicateMessage: "The same fine update was just submitted. Please wait a few seconds.",
      action: () => updateFineSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        content: parsed.data.content,
        values: parsed.data.values
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
      error: error instanceof Error ? error.message : "Unable to update fine entry"
    });
  }
});

app.post("/staff/coins/delete", async (request, response) => {
  const parsed = staffCoinDeleteSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff coin delete payload" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Only Cozoro team members can delete coin entries.");
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/coins/delete", parsed.data),
      duplicateMessage: "The same coin delete was just submitted. Please wait a few seconds.",
      action: () => deleteCoinSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        transactionCode: parsed.data.transactionCode
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({ error: error instanceof Error ? error.message : "Unable to delete coin entry" });
  }
});

app.post("/staff/payments/delete", async (request, response) => {
  const parsed = staffPaymentDeleteSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff payment delete payload" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Only Cozoro team members can delete payment entries.");
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/payments/delete", parsed.data),
      duplicateMessage: "The same payment delete was just submitted. Please wait a few seconds.",
      action: () => deletePaymentSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        amount: parsed.data.amount,
        purpose: parsed.data.purpose
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({ error: error instanceof Error ? error.message : "Unable to delete payment entry" });
  }
});

app.post("/staff/fines/delete", async (request, response) => {
  const parsed = staffFineDeleteSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid staff fine delete payload" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Only Cozoro team members can delete fine entries.");
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/staff/fines/delete", parsed.data),
      duplicateMessage: "The same fine delete was just submitted. Please wait a few seconds.",
      action: () => deleteFineSheetEntry({
        email: parsed.data.email,
        timestamp: parsed.data.timestamp,
        content: parsed.data.content
      })
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({ error: error instanceof Error ? error.message : "Unable to delete fine entry" });
  }
});

app.post("/staff/laundry/delete", async (request, response) => {
  const schema = z.object({ actorEmail: z.string().email(), calendarId: z.string().min(1), eventId: z.string().min(1) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid payload" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Only Cozoro team members can remove laundry entries.");
    const result = await staffDeleteLaundryBooking({ calendarId: parsed.data.calendarId, eventId: parsed.data.eventId });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete laundry entry" });
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
    await requirePortalRole(
      parsed.data.operator.trim(),
      ["manager", "owner", "app_admin"],
      "Only managers or owners can adjust client coins."
    );
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/manager/coins/adjust", parsed.data),
      duplicateMessage: "This coin adjustment was just submitted. Please wait a few seconds.",
      action: () => managerAdjustCoins(parsed.data)
    });
    return response.json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
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
      ["manager", "owner", "app_admin"],
      "Only managers and owners can create payment receipts."
    );

    let receiver = parsed.data.receiver;
    if (!receiver) {
      const staffName = await getStaffName(parsed.data.actorEmail);
      if (staffName) {
        receiver = staffName;
      } else {
        const allClients = await getManagerClients();
        const actorAsClient = allClients.find(
          (c) => c.email.trim().toLowerCase() === parsed.data.actorEmail.trim().toLowerCase()
        );
        receiver = actorAsClient?.name?.trim() || parsed.data.actorEmail;
      }
    }

      const result = await runWithWriteGuard({
        key: createWriteGuardKey("/manager/payments/create", {
          ...parsed.data,
          receiver
        }),
        duplicateMessage: "This payment receipt was just submitted. Please wait a few seconds.",
        action: () => managerCreatePaymentReceipt({
          maHd: parsed.data.maHd,
          amount: parsed.data.amount,
          purpose: parsed.data.purpose,
          details: parsed.data.details,
          payer: parsed.data.payer,
          receiver,
          branch: parsed.data.branch,
          recipientEmail: parsed.data.recipientEmail,
          memberTier: parsed.data.memberTier,
          currentCoins: parsed.data.currentCoins,
          discountAmount: parsed.data.discountAmount,
          discountCondition: parsed.data.discountCondition
        })
      });
      return response.status(201).json(result);
    } catch (error) {
      return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
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
    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/manager/fines", parsed.data),
      duplicateMessage: "This fine creation request was just submitted. Please wait a few seconds.",
      action: () => managerCreateFine(parsed.data)
    });
    return response.status(201).json(result);
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 400).json({
      error: error instanceof Error ? error.message : "Unable to create manager fine"
    });
  }
});

app.post("/staff/fines/upload-image", async (request, response) => {
  const parsed = fineImageUploadSchema.safeParse(request.body);

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid fine evidence upload payload";
    return response.status(400).json({ error: message });
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
      error: error instanceof Error ? error.message : "Unable to upload fine evidence"
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

app.post("/manager/ai-chat", async (request, response) => {
  const parsed = z.object({
    operatorEmail: z.string().email(),
    language: z.enum(["en", "vi"]).optional(),
    history: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string() })).min(1)
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid AI chat payload" });
  }

  try {
    const result = await handleManagerAiChat(parsed.data.operatorEmail, parsed.data.history as AiChatMessage[], {
      language: parsed.data.language
    });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "AI assistant error"
    });
  }
});

app.post("/resident/portal-ai-chat", async (request, response) => {
  const parsed = z
    .object({
      email: z.string().email(),
      language: z.enum(["en", "vi"]).optional(),
      history: z
        .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(12000) }))
        .min(1)
        .max(40)
    })
    .safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid resident chat payload" });
  }

  try {
    const result = await handleResidentPortalAiChat(
      parsed.data.email,
      parsed.data.history as ResidentPortalAiMessage[],
      { language: parsed.data.language }
    );
    return response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "AI assistant error";
    const lower = msg.toLowerCase();
    const status =
      lower.includes("only resident") || lower.includes("not allowed") || lower.includes("cozoro bee:")
        ? 403
        : lower.includes("not configured") || lower.includes("disabled")
          ? 503
          : 400;
    return response.status(status).json({ error: msg });
  }
});

app.post("/resident/vent-hammer-redeem", async (request, response) => {
  const parsed = z
    .object({
      email: z.string().email(),
      hits: z.number().int().min(0).max(55)
    })
    .safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid payload" });
  }

  const email = parsed.data.email.trim().toLowerCase();
  try {
    const login = await resolvePortalLogin(email);
    if (!login.allowed || login.source !== "client" || login.role !== "user") {
      return response.status(403).json({ error: "Only resident accounts can redeem vent-game coins." });
    }

    const prev = getVentHammerRedeemToday(email);
    if (prev) {
      return response.json({ ok: true, alreadyRedeemed: true, coinsCredited: prev.coins, hitsCounted: 0 });
    }

    const hitsCounted = Math.min(parsed.data.hits, 45);
    const coins = hitsCounted * 10;
    if (coins <= 0) {
      return response.json({ ok: true, coinsCredited: 0, hitsCounted: 0, alreadyRedeemed: false });
    }

    const { currentCoins } = await awardVentHammerGameCoinsToSheet({
      userEmail: email,
      rewardCoins: coins
    });
    markVentHammerRedeemedToday(email, coins);
    return response.json({
      ok: true,
      alreadyRedeemed: false,
      coinsCredited: coins,
      hitsCounted,
      currentCoins
    });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to award coins"
    });
  }
});

app.post("/resident/vent-hammer-feedback", async (request, response) => {
  const parsed = z
    .object({
      email: z.string().email(),
      satisfied: z.boolean(),
      language: z.enum(["en", "vi"]).optional()
    })
    .safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid payload" });
  }

  try {
    const login = await resolvePortalLogin(parsed.data.email.trim().toLowerCase());
    if (!login.allowed || login.source !== "client" || login.role !== "user") {
      return response.status(403).json({ error: "Forbidden" });
    }

    const dir = path.join(process.cwd(), "data", "vent-hammer-feedback");
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        email: parsed.data.email.trim().toLowerCase(),
        satisfied: parsed.data.satisfied,
        language: parsed.data.language ?? null
      }) + "\n";
    await mkdir(dir, { recursive: true });
    await appendFile(file, line, "utf8");
    return response.json({ ok: true });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to save feedback"
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

app.post("/cleaning/availability/bulk", async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    dates: z.array(z.string()).min(1).max(60),
    type: z.enum(["AVAILABLE", "UNAVAILABLE", "PREFERRED"]),
    note: z.string().optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid bulk availability payload" });
  }

  try {
    const parsedDates = parsed.data.dates.map((d) => parseCalendarDateInput(d));
    const results = await setBulkCleaningAvailability({
      email: parsed.data.email,
      dates: parsedDates,
      type: parsed.data.type as CleaningAvailabilityType,
      note: parsed.data.note
    });
    return response.json({ updated: results.length });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Unable to save availability" });
  }
});

app.get("/cleaning/opt-out", async (request, response) => {
  const email = String(request.query.email ?? "").trim();
  if (!email) {
    return response.status(400).json({ error: "Email is required" });
  }
  const month = String(request.query.month ?? "").trim() || undefined;
  try {
    const optOut = await getCleaningOptOutForEmail(email, month);
    return response.json({ optOut: optOut ? { month: optOut.month, paymentMethod: optOut.paymentMethod } : null });
  } catch {
    return response.status(500).json({ error: "Unable to check opt-out status" });
  }
});

const CLEANING_OPT_OUT_VND_AMOUNT = 100000;
const CLEANING_OPT_OUT_COINS_AMOUNT = 150000;

app.post("/cleaning/opt-out", async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    paymentMethod: z.enum(["VND", "COINS"]),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid opt-out payload" });
  }

  const { email, paymentMethod } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const targetMonth = parsed.data.month ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  try {
    const userContext = await getUserCleaningContext(normalizedEmail);
    if (!userContext) {
      return response.status(404).json({ error: "Active user not found." });
    }

    // Process payment before recording opt-out
    if (paymentMethod === "COINS") {
      const allClients = await getManagerClients();
      const client = allClients.find((c) => c.email.trim().toLowerCase() === normalizedEmail);
      if (!client) {
        return response.status(404).json({ error: "Client not found for coin deduction." });
      }
      await managerAdjustCoins({
        maHd: client.maHd,
        delta: -CLEANING_OPT_OUT_COINS_AMOUNT,
        reason: `Phí miễn vệ sinh tháng ${targetMonth}`,
        operator: "Cleaning system"
      });
    } else {
      // VND — create a fine
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      await createAutomaticFineForEmail({
        email: normalizedEmail,
        amount: CLEANING_OPT_OUT_VND_AMOUNT,
        content: `Phí miễn vệ sinh tháng ${targetMonth}`,
        description: "Cleaning opt-out fee",
        dueDate: dueDate.toISOString(),
        operator: "Cleaning system"
      });
    }

    await setCleaningOptOut({
      email: normalizedEmail,
      branchId: userContext.branchId,
      month: targetMonth,
      paymentMethod
    });

    return response.json({ ok: true, month: targetMonth, paymentMethod });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Unable to process opt-out" });
  }
});

app.delete("/cleaning/opt-out", async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid opt-out cancellation payload" });
  }

  const { email } = parsed.data;
  const targetMonth = parsed.data.month ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  try {
    await cancelCleaningOptOut(email.trim().toLowerCase(), targetMonth);
    return response.json({ ok: true });
  } catch {
    return response.status(500).json({ error: "Unable to cancel opt-out" });
  }
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

app.get("/admin/cleaning/auto-scheduler-config", async (request, response) => {
  const parsed = cleaningAutoSchedulerConfigQuerySchema.safeParse({
    actorEmail: request.query.actorEmail
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid actor email is required" });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only managers can view cleaning auto-scheduler settings."
    );
    const config = await getCleaningAutoSchedulerConfig();
    return response.json(config);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to load cleaning auto-scheduler settings"
    });
  }
});

app.put("/admin/cleaning/auto-scheduler-config", async (request, response) => {
  const parsed = cleaningAutoSchedulerConfigUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid cleaning auto-scheduler config payload" });
  }

  try {
    const config = await updateCleaningAutoSchedulerConfig(parsed.data.actorEmail, {
      enabled: parsed.data.enabled,
      jobs: parsed.data.jobs
    });
    return response.json(config);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to save cleaning auto-scheduler settings"
    });
  }
});

app.get("/admin/cleaning/available-users", async (request, response) => {
  const parsed = adminCleaningAvailabilitySchema.safeParse({
    date: request.query.date,
    type: request.query.type,
    floor: request.query.floor,
    showAll: request.query.showAll,
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
      showAll: parsed.data.showAll,
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
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only managers can assign cleaning tasks."
    );
    const actorName = await getStaffName(parsed.data.actorEmail);
    const task = await adminAssignCleaningTask({
      email: parsed.data.email,
      date: parseCalendarDateInput(parsed.data.date),
      type: parsed.data.type,
      floor: parsed.data.floor,
      force: parsed.data.force,
      actorEmail: parsed.data.actorEmail,
      actorName
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
    await requirePortalRole(
      parsed.data.actorEmail,
      ["manager", "owner", "app_admin"],
      "Only managers can bulk assign cleaning tasks."
    );
    const actorName = await getStaffName(parsed.data.actorEmail);
    const tasks = await adminAutoAssignCleaningSlots({
      dates: parsed.data.dates.map((value) => parseCalendarDateInput(value)),
      type: parsed.data.type,
      floor: parsed.data.floor,
      actorEmail: parsed.data.actorEmail,
      actorName
    });
    return response.json({ assigned: tasks.length, tasks });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to auto-assign cleaning tasks"
    });
  }
});

app.delete("/admin/cleaning/tasks/:id", async (request, response) => {
  const { id } = request.params;
  if (!id) {
    return response.status(400).json({ error: "Task ID is required" });
  }
  try {
    const result = await adminRemoveCleaningTask(id);
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to remove cleaning task"
    });
  }
});

app.post("/admin/cleaning/auto-schedule", async (_request, response) => {
  try {
    const result = await runAutoSchedule("manual");
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Auto-schedule failed"
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

    if (parsed.data.decision === CleaningAuditDecision.REJECT && parsed.data.createFine && parsed.data.fineAmount) {
      await createAutomaticFineForEmail({
        email: task.userEmail,
        amount: parsed.data.fineAmount,
        content: "Công việc vệ sinh không đạt tiêu chuẩn",
        description: `Audit rejected by ${parsed.data.reviewer}. Task ID: ${task.id}. Scheduled: ${task.scheduledDate.toISOString().slice(0, 10)}.${parsed.data.note ? ` Note: ${parsed.data.note}` : ""}`,
        location: task.branchId,
        operator: parsed.data.reviewer
      });
    }

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
    // Block laundry booking if the user marked that date as unavailable (away)
    const bookingStart = new Date(parsed.data.start);
    if (!Number.isNaN(bookingStart.getTime())) {
      const bookingDate = new Date(Date.UTC(
        bookingStart.getFullYear(),
        bookingStart.getMonth(),
        bookingStart.getDate()
      ));
      const nextDate = new Date(bookingDate.getTime() + 24 * 60 * 60 * 1000);
      const unavailable = await prisma.cleaningAvailability.findFirst({
        where: {
          userEmail: parsed.data.email.trim().toLowerCase(),
          type: CleaningAvailabilityType.UNAVAILABLE,
          date: { gte: bookingDate, lt: nextDate }
        }
      });
      if (unavailable) {
        return response.status(400).json({ error: "You have marked this date as away/unavailable. Remove the mark to book laundry on this day." });
      }
    }

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

app.post("/laundry/bookings/:id/cancel", async (request, response) => {
  const eventId = request.params.id;
  const { email, calendarId } = request.body;

  if (!email || !calendarId) {
    return response.status(400).json({ error: "Email and calendarId are required in the request body." });
  }

  try {
    const result = await cancelLaundryBooking({ email, calendarId, eventId });
    return response.json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to cancel laundry booking"
    });
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
      const cache = await runWithWriteGuard({
        key: createWriteGuardKey("/clients/:maHd/sheet-update", {
          actorEmail: parsed.data.actorEmail,
          maHd,
          values: normalizedValues
        }),
        duplicateMessage: "The same sheet update was just submitted. Please wait a few seconds.",
        action: () => updateClientColumns(maHd, normalizedValues)
      });
      return response.json(cache);
    } catch (error) {
      return response.status((error as Error & { statusCode?: number }).statusCode ?? 500).json({
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
  const { email, targetMonth, managerDiscountVnd, shortTermSurchargeRate, parkingFeeVnd, gateParkingFeeVnd } = req.body;
  if (!email || !targetMonth) {
    return res.status(400).json({ error: "email and targetMonth are required" });
  }

  try {
    const cache = (await readCachedClients()) ?? (await syncClientsFromSheet());
    const client = cache.rows.find((r) => r["Địa chỉ email"] === email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { breakdown } = await calculateRentBreakdownForBillingMonth(client, targetMonth, {
      managerDiscountVnd: Number(managerDiscountVnd) || 0,
      shortTermSurchargeRate:
        typeof shortTermSurchargeRate === "number" && Number.isFinite(shortTermSurchargeRate)
          ? shortTermSurchargeRate
          : undefined,
      parkingFeeVnd:
        typeof parkingFeeVnd === "number" && Number.isFinite(parkingFeeVnd)
          ? parkingFeeVnd
          : undefined,
      gateParkingFeeVnd:
        typeof gateParkingFeeVnd === "number" && Number.isFinite(gateParkingFeeVnd)
          ? gateParkingFeeVnd
          : undefined
    });
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Calculation failed" });
  }
});

app.post("/pay-rent", async (req, res) => {
  const {
    email,
    targetMonth,
    managerDiscountVnd,
    shortTermSurchargeRate,
    parkingFeeVnd,
    gateParkingFeeVnd,
    coinUsage,
    payerName,
    receiverName,
    recipientEmail,
    branch,
    memberTier,
    currentCoins,
    discountAmount,
    discountCondition
  } = req.body;
  if (!email || !targetMonth || !payerName) {
    return res.status(400).json({ error: "email, targetMonth, and payerName are required" });
  }

  try {
    const cache = (await readCachedClients()) ?? (await syncClientsFromSheet());
    const client = cache.rows.find((r) => r["Địa chỉ email"] === email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const emailKey = String(email).trim().toLowerCase();
    const { breakdown, record: rentPrefRow } = await calculateRentBreakdownForBillingMonth(client, targetMonth, {
      managerDiscountVnd: Number(managerDiscountVnd) || 0,
      shortTermSurchargeRate:
        typeof shortTermSurchargeRate === "number" && Number.isFinite(shortTermSurchargeRate)
          ? shortTermSurchargeRate
          : undefined,
      parkingFeeVnd:
        typeof parkingFeeVnd === "number" && Number.isFinite(parkingFeeVnd)
          ? parkingFeeVnd
          : undefined,
      gateParkingFeeVnd:
        typeof gateParkingFeeVnd === "number" && Number.isFinite(gateParkingFeeVnd)
          ? gateParkingFeeVnd
          : undefined
    });

    const maHd = client["MÃ HD"] || client["MÃ HD".normalize("NFC")] || "";
    const resolvedDiscountAmount =
      typeof discountAmount === "number" && Number.isFinite(discountAmount)
        ? discountAmount
        : breakdown.professionalDiscountVnd + breakdown.planDiscountVnd + (Number(managerDiscountVnd) || 0);
    const coinsAllowedForResident =
      rentPrefRow?.applyCoinsTowardRent === true || (rentPrefRow?.rentCoinRedeemCoins ?? 0) > 0;
    const resolvedCoinUsage = coinsAllowedForResident
      ? typeof coinUsage === "number" && Number.isFinite(coinUsage)
        ? coinUsage
        : breakdown.recommendedCoinUsage
      : 0;
    const resolvedCoinValue =
      coinsAllowedForResident && resolvedCoinUsage === breakdown.recommendedCoinUsage
        ? breakdown.recommendedCoinValueVnd
        : coinsAllowedForResident
          ? Math.round(resolvedCoinUsage * breakdown.coinRateVndPerCoin)
          : 0;

    // Record to BIEN NHAN sheet using the manager-compatible column mapping
    await managerCreatePaymentReceipt({
      maHd,
      amount: breakdown.finalTotalVnd,
      purpose: `Rent Payment - ${targetMonth}`,
      details: [
        `Base rent: ${breakdown.baseRent.toLocaleString("vi-VN")} VND`,
        `Surcharge: ${breakdown.tenureSurchargeVnd.toLocaleString("vi-VN")} VND`,
        `Monthly adjustment: ${breakdown.monthlyAdjustmentVnd.toLocaleString("vi-VN")} VND`,
        `Parking: ${breakdown.parkingFeeVnd.toLocaleString("vi-VN")} VND`,
        `Gate parking: ${breakdown.gateParkingFeeVnd.toLocaleString("vi-VN")} VND`,
        `Laundry: ${breakdown.laundryFeeVnd.toLocaleString("vi-VN")} VND`,
        `Fines: ${breakdown.finesVnd.toLocaleString("vi-VN")} VND`,
        `Coins used: ${resolvedCoinUsage}`,
        `Coin value: ${resolvedCoinValue.toLocaleString("vi-VN")} VND`
      ].join(" | "),
      payer: payerName,
      receiver: receiverName || "Cozoro System",
      branch: branch || client["Chi nhánh Cozoro dorm"] || "",
      recipientEmail: recipientEmail || "",
      memberTier: memberTier || client["Cozoro Member"] || "",
      currentCoins: currentCoins != null ? String(currentCoins) : "",
      discountAmount: resolvedDiscountAmount,
      discountCondition:
        discountCondition ||
        `Rent payment ${targetMonth}; surcharge ${Math.round(breakdown.tenureSurchargeRate * 100)}%; manager discount ${Number(managerDiscountVnd) || 0}`,
      allowZeroAmount: true
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

    const rentSubtotalVnd = Math.max(
      0,
      breakdown.totalBeforeCoinsVnd -
        breakdown.parkingFeeVnd -
        breakdown.gateParkingFeeVnd -
        breakdown.laundryFeeVnd -
        breakdown.finesVnd
    );
    await prisma.monthlyRentStatus.upsert({
      where: { email_month: { email: emailKey, month: targetMonth } },
      create: {
        email: emailKey,
        month: targetMonth,
        isPaid: true,
        updatedBy: String(recipientEmail || "").trim() || "pay-rent",
        paidRecordedAt: new Date(),
        snapshotRentSubtotalVnd: rentSubtotalVnd,
        snapshotParkingVnd: breakdown.parkingFeeVnd,
        snapshotGateParkingVnd: breakdown.gateParkingFeeVnd,
        snapshotLaundryVnd: breakdown.laundryFeeVnd,
        snapshotFinesVnd: breakdown.finesVnd,
        snapshotFinalTotalVnd: breakdown.finalTotalVnd,
        snapshotCoinValueVnd: resolvedCoinValue
      },
      update: {
        isPaid: true,
        updatedBy: String(recipientEmail || "").trim() || "pay-rent",
        paidRecordedAt: new Date(),
        snapshotRentSubtotalVnd: rentSubtotalVnd,
        snapshotParkingVnd: breakdown.parkingFeeVnd,
        snapshotGateParkingVnd: breakdown.gateParkingFeeVnd,
        snapshotLaundryVnd: breakdown.laundryFeeVnd,
        snapshotFinesVnd: breakdown.finesVnd,
        snapshotFinalTotalVnd: breakdown.finalTotalVnd,
        snapshotCoinValueVnd: resolvedCoinValue
      }
    });

    await markGateParkingTicketsPaidForBilling(targetMonth, emailKey);

    res.json({ success: true, message: "Payment recorded and receipt sent" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Payment failed" });
  }
});

// ── Push Notification Routes ──────────────────────────────────────────────────

app.get("/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/push/subscribe", async (req, res) => {
  const { email, subscription } = req.body as {
    email: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  };
  if (!email || !subscription?.endpoint) {
    return res.status(400).json({ error: "Missing email or subscription" });
  }
  try {
    await savePushSubscription(email, subscription);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save subscription" });
  }
});

app.post("/push/unsubscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint: string };
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
  try {
    await deletePushSubscription(endpoint);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove subscription" });
  }
});

// GET /manager/rent-paid-status — manager reads monthly rent paid flag for a client
app.get("/manager/rent-paid-status", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const email = String(req.query.email ?? "").trim().toLowerCase();
  const month = String(req.query.month ?? "").trim();

  if (!actorEmail || !email || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "actorEmail, email, and month (YYYY-MM) are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const record = await prisma.monthlyRentStatus.findUnique({
    where: { email_month: { email, month } }
  });
  return res.json({
    email,
    month,
    isPaid: record?.isPaid ?? false,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? "",
    paidRecordedAt: record?.paidRecordedAt ?? null,
    snapshotRentSubtotalVnd: record?.snapshotRentSubtotalVnd ?? null,
    snapshotParkingVnd: record?.snapshotParkingVnd ?? null,
    snapshotGateParkingVnd: record?.snapshotGateParkingVnd ?? null,
    snapshotLaundryVnd: record?.snapshotLaundryVnd ?? null,
    snapshotFinesVnd: record?.snapshotFinesVnd ?? null,
    snapshotFinalTotalVnd: record?.snapshotFinalTotalVnd ?? null,
    snapshotCoinValueVnd: record?.snapshotCoinValueVnd ?? null,
    applyCoinsTowardRent: record?.applyCoinsTowardRent ?? false,
    rentCoinRedeemCoins: record?.rentCoinRedeemCoins ?? null,
    rentCoinRedeemValueVnd: record?.rentCoinRedeemValueVnd ?? null,
    rentCoinRedeemAt: record?.rentCoinRedeemAt?.toISOString() ?? null
  });
});

// POST /manager/rent-paid-status — manager toggles monthly rent paid flag
app.post("/manager/rent-paid-status", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const month = String(req.body.month ?? "").trim();
  const isPaid = req.body.isPaid;

  if (!actorEmail || !email || !month || typeof isPaid !== "boolean" || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "actorEmail, email, month (YYYY-MM), and isPaid (boolean) are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const record = await prisma.monthlyRentStatus.upsert({
    where: { email_month: { email, month } },
    create: { email, month, isPaid, updatedBy: actorEmail },
    update: { isPaid, updatedBy: actorEmail }
  });
  return res.json({ email: record.email, month: record.month, isPaid: record.isPaid });
});

// GET /manager/prepaid-package-billing — engine estimate + saved draft for a prepaid resident
app.get("/manager/prepaid-package-billing", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const clientEmail = String(req.query.clientEmail ?? "").trim().toLowerCase();
  const billingMonth = String(req.query.billingMonth ?? "").trim();
  if (!actorEmail || !clientEmail || !billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return res.status(400).json({ error: "actorEmail, clientEmail, and billingMonth (YYYY-MM) are required" });
  }
  try {
    const cache = await readCachedClients();
    const row = cache?.rows.find((r) => (r["Địa chỉ email"] ?? "").trim().toLowerCase() === clientEmail);
    if (!row) {
      return res.status(404).json({ error: "Client not found in cache" });
    }
    const result = await managerGetPrepaidPackageBilling({
      actorEmail,
      clientEmail,
      billingMonth,
      clientRow: row
    });
    if ("error" in result && result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load prepaid billing" });
  }
});

// POST /manager/prepaid-package-billing — save draft (recalculates engine snapshot; clears confirmed until re-confirmed)
app.post("/manager/prepaid-package-billing", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const clientEmail = String(req.body.clientEmail ?? "").trim().toLowerCase();
  const billingMonth = String(req.body.billingMonth ?? "").trim();
  const managerPackageTotalVnd = Number(req.body.managerPackageTotalVnd);
  const managerNote = req.body.managerNote == null ? "" : String(req.body.managerNote);
  if (!actorEmail || !clientEmail || !billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return res.status(400).json({ error: "actorEmail, clientEmail, and billingMonth (YYYY-MM) are required" });
  }
  if (!Number.isFinite(managerPackageTotalVnd)) {
    return res.status(400).json({ error: "managerPackageTotalVnd is required" });
  }
  try {
    const cache = await readCachedClients();
    const row = cache?.rows.find((r) => (r["Địa chỉ email"] ?? "").trim().toLowerCase() === clientEmail);
    if (!row) {
      return res.status(404).json({ error: "Client not found in cache" });
    }
    const body = req.body as Record<string, unknown>;
    const clearBreakdownOverrides = body.clearBreakdownOverrides === true;
    const breakdownOverrides =
      body.breakdownOverrides !== undefined ? body.breakdownOverrides : undefined;

    const result = await managerUpsertPrepaidPackageBilling({
      actorEmail,
      clientEmail,
      billingMonth,
      clientRow: row,
      managerPackageTotalVnd,
      managerNote,
      ...(clearBreakdownOverrides ? { clearBreakdownOverrides: true } : {}),
      ...(breakdownOverrides !== undefined ? { breakdownOverrides } : {})
    });
    if ("error" in result && result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to save prepaid billing" });
  }
});

// POST /manager/prepaid-package-billing/confirm
app.post("/manager/prepaid-package-billing/confirm", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const clientEmail = String(req.body.clientEmail ?? "").trim().toLowerCase();
  const billingMonth = String(req.body.billingMonth ?? "").trim();
  if (!actorEmail || !clientEmail || !billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return res.status(400).json({ error: "actorEmail, clientEmail, and billingMonth (YYYY-MM) are required" });
  }
  try {
    const result = await managerConfirmPrepaidPackageBilling({ actorEmail, clientEmail, billingMonth });
    if ("error" in result && result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to confirm" });
  }
});

// POST /manager/prepaid-package-billing/notify — in-app + optional Gmail (requires prior confirm)
app.post("/manager/prepaid-package-billing/notify", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const clientEmail = String(req.body.clientEmail ?? "").trim().toLowerCase();
  const billingMonth = String(req.body.billingMonth ?? "").trim();
  const notifyApp = req.body.notifyApp === true;
  const notifyEmail = req.body.notifyEmail === true;
  const clientName = req.body.clientName == null ? "" : String(req.body.clientName);
  if (!actorEmail || !clientEmail || !billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return res.status(400).json({ error: "actorEmail, clientEmail, and billingMonth (YYYY-MM) are required" });
  }
  if (!notifyApp && !notifyEmail) {
    return res.status(400).json({ error: "Set notifyApp and/or notifyEmail to true" });
  }
  try {
    const result = await managerNotifyPrepaidPackageBilling({
      actorEmail,
      clientEmail,
      billingMonth,
      clientName: clientName || undefined,
      notifyApp,
      notifyEmail
    });
    if ("error" in result && result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to send notifications" });
  }
});

// ── Gate parking tickets (per resident; unpaid amounts roll into monthly rent) ──

app.get("/manager/gate-parking-tickets", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!actorEmail || !email || !email.includes("@")) {
    return res.status(400).json({ error: "actorEmail and a valid resident email are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const tickets = await prisma.gateParkingTicket.findMany({
      where: { residentEmail: email },
      orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }]
    });
    return res.json({ tickets });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load tickets" });
  }
});

app.post("/manager/gate-parking-tickets", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const amountVnd = Number(req.body.amountVnd);
  const note = String(req.body.note ?? "").trim();
  const sessionStartRaw = req.body.sessionStartAt;
  const durationHoursRaw = req.body.durationHours;
  const periodMonthOverride = String(req.body.periodMonth ?? "").trim();

  if (!actorEmail || !email) {
    return res.status(400).json({ error: "actorEmail and email are required" });
  }
  if (!Number.isFinite(amountVnd) || amountVnd < 0) {
    return res.status(400).json({ error: "amountVnd must be a non-negative number" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const sessionStartAt =
    sessionStartRaw != null && String(sessionStartRaw).trim()
      ? new Date(String(sessionStartRaw).trim())
      : null;
  const durationHours =
    durationHoursRaw != null && String(durationHoursRaw).trim() !== ""
      ? Number(durationHoursRaw)
      : NaN;

  if (!sessionStartAt || Number.isNaN(sessionStartAt.getTime())) {
    return res.status(400).json({ error: "sessionStartAt (ISO date-time) is required" });
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return res.status(400).json({ error: "durationHours must be a positive number" });
  }

  let periodMonth: string;
  if (periodMonthOverride && /^\d{4}-\d{2}$/.test(periodMonthOverride)) {
    periodMonth = periodMonthOverride;
  } else {
    periodMonth = billingPeriodMonthForGateSession(sessionStartAt);
  }

  try {
    const ticket = await prisma.gateParkingTicket.create({
      data: {
        residentEmail: email,
        periodMonth,
        amountVnd: Math.round(amountVnd),
        sessionStartAt,
        durationHours,
        note: note || null,
        createdBy: actorEmail
      }
    });
    return res.json({ ticket });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to create ticket" });
  }
});

app.patch("/manager/gate-parking-tickets/:id", async (req, res) => {
  const actorEmail = String(req.body.actorEmail ?? "").trim();
  const id = String(req.params.id ?? "").trim();
  if (!actorEmail || !id) {
    return res.status(400).json({ error: "actorEmail and ticket id are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const existing = await prisma.gateParkingTicket.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  const data: {
    periodMonth?: string;
    amountVnd?: number;
    note?: string | null;
    paidAt?: Date | null;
    sessionStartAt?: Date | null;
    durationHours?: number | null;
  } = {};
  if (req.body.periodMonth != null) {
    const pm = String(req.body.periodMonth).trim();
    if (!/^\d{4}-\d{2}$/.test(pm)) {
      return res.status(400).json({ error: "periodMonth must be YYYY-MM" });
    }
    data.periodMonth = pm;
  }
  if (req.body.sessionStartAt !== undefined) {
    const raw = String(req.body.sessionStartAt ?? "").trim();
    if (!raw) {
      data.sessionStartAt = null;
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "sessionStartAt must be a valid ISO date-time" });
      }
      data.sessionStartAt = d;
    }
  }
  if (req.body.durationHours !== undefined) {
    const raw = req.body.durationHours;
    if (raw === null || raw === "") {
      data.durationHours = null;
    } else {
      const dh = Number(raw);
      if (!Number.isFinite(dh) || dh <= 0) {
        return res.status(400).json({ error: "durationHours must be positive when set" });
      }
      data.durationHours = dh;
    }
  }
  if (req.body.amountVnd != null) {
    const amt = Number(req.body.amountVnd);
    if (!Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: "amountVnd must be a non-negative number" });
    }
    data.amountVnd = Math.round(amt);
  }
  if (req.body.note !== undefined) {
    const n = req.body.note == null ? "" : String(req.body.note).trim();
    data.note = n ? n : null;
  }
  if (typeof req.body.markPaid === "boolean") {
    data.paidAt = req.body.markPaid ? new Date() : null;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No updates provided" });
  }
  try {
    const ticket = await prisma.gateParkingTicket.update({ where: { id }, data });
    return res.json({ ticket });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to update ticket" });
  }
});

app.delete("/manager/gate-parking-tickets/:id", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const id = String(req.params.id ?? "").trim();
  if (!actorEmail || !id) {
    return res.status(400).json({ error: "actorEmail and ticket id are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await prisma.gateParkingTicket.delete({ where: { id } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ error: "Ticket not found" });
  }
});

// GET /manager/monthly-rent-paid-map — batch paid flags for a calendar month (bed diagram, etc.)
app.get("/manager/monthly-rent-paid-map", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const month = String(req.query.month ?? "").trim();

  if (!actorEmail || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "actorEmail and month (YYYY-MM) are required" });
  }
  if (!(await isPrivilegedSupportOperator(actorEmail))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const rows = await prisma.monthlyRentStatus.findMany({
      where: { month },
      select: { email: true, isPaid: true }
    });
    const byEmail: Record<string, { isPaid: boolean }> = {};
    for (const row of rows) {
      byEmail[row.email.toLowerCase()] = { isPaid: row.isPaid };
    }
    return res.json({ month, byEmail });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load rent map" });
  }
});

// POST /rent-paid-status/apply-coins — resident opts in/out of applying coins toward the current month bill
app.post("/rent-paid-status/apply-coins", async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const applyCoinsTowardRent = req.body.applyCoinsTowardRent;
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthRaw = String(req.body.month ?? "").trim();
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : defaultMonth;

  if (!email || !email.includes("@") || typeof applyCoinsTowardRent !== "boolean") {
    return res.status(400).json({ error: "email and applyCoinsTowardRent (boolean) are required" });
  }

  try {
    const client = await getActiveClientByEmail(email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const existing = await prisma.monthlyRentStatus.findUnique({
      where: { email_month: { email, month } }
    });
    if (existing?.isPaid) {
      return res.status(400).json({ error: "Rent is already recorded as paid for this month; coin preference cannot be changed." });
    }
    if ((existing?.rentCoinRedeemCoins ?? 0) > 0 && applyCoinsTowardRent === false) {
      return res.status(400).json({
        error:
          "Coins have already been exchanged for this month's bill. Contact your manager if you need this adjusted."
      });
    }

    await prisma.monthlyRentStatus.upsert({
      where: { email_month: { email, month } },
      create: {
        email,
        month,
        isPaid: false,
        applyCoinsTowardRent,
        updatedBy: "resident-apply-coins"
      },
      update: {
        applyCoinsTowardRent,
        updatedBy: "resident-apply-coins"
      }
    });

    return res.json({ email, month, applyCoinsTowardRent });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to save preference" });
  }
});

// POST /rent-paid-status/redeem-coins-for-bill — resident confirms coin exchange (deducts sheet coins, locks redemption on the row)
app.post("/rent-paid-status/redeem-coins-for-bill", async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthRaw = String(req.body.month ?? "").trim();
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : defaultMonth;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  try {
    const client = await getActiveClientByEmail(email);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    const existing = await prisma.monthlyRentStatus.findUnique({
      where: { email_month: { email, month } }
    });
    if (existing?.isPaid) {
      return res.status(400).json({ error: "Rent is already recorded as paid for this month." });
    }
    if ((existing?.rentCoinRedeemCoins ?? 0) > 0) {
      return res.status(400).json({ error: "Coins have already been exchanged for this bill." });
    }
    if (existing?.applyCoinsTowardRent !== true) {
      return res.status(400).json({
        error: "Opt in to apply Cozoro Coins toward this bill first, then submit the exchange."
      });
    }

    const { breakdown } = await calculateRentBreakdownForBillingMonth(client, month, { managerDiscountVnd: 0 });
    const coinsToSpend = breakdown.recommendedCoinUsage;
    const valueVnd = breakdown.recommendedCoinValueVnd;
    if (!coinsToSpend || valueVnd <= 0) {
      return res.status(400).json({
        error: "There are no coins to exchange toward this bill (check your balance and the 10% cap)."
      });
    }

    const maHd = String(client["MÃ HD"] || client["MÃ HD".normalize("NFC")] || "").trim();
    if (!maHd) {
      return res.status(400).json({ error: "Contract code missing; cannot record coin adjustment." });
    }

    await managerAdjustCoins({
      maHd,
      delta: -coinsToSpend,
      reason: `Tiền phòng ${month} — đổi Cozoro Coins / Rent ${month} — coin exchange toward bill`,
      operator: email
    });

    await prisma.monthlyRentStatus.upsert({
      where: { email_month: { email, month } },
      create: {
        email,
        month,
        isPaid: false,
        applyCoinsTowardRent: true,
        rentCoinRedeemCoins: coinsToSpend,
        rentCoinRedeemValueVnd: valueVnd,
        rentCoinRedeemAt: new Date(),
        updatedBy: "resident-redeem-coins"
      },
      update: {
        rentCoinRedeemCoins: coinsToSpend,
        rentCoinRedeemValueVnd: valueVnd,
        rentCoinRedeemAt: new Date(),
        updatedBy: "resident-redeem-coins"
      }
    });

    const { breakdown: nextBreakdown } = await calculateRentBreakdownForBillingMonth(client, month, {
      managerDiscountVnd: 0
    });
    return res.json({
      email,
      month,
      rentCoinRedeemCoins: coinsToSpend,
      rentCoinRedeemValueVnd: valueVnd,
      rentCoinRedeemAt: new Date().toISOString(),
      breakdown: nextBreakdown
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to redeem coins" });
  }
});

// GET /rent-paid-status — client reads current month rent status + breakdown if unpaid
app.get("/rent-paid-status", async (req, res) => {
  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const [record, clientCache, portalUx] = await Promise.all([
      prisma.monthlyRentStatus.findUnique({ where: { email_month: { email, month } } }),
      readCachedClients(),
      getPortalUxSettings()
    ]);

    const applyCoinsTowardRent = record?.applyCoinsTowardRent === true;

    const client = clientCache?.rows.find((r) => (r["Địa chỉ email"] ?? "").toLowerCase() === email);
    if (!client) {
      return res.json({
        email,
        month,
        isPaid: record?.isPaid ?? false,
        applyCoinsTowardRent,
        rentCoinRedeemCoins: record?.rentCoinRedeemCoins ?? null,
        rentCoinRedeemValueVnd: record?.rentCoinRedeemValueVnd ?? null,
        rentCoinRedeemAt: record?.rentCoinRedeemAt?.toISOString() ?? null,
        breakdown: null,
        onPrepaidPlan: false,
        blockingRentDuePopupEnabled: portalUx.blockingRentDuePopupEnabled
      });
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
      return res.json({
        email,
        month,
        isPaid: record?.isPaid ?? onPrepaidPlan,
        applyCoinsTowardRent,
        rentCoinRedeemCoins: record?.rentCoinRedeemCoins ?? null,
        rentCoinRedeemValueVnd: record?.rentCoinRedeemValueVnd ?? null,
        rentCoinRedeemAt: record?.rentCoinRedeemAt?.toISOString() ?? null,
        breakdown: null,
        onPrepaidPlan,
        prepaidNextPaymentEstimate,
        blockingRentDuePopupEnabled: portalUx.blockingRentDuePopupEnabled
      });
    }

    const { breakdown } = await calculateRentBreakdownForBillingMonth(client, month, {
      managerDiscountVnd: 0
    });
    return res.json({
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
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load rent status" });
  }
});

// GET /manager/portal-ux-settings — staff reads portal UX toggles
app.get("/manager/portal-ux-settings", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  if (!actorEmail) {
    return res.status(400).json({ error: "actorEmail is required" });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const settings = await getPortalUxSettings();
    return res.json(settings);
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// PUT /manager/portal-ux-settings — staff updates portal UX toggles
app.put("/manager/portal-ux-settings", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "").trim();
  const blockingRentDuePopupEnabled = body.blockingRentDuePopupEnabled;
  if (!actorEmail) {
    return res.status(400).json({ error: "actorEmail is required" });
  }
  if (typeof blockingRentDuePopupEnabled !== "boolean") {
    return res.status(400).json({ error: "blockingRentDuePopupEnabled (boolean) is required" });
  }
  try {
    const settings = await updatePortalUxSettings(actorEmail, { blockingRentDuePopupEnabled });
    return res.json(settings);
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// GET /manager/cleaning-reward-settings — staff reads cleaning coin reward config
app.get("/manager/cleaning-reward-settings", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  if (!actorEmail) {
    return res.status(400).json({ error: "actorEmail is required" });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const settings = await getCleaningRewardSettings();
    return res.json(settings);
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// PUT /manager/cleaning-reward-settings — staff updates cleaning coin rewards
app.put("/manager/cleaning-reward-settings", async (req, res) => {
  const parsed = cleaningRewardSettingsPutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid cleaning reward settings payload" });
  }
  try {
    const settings = await updateCleaningRewardSettings(parsed.data.actorEmail, {
      baseRewards: parsed.data.baseRewards,
      selfAssignBonusMultiplier: parsed.data.selfAssignBonusMultiplier
    });
    return res.json(settings);
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// GET /resident/guides — bilingual how-to sections for residents (public read)
app.get("/resident/guides", async (_req, res) => {
  try {
    const guides = await listResidentGuidesPublic();
    return res.json({ guides });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load guides" });
  }
});

// GET /manager/resident-guides — same payload; staff-only
app.get("/manager/resident-guides", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  if (!actorEmail) {
    return res.status(400).json({ error: "actorEmail is required" });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const guides = await listResidentGuidesPublic();
    return res.json({ guides });
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// POST /manager/resident-guides — create section (steps with optional image URLs, or video URL)
app.post("/manager/resident-guides", async (req, res) => {
  const parsed = createGuideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid resident guide payload", details: parsed.error.flatten() });
  }
  try {
    const guide = await createResidentGuide(parsed.data);
    return res.json(guide);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to create guide";
    const code =
      msg.includes("Only managers") || msg.includes("Forbidden")
        ? 403
        : msg.includes("Unique constraint") || msg.includes("unique constraint")
          ? 409
          : 400;
    return res.status(code).json({ error: msg });
  }
});

// PATCH /manager/resident-guides/:id
app.patch("/manager/resident-guides/:id", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }
  const parsed = updateGuideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid resident guide payload", details: parsed.error.flatten() });
  }
  try {
    const guide = await updateResidentGuide(id, parsed.data);
    return res.json(guide);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to update guide";
    const code =
      msg === "Guide not found."
        ? 404
        : msg.includes("Only managers") || msg.includes("Forbidden")
          ? 403
          : 400;
    return res.status(code).json({ error: msg });
  }
});

// DELETE /manager/resident-guides/:id?actorEmail=
app.delete("/manager/resident-guides/:id", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  if (!id || !actorEmail) {
    return res.status(400).json({ error: "id and actorEmail are required" });
  }
  try {
    await deleteResidentGuide(actorEmail, id);
    return res.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to delete guide";
    const code =
      msg.includes("Only managers") || msg.includes("Forbidden")
        ? 403
        : msg.includes("Record to delete does not exist") || msg.includes("not found")
          ? 404
          : 400;
    return res.status(code).json({ error: msg });
  }
});

// GET /manager/fridge-drain-schedule — next fridge drain / clean day (Google Calendar)
app.get("/manager/fridge-drain-schedule", async (req, res) => {
  const actorEmail = String(req.query.actorEmail ?? "").trim();
  const branchId = String(req.query.branchId ?? "").trim();
  if (!actorEmail || (branchId !== "D2" && branchId !== "D7")) {
    return res.status(400).json({ error: "actorEmail and branchId (D2 or D7) are required." });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const schedule = await getManagerFridgeDrainSchedule(branchId);
    return res.json(schedule);
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// PUT /manager/fridge-drain-schedule — set cleaning day; OFF (day before) + ON times configurable (default 17:00 VN)
app.put("/manager/fridge-drain-schedule", async (req, res) => {
  const parsed = fridgeDrainSchedulePutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid fridge drain schedule payload" });
  }
  try {
    await requirePortalRole(parsed.data.actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const result = await upsertFridgeDrainCleaningDate({
      branchId: parsed.data.branchId,
      cleaningDate: parsed.data.cleaningDate,
      offTime: parsed.data.offTime,
      onTime: parsed.data.onTime
    });
    return res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to update calendar";
    const lower = msg.toLowerCase();
    const status =
      lower.includes("not configured") ||
      lower.includes("must be yyyy") ||
      lower.includes("must be hh:mm") ||
      lower.includes("invalid fridge schedule time")
        ? 400
        : lower.includes("staff only")
          ? 403
          : 500;
    return res.status(status).json({ error: msg });
  }
});

// POST /manager/coins/bulk-adjust — apply the same coin reason to multiple contracts
app.post("/manager/coins/bulk-adjust", async (request, response) => {
  const parsed = managerBulkCoinAdjustSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid bulk coin adjustment payload"
    });
  }

  try {
    await requirePortalRole(
      parsed.data.actorEmail.trim(),
      ["manager", "owner", "app_admin"],
      "Only managers or owners can adjust client coins."
    );
    const results: Array<{ maHd: string; ok: boolean; currentCoins?: number; error?: string }> = [];
    for (let i = 0; i < parsed.data.items.length; i++) {
      const item = parsed.data.items[i];
      try {
        const result = await runWithWriteGuard({
          key: createWriteGuardKey("/manager/coins/bulk-adjust", {
            actorEmail: parsed.data.actorEmail,
            reason: parsed.data.reason,
            maHd: item.maHd,
            delta: item.delta,
            index: i
          }),
          duplicateMessage: "This bulk adjustment was just submitted. Please wait a few seconds.",
          action: () =>
            managerAdjustCoins({
              maHd: item.maHd,
              delta: item.delta,
              reason: `${parsed.data.reason.trim()} (bulk)`,
              operator: parsed.data.actorEmail.trim()
            })
        });
        results.push({ maHd: item.maHd, ok: true, currentCoins: result.currentCoins });
      } catch (error) {
        results.push({
          maHd: item.maHd,
          ok: false,
          error: error instanceof Error ? error.message : "Unable to adjust coins"
        });
      }
    }
    return response.json({ results });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// POST /manager/bulk/push — send the same web push to multiple resident emails
app.post("/manager/bulk/push", async (request, response) => {
  const parsed = managerBulkPushSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid bulk push payload"
    });
  }
  try {
    await requirePortalRole(
      parsed.data.actorEmail.trim(),
      ["manager", "owner", "app_admin"],
      "Only managers or owners can send bulk notifications."
    );
    const emails = [...new Set(parsed.data.emails.map((e) => e.trim().toLowerCase()))];
    let sent = 0;
    for (const email of emails) {
      await sendPushToEmail(email, parsed.data.title.trim(), parsed.data.body.trim(), "/");
      sent += 1;
    }
    return response.json({ ok: true, attempted: emails.length });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

// ─── Short-term / Hostel portal ──────────────────────────────────────────────

// Tracks which hostel booking IDs have been confirmed by a manager
const HOSTEL_IMPORTED_IDS_PATH = process.env.HOSTEL_IMPORTED_IDS_PATH
  ?? path.join(process.cwd(), "data", "hostel-imported-ids.json");

// Table name for hostel bookings in MySQL (shared DB with standalone server)
const HOSTEL_BOOKING_TABLE = process.env.HOSTEL_BOOKING_TABLE ?? "guest_stay_bookings";

type StandaloneBooking = {
  id: string;
  guestName: string;
  email: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  pricing: {
    nights: number;
    nightlyRate: number;
    cleaningFee?: number;
    discountPercent?: number;
    subtotal?: number;
    discountAmount?: number;
    total: number;
  };
  source?: string;
  status: string;
  paymentStatus: string;
  mainAppImported?: boolean;
  mainAppBranch?: string;
  mainAppBed?: string;
  createdAt: string;
};

async function readImportedIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(HOSTEL_IMPORTED_IDS_PATH, "utf8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function addImportedId(id: string): Promise<void> {
  const ids = await readImportedIds();
  ids.add(id);
  await writeFile(HOSTEL_IMPORTED_IDS_PATH, JSON.stringify([...ids], null, 2), "utf8");
}

function formatDbDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val ?? "");
}

async function readHostelBookings(): Promise<StandaloneBooking[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, guest_name, guest_email, guest_phone, branch_id, bed_number,
              check_in, check_out, nights, nightly_rate, subtotal_amount,
              discount_percent, discount_amount, total_amount,
              status, payment_status, source, created_at
       FROM \`${HOSTEL_BOOKING_TABLE}\`
       ORDER BY created_at DESC
       LIMIT 500`
    );
    const importedIds = await readImportedIds();
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      guestName: String(row.guest_name ?? ""),
      email: String(row.guest_email ?? ""),
      phone: String(row.guest_phone ?? ""),
      checkIn: formatDbDate(row.check_in),
      checkOut: formatDbDate(row.check_out),
      pricing: {
        nights: Number(row.nights ?? 0),
        nightlyRate: Number(row.nightly_rate ?? 0),
        subtotal: Number(row.subtotal_amount ?? 0),
        discountPercent: Number(row.discount_percent ?? 0),
        discountAmount: Number(row.discount_amount ?? 0),
        total: Number(row.total_amount ?? 0),
      },
      source: String(row.source ?? ""),
      status: String(row.status ?? ""),
      paymentStatus: String(row.payment_status ?? ""),
      mainAppImported: importedIds.has(String(row.id ?? "")),
      mainAppBranch: String(row.branch_id ?? ""),
      mainAppBed: String(row.bed_number ?? ""),
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

app.get("/manager/short-term/config", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const config = await getShortTermConfig();
    return response.json(config);
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load config" });
  }
});

app.put("/manager/short-term/config", async (request, response) => {
  const { actorEmail, ...patch } = request.body as { actorEmail: string; [key: string]: unknown };
  if (!actorEmail) return response.status(400).json({ error: "actorEmail required" });
  try {
    const config = await updateShortTermConfig(actorEmail, patch as Parameters<typeof updateShortTermConfig>[1]);
    return response.json(config);
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to update config" });
  }
});

app.post("/internal/guest-auth/send-code", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").trim();
  const siteTitle = String(req.body?.siteTitle ?? "CozoroHome Guest Booking").trim();
  const honeypot = String(req.body?.website ?? req.body?.company ?? "").trim();

  if (!email || !code) {
    return res.status(400).json({ error: "email and code are required" });
  }

  if (honeypot) {
    return res.json({ ok: true });
  }

  try {
    await assertGuestAuthRateLimit(email, normalizeIp(req.get("x-forwarded-for") || req.ip || req.socket.remoteAddress || ""));
    await sendGmailReceipt({
      to: email,
      subject: `[${siteTitle}] Email verification code`,
      body: [
        `Your verification code is: ${code}`,
        "",
        "Enter this code in the guest booking page to verify your email before booking.",
        "If you did not request this code, you can ignore this email."
      ].join("\n")
    });

    return res.json({ ok: true });
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: number })?.statusCode === "number" ? (error as { statusCode?: number }).statusCode! : 500;
    return res.status(statusCode).json({ error: error instanceof Error ? error.message : "Unable to send verification code" });
  }
});

app.get("/api/public/prospect-assistant/settings", async (_request, response) => {
  try {
    const settings = await getProspectAssistantPublicSettings();
    return response.json(settings);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load prospect assistant settings"
    });
  }
});

app.put("/api/public/prospect-assistant/settings", async (request, response) => {
  const parsed = z.object({
    actorEmail: z.string().email(),
    referralDiscountVnd: z.coerce.number().int().nonnegative()
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid prospect assistant settings payload" });
  }

  try {
    const settings = await updateProspectAssistantSettings(parsed.data);
    return response.json(settings);
  } catch (error) {
    return response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to update prospect assistant settings"
    });
  }
});

app.post("/api/public/prospect-assistant/referral-check", async (request, response) => {
  const parsed = z.object({
    referrerName: z.string().trim().min(1),
    referrerPhone: z.string().trim().min(1)
  }).safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid referral check payload" });
  }

  try {
    const result = await checkProspectReferralEligibility(parsed.data);
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to check referral eligibility"
    });
  }
});

app.get("/api/public/register/availability", async (request, response) => {
  const parsed = prospectAvailabilityQuerySchema.safeParse({
    branchId: request.query.branchId,
    sex: request.query.sex
  });

  if (!parsed.success) {
    return response.status(400).json({ error: "A valid branchId and sex are required" });
  }

  try {
    const availability = await getProspectBedAvailability(parsed.data);
    return response.json(availability);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load register availability"
    });
  }
});

// Public: upload ID scan for registration (stored in api/data/id-scans/)
app.post("/api/public/register/id-scan", express.raw({ type: "*/*", limit: "10mb" }), async (request, response) => {
  const originalName = String(request.query.filename ?? "id.jpg");
  try {
    const dir = path.join(process.cwd(), "data", "id-scans");
    await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
    const ext = path.extname(originalName) || ".jpg";
    const fileName = `id-${Date.now()}-${randomUUID()}${ext}`;
    const filePath = path.join(dir, fileName);
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filePath);
      ws.on("finish", resolve);
      ws.on("error", reject);
      ws.end(request.body as Buffer);
    });
    return response.json({ ok: true, fileName });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

app.get("/api/public/referral-program", async (_request, response) => {
  try {
    const marketing = await getReferralProgramPublicMarketing();
    return response.json(marketing);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load referral program"
    });
  }
});

app.get("/api/public/referral/lookup", async (request, response) => {
  const code = String(request.query.code ?? "").trim();
  if (!code) {
    return response.status(400).json({ error: "code is required" });
  }

  try {
    const marketing = await getReferralProgramPublicMarketing();
    if (!marketing.enabled) {
      return response.json({ ok: false, error: "inactive" });
    }

    const cache = await readCachedClients();
    const referrer = resolveReferrerFromCode(code, cache?.rows ?? []);
    if (!referrer) {
      return response.json({ ok: false, error: "invalid" });
    }

    const name = referrer.name.trim();
    const referrerNameHint =
      name.length > 2 ? `${name.slice(0, 1)}***${name.slice(-1)}` : "***";

    return response.json({ ok: true, referrerNameHint });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to look up referral code"
    });
  }
});

app.post("/api/public/referral/quote", async (request, response) => {
  const parsed = referralQuoteSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid referral quote payload" });
  }
  try {
    const { code, product, contractMonths, nights } = parsed.data;
    if (product === "long_term" && contractMonths === undefined) {
      return response.status(400).json({ error: "contractMonths is required for long_term" });
    }
    if (product === "hostel" && nights === undefined) {
      return response.status(400).json({ error: "nights is required for hostel" });
    }
    const result = await quoteReferralOffer({
      code,
      product,
      contractMonths,
      nights
    });
    if (!result.ok) {
      return response.status(400).json({ error: result.error });
    }
    return response.json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to quote referral"
    });
  }
});

app.post("/api/public/register", async (request, response) => {
  const parsed = publicRegistrationSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid register submission payload" });
  }

  try {
    if (await anyClientRowExistsForEmail(parsed.data.email)) {
      return response.status(400).json({
        error:
          "This email already has a registration record. Contact staff if you are extending a contract or re-applying."
      });
    }

    // Resolve configurable cleaning opt-out fee for this branch
    const branchSettings = await getBranchPricingSettings(parsed.data.branchId);
    const configuredCleaningFeeVnd = branchSettings.cleaningOptOutFeeVnd;

    const tierChoices = await resolveParkingTierChoicesForBed(parsed.data.branchId, parsed.data.bedNumber);
    let parkingFeeVnd = 0;
    let parkingPlanSummary: string | undefined;
    if (parsed.data.hasMotorbike) {
      const optId = parsed.data.parkingOptionId?.trim();
      const match =
        (optId ? tierChoices.find((c) => c.id === optId) : undefined) ??
        (tierChoices.length === 1 ? tierChoices[0] : undefined);
      if (!match) {
        return response.status(400).json({ error: "Select a motorbike parking plan." });
      }
      parkingFeeVnd = match.feeVnd;
      const label = match.labelEn;
      parkingPlanSummary = `${label} — ${match.feeVnd.toLocaleString("vi-VN")} ₫/month`;
    }

    let mergedAdditionalTerms = parsed.data.additionalTerms?.trim() ?? "";
    let referralNoteLine: string | undefined;
    let referralRewards: {
      newUserCoins: number;
      referrerCoins: number;
      referrerMaHd: string;
    } | null = null;

    const referralCodeRaw = parsed.data.referralCode?.trim();
    if (referralCodeRaw) {
      const referralResolution = await resolveReferralForNewRegistration({
        registrantEmail: parsed.data.email,
        referralCode: referralCodeRaw,
        contractMonths: parsed.data.contractMonths
      });

      if (!referralResolution.ok) {
        return response.status(400).json({ error: referralResolution.error });
      }

      const subtotalRaw = parsed.data.firstPaymentSubtotalBeforeReferral;
      if (subtotalRaw === undefined) {
        return response.status(400).json({
          error:
            "firstPaymentSubtotalBeforeReferral is required when submitting with a referral code (estimated first payment total before referral discount)."
        });
      }

      const firstPaymentSubtotal = Math.max(0, Math.trunc(subtotalRaw));
      if (firstPaymentSubtotal < parsed.data.deposit) {
        return response.status(400).json({
          error: "Invalid first payment subtotal (must be at least the deposit amount)."
        });
      }

      const appliedDiscount = Math.min(referralResolution.discountVnd, firstPaymentSubtotal);
      const scaleNote = `contract ${parsed.data.contractMonths} mo; scale ${referralResolution.scale.toFixed(2)} vs ${referralResolution.basisMonths} mo baseline`;
      const refLine = `Referral (one-time first payment): −${appliedDiscount.toLocaleString("vi-VN")} VND (${scaleNote}; referrer contract ${referralResolution.referrer.maHd}; deposit unchanged)`;
      mergedAdditionalTerms = [mergedAdditionalTerms, refLine].filter(Boolean).join(" | ");
      referralNoteLine = `Referral: referrer ${referralResolution.referrer.email} (${referralResolution.referrer.maHd}); −${appliedDiscount} VND one-time first payment (${scaleNote}); deposit ${parsed.data.deposit} VND unchanged; new-user coins ${referralResolution.newUserCoins}; referrer coins ${referralResolution.referrerCoins}`;
      referralRewards = {
        newUserCoins: referralResolution.newUserCoins,
        referrerCoins: referralResolution.referrerCoins,
        referrerMaHd: referralResolution.referrer.maHd
      };
    }

    const result = await runWithWriteGuard({
      key: createWriteGuardKey("/api/public/register", parsed.data),
      duplicateMessage: "This registration was just submitted. Please wait a few seconds before trying again.",
      cooldownMs: 15000,
      action: async () => {
        const {
          parkingOptionId: _parkingOptionIdIgnored,
          referralCode: _referralIgnored,
          firstPaymentSubtotalBeforeReferral: _fpSubtotalIgnored,
          ...registrationFields
        } = parsed.data;
        void _parkingOptionIdIgnored;
        void _referralIgnored;
        void _fpSubtotalIgnored;

        const registration = await submitPublicRegistration({
          ...registrationFields,
          additionalTerms: mergedAdditionalTerms || undefined,
          referralNoteLine,
          cleaningOptOutFeeVnd: configuredCleaningFeeVnd,
          parkingFeeVnd,
          parkingPlanSummary,
          idScanUrl: parsed.data.idScanUrl,
          motorbikePlate: parsed.data.motorbikePlate
        });

        if (parsed.data.contractCleaningOptOut) {
          await upsertContractCleaningOptOut({
            email: parsed.data.email,
            branchId: parsed.data.branchId,
            contractCode: registration.contractCode,
            contractStartDate: parsed.data.contractStartDate,
            contractEndDate: parsed.data.contractEndDate,
            cleaningFeeVnd: configuredCleaningFeeVnd
          });
        }

        return registration;
      }
    });

    if (referralRewards && (referralRewards.newUserCoins > 0 || referralRewards.referrerCoins > 0)) {
      try {
        await applyReferralRegistrationRewards({
          newUserMaHd: result.contractCode,
          newUserCoins: referralRewards.newUserCoins,
          referrerMaHd: referralRewards.referrerMaHd,
          referrerCoins: referralRewards.referrerCoins
        });
      } catch (coinError) {
        console.error("[api/public/register] Referral coin grants failed", coinError);
        return response.json({
          ok: true,
          contractCode: result.contractCode,
          referralCoinsWarning: coinError instanceof Error ? coinError.message : "Referral coin grants failed"
        });
      }
    }

    return response.json({
      ok: true,
      contractCode: result.contractCode
    });
  } catch (error) {
    return response.status((error as Error & { statusCode?: number }).statusCode ?? 500).json({
      error: error instanceof Error ? error.message : "Unable to submit registration"
    });
  }
});

// ─── Unified Pricing (long-term + short-term beds & discounts) ───────────────

// Public: enabled long-term discounts + branch pricing settings for the registration form
app.get("/api/public/pricing-discounts", async (request, response) => {
  try {
    const emailRaw = String(request.query.email ?? "").trim().toLowerCase();
    let priorResidentContract = false;
    if (emailRaw) {
      const emailCheck = z.string().email().safeParse(emailRaw);
      if (emailCheck.success) {
        priorResidentContract = await anyClientRowExistsForEmail(emailRaw);
      }
    }
    const [discountsAll, branchSettings] = await Promise.all([
      getDiscounts("long_term", true),
      getAllBranchPricingSettings()
    ]);
    const discounts = priorResidentContract
      ? discountsAll.filter((d) => !d.firstContractOnly)
      : discountsAll;
    return response.json({ discounts, branchSettings, priorResidentContract });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Unable to load discounts" });
  }
});

// Manager: full pricing data (all bed overrides + all discounts)
app.get("/manager/pricing", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const [bedOverrides, discounts, branchSettings, parkingOverrides, parkingTiers] = await Promise.all([
      getBedOverrides(),
      getDiscounts(),
      getAllBranchPricingSettings(),
      getBedParkingFeeOverrides(),
      listParkingPricingTiers()
    ]);
    return response.json({ bedOverrides, discounts, branchSettings, parkingOverrides, parkingTiers });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load pricing" });
  }
});

app.get("/manager/referral-program", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const settings = await getReferralProgramSettings();
    return response.json(settings);
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load referral settings" });
  }
});

app.put("/manager/referral-program", async (request, response) => {
  const body = request.body as { actorEmail?: string; settings?: Partial<ReferralProgramSettings> };
  try {
    const settings = await updateReferralProgramSettings({
      actorEmail: String(body.actorEmail ?? ""),
      settings: body.settings ?? {}
    });
    return response.json({ ok: true, settings });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save referral settings" });
  }
});

// Owner: upsert branch pricing settings (cleaning opt-out fee, parking fee)
app.put("/manager/pricing/branch-settings", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "");
  const { branchId, cleaningOptOutFeeVnd, parkingFeeVnd } = body as {
    branchId: string; cleaningOptOutFeeVnd?: number; parkingFeeVnd?: number;
  };
  try {
    if (!branchId) return response.status(400).json({ error: "branchId is required" });
    const row = await upsertBranchPricingSettings(actorEmail, { branchId, cleaningOptOutFeeVnd, parkingFeeVnd });
    return response.json({ ok: true, row });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save settings" });
  }
});

// Owner: upsert per-bed parking fee override
app.put("/manager/pricing/parking-beds", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "");
  const { branchId, bedNumber, parkingFeeVnd } = body as { branchId: string; bedNumber: number; parkingFeeVnd: number };
  try {
    if (!branchId || typeof bedNumber !== "number") return response.status(400).json({ error: "branchId and bedNumber are required" });
    const row = await upsertBedParkingFeeOverride(actorEmail, { branchId, bedNumber, parkingFeeVnd });
    return response.json({ ok: true, row });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save parking fee" });
  }
});

// Owner: delete per-bed parking fee override
app.delete("/manager/pricing/parking-beds", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  const { branchId, bedNumber } = request.query as { branchId: string; bedNumber: string };
  try {
    if (!branchId || !bedNumber) return response.status(400).json({ error: "branchId and bedNumber are required" });
    await deleteBedParkingFeeOverride(actorEmail, branchId, Number(bedNumber));
    return response.json({ ok: true });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to delete parking fee override" });
  }
});

// Manager/owner: upsert a named parking tier per branch (registration choices)
app.put("/manager/pricing/parking-tiers", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "");
  const { id, branchId, labelEn, labelVi, feeVnd, sortOrder, active } = body as {
    id?: string;
    branchId: string;
    labelEn: string;
    labelVi: string;
    feeVnd: number;
    sortOrder?: number;
    active?: boolean;
  };
  try {
    if (!branchId) {
      return response.status(400).json({ error: "branchId is required" });
    }
    if (typeof feeVnd !== "number" || !Number.isFinite(feeVnd)) {
      return response.status(400).json({ error: "feeVnd is required" });
    }
    const row = await upsertParkingPricingTier(actorEmail, {
      id,
      branchId,
      labelEn: labelEn ?? "",
      labelVi: labelVi ?? "",
      feeVnd,
      sortOrder,
      active
    });
    return response.json({ ok: true, row });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save parking tier" });
  }
});

app.delete("/manager/pricing/parking-tiers", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  const id = String(request.query.id ?? "");
  try {
    if (!id) {
      return response.status(400).json({ error: "id is required" });
    }
    await deleteParkingPricingTier(actorEmail, id);
    return response.json({ ok: true });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to delete parking tier" });
  }
});

// Owner: upsert bed price override
app.put("/manager/pricing/beds", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "");
  const { branchId, bedNumber, termType, monthlyPrice, deposit, nightlyPrice } = body as {
    branchId: string; bedNumber: number; termType: TermType;
    monthlyPrice?: number | null; deposit?: number | null; nightlyPrice?: number | null;
  };
  try {
    if (!branchId || typeof bedNumber !== "number" || !termType) {
      return response.status(400).json({ error: "branchId, bedNumber, and termType are required" });
    }
    const row = await upsertBedOverride(actorEmail, { branchId, bedNumber, termType, monthlyPrice, deposit, nightlyPrice });
    return response.json({ ok: true, row });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to update bed pricing" });
  }
});

// Owner: delete bed price override
app.delete("/manager/pricing/beds", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  const { branchId, bedNumber, termType } = request.query as { branchId: string; bedNumber: string; termType: TermType };
  try {
    if (!branchId || !bedNumber || !termType) {
      return response.status(400).json({ error: "branchId, bedNumber, and termType are required" });
    }
    await deleteBedOverride(actorEmail, branchId, Number(bedNumber), termType);
    return response.json({ ok: true });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to delete bed override" });
  }
});

// Owner: upsert discount
app.put("/manager/pricing/discounts", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const actorEmail = String(body.actorEmail ?? "");
  const { discount } = body as { discount: Parameters<typeof upsertDiscount>[1] };
  try {
    if (!discount?.id || !discount?.label) {
      return response.status(400).json({ error: "discount.id and discount.label are required" });
    }
    const row = await upsertDiscount(actorEmail, discount);
    return response.json({ ok: true, row });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to save discount" });
  }
});

// Owner: delete discount
app.delete("/manager/pricing/discounts/:id", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  const discountId = request.params.id;
  try {
    if (!discountId) {
      return response.status(400).json({ error: "discount id is required" });
    }
    await deleteDiscount(actorEmail, discountId);
    return response.json({ ok: true });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to delete discount" });
  }
});

app.get("/api/public/short-term-config", async (_request, response) => {
  try {
    const config = await getShortTermConfig();
    return response.json({
      bedPricing: config.bedPricing,
      discounts: config.discounts,
      minimumStay: config.minimumStay,
      updatedAt: config.updatedAt
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Unable to load short-term config" });
  }
});

app.get("/manager/short-term/guests", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const all = await getManagerClients();
    const shortTerm = all.filter((c) => String(c.maHd ?? "").startsWith("SHORTTERM"));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    function parseDate(str: string): Date | null {
      if (!str) return null;
      if (str.includes("/")) {
        const [d, m, y] = str.split("/");
        return new Date(Number(y), Number(m) - 1, Number(d));
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    }
    const current = shortTerm.filter((c) => {
      const checkIn = parseDate(String(c.row?.["Ngày bắt đầu hợp đồng"] ?? ""));
      const checkOut = parseDate(String(c.row?.["Ngày hết hạn hợp đồng"] ?? ""));
      if (!checkIn || !checkOut) return false;
      return checkIn <= today && checkOut >= today;
    });
    const past = shortTerm.filter((c) => {
      const checkOut = parseDate(String(c.row?.["Ngày hết hạn hợp đồng"] ?? ""));
      return checkOut && checkOut < today;
    });
    return response.json({ current, past, total: shortTerm.length });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load guests" });
  }
});

app.get("/manager/short-term/pending-bookings", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "");
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const all = await readHostelBookings();
    const pending = all.filter(
      (b) => b.status !== "canceled" && b.status !== "CANCELLED" && !b.mainAppImported
    );
    return response.json({ bookings: pending });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load bookings" });
  }
});

app.post("/manager/short-term/bookings/:id/confirm", async (request, response) => {
  const bookingId = request.params.id;
  const { actorEmail, branch, bed } = request.body as {
    actorEmail: string;
    branch: "D2" | "D7";
    bed: string;
  };
  if (!actorEmail || !branch || bed === undefined) {
    return response.status(400).json({ error: "actorEmail, branch, and bed are required" });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const importedIds = await readImportedIds();
    if (importedIds.has(bookingId)) return response.status(409).json({ error: "Booking already confirmed" });

    const all = await readHostelBookings();
    const booking = all.find((b) => b.id === bookingId);
    if (!booking) return response.status(404).json({ error: "Booking not found" });

    // Upsert client into Google Sheet (overwrites any auto-synced entry with confirmed branch/bed)
    await upsertPaidGuestBookingClient({
      bookingId: booking.id,
      guestEmail: booking.email,
      guestName: booking.guestName,
      guestPhone: booking.phone ?? "",
      bioSex: "",
      branchId: branch,
      bedNumber: Number(bed),
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      pricingTotal: booking.pricing.total,
      notes: `Confirmed by ${actorEmail} | Source: ${booking.source ?? "hostel site"} | Booking ID: ${booking.id}`
    });

    // Create portal auth with phone digits as initial password
    const initialPassword = (booking.phone ?? "").replace(/\D+/g, "") || "cozoro2024";
    await upsertStoredPassword(booking.email.trim().toLowerCase(), initialPassword, { mustChangePassword: true });

    await addImportedId(bookingId);

    return response.json({ ok: true, contractCode: `SHORTTERM-${bookingId}`, initialPassword });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Failed to confirm booking" });
  }
});

app.post("/manager/short-term/bookings", async (request, response) => {
  const { actorEmail, guestName, email, phone, checkIn, checkOut, branch, bed, totalAmount, paymentStatus, source, notes } = request.body as {
    actorEmail: string; guestName: string; email: string; phone: string;
    checkIn: string; checkOut: string; branch: "D2" | "D7"; bed: string;
    totalAmount: number; paymentStatus: string; source?: string; notes?: string;
  };
  if (!actorEmail || !guestName || !email || !checkIn || !checkOut || !branch || !bed) {
    return response.status(400).json({ error: "actorEmail, guestName, email, checkIn, checkOut, branch, and bed are required" });
  }
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const bookingId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await upsertPaidGuestBookingClient({
      bookingId,
      guestEmail: email.trim().toLowerCase(),
      guestName: guestName.trim(),
      guestPhone: phone.trim(),
      bioSex: "",
      branchId: branch,
      bedNumber: Number(bed),
      checkIn,
      checkOut,
      pricingTotal: Number(totalAmount) || 0,
      notes: [
        notes?.trim(),
        `Added manually by ${actorEmail}`,
        source ? `Source: ${source}` : "",
        paymentStatus ? `Payment: ${paymentStatus}` : "",
      ].filter(Boolean).join(" | ")
    });
    const initialPassword = phone.replace(/\D+/g, "") || "cozoro2024";
    await upsertStoredPassword(email.trim().toLowerCase(), initialPassword, { mustChangePassword: true });
    await addImportedId(bookingId);
    return response.json({ ok: true, contractCode: `SHORTTERM-${bookingId}`, initialPassword });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Failed to add hostel guest" });
  }
});

// ─── Contract termination & check-out ────────────────────────────────────────

app.post("/manager/terminate-contract", async (request, response) => {
  const { actorEmail, maHd, email, name, branch, bed, depositNote } = request.body as {
    actorEmail: string; maHd: string; email: string;
    name: string; branch: string; bed: string; depositNote?: string;
  };
  if (!actorEmail || !maHd || !email) {
    return response.status(400).json({ error: "actorEmail, maHd, and email are required" });
  }
  try {
    const record = await terminateContract({ actorEmail, maHd, email, name, branch, bed, depositNote });
    return response.json({ ok: true, record });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to terminate contract" });
  }
});

app.get("/manager/termination-status", async (request, response) => {
  const maHd = String(request.query.maHd ?? "");
  const actorEmail = String(request.query.actorEmail ?? "");
  if (!maHd) return response.status(400).json({ error: "maHd required" });
  try {
    await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Staff only.");
    const record = await getTerminationByMaHd(maHd);
    return response.json({ record: record ?? null });
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : "Unable to load termination status" });
  }
});

app.get("/manager/deposit-refund-preview", async (request, response) => {
  const actorEmail = String(request.query.actorEmail ?? "").trim();
  const maHd = String(request.query.maHd ?? "").trim();
  if (!actorEmail || !maHd) {
    return response.status(400).json({ error: "actorEmail and maHd are required" });
  }
  try {
    const result = await managerGetDepositRefundPreview({ actorEmail, maHd });
    if ("error" in result && result.error) {
      return response.status(400).json({ error: result.error });
    }
    return response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to load deposit refund preview";
    const forbidden = msg.toLowerCase().includes("staff only") || msg.toLowerCase().includes("permission");
    return response.status(forbidden ? 403 : 500).json({ error: msg });
  }
});

app.post("/manager/deposit-refund-email", async (request, response) => {
  const actorEmail = String(request.body?.actorEmail ?? "").trim();
  const maHd = String(request.body?.maHd ?? "").trim();
  const refundAmountVnd = Number(request.body?.refundAmountVnd);
  if (!actorEmail || !maHd) {
    return response.status(400).json({ error: "actorEmail and maHd are required" });
  }
  try {
    const result = await managerSendDepositRefundEmail({ actorEmail, maHd, refundAmountVnd });
    if ("error" in result && result.error) {
      return response.status(400).json({ error: result.error });
    }
    return response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unable to send deposit refund email";
    const forbidden = msg.toLowerCase().includes("staff only") || msg.toLowerCase().includes("permission");
    return response.status(forbidden ? 403 : 500).json({ error: msg });
  }
});

app.get("/client/termination-status", async (request, response) => {
  const email = String(request.query.email ?? "");
  if (!email) return response.status(400).json({ error: "email required" });
  try {
    const record = await getTerminationByEmail(email);
    return response.json({ record: record ?? null });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Unable to load termination status" });
  }
});

app.get("/client/checkout-context", async (request, response) => {
  const email = String(request.query.email ?? "").trim().toLowerCase();
  if (!email) return response.status(400).json({ error: "email required" });
  try {
    const ctx = await getCheckoutContext(email);
    return response.json(ctx);
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Unable to load checkout context" });
  }
});

app.post("/client/checkout/upload-photo", express.raw({ type: "*/*", limit: "15mb" }), async (request, response) => {
  const email = String(request.query.email ?? "");
  const maHd = String(request.query.maHd ?? "");
  const originalName = String(request.query.filename ?? "photo.jpg");
  const step = String(request.query.step ?? "").trim();
  if (!email || !maHd) return response.status(400).json({ error: "email and maHd required" });
  try {
    const allowed = await verifyCheckoutPhotoAccess(email.trim().toLowerCase(), maHd);
    if (!allowed) {
      return response.status(403).json({ error: "Check-out is not available for this account or contract." });
    }
    const photosDir = await ensureCheckoutPhotosDir();
    const ext = path.extname(originalName) || ".jpg";
    const safeMa = maHd.replace(/[^a-zA-Z0-9-]/g, "_");
    const stepPart = step && /^[1-4]$/.test(step) ? `-step${step}` : "";
    const fileName = `checkout-${safeMa}${stepPart}-${randomUUID()}${ext}`;
    const filePath = path.join(photosDir, fileName);
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filePath);
      ws.on("finish", resolve);
      ws.on("error", reject);
      ws.end(request.body as Buffer);
    });
    return response.json({ ok: true, fileName });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

app.post("/client/checkout", express.json(), async (request, response) => {
  const { email, maHd, steps, photos, source } = request.body as {
    email: string;
    maHd: string;
    steps: {
      luggage: boolean;
      bedding: boolean;
      keys: boolean;
      photoNote: string;
      optionalStepPhotos?: Record<string, string[]>;
    };
    photos: string[];
    source?: "termination" | "contract_due";
  };
  if (!email || !maHd) return response.status(400).json({ error: "email and maHd required" });
  try {
    const ctx = await getCheckoutContext(String(email).trim().toLowerCase());
    if (!ctx.eligible || ctx.completed || !ctx.maHd || ctx.maHd !== String(maHd).trim()) {
      return response.status(403).json({ error: "Check-out is not available for this account." });
    }
    const resolvedSource = source ?? ctx.kind ?? "termination";
    if (resolvedSource !== ctx.kind) {
      return response.status(400).json({ error: "Checkout source does not match your eligibility." });
    }
    const record = await submitCheckOut({
      email,
      maHd,
      steps: steps ?? { luggage: false, bedding: false, keys: false, photoNote: "" },
      photos: photos ?? [],
      source: resolvedSource
    });
    const optional = steps?.optionalStepPhotos ?? {};
    const allLocals = [
      ...Object.values(optional).flat(),
      ...(photos ?? [])
    ].filter(Boolean);
    const quyTrinh = JSON.stringify(
      {
        luggage: Boolean(steps?.luggage),
        bedding: Boolean(steps?.bedding),
        keys: Boolean(steps?.keys),
        photoNote: String(steps?.photoNote ?? ""),
        optionalStepPhotos: optional,
        finalPhotos: photos ?? []
      },
      null,
      0
    );
    try {
      await appendCheckoutSheetRow({
        user: ctx.name ?? "",
        email: String(email).trim().toLowerCase(),
        maHd: String(maHd).trim(),
        name: ctx.name ?? "",
        dateTimeCheckout: record.submittedAt,
        quyTrinh,
        photosLocalPaths: allLocals.join("; "),
        branch: ctx.branch ?? "",
        bed: ctx.bed ?? "",
        source: resolvedSource
      });
    } catch (sheetErr) {
      console.error("[checkout] Google Sheet append failed:", sheetErr);
    }
    return response.json({ ok: true, record });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Unable to submit check-out" });
  }
});

app.get("/checkout-photo/:filename", async (request, response) => {
  const filename = request.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = path.join(checkoutPhotosDirPath, filename);
  try {
    return response.sendFile(filePath);
  } catch {
    return response.status(404).json({ error: "Photo not found" });
  }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Global Error Handler]", err);
  res.status(500).json({
    error: err instanceof Error ? err.message : "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`[AntiGravity v2] cozorohome-api listening on http://127.0.0.1:${port}`);

  void recoverDeferredCleaningCalendarCreates().catch((error) => {
    console.error("[cleaning-calendar] deferred recovery on startup failed", error);
  });

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

    void runAutoSchedule("startup").catch((error) => {
      console.error("[cleaning-auto-schedule] startup failed", error);
    });

    const scheduleTimer = setInterval(() => {
      void runAutoSchedule("interval").catch((error) => {
        console.error("[cleaning-auto-schedule] interval failed", error);
      });
    }, autoScheduleIntervalMs);

    scheduleTimer.unref();
  });
