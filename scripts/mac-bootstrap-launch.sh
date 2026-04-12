#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/deploy-assets" ]]; then
  ROOT="$SCRIPT_DIR"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
MANIFEST_PATH="$ROOT/deploy-assets/deploy-manifest.env"
TUNNEL_RUNTIME_DIR="$ROOT/deploy-assets/runtime/cloudflared"
TUNNEL_PID_FILE="$ROOT/.codex-logs/host-stack/cloudflared.pid"
TUNNEL_LOG_FILE="$ROOT/.codex-logs/host-stack/logs/cloudflared.log"
DB_RESTORE_MARKER="$ROOT/deploy-assets/database/.restore-complete"
DB_DUMP_FILE="$ROOT/deploy-assets/database/database.sql"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Missing deploy manifest at $MANIFEST_PATH"
  exit 1
fi

# shellcheck disable=SC1090
source "$MANIFEST_PATH"

export HOMEBREW_NO_AUTO_UPDATE=1

log() {
  printf '[mac-launch] %s\n' "$1"
}

brew_bin() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return
  fi

  if [[ -x /opt/homebrew/bin/brew ]]; then
    echo /opt/homebrew/bin/brew
    return
  fi

  if [[ -x /usr/local/bin/brew ]]; then
    echo /usr/local/bin/brew
    return
  fi

  return 1
}

ensure_homebrew() {
  if brew_bin >/dev/null 2>&1; then
    return
  fi

  log "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

load_brew_env() {
  local brew_path
  brew_path="$(brew_bin)"
  eval "$("$brew_path" shellenv)"
}

ensure_formula() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    return
  fi

  log "Installing $formula"
  brew install "$formula"
}

ensure_node_toolchain() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge 20 ]]; then
      corepack enable >/dev/null 2>&1 || true
      return
    fi
  fi

  ensure_formula "node@20"

  if [[ -d /opt/homebrew/opt/node@20/bin ]]; then
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
  elif [[ -d /usr/local/opt/node@20/bin ]]; then
    export PATH="/usr/local/opt/node@20/bin:$PATH"
  fi

  corepack enable >/dev/null 2>&1 || true
}

upsert_env_value() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local temp_file="${file_path}.tmp"

  if [[ ! -f "$file_path" ]]; then
    printf '%s=%s\n' "$key" "$value" > "$file_path"
    return
  fi

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file_path" > "$temp_file"

  mv "$temp_file" "$file_path"
}

sync_local_service_endpoints() {
  if [[ -f "$ROOT/bot/.env" ]]; then
    upsert_env_value "$ROOT/bot/.env" "BOT_API_BASE_URL" "http://127.0.0.1:${API_PORT}"
  fi
}

wait_for_mysql_socket() {
  local attempts=0
  until mysqladmin ping >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -gt 30 ]]; then
      echo "MySQL did not become ready in time" >&2
      return 1
    fi
    sleep 2
  done
}

mysql_tcp_cmd() {
  local args=(--protocol=TCP -h"${DATABASE_HOST}" -P"${DATABASE_PORT}" -u"${DATABASE_USER}")
  if [[ -n "${DATABASE_PASSWORD}" ]]; then
    args+=("-p${DATABASE_PASSWORD}")
  fi
  mysql "${args[@]}" "$@"
}

mysqladmin_tcp_ping() {
  local args=(--protocol=TCP -h"${DATABASE_HOST}" -P"${DATABASE_PORT}" -u"${DATABASE_USER}")
  if [[ -n "${DATABASE_PASSWORD}" ]]; then
    args+=("-p${DATABASE_PASSWORD}")
  fi
  mysqladmin "${args[@]}" ping >/dev/null 2>&1
}

setup_local_mysql_if_needed() {
  if [[ "${REQUIRES_LOCAL_MYSQL:-false}" != "true" ]]; then
    return
  fi

  ensure_formula "mysql"
  log "Starting MySQL via Homebrew"
  brew services start mysql >/dev/null
  wait_for_mysql_socket

  if ! mysqladmin_tcp_ping; then
    log "Configuring local MySQL credentials for the packaged database"
    mysql -uroot <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '${DATABASE_PASSWORD}';
CREATE USER IF NOT EXISTS '${DATABASE_USER}'@'127.0.0.1' IDENTIFIED BY '${DATABASE_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO '${DATABASE_USER}'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
  fi

  mysql_tcp_cmd -e "CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

  if [[ -f "$DB_DUMP_FILE" && ! -f "$DB_RESTORE_MARKER" ]]; then
    log "Restoring packaged database dump"
    mysql_tcp_cmd "${DATABASE_NAME}" < "$DB_DUMP_FILE"
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DB_RESTORE_MARKER"
  fi
}

prepare_cloudflared_config() {
  mkdir -p "$TUNNEL_RUNTIME_DIR"
  mkdir -p "$(dirname "$TUNNEL_LOG_FILE")"

  cp "$ROOT/deploy-assets/cloudflared/${CLOUDFLARED_CREDENTIALS_BASENAME}" \
    "$TUNNEL_RUNTIME_DIR/${CLOUDFLARED_CREDENTIALS_BASENAME}"

  local credentials_path="$TUNNEL_RUNTIME_DIR/${CLOUDFLARED_CREDENTIALS_BASENAME}"
  sed "s#__CREDENTIALS_FILE__#${credentials_path//\\/\\\\}#g" \
    "$ROOT/deploy-assets/cloudflared/config.template.yml" > "$TUNNEL_RUNTIME_DIR/config.yml"
}

start_cloudflared() {
  ensure_formula "cloudflared"
  prepare_cloudflared_config

  if [[ -f "$TUNNEL_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      log "cloudflared is already running with pid $existing_pid"
      return
    fi
    rm -f "$TUNNEL_PID_FILE"
  fi

  log "Starting cloudflared tunnel ${CLOUDFLARED_TUNNEL_ID}"
  nohup cloudflared --config "$TUNNEL_RUNTIME_DIR/config.yml" tunnel run "${CLOUDFLARED_TUNNEL_ID}" \
    >>"$TUNNEL_LOG_FILE" 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"
}

main() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This launcher is intended for macOS." >&2
    exit 1
  fi

  ensure_homebrew
  load_brew_env
  ensure_node_toolchain
  setup_local_mysql_if_needed
  sync_local_service_endpoints

  cd "$ROOT"
  log "Running host build"
  corepack pnpm host:build

  log "Starting app services"
  corepack pnpm host:start

  start_cloudflared

  log "Launch complete"
  log "Use 'corepack pnpm host:status' to inspect the app stack"
  log "cloudflared log: $TUNNEL_LOG_FILE"
}

main "$@"
