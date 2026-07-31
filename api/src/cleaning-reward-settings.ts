import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CleaningTaskType } from "@prisma/client";

import { requirePortalRole } from "./staff-access.js";
import { isVietnamNationalHoliday, isWeekendCalendarDate } from "./vietnam-holidays.js";

const settingsFilePath = path.join(process.cwd(), "data", "cleaning-reward-settings.json");

export const SELF_ASSIGN_MAX_DAYS_AHEAD = 30;

export type CleaningRewardSettings = {
  baseRewards: Record<CleaningTaskType, number>;
  /** Weekday self-assign multiplier vs manager/system base (default 2 = x2). */
  selfAssignBonusMultiplier: number;
  /** Weekend self-assign multiplier (default 2.5). Takes precedence over weekday. */
  selfAssignWeekendMultiplier: number;
  /** Vietnam national holiday self-assign multiplier (default 3). Highest priority. */
  selfAssignHolidayMultiplier: number;
};

const DEFAULT_BASE_REWARDS: Record<CleaningTaskType, number> = {
  [CleaningTaskType.KITCHEN_D2]: 5000,
  [CleaningTaskType.TRASH_D7]: 5000,
  [CleaningTaskType.KITCHEN_D7]: 10000
};

const DEFAULT_SETTINGS: CleaningRewardSettings = {
  baseRewards: { ...DEFAULT_BASE_REWARDS },
  selfAssignBonusMultiplier: 2,
  selfAssignWeekendMultiplier: 2.5,
  selfAssignHolidayMultiplier: 3
};

function clampMultiplier(value: unknown, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  if (n < 1 || n > 5) return fallback;
  return Math.round(n * 100) / 100;
}

function mergeCleaningRewardSettings(partial: Partial<CleaningRewardSettings>): CleaningRewardSettings {
  const baseRewards = { ...DEFAULT_BASE_REWARDS, ...partial.baseRewards };
  for (const key of Object.keys(baseRewards) as CleaningTaskType[]) {
    const v = baseRewards[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 500_000) {
      baseRewards[key] = DEFAULT_BASE_REWARDS[key];
    } else {
      baseRewards[key] = Math.round(v);
    }
  }
  return {
    baseRewards,
    selfAssignBonusMultiplier: clampMultiplier(
      partial.selfAssignBonusMultiplier,
      DEFAULT_SETTINGS.selfAssignBonusMultiplier
    ),
    selfAssignWeekendMultiplier: clampMultiplier(
      partial.selfAssignWeekendMultiplier,
      DEFAULT_SETTINGS.selfAssignWeekendMultiplier
    ),
    selfAssignHolidayMultiplier: clampMultiplier(
      partial.selfAssignHolidayMultiplier,
      DEFAULT_SETTINGS.selfAssignHolidayMultiplier
    )
  };
}

async function ensureCleaningRewardFile(): Promise<CleaningRewardSettings> {
  try {
    const raw = await readFile(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CleaningRewardSettings> & {
      selfAssignWeekendMultiplier?: number;
      selfAssignHolidayMultiplier?: number;
    };
    // Migrate legacy single-multiplier files (old default 1.5) to the new tiered defaults.
    const hasWeekend = typeof parsed.selfAssignWeekendMultiplier === "number";
    const hasHoliday = typeof parsed.selfAssignHolidayMultiplier === "number";
    if (!hasWeekend || !hasHoliday) {
      const migrated = mergeCleaningRewardSettings({
        ...parsed,
        selfAssignBonusMultiplier:
          parsed.selfAssignBonusMultiplier === 1.5 || parsed.selfAssignBonusMultiplier == null
            ? DEFAULT_SETTINGS.selfAssignBonusMultiplier
            : parsed.selfAssignBonusMultiplier,
        selfAssignWeekendMultiplier: hasWeekend
          ? parsed.selfAssignWeekendMultiplier
          : DEFAULT_SETTINGS.selfAssignWeekendMultiplier,
        selfAssignHolidayMultiplier: hasHoliday
          ? parsed.selfAssignHolidayMultiplier
          : DEFAULT_SETTINGS.selfAssignHolidayMultiplier
      });
      await writeFile(settingsFilePath, JSON.stringify(migrated, null, 2), "utf8");
      return migrated;
    }
    return mergeCleaningRewardSettings(parsed);
  } catch {
    await mkdir(path.dirname(settingsFilePath), { recursive: true });
    await writeFile(settingsFilePath, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
    return { ...DEFAULT_SETTINGS, baseRewards: { ...DEFAULT_SETTINGS.baseRewards } };
  }
}

/** Loads persisted cleaning coin rewards (used by cleaning schedule logic). */
export async function getCleaningRewardSettings(): Promise<CleaningRewardSettings> {
  return ensureCleaningRewardFile();
}

export type SelfAssignRewardTier = "none" | "weekday" | "weekend" | "holiday";

export function resolveSelfAssignRewardMultiplier(
  settings: CleaningRewardSettings,
  scheduledDate: Date | string,
  isSelfAssigned: boolean
): { multiplier: number; tier: SelfAssignRewardTier } {
  if (!isSelfAssigned) {
    return { multiplier: 1, tier: "none" };
  }
  if (isVietnamNationalHoliday(scheduledDate)) {
    return { multiplier: settings.selfAssignHolidayMultiplier, tier: "holiday" };
  }
  if (isWeekendCalendarDate(scheduledDate)) {
    return { multiplier: settings.selfAssignWeekendMultiplier, tier: "weekend" };
  }
  return { multiplier: settings.selfAssignBonusMultiplier, tier: "weekday" };
}

export function computeCleaningRewardCoins(
  settings: CleaningRewardSettings,
  type: CleaningTaskType,
  scheduledDate: Date | string,
  isSelfAssigned: boolean
): { rewardCoins: number; multiplier: number; tier: SelfAssignRewardTier } {
  const base = settings.baseRewards[type];
  const { multiplier, tier } = resolveSelfAssignRewardMultiplier(settings, scheduledDate, isSelfAssigned);
  return {
    rewardCoins: Math.round(base * multiplier),
    multiplier,
    tier
  };
}

export async function updateCleaningRewardSettings(
  actorEmail: string,
  input: {
    baseRewards?: Partial<Record<CleaningTaskType, number>>;
    selfAssignBonusMultiplier?: number;
    selfAssignWeekendMultiplier?: number;
    selfAssignHolidayMultiplier?: number;
  }
): Promise<CleaningRewardSettings> {
  await requirePortalRole(
    actorEmail.trim(),
    ["manager", "owner", "app_admin"],
    "Only managers or owners can update cleaning rewards."
  );

  const current = await getCleaningRewardSettings();
  const next = mergeCleaningRewardSettings({
    baseRewards: { ...current.baseRewards, ...input.baseRewards },
    selfAssignBonusMultiplier:
      typeof input.selfAssignBonusMultiplier === "number"
        ? input.selfAssignBonusMultiplier
        : current.selfAssignBonusMultiplier,
    selfAssignWeekendMultiplier:
      typeof input.selfAssignWeekendMultiplier === "number"
        ? input.selfAssignWeekendMultiplier
        : current.selfAssignWeekendMultiplier,
    selfAssignHolidayMultiplier:
      typeof input.selfAssignHolidayMultiplier === "number"
        ? input.selfAssignHolidayMultiplier
        : current.selfAssignHolidayMultiplier
  });

  await writeFile(settingsFilePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
