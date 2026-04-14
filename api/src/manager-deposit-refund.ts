import {
  ACTIVE_STAYING_COLUMN,
  CLIENT_CONTRACT_END_COLUMN,
  CLIENT_NAME_COLUMN,
  CONTRACT_CODE_COLUMN,
  getFineAmountVndFromEntry,
  getFinesForEmail,
  readCachedClients,
  sendGmailReceipt,
  type ClientRow
} from "./google-sheets.js";
import {
  CONTRACT_DUE_CHECKOUT_WINDOW_DAYS,
  daysUntilContractEnd,
  getTerminationByMaHd
} from "./checkout.js";
import { sumAllUnpaidGateParkingVndForEmail } from "./gate-parking-tickets.js";
import { requirePortalRole } from "./staff-access.js";

function parseMoneyVnd(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getClientRowByMaHd(maHd: string): Promise<ClientRow | null> {
  const cache = await readCachedClients();
  const row = cache?.rows.find((r) => String(r[CONTRACT_CODE_COLUMN] ?? "").trim() === maHd.trim());
  return (row as ClientRow) ?? null;
}

export type DepositRefundEligibilityReason = "inactive" | "terminated" | "contract_due";

export async function resolveDepositRefundEligibilityAsync(client: ClientRow): Promise<{
  eligible: boolean;
  reason?: DepositRefundEligibilityReason;
}> {
  const active = String(client[ACTIVE_STAYING_COLUMN] ?? "").trim();
  if (active !== "1") {
    return { eligible: true, reason: "inactive" };
  }
  const maHd = String(client[CONTRACT_CODE_COLUMN] ?? "").trim();
  if (maHd) {
    const term = await getTerminationByMaHd(maHd);
    if (term) {
      return { eligible: true, reason: "terminated" };
    }
  }
  const days = daysUntilContractEnd(String(client[CLIENT_CONTRACT_END_COLUMN] ?? ""));
  if (days !== null && days <= CONTRACT_DUE_CHECKOUT_WINDOW_DAYS) {
    return { eligible: true, reason: "contract_due" };
  }
  return { eligible: false };
}

export async function managerGetDepositRefundPreview(input: { actorEmail: string; maHd: string }) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const row = await getClientRowByMaHd(input.maHd);
  if (!row) {
    return { error: "Client row not found for this contract." };
  }
  const elig = await resolveDepositRefundEligibilityAsync(row);
  if (!elig.eligible) {
    return { error: "Deposit refund notice is only available for inactive residents, terminated contracts, or contracts due within 7 days." };
  }
  const email = normalizeEmail(String(row["Địa chỉ email"] ?? row.EMAIL ?? ""));
  if (!email) {
    return { error: "Client email is missing." };
  }
  const depositVnd = parseMoneyVnd(row["Số tiền cọc"]);
  const finesEntries = await getFinesForEmail(email);
  const unpaidFinesVnd = finesEntries
    .filter((e) => !e.coinPayment.isPaid)
    .reduce((sum, e) => sum + getFineAmountVndFromEntry(e), 0);
  const unpaidGateVnd = await sumAllUnpaidGateParkingVndForEmail(email);
  const suggestedRefundVnd = Math.max(0, depositVnd - unpaidFinesVnd - unpaidGateVnd);
  const name = String(row[CLIENT_NAME_COLUMN] ?? "").trim() || email;
  return {
    eligibilityReason: elig.reason,
    clientEmail: email,
    clientName: name,
    maHd: input.maHd.trim(),
    depositVnd,
    unpaidFinesVnd,
    unpaidGateVnd,
    suggestedRefundVnd
  };
}

function buildDepositRefundEmailBodies(input: {
  clientName: string;
  refundAmountVnd: number;
}): { subject: string; body: string } {
  const amountVi = `${input.refundAmountVnd.toLocaleString("vi-VN")} VNĐ`;
  const amountEn = `${input.refundAmountVnd.toLocaleString("en-US")} VND`;
  const subject = "Cozoro Home — Thông báo hoàn cọc / Deposit refund notice";

  const vi = [
    `Cozoro thân chào quý khách ${input.clientName},`,
    "",
    "Thời gian vừa qua, quý khách đã có thời gian lưu trú tại một trong những chi nhánh của Cozoro Home và hôm nay Cozoro rất tiếc khi phải nói lời chia tay với quý khách.",
    "",
    "Cozoro xin trân trọng thông báo số tiền hoàn lại cho quý khách gồm có:",
    `Tiền cọc: ${amountVi}`,
    "",
    "Khi nhận được email này, xin quý khách hãy xác nhận đúng thông tin và gửi thông tin tài khoản ngân hàng (tên chủ tài khoản, số tài khoản, tên ngân hàng) để Cozoro hoàn tất thủ tục hoàn cọc bạn nhé.",
    "Sau khi Cozoro nhận được email phản hồi từ quý khách, Cozoro sẽ xử lý hoàn cọc trong vòng 5–10 ngày làm việc.",
    "Nếu có phát sinh chi phí và thay đổi hóa đơn hoàn chúng tôi sẽ thông báo đến quý khách.",
    "",
    "Xin chân thành cảm ơn quý khách vì thời gian qua bạn đã tin tưởng Cozoro Home.",
    "Cozoro rất mong sẽ gặp lại quý khách trong tương lai.",
    "",
    "Trân trọng,",
    "BQT COZOROHOME"
  ].join("\n");

  const en = [
    `Dear ${input.clientName},`,
    "",
    "Thank you for staying with Cozoro Home. We are sorry to say goodbye today.",
    "",
    "We are pleased to inform you of the following refund amount:",
    `Deposit refund: ${amountEn}`,
    "",
    "When you receive this email, please confirm the details are correct and reply with your bank information (account holder name, account number, bank name) so we can complete your deposit refund.",
    "After we receive your reply, we will process the refund within 5–10 business days.",
    "If any additional charges apply and the final refund changes, we will notify you.",
    "",
    "Thank you for trusting Cozoro Home. We hope to welcome you again in the future.",
    "",
    "Sincerely,",
    "Cozoro Home Management"
  ].join("\n");

  const body = `${vi}\n\n---------- ENGLISH ----------\n\n${en}`;
  return { subject, body };
}

export async function managerSendDepositRefundEmail(input: {
  actorEmail: string;
  maHd: string;
  refundAmountVnd: number;
}) {
  await requirePortalRole(normalizeEmail(input.actorEmail), ["manager", "owner", "app_admin"], "Staff only.");
  const refund = Math.round(Number(input.refundAmountVnd));
  if (!Number.isFinite(refund) || refund < 0) {
    return { error: "refundAmountVnd must be a non-negative number." };
  }
  const row = await getClientRowByMaHd(input.maHd);
  if (!row) {
    return { error: "Client row not found for this contract." };
  }
  const elig = await resolveDepositRefundEligibilityAsync(row);
  if (!elig.eligible) {
    return { error: "This client is not eligible for a deposit refund notice at this time." };
  }
  const depositVnd = parseMoneyVnd(row["Số tiền cọc"]);
  if (refund > depositVnd) {
    return { error: "Refund amount cannot exceed the deposit on file." };
  }
  const email = normalizeEmail(String(row["Địa chỉ email"] ?? row.EMAIL ?? ""));
  if (!email) {
    return { error: "Client email is missing." };
  }
  const name = String(row[CLIENT_NAME_COLUMN] ?? "").trim() || email;
  const { subject, body } = buildDepositRefundEmailBodies({ clientName: name, refundAmountVnd: refund });
  await sendGmailReceipt({ to: email, subject, body });
  return { ok: true, sentTo: email };
}
