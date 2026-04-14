#!/bin/bash
# CozoroHome Mac — manage API + Portal (host-manager), backup/restore, git pull, deploy.
# Double-click in Finder, or: chmod +x manage-server.command && ./manage-server.command
# Repo root = this file's directory.

cd "$(dirname "$0")"
REPO_ROOT=$(pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=============================================="
echo "  CozoroHome — manage-server"
echo "  Repo: $REPO_ROOT"
echo "=============================================="

if ! command -v corepack >/dev/null 2>&1; then
  echo "ERROR: corepack not found. Install Node.js LTS from https://nodejs.org/"
  read -r -p "Press Enter to close..."
  exit 1
fi
corepack enable >/dev/null 2>&1 || true

api_port=4000
portal_port=3000
if [[ -f api/.env ]]; then
  _p=$(grep -E '^PORT=' api/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
  [[ -n "$_p" ]] && api_port="$_p"
fi
if [[ -f portal/.env.local ]]; then
  _p=$(grep -E '^PORT=' portal/.env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
  [[ -n "$_p" ]] && portal_port="$_p"
fi

check_http() {
  local name=$1 url=$2
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^(200|301|302|304)$ ]]; then
    echo "  OK  $name ($code) $url"
  else
    echo "  --- $name (HTTP $code) $url"
  fi
}

do_status() {
  echo "--- host:status ---"
  corepack pnpm host:status 2>/dev/null || echo "(host:status failed — run host:doctor?)"
  echo ""
  echo "--- HTTP checks (defaults; see api/.env portal/.env.local for PORT) ---"
  check_http "API" "http://127.0.0.1:${api_port}/health"
  check_http "Portal" "http://127.0.0.1:${portal_port}/"
}

do_backup() {
  echo "--- Full backup -> $REPO_ROOT/backup/ ---"
  corepack pnpm ensure:backup-dir
  bash scripts/backup-full-state.sh
}

write_mysql_restore_helper() {
  local out=$1
  cat >"$out" <<'ENDRESTOREJS'
const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");
const sqlPath = process.argv[2];
if (!sqlPath || !fs.existsSync(sqlPath)) {
  console.error("Usage: node <script> <database.sql>");
  process.exit(1);
}
const envPath = path.join(process.cwd(), "api", ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const raw = env.DATABASE_URL;
if (!raw) {
  console.error("No DATABASE_URL in api/.env");
  process.exit(1);
}
const u = new URL(raw.replace(/^mysql:/i, "http:").replace(/^mariadb:/i, "http:"));
const user = decodeURIComponent(u.username || "");
const password = decodeURIComponent(u.password || "");
const host = u.hostname;
const port = u.port || "3306";
const database = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
const input = fs.readFileSync(sqlPath);
const r = spawnSync(
  "mysql",
  ["-h", host, "-P", String(port), "-u", user, "-p" + password, database],
  { input, stdio: ["pipe", "inherit", "inherit"] }
);
process.exit(r.status !== 0 ? 1 : 0);
ENDRESTOREJS
}

do_restore() {
  echo "--- Restore from backup (DESTRUCTIVE: overwrites api/data and env files from archive) ---"
  shopt -s nullglob
  local list=(backup/cozorohome-full-backup-*.tar.gz)
  shopt -u nullglob
  if [[ ${#list[@]} -eq 0 ]]; then
    echo "No backup/cozorohome-full-backup-*.tar.gz found. Run backup first."
    return
  fi
  echo "Available archives (newest first):"
  local sorted=()
  while IFS= read -r line; do sorted+=("$line"); done < <(printf '%s\n' "${list[@]}" | sort -r)
  local i=0
  for f in "${sorted[@]}"; do
    i=$((i + 1))
    echo "  $i) $(basename "$f")"
  done
  echo -n "Pick number (0 = cancel): "
  read -r pick
  [[ "$pick" == "0" || -z "$pick" ]] && { echo "Cancelled."; return; }
  local idx=$((pick - 1))
  if [[ $idx -lt 0 || $idx -ge ${#sorted[@]} ]]; then
    echo "Invalid choice."
    return
  fi
  local ARCH="${sorted[$idx]}"
  echo "You chose: $ARCH"
  echo -n "Type RESTORE in capitals to confirm: "
  read -r conf
  [[ "$conf" != "RESTORE" ]] && { echo "Cancelled."; return; }

  local WORK="backup/.restore-work-$$"
  rm -rf "$WORK"
  mkdir -p "$WORK"
  echo "Extracting..."
  tar -xzf "$ARCH" -C "$WORK"
  local TOP
  TOP=$(ls -1 "$WORK" | head -1)
  local SNAP="$WORK/$TOP"
  if [[ ! -d "$SNAP" ]]; then
    echo "ERROR: unexpected archive layout under $WORK"
    rm -rf "$WORK"
    return
  fi

  echo "Stopping services..."
  corepack pnpm host:stop 2>/dev/null || true

  if [[ -d "$SNAP/files" ]]; then
    echo "Restoring env / oauth from archive..."
    [[ -f "$SNAP/files/api/.env" ]] && cp -p "$SNAP/files/api/.env" api/.env && echo "  restored api/.env"
    [[ -f "$SNAP/files/api/.env.local" ]] && cp -p "$SNAP/files/api/.env.local" api/.env.local && echo "  restored api/.env.local"
    [[ -f "$SNAP/files/portal/.env.local" ]] && cp -p "$SNAP/files/portal/.env.local" portal/.env.local && echo "  restored portal/.env.local"
    [[ -f "$SNAP/files/portal/.env" ]] && cp -p "$SNAP/files/portal/.env" portal/.env && echo "  restored portal/.env"
    [[ -f "$SNAP/files/bot/.env" ]] && cp -p "$SNAP/files/bot/.env" bot/.env && echo "  restored bot/.env"
    [[ -f "$SNAP/files/guest-booking-standalone/.env" ]] && cp -p "$SNAP/files/guest-booking-standalone/.env" guest-booking-standalone/.env && echo "  restored guest-booking-standalone/.env"
    [[ -f "$SNAP/files/api/.google-oauth.json" ]] && cp -p "$SNAP/files/api/.google-oauth.json" api/.google-oauth.json && echo "  restored api/.google-oauth.json"
  fi

  if [[ -d "$SNAP/api-data" ]]; then
    echo "Replacing api/data from archive..."
    rm -rf api/data
    mkdir -p api/data
    cp -pR "$SNAP/api-data/." api/data/
    echo "  restored api/data"
  fi

  if [[ -f "$SNAP/database.sql" ]]; then
    if command -v mysql >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
      echo "Importing database.sql (mysql CLI)..."
      local helper="${TMPDIR:-/tmp}/cozoro-mysql-restore-$$.cjs"
      write_mysql_restore_helper "$helper"
      node "$helper" "$SNAP/database.sql" || echo "WARN: mysql import failed — restore DB manually."
      rm -f "$helper"
    else
      echo "WARN: mysql or node not found — import $SNAP/database.sql manually."
    fi
  else
    echo "(No database.sql in this archive — skip DB import.)"
  fi

  rm -rf "$WORK"
  echo "Restore file copy done. Start stack with option 3 or run deploy (option 8)."
}

do_pull_deploy() {
  echo "--- Git pull (main) + full deploy ---"
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "Working tree is dirty. Options:"
    echo "  a) Discard local changes to tracked files: git checkout -- ."
    echo "  b) Stash: git stash -u"
    echo "Then re-run option 8."
    return 0
  fi
  git pull --ff-only origin main
  corepack pnpm host:pull-deploy
}

while true; do
  echo ""
  echo "---- Menu ----"
  echo "  1) Status (pnpm host:status + HTTP checks)"
  echo "  2) Doctor"
  echo "  3) Start stack (pnpm host:start)"
  echo "  4) Stop stack  (pnpm host:stop)"
  echo "  5) Restart     (pnpm host:restart)"
  echo "  6) Full backup (ensure backup/ + backup-full-state)"
  echo "  7) RESTORE from backup/cozorohome-full-backup-*.tar.gz (destructive)"
  echo "  8) Git pull main + deploy (pnpm host:pull-deploy)"
  echo "  9) Git pull main only (no build)"
  echo "  0) Exit"
  echo -n "Choice: "
  read -r choice
  case "$choice" in
    1) do_status ;;
    2) corepack pnpm host:doctor ;;
    3) corepack pnpm host:start ;;
    4) corepack pnpm host:stop ;;
    5) corepack pnpm host:restart ;;
    6) do_backup ;;
    7) do_restore ;;
    8) do_pull_deploy ;;
    9) git pull --ff-only origin main ;;
    0) echo "Bye."; break ;;
    *) echo "Unknown option." ;;
  esac
  echo ""
  read -r -p "Press Enter to continue..."
done
