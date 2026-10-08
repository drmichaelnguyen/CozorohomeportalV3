import { randomBytes } from "node:crypto";
import {
  DonationCouponStatus,
  DonationFollowUpKind,
  DonationFollowUpStatus,
  DonationRequestStatus,
  DonationStayTerm,
  DonationType,
  Prisma
} from "@prisma/client";
import { sendGmailReceipt } from "./google-sheets.js";
import {
  buildDonationIngestFromWebLead,
  computeLongTermDonationDiscount,
  computeShortTermDonationDiscount,
  couponEmailCopy,
  generateDonationCouponCode,
  isDonationCouponCode,
  isIsoDate,
  normalizeDonationCouponCode,
  normalizeDonationType,
  planDonationFollowUps,
  postEventEmailCopy,
  preEventEmailCopy,
  type DonationIngestDraft,
  type DonationKind,
  type DonationTermType
} from "./donation-partnership-logic.js";
import { prisma } from "./prisma.js";

const MAX_COUPONS = 20;
const MAX_FOLLOW_UP_ATTEMPTS = 5;

export class DonationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

type RequestWithRelations = Prisma.DonationRequestGetPayload<{
  include: { coupons: true; followUps: true };
}>;

function clipError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to send email";
  return message.slice(0, 500);
}

function dateOnly(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function formatDateOnly(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function serializeCoupon(row: RequestWithRelations["coupons"][number]) {
  return {
    id: row.id,
    code: row.code,
    termType: row.termType,
    benefitUnits: row.benefitUnits,
    status: row.status,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    redeemedByEmail: row.redeemedByEmail,
    redemptionRef: row.redemptionRef,
    discountVnd: row.discountVnd,
    createdAt: row.createdAt.toISOString()
  };
}

function serializeFollowUp(row: RequestWithRelations["followUps"][number]) {
  return {
    id: row.id,
    kind: row.kind,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status,
    sentAt: row.sentAt?.toISOString() ?? null,
    lastError: row.lastError,
    attempts: row.attempts
  };
}

function serializeRequest(row: RequestWithRelations, extra?: { unchanged?: boolean }) {
  return {
    id: row.id,
    externalKey: row.externalKey,
    name: row.name,
    phone: row.phone,
    email: row.email,
    donationType: row.donationType,
    donationDetail: row.donationDetail,
    eventName: row.eventName,
    eventDetails: row.eventDetails,
    eventDate: formatDateOnly(row.eventDate),
    socialPlatform: row.socialPlatform,
    socialHandle: row.socialHandle,
    socialLink: row.socialLink,
    returnOffer: row.returnOffer,
    status: row.status,
    rejectNote: row.rejectNote,
    decidedByEmail: row.decidedByEmail,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    couponCount: row.couponCount,
    termType: row.termType,
    couponEmailSentAt: row.couponEmailSentAt?.toISOString() ?? null,
    couponEmailError: row.couponEmailError,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unchanged: Boolean(extra?.unchanged),
    coupons: [...row.coupons].sort((a, b) => a.code.localeCompare(b.code)).map(serializeCoupon),
    followUps: [...row.followUps].sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime()).map(serializeFollowUp)
  };
}

const requestInclude = {
  coupons: true,
  followUps: true
} satisfies Prisma.DonationRequestInclude;

function newCouponCode() {
  return generateDonationCouponCode(() => randomBytes(1)[0] ?? 0);
}

async function loadRequest(id: string) {
  const row = await prisma.donationRequest.findUnique({
    where: { id },
    include: requestInclude
  });
  if (!row) throw new DonationError("Donation request not found.", 404);
  return row;
}

export async function upsertDonationRequest(input: DonationIngestDraft) {
  const eventDate = input.eventDate && isIsoDate(input.eventDate) ? dateOnly(input.eventDate) : null;
  const data = {
    name: input.name.slice(0, 160),
    phone: input.phone,
    email: input.email.trim().toLowerCase(),
    donationType: input.donationType === "CASH" ? DonationType.CASH : DonationType.IN_KIND,
    donationDetail: input.donationDetail,
    eventName: input.eventName,
    eventDetails: input.eventDetails,
    eventDate,
    socialPlatform: input.socialPlatform,
    socialHandle: input.socialHandle,
    socialLink: input.socialLink,
    returnOffer: input.returnOffer,
    source: input.source.slice(0, 32)
  };

  const existing = await prisma.donationRequest.findUnique({
    where: { externalKey: input.externalKey },
    include: requestInclude
  });
  if (existing && existing.status !== DonationRequestStatus.PENDING) {
    return serializeRequest(existing, { unchanged: true });
  }
  if (existing) {
    const updated = await prisma.donationRequest.update({
      where: { id: existing.id },
      data,
      include: requestInclude
    });
    return serializeRequest(updated);
  }
  const created = await prisma.donationRequest.create({
    data: {
      externalKey: input.externalKey.slice(0, 120),
      status: DonationRequestStatus.PENDING,
      ...data
    },
    include: requestInclude
  });
  return serializeRequest(created);
}

export async function ingestDonationFromWebLead(input: Parameters<typeof buildDonationIngestFromWebLead>[0]) {
  const draft = buildDonationIngestFromWebLead(input);
  if ("skipped" in draft) return draft;
  const request = await upsertDonationRequest(draft);
  return { skipped: false as const, id: request.id, status: request.status, unchanged: request.unchanged };
}

export async function listDonationRequests(status?: DonationRequestStatus) {
  const rows = await prisma.donationRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: requestInclude
  });
  return rows.map((row) => serializeRequest(row));
}

export async function getDonationRequest(id: string) {
  const row = await prisma.donationRequest.findUnique({
    where: { id },
    include: requestInclude
  });
  return row ? serializeRequest(row) : null;
}

async function replaceFollowUps(requestId: string, eventDateYmd: string, now = new Date()) {
  const plan = planDonationFollowUps(eventDateYmd, now);
  const existing = await prisma.donationFollowUp.findMany({ where: { requestId } });
  for (const item of plan) {
    const current = existing.find((row) => row.kind === item.kind);
    if (current?.status === DonationFollowUpStatus.SENT) continue;
    await prisma.donationFollowUp.upsert({
      where: { requestId_kind: { requestId, kind: item.kind } },
      create: {
        requestId,
        kind: item.kind,
        scheduledFor: item.scheduledFor,
        status: item.status === "SKIPPED" ? DonationFollowUpStatus.SKIPPED : DonationFollowUpStatus.SCHEDULED,
        lastError: item.skipReason,
        attempts: 0
      },
      update: {
        scheduledFor: item.scheduledFor,
        status: item.status === "SKIPPED" ? DonationFollowUpStatus.SKIPPED : DonationFollowUpStatus.SCHEDULED,
        lastError: item.skipReason,
        sentAt: null,
        attempts: 0
      }
    });
  }
}

export async function setDonationEventDate(id: string, eventDateYmd: string) {
  if (!isIsoDate(eventDateYmd)) {
    throw new DonationError("Event date must be YYYY-MM-DD.");
  }
  const current = await loadRequest(id);
  if (current.status === DonationRequestStatus.REJECTED) {
    throw new DonationError("Rejected requests cannot be rescheduled.");
  }
  await prisma.donationRequest.update({
    where: { id },
    data: { eventDate: dateOnly(eventDateYmd) }
  });
  if (current.status === DonationRequestStatus.APPROVED) {
    await replaceFollowUps(id, eventDateYmd);
  }
  return serializeRequest(await loadRequest(id));
}

async function sendCouponEmail(row: RequestWithRelations) {
  const codes = row.coupons.map((coupon) => coupon.code);
  const copy = couponEmailCopy({
    name: row.name,
    termType: row.termType === DonationStayTerm.LONG_TERM ? "LONG_TERM" : "SHORT_TERM",
    codes,
    eventName: row.eventName,
    eventDate: formatDateOnly(row.eventDate)
  });
  await sendGmailReceipt({ to: row.email, subject: copy.subject, body: copy.body });
}

export async function approveDonationRequest(input: {
  id: string;
  operatorEmail: string;
  couponCount: number;
  termType: DonationTermType;
  eventDate?: string | null;
}) {
  const count = Math.round(input.couponCount);
  if (!Number.isFinite(count) || count < 1 || count > MAX_COUPONS) {
    throw new DonationError(`Coupon count must be between 1 and ${MAX_COUPONS}.`);
  }
  const termType = input.termType === "LONG_TERM" ? DonationStayTerm.LONG_TERM : DonationStayTerm.SHORT_TERM;
  const current = await loadRequest(input.id);
  if (current.status !== DonationRequestStatus.PENDING) {
    throw new DonationError("Only pending donation requests can be approved.");
  }
  const eventDateYmd = input.eventDate?.trim() || formatDateOnly(current.eventDate);
  if (!eventDateYmd || !isIsoDate(eventDateYmd)) {
    throw new DonationError("Set an event date before approving so the reminder emails can be scheduled.");
  }

  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let code = newCouponCode();
    for (let attempt = 0; attempt < 5 && codes.includes(code); attempt += 1) {
      code = newCouponCode();
    }
    codes.push(code);
  }

  await prisma.$transaction(async (tx) => {
    const pending = await tx.donationRequest.updateMany({
      where: { id: input.id, status: DonationRequestStatus.PENDING },
      data: {
        status: DonationRequestStatus.APPROVED,
        decidedByEmail: input.operatorEmail.trim().toLowerCase(),
        decidedAt: new Date(),
        couponCount: count,
        termType,
        eventDate: dateOnly(eventDateYmd),
        rejectNote: null,
        couponEmailError: null
      }
    });
    if (pending.count !== 1) {
      throw new DonationError("Only pending donation requests can be approved.", 409);
    }
    await tx.donationStayCoupon.createMany({
      data: codes.map((code) => ({
        requestId: input.id,
        code,
        termType,
        benefitUnits: 1,
        status: DonationCouponStatus.ISSUED
      }))
    });
  });

  await replaceFollowUps(input.id, eventDateYmd);

  let emailSent = false;
  let emailError: string | null = null;
  const approved = await loadRequest(input.id);
  try {
    await sendCouponEmail(approved);
    emailSent = true;
    await prisma.donationRequest.update({
      where: { id: input.id },
      data: { couponEmailSentAt: new Date(), couponEmailError: null }
    });
  } catch (error) {
    emailError = clipError(error);
    await prisma.donationRequest.update({
      where: { id: input.id },
      data: { couponEmailError: emailError }
    });
  }

  return {
    request: serializeRequest(await loadRequest(input.id)),
    emailSent,
    emailError
  };
}

export async function resendDonationCouponEmail(id: string) {
  const row = await loadRequest(id);
  if (row.status !== DonationRequestStatus.APPROVED || row.coupons.length === 0) {
    throw new DonationError("Coupon email can be resent after the request is approved.");
  }
  try {
    await sendCouponEmail(row);
    await prisma.donationRequest.update({
      where: { id },
      data: { couponEmailSentAt: new Date(), couponEmailError: null }
    });
    return { request: serializeRequest(await loadRequest(id)), emailSent: true, emailError: null };
  } catch (error) {
    const emailError = clipError(error);
    await prisma.donationRequest.update({
      where: { id },
      data: { couponEmailError: emailError }
    });
    return { request: serializeRequest(await loadRequest(id)), emailSent: false, emailError };
  }
}

export async function rejectDonationRequest(input: { id: string; operatorEmail: string; note?: string | null }) {
  const current = await loadRequest(input.id);
  if (current.status !== DonationRequestStatus.PENDING) {
    throw new DonationError("Only pending donation requests can be rejected.");
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  await prisma.donationRequest.update({
    where: { id: input.id },
    data: {
      status: DonationRequestStatus.REJECTED,
      rejectNote: note,
      decidedByEmail: input.operatorEmail.trim().toLowerCase(),
      decidedAt: new Date()
    }
  });
  await prisma.donationFollowUp.updateMany({
    where: { requestId: input.id, status: DonationFollowUpStatus.SCHEDULED },
    data: { status: DonationFollowUpStatus.SKIPPED, lastError: "Request was rejected." }
  });
  return serializeRequest(await loadRequest(input.id));
}

function termMismatchMessage(termType: DonationStayTerm) {
  return termType === DonationStayTerm.SHORT_TERM
    ? "This code is for a short-term hostel stay."
    : "This code is for a long-term registration.";
}

export async function quoteDonationCoupon(input: {
  code: string;
  termType: DonationTermType;
  nightlyRates?: number[];
  monthlyRentVnd?: number;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
}) {
  const code = normalizeDonationCouponCode(input.code);
  if (!isDonationCouponCode(code)) {
    throw new DonationError("Invalid coupon code.");
  }
  const coupon = await prisma.donationStayCoupon.findUnique({ where: { code } });
  if (!coupon || coupon.status !== DonationCouponStatus.ISSUED) {
    throw new DonationError("This coupon is not available.");
  }
  const expected = input.termType === "LONG_TERM" ? DonationStayTerm.LONG_TERM : DonationStayTerm.SHORT_TERM;
  if (coupon.termType !== expected) {
    throw new DonationError(termMismatchMessage(coupon.termType));
  }
  const discountVnd =
    expected === DonationStayTerm.SHORT_TERM
      ? computeShortTermDonationDiscount(input.nightlyRates ?? [])
      : computeLongTermDonationDiscount({
          monthlyRentVnd: input.monthlyRentVnd ?? 0,
          firstPaymentSubtotalVnd: input.firstPaymentSubtotalVnd,
          depositVnd: input.depositVnd,
          otherDiscountVnd: input.otherDiscountVnd
        });
  return {
    ok: true as const,
    code,
    termType: coupon.termType,
    benefit: expected === DonationStayTerm.SHORT_TERM ? ("one_night" as const) : ("one_month_rent" as const),
    discountVnd
  };
}

export async function redeemDonationCoupon(input: {
  code: string;
  termType: DonationTermType;
  email: string;
  redemptionRef: string;
  nightlyRates?: number[];
  monthlyRentVnd?: number;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
  /** Cap so the stored credit cannot exceed the amount still due on the stay. */
  maxDiscountVnd?: number | null;
}) {
  const quoted = await quoteDonationCoupon(input);
  const cap =
    input.maxDiscountVnd == null || !Number.isFinite(input.maxDiscountVnd)
      ? quoted.discountVnd
      : Math.max(0, Math.round(input.maxDiscountVnd));
  const discountVnd = Math.min(quoted.discountVnd, cap);
  if (discountVnd <= 0) {
    throw new DonationError("This stay has no amount the coupon can waive.");
  }
  const email = input.email.trim().toLowerCase();
  const redemptionRef = input.redemptionRef.trim();
  if (!redemptionRef) throw new DonationError("A redemption reference is required.");

  return prisma.$transaction(async (tx) => {
    const coupon = await tx.donationStayCoupon.findUnique({ where: { code: quoted.code } });
    if (!coupon) throw new DonationError("Invalid coupon code.");
    if (coupon.termType !== (input.termType === "LONG_TERM" ? DonationStayTerm.LONG_TERM : DonationStayTerm.SHORT_TERM)) {
      throw new DonationError(termMismatchMessage(coupon.termType));
    }
    if (coupon.status === DonationCouponStatus.REDEEMED && coupon.redemptionRef === redemptionRef) {
      return {
        ok: true as const,
        code: coupon.code,
        discountVnd: coupon.discountVnd ?? discountVnd,
        alreadyRedeemed: true
      };
    }
    if (coupon.status !== DonationCouponStatus.ISSUED) {
      throw new DonationError("This coupon has already been used.");
    }
    const updated = await tx.donationStayCoupon.updateMany({
      where: { id: coupon.id, status: DonationCouponStatus.ISSUED },
      data: {
        status: DonationCouponStatus.REDEEMED,
        redeemedAt: new Date(),
        redeemedByEmail: email,
        redemptionRef,
        discountVnd
      }
    });
    if (updated.count !== 1) {
      throw new DonationError("This coupon has already been used.", 409);
    }
    return { ok: true as const, code: coupon.code, discountVnd, alreadyRedeemed: false };
  });
}

export async function releaseDonationCoupon(input: { code: string; redemptionRef: string }) {
  const code = normalizeDonationCouponCode(input.code);
  const redemptionRef = input.redemptionRef.trim();
  if (!isDonationCouponCode(code) || !redemptionRef) {
    return { released: false };
  }
  const updated = await prisma.donationStayCoupon.updateMany({
    where: { code, status: DonationCouponStatus.REDEEMED, redemptionRef },
    data: {
      status: DonationCouponStatus.ISSUED,
      redeemedAt: null,
      redeemedByEmail: null,
      redemptionRef: null,
      discountVnd: null
    }
  });
  return { released: updated.count === 1 };
}

async function sendFollowUp(row: {
  kind: DonationFollowUpKind;
  request: {
    name: string;
    email: string;
    eventName: string | null;
    eventDate: Date | null;
    returnOffer: string;
  };
}) {
  const payload = {
    name: row.request.name,
    eventName: row.request.eventName,
    eventDate: formatDateOnly(row.request.eventDate),
    returnOffer: row.request.returnOffer
  };
  const copy = row.kind === DonationFollowUpKind.PRE_EVENT ? preEventEmailCopy(payload) : postEventEmailCopy(payload);
  await sendGmailReceipt({ to: row.request.email, subject: copy.subject, body: copy.body });
}

let followUpsRunning = false;

export async function dispatchDonationFollowUps(now = new Date()) {
  if (followUpsRunning) return { skipped: true as const, sent: 0, failed: 0 };
  followUpsRunning = true;
  let sent = 0;
  let failed = 0;
  try {
    const due = await prisma.donationFollowUp.findMany({
      where: {
        status: DonationFollowUpStatus.SCHEDULED,
        scheduledFor: { lte: now },
        request: { status: DonationRequestStatus.APPROVED }
      },
      include: { request: true },
      orderBy: { scheduledFor: "asc" },
      take: 40
    });
    for (const row of due) {
      if (row.attempts >= MAX_FOLLOW_UP_ATTEMPTS) {
        await prisma.donationFollowUp.update({
          where: { id: row.id },
          data: { status: DonationFollowUpStatus.FAILED, lastError: row.lastError || "Gave up after repeated send failures." }
        });
        failed += 1;
        continue;
      }
      try {
        await sendFollowUp(row);
        await prisma.donationFollowUp.update({
          where: { id: row.id },
          data: {
            status: DonationFollowUpStatus.SENT,
            sentAt: new Date(),
            attempts: { increment: 1 },
            lastError: null
          }
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        await prisma.donationFollowUp.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: clipError(error)
          }
        });
      }
    }
    return { skipped: false as const, sent, failed };
  } finally {
    followUpsRunning = false;
  }
}

export function parseDonationTypeInput(value: string): DonationKind {
  return normalizeDonationType(value) ?? "IN_KIND";
}
