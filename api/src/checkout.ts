import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requirePortalRole } from "./staff-access.js";

const dataDir = path.join(process.cwd(), "data");
const terminationsFilePath = path.join(dataDir, "contract-terminations.json");
export const checkoutPhotosDirPath = path.join(dataDir, "checkout-photos");

export type CheckOutSteps = {
  luggage: boolean;
  bedding: boolean;
  keys: boolean;
  photoNote: string;
};

export type CheckOutRecord = {
  submittedAt: string;
  steps: CheckOutSteps;
  photos: string[]; // filenames in checkoutPhotosDirPath
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
  // Return the most recent non-completed-checkout termination
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

export async function submitCheckOut(input: {
  email: string;
  maHd: string;
  steps: CheckOutSteps;
  photos: string[];
}): Promise<ContractTermination> {
  const normalized = input.email.trim().toLowerCase();
  const file = await readFile_();
  const idx = file.terminations.findIndex(
    (t) => t.maHd === input.maHd && t.email === normalized
  );
  if (idx === -1) {
    throw new Error("No active contract termination found for this account.");
  }
  const record = file.terminations[idx];
  if (!record) {
    throw new Error("Termination record is missing.");
  }
  file.terminations[idx] = {
    ...record,
    checkOut: {
      submittedAt: new Date().toISOString(),
      steps: input.steps,
      photos: input.photos
    }
  };
  await writeFile_(file);
  return file.terminations[idx]!;
}

export async function ensureCheckoutPhotosDir() {
  await mkdir(checkoutPhotosDirPath, { recursive: true });
  return checkoutPhotosDirPath;
}
