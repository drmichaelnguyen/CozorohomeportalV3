export type MemberTier = {
  name: string;
  threshold: number | null;
  exchangeRate: string;
  freeLaundry: string;
  locker: string;
  promoRate: string;
  monthlyMaintainCoins: string;
  shoeRack: string;
  upgradeCoins: string;
};

export type CozoroMemberProgram = {
  rank: string;
  recordedRank: string;
  liveRank: string;
  normalizedRank: string;
  branchId: string;
  totalAccumulatedCoins: number;
  previousMonthEarnings: number;
  isPlatinumOrAbove: boolean;
  currentTier: MemberTier | null;
  recordedTier: MemberTier | null;
  liveTier: MemberTier | null;
  nextTier: {
    name: string;
    threshold: number;
    remainingCoins: number;
  } | null;
  maintainCoinsNeeded: number | null;
  branchTiers: MemberTier[];
  earnRules: Array<{
    category: string;
    label: string;
    value: string;
  }>;
  usageRules: string[];
};

export type MemberUpgradeCheck = {
  tierName: string;
  threshold: number;
  previousMonthRequirement: number;
  upgradeCoins: number;
  meetsAccumulated: boolean;
  meetsPreviousMonth: boolean;
  meetsCurrentCoins: boolean;
  eligible: boolean;
};

const branchTierMatrix: MemberTier[] = [
  {
    name: "Silver",
    threshold: 0,
    exchangeRate: "60%",
    freeLaundry: "01 dryer / month",
    locker: "Available when open",
    promoRate: "60%",
    monthlyMaintainCoins: "0",
    shoeRack: "-",
    upgradeCoins: "0"
  },
  {
    name: "Gold",
    threshold: 100000,
    exchangeRate: "70%",
    freeLaundry: "01 wash + 01 dry / month",
    locker: "Available when open",
    promoRate: "80%",
    monthlyMaintainCoins: "5,000",
    shoeRack: "-",
    upgradeCoins: "0"
  },
  {
    name: "Platinum",
    threshold: 150000,
    exchangeRate: "80%",
    freeLaundry: "01 wash + 02 dry / month",
    locker: "Available when open with Platinum priority",
    promoRate: "90%",
    monthlyMaintainCoins: "10,000",
    shoeRack: "Extra 1/2 compartment",
    upgradeCoins: "0"
  },
  {
    name: "Diamond",
    threshold: 300000,
    exchangeRate: "90%",
    freeLaundry: "03 wash + 03 dry / month",
    locker: "Available when open with Diamond priority",
    promoRate: "100%",
    monthlyMaintainCoins: "20,000",
    shoeRack: "Extra 1 compartment",
    upgradeCoins: "10,000"
  },
  {
    name: "Elite",
    threshold: 800000,
    exchangeRate: "100%",
    freeLaundry: "03 wash + 03 dry / month",
    locker: "One small locker (D7) / highest priority when open",
    promoRate: "100%",
    monthlyMaintainCoins: "40,000",
    shoeRack: "Extra 1 compartment",
    upgradeCoins: "40,000"
  }
];

export const COZORO_MEMBER_RULE_DETAILS = [
  "Tier order: Silver -> Gold -> Platinum -> Diamond -> Elite.",
  "Lifetime accumulated coins decide which tiers you are allowed to aim for.",
  "Previous month's earned coins decide whether you qualify for that tier now and whether you keep it.",
  "Upgrade cost is a one-time payment when moving up into a tier that has a fee.",
  "If you stay at the same tier, you do not pay that upgrade cost again.",
  "If you lose a tier and later upgrade back to it, you must pay that tier's upgrade cost again."
] as const;

export const COZORO_MEMBER_DIAMOND_EXAMPLE = [
  "Diamond requires 300,000 accumulated coins.",
  "Diamond also requires 20,000 coins earned in the previous month.",
  "If you dropped below Diamond and want to upgrade back, it also costs 10,000 current coins once."
] as const;

function normalizeRank(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function parseCoins(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMaintainCoins(value: string) {
  const match = value.match(/\d[\d,]*/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRecordedTier(rankValue: string) {
  const normalized = normalizeRank(rankValue);
  return branchTierMatrix.find((tier) => tier.name.toLowerCase() === normalized) ?? null;
}

function getTierIndex(rankValue: string | null | undefined) {
  const normalized = normalizeRank(rankValue);
  const index = branchTierMatrix.findIndex((tier) => tier.name.toLowerCase() === normalized);
  return index === -1 ? -1 : index;
}

export function parseUpgradeCoins(value: string | null | undefined) {
  const match = String(value ?? "").match(/\d[\d,]*/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMemberTierByName(name: string | null | undefined) {
  const normalized = normalizeRank(name);
  return branchTierMatrix.find((tier) => tier.name.toLowerCase() === normalized) ?? null;
}

export function getMemberUpgradeCheck(input: {
  tierName: string;
  totalAccumulatedCoins: number;
  previousMonthEarnings: number;
  currentCoins: number;
}): MemberUpgradeCheck | null {
  const tier = getMemberTierByName(input.tierName);
  if (!tier) {
    return null;
  }

  const threshold = tier.threshold ?? 0;
  const previousMonthRequirement = parseMaintainCoins(tier.monthlyMaintainCoins) ?? 0;
  const upgradeCoins = parseUpgradeCoins(tier.upgradeCoins) ?? 0;
  const meetsAccumulated = input.totalAccumulatedCoins >= threshold;
  const meetsPreviousMonth = input.previousMonthEarnings >= previousMonthRequirement;
  const meetsCurrentCoins = input.currentCoins >= upgradeCoins;

  return {
    tierName: tier.name,
    threshold,
    previousMonthRequirement,
    upgradeCoins,
    meetsAccumulated,
    meetsPreviousMonth,
    meetsCurrentCoins,
    eligible: meetsAccumulated && meetsPreviousMonth && meetsCurrentCoins
  };
}

function getThresholdTier(totalAccumulatedCoins: number, previousMonthEarnings: number) {
  return (
    [...branchTierMatrix]
      .filter((tier) => tier.threshold != null && totalAccumulatedCoins >= (tier.threshold ?? Number.MAX_SAFE_INTEGER))
      .filter((tier) => previousMonthEarnings >= (parseMaintainCoins(tier.monthlyMaintainCoins) ?? 0))
      .sort((left, right) => (right.threshold ?? 0) - (left.threshold ?? 0))[0] ?? null
  );
}

function getLiveTier(totalAccumulatedCoins: number, recordedRank: string, previousMonthEarnings: number) {
  const recordedTier = getRecordedTier(recordedRank);
  const thresholdTier = getThresholdTier(totalAccumulatedCoins, previousMonthEarnings);
  const recordedTierMaintained =
    recordedTier != null && previousMonthEarnings >= (parseMaintainCoins(recordedTier.monthlyMaintainCoins) ?? 0);

  if (!recordedTier || !recordedTierMaintained) {
    return thresholdTier;
  }
  if (!thresholdTier) {
    return recordedTier;
  }

  return getTierIndex(recordedTier.name) >= getTierIndex(thresholdTier.name) ? recordedTier : thresholdTier;
}

export function buildCozoroMemberProgram(input: {
  rankValue: string | null | undefined;
  branchId?: string | null | undefined;
  totalAccumulatedCoins?: string | number | null | undefined;
  previousMonthEarnings?: string | number | null | undefined;
}): CozoroMemberProgram {
  const recordedRank = (input.rankValue ?? "").trim() || "Silver";
  const normalizedRank = normalizeRank(recordedRank);
  const branchId = (input.branchId ?? "").trim();
  const totalAccumulatedCoins = parseCoins(input.totalAccumulatedCoins);
  const previousMonthEarnings = parseCoins(input.previousMonthEarnings);
  const recordedTier = getRecordedTier(recordedRank);
  const liveTier =
    branchId === "D7" || branchId === "D2"
      ? getLiveTier(totalAccumulatedCoins, recordedRank, previousMonthEarnings)
      : null;
  const currentTier = liveTier ?? recordedTier;
  const currentTierIndex = currentTier ? getTierIndex(currentTier.name) : -1;
  const nextTier =
    branchId === "D7" || branchId === "D2"
      ? branchTierMatrix.find((tier) => getTierIndex(tier.name) > currentTierIndex) ?? null
      : null;
  const liveRank = liveTier?.name ?? "Silver";
  const isPlatinumOrAbove = ["platinum", "diamond", "elite", "vip"].includes(normalizeRank(liveRank));

  const cleaningRewardValue = isPlatinumOrAbove ? "4,000 - 6,000" : "3,000 - 5,000";
  const extraCleaningRewardValue = isPlatinumOrAbove ? "6,000" : "3,000 - 5,000";
  const monthlyReviewValue = isPlatinumOrAbove ? "6,000" : "5,000";
  const fineConversionValue = isPlatinumOrAbove ? "2x bill in coins" : "1.5x bill in coins";

  return {
    rank: currentTier?.name ?? recordedRank,
    recordedRank,
    liveRank,
    normalizedRank,
    branchId,
    totalAccumulatedCoins,
    previousMonthEarnings,
    isPlatinumOrAbove,
    currentTier,
    recordedTier,
    liveTier,
    nextTier:
      nextTier && nextTier.threshold != null
        ? {
            name: nextTier.name,
            threshold: nextTier.threshold,
            remainingCoins: Math.max(0, nextTier.threshold - totalAccumulatedCoins)
          }
        : null,
    maintainCoinsNeeded: currentTier ? parseMaintainCoins(currentTier.monthlyMaintainCoins) : null,
    branchTiers: branchTierMatrix,
    earnRules: [
      { category: "Contract", label: "3 months", value: "10,000" },
      { category: "Contract", label: "6 months", value: "25,000" },
      { category: "Contract", label: "12 months", value: "50,000" },
      { category: "Continuous stay", label: "6 months", value: "30,000" },
      { category: "Continuous stay", label: "12 months", value: "20,000" },
      { category: "Support", label: "Bring a guest to view", value: "10,000" },
      { category: "Support", label: "Bring a guest to sign a contract", value: "100,000" },
      { category: "Support", label: "Report broken equipment or policy violations", value: "2,000" },
      { category: "Support", label: "Cleaning duty completed well", value: cleaningRewardValue },
      { category: "Support", label: "Extra cleaning duty", value: extraCleaningRewardValue },
      { category: "Support", label: "Refer a friend for a 6-month contract", value: "500,000" },
      { category: "Support", label: "Monthly dorm review", value: monthlyReviewValue }
    ],
    usageRules: [
      "Laundry wash or dry: 7,000 coins",
      "VND payment support for rent or parking: up to 10% of each bill",
      "100k+ coins can convert to VND based on your Cozoro Member rate",
      `Fine payment by coins: ${fineConversionValue}`
    ]
  };
}
