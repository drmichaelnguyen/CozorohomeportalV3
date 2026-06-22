#!/usr/bin/env node
/**
 * Export MariaDB (Prisma) tables to a Google Sheet backup.
 * Usage: pnpm exec tsx scripts/db-backup-to-sheet.mts [actorEmail]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, "api", ".env") });

const actorEmail = (process.argv[2] ?? process.env.DB_BACKUP_ACTOR_EMAIL ?? "system@cozorohome.com").trim();

const { exportDatabaseToGoogleSheet } = await import(path.join(repoRoot, "api", "src", "db-backup-sheets.ts"));

try {
  const result = await exportDatabaseToGoogleSheet(actorEmail);
  console.log("[db-backup-to-sheet] Export complete");
  console.log("  Spreadsheet:", result.spreadsheetUrl);
  console.log("  Exported at:", result.exportedAt);
  console.log("  Tables:", Object.entries(result.counts).map(([k, n]) => `${k}=${n}`).join(", "));
} catch (error) {
  console.error("[db-backup-to-sheet]", error instanceof Error ? error.message : error);
  process.exit(1);
}
