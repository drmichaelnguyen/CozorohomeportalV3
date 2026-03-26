#!/bin/bash
# CozoroHome Sandbox — Portal :3002 | API :4002
# Runs independently from the public app (Portal :3001 | API :4001)

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== CozoroHome Sandbox ==="
echo "Portal  → http://localhost:3002"
echo "API     → http://localhost:4002"
echo ""

# Regenerate Prisma client for this platform (fixes Windows/WSL mismatch)
(cd "$ROOT/api" && npx prisma generate --silent 2>/dev/null || true)

# Fix lightningcss platform binary for Linux builds
LIGHTNING_PKG="$ROOT/node_modules/.pnpm/lightningcss@1.32.0/node_modules/lightningcss"
LIGHTNING_BIN="$ROOT/node_modules/.pnpm/lightningcss-linux-x64-gnu@1.32.0/node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node"
if [ -f "$LIGHTNING_BIN" ] && [ ! -e "$LIGHTNING_PKG/lightningcss.linux-x64-gnu.node" ]; then
  ln -sf "$LIGHTNING_BIN" "$LIGHTNING_PKG/lightningcss.linux-x64-gnu.node"
fi

# Detect Windows host IP (WSL gateway) so MySQL at :3306 is reachable
WINDOWS_HOST=$(ip route show | grep -m1 default | awk '{print $3}')
echo "Windows host IP: $WINDOWS_HOST"

# Build DATABASE_URL pointing at the Windows MySQL instance
WSL_DATABASE_URL=$(cat "$ROOT/api/.env" 2>/dev/null | grep DATABASE_URL | cut -d= -f2- | tr -d '"' | sed "s/localhost/$WINDOWS_HOST/g")
if [ -z "$WSL_DATABASE_URL" ]; then
  WSL_DATABASE_URL="mysql://root:root@${WINDOWS_HOST}:3306/cozorohome"
fi
echo "Database: $WSL_DATABASE_URL"

# Start API on 4002 in background
(
  cd "$ROOT/api"
  PORT=4002 \
  GOOGLE_REDIRECT_URI="http://localhost:4002/integrations/google/oauth/callback" \
  DATABASE_URL="$WSL_DATABASE_URL" \
  node --import tsx/esm src/index.ts
) &
API_PID=$!

# Give API a moment to boot
sleep 3

# Build portal if .next build output is missing or stale
if [ ! -d "$ROOT/portal/.next/server" ]; then
  echo "Building portal..."
  (cd "$ROOT/portal" && API_SERVER_ORIGIN=http://localhost:4002 npm run build)
fi

# Start Portal on 3002 (production build)
(
  cd "$ROOT/portal"
  API_SERVER_ORIGIN=http://localhost:4002 \
  npx next start -p 3002
)

# Kill API when portal exits
kill $API_PID 2>/dev/null
