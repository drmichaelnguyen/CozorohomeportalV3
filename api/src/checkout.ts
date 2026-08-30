import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ACTIVE_STAYING_COLUMN,
  CLIENT_BED_COLUMN,
  CLIENT_BRANCH_COLUMN,
  CLIENT_CONTRACT_END_COLUMN,
  CLIENT_NAME_COLUMN,
  CONTRACT_CODE_COLUMN,
  getActiveClientByEmail,
  listCheckoutSheetRows,
  sendGmailReceipt,
  updateClientColumns
} from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";

const dataDir = path.join(process.cwd(), "data");
const terminationsFilePath = path.join(dataDir, "contract-terminations.json");
const contractDueCheckoutFilePath = path.join(dataDir, "contract-due-checkouts.json");
export const checkoutPhotosDirPath = path.join(dataDir, "checkout-photos");

/** Days until contract end (negative = expired). */
export function daysUntilContractEnd(endDateStr: string | undefined): number | null {
  const trimmed = String(endDateStr ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  let end: Date;
  if (match) {
    const [, d, m, yRaw] = match;
    const y = Number(yRaw) < 100 ? 2000 + Number(yRaw) : Number(yRaw);
    end = new Date(y, Number(m) - 1, Number(d), 23, 59, 59, 999);
  } else {
    end = new Date(trimmed);
  }
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function normalizeBranchLabel(raw: string): string {
  const n = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (n === "7" || n === "D7" || n.includes("D7")) return "D7";
  return "D2";
}

export type CheckOutSteps = {
  luggage: boolean;
  bedding: boolean;
  keys: boolean;
  photoNote: string;
  /** Optional photos per step (1–3); keys "1","2","3" */
  optionalStepPhotos?: Record<string, string[]>;
};

export type CheckOutRecord = {
  submittedAt: string;
  deactivateAt: string;
  deactivatedAt?: string;
  steps: CheckOutSteps;
  photos: string[];
  source?: CheckoutSource;
  reviewStatus?: CheckoutReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  refundAmountVnd?: number;
  refundEmailSentAt?: string;
  refundEmailSentTo?: string;
  awaitingRedo?: boolean;
  compensationAmountVnd?: number;
  reviewNotices?: CheckoutReviewNotice[];
  revisionNumber?: number;
};

export type CheckoutSource = "termination" | "contract_due" | "resident";
export type CheckoutReviewStatus = "pending" | "archived";
export type CheckoutReviewNoticeAction = "redo_checkout" | "compensation";

export type CheckoutReviewNotice = {
  action: CheckoutReviewNoticeAction;
  message: string;
  compensationAmountVnd?: number;
  sentAt: string;
  sentBy: string;
  emailSentTo: string;
};

export type ContractTermination = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  terminatedAt: string;
  terminatedBy: string;
  depositNote: string;
  checkOut: CheckOutRecord | null;
};

type TerminationsFile = {
  terminations: ContractTermination[];
};

type ContractDueCheckoutFile = {
  completions: Array<{
    email: string;
    maHd: string;
    name?: string;
    branch?: string;
    bed?: string;
    submittedAt: string;
    deactivateAt?: string;
    deactivatedAt?: string;
    source?: Exclude<CheckoutSource, "termination">;
    steps?: CheckOutSteps;
    photos?: string[];
    reviewStatus?: CheckoutReviewStatus;
    reviewedAt?: string;
    reviewedBy?: string;
    refundAmountVnd?: number;
    refundEmailSentAt?: string;
    refundEmailSentTo?: string;
    awaitingRedo?: boolean;
    compensationAmountVnd?: number;
    reviewNotices?: CheckoutReviewNotice[];
    revisionNumber?: number;
  }>;
};

export type CheckoutReviewCase = {
  id: string;
  status: CheckoutReviewStatus;
  source: CheckoutSource;
  email: string;
  maHd: string;
  name: string;
  branch: string;
  bed: string;
  submittedAt: string;
  deactivateAt: string;
  deactivatedAt?: string;
  steps: CheckOutSteps;
  detailsAvailable: boolean;
  photos: string[];
  reviewedAt?: string;
  reviewedBy?: string;
  refundAmountVnd?: number;
  refundEmailSentAt?: string;
  refundEmailSentTo?: string;
  awaitingRedo: boolean;
  compensationAmountVnd: number;
  reviewNotices: CheckoutReviewNotice[];
  revisionNumber: number;
};

export const CHECKOUT_DEACTIVATION_DELAY_DAYS = 10;
const CHECKOUT_DEACTIVATION_DELAY_MS = CHECKOUT_DEACTIVATION_DELAY_DAYS * 24 * 60 * 60 * 1000;

function getCheckoutDeactivateAt(submittedAt: string): string {
  return new Date(new Date(submittedAt).getTime() + CHECKOUT_DEACTIVATION_DELAY_MS).toISOString();
}

async function readFile_(): Promise<TerminationsFile> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(terminationsFilePath, "utf8");
    return JSON.parse(raw) as TerminationsFile;
  } catch {
    return { terminations: [] };
  }
}

async function writeFile_(data: TerminationsFile) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(terminationsFilePath, JSON.stringify(data, null, 2), "utf8");
}

async function readContractDueCompletions(): Promise<ContractDueCheckoutFile> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(contractDueCheckoutFilePath, "utf8");
    return JSON.parse(raw) as ContractDueCheckoutFile;
  } catch {
    return { completions: [] };
  }
}

async function writeContractDueCompletions(data: ContractDueCheckoutFile) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(contractDueCheckoutFilePath, JSON.stringify(data, null, 2), "utf8");
}

function terminationCheckoutReviewId(maHd: string) {
  return `termination:${maHd.trim()}`;
}

function completionCheckoutReviewId(maHd: string, submittedAt: string) {
  return `completion:${maHd.trim()}:${submittedAt}`;
}

function emptyCheckoutSteps(): CheckOutSteps {
  return {
    luggage: false,
    bedding: false,
    keys: false,
    photoNote: "",
    optionalStepPhotos: {}
  };
}

function parseCheckoutSheetProcess(value: string): { steps: CheckOutSteps; photos: string[] } | null {
  try {
    const parsed = JSON.parse(value) as {
      luggage?: boolean;
      bedding?: boolean;
      keys?: boolean;
      photoNote?: string;
      optionalStepPhotos?: Record<string, string[]>;
      finalPhotos?: string[];
    };
    return {
      steps: {
        luggage: Boolean(parsed.luggage),
        bedding: Boolean(parsed.bedding),
        keys: Boolean(parsed.keys),
        photoNote: String(parsed.photoNote ?? ""),
        optionalStepPhotos: parsed.optionalStepPhotos ?? {}
      },
      photos: Array.isArray(parsed.finalPhotos) ? parsed.finalPhotos.map(String) : []
    };
  } catch {
    return null;
  }
}

export async function listCheckoutReviewCases(actorEmail: string): Promise<CheckoutReviewCase[]> {
  await requirePortalRole(
    actorEmail.trim().toLowerCase(),
    ["manager", "owner", "app_admin"],
    "Staff only."
  );
  const [terminationsFile, dueFile, checkoutSheetRows, checkoutPhotoFiles] = await Promise.all([
    readFile_(),
    readContractDueCompletions(),
    listCheckoutSheetRows().catch(() => []),
    readdir(checkoutPhotosDirPath).catch(() => [])
  ]);
  const cases: CheckoutReviewCase[] = [];

  for (const termination of terminationsFile.terminations) {
    const checkout = termination.checkOut;
    if (!checkout) continue;
    cases.push({
      id: terminationCheckoutReviewId(termination.maHd),
      status: checkout.reviewStatus ?? "pending",
      source: "termination",
      email: termination.email,
      maHd: termination.maHd,
      name: termination.name,
      branch: termination.branch,
      bed: termination.bed,
      submittedAt: checkout.submittedAt,
      deactivateAt: checkout.deactivateAt ?? getCheckoutDeactivateAt(checkout.submittedAt),
      deactivatedAt: checkout.deactivatedAt,
      steps: checkout.steps ?? emptyCheckoutSteps(),
      detailsAvailable: Boolean(checkout.steps),
      photos: checkout.photos ?? [],
      reviewedAt: checkout.reviewedAt,
      reviewedBy: checkout.reviewedBy,
      refundAmountVnd: checkout.refundAmountVnd,
      refundEmailSentAt: checkout.refundEmailSentAt,
      refundEmailSentTo: checkout.refundEmailSentTo,
      awaitingRedo: Boolean(checkout.awaitingRedo),
      compensationAmountVnd: Math.max(0, checkout.compensationAmountVnd ?? 0),
      reviewNotices: checkout.reviewNotices ?? [],
      revisionNumber: Math.max(1, checkout.revisionNumber ?? 1)
    });
  }

  for (const completion of dueFile.completions) {
    const sheetRow = [...checkoutSheetRows].reverse().find(
      (row) =>
        row.email.trim().toLowerCase() === completion.email.trim().toLowerCase() &&
        row.maHd.trim() === completion.maHd.trim()
    );
    const sheetProcess = sheetRow?.quyTrinh ? parseCheckoutSheetProcess(sheetRow.quyTrinh) : null;
    const sourceValue = completion.source ?? sheetRow?.source;
    const source = sourceValue === "contract_due" ? "contract_due" : "resident";
    const fallbackPhotos = String(sheetRow?.photosLocalPaths ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const safeMaHd = completion.maHd.replace(/[^a-zA-Z0-9-]/g, "_");
    const diskPhotos = checkoutPhotoFiles.filter((fileName) => fileName.startsWith(`checkout-${safeMaHd}`));
    const diskOptionalPhotos: Record<string, string[]> = {};
    const diskFinalPhotos: string[] = [];
    for (const fileName of diskPhotos) {
      const stepMatch = fileName.match(/-step([1-3])-/);
      if (stepMatch?.[1]) {
        diskOptionalPhotos[stepMatch[1]] = [...(diskOptionalPhotos[stepMatch[1]] ?? []), fileName];
      } else {
        diskFinalPhotos.push(fileName);
      }
    }
    const storedSteps = completion.steps ?? sheetProcess?.steps;
    cases.push({
      id: completionCheckoutReviewId(completion.maHd, completion.submittedAt),
      status: completion.reviewStatus ?? "pending",
      source,
      email: completion.email,
      maHd: completion.maHd,
      name: completion.name?.trim() || sheetRow?.name?.trim() || sheetRow?.user?.trim() || completion.email,
      branch: completion.branch?.trim() || sheetRow?.branch?.trim() || "",
      bed: completion.bed?.trim() || sheetRow?.bed?.trim() || "",
      submittedAt: completion.submittedAt,
      deactivateAt: completion.deactivateAt ?? getCheckoutDeactivateAt(completion.submittedAt),
      deactivatedAt: completion.deactivatedAt,
      steps: storedSteps ?? {
        ...emptyCheckoutSteps(),
        optionalStepPhotos: diskOptionalPhotos
      },
      detailsAvailable: Boolean(storedSteps),
      photos: completion.photos ?? sheetProcess?.photos ?? (fallbackPhotos.length > 0 ? fallbackPhotos : diskFinalPhotos),
      reviewedAt: completion.reviewedAt,
      reviewedBy: completion.reviewedBy,
      refundAmountVnd: completion.refundAmountVnd,
      refundEmailSentAt: completion.refundEmailSentAt,
      refundEmailSentTo: completion.refundEmailSentTo,
      awaitingRedo: Boolean(completion.awaitingRedo),
      compensationAmountVnd: Math.max(0, completion.compensationAmountVnd ?? 0),
      reviewNotices: completion.reviewNotices ?? [],
      revisionNumber: Math.max(1, completion.revisionNumber ?? 1)
    });
  }

  return cases.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

export async function getCheckoutReviewCase(actorEmail: string, id: string) {
  const cases = await listCheckoutReviewCases(actorEmail);
  return cases.find((entry) => entry.id === id) ?? null;
}

function checkoutReviewNoticeEmail(input: {
  checkoutCase: CheckoutReviewCase;
  action: CheckoutReviewNoticeAction;
  message: string;
  compensationAmountVnd: number;
}) {
  const isRedo = input.action === "redo_checkout";
  const amountVi = `${input.compensationAmountVnd.toLocaleString("vi-VN")} VNĐ`;
  const amountEn = `${input.compensationAmountVnd.toLocaleString("en-US")} VND`;
  const subject = isRedo
    ? "Cozoro Home — Yêu cầu thực hiện lại check-out / Check-out redo required"
    : "Cozoro Home — Thông báo bồi thường check-out / Check-out compensation notice";
  const vi = [
    `Cozoro thân chào quý khách ${input.checkoutCase.name || input.checkoutCase.email},`,
    "",
    isRedo
      ? "Sau khi kiểm tra hồ sơ check-out, Cozoro cần quý khách thực hiện lại quy trình check-out. Biểu mẫu đã được mở lại trên cổng cư dân."
      : `Sau khi kiểm tra tình trạng phòng/giường, Cozoro ghi nhận tổn thất hoặc chi phí cần bồi thường dự kiến: ${amountVi}. Khoản này có thể được khấu trừ khi đối soát hoàn cọc.`,
    "",
    "Nội dung từ quản lý:",
    input.message,
    "",
    isRedo
      ? "Vui lòng đăng nhập cổng cư dân, mở mục Check-out và gửi lại đầy đủ thông tin cùng hình ảnh mới. Hồ sơ sẽ tiếp tục ở trạng thái chờ duyệt cho đến khi Cozoro kiểm tra lại."
      : "Nếu cần trao đổi hoặc bổ sung bằng chứng, vui lòng phản hồi email này hoặc liên hệ quản lý. Hồ sơ vẫn đang chờ duyệt và số tiền hoàn cọc cuối cùng chưa được xác nhận.",
    "",
    "Trân trọng,",
    "BQT COZOROHOME"
  ].join("\n");
  const en = [
    `Dear ${input.checkoutCase.name || input.checkoutCase.email},`,
    "",
    isRedo
      ? "After reviewing your check-out submission, Cozoro needs you to complete the check-out process again. The form has been reopened in the resident portal."
      : `After inspecting the room/bed condition, Cozoro identified a possible loss or cost with proposed compensation of ${amountEn}. This amount may be deducted during the deposit-refund review.`,
    "",
    "Management findings:",
    input.message,
    "",
    isRedo
      ? "Please sign in to the resident portal, open Check-out, and resubmit the complete information with new photos. The case will remain pending until Cozoro reviews it again."
      : "To discuss the finding or provide supporting information, reply to this email or contact management. The case remains pending and the final deposit refund has not yet been approved.",
    "",
    "Sincerely,",
    "Cozoro Home Management"
  ].join("\n");
  return { subject, body: `${vi}\n\n---------- ENGLISH ----------\n\n${en}` };
}

export async function sendCheckoutReviewNotice(input: {
  actorEmail: string;
  id: string;
  action: CheckoutReviewNoticeAction;
  message: string;
  compensationAmountVnd?: number;
}): Promise<{ record: CheckoutReviewCase; emailSentTo: string }> {
  const reviewer = input.actorEmail.trim().toLowerCase();
  await requirePortalRole(reviewer, ["owner", "app_admin"], "Only owners can send check-out review notices.");
  const checkoutCase = await getCheckoutReviewCase(reviewer, input.id);
  if (!checkoutCase) throw new Error("Check-out case not found.");
  if (checkoutCase.status !== "pending") throw new Error("Archived check-out cases cannot receive a review notice.");

  const message = input.message.trim();
  if (!message) throw new Error("Owner findings are required.");
  const compensationAmountVnd = Math.max(0, Math.round(input.compensationAmountVnd ?? 0));
  if (input.action === "compensation" && compensationAmountVnd <= 0) {
    throw new Error("A positive compensation amount is required.");
  }
  const sentAt = new Date().toISOString();
  const emailSentTo = checkoutCase.email.trim().toLowerCase();
  const email = checkoutReviewNoticeEmail({ checkoutCase, action: input.action, message, compensationAmountVnd });
  await sendGmailReceipt({ to: emailSentTo, subject: email.subject, body: email.body });

  const notice: CheckoutReviewNotice = {
    action: input.action,
    message,
    ...(input.action === "compensation" ? { compensationAmountVnd } : {}),
    sentAt,
    sentBy: reviewer,
    emailSentTo
  };
  if (input.id.startsWith("termination:")) {
    const file = await readFile_();
    const termination = file.terminations.find((entry) => terminationCheckoutReviewId(entry.maHd) === input.id);
    if (!termination?.checkOut) throw new Error("Check-out case not found after email delivery.");
    termination.checkOut.reviewNotices = [...(termination.checkOut.reviewNotices ?? []), notice];
    if (input.action === "redo_checkout") termination.checkOut.awaitingRedo = true;
    if (input.action === "compensation") termination.checkOut.compensationAmountVnd = compensationAmountVnd;
    await writeFile_(file);
  } else if (input.id.startsWith("completion:")) {
    const file = await readContractDueCompletions();
    const completion = file.completions.find(
      (entry) => completionCheckoutReviewId(entry.maHd, entry.submittedAt) === input.id
    );
    if (!completion) throw new Error("Check-out case not found after email delivery.");
    completion.reviewNotices = [...(completion.reviewNotices ?? []), notice];
    if (input.action === "redo_checkout") completion.awaitingRedo = true;
    if (input.action === "compensation") completion.compensationAmountVnd = compensationAmountVnd;
    await writeContractDueCompletions(file);
  } else {
    throw new Error("Invalid check-out case id.");
  }

  const record = await getCheckoutReviewCase(reviewer, input.id);
  if (!record) throw new Error("Updated check-out case could not be reloaded.");
  return { record, emailSentTo };
}

export async function archiveCheckoutReviewCase(input: {
  actorEmail: string;
  id: string;
  refundAmountVnd: number;
  refundEmailSentTo: string;
}): Promise<CheckoutReviewCase> {
  const reviewer = input.actorEmail.trim().toLowerCase();
  await requirePortalRole(reviewer, ["owner", "app_admin"], "Only owners can approve check-out cases.");
  const reviewedAt = new Date().toISOString();

  if (input.id.startsWith("termination:")) {
    const file = await readFile_();
    const termination = file.terminations.find(
      (entry) => terminationCheckoutReviewId(entry.maHd) === input.id
    );
    if (!termination?.checkOut) {
      throw new Error("Check-out case not found.");
    }
    if (termination.checkOut.awaitingRedo) {
      throw new Error("This check-out must be resubmitted before it can be approved.");
    }
    termination.checkOut.reviewStatus = "archived";
    termination.checkOut.reviewedAt = reviewedAt;
    termination.checkOut.reviewedBy = reviewer;
    termination.checkOut.refundAmountVnd = Math.max(0, Math.round(input.refundAmountVnd));
    termination.checkOut.refundEmailSentAt = reviewedAt;
    termination.checkOut.refundEmailSentTo = input.refundEmailSentTo.trim().toLowerCase();
    await writeFile_(file);
  } else if (input.id.startsWith("completion:")) {
    const file = await readContractDueCompletions();
    const completion = file.completions.find(
      (entry) => completionCheckoutReviewId(entry.maHd, entry.submittedAt) === input.id
    );
    if (!completion) {
      throw new Error("Check-out case not found.");
    }
    if (completion.awaitingRedo) {
      throw new Error("This check-out must be resubmitted before it can be approved.");
    }
    completion.reviewStatus = "archived";
    completion.reviewedAt = reviewedAt;
    completion.reviewedBy = reviewer;
    completion.refundAmountVnd = Math.max(0, Math.round(input.refundAmountVnd));
    completion.refundEmailSentAt = reviewedAt;
    completion.refundEmailSentTo = input.refundEmailSentTo.trim().toLowerCase();
    await writeContractDueCompletions(file);
  } else {
    throw new Error("Invalid check-out case id.");
  }

  const archived = await getCheckoutReviewCase(reviewer, input.id);
  if (!archived) {
    throw new Error("Archived check-out case could not be reloaded.");
  }
  return archived;
}

export async function terminateContract(input: {
  actorEmail: string;
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  depositNote?: string;
}): Promise<ContractTermination> {
  await requirePortalRole(input.actorEmail, ["manager", "owner", "app_admin"], "Only managers can terminate contracts.");
  const file = await readFile_();
  const existing = file.terminations.find((t) => t.maHd === input.maHd);
  if (existing) {
    return existing;
  }
  const record: ContractTermination = {
    maHd: input.maHd,
    email: input.email.trim().toLowerCase(),
    name: input.name,
    branch: input.branch,
    bed: input.bed,
    terminatedAt: new Date().toISOString(),
    terminatedBy: input.actorEmail.trim().toLowerCase(),
    depositNote: input.depositNote?.trim() ?? "",
    checkOut: null
  };
  file.terminations.push(record);
  await writeFile_(file);
  return record;
}

export async function getTerminationByEmail(email: string): Promise<ContractTermination | null> {
  const normalized = email.trim().toLowerCase();
  const file = await readFile_();
  return (
    file.terminations
      .filter((t) => t.email === normalized)
      .sort((a, b) => new Date(b.terminatedAt).getTime() - new Date(a.terminatedAt).getTime())[0] ?? null
  );
}

export async function getTerminationByMaHd(maHd: string): Promise<ContractTermination | null> {
  const file = await readFile_();
  return file.terminations.find((t) => t.maHd === maHd) ?? null;
}

/** True when the resident has confirmed departure via the checkout form. */
export async function hasCompletedCheckout(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const termination = await getTerminationByEmail(normalized);
  if (termination?.checkOut) return true;

  const dueFile = await readContractDueCompletions();
  return dueFile.completions.some((entry) => entry.email.trim().toLowerCase() === normalized);
}

export async function hasCompletedCheckoutForContract(email: string, maHd: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const contractCode = maHd.trim();
  if (!normalized || !contractCode) return false;

  const termination = await getTerminationByMaHd(contractCode);
  if (termination?.email.trim().toLowerCase() === normalized && termination.checkOut) return true;

  const dueFile = await readContractDueCompletions();
  return dueFile.completions.some(
    (entry) => entry.email.trim().toLowerCase() === normalized && entry.maHd.trim() === contractCode
  );
}

/** Emails that have completed checkout (confirmed left) — used to stop cleaning schedules. */
export async function listCheckedOutEmails(): Promise<Set<string>> {
  const file = await readFile_();
  const emails = new Set<string>();
  for (const termination of file.terminations) {
    if (termination.checkOut) {
      const email = termination.email.trim().toLowerCase();
      if (email) emails.add(email);
    }
  }
  const dueFile = await readContractDueCompletions();
  for (const entry of dueFile.completions) {
    const email = entry.email.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

export async function assertResidentServiceBookingAllowed(email: string): Promise<void> {
  if (await hasCompletedCheckout(email)) {
    throw new Error(
      "Service booking is disabled because check-out has been completed. Your account remains available for records and support until automatic deactivation."
    );
  }
}

export async function sweepCheckoutAccountDeactivations(now = new Date()): Promise<{
  checked: number;
  deactivated: number;
  failed: Array<{ email: string; maHd: string; error: string }>;
}> {
  const nowMs = now.getTime();
  const terminationsFile = await readFile_();
  const dueFile = await readContractDueCompletions();
  const failed: Array<{ email: string; maHd: string; error: string }> = [];
  let checked = 0;
  let deactivated = 0;
  let terminationsChanged = false;
  let dueChanged = false;

  async function deactivate(input: {
    email: string;
    maHd: string;
    submittedAt: string;
    deactivateAt?: string;
  }): Promise<string | null> {
    checked += 1;
    const deactivateAt = input.deactivateAt ?? getCheckoutDeactivateAt(input.submittedAt);
    const deactivateMs = new Date(deactivateAt).getTime();
    if (!Number.isFinite(deactivateMs) || deactivateMs > nowMs) {
      return null;
    }

    try {
      await updateClientColumns(input.maHd, { [ACTIVE_STAYING_COLUMN]: "-1" });
      deactivated += 1;
      return now.toISOString();
    } catch (error) {
      failed.push({
        email: input.email,
        maHd: input.maHd,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  for (const termination of terminationsFile.terminations) {
    const checkout = termination.checkOut;
    if (!checkout || checkout.deactivatedAt || checkout.awaitingRedo) continue;
    const deactivatedAt = await deactivate({
      email: termination.email,
      maHd: termination.maHd,
      submittedAt: checkout.submittedAt,
      deactivateAt: checkout.deactivateAt
    });
    if (deactivatedAt) {
      checkout.deactivateAt = checkout.deactivateAt ?? getCheckoutDeactivateAt(checkout.submittedAt);
      checkout.deactivatedAt = deactivatedAt;
      terminationsChanged = true;
    }
  }

  for (const completion of dueFile.completions) {
    if (completion.deactivatedAt || completion.awaitingRedo) continue;
    const deactivatedAt = await deactivate(completion);
    if (deactivatedAt) {
      completion.deactivateAt = completion.deactivateAt ?? getCheckoutDeactivateAt(completion.submittedAt);
      completion.deactivatedAt = deactivatedAt;
      dueChanged = true;
    }
  }

  if (terminationsChanged) await writeFile_(terminationsFile);
  if (dueChanged) await writeContractDueCompletions(dueFile);

  return { checked, deactivated, failed };
}

export type CheckoutContext = {
  eligible: boolean;
  reason?: string;
  kind?: CheckoutSource;
  maHd?: string;
  name?: string;
  branch?: string;
  bed?: string;
  depositNote?: string;
  contractEndRaw?: string;
  daysUntilContractEnd?: number | null;
  completed?: boolean;
  submittedAt?: string;
  deactivateAt?: string;
  deactivatedAt?: string;
  redoRequested?: boolean;
  redoMessage?: string;
  redoRequestedAt?: string;
};

export const CONTRACT_DUE_CHECKOUT_WINDOW_DAYS = 7;

export async function getCheckoutContext(email: string): Promise<CheckoutContext> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { eligible: false, reason: "missing_email" };
  }

  const termination = await getTerminationByEmail(normalized);
  if (termination) {
    if (termination.checkOut) {
      const latestRedoNotice = [...(termination.checkOut.reviewNotices ?? [])]
        .reverse()
        .find((notice) => notice.action === "redo_checkout");
      return {
        eligible: true,
        kind: "termination",
        maHd: termination.maHd,
        name: termination.name,
        branch: termination.branch,
        bed: termination.bed,
        depositNote: termination.depositNote,
        completed: !termination.checkOut.awaitingRedo,
        submittedAt: termination.checkOut.submittedAt,
        deactivateAt:
          termination.checkOut.deactivateAt ?? getCheckoutDeactivateAt(termination.checkOut.submittedAt),
        deactivatedAt: termination.checkOut.deactivatedAt,
        redoRequested: Boolean(termination.checkOut.awaitingRedo),
        redoMessage: termination.checkOut.awaitingRedo ? latestRedoNotice?.message : undefined,
        redoRequestedAt: termination.checkOut.awaitingRedo ? latestRedoNotice?.sentAt : undefined
      };
    }
    return {
      eligible: true,
      kind: "termination",
      maHd: termination.maHd,
      name: termination.name,
      branch: termination.branch,
      bed: termination.bed,
      depositNote: termination.depositNote,
      completed: false
    };
  }

  const client = await getActiveClientByEmail(normalized);
  if (!client) {
    return { eligible: false, reason: "no_client" };
  }
  const active = String(client[ACTIVE_STAYING_COLUMN] ?? "").trim();
  if (active === "-1") {
    return { eligible: false, reason: "not_active_stay" };
  }

  const maHd = String(client[CONTRACT_CODE_COLUMN] ?? "").trim();
  if (!maHd) {
    return { eligible: false, reason: "no_mahd" };
  }

  const dueFile = await readContractDueCompletions();
  const already = dueFile.completions.find((c) => c.email === normalized && c.maHd === maHd);
  if (already) {
    const latestRedoNotice = [...(already.reviewNotices ?? [])]
      .reverse()
      .find((notice) => notice.action === "redo_checkout");
    return {
      eligible: true,
      kind: already.source ?? "contract_due",
      maHd,
      name: String(client[CLIENT_NAME_COLUMN] ?? "").trim(),
      branch: normalizeBranchLabel(String(client[CLIENT_BRANCH_COLUMN] ?? "")),
      bed: String(client[CLIENT_BED_COLUMN] ?? "").trim(),
      contractEndRaw: String(client[CLIENT_CONTRACT_END_COLUMN] ?? "").trim(),
      completed: !already.awaitingRedo,
      submittedAt: already.submittedAt,
      deactivateAt: already.deactivateAt ?? getCheckoutDeactivateAt(already.submittedAt),
      deactivatedAt: already.deactivatedAt,
      redoRequested: Boolean(already.awaitingRedo),
      redoMessage: already.awaitingRedo ? latestRedoNotice?.message : undefined,
      redoRequestedAt: already.awaitingRedo ? latestRedoNotice?.sentAt : undefined
    };
  }

  const endRaw = String(client[CLIENT_CONTRACT_END_COLUMN] ?? "").trim();
  const days = daysUntilContractEnd(endRaw);

  return {
    eligible: true,
    kind: "resident",
    maHd,
    name: String(client[CLIENT_NAME_COLUMN] ?? "").trim(),
    branch: normalizeBranchLabel(String(client[CLIENT_BRANCH_COLUMN] ?? "")),
    bed: String(client[CLIENT_BED_COLUMN] ?? "").trim(),
    contractEndRaw: endRaw,
    daysUntilContractEnd: days,
    completed: false
  };
}

export async function verifyCheckoutPhotoAccess(email: string, maHd: string): Promise<boolean> {
  const ctx = await getCheckoutContext(email);
  if (!ctx.eligible || ctx.completed || !ctx.maHd) {
    return false;
  }
  return ctx.maHd === maHd.trim();
}

export async function submitCheckOut(input: {
  email: string;
  maHd: string;
  steps: CheckOutSteps;
  photos: string[];
  source?: CheckoutSource;
}): Promise<CheckOutRecord> {
  const normalized = input.email.trim().toLowerCase();
  const source = input.source ?? "termination";
  const submittedAt = new Date().toISOString();
  const record: CheckOutRecord = {
    submittedAt,
    deactivateAt: getCheckoutDeactivateAt(submittedAt),
    steps: input.steps,
    photos: input.photos,
    source,
    reviewStatus: "pending",
    revisionNumber: 1
  };

  if (source === "termination") {
    const file = await readFile_();
    const idx = file.terminations.findIndex((t) => t.maHd === input.maHd && t.email === normalized);
    if (idx === -1) {
      throw new Error("No active contract termination found for this account.");
    }
    const row = file.terminations[idx];
    if (!row) {
      throw new Error("Termination record is missing.");
    }
    const previous = row.checkOut;
    if (previous && !previous.awaitingRedo) {
      throw new Error("Check-out was already submitted for this contract.");
    }
    if (previous?.awaitingRedo) {
      record.reviewNotices = previous.reviewNotices ?? [];
      record.compensationAmountVnd = previous.compensationAmountVnd;
      record.revisionNumber = Math.max(1, previous.revisionNumber ?? 1) + 1;
      record.awaitingRedo = false;
    }
    file.terminations[idx] = {
      ...row,
      checkOut: record
    };
    await writeFile_(file);
    return record;
  }

  const client = await getActiveClientByEmail(normalized);
  if (!client || String(client[CONTRACT_CODE_COLUMN] ?? "").trim() !== input.maHd.trim()) {
    throw new Error("Contract does not match this account.");
  }
  if (String(client[ACTIVE_STAYING_COLUMN] ?? "").trim() === "-1") {
    throw new Error("Check-out is only available for active stays.");
  }
  const dueFile = await readContractDueCompletions();
  const existingIndex = dueFile.completions.findIndex(
    (c) => c.email === normalized && c.maHd === input.maHd.trim()
  );
  const existing = existingIndex >= 0 ? dueFile.completions[existingIndex] : undefined;
  if (existing && !existing.awaitingRedo) {
    throw new Error("Check-out was already submitted for this contract.");
  }
  const nextCompletion: ContractDueCheckoutFile["completions"][number] = {
    email: normalized,
    maHd: input.maHd.trim(),
    name: String(client[CLIENT_NAME_COLUMN] ?? "").trim(),
    branch: normalizeBranchLabel(String(client[CLIENT_BRANCH_COLUMN] ?? "")),
    bed: String(client[CLIENT_BED_COLUMN] ?? "").trim(),
    submittedAt: record.submittedAt,
    deactivateAt: record.deactivateAt,
    source: source === "resident" ? "resident" : "contract_due",
    steps: input.steps,
    photos: input.photos,
    reviewStatus: "pending",
    awaitingRedo: false,
    compensationAmountVnd: existing?.compensationAmountVnd,
    reviewNotices: existing?.reviewNotices ?? [],
    revisionNumber: existing ? Math.max(1, existing.revisionNumber ?? 1) + 1 : 1
  };
  if (existingIndex >= 0) {
    dueFile.completions[existingIndex] = nextCompletion;
  } else {
    dueFile.completions.push(nextCompletion);
  }
  await writeContractDueCompletions(dueFile);
  return record;
}

export async function ensureCheckoutPhotosDir() {
  await mkdir(checkoutPhotosDirPath, { recursive: true });
  return checkoutPhotosDirPath;
}
