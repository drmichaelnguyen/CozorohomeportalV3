import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CleaningTaskStatus, CoinReason } from "@prisma/client";

import { CONTRACT_CODE_COLUMN, getActiveClientByEmail, managerAdjustCoins } from "./google-sheets.js";
import { prisma } from "./prisma.js";

const ledgerFilePath = path.join(process.cwd(), "data", "cleaning-hero-awards.json");

export type CleaningHeroPeriodType = "month" | "quarter" | "year";

export type CleaningHeroAward = {
  id: string;
  periodType: CleaningHeroPeriodType;
  periodKey: string;
  userEmail: string;
  userName: string | null;
  completedCount: number;
  coinsAwarded: number;
  title: string;
  titleVi: string;
  awardedAt: string;
};

type HeroAwardLedger = {
  awards: CleaningHeroAward[];
};

const HERO_REWARDS: Record<CleaningHeroPeriodType, number> = {
  month: 30_000,
  quarter: 50_000,
  year: 100_000
};

const HERO_TITLES: Record<CleaningHeroPeriodType, { en: string; vi: string }> = {
  month: { en: "Cozoro Hero of the Month", vi: "Anh hùng Cozoro của tháng" },
  quarter: { en: "Cozoro Hero of the Quarter", vi: "Anh hùng Cozoro của quý" },
  year: { en: "Cozoro Hero of the Year", vi: "Anh hùng Cozoro của năm" }
};

async function readLedger(): Promise<HeroAwardLedger> {
  try {
    const raw = await readFile(ledgerFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HeroAwardLedger> | null;
    return { awards: Array.isArray(parsed?.awards) ? parsed.awards : [] };
  } catch {
    return { awards: [] };
  }
}

async function writeLedger(ledger: HeroAwardLedger) {
  await mkdir(path.dirname(ledgerFilePath), { recursive: true });
  await writeFile(ledgerFilePath, JSON.stringify(ledger, null, 2), "utf8");
}

function periodBounds(periodType: CleaningHeroPeriodType, periodKey: string): { from: Date; to: Date } {
  if (periodType === "month") {
    const [y, m] = periodKey.split("-").map((v) => Number.parseInt(v, 10));
    return {
      from: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)),
      to: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
    };
  }
  if (periodType === "quarter") {
    const match = periodKey.match(/^(\d{4})-Q([1-4])$/);
    if (!match) throw new Error(`Invalid quarter key: ${periodKey}`);
    const year = Number.parseInt(match[1], 10);
    const quarter = Number.parseInt(match[2], 10);
    const startMonth = (quarter - 1) * 3;
    return {
      from: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
      to: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999))
    };
  }
  const year = Number.parseInt(periodKey, 10);
  return {
    from: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
  };
}

function previousMonthKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousQuarterKey(now: Date): string {
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  let year = now.getUTCFullYear();
  let quarter = currentQuarter - 1;
  if (quarter < 1) {
    quarter = 4;
    year -= 1;
  }
  return `${year}-Q${quarter}`;
}

function previousYearKey(now: Date): string {
  return String(now.getUTCFullYear() - 1);
}

/** Avoid granting very old catch-up awards on first deploy of this feature. */
function isPeriodRecentlyClosed(periodType: CleaningHeroPeriodType, periodKey: string, now: Date): boolean {
  const { to } = periodBounds(periodType, periodKey);
  const daysSinceEnd = (now.getTime() - to.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceEnd < 0) return false;
  if (periodType === "month") return daysSinceEnd <= 40;
  if (periodType === "quarter") return daysSinceEnd <= 100;
  return daysSinceEnd <= 45; // year awards only early in the following January
}

type WinnerCandidate = {
  userEmail: string;
  userName: string | null;
  completedCount: number;
  totalRewardCoins: number;
};

async function findTopSelfAssignCompleter(from: Date, to: Date): Promise<WinnerCandidate | null> {
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      isSelfAssigned: true,
      scheduledDate: { gte: from, lte: to },
      // Completed work excluding rejected (and excluding missed / still assigned)
      status: { in: [CleaningTaskStatus.APPROVED, CleaningTaskStatus.DONE_PENDING_AUDIT] }
    },
    select: {
      userEmail: true,
      userName: true,
      rewardCoins: true
    }
  });

  if (tasks.length === 0) return null;

  const byEmail = new Map<string, WinnerCandidate>();
  for (const task of tasks) {
    const email = task.userEmail.trim().toLowerCase();
    const existing = byEmail.get(email);
    if (existing) {
      existing.completedCount += 1;
      existing.totalRewardCoins += task.rewardCoins;
      if (!existing.userName && task.userName) existing.userName = task.userName;
    } else {
      byEmail.set(email, {
        userEmail: email,
        userName: task.userName,
        completedCount: 1,
        totalRewardCoins: task.rewardCoins
      });
    }
  }

  const ranked = [...byEmail.values()].sort((a, b) => {
    if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount;
    if (b.totalRewardCoins !== a.totalRewardCoins) return b.totalRewardCoins - a.totalRewardCoins;
    return a.userEmail.localeCompare(b.userEmail);
  });

  return ranked[0] ?? null;
}

async function awardHeroForPeriod(
  ledger: HeroAwardLedger,
  periodType: CleaningHeroPeriodType,
  periodKey: string
): Promise<CleaningHeroAward | null> {
  const awardId = `hero-${periodType}-${periodKey}`;
  if (ledger.awards.some((entry) => entry.id === awardId)) {
    return null;
  }

  const { from, to } = periodBounds(periodType, periodKey);
  const winner = await findTopSelfAssignCompleter(from, to);
  const titles = HERO_TITLES[periodType];

  if (!winner || winner.completedCount < 1) {
    // Record a skipped sentinel so we don't re-scan forever with no winner.
    ledger.awards.push({
      id: awardId,
      periodType,
      periodKey,
      userEmail: "",
      userName: null,
      completedCount: 0,
      coinsAwarded: 0,
      title: titles.en,
      titleVi: titles.vi,
      awardedAt: new Date().toISOString()
    });
    await writeLedger(ledger);
    return null;
  }

  const coinsAwarded = HERO_REWARDS[periodType];
  const client = await getActiveClientByEmail(winner.userEmail);
  const resolvedMaHd = client ? String(client[CONTRACT_CODE_COLUMN] ?? "").trim() : "";
  if (!resolvedMaHd) {
    console.warn(
      `[cleaning-hero] No active client contract for winner ${winner.userEmail}; skipping coin grant for ${awardId}`
    );
    return null;
  }

  await managerAdjustCoins({
    maHd: resolvedMaHd,
    delta: coinsAwarded,
    reason: `${titles.en} — ${periodKey} (${winner.completedCount} self-assign completions)`,
    operator: "Cozoro Hero Awards"
  });

  await prisma.coinLedger.create({
    data: {
      userId: winner.userEmail,
      delta: coinsAwarded,
      reason: CoinReason.ADJUSTMENT,
      refType: "cleaning_hero_award",
      refId: awardId
    }
  });

  const award: CleaningHeroAward = {
    id: awardId,
    periodType,
    periodKey,
    userEmail: winner.userEmail,
    userName: winner.userName,
    completedCount: winner.completedCount,
    coinsAwarded,
    title: titles.en,
    titleVi: titles.vi,
    awardedAt: new Date().toISOString()
  };

  ledger.awards.push(award);
  await writeLedger(ledger);
  console.log(
    `[cleaning-hero] Awarded ${coinsAwarded} coins to ${winner.userEmail} for ${awardId} (${winner.completedCount} completions)`
  );
  return award;
}

/**
 * Analyze completed self-assign tasks for closed periods and award Cozoro Hero bonuses.
 * Safe to call repeatedly — each period is awarded at most once.
 */
export async function runCleaningHeroAwards(now = new Date()): Promise<{
  awarded: CleaningHeroAward[];
}> {
  const ledger = await readLedger();
  const awarded: CleaningHeroAward[] = [];

  const candidates: Array<{ type: CleaningHeroPeriodType; key: string }> = [
    { type: "month", key: previousMonthKey(now) },
    { type: "quarter", key: previousQuarterKey(now) },
    { type: "year", key: previousYearKey(now) }
  ];

  for (const candidate of candidates) {
    if (!isPeriodRecentlyClosed(candidate.type, candidate.key, now)) {
      continue;
    }
    try {
      const result = await awardHeroForPeriod(ledger, candidate.type, candidate.key);
      if (result) awarded.push(result);
    } catch (error) {
      console.error(
        `[cleaning-hero] Failed awarding ${candidate.type} ${candidate.key}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { awarded };
}

/** Recent hero awards for a resident (for Notification Center). */
export async function listCleaningHeroAwardsForEmail(
  email: string,
  options?: { withinDays?: number }
): Promise<CleaningHeroAward[]> {
  const normalized = email.trim().toLowerCase();
  const withinDays = options?.withinDays ?? 45;
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const ledger = await readLedger();
  return ledger.awards.filter(
    (award) =>
      award.userEmail === normalized &&
      award.coinsAwarded > 0 &&
      new Date(award.awardedAt).getTime() >= cutoff
  );
}
