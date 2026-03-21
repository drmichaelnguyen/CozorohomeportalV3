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

const branchTierMatrix: MemberTier[] = [
  {
    name: "Silver",
    threshold: 100000,
    exchangeRate: "60%",
    freeLaundry: "No extra free laundry uses",
    locker: "Available when open",
    promoRate: "60%",
    monthlyMaintainCoins: "5,000",
    shoeRack: "-",
    upgradeCoins: "5,000"
  },
  {
    name: "Gold",
    threshold: 150000,
    exchangeRate: "70%",
    freeLaundry: "01 wash + 01 dry / month",
    locker: "Available when open",
    promoRate: "80%",
    monthlyMaintainCoins: "10,000",
    shoeRack: "-",
    upgradeCoins: "10,000"
  },
  {
    name: "Platinum",
    threshold: 300000,
    exchangeRate: "80%",
    freeLaundry: "01 wash + 02 dry / month",
    locker: "Available when open with Platinum priority",
    promoRate: "90%",
    monthlyMaintainCoins: "20,000",
    shoeRack: "Extra 1/2 compartment",
    upgradeCoins: "20,000"
  },
  {
    name: "Diamond",
    threshold: 800000,
    exchangeRate: "90%",
    freeLaundry: "03 wash + 03 dry / month",
    locker: "Available when open with Diamond priority",
    promoRate: "100%",
    monthlyMaintainCoins: "40,000",
    shoeRack: "Extra 1 compartment",
    upgradeCoins: "40,000"
  },
  {
    name: "Elite",
    threshold: null,
    exchangeRate: "100%",
    freeLaundry: "03 wash + 03 dry / month",
    locker: "Highest priority when open",
    promoRate: "100%",
    monthlyMaintainCoins: "40,000+",
    shoeRack: "Extra 1 compartment",
    upgradeCoins: "80,000"
  }
];

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

function getThresholdTier(totalAccumulatedCoins: number) {
  return (
    [...branchTierMatrix]
      .filter((tier) => tier.threshold != null && totalAccumulatedCoins >= (tier.threshold ?? Number.MAX_SAFE_INTEGER))
      .sort((left, right) => (right.threshold ?? 0) - (left.threshold ?? 0))[0] ?? null
  );
}

function getLiveTier(totalAccumulatedCoins: number, recordedRank: string) {
  const recordedTier = getRecordedTier(recordedRank);
  const thresholdTier = getThresholdTier(totalAccumulatedCoins);

  if (!recordedTier) {
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
}): CozoroMemberProgram {
  const recordedRank = (input.rankValue ?? "").trim() || "Standard";
  const normalizedRank = normalizeRank(recordedRank);
  const branchId = (input.branchId ?? "").trim();
  const totalAccumulatedCoins = parseCoins(input.totalAccumulatedCoins);
  const recordedTier = getRecordedTier(recordedRank);
  const liveTier = branchId === "D7" || branchId === "D2" ? getLiveTier(totalAccumulatedCoins, recordedRank) : null;
  const currentTier = liveTier ?? recordedTier;
  const currentTierIndex = currentTier ? getTierIndex(currentTier.name) : -1;
  const nextTier =
    branchId === "D7" || branchId === "D2"
      ? branchTierMatrix.find((tier) => getTierIndex(tier.name) > currentTierIndex) ?? null
      : null;
  const liveRank = liveTier?.name ?? "Standard";
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
