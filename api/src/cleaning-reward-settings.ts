import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CleaningTaskType } from "@prisma/client";

import { requirePortalRole } from "./staff-access.js";

const settingsFilePath = path.join(process.cwd(), "data", "cleaning-reward-settings.json");

export type CleaningRewardSettings = {
  baseRewards: Record<CleaningTaskType, number>;
  /** Applied when a resident self-assigns a slot (e.g. 1.2 = +20%). */
  selfAssignBonusMultiplier: number;
};

const DEFAULT_BASE_REWARDS: Record<CleaningTaskType, number> = {
  [CleaningTaskType.KITCHEN_D2]: 5000,
  [CleaningTaskType.TRASH_D7]: 5000,
  [CleaningTaskType.KITCHEN_D7]: 10000
};

const DEFAULT_SETTINGS: CleaningRewardSettings = {
  baseRewards: { ...DEFAULT_BASE_REWARDS },
  selfAssignBonusMultiplier: 1.2
};

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
  let mult =
    typeof partial.selfAssignBonusMultiplier === "number" && Number.isFinite(partial.selfAssignBonusMultiplier)
      ? partial.selfAssignBonusMultiplier
      : DEFAULT_SETTINGS.selfAssignBonusMultiplier;
  if (mult < 1 || mult > 3) {
    mult = DEFAULT_SETTINGS.selfAssignBonusMultiplier;
  }
  return { baseRewards, selfAssignBonusMultiplier: mult };
}

async function ensureCleaningRewardFile(): Promise<CleaningRewardSettings> {
  try {
    const raw = await readFile(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CleaningRewardSettings>;
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

export async function updateCleaningRewardSettings(
  actorEmail: string,
  input: {
    baseRewards?: Partial<Record<CleaningTaskType, number>>;
    selfAssignBonusMultiplier?: number;
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
      typeof input.selfAssignBonusMultiplier === "number" ? input.selfAssignBonusMultiplier : current.selfAssignBonusMultiplier
  });

  await writeFile(settingsFilePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
