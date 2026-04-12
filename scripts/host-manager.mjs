#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const stateDir = path.join(repoRoot, ".codex-logs", "host-stack");
const logDir = path.join(stateDir, "logs");
const stateFile = path.join(stateDir, "state.json");
const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";

mkdirSync(logDir, { recursive: true });

const command = process.argv[2] ?? "doctor";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  switch (command) {
    case "doctor":
      runDoctor();
      return;
    case "build":
      await runBuild();
      return;
    case "start":
      await runStart();
      return;
    case "stop":
      await runStop();
      return;
    case "restart":
      await runStop({ quietWhenMissing: true });
      await runStart();
      return;
    case "status":
      runStatus();
      return;
    default:
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log("Usage: node scripts/host-manager.mjs <doctor|build|start|stop|restart|status>");
}

function readEnvFile(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
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

function getNodeMajorVersion() {
  return Number(process.versions.node.split(".")[0] ?? 0);
}

function readState() {
  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function writeState(value) {
  writeFileSync(stateFile, JSON.stringify(value, null, 2), "utf8");
}

function removeState() {
  if (existsSync(stateFile)) {
    rmSync(stateFile, { force: true });
  }
}

function isPidRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnvSnapshot() {
  const apiEnv = readEnvFile("api/.env");
  const portalEnv = readEnvFile("portal/.env.local");
  const botEnv = readEnvFile("bot/.env");
  const guestBookingEnv = readEnvFile("guest-booking-standalone/.env");

  const apiPort = Number(apiEnv.PORT ?? 4000);
  const portalPort = Number(portalEnv.PORT ?? 3000);
  const botPort = Number(botEnv.PORT ?? 4010);
  const guestBookingPort = Number(guestBookingEnv.PORT ?? 4115);

  return {
    apiEnv,
    portalEnv,
    botEnv,
    guestBookingEnv,
    apiPort,
    portalPort,
    botPort,
    guestBookingPort
  };
}

function getServices() {
  const env = getEnvSnapshot();

  return [
    {
      name: "api",
      enabled: existsSync(path.join(repoRoot, "api/.env")),
      port: env.apiPort,
      cwd: repoRoot,
      command: corepackCommand,
      env: {},
      args: ["pnpm", "--filter", "cozorohome-api", "start"]
    },
    {
      name: "portal",
      enabled: existsSync(path.join(repoRoot, "portal/.env.local")),
      port: env.portalPort,
      cwd: repoRoot,
      command: corepackCommand,
      env: {
        PORT: String(env.portalPort)
      },
      args: ["pnpm", "--filter", "cozorohome-portal", "exec", "next", "start", "-p", String(env.portalPort)]
    },
    {
      name: "bot",
      enabled: existsSync(path.join(repoRoot, "bot/.env")),
      port: env.botPort,
      cwd: repoRoot,
      command: corepackCommand,
      env: {},
      args: ["pnpm", "--filter", "cozorohome-bot", "start"]
    },
    {
      name: "guest-booking",
      enabled: existsSync(path.join(repoRoot, "guest-booking-standalone/.env")),
      port: env.guestBookingPort,
      cwd: path.join(repoRoot, "guest-booking-standalone"),
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      env: {
        PORT: String(env.guestBookingPort)
      },
      args: ["start"]
    }
  ];
}

function detectMismatchedNodeModules() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    return [];
  }

  const entries = readdirSync(pnpmDir);
  const warnings = [];

  if (process.platform === "darwin") {
    if (entries.some((entry) => entry.includes("win32"))) {
      warnings.push(
        "This checkout appears to include Windows-only packages inside node_modules. Delete node_modules on the Mac and reinstall there."
      );
    }
  }

  if (process.platform === "win32") {
    if (entries.some((entry) => entry.includes("darwin"))) {
      warnings.push(
        "This checkout appears to include macOS-only packages inside node_modules. Delete node_modules on Windows and reinstall here."
      );
    }
  }

  return warnings;
}

function maybeWarnForCloudflared() {
  const cloudflaredCommand = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const result = spawnCommandSync(cloudflaredCommand, ["--version"], {
    cwd: repoRoot,
    stdio: "ignore"
  });
  return result.status === 0
    ? null
    : "cloudflared is not available on PATH. That is fine for local-only hosting, but public domains/tunnels will need it on the Mac too.";
}

function runDoctor() {
  const env = getEnvSnapshot();
  const warnings = [];
  const missing = [];

  if (getNodeMajorVersion() < 20) {
    warnings.push(`Node ${process.versions.node} is installed. This repo is safest on Node 20 LTS or newer.`);
  }

  if (!existsSync(path.join(repoRoot, "api/.env"))) {
    missing.push("api/.env");
  }

  if (!existsSync(path.join(repoRoot, "portal/.env.local"))) {
    missing.push("portal/.env.local");
  }

  if (!existsSync(path.join(repoRoot, "api/.google-oauth.json"))) {
    warnings.push("api/.google-oauth.json is missing. Google Sheets/Calendar OAuth features will not work until you copy it over.");
  }

  if (!existsSync(path.join(repoRoot, "bot/.env"))) {
    warnings.push("bot/.env is missing. The main portal/API can still run, but the Messenger bot service will be skipped.");
  }

  if (!existsSync(path.join(repoRoot, "guest-booking-standalone/.env"))) {
    warnings.push("guest-booking-standalone/.env is missing. The hostel guest booking service will be skipped.");
  }

  warnings.push(...detectMismatchedNodeModules());

  if (existsSync(path.join(repoRoot, "portal/.next"))) {
    warnings.push("portal/.next exists. Rebuild on the Mac instead of trusting copied build output.");
  }

  if (existsSync(path.join(repoRoot, "api/dist"))) {
    warnings.push("api/dist exists. Rebuild on the Mac so compiled output matches the host platform.");
  }

  if (existsSync(path.join(repoRoot, "bot/dist"))) {
    warnings.push("bot/dist exists. Rebuild on the Mac before starting the bot.");
  }

  if (existsSync(path.join(repoRoot, "guest-booking-standalone/node_modules"))) {
    warnings.push("guest-booking-standalone/node_modules exists. Reinstall it on the Mac instead of reusing a copied install.");
  }

  if (!Number.isFinite(env.apiPort) || env.apiPort <= 0) {
    warnings.push("api/.env has an invalid PORT value.");
  }

  if (!Number.isFinite(env.portalPort) || env.portalPort <= 0) {
    warnings.push("portal/.env.local has an invalid PORT value.");
  }

  const apiServerOrigin = env.portalEnv.API_SERVER_ORIGIN?.trim();
  if (apiServerOrigin) {
    const expectedOrigin = `http://127.0.0.1:${env.apiPort}`;
    const localhostOrigin = `http://localhost:${env.apiPort}`;
    if (apiServerOrigin !== expectedOrigin && apiServerOrigin !== localhostOrigin) {
      warnings.push(
        `portal/.env.local points API_SERVER_ORIGIN to ${apiServerOrigin}. Confirm that matches the API port you want on the Mac (${env.apiPort}).`
      );
    }
  }

  const botApiBaseUrl = env.botEnv.BOT_API_BASE_URL?.trim();
  if (botApiBaseUrl) {
    const expectedOrigin = `http://127.0.0.1:${env.apiPort}`;
    const localhostOrigin = `http://localhost:${env.apiPort}`;
    if (botApiBaseUrl !== expectedOrigin && botApiBaseUrl !== localhostOrigin) {
      warnings.push(
        `bot/.env points BOT_API_BASE_URL to ${botApiBaseUrl}. Confirm that matches the API host/port you want on the Mac (${env.apiPort}).`
      );
    }
  }

  const guestDatabaseUrl = env.guestBookingEnv.DATABASE_URL?.trim();
  if (guestDatabaseUrl && env.apiEnv.DATABASE_URL?.trim() && guestDatabaseUrl !== env.apiEnv.DATABASE_URL.trim()) {
    warnings.push("guest-booking-standalone/.env points at a different DATABASE_URL than api/.env. Confirm both services can reach the same database on the Mac.");
  }

  const cloudflaredWarning = maybeWarnForCloudflared();
  if (cloudflaredWarning) {
    warnings.push(cloudflaredWarning);
  }

  console.log("Host doctor summary");
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node: ${process.versions.node}`);
  console.log(`API port: ${env.apiPort}`);
  console.log(`Portal port: ${env.portalPort}`);
  console.log(`Bot port: ${env.botPort}`);
  console.log(`Guest booking port: ${env.guestBookingPort}`);
  console.log("");

  if (missing.length) {
    console.log("Missing required files:");
    for (const file of missing) {
      console.log(`- ${file}`);
    }
    console.log("");
  }

  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
    console.log("");
  }

  if (!missing.length && !warnings.length) {
    console.log("No blocking issues found.");
    console.log("");
  }

  console.log("Recommended next steps:");
  console.log("- corepack pnpm install --frozen-lockfile");
  console.log("- corepack pnpm host:build");
  console.log("- corepack pnpm host:start");

  if (missing.length) {
    process.exitCode = 1;
  }
}

async function runBuild() {
  console.log("Cleaning copied dependencies and build output...");
  removePath("node_modules");
  removePath("api/node_modules");
  removePath("portal/node_modules");
  removePath("bot/node_modules");
  removePath("guest-booking-standalone/node_modules");
  removePath("portal/.next");
  removePath("portal/tsconfig.tsbuildinfo");
  removePath("api/dist");
  removePath("bot/dist");

  console.log("Installing workspace dependencies...");
  await runCorepack(["pnpm", "install", "--frozen-lockfile"]);

  console.log("Regenerating Prisma client...");
  await runCorepack(["pnpm", "--filter", "cozorohome-api", "prisma:generate"]);

  console.log("Building API...");
  await runCorepack(["pnpm", "--filter", "cozorohome-api", "build"]);

  console.log("Building portal...");
  await runCorepack(["pnpm", "--filter", "cozorohome-portal", "build"]);

  console.log("Building bot...");
  await runCorepack(["pnpm", "--filter", "cozorohome-bot", "build"]);

  if (existsSync(path.join(repoRoot, "guest-booking-standalone/package-lock.json"))) {
    console.log("Installing guest booking dependencies...");
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["ci"], {
      cwd: path.join(repoRoot, "guest-booking-standalone")
    });
  }

  console.log("Build completed.");
}

function removePath(relativePath) {
  const target = path.join(repoRoot, relativePath);
  try {
    rmSync(target, { recursive: true, force: true });
    return;
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }
  }

  const escapedTarget = target.replace(/'/g, "''");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `if (Test-Path -LiteralPath '${escapedTarget}') { Remove-Item -LiteralPath '${escapedTarget}' -Recurse -Force -ErrorAction Stop }`
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false
    }
  );

  if (result.status !== 0) {
    throw new Error(`Unable to remove ${relativePath}`);
  }
}

function runCorepack(args) {
  return runCommand(corepackCommand, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      ...options,
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
    });
  });
}

async function runStart() {
  const existingState = readState();
  if (existingState?.services?.some((service) => isPidRunning(service.pid))) {
    throw new Error("Managed services are already running. Use host:status or host:restart instead.");
  }

  const services = getServices().filter((service) => service.enabled);
  if (!services.length) {
    throw new Error("No services are enabled. Copy env files first, then rerun host:doctor.");
  }

  const started = [];

  try {
    for (const service of services) {
      if (await isPortOccupied(service.port)) {
        throw new Error(
          `Port ${service.port} is already in use before starting ${service.name}. Stop the existing process or change that service port in its env file.`
        );
      }

      const outPath = path.join(logDir, `${service.name}.log`);
      const errPath = path.join(logDir, `${service.name}.err.log`);
      const outFd = openSync(outPath, "a");
      const errFd = openSync(errPath, "a");
      const child = spawnCommand(service.command, service.args, {
        cwd: service.cwd,
        detached: true,
        stdio: ["ignore", outFd, errFd],
        env: {
          ...process.env,
          ...service.env
        }
      });

      child.unref();
      started.push({
        name: service.name,
        pid: child.pid,
        port: service.port,
        outPath,
        errPath,
        startedAt: new Date().toISOString()
      });
    }

    writeState({
      startedAt: new Date().toISOString(),
      platform: process.platform,
      services: started
    });

    console.log("Started services:");
    for (const service of started) {
      console.log(`- ${service.name}: pid ${service.pid}, port ${service.port}`);
      console.log(`  log: ${service.outPath}`);
      console.log(`  err: ${service.errPath}`);
    }
  } catch (error) {
    writeState({
      startedAt: new Date().toISOString(),
      platform: process.platform,
      services: started
    });
    await runStop({ quietWhenMissing: true });
    throw error;
  }
}

async function runStop(options = {}) {
  const state = readState();
  if (!state?.services?.length) {
    if (!options.quietWhenMissing) {
      console.log("No managed services are currently recorded.");
    }
    return;
  }

  for (const service of state.services) {
    if (!isPidRunning(service.pid)) {
      continue;
    }

    try {
      process.kill(service.pid, "SIGTERM");
    } catch {
      continue;
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const stillRunning = state.services.some((service) => isPidRunning(service.pid));
    if (!stillRunning) {
      break;
    }
    await wait(200);
  }

  for (const service of state.services) {
    if (!isPidRunning(service.pid)) {
      continue;
    }

    try {
      process.kill(service.pid, "SIGKILL");
    } catch {
      // Ignore final cleanup failures.
    }
  }

  removeState();
  if (!options.quietWhenMissing) {
    console.log("Stopped managed services.");
  }
}

function runStatus() {
  const state = readState();
  if (!state?.services?.length) {
    console.log("No managed services recorded.");
    return;
  }

  console.log(`Managed stack started at ${state.startedAt}`);
  for (const service of state.services) {
    console.log(
      `- ${service.name}: ${isPidRunning(service.pid) ? "running" : "stopped"} | pid ${service.pid} | port ${service.port}`
    );
    console.log(`  log: ${service.outPath}`);
    console.log(`  err: ${service.errPath}`);
  }
}

function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port
    });

    const finish = (value) => {
      socket.removeAllListeners();
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve(value);
    };

    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function spawnCommand(command, args, options = {}) {
  if (process.platform === "win32") {
    const commandLine = [command, ...args].join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false
    });
  }

  return spawn(command, args, {
    ...options,
    shell: false
  });
}

function spawnCommandSync(command, args, options = {}) {
  if (process.platform === "win32") {
    const commandLine = [command, ...args].join(" ");
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false
    });
  }

  return spawnSync(command, args, {
    ...options,
    shell: false
  });
}
