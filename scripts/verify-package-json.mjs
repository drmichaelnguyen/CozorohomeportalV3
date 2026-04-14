#!/usr/bin/env node
/**
 * Fail fast if any workspace package.json is corrupted (common on interrupted OneDrive sync).
 * Run after `pnpm install` from portable-dev / host-manager build.
 * If a UTF-8 BOM is present, it is **removed on disk** so tools like Prisma can read package.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rels = ["package.json", "api/package.json", "portal/package.json", "bot/package.json"];

let failed = false;
const bomFixed = [];
for (const rel of rels) {
  const abs = join(root, rel);
  try {
    const rawWithBom = readFileSync(abs, "utf8");
    // Strip UTF-8 BOM — JSON.parse rejects U+FEFF (common when editors/OneDrive touch package.json on Windows).
    const raw = rawWithBom.replace(/^\uFEFF/, "");
    JSON.parse(raw);
    if (raw !== rawWithBom) {
      writeFileSync(abs, raw, "utf8");
      bomFixed.push(rel);
    }
  } catch (err) {
    failed = true;
    console.error(`[verify-package-json] INVALID: ${rel}`);
    console.error(err instanceof Error ? err.message : String(err));
  }
}

if (failed) {
  console.error("[verify-package-json] Fix: git checkout -- package.json api/package.json portal/package.json bot/package.json");
  console.error("  or restore from backup; then run pnpm install again.");
  process.exit(1);
}

if (bomFixed.length) {
  console.log("[verify-package-json] Removed UTF-8 BOM from:", bomFixed.join(", "));
}
console.log("[verify-package-json] OK", rels.length, "package.json files");
