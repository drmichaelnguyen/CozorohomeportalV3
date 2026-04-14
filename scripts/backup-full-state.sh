#!/usr/bin/env bash
# Full pre-deploy backup: all env files used by host-manager, Google OAuth token,
# entire api/data (checkout photos, id-scans, staff JSON, caches, etc.),
# optional MariaDB/MySQL dump, and host stack state.
#
# Usage (from repo root):
#   chmod +x scripts/backup-full-state.sh
#   ./scripts/backup-full-state.sh
#
# Default output: ./backup/ under the repo (gitignored contents; folder tracked).
# Optional:
#   BACKUP_PARENT=~/Desktop ./scripts/backup-full-state.sh
#   SKIP_DATABASE=1 ./scripts/backup-full-state.sh   # skip mysqldump

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PARENT="${BACKUP_PARENT:-$ROOT/backup}"
DEST="${BACKUP_PARENT}/cozorohome-full-backup-${STAMP}"

mkdir -p "$DEST"

echo "[backup-full] Repo:  $ROOT"
echo "[backup-full] Dest: $DEST"
echo ""

manifest="$DEST/MANIFEST.txt"
{
  echo "stamp=$STAMP"
  echo "host=$(hostname 2>/dev/null || true)"
  echo "uname=$(uname -a 2>/dev/null || true)"
  if command -v git >/dev/null 2>&1; then
    echo "git_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "git_branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  fi
} >"$manifest"
echo "[backup-full] Wrote $manifest"

copy_if_exists() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ -e "$src" ]]; then
    local base
    base="$(basename "$rel")"
    mkdir -p "$DEST/files/$(dirname "$rel")"
    cp -pR "$src" "$DEST/files/$rel"
    echo "[backup-full] OK   $rel"
  else
    echo "[backup-full] SKIP $rel (not found)"
  fi
}

# --- Secrets & config (same set host-manager uses for services) ---
copy_if_exists "api/.env"
copy_if_exists "api/.env.local"
copy_if_exists "portal/.env.local"
copy_if_exists "portal/.env"
copy_if_exists "bot/.env"
copy_if_exists "guest-booking-standalone/.env"
copy_if_exists "api/.google-oauth.json"

# --- All API local state (photos, JSON stores, caches, id-scans, training logs, etc.) ---
if [[ -d "$ROOT/api/data" ]]; then
  mkdir -p "$DEST/api-data"
  cp -pR "$ROOT/api/data/." "$DEST/api-data/"
  echo "[backup-full] OK   api/data/ -> $DEST/api-data/"
else
  echo "[backup-full] SKIP api/data/ (directory not found)"
fi

# --- Managed process state (optional) ---
copy_if_exists ".codex-logs/host-stack/state.json"

# --- Database (needs mysqldump on PATH; DATABASE_URL mysql:// in api/.env) ---
if [[ "${SKIP_DATABASE:-}" == "1" ]]; then
  echo "[backup-full] SKIP database (SKIP_DATABASE=1)"
elif ! command -v mysqldump >/dev/null 2>&1; then
  echo "[backup-full] SKIP database (mysqldump not found — install MariaDB/MySQL client or set SKIP_DATABASE=1)"
elif ! command -v node >/dev/null 2>&1; then
  echo "[backup-full] SKIP database (node not on PATH)"
else
  if node "$ROOT/scripts/backup-dump-db.mjs" "$DEST/database.sql"; then
    echo "[backup-full] OK   database.sql"
  else
    echo "[backup-full] WARN database dump failed (see messages above); other files were still copied."
  fi
fi

ARCHIVE="${DEST}.tar.gz"
tar -czf "$ARCHIVE" -C "$(dirname "$DEST")" "$(basename "$DEST")"
echo ""
echo "[backup-full] Archive: $ARCHIVE"
echo "[backup-full] Done. Store the archive somewhere safe (not on the same disk if possible)."
