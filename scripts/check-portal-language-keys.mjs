#!/usr/bin/env node
/**
 * Fails if portal-language.tsx has duplicate keys in the `translations` object literal.
 * Evidence for CI / next build (TypeScript reports first duplicate only).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "portal", "components", "portal-language.tsx");
const s = readFileSync(file, "utf8");
const re = /^\s{2}([a-zA-Z0-9_]+):\s*\{/gm;
const counts = new Map();
for (const m of s.matchAll(re)) {
  const k = m[1];
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
const dups = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => a[0].localeCompare(b[0]));
if (dups.length) {
  console.error("[check-portal-language-keys] Duplicate keys in translations:");
  for (const [k, n] of dups) console.error(`  ${k}: ${n} times`);
  process.exit(1);
}
console.log("[check-portal-language-keys] OK —", counts.size, "unique keys");
