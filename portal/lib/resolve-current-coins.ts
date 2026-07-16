/**
 * Spendable Cozoro coin balance.
 *
 * Source of truth is the client roster column `Cozoro coins hiện có` (same value
 * used for laundry, fines, rent coin credit, and Home). History sum (earned − used)
 * can diverge when duplicate or race ledger rows exist, so it is only a fallback
 * when the profile balance is blank/zero.
 */
export function parseCoinsNumber(value: string | number | null | undefined): number {
  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function resolveCurrentCoinsBalance(options: {
  profileBalance?: string | number | null;
  historyNet?: number | null;
}): number {
  const profileCurrentBalance = parseCoinsNumber(options.profileBalance);
  const derivedBalanceFromEntries = Math.max(0, Math.trunc(options.historyNet ?? 0));
  if (profileCurrentBalance > 0 || derivedBalanceFromEntries <= 0) {
    return profileCurrentBalance;
  }
  return derivedBalanceFromEntries;
}
