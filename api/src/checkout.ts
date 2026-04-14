import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ACTIVE_STAYING_COLUMN,
  CLIENT_BED_COLUMN,
  CLIENT_BRANCH_COLUMN,
  CLIENT_CONTRACT_END_COLUMN,
  CLIENT_NAME_COLUMN,
  CONTRACT_CODE_COLUMN,
  getActiveClientByEmail
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
  steps: CheckOutSteps;
  photos: string[];
  source?: "termination" | "contract_due";
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
  completions: Array<{ email: string; maHd: string; submittedAt: string }>;
};

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

export type CheckoutContext = {
  eligible: boolean;
  reason?: string;
  kind?: "termination" | "contract_due";
  maHd?: string;
  name?: string;
  branch?: string;
  bed?: string;
  depositNote?: string;
  contractEndRaw?: string;
  daysUntilContractEnd?: number | null;
  completed?: boolean;
  submittedAt?: string;
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
      return {
        eligible: true,
        kind: "termination",
        maHd: termination.maHd,
        name: termination.name,
        branch: termination.branch,
        bed: termination.bed,
        depositNote: termination.depositNote,
        completed: true,
        submittedAt: termination.checkOut.submittedAt
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
  if (active !== "1") {
    return { eligible: false, reason: "not_active_stay" };
  }

  const maHd = String(client[CONTRACT_CODE_COLUMN] ?? "").trim();
  if (!maHd) {
    return { eligible: false, reason: "no_mahd" };
  }

  const dueFile = await readContractDueCompletions();
  const already = dueFile.completions.find((c) => c.email === normalized && c.maHd === maHd);
  if (already) {
    return {
      eligible: true,
      kind: "contract_due",
      maHd,
      name: String(client[CLIENT_NAME_COLUMN] ?? "").trim(),
      branch: normalizeBranchLabel(String(client[CLIENT_BRANCH_COLUMN] ?? "")),
      bed: String(client[CLIENT_BED_COLUMN] ?? "").trim(),
      contractEndRaw: String(client[CLIENT_CONTRACT_END_COLUMN] ?? "").trim(),
      completed: true,
      submittedAt: already.submittedAt
    };
  }

  const endRaw = String(client[CLIENT_CONTRACT_END_COLUMN] ?? "").trim();
  const days = daysUntilContractEnd(endRaw);
  if (days === null) {
    return { eligible: false, reason: "no_contract_end" };
  }
  if (days > CONTRACT_DUE_CHECKOUT_WINDOW_DAYS) {
    return { eligible: false, reason: "contract_not_due_yet", daysUntilContractEnd: days };
  }

  return {
    eligible: true,
    kind: "contract_due",
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
  source?: "termination" | "contract_due";
}): Promise<CheckOutRecord> {
  const normalized = input.email.trim().toLowerCase();
  const source = input.source ?? "termination";
  const record: CheckOutRecord = {
    submittedAt: new Date().toISOString(),
    steps: input.steps,
    photos: input.photos,
    source
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
  if (String(client[ACTIVE_STAYING_COLUMN] ?? "").trim() !== "1") {
    throw new Error("Check-out is only available for active stays.");
  }
  const days = daysUntilContractEnd(String(client[CLIENT_CONTRACT_END_COLUMN] ?? ""));
  if (days === null || days > CONTRACT_DUE_CHECKOUT_WINDOW_DAYS) {
    throw new Error("Check-out is only available when your contract is due (within 7 days of end date).");
  }
  const dueFile = await readContractDueCompletions();
  if (dueFile.completions.some((c) => c.email === normalized && c.maHd === input.maHd.trim())) {
    throw new Error("Check-out was already submitted for this contract.");
  }
  dueFile.completions.push({
    email: normalized,
    maHd: input.maHd.trim(),
    submittedAt: record.submittedAt
  });
  await writeContractDueCompletions(dueFile);
  return record;
}

export async function ensureCheckoutPhotosDir() {
  await mkdir(checkoutPhotosDirPath, { recursive: true });
  return checkoutPhotosDirPath;
}
