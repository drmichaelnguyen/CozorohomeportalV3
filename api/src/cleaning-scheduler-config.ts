import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConfiguredCleaningCalendars } from "./google-sheets.js";
import { requirePortalRole } from "./staff-access.js";

const dataDir = path.join(process.cwd(), "data");
const configFilePath = path.join(dataDir, "cleaning-auto-scheduler-config.json");

export type CleaningAutoSchedulerJobConfig = {
  key: string;
  type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7";
  branchId: "D2" | "D7";
  floor: number | null;
  title: string;
  enabled: boolean;
  fillUnassignedDates: boolean;
  horizonDays: number;
  updatedAt: string;
  updatedBy: string;
};

export type CleaningAutoSchedulerConfig = {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  jobs: CleaningAutoSchedulerJobConfig[];
};

type StoredCleaningAutoSchedulerConfig = {
  enabled?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  jobs?: Array<Partial<CleaningAutoSchedulerJobConfig> & { key?: string }>;
};

const DEFAULT_ENABLED = process.env.ENABLE_AUTO_SCHEDULE !== "false";
const DEFAULT_HORIZON_DAYS = Number(process.env.AUTO_SCHEDULE_HORIZON_DAYS ?? 15);

function clampHorizonDays(value: unknown) {
  return Math.max(1, Math.min(60, Number(value) || DEFAULT_HORIZON_DAYS));
}

function getCleaningSchedulerJobKey(input: { type: "KITCHEN_D2" | "KITCHEN_D7" | "TRASH_D7"; floor?: number | null }) {
  return input.type === "TRASH_D7" ? `${input.type}:${input.floor ?? "none"}` : input.type;
}

function buildDefaultJobs() {
  return getConfiguredCleaningCalendars().map((definition) => ({
    key: getCleaningSchedulerJobKey({ type: definition.type, floor: definition.floor }),
    type: definition.type,
    branchId: definition.branchId,
    floor: definition.floor,
    title: definition.title,
    enabled: DEFAULT_ENABLED,
    fillUnassignedDates: DEFAULT_ENABLED,
    horizonDays: clampHorizonDays(DEFAULT_HORIZON_DAYS),
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system"
  })) satisfies CleaningAutoSchedulerJobConfig[];
}

async function readConfig(): Promise<CleaningAutoSchedulerConfig> {
  await mkdir(dataDir, { recursive: true });
  const defaultJobs = buildDefaultJobs();

  try {
    const raw = await readFile(configFilePath, "utf8");
    const parsed = JSON.parse(raw) as StoredCleaningAutoSchedulerConfig;
    const parsedJobsByKey = new Map((parsed.jobs ?? []).map((job) => [String(job.key ?? ""), job]));

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_ENABLED,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      updatedBy: parsed.updatedBy ?? "system",
      jobs: defaultJobs.map((job) => {
        const parsedJob = parsedJobsByKey.get(job.key);
        return {
          ...job,
          enabled: typeof parsedJob?.enabled === "boolean" ? parsedJob.enabled : job.enabled,
          fillUnassignedDates:
            typeof parsedJob?.fillUnassignedDates === "boolean" ? parsedJob.fillUnassignedDates : job.fillUnassignedDates,
          horizonDays: clampHorizonDays(parsedJob?.horizonDays ?? job.horizonDays),
          updatedAt: parsedJob?.updatedAt ?? parsed.updatedAt ?? job.updatedAt,
          updatedBy: parsedJob?.updatedBy ?? parsed.updatedBy ?? job.updatedBy
        };
      })
    };
  } catch {
    return {
      enabled: DEFAULT_ENABLED,
      updatedAt: new Date(0).toISOString(),
      updatedBy: "system",
      jobs: defaultJobs
    };
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
  patch: {
    enabled: boolean;
    jobs: Array<Pick<CleaningAutoSchedulerJobConfig, "key" | "enabled" | "fillUnassignedDates" | "horizonDays">>;
  }
) {
  await requirePortalRole(
    actorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers can update cleaning auto-scheduler settings."
  );

  const current = await readConfig();
  const patchByKey = new Map(patch.jobs.map((job) => [job.key, job]));
  const now = new Date().toISOString();
  const normalizedActorEmail = actorEmail.trim().toLowerCase();

  const next: CleaningAutoSchedulerConfig = {
    enabled: patch.enabled,
    updatedAt: now,
    updatedBy: normalizedActorEmail,
    jobs: current.jobs.map((job) => {
      const jobPatch = patchByKey.get(job.key);
      if (!jobPatch) {
        return job;
      }

      return {
        ...job,
        enabled: jobPatch.enabled,
        fillUnassignedDates: jobPatch.fillUnassignedDates,
        horizonDays: clampHorizonDays(jobPatch.horizonDays),
        updatedAt: now,
        updatedBy: normalizedActorEmail
      };
    })
  };

  await writeConfig(next);
  return next;
}
