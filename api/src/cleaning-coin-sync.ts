export type CleaningCoinInput = {
  userEmail: string;
  userName: string | null;
  branchId: string;
  rewardCoins: number;
  taskId: string;
  reviewedBy: string;
};

export type CleaningCoinSnapshot = {
  current: number;
  lifetime: number;
  earnedThisMonth: number;
  transactions: Array<{ code: string; amount: number; thisMonth: boolean }>;
};

export type CleaningCoinChange = {
  code: string;
  delta: number;
  current: number;
  lifetime: number;
  earnedThisMonth: number;
};

/** Read and commit must both run inside the same cross-process lock. */
export async function syncCleaningCoins(
  input: CleaningCoinInput,
  reverse: boolean,
  store: {
    withLock<T>(action: () => Promise<T>): Promise<T>;
    read(): Promise<CleaningCoinSnapshot>;
    commit(change: CleaningCoinChange): Promise<void>;
  }
) {
  if (!Number.isSafeInteger(input.rewardCoins) || input.rewardCoins <= 0) {
    throw new Error("Cleaning reward must be a positive integer");
  }
  return store.withLock(async () => {
    const snapshot = await store.read();
    const awardCode = `CleaningReward${input.taskId}`;
    const reversalCode = `CleaningReversal${input.taskId}`;
    const code = reverse ? reversalCode : awardCode;
    if (snapshot.transactions.some((entry) => entry.code === code)) return;
    // Never re-credit a task that has already been reversed.
    if (!reverse && snapshot.transactions.some((entry) => entry.code === reversalCode)) return;
    const award = snapshot.transactions.find((entry) => entry.code === awardCode);
    if (reverse && !award) return;
    const amount = reverse ? award!.amount : input.rewardCoins;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid original cleaning reward");
    const delta = reverse ? -amount : amount;
    await store.commit({
      code,
      delta,
      // Preserve the full clawback, including debt if coins have already been spent.
      current: snapshot.current + delta,
      // Lifetime/monthly earnings are gross positive credits, matching manager adjustments and the portal.
      lifetime: snapshot.lifetime + (reverse ? 0 : delta),
      earnedThisMonth: snapshot.earnedThisMonth + (reverse ? 0 : delta)
    });
  });
}
