import {
  ACTIVE_STAYING_COLUMN,
  CLIENT_CONTRACT_END_COLUMN,
  CLIENT_NAME_COLUMN,
  CONTRACT_CODE_COLUMN,
  EMAIL_COLUMN,
  getFineAmountVndFromEntry,
  getFinesForEmail,
  readCachedPayments,
  readCachedClients,
  sendGmailReceipt,
  type ClientRow
} from "./google-sheets.js";
import {
  CONTRACT_DUE_CHECKOUT_WINDOW_DAYS,
  daysUntilContractEnd,
  getTerminationByMaHd
} from "./checkout.js";
import { listUnpaidGateParkingTicketsForEmail } from "./gate-parking-tickets.js";
import { requirePortalRole } from "./staff-access.js";

const FINE_CONTENT_COLUMN = "NỘI DUNG VI PHẠM";

function parseMoneyVnd(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeContractCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function contractDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function formatVndVi(amountVnd: number) {
  return `${amountVnd.toLocaleString("vi-VN")} VNĐ`;
}

function formatVndEn(amountVnd: number) {
  return `${amountVnd.toLocaleString("en-US")} VND`;
}

function formatDeductionVi(amountVnd: number) {
  return `−${formatVndVi(amountVnd)}`;
}

function formatDeductionEn(amountVnd: number) {
  return `−${formatVndEn(amountVnd)}`;
}

export type DepositRefundDeductionLine = {
  labelVi: string;
  labelEn: string;
  amountVnd: number;
};

export type DepositRefundBreakdown = {
  depositVnd: number;
  unpaidFinesVnd: number;
  unpaidGateVnd: number;
  otherDeductionsVnd: number;
  refundAmountVnd: number;
  unpaidFineLines: DepositRefundDeductionLine[];
  unpaidGateLines: DepositRefundDeductionLine[];
};

async function getClientRowByMaHd(maHd: string): Promise<ClientRow | null> {
  const cache = await readCachedClients();
  const rows = cache?.rows ?? [];
  const wanted = normalizeContractCode(maHd);
  const wantedDigits = contractDigits(maHd);

  const exact =
    rows.find((r) => normalizeContractCode(r[CONTRACT_CODE_COLUMN]) === wanted) ??
    rows.find((r) => {
      const digits = contractDigits(r[CONTRACT_CODE_COLUMN]);
      return Boolean(wantedDigits) && digits === wantedDigits;
    });
  if (exact) return exact as ClientRow;

  // Fallback for historical contracts no longer present as a standalone row:
  // use termination record email and resolve the latest available client row.
  let email = "";
  const term = await getTerminationByMaHd(maHd.trim());
  if (term?.email) {
    email = normalizeEmail(term.email);
  }
  if (!email) {
    const paymentsCache = await readCachedPayments();
    const paymentMatch = (paymentsCache?.rows ?? []).find((row) => {
      const contract = normalizeContractCode(row[CONTRACT_CODE_COLUMN]);
      const digits = contractDigits(row[CONTRACT_CODE_COLUMN]);
      return contract === wanted || (Boolean(wantedDigits) && digits === wantedDigits);
    });
    if (paymentMatch) {
      email = normalizeEmail(String(paymentMatch[EMAIL_COLUMN] ?? paymentMatch["Địa chỉ email"] ?? ""));
    }
  }
  if (!email) return null;
  const sameEmailRows = rows.filter(
    (r) => normalizeEmail(String(r[EMAIL_COLUMN] ?? r["Địa chỉ email"] ?? "")) === email
  );
  if (sameEmailRows.length === 0) return null;
  return sameEmailRows[sameEmailRows.length - 1] as ClientRow;
}

export async function buildDepositRefundBreakdown(
  row: ClientRow,
  refundAmountVnd: number
): Promise<DepositRefundBreakdown> {
  const email = normalizeEmail(String(row["Địa chỉ email"] ?? row.EMAIL ?? ""));
  const depositVnd = parseMoneyVnd(row["Số tiền cọc"]);
  const refund = Math.max(0, Math.round(refundAmountVnd));

  const finesEntries = await getFinesForEmail(email);
  const unpaidFineEntries = finesEntries.filter((entry) => !entry.coinPayment.isPaid);
  const unpaidFineLines: DepositRefundDeductionLine[] = unpaidFineEntries.map((entry) => {
    const amountVnd = getFineAmountVndFromEntry(entry);
    const content = String(entry.row[FINE_CONTENT_COLUMN] ?? "").trim() || "Phạt / Fine";
    return {
      labelVi: content,
      labelEn: content,
      amountVnd
    };
  });
  const unpaidFinesVnd = unpaidFineLines.reduce((sum, line) => sum + line.amountVnd, 0);

  const gateTickets = await listUnpaidGateParkingTicketsForEmail(email);
  const unpaidGateLines: DepositRefundDeductionLine[] = gateTickets.map((ticket) => {
    const period = String(ticket.periodMonth ?? "").trim();
    const note = String(ticket.note ?? "").trim();
    const detail = note ? ` — ${note}` : "";
    return {
      labelVi: period ? `Vé cổng tháng ${period}${detail}` : `Vé cổng${detail}`,
      labelEn: period ? `Gate ticket ${period}${detail}` : `Gate ticket${detail}`,
      amountVnd: ticket.amountVnd
    };
  });
  const unpaidGateVnd = unpaidGateLines.reduce((sum, line) => sum + line.amountVnd, 0);

  const otherDeductionsVnd = Math.max(0, depositVnd - unpaidFinesVnd - unpaidGateVnd - refund);

  return {
    depositVnd,
    unpaidFinesVnd,
    unpaidGateVnd,
    otherDeductionsVnd,
    refundAmountVnd: refund,
    unpaidFineLines,
    unpaidGateLines
  };
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
  const breakdown = await buildDepositRefundBreakdown(row, 0);
  const suggestedRefundVnd = Math.max(
    0,
    breakdown.depositVnd - breakdown.unpaidFinesVnd - breakdown.unpaidGateVnd
  );
  const name = String(row[CLIENT_NAME_COLUMN] ?? "").trim() || email;
  return {
    eligibilityReason: elig.reason,
    clientEmail: email,
    clientName: name,
    maHd: input.maHd.trim(),
    depositVnd: breakdown.depositVnd,
    unpaidFinesVnd: breakdown.unpaidFinesVnd,
    unpaidGateVnd: breakdown.unpaidGateVnd,
    suggestedRefundVnd
  };
}

function buildDepositRefundBreakdownLines(
  breakdown: DepositRefundBreakdown,
  locale: "vi" | "en"
): string[] {
  const lines: string[] = [];
  const isVi = locale === "vi";
  const formatAmount = isVi ? formatVndVi : formatVndEn;
  const formatDeduction = isVi ? formatDeductionVi : formatDeductionEn;
  const formatDetail = (label: string, amountVnd: number) =>
    `  · ${label}: ${formatDeduction(amountVnd)}`;

  lines.push(isVi ? "Chi tiết hoàn cọc:" : "Deposit refund breakdown:");
  lines.push(
    isVi
      ? `• Tiền cọc: ${formatAmount(breakdown.depositVnd)}`
      : `• Deposit on file: ${formatAmount(breakdown.depositVnd)}`
  );

  const hasDeductions =
    breakdown.unpaidFinesVnd > 0 ||
    breakdown.unpaidGateVnd > 0 ||
    breakdown.otherDeductionsVnd > 0;

  if (hasDeductions) {
    lines.push(isVi ? "• Các khoản khấu trừ:" : "• Deductions:");
  }

  if (breakdown.unpaidFinesVnd > 0) {
    lines.push(
      isVi
        ? `  - Phạt chưa thanh toán: ${formatDeduction(breakdown.unpaidFinesVnd)}`
        : `  - Unpaid fines: ${formatDeduction(breakdown.unpaidFinesVnd)}`
    );
    for (const line of breakdown.unpaidFineLines) {
      lines.push(formatDetail(isVi ? line.labelVi : line.labelEn, line.amountVnd));
    }
  }

  if (breakdown.unpaidGateVnd > 0) {
    lines.push(
      isVi
        ? `  - Vé gửi xe cổng chưa thanh toán: ${formatDeduction(breakdown.unpaidGateVnd)}`
        : `  - Unpaid gate parking tickets: ${formatDeduction(breakdown.unpaidGateVnd)}`
    );
    for (const line of breakdown.unpaidGateLines) {
      lines.push(formatDetail(isVi ? line.labelVi : line.labelEn, line.amountVnd));
    }
  }

  if (breakdown.otherDeductionsVnd > 0) {
    lines.push(
      isVi
        ? `  - Khấu trừ khác: ${formatDeduction(breakdown.otherDeductionsVnd)}`
        : `  - Other deductions: ${formatDeduction(breakdown.otherDeductionsVnd)}`
    );
  }

  lines.push(
    isVi
      ? `• Số tiền hoàn lại: ${formatAmount(breakdown.refundAmountVnd)}`
      : `• Refund amount: ${formatAmount(breakdown.refundAmountVnd)}`
  );

  return lines;
}

function buildDepositRefundEmailBodies(input: {
  clientName: string;
  breakdown: DepositRefundBreakdown;
}): { subject: string; body: string } {
  const subject = "Cozoro Home — Thông báo hoàn cọc / Deposit refund notice";

  const vi = [
    `Cozoro thân chào quý khách ${input.clientName},`,
    "",
    "Thời gian vừa qua, quý khách đã có thời gian lưu trú tại một trong những chi nhánh của Cozoro Home và hôm nay Cozoro rất tiếc khi phải nói lời chia tay với quý khách.",
    "",
    "Cozoro xin trân trọng thông báo chi tiết hoàn cọc như sau:",
    ...buildDepositRefundBreakdownLines(input.breakdown, "vi"),
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
    "Please find your deposit refund breakdown below:",
    ...buildDepositRefundBreakdownLines(input.breakdown, "en"),
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
  const breakdown = await buildDepositRefundBreakdown(row, refund);
  const { subject, body } = buildDepositRefundEmailBodies({ clientName: name, breakdown });
  await sendGmailReceipt({ to: email, subject, body });
  return { ok: true, sentTo: email };
}
