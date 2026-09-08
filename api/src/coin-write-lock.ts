import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/** One private connection owns the advisory lock for the entire callback. */
export async function withCoinWriteLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const name = `coins:${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  databaseUrl.searchParams.set("connection_limit", "1");
  // Keep lock waiters out of the application's query pool. No SQL transaction
  // timer can release this lock while the external Google operation is running.
  const db = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
  try {
    const rows = await db.$queryRaw<Array<{ acquired: number | bigint | null }>>`
      SELECT GET_LOCK(${name}, 15) AS acquired
    `;
    if (Number(rows[0]?.acquired) !== 1) throw new Error("Coin update is busy; please retry");
    try {
      return await action();
    } finally {
      await db.$queryRaw`SELECT RELEASE_LOCK(${name})`;
    }
  } finally {
    // Also releases the lock if an error prevents the explicit RELEASE.
    await db.$disconnect();
  }
}
