/**
 * Backfill Google Sheets cleaning rewards for APPROVED tasks that have no
 * CleaningReward{taskId} history row. Uses awardCleaningCoinsToSheet (idempotent).
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-cleaning-coins.mts           # dry-run
 *   npx tsx scripts/backfill-missing-cleaning-coins.mts --apply   # write coins
 */
import "../src/load-env.js";
import { CleaningTaskStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import {
  awardCleaningCoinsToSheet,
  syncCoinsFromSheet
} from "../src/google-sheets.js";

const APPLY = process.argv.includes("--apply");
const SINCE = process.env.SINCE ?? "2026-08-01";
const REVIEWER = process.env.REVIEWER?.trim() || "system-backfill-2026-10-15";

type CoinRow = Record<string, string>;

function parseAmount(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  console.log(`[backfill] mode=${APPLY ? "APPLY" : "DRY-RUN"} since=${SINCE} reviewer=${REVIEWER}`);
  console.log("[backfill] syncing coins sheet…");
  const coinsCache = await syncCoinsFromSheet();
  const rows = (coinsCache?.rows ?? []) as CoinRow[];
  const CODE = "Mã giao dịch";
  const EMAIL = "Địa chỉ email";
  const EVENT = "Sự kiện";
  const byCode = new Map<string, CoinRow>();
  for (const row of rows) {
    const code = (row[CODE] ?? "").trim();
    if (code) byCode.set(code, row);
  }

  const tasks = await prisma.cleaningTask.findMany({
    where: {
      status: CleaningTaskStatus.APPROVED,
      scheduledDate: { gte: new Date(SINCE) }
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }]
  });

  const missing = tasks.filter((task) => {
    const award = byCode.get(`CleaningReward${task.id}`);
    const reversal = byCode.get(`CleaningReversal${task.id}`);
    return !award && !reversal && task.rewardCoins > 0;
  });

  console.log(`[backfill] approved since ${SINCE}: ${tasks.length}; missing sheet award: ${missing.length}`);
  const byEmail = new Map<string, { count: number; coins: number }>();
  for (const task of missing) {
    const email = task.userEmail.trim().toLowerCase();
    const cur = byEmail.get(email) ?? { count: 0, coins: 0 };
    cur.count += 1;
    cur.coins += task.rewardCoins;
    byEmail.set(email, cur);
  }
  console.table(
    [...byEmail.entries()]
      .sort((a, b) => b[1].coins - a[1].coins)
      .map(([email, v]) => ({ email, tasks: v.count, coins: v.coins }))
  );
  console.log(
    `[backfill] total missing coins: ${missing.reduce((s, t) => s + t.rewardCoins, 0).toLocaleString()}`
  );

  // Flag prior manual cleaning top-ups that may double-count after backfill.
  for (const [email] of byEmail) {
    const bu = rows.filter((row) => {
      const rowEmail = (row[EMAIL] ?? "").trim().toLowerCase();
      const ev = row[EVENT] ?? "";
      const code = (row[CODE] ?? "").trim();
      return (
        rowEmail === email &&
        parseAmount(row.COINS) > 0 &&
        (/bù coins|bu coins/i.test(ev) || (/bù/i.test(ev) && /tháng/i.test(ev))) &&
        /^ManagerCoins/.test(code)
      );
    });
    if (bu.length) {
      console.warn(
        `[backfill] WARN ${email} already has manager top-up(s):`,
        bu.map((r) => `${r["DẤU THỜI GIAN"]} ${r.COINS} ${String(r[EVENT]).slice(0, 60)}`).join(" | ")
      );
    }
  }

  if (!APPLY) {
    console.log("[backfill] dry-run only. Re-run with --apply to credit coins.");
    return;
  }

  let ok = 0;
  let failed = 0;
  const failures: Array<{ id: string; email: string; error: string }> = [];

  async function awardOnce(task: (typeof missing)[number]) {
    await awardCleaningCoinsToSheet(
      {
        userEmail: task.userEmail,
        userName: task.userName,
        branchId: task.branchId,
        rewardCoins: task.rewardCoins,
        taskId: task.id,
        reviewedBy: REVIEWER
      },
      // Moved-out (-1) residents still earned approved cleaning rewards.
      { allowInactiveClient: true }
    );
  }

  for (let i = 0; i < missing.length; i++) {
    const task = missing[i]!;
    const label = `${i + 1}/${missing.length} ${task.scheduledDate.toISOString().slice(0, 10)} ${task.userEmail} ${task.type} ${task.rewardCoins}`;
    let succeeded = false;
    let lastError = "";
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await awardOnce(task);
        ok += 1;
        console.log(`[backfill] OK${attempt > 1 ? `(retry${attempt})` : ""} ${label}`);
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (/Quota exceeded|rate limit|429/i.test(lastError)) {
          const waitMs = 60_000 * attempt;
          console.warn(`[backfill] quota on ${label}; waiting ${waitMs / 1000}s (attempt ${attempt}/4)`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (/busy/i.test(lastError) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        break;
      }
    }
    if (!succeeded) {
      failed += 1;
      failures.push({ id: task.id, email: task.userEmail, error: lastError });
      console.error(`[backfill] FAIL ${label}: ${lastError}`);
    }
    // Stay under Sheets read quota (~60/min).
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`[backfill] done ok=${ok} failed=${failed}`);
  if (failures.length) {
    console.table(failures);
  }

  console.log("[backfill] final coins sync…");
  await syncCoinsFromSheet();
}

main()
  .catch((error) => {
    console.error("[backfill] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
