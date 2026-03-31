#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const DEFAULT_PORTAL_PORT = 3001;
const DEFAULT_API_PORT = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  for (let i = 0; i < 15; i += 1) {
    const ws = path.join(current, "pnpm-workspace.yaml");
    const portalDir = path.join(current, "portal");
    const apiDir = path.join(current, "api");
    if (exists(ws) && exists(portalDir) && exists(apiDir)) return current;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return null;
}

function parseIntEnv(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStateFilePath(repoRoot) {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(repoRoot, "tools", "cozoroctl");

  const dir = path.join(base, "CozoroHome");
  return path.join(dir, "cozoroctl-state.json");
}

function getLogDir(repoRoot) {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(repoRoot, "tools", "cozoroctl");
  return path.join(base, "CozoroHome", "logs");
}

async function readState(statePath) {
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(statePath, state) {
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function runCmdSync(command, cwd) {
  const result = spawnSync("cmd.exe", ["/c", command], {
    cwd,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    process.exitCode = result.status;
    throw new Error(`Command failed (${result.status}): ${command}`);
  }
}

function runCmdCapture(command, cwd) {
  const result = spawnSync("cmd.exe", ["/c", command], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function taskkillTree(pid) {
  // /T: kill process tree, /F: force
  const { status } = runCmdCapture(`taskkill /PID ${pid} /T /F`, process.cwd());
  return status === 0;
}

function isPidRunning(pid) {
  // tasklist returns 0 even when there is no match; parse output instead.
  const { stdout } = runCmdCapture(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, process.cwd());
  const line = stdout.trim();
  if (!line) return false;
  if (line.toLowerCase().startsWith("\"info:")) return false;
  return line.includes(`"${pid}"`) || line.includes(`,${pid},`) || line.includes(` ${pid} `);
}

function getCommandLineForPid(pid) {
  // Using CIM because it is available on modern Windows PowerShell.
  const ps = [
    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId=" + pid + "\" -ErrorAction SilentlyContinue;",
    "if ($p -and $p.CommandLine) { $p.CommandLine }"
  ].join(" ");
  const { stdout } = runCmdCapture(`powershell.exe -NoProfile -Command "${ps}"`, process.cwd());
  return stdout.trim();
}

function validatePidForApp(pid, token, repoRoot) {
  const cmdline = getCommandLineForPid(pid);
  if (!cmdline) return { ok: false, reason: "no_commandline" };
  const normalized = cmdline.toLowerCase();
  const hasToken = token ? normalized.includes(String(token).toLowerCase()) : false;
  const hasPortal = normalized.includes("cozorohome-portal") || normalized.includes("next dev");
  const hasApi = normalized.includes("cozorohome-api") || normalized.includes("tsx watch");
  return hasToken && (hasPortal || hasApi)
    ? { ok: true }
    : { ok: false, reason: "mismatch", cmdline };
}

function checkPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (ok) => {
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("error", () => onDone(false));
    socket.once("timeout", () => onDone(false));
    socket.connect(port, host, () => onDone(true));
  });
}

function usage() {
  console.log(
    [
      "cozoroctl (Windows helper)",
      "",
      "Commands:",
      "  build                Build API + Portal",
      "  rebuild              Stop, build, then start",
      "  start                Start API + Portal (dev) and store PIDs",
      "  stop                 Stop API + Portal started by cozoroctl only",
      "  restart              Stop then start",
      "  status               Show PID + port status",
      "  check-portal         Check Portal port only",
      "",
      "Env overrides (optional):",
      "  COZORO_PORTAL_PORT   default 3001",
      "  COZORO_API_PORT      default 4000",
      ""
    ].join("\n")
  );
}

async function main() {
  const command = (process.argv[2] || "").trim().toLowerCase();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const repoRoot = findRepoRoot(process.cwd()) || findRepoRoot(path.dirname(process.execPath));
  if (!repoRoot) {
    throw new Error("Cannot find repo root (expected pnpm-workspace.yaml, portal/, api/). Run from the repo folder.");
  }

  const portalPort = parseIntEnv("COZORO_PORTAL_PORT", DEFAULT_PORTAL_PORT);
  const apiPort = parseIntEnv("COZORO_API_PORT", DEFAULT_API_PORT);

  const statePath = getStateFilePath(repoRoot);
  const logDir = getLogDir(repoRoot);
  await fsp.mkdir(logDir, { recursive: true });

  const portalLog = path.join(logDir, "portal.log");
  const portalErr = path.join(logDir, "portal.err.log");
  const apiLog = path.join(logDir, "api.log");
  const apiErr = path.join(logDir, "api.err.log");

  if (command === "build") {
    runCmdSync(`corepack pnpm --filter cozorohome-api build`, repoRoot);
    runCmdSync(`corepack pnpm --filter cozorohome-portal build`, repoRoot);
    console.log("Build complete.");
    return;
  }

  if (command === "status" || command === "check-portal") {
    const portalUp = await checkPortOpen("127.0.0.1", portalPort, 600);
    if (command === "check-portal") {
      console.log(portalUp ? `Portal is up on :${portalPort}` : `Portal is NOT reachable on :${portalPort}`);
      return;
    }

    const apiUp = await checkPortOpen("127.0.0.1", apiPort, 600);
    const state = await readState(statePath);
    console.log(`Repo: ${repoRoot}`);
    console.log(`Portal: ${portalUp ? "UP" : "DOWN"} (port ${portalPort}) pid=${state?.portal?.pid ?? "n/a"}`);
    console.log(`API:    ${apiUp ? "UP" : "DOWN"} (port ${apiPort}) pid=${state?.api?.pid ?? "n/a"}`);
    return;
  }

  if (command === "stop" || command === "restart") {
    const state = await readState(statePath);
    if (!state?.portal?.pid && !state?.api?.pid) {
      console.log("No saved PIDs found. Nothing to stop.");
    } else {
      for (const key of ["portal", "api"]) {
        const item = state?.[key];
        if (!item?.pid) continue;
        const pid = Number(item.pid);
        const running = isPidRunning(pid);
        if (!running) continue;

        const validation = validatePidForApp(pid, state?.token, repoRoot);
        if (!validation.ok) {
          console.log(`Refusing to kill ${key} pid=${pid} (not recognized as this app).`);
          continue;
        }

        taskkillTree(pid);
        await sleep(300);
      }
      await writeState(statePath, { repoRoot, stoppedAt: new Date().toISOString() });
      console.log("Stopped saved processes (only if they matched this app).");
    }

    if (command === "stop") return;
    // else continue to start
  }

  if (command === "rebuild") {
    // stop (best-effort) -> build -> start
    const state = await readState(statePath);
    if (state?.portal?.pid || state?.api?.pid) {
      for (const key of ["portal", "api"]) {
        const item = state?.[key];
        if (!item?.pid) continue;
        const pid = Number(item.pid);
        if (!isPidRunning(pid)) continue;
        const validation = validatePidForApp(pid, state?.token, repoRoot);
        if (!validation.ok) continue;
        taskkillTree(pid);
        await sleep(300);
      }
      await writeState(statePath, { repoRoot, stoppedAt: new Date().toISOString() });
    }

    runCmdSync(`corepack pnpm --filter cozorohome-api build`, repoRoot);
    runCmdSync(`corepack pnpm --filter cozorohome-portal build`, repoRoot);
    console.log("Build complete.");

    // fall through to start logic
  }

  if (command === "start" || command === "restart" || command === "rebuild") {
    if (command === "start") {
      const existing = await readState(statePath);
      const portalPid = Number(existing?.portal?.pid ?? 0);
      const apiPid = Number(existing?.api?.pid ?? 0);
      const portalOk =
        portalPid > 0 &&
        isPidRunning(portalPid) &&
        validatePidForApp(portalPid, existing?.token, repoRoot).ok;
      const apiOk =
        apiPid > 0 &&
        isPidRunning(apiPid) &&
        validatePidForApp(apiPid, existing?.token, repoRoot).ok;

      if (portalOk || apiOk) {
        console.log("Already started by cozoroctl. Run `cozoroctl status` or `cozoroctl restart`.");
        return;
      }
    }

    const token = `COZOROCTL_TOKEN=${randomBytes(8).toString("hex")}`;
    const portalCmd = `set ${token}&& corepack pnpm --filter cozorohome-portal dev 1>> "${portalLog}" 2>> "${portalErr}"`;
    const apiCmd = `set ${token}&& set PORT=${apiPort}&& corepack pnpm --filter cozorohome-api dev 1>> "${apiLog}" 2>> "${apiErr}"`;

    const portalProc = spawn("cmd.exe", ["/c", portalCmd], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    portalProc.unref();

    const apiProc = spawn("cmd.exe", ["/c", apiCmd], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    apiProc.unref();

    const state = {
      repoRoot,
      startedAt: new Date().toISOString(),
      token,
      portal: { pid: portalProc.pid, port: portalPort, command: portalCmd },
      api: { pid: apiProc.pid, port: apiPort, command: apiCmd }
    };
    await writeState(statePath, state);

    // Give services a moment to bind
    await sleep(900);
    const portalUp = await checkPortOpen("127.0.0.1", portalPort, 600);
    console.log(portalUp ? `Portal started on :${portalPort}` : `Portal started (port not ready yet) :${portalPort}`);
    return;
  }

  console.log(`Unknown command: ${command}`);
  usage();
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
