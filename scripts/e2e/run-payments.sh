#!/bin/bash
# Online payment rehearsal (issue #111): builds the site, runs it in Stripe TEST mode with online checkout open,
# sends its Stripe calls to stripe-mock, and drives the money path in Chromium. Local only.
# Needs stripe-mock: go install github.com/stripe/stripe-mock@v0.197.0 (or set STRIPE_MOCK to its path).
set -e
cd "$(dirname "$0")/../.."
PORT=8799
MOCK="${STRIPE_MOCK:-$(go env GOPATH 2>/dev/null)/bin/stripe-mock}"
[ -x "$MOCK" ] || { echo "stripe-mock not found at $MOCK"; exit 2; }
SECRET=whsec_rehearsal_$(date +%s)
pnpm build >/dev/null
rm -rf .wrangler/e2e-pay
for f in drizzle/*.sql; do node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e-pay --file "$f" >/dev/null; done
# The walkthrough starts from a brand-new site, so remove the starter programs and schedule (issue #178).
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/e2e-pay --command "DELETE FROM academy_state WHERE updated_by='setup:issue-178'" >/dev/null
"$MOCK" -http-port 12111 >.wrangler/stripe-mock.log 2>&1 &
MOCK_PID=$!
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --persist-to .wrangler/e2e-pay --port $PORT --local \
  --var SUPABASE_URL:http://127.0.0.1:54321 --var SUPABASE_PUBLISHABLE_KEY:sb_publishable_e2e --var APP_ORIGIN:http://127.0.0.1:$PORT \
  --var CHECKOUT_KINDS:walkin,annual,monthly,event,live,lesson --var STRIPE_API_BASE:http://127.0.0.1:12111 \
  --var STRIPE_TEST_WEBHOOK_SECRET:$SECRET --var STRIPE_CONFIG_ENCRYPTION_KEY:$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") >.wrangler/e2e-pay-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER $MOCK_PID 2>/dev/null; rm -rf .wrangler/e2e-pay' EXIT
for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:$PORT/calendar && break; sleep 1; done
curl -s -o /dev/null http://127.0.0.1:$PORT/calendar || { echo "Local site did not start:"; tail -40 .wrangler/e2e-pay-server.log; exit 1; }
E2E_BASE=http://127.0.0.1:$PORT E2E_WEBHOOK_SECRET=$SECRET node scripts/e2e/payments.mjs
