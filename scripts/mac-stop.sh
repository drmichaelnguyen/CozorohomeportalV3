#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/deploy-assets" ]]; then
  ROOT="$SCRIPT_DIR"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
TUNNEL_PID_FILE="$ROOT/.codex-logs/host-stack/cloudflared.pid"

log() {
  printf '[mac-stop] %s\n' "$1"
}

if [[ -f "$TUNNEL_PID_FILE" ]]; then
  PID="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${PID}" ]] && kill -0 "$PID" >/dev/null 2>&1; then
    log "Stopping cloudflared pid $PID"
    kill "$PID" >/dev/null 2>&1 || true
  fi
  rm -f "$TUNNEL_PID_FILE"
fi

cd "$ROOT"
if command -v corepack >/dev/null 2>&1; then
  corepack pnpm host:stop || true
else
  node scripts/host-manager.mjs stop || true
fi

log "Stop complete"
