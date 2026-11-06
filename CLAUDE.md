# Savage Wrestling Academy platform

Registration, scheduling, scholarship, and coaching platform for Savage Wrestling Academy.
Cloudflare Worker built with Vinext and Vite, on the academy's own Cloudflare account, Cloudflare D1 for business data, Supabase for sign-in only, Stripe for payments, in test mode unless deliberately switched.

Read `handoff/README.md` and `handoff/docs/ARCHITECTURE.md` before larger changes.
Known issues and priorities are in `handoff/docs/ISSUES.md` and `handoff/docs/ROADMAP.md`.

## Commands

- `pnpm install --frozen-lockfile` installs dependencies. Use the pinned pnpm from `packageManager`. Do not switch to npm.
- `pnpm test` runs all scripts in `tests/`. Run it before every commit.
- `pnpm typecheck` runs the TypeScript check.
- `pnpm build` builds the Worker into `dist/`.
- `pnpm dev` starts a local dev server on port 5173.

## Hard rules

- The site runs on the academy's Cloudflare account (#100, #119). The academy has left ChatGPT Sites and ChatGPT; do not add any Sites or ChatGPT dependency.
- Production is published only by the **Deploy** GitHub workflow, from `main`, after all checks pass. Never run `wrangler deploy`, `wrangler d1 ... --remote` or `wrangler secret` against the academy's account from a local machine or a Claude Code session.
- Never change the Deploy workflow's backup step, the `DEPLOY_ENABLED` switch or production settings without the owner's approval.
- Never run migrations, queries, or scripts against the production D1 database or production Supabase project. Use a local D1 and a separate development Supabase project.
- Never commit secrets. `.env*` and `.dev.vars*` are ignored for that reason.
- Do not edit or reorder existing files in `drizzle/`. Add a new migration with `pnpm db:generate` instead.
- Do not run `pnpm audit --fix` or broad dependency upgrades. Upgrade one package at a time on a branch and rerun tests and build.
- Work on a branch and open a pull request. Do not push directly to `main`.

## Workflow

- Every change starts from a GitHub issue. Name branches `<type>/<issue>-<short-name>`, for example `feat/18-stripe-checkout`. Types: feat, fix, chore, docs.
- Put `Closes #<issue>` in the pull request description and fill in the template.
- Decisions live in issues labeled `needs-decision`. Never encode a business policy that is not decided there.
- When a plan changes, update `docs/LAUNCH_PLAN.md` in the same pull request.
- Full process: `CONTRIBUTING.md`.

## Things that look real but are not

- The owner workspace in `app/portal.html` runs mostly on sample data stored in one JSON document. Its rosters, attendance, messages, transfers, waitlists, and payouts are simulations.
- Real family data lives in `family_accounts`, `program_approvals`, and `scholarship_awards`. These are not linked to the sample wrestlers in the workspace.
- Online checkout exists but each purchase type stays closed until `CHECKOUT_KINDS` lists it. Never assume a purchase type is live.
- Inline JavaScript in `.html` files is not typechecked. Passing `pnpm typecheck` says nothing about it. Add a test in `tests/` for any workspace function you change.

## Payments

- Prices come only from `lib/quotes.ts`. Review screens and checkout both use it. Never accept an amount from the browser.
- An order becomes paid only in `lib/stripe-webhook.ts`, after the Stripe signature is verified. Never mark anything paid from a redirect or a browser call.
- Every Stripe event id is stored once in `stripe_events`. Keep webhook handling idempotent and safe for late or out-of-order events.
- Checkout opens per purchase type with `CHECKOUT_KINDS`. Do not open a type whose terms or refund policy is undecided.
- Live charging requires `STRIPE_MODE=live`, a live webhook secret, and a restricted `rk_live_` key saved on the owner Payment setup page. Never weaken the separation between test and live keys or secrets.

## Domain rules

- Programs: SWA Development is grades K to 6. SWA Intermediate is grades 7 to 12. SWA Advance is grades 7 to 12 and every wrestler needs coach approval.
- Server rules in `lib/program-approval.ts` are the source of truth. Sample workspace code must match them.
- Kindergarten is stored as the string `"K"`. Other grades are numbers or numeric strings.
- Email links use `appOrigin()` from `lib/account-auth.ts`. Never hard-code a hostname. Any new origin must also be added to the Supabase Auth redirect allowlist.
