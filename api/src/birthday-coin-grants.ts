import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CoinReason } from "@prisma/client";

import {
  ACTIVE_STAYING_COLUMN,
  CONTRACT_CODE_COLUMN,
  getManagerClients,
  isActiveClient,
  managerAdjustCoins
} from "./google-sheets.js";
import {
  BIRTHDAY_COIN_GRANT,
  isBirthdayToday,
  parseClientDateOfBirth,
  vietnamCalendarParts
} from "./birthday-benefits.js";
import { prisma } from "./prisma.js";

const ledgerFilePath = path.join(process.cwd(), "data", "birthday-coin-grants.json");

export type BirthdayCoinGrant = {
  id: string;
  email: string;
  year: number;
  coinsAwarded: number;
  grantedAt: string;
};

type BirthdayGrantLedger = {
  grants: BirthdayCoinGrant[];
};

function isLongTermStayingClient(row: Record<string, string>) {
  if (!isActiveClient(row)) return false;
  if (String(row[ACTIVE_STAYING_COLUMN] ?? "").trim() !== "1") return false;
  const maHd = String(row[CONTRACT_CODE_COLUMN] ?? "").trim().toUpperCase();
  if (maHd.startsWith("SHORTTERM")) return false;
  return true;
}

async function readLedger(): Promise<BirthdayGrantLedger> {
  try {
    const raw = await readFile(ledgerFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BirthdayGrantLedger> | null;
    return { grants: Array.isArray(parsed?.grants) ? parsed.grants : [] };
  } catch {
    return { grants: [] };
  }
}

async function writeLedger(ledger: BirthdayGrantLedger) {
  await mkdir(path.dirname(ledgerFilePath), { recursive: true });
  await writeFile(ledgerFilePath, JSON.stringify(ledger, null, 2), "utf8");
}

/** Recent birthday coin grants for Notification Center. */
export async function listBirthdayCoinGrantsForEmail(
  email: string,
  options?: { withinDays?: number }
): Promise<BirthdayCoinGrant[]> {
  const normalized = email.trim().toLowerCase();
  const withinDays = options?.withinDays ?? 14;
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const ledger = await readLedger();
  return ledger.grants.filter(
    (grant) =>
      grant.email === normalized &&
      grant.coinsAwarded > 0 &&
      new Date(grant.grantedAt).getTime() >= cutoff
  );
}

/**
 * Grant 30,000 birthday coins to active long-term residents whose birthday is today (VN time).
 * Safe to call repeatedly — each email receives at most one grant per calendar year.
 */
export async function runBirthdayCoinGrants(now = new Date()): Promise<{ awarded: BirthdayCoinGrant[] }> {
  const calendar = vietnamCalendarParts(now);
  const clients = await getManagerClients();
  const ledger = await readLedger();
  const awarded: BirthdayCoinGrant[] = [];

  for (const client of clients) {
    const row = client.row;
    if (!isLongTermStayingClient(row)) continue;

    const dob = parseClientDateOfBirth(row);
    if (!dob || !isBirthdayToday(dob, now)) continue;

    const email = client.email.trim().toLowerCase();
    const grantId = `birthday-${calendar.year}-${email}`;
    if (ledger.grants.some((entry) => entry.id === grantId)) continue;

    const maHd = client.maHd.trim();
    if (!maHd) {
      console.warn(`[birthday-coins] Skipping ${email} — missing contract code`);
      continue;
    }

    try {
      await managerAdjustCoins({
        maHd,
        delta: BIRTHDAY_COIN_GRANT,
        reason: `Quà sinh nhật / Birthday gift ${calendar.year}`,
        operator: "Cozoro Birthday"
      });

      await prisma.coinLedger.create({
        data: {
          userId: email,
          delta: BIRTHDAY_COIN_GRANT,
          reason: CoinReason.ADJUSTMENT,
          refType: "birthday_grant",
          refId: grantId
        }
      });

      const grant: BirthdayCoinGrant = {
        id: grantId,
        email,
        year: calendar.year,
        coinsAwarded: BIRTHDAY_COIN_GRANT,
        grantedAt: now.toISOString()
      };
      ledger.grants.push(grant);
      awarded.push(grant);
      console.log(`[birthday-coins] Awarded ${BIRTHDAY_COIN_GRANT} coins to ${email} for ${grantId}`);
    } catch (error) {
      console.error(
        `[birthday-coins] Failed for ${email}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (awarded.length > 0) {
    await writeLedger(ledger);
  }

  return { awarded };
}
