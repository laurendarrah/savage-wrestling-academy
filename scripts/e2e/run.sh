#!/bin/bash
# Builds the site, starts it on a fresh local database with stand-ins for Supabase Auth and USA Wrestling's verify
# page, and runs the end-to-end walkthrough in Chromium. Local only; it never calls USA Wrestling.
# Usage: bash scripts/e2e/run.sh [screenshot-folder]. Ports: E2E_PORT, E2E_AUTH_PORT, E2E_USAW_PORT.
set -e
cd "$(dirname "$0")/../.."
PORT=${E2E_PORT:-8799}
AUTH_PORT=${E2E_AUTH_PORT:-54321}
USAW_PORT=${E2E_USAW_PORT:-54331}
pnpm build >/dev/null
rm -rf .wrangler/e2e
for f in drizzle/*.sql; do node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e --file "$f" >/dev/null; done
# The walkthrough starts from a brand-new site, so remove the starter programs and schedule (issue #178).
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e --command "DELETE FROM academy_state WHERE updated_by LIKE 'setup:issue-%'" >/dev/null
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --persist-to .wrangler/e2e --port $PORT --local \
  --var SUPABASE_URL:http://127.0.0.1:$AUTH_PORT --var SUPABASE_PUBLISHABLE_KEY:sb_publishable_e2e --var APP_ORIGIN:http://127.0.0.1:$PORT \
  --var USAW_LOOKUP_BASE:http://127.0.0.1:$USAW_PORT >.wrangler/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf .wrangler/e2e' EXIT
# Fail fast with the server log if the site never comes up.
for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:$PORT/calendar && break; sleep 1; done
curl -s -o /dev/null http://127.0.0.1:$PORT/calendar || { echo "Local site did not start:"; tail -40 .wrangler/e2e-server.log; exit 1; }
[ -n "${1:-}" ] && mkdir -p "$1"
E2E_BASE=http://127.0.0.1:$PORT E2E_SUPABASE=http://127.0.0.1:$AUTH_PORT E2E_USAW=http://127.0.0.1:$USAW_PORT E2E_SHOTS="${1:-}" node scripts/e2e/journey.mjs
