import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export type DbAdvisoryLockOptions = {
  /** MySQL GET_LOCK timeout in seconds. Default 15. */
  timeoutSeconds?: number;
  busyMessage?: string;
};

/**
 * Cross-process MySQL advisory lock. One private connection owns the lock for
 * the entire callback (including external Google Sheets I/O). Do not rely on
 * process-local Sets for correctness across API instances.
 */
export async function withDbAdvisoryLock<T>(
  key: string,
  action: () => Promise<T>,
  options?: DbAdvisoryLockOptions
): Promise<T> {
  const timeoutSeconds = Math.max(1, Math.trunc(options?.timeoutSeconds ?? 15));
  const busyMessage = options?.busyMessage ?? "Resource is busy; please retry";
  // MySQL GET_LOCK name max length is 64; hash keeps keys stable and short.
  const name = `l:${createHash("sha256").update(key).digest("hex").slice(0, 60)}`;
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  databaseUrl.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
  try {
    const rows = await db.$queryRaw<Array<{ acquired: number | bigint | null }>>`
      SELECT GET_LOCK(${name}, ${timeoutSeconds}) AS acquired
    `;
    if (Number(rows[0]?.acquired) !== 1) {
      throw new Error(busyMessage);
    }
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
