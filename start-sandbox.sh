#!/bin/bash
# CozoroHome Sandbox — Portal :3002 | API :4002
# Runs independently from the public app (Portal :3001 | API :4001)

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== CozoroHome Sandbox ==="
echo "Portal  → http://localhost:3002"
echo "API     → http://localhost:4002"
echo ""

# Start API on 4002 in background
(
  cd "$ROOT/api"
  PORT=4002 \
  GOOGLE_REDIRECT_URI="http://localhost:4002/integrations/google/oauth/callback" \
  npx tsx watch src/index.ts
) &
API_PID=$!

# Give API a moment to boot
sleep 2

# Start Portal on 3002 (API_SERVER_ORIGIN overrides .env.local so Next proxy hits :4002)
(
  cd "$ROOT/portal"
  API_SERVER_ORIGIN=http://localhost:4002 \
  npx next dev -p 3002 --webpack
)

# Kill API when portal exits
kill $API_PID 2>/dev/null
