#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

async function main() {
  const env = readEnvFile("api/.env");
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  const host = env.CLOUDFLARE_PORTAL_HOST?.trim() || "app.cozorohome.com";

  if (!token || !zoneId) {
    console.log(
      "Cloudflare portal cache purge skipped (set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in api/.env)."
    );
    return;
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ hosts: [host] })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message =
      payload?.errors?.map((entry) => entry.message).filter(Boolean).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(`Cloudflare cache purge failed for ${host}: ${message}`);
  }

  console.log(`Cloudflare cache purged for ${host}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
