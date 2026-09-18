import { withDbAdvisoryLock } from "./db-advisory-lock.js";

/** Coin-sheet critical sections. Prefer `withDbAdvisoryLock` for non-coin keys. */
export async function withCoinWriteLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  return withDbAdvisoryLock(`coins:${key}`, action, {
    busyMessage: "Coin update is busy; please retry"
  });
}
