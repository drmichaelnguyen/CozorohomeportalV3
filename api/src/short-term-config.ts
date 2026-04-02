import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requirePortalRole } from "./staff-access.js";

const dataDir = path.join(process.cwd(), "data");
const configFilePath = path.join(dataDir, "short-term-config.json");

export type BedPricing = Record<string, Record<string, number>>; // branch -> bed -> nightly VND

export type DiscountRule = {
  enabled: boolean;
  minNights: number;
  percent: number; // 0–100
};

export type ShortTermConfig = {
  bedPricing: BedPricing;
  discounts: {
    weekly: DiscountRule;
    monthly: DiscountRule;
  };
  minimumStay: number; // nights
  updatedAt: string;
  updatedBy: string;
};

const DEFAULT_CONFIG: ShortTermConfig = {
  bedPricing: {},
  discounts: {
    weekly:  { enabled: false, minNights: 7,  percent: 10 },
    monthly: { enabled: false, minNights: 30, percent: 20 }
  },
  minimumStay: 1,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system"
};

async function readConfig(): Promise<ShortTermConfig> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(configFilePath, "utf8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ShortTermConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(config: ShortTermConfig) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
}

export async function getShortTermConfig(): Promise<ShortTermConfig> {
  return readConfig();
}

export async function updateShortTermConfig(
  actorEmail: string,
  patch: Partial<Omit<ShortTermConfig, "updatedAt" | "updatedBy">>
): Promise<ShortTermConfig> {
  await requirePortalRole(actorEmail, ["manager", "owner", "app_admin"], "Only managers can update short-term config.");
  const current = await readConfig();
  const next: ShortTermConfig = {
    ...current,
    ...patch,
    discounts: { ...current.discounts, ...(patch.discounts ?? {}) },
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail.trim().toLowerCase()
  };
  await writeConfig(next);
  return next;
}
