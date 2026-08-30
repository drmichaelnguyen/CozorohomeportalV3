#!/usr/bin/env node
/**
 * Push fanpage knowledge to the Meta AI Google Doc.
 * Usage: pnpm sync:meta-ai-knowledge [--force]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(repoRoot, "api");

process.chdir(apiRoot);
await import(path.join(apiRoot, "src", "load-env.js"));

const force = process.argv.includes("--force");

const { syncMetaAiKnowledgeDocument } = await import(path.join(apiRoot, "src", "meta-ai-knowledge-doc.ts"));

try {
  const result = await syncMetaAiKnowledgeDocument({ force });
  if (result.skipped) {
    console.log("[sync-meta-ai-knowledge] Skipped:", result.reason);
    if ("lastSyncedAt" in result && result.lastSyncedAt) {
      console.log("  Last sync:", result.lastSyncedAt);
    }
    if (!force && result.reason?.includes("3 days")) {
      console.log("  Tip: pass --force to sync immediately.");
    }
    process.exit(0);
  }

  console.log("[sync-meta-ai-knowledge] Done");
  console.log("  Document:", result.documentUrl);
  console.log("  Synced at:", result.syncedAt);
  console.log("  Characters:", result.contentLength);
} catch (error) {
  console.error("[sync-meta-ai-knowledge]", error instanceof Error ? error.message : error);
  process.exit(1);
}
