#!/usr/bin/env node
/**
 * Fail fast if any workspace package.json is corrupted (common on interrupted OneDrive sync).
 * Run after `pnpm install` from portable-dev.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rels = ["package.json", "api/package.json", "portal/package.json", "bot/package.json"];

let failed = false;
for (const rel of rels) {
  const abs = join(root, rel);
  try {
    const raw = readFileSync(abs, "utf8");
    JSON.parse(raw);
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

console.log("[verify-package-json] OK", rels.length, "package.json files");
