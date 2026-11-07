# Savage Wrestling Academy platform

Registration, scheduling, scholarship, and coaching platform for Savage Wrestling Academy.
Cloudflare Worker built with Vinext and Vite, on the academy's own Cloudflare account, Cloudflare D1 for business data, Supabase for sign-in only, Stripe for payments, in test mode unless deliberately switched.

Read `docs/README.md` and `docs/ARCHITECTURE.md` before larger changes.
Known issues and priorities are in `docs/ISSUES.md` and `docs/LAUNCH_PLAN.md`.

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
- The repository is **public** (since Nov 7, so GitHub Actions minutes are free). Everything committed, including history, issues and pull requests, can be read by anyone. Never commit secrets, real family or coach details, real USA Wrestling card numbers, or real phone numbers or addresses other than the academy's. Use made-up `example.test` people and 555 numbers in tests.
- Do not edit or reorder existing files in `drizzle/`. Add a new migration with `pnpm db:generate` instead.
- Do not run `pnpm audit --fix` or broad dependency upgrades. Upgrade one package at a time on a branch and rerun tests and build.
- Work on a branch and open a pull request. Do not push directly to `main`.

## Workflow

- Every change starts from a GitHub issue. Name branches `<type>/<issue>-<short-name>`, for example `feat/18-stripe-checkout`. Types: feat, fix, chore, docs.
- Put `Closes #<issue>` in the pull request description and fill in the template.
- Decisions live in issues labeled `needs-decision`. Never encode a business policy that is not decided there.
- When a plan changes, update `docs/LAUNCH_PLAN.md` in the same pull request.
- More than one person works here with their own Claude (Lauren and Justin). Before starting, check the open pull requests and issues labeled `in-progress`. If someone is already on it, don't start it; ask in the issue. Label your own issue `in-progress` when you start and remove the label if you stop.
- Rebase on `origin/main` right before opening a pull request, and again if another one merges first. Merge one pull request at a time and let its Deploy finish before the next, because a newer push to `main` cancels the older checks and skips that deploy.
- Never overwrite the owner's saved settings with a data migration. A migration may only change rows that a setup migration wrote and nobody has saved since (match on `updated_by`).
- Full process: `CONTRIBUTING.md`.

## Things that look real but are not

- The owner workspace in `app/portal.html` has no sample screens (#147). It edits the real academy settings document (programs, schedules, camps and events, team codes), which the welcome page and calendar read, and links to the real pages for everything else. Do not add sample, preview or demo screens back.
- Older academy settings documents can still hold sample `kids`, `bookings`, `messages`, `offers` and `staff` from the old workspace. Nothing reads them. Real family data lives in `family_accounts`, `program_approvals`, and `scholarship_awards`.
- A new site lists no programs until the owner publishes them from the launch checklist. The defaults in `hydratePrograms()` are not public until saved.
- Online checkout exists but each purchase type stays closed until `CHECKOUT_KINDS` lists it. Never assume a purchase type is live.
- Inline JavaScript in `.html` files is not typechecked. Passing `pnpm typecheck` says nothing about it. Add a test in `tests/` for any workspace function you change.

## Payments

- Justin owns the academy's Stripe and Resend accounts and sets them up himself (#4, #87). Lauren helps only if he asks. The first test key confirmed on the Payment setup page decides which Stripe account the site trusts (#255).
- Families can pay cash at the academy for walk-ins and Friday Night Live (#248). A coach or the owner records it with **Cash received** on the roster, which writes an offline payment naming who collected it (#250). Never mark a cash booking paid any other way.
- Prices come only from `lib/quotes.ts`. Review screens and checkout both use it. Never accept an amount from the browser.
- An order becomes paid only in `lib/stripe-webhook.ts`, after the Stripe signature is verified. Never mark anything paid from a redirect or a browser call.
- Every Stripe event id is stored once in `stripe_events`. Keep webhook handling idempotent and safe for late or out-of-order events.
- Checkout opens per purchase type with `CHECKOUT_KINDS`. Do not open a type whose terms or refund policy is undecided.
- Live charging requires `STRIPE_MODE=live`, a live webhook secret, and a restricted `rk_live_` key saved on the owner Payment setup page. Never weaken the separation between test and live keys or secrets.

## Sign-in

- `STAFF_MFA=off` on the Worker temporarily lets the owner and coaches sign in without an authenticator (#204). It must be deleted before families join (#27); the owner's launch checklist shows it in red while it's set.

## Domain rules

- Programs: SWA Development is grades K to 6. SWA Intermediate is grades 7 to 12. SWA Advance is grades 7 to 12 and every wrestler needs coach approval.
- Server rules in `lib/program-approval.ts` are the source of truth. Workspace code must match them.
- Kindergarten is stored as the string `"K"`. Other grades are numbers or numeric strings.
- Email links use `appOrigin()` from `lib/account-auth.ts`. Never hard-code a hostname. Any new origin must also be added to the Supabase Auth redirect allowlist.
