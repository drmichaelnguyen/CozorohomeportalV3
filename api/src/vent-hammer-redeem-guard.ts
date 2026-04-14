/**
 * In-memory guard: at most one positive coin redemption per resident email per UTC day
 * for the vent-hammer mini-game (prevents double-submit).
 */

type Entry = { day: string; coins: number };
const redeemed = new Map<string, Entry>();

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function key(email: string) {
  return email.trim().toLowerCase();
}

export function getVentHammerRedeemToday(email: string): { coins: number } | null {
  const e = redeemed.get(key(email));
  if (!e || e.day !== utcDay()) return null;
  return { coins: e.coins };
}

export function markVentHammerRedeemedToday(email: string, coins: number): void {
  redeemed.set(key(email), { day: utcDay(), coins });
}
