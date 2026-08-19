/**
 * Load `api/.env` from the API package directory (works when `node` is started
 * from the monorepo root — `import "dotenv/config"` only reads `process.cwd()/.env`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentDirName = path.basename(path.dirname(__dirname));
const apiDotEnv = path.resolve(__dirname, parentDirName === "dist" ? "../../.env" : "../.env");

if (fs.existsSync(apiDotEnv)) {
  dotenv.config({ path: apiDotEnv });
}
dotenv.config();

const hasAnyLlm = Boolean(
  process.env.NINE_ROUTER_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_RESIDENT_PORTAL_AI_API_KEY?.trim()
);
if (!hasAnyLlm) {
  console.warn(
    "[cozorohome-api] No NINE_ROUTER_API_KEY, GEMINI_API_KEY, or GEMINI_RESIDENT_PORTAL_AI_API_KEY in process.env — " +
      "Cozoro Bee / manager AI need one of these (loaded api/.env from " +
      (fs.existsSync(apiDotEnv) ? apiDotEnv : "missing; fell back to cwd .env only") +
      ")."
  );
}
