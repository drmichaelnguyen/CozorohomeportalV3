import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requirePortalRole } from "./staff-access.js";

const dataDir = path.join(process.cwd(), "data");
const configFilePath = path.join(dataDir, "cleaning-auto-scheduler-config.json");

export type CleaningAutoSchedulerConfig = {
  enabled: boolean;
  fillUnassignedDates: boolean;
  horizonDays: number;
  updatedAt: string;
  updatedBy: string;
};

const DEFAULT_CONFIG: CleaningAutoSchedulerConfig = {
  enabled: process.env.ENABLE_AUTO_SCHEDULE !== "false",
  fillUnassignedDates: process.env.ENABLE_AUTO_SCHEDULE !== "false",
  horizonDays: Number(process.env.AUTO_SCHEDULE_HORIZON_DAYS ?? 15),
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system"
};

async function readConfig(): Promise<CleaningAutoSchedulerConfig> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(configFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CleaningAutoSchedulerConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      horizonDays: Math.max(1, Math.min(60, Number(parsed.horizonDays ?? DEFAULT_CONFIG.horizonDays) || DEFAULT_CONFIG.horizonDays))
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(config: CleaningAutoSchedulerConfig) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
}

export async function getCleaningAutoSchedulerConfig() {
  return readConfig();
}

export async function updateCleaningAutoSchedulerConfig(
  actorEmail: string,
  patch: Partial<Omit<CleaningAutoSchedulerConfig, "updatedAt" | "updatedBy">>
) {
  await requirePortalRole(
    actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers can update cleaning auto-scheduler settings."
  );

  const current = await readConfig();
  const next: CleaningAutoSchedulerConfig = {
    ...current,
    ...patch,
    horizonDays: Math.max(1, Math.min(60, Number(patch.horizonDays ?? current.horizonDays) || current.horizonDays)),
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail.trim().toLowerCase()
  };
  await writeConfig(next);
  return next;
}
