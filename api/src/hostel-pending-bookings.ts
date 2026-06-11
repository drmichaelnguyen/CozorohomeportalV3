import { readFile, writeFile } from "fs/promises";
import path from "path";
import { ACTIVE_STAYING_COLUMN, updateClientColumns } from "./google-sheets.js";
import { prisma } from "./prisma.js";
import { refundStripeHostelPayment } from "./stripe-hostel-payments.js";

const HOSTEL_BOOKING_TABLE = process.env.HOSTEL_BOOKING_TABLE ?? "guest_stay_bookings";
const HOSTEL_ARCHIVED_IDS_PATH =
  process.env.HOSTEL_ARCHIVED_IDS_PATH ?? path.join(process.cwd(), "data", "hostel-archived-ids.json");

type HostelBookingRow = Record<string, unknown>;

export type HostelPendingDisposition = {
  bookingId: string;
  action: "archive" | "reject";
  actorEmail: string;
  reason?: string;
};

async function readArchivedIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(HOSTEL_ARCHIVED_IDS_PATH, "utf8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function getHostelArchivedIds(): Promise<Set<string>> {
  return readArchivedIds();
}

async function addArchivedId(id: string): Promise<void> {
  const ids = await readArchivedIds();
  ids.add(id);
  await writeFile(HOSTEL_ARCHIVED_IDS_PATH, JSON.stringify([...ids], null, 2), "utf8");
}

async function readHostelBookingRow(bookingId: string): Promise<HostelBookingRow | null> {
  const rows = await prisma.$queryRawUnsafe<HostelBookingRow[]>(
    `SELECT id, guest_name, guest_email, status, payment_status, amount_paid, refunded_amount,
            stripe_payment_intent_id
     FROM \`${HOSTEL_BOOKING_TABLE}\`
     WHERE id = ?
     LIMIT 1`,
    bookingId
  );
  return rows[0] ?? null;
}

async function deactivateShortTermClient(bookingId: string, actorEmail: string): Promise<void> {
  const contractCode = `SHORTTERM-${bookingId.trim()}`;
  try {
    await updateClientColumns(contractCode, {
      [ACTIVE_STAYING_COLUMN]: "-1",
      "Chú thích": `Rejected by ${actorEmail.trim()} from manager pending queue`
    });
  } catch {
    // Client row may not exist yet for unpaid bookings.
  }
}

export async function archiveHostelPendingBooking(input: HostelPendingDisposition): Promise<{ ok: true }> {
  const bookingId = input.bookingId.trim();
  if (!bookingId) {
    throw new Error("Booking id is required.");
  }

  const row = await readHostelBookingRow(bookingId);
  if (!row) {
    throw new Error("Booking not found.");
  }

  const status = String(row.status ?? "").trim().toUpperCase();
  if (status === "CANCELLED" || status === "CANCELED") {
    throw new Error("This booking is already cancelled.");
  }

  await addArchivedId(bookingId);
  return { ok: true };
}

export async function rejectHostelPendingBooking(input: HostelPendingDisposition): Promise<{
  ok: true;
  refund?: {
    refundId: string;
    amountVnd: number;
    status: string;
  };
}> {
  const bookingId = input.bookingId.trim();
  if (!bookingId) {
    throw new Error("Booking id is required.");
  }

  const row = await readHostelBookingRow(bookingId);
  if (!row) {
    throw new Error("Booking not found.");
  }

  const status = String(row.status ?? "").trim().toUpperCase();
  if (status === "CANCELLED" || status === "CANCELED") {
    throw new Error("This booking is already cancelled.");
  }

  const paymentStatus = String(row.payment_status ?? "").trim().toLowerCase();
  const amountPaid = Number(row.amount_paid ?? 0) || 0;
  const refundedAmount = Number(row.refunded_amount ?? 0) || 0;
  const refundableAmount = Math.max(0, amountPaid - refundedAmount);
  const stripePaymentIntentId = String(row.stripe_payment_intent_id ?? "").trim();

  let refundResult:
    | {
        refundId: string;
        amountVnd: number;
        status: string;
      }
    | undefined;

  if (stripePaymentIntentId && refundableAmount > 0 && (paymentStatus === "paid" || paymentStatus.includes("refund"))) {
    const refund = await refundStripeHostelPayment({
      bookingId,
      amountVnd: refundableAmount,
      actorEmail: input.actorEmail
    });
    refundResult = {
      refundId: refund.refundId,
      amountVnd: refund.amountVnd,
      status: refund.status
    };
  }

  const nextPaymentStatus =
    refundResult && refundResult.amountVnd >= refundableAmount && amountPaid > 0
      ? "refunded"
      : refundResult && refundResult.amountVnd > 0
        ? "partially_refunded"
        : amountPaid > 0
          ? "cancelled_no_refund"
          : "cancelled";

  await prisma.$executeRawUnsafe(
    `UPDATE \`${HOSTEL_BOOKING_TABLE}\`
     SET status = 'CANCELLED',
         payment_status = ?,
         cancelled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    nextPaymentStatus,
    bookingId
  );

  await deactivateShortTermClient(bookingId, input.actorEmail);
  await addArchivedId(bookingId);

  return {
    ok: true,
    refund: refundResult
  };
}
