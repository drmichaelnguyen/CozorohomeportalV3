#!/usr/bin/env node
/**
 * Create <repo>/backup/ and backup/.gitignore if missing so generated backups are never committed.
 * Safe to run on every install / deploy (idempotent).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
let root;
try {
  root = execSync("git rev-parse --show-toplevel", { cwd: scriptDir, encoding: "utf8" }).trim();
} catch {
  root = join(scriptDir, "..");
}

const backupDir = join(root, "backup");
const gitignorePath = join(backupDir, ".gitignore");
const body = `# Generated artifacts (timestamped dirs + .tar.gz). Do not commit.
# Tracked in git as this file only; contents stay local.
*
!.gitignore
`;

mkdirSync(backupDir, { recursive: true });
if (!existsSync(gitignorePath)) {
  writeFileSync(gitignorePath, body, "utf8");
  console.log("[ensure-backup-dir] Created", gitignorePath);
} else {
  console.log("[ensure-backup-dir] OK", backupDir);
}
