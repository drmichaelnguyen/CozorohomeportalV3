import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import Stripe from "stripe";
import { managerCreatePaymentReceipt } from "./google-sheets.js";
import { prisma } from "./prisma.js";

const HOSTEL_BOOKING_TABLE = process.env.HOSTEL_BOOKING_TABLE ?? "guest_stay_bookings";
const RECEIPT_LEDGER_PATH =
  process.env.STRIPE_HOSTEL_RECEIPT_LEDGER_PATH ??
  path.join(process.cwd(), "data", "stripe-hostel-payment-receipts.json");

const STRIPE_HOSTEL_PAYMENT_PURPOSE = "Phí lưu trú ngắn hạn (Stripe)";
const STRIPE_HOSTEL_ADJUSTMENT_PURPOSE = "Điều chỉnh booking ngắn hạn (Stripe)";

type ReceiptLedgerEntry = {
  bookingId: string;
  stripeSessionId: string;
  stripePaymentIntentId: string;
  amountVnd: number;
  purpose: string;
  createdAt: string;
};

type ReceiptLedger = {
  byPaymentIntent: Record<string, ReceiptLedgerEntry>;
};

export type StripeHostelPaymentSummary = {
  bookingId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  branchId: string;
  bedNumber: number;
  roomCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalAmount: number;
  amountPaid: number;
  refundedAmount: number;
  refundableAmount: number;
  currency: string;
  paymentStatus: string;
  bookingStatus: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  refundStatus: string | null;
  refundedAt: string | null;
  receiptCreated: boolean;
  receiptAmount: number | null;
  receiptCreatedAt: string | null;
  createdAt: string;
};

export type StripeHostelPaymentDetail = StripeHostelPaymentSummary & {
  notes: string;
  cancellationPolicy: string;
  stripeCharges: Array<{
    id: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    status: string;
    createdAt: string | null;
    receiptUrl: string | null;
  }>;
  stripeRefunds: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    reason: string | null;
    createdAt: string | null;
  }>;
  receipts: ReceiptLedgerEntry[];
};

type HostelBookingRow = Record<string, unknown>;

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured on the API server.");
  }
  return new Stripe(secretKey);
}

function formatDbDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val ?? "");
}

function formatDbDateTime(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString();
  const raw = String(val ?? "").trim();
  return raw || null;
}

async function readReceiptLedger(): Promise<ReceiptLedger> {
  try {
    const raw = await readFile(RECEIPT_LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as ReceiptLedger;
    return {
      byPaymentIntent: parsed.byPaymentIntent ?? {}
    };
  } catch {
    return { byPaymentIntent: {} };
  }
}

async function writeReceiptLedger(ledger: ReceiptLedger): Promise<void> {
  await mkdir(path.dirname(RECEIPT_LEDGER_PATH), { recursive: true });
  await writeFile(RECEIPT_LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf8");
}

function mapBookingRow(row: HostelBookingRow, ledger: ReceiptLedger): StripeHostelPaymentSummary {
  const paymentIntentId = String(row.stripe_payment_intent_id ?? "").trim();
  const receiptEntry = paymentIntentId ? ledger.byPaymentIntent[paymentIntentId] : undefined;
  const amountPaid = Number(row.amount_paid ?? 0) || 0;
  const refundedAmount = Number(row.refunded_amount ?? 0) || 0;

  return {
    bookingId: String(row.id ?? ""),
    guestName: String(row.guest_name ?? ""),
    guestEmail: String(row.guest_email ?? ""),
    guestPhone: String(row.guest_phone ?? ""),
    branchId: String(row.branch_id ?? ""),
    bedNumber: Number(row.bed_number ?? 0) || 0,
    roomCode: String(row.room_code ?? ""),
    checkIn: formatDbDate(row.check_in),
    checkOut: formatDbDate(row.check_out),
    nights: Number(row.nights ?? 0) || 0,
    totalAmount: Number(row.total_amount ?? 0) || 0,
    amountPaid,
    refundedAmount,
    refundableAmount: Math.max(0, amountPaid - refundedAmount),
    currency: String(row.currency ?? "vnd").toUpperCase(),
    paymentStatus: String(row.payment_status ?? ""),
    bookingStatus: String(row.status ?? ""),
    stripeSessionId: String(row.stripe_session_id ?? "").trim() || null,
    stripePaymentIntentId: paymentIntentId || null,
    refundStatus: String(row.refund_status ?? "").trim() || null,
    refundedAt: formatDbDateTime(row.refunded_at),
    receiptCreated: Boolean(receiptEntry),
    receiptAmount: receiptEntry?.amountVnd ?? null,
    receiptCreatedAt: receiptEntry?.createdAt ?? null,
    createdAt: formatDbDateTime(row.created_at) ?? ""
  };
}

async function readStripeHostelBookingRows(limit = 500): Promise<HostelBookingRow[]> {
  return prisma.$queryRawUnsafe<HostelBookingRow[]>(
    `SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone,
            check_in, check_out, nights, total_amount, amount_paid, refunded_amount,
            currency, status, payment_status, notes, cancellation_policy,
            stripe_session_id, stripe_payment_intent_id, refund_status, refunded_at, created_at
     FROM \`${HOSTEL_BOOKING_TABLE}\`
     WHERE stripe_payment_intent_id IS NOT NULL
        OR (payment_status IN ('paid', 'partially_refunded', 'refunded') AND amount_paid > 0)
     ORDER BY created_at DESC
     LIMIT ?`,
    limit
  );
}

async function readStripeHostelBookingById(bookingId: string): Promise<HostelBookingRow | null> {
  const rows = await prisma.$queryRawUnsafe<HostelBookingRow[]>(
    `SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone,
            check_in, check_out, nights, total_amount, amount_paid, refunded_amount,
            currency, status, payment_status, notes, cancellation_policy,
            stripe_session_id, stripe_payment_intent_id, refund_status, refunded_at, created_at
     FROM \`${HOSTEL_BOOKING_TABLE}\`
     WHERE id = ?
     LIMIT 1`,
    bookingId
  );
  return rows[0] ?? null;
}

function buildReceiptDetails(input: {
  checkIn: string;
  checkOut: string;
  nights: number;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paymentAction?: string;
}): string {
  const parts = [
    `${input.checkIn} → ${input.checkOut}`,
    `${input.nights} night${input.nights === 1 ? "" : "s"}`
  ];
  if (input.paymentAction === "booking_adjustment") {
    parts.push("Booking adjustment payment");
  }
  if (input.stripePaymentIntentId) {
    parts.push(`Stripe PI: ${input.stripePaymentIntentId}`);
  }
  if (input.stripeSessionId) {
    parts.push(`Stripe session: ${input.stripeSessionId}`);
  }
  return parts.join(" | ");
}

export async function listStripeHostelPayments(): Promise<StripeHostelPaymentSummary[]> {
  const [rows, ledger] = await Promise.all([readStripeHostelBookingRows(), readReceiptLedger()]);
  return rows.map((row) => mapBookingRow(row, ledger));
}

export async function getStripeHostelPaymentDetail(bookingId: string): Promise<StripeHostelPaymentDetail | null> {
  const [row, ledger] = await Promise.all([readStripeHostelBookingById(bookingId), readReceiptLedger()]);
  if (!row) return null;

  const summary = mapBookingRow(row, ledger);
  const receipts = Object.values(ledger.byPaymentIntent).filter((entry) => entry.bookingId === bookingId);

  let stripeCharges: StripeHostelPaymentDetail["stripeCharges"] = [];
  let stripeRefunds: StripeHostelPaymentDetail["stripeRefunds"] = [];

  if (summary.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY?.trim()) {
    try {
      const stripe = getStripeClient();
      const paymentIntent = await stripe.paymentIntents.retrieve(summary.stripePaymentIntentId, {
        expand: ["latest_charge", "charges.data"]
      });
      const charges = paymentIntent.latest_charge
        ? [paymentIntent.latest_charge as Stripe.Charge]
        : [];

      stripeCharges = charges.map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        amountRefunded: charge.amount_refunded,
        currency: charge.currency.toUpperCase(),
        status: charge.status,
        createdAt: charge.created ? new Date(charge.created * 1000).toISOString() : null,
        receiptUrl: charge.receipt_url
      }));

      const refunds = await stripe.refunds.list({
        payment_intent: summary.stripePaymentIntentId,
        limit: 20
      });
      stripeRefunds = refunds.data.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency.toUpperCase(),
        status: refund.status ?? "pending",
        reason: refund.reason,
        createdAt: refund.created ? new Date(refund.created * 1000).toISOString() : null
      }));
    } catch {
      // Stripe enrichment is optional when keys are missing or PI is stale.
    }
  }

  return {
    ...summary,
    notes: String(row.notes ?? ""),
    cancellationPolicy: String(row.cancellation_policy ?? ""),
    stripeCharges,
    stripeRefunds,
    receipts
  };
}

export async function createHostelStripePaymentReceipt(input: {
  bookingId: string;
  guestEmail: string;
  guestName: string;
  branchId: string;
  bedNumber: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  amountVnd: number;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paymentAction?: "booking_create" | "booking_adjustment";
}): Promise<{ created: boolean; amountVnd: number; paymentIntentId: string }> {
  const amountVnd = Math.max(0, Math.trunc(input.amountVnd));
  const paymentIntentId = String(input.stripePaymentIntentId ?? "").trim();
  const sessionId = String(input.stripeSessionId ?? "").trim();

  if (!amountVnd) {
    throw new Error("Stripe payment amount must be greater than 0.");
  }
  if (!paymentIntentId && !sessionId) {
    throw new Error("Stripe payment intent or session id is required to create a receipt.");
  }

  const ledgerKey = paymentIntentId || `session:${sessionId}`;
  const ledger = await readReceiptLedger();
  const existing = ledger.byPaymentIntent[ledgerKey];
  if (existing) {
    return { created: false, amountVnd: existing.amountVnd, paymentIntentId: ledgerKey };
  }

  const contractCode = `SHORTTERM-${input.bookingId.trim()}`;
  const purpose =
    input.paymentAction === "booking_adjustment"
      ? STRIPE_HOSTEL_ADJUSTMENT_PURPOSE
      : STRIPE_HOSTEL_PAYMENT_PURPOSE;

  await managerCreatePaymentReceipt({
    maHd: contractCode,
    amount: amountVnd,
    purpose,
    details: buildReceiptDetails({
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      stripeSessionId: sessionId || undefined,
      stripePaymentIntentId: paymentIntentId || undefined,
      paymentAction: input.paymentAction
    }),
    payer: input.guestName.trim() || input.guestEmail.trim(),
    receiver: "Stripe",
    branch: input.branchId,
    recipientEmail: input.guestEmail.trim().toLowerCase()
  });

  const createdAt = new Date().toISOString();
  ledger.byPaymentIntent[ledgerKey] = {
    bookingId: input.bookingId.trim(),
    stripeSessionId: sessionId,
    stripePaymentIntentId: paymentIntentId,
    amountVnd,
    purpose,
    createdAt
  };
  await writeReceiptLedger(ledger);

  return { created: true, amountVnd, paymentIntentId: ledgerKey };
}

export async function createHostelStripePaymentReceiptFromBooking(bookingId: string): Promise<{
  created: boolean;
  amountVnd: number;
  paymentIntentId: string;
}> {
  const row = await readStripeHostelBookingById(bookingId);
  if (!row) {
    throw new Error("Stripe booking not found.");
  }

  const amountPaid = Number(row.amount_paid ?? 0) || 0;
  const paymentIntentId = String(row.stripe_payment_intent_id ?? "").trim();
  const sessionId = String(row.stripe_session_id ?? "").trim();
  if (!paymentIntentId && !sessionId) {
    throw new Error("This booking does not have a Stripe payment on record.");
  }

  return createHostelStripePaymentReceipt({
    bookingId,
    guestEmail: String(row.guest_email ?? ""),
    guestName: String(row.guest_name ?? ""),
    branchId: String(row.branch_id ?? "D7"),
    bedNumber: Number(row.bed_number ?? 0) || 0,
    checkIn: formatDbDate(row.check_in),
    checkOut: formatDbDate(row.check_out),
    nights: Number(row.nights ?? 0) || 0,
    amountVnd: amountPaid,
    stripeSessionId: sessionId || undefined,
    stripePaymentIntentId: paymentIntentId || undefined
  });
}

export async function refundStripeHostelPayment(input: {
  bookingId: string;
  amountVnd?: number;
  actorEmail: string;
}): Promise<{
  refundId: string;
  amountVnd: number;
  status: string;
  paymentStatus: string;
  refundedAmount: number;
  refundableAmount: number;
}> {
  const row = await readStripeHostelBookingById(input.bookingId);
  if (!row) {
    throw new Error("Stripe booking not found.");
  }

  const paymentIntentId = String(row.stripe_payment_intent_id ?? "").trim();
  if (!paymentIntentId) {
    throw new Error("Stripe payment intent was not found for this booking.");
  }

  const amountPaid = Number(row.amount_paid ?? 0) || 0;
  const refundedAmount = Number(row.refunded_amount ?? 0) || 0;
  const refundableAmount = Math.max(0, amountPaid - refundedAmount);
  if (!refundableAmount) {
    throw new Error("There is no refundable amount left on this booking.");
  }

  const requestedAmount =
    input.amountVnd === undefined ? refundableAmount : Math.max(0, Math.trunc(input.amountVnd));
  if (!requestedAmount) {
    throw new Error("Refund amount must be greater than 0.");
  }
  if (requestedAmount > refundableAmount) {
    throw new Error(`Refund amount cannot exceed ${refundableAmount.toLocaleString("vi-VN")} ₫.`);
  }

  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: requestedAmount,
    reason: "requested_by_customer",
    metadata: {
      bookingId: input.bookingId,
      actorEmail: input.actorEmail.trim().toLowerCase()
    }
  });

  const nextRefundedAmount = refundedAmount + requestedAmount;
  const paymentStatus =
    nextRefundedAmount >= amountPaid && amountPaid > 0
      ? "refunded"
      : nextRefundedAmount > 0
        ? "partially_refunded"
        : String(row.payment_status ?? "paid");

  await prisma.$executeRawUnsafe(
    `UPDATE \`${HOSTEL_BOOKING_TABLE}\`
     SET refunded_amount = ?,
         refund_status = ?,
         refunded_at = CURRENT_TIMESTAMP,
         payment_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    nextRefundedAmount,
    String(refund.status || "pending"),
    paymentStatus,
    input.bookingId
  );

  return {
    refundId: String(refund.id || ""),
    amountVnd: requestedAmount,
    status: String(refund.status || "pending"),
    paymentStatus,
    refundedAmount: nextRefundedAmount,
    refundableAmount: Math.max(0, amountPaid - nextRefundedAmount)
  };
}
