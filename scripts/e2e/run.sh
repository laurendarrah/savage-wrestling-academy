#!/bin/bash
# Builds the site, starts it on a fresh local database with a stand-in for Supabase Auth, and runs the end-to-end
# walkthrough in Chromium. Local only. Usage: bash scripts/e2e/run.sh [screenshot-folder]
set -e
cd "$(dirname "$0")/../.."
PORT=8799
pnpm build >/dev/null
rm -rf .wrangler/e2e
for f in drizzle/*.sql; do node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e --file "$f" >/dev/null; done
# The walkthrough starts from a brand-new site, so remove the starter programs and schedule (issue #178).
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e --command "DELETE FROM academy_state WHERE updated_by LIKE 'setup:issue-%'" >/dev/null
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --persist-to .wrangler/e2e --port $PORT --local \
  --var SUPABASE_URL:http://127.0.0.1:54321 --var SUPABASE_PUBLISHABLE_KEY:sb_publishable_e2e --var APP_ORIGIN:http://127.0.0.1:$PORT >.wrangler/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf .wrangler/e2e' EXIT
# Fail fast with the server log if the site never comes up.
for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:$PORT/calendar && break; sleep 1; done
curl -s -o /dev/null http://127.0.0.1:$PORT/calendar || { echo "Local site did not start:"; tail -40 .wrangler/e2e-server.log; exit 1; }
[ -n "${1:-}" ] && mkdir -p "$1"
E2E_BASE=http://127.0.0.1:$PORT E2E_SHOTS="${1:-}" node scripts/e2e/journey.mjs
