#!/usr/bin/env node
/**
 * mysqldump using DATABASE_URL from api/.env (mysql:// or mariadb://).
 * Usage: node scripts/backup-dump-db.mjs <output.sql>
 */
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "api", ".env");
const outPath = process.argv[2];

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) {
    return out;
  }
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const i = line.indexOf("=");
    if (i === -1) {
      continue;
    }
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parseMysqlUrl(urlStr) {
  const u = new URL(urlStr);
  const proto = u.protocol.replace(":", "").toLowerCase();
  if (proto !== "mysql" && proto !== "mariadb") {
    return null;
  }
  const user = decodeURIComponent(u.username || "");
  const password = decodeURIComponent(u.password || "");
  const host = u.hostname;
  const port = u.port || "3306";
  const database = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
  if (!host || !database) {
    return null;
  }
  return { user, password, host, port, database };
}

async function main() {
  if (!outPath) {
    console.error("Usage: node scripts/backup-dump-db.mjs <output.sql>");
    process.exit(1);
  }

  const env = parseEnvFile(envPath);
  const urlStr = env.DATABASE_URL;
  if (!urlStr) {
    console.error("[backup-dump-db] No DATABASE_URL in api/.env — skip DB dump.");
    process.exit(2);
  }

  const parsed = parseMysqlUrl(urlStr);
  if (!parsed) {
    console.error("[backup-dump-db] DATABASE_URL is not mysql/mariadb — skip DB dump.");
    process.exit(2);
  }

  const { user, password, host, port, database } = parsed;
  const args = [
    `-h${host}`,
    `-P${port}`,
    `-u${user}`,
    `-p${password}`,
    "--single-transaction",
    "--routines",
    "--skip-lock-tables",
    database
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("mysqldump", args, {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env }
    });
    const ws = createWriteStream(outPath);
    child.stdout.pipe(ws);
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mysqldump exited ${code}`));
      }
    });
    ws.on("error", reject);
  });

  console.log(`[backup-dump-db] Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("[backup-dump-db]", err instanceof Error ? err.message : err);
  process.exit(1);
});
