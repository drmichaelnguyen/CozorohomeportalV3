import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { sendGmailReceipt } from "./google-sheets.js";
import { sendPushToEmail } from "./push.js";
import { listStaffNotifyEmails } from "./staff-access.js";

const cacheDirPath = path.join(process.cwd(), "data");
const alertsFilePath = path.join(cacheDirPath, "hostel-booking-alerts.json");
const PORTAL_APP_URL = (process.env.PORTAL_PUBLIC_URL ?? "https://app.cozorohome.com").replace(/\/+$/, "");
const ALWAYS_NOTIFY_EMAILS = (
  process.env.HOSTEL_NOTIFY_EMAILS?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [
    "cozorohome@gmail.com"
  ]
);

export type HostelBookingNotifyKind = "NEW" | "PAID" | "CONFIRMED";

export type HostelBookingNotifyPayload = {
  bookingId: string;
  guestEmail: string;
  guestName: string;
  guestPhone?: string;
  branchId: string;
  roomCode?: string;
  bedNumber: number | string;
  checkIn: string;
  checkOut: string;
  nights?: number;
  totalAmount?: number;
  currency?: string;
  paymentStatus?: string;
  status?: string;
  /** Portal login password shared only on manager confirm emails. */
  initialPassword?: string;
  actorEmail?: string;
};

type HostelBookingAlert = {
  id: string;
  bookingId: string;
  kind: HostelBookingNotifyKind;
  guestEmail: string;
  guestName: string;
  title: string;
  body: string;
  createdAt: string;
  dismissedAt: string | null;
  emailsSent: {
    guest: boolean;
    staff: boolean;
  };
};

type HostelBookingAlertsFile = {
  alerts: HostelBookingAlert[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function formatMoney(amount: number | undefined, currency = "VND") {
  if (amount == null || !Number.isFinite(amount)) {
    return "—";
  }
  const normalizedCurrency = currency.trim().toUpperCase() || "VND";
  if (normalizedCurrency === "VND" || normalizedCurrency === "VNĐ") {
    return `${new Intl.NumberFormat("vi-VN").format(Math.round(amount))} ₫`;
  }
  return `${new Intl.NumberFormat("en-US").format(amount)} ${normalizedCurrency}`;
}

function formatStaySummary(payload: HostelBookingNotifyPayload) {
  const nights =
    payload.nights ??
    Math.max(
      0,
      Math.round(
        (new Date(`${payload.checkOut}T12:00:00`).getTime() - new Date(`${payload.checkIn}T12:00:00`).getTime()) /
          86400000
      )
    );
  const roomBit = payload.roomCode ? `Room ${payload.roomCode}, ` : "";
  return [
    `Guest: ${payload.guestName}`,
    `Email: ${normalizeEmail(payload.guestEmail)}`,
    payload.guestPhone ? `Phone: ${payload.guestPhone}` : null,
    `Branch: ${payload.branchId}`,
    `Bed: ${roomBit}#${payload.bedNumber}`,
    `Check-in: ${payload.checkIn}`,
    `Check-out: ${payload.checkOut}`,
    `Nights: ${nights}`,
    `Total: ${formatMoney(payload.totalAmount, payload.currency)}`,
    `Booking ID: ${payload.bookingId}`
  ]
    .filter(Boolean)
    .join("\n");
}

async function ensureAlertsFile(): Promise<HostelBookingAlertsFile> {
  await mkdir(cacheDirPath, { recursive: true });
  try {
    const raw = await readFile(alertsFilePath, "utf8");
    const parsed = JSON.parse(raw) as HostelBookingAlertsFile;
    return { alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [] };
  } catch {
    const fallback: HostelBookingAlertsFile = { alerts: [] };
    await writeFile(alertsFilePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeAlertsFile(file: HostelBookingAlertsFile) {
  await mkdir(cacheDirPath, { recursive: true });
  await writeFile(alertsFilePath, JSON.stringify(file, null, 2), "utf8");
}

async function resolveStaffEmails(): Promise<string[]> {
  const fromStaff = await listStaffNotifyEmails();
  return [...new Set([...ALWAYS_NOTIFY_EMAILS, ...fromStaff].map(normalizeEmail).filter(Boolean))];
}

async function sendEmailsSafely(recipients: string[], subject: string, body: string) {
  const unique = [...new Set(recipients.map(normalizeEmail).filter(Boolean))];
  const results = await Promise.allSettled(
    unique.map((to) => sendGmailReceipt({ to, subject, body }))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[hostel-booking-notify] email failed", result.reason);
    }
  }
  return unique.length;
}

function buildGuestNewEmail(payload: HostelBookingNotifyPayload) {
  return {
    subject: `CozoroHome hostel booking received — ${payload.bookingId}`,
    body: [
      `Hello ${payload.guestName},`,
      "",
      "We received your CozoroHome hostel booking request.",
      "Please complete payment if you have not already — your bed is held pending payment confirmation.",
      "",
      formatStaySummary(payload),
      "",
      "You will receive another email once payment is confirmed.",
      "",
      "— CozoroHome",
      "https://app.cozorohome.com"
    ].join("\n")
  };
}

function buildStaffNewEmail(payload: HostelBookingNotifyPayload) {
  return {
    subject: `[Hostel] New booking — ${payload.guestName} (${payload.branchId})`,
    body: [
      "A new hostel booking was created and is awaiting payment / review.",
      "",
      formatStaySummary(payload),
      "",
      `Open pending bookings: ${PORTAL_APP_URL}/manager?view=short_term`,
      "",
      "— CozoroHome portal"
    ].join("\n")
  };
}

function buildGuestPaidEmail(payload: HostelBookingNotifyPayload) {
  return {
    subject: `CozoroHome hostel payment confirmed — ${payload.bookingId}`,
    body: [
      `Hello ${payload.guestName},`,
      "",
      "Thank you — your hostel booking payment was received.",
      "Our team will finalize your bed assignment if needed and share check-in details.",
      "",
      formatStaySummary(payload),
      "",
      "— CozoroHome",
      "https://app.cozorohome.com"
    ].join("\n")
  };
}

function buildStaffPaidEmail(payload: HostelBookingNotifyPayload) {
  return {
    subject: `[Hostel] Paid booking — ${payload.guestName} (${payload.branchId})`,
    body: [
      "A hostel booking payment was confirmed.",
      "",
      formatStaySummary(payload),
      "",
      `Open short-term queue: ${PORTAL_APP_URL}/manager?view=short_term`,
      "",
      "— CozoroHome portal"
    ].join("\n")
  };
}

function buildGuestConfirmedEmail(payload: HostelBookingNotifyPayload) {
  const passwordLine = payload.initialPassword
    ? [
        "",
        "Portal login:",
        `Email: ${normalizeEmail(payload.guestEmail)}`,
        `Temporary password: ${payload.initialPassword}`,
        "Please sign in and change your password after first login.",
        PORTAL_APP_URL
      ].join("\n")
    : "";

  return {
    subject: `CozoroHome hostel booking confirmed — ${payload.bookingId}`,
    body: [
      `Hello ${payload.guestName},`,
      "",
      "Your hostel booking has been confirmed by CozoroHome staff.",
      "",
      formatStaySummary(payload),
      passwordLine,
      "",
      "— CozoroHome",
      "https://app.cozorohome.com"
    ]
      .filter((line) => line !== null)
      .join("\n")
  };
}

async function upsertAlert(input: {
  bookingId: string;
  kind: HostelBookingNotifyKind;
  guestEmail: string;
  guestName: string;
  title: string;
  body: string;
  emailsSent: { guest: boolean; staff: boolean };
}) {
  const file = await ensureAlertsFile();
  const existing = file.alerts.find(
    (alert) => alert.bookingId === input.bookingId && alert.kind === input.kind && !alert.dismissedAt
  );
  if (existing) {
    existing.emailsSent = {
      guest: existing.emailsSent.guest || input.emailsSent.guest,
      staff: existing.emailsSent.staff || input.emailsSent.staff
    };
    existing.title = input.title;
    existing.body = input.body;
    await writeAlertsFile(file);
    return existing;
  }

  const alert: HostelBookingAlert = {
    id: `hostel-${input.kind.toLowerCase()}-${randomUUID()}`,
    bookingId: input.bookingId,
    kind: input.kind,
    guestEmail: normalizeEmail(input.guestEmail),
    guestName: input.guestName,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    dismissedAt: null,
    emailsSent: input.emailsSent
  };
  file.alerts.unshift(alert);
  // Keep file bounded
  file.alerts = file.alerts.slice(0, 200);
  await writeAlertsFile(file);
  try {
    const { invalidateStaffSupportNotificationCache } = await import("./support.js");
    invalidateStaffSupportNotificationCache();
  } catch {
    // Notification cache invalidation is best-effort.
  }
  return alert;
}

async function alreadyEmailed(bookingId: string, kind: HostelBookingNotifyKind, channel: "guest" | "staff") {
  const file = await ensureAlertsFile();
  const match = file.alerts.find((alert) => alert.bookingId === bookingId && alert.kind === kind);
  return Boolean(match?.emailsSent?.[channel]);
}

export async function loadOpenHostelBookingAlertsForStaff() {
  const file = await ensureAlertsFile();
  const weekMs = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return file.alerts.filter(
    (alert) =>
      !alert.dismissedAt &&
      (alert.kind === "NEW" || alert.kind === "PAID") &&
      now - new Date(alert.createdAt).getTime() < weekMs
  );
}

export async function dismissHostelBookingAlert(input: { alertId: string }) {
  const file = await ensureAlertsFile();
  const alert = file.alerts.find((entry) => entry.id === input.alertId);
  if (!alert) {
    throw new Error("Hostel booking alert not found.");
  }
  alert.dismissedAt = new Date().toISOString();
  await writeAlertsFile(file);
  return { ok: true as const };
}

export async function dismissHostelBookingAlertsForBooking(
  bookingId: string,
  kinds?: HostelBookingNotifyKind[]
) {
  const normalizedId = bookingId.trim();
  if (!normalizedId) {
    return { ok: true as const, dismissed: 0 };
  }
  const kindSet = kinds?.length ? new Set(kinds) : null;
  const file = await ensureAlertsFile();
  let dismissed = 0;
  const now = new Date().toISOString();
  for (const alert of file.alerts) {
    if (alert.bookingId !== normalizedId || alert.dismissedAt) {
      continue;
    }
    if (kindSet && !kindSet.has(alert.kind)) {
      continue;
    }
    alert.dismissedAt = now;
    dismissed += 1;
  }
  if (dismissed > 0) {
    await writeAlertsFile(file);
  }
  return { ok: true as const, dismissed };
}

export async function notifyHostelBookingCreated(payload: HostelBookingNotifyPayload) {
  const staffEmails = await resolveStaffEmails();
  const guestEmail = normalizeEmail(payload.guestEmail);
  const guestMail = buildGuestNewEmail(payload);
  const staffMail = buildStaffNewEmail(payload);

  const guestAlready = await alreadyEmailed(payload.bookingId, "NEW", "guest");
  const staffAlready = await alreadyEmailed(payload.bookingId, "NEW", "staff");

  if (!guestAlready && guestEmail) {
    await sendEmailsSafely([guestEmail], guestMail.subject, guestMail.body);
  }
  if (!staffAlready) {
    await sendEmailsSafely(staffEmails, staffMail.subject, staffMail.body);
    await Promise.allSettled(
      staffEmails.map((email) =>
        sendPushToEmail(
          email,
          "New hostel booking",
          `${payload.guestName} · ${payload.branchId} bed ${payload.bedNumber}`,
          "/manager?view=short_term"
        )
      )
    );
  }

  await upsertAlert({
    bookingId: payload.bookingId,
    kind: "NEW",
    guestEmail,
    guestName: payload.guestName,
    title: `New hostel booking — ${payload.guestName}`,
    body: `${payload.branchId} bed ${payload.bedNumber} · ${payload.checkIn} → ${payload.checkOut} · ${formatMoney(payload.totalAmount, payload.currency)}`,
    emailsSent: {
      guest: guestAlready || Boolean(guestEmail),
      staff: true
    }
  });

  return { ok: true as const };
}

export async function notifyHostelBookingPaid(payload: HostelBookingNotifyPayload) {
  const staffEmails = await resolveStaffEmails();
  const guestEmail = normalizeEmail(payload.guestEmail);
  const guestMail = buildGuestPaidEmail(payload);
  const staffMail = buildStaffPaidEmail(payload);

  const guestAlready = await alreadyEmailed(payload.bookingId, "PAID", "guest");
  const staffAlready = await alreadyEmailed(payload.bookingId, "PAID", "staff");

  if (!guestAlready && guestEmail) {
    await sendEmailsSafely([guestEmail], guestMail.subject, guestMail.body);
  }
  if (!staffAlready) {
    await sendEmailsSafely(staffEmails, staffMail.subject, staffMail.body);
    await Promise.allSettled(
      staffEmails.map((email) =>
        sendPushToEmail(
          email,
          "Hostel booking paid",
          `${payload.guestName} · ${payload.branchId} bed ${payload.bedNumber}`,
          "/manager?view=short_term"
        )
      )
    );
  }

  await dismissHostelBookingAlertsForBooking(payload.bookingId, ["NEW"]);

  await upsertAlert({
    bookingId: payload.bookingId,
    kind: "PAID",
    guestEmail,
    guestName: payload.guestName,
    title: `Hostel payment received — ${payload.guestName}`,
    body: `${payload.branchId} bed ${payload.bedNumber} · ${payload.checkIn} → ${payload.checkOut} · ${formatMoney(payload.totalAmount, payload.currency)}`,
    emailsSent: {
      guest: guestAlready || Boolean(guestEmail),
      staff: true
    }
  });

  return { ok: true as const };
}

export async function notifyHostelBookingConfirmed(payload: HostelBookingNotifyPayload) {
  const guestEmail = normalizeEmail(payload.guestEmail);
  const guestMail = buildGuestConfirmedEmail(payload);
  const guestAlready = await alreadyEmailed(payload.bookingId, "CONFIRMED", "guest");

  if (!guestAlready && guestEmail) {
    await sendEmailsSafely([guestEmail], guestMail.subject, guestMail.body);
  }

  await upsertAlert({
    bookingId: payload.bookingId,
    kind: "CONFIRMED",
    guestEmail,
    guestName: payload.guestName,
    title: `Hostel booking confirmed — ${payload.guestName}`,
    body: `${payload.branchId} bed ${payload.bedNumber} · confirmed`,
    emailsSent: {
      guest: guestAlready || Boolean(guestEmail),
      staff: true
    }
  });

  // Clear bell items once staff has confirmed the booking.
  await dismissHostelBookingAlertsForBooking(payload.bookingId);

  return { ok: true as const };
}
