# Savage Wrestling Academy platform

Registration, scheduling, scholarship, and coaching platform for Savage Wrestling Academy.
Cloudflare Worker built with Vinext and Vite, Cloudflare D1 for business data, Supabase for sign-in only, Stripe in test mode only.

Read `handoff/README.md` and `handoff/docs/ARCHITECTURE.md` before larger changes.
Known issues and priorities are in `handoff/docs/ISSUES.md` and `handoff/docs/ROADMAP.md`.

## Commands

- `pnpm install --frozen-lockfile` installs dependencies. Use the pinned pnpm from `packageManager`. Do not switch to npm.
- `pnpm test` runs all scripts in `tests/`. Run it before every commit.
- `pnpm typecheck` runs the TypeScript check.
- `pnpm build` builds the Worker into `dist/`.
- `pnpm dev` starts a local dev server on port 5173.

## Hard rules

- Never publish or deploy from this repo. The live site is managed in ChatGPT Sites until a migration is approved.
- `.openai/hosting.json` in this repo is a local stand-in with no project ID. Do not add the real Sites project ID without the owner's approval, because it publishes to the live site.
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
- There is no checkout, webhook, order, or subscription code. Registration stops at a review step.
- Inline JavaScript in `.html` files is not typechecked. Passing `pnpm typecheck` says nothing about it. Add a test in `tests/` for any workspace function you change.

## Domain rules

- Programs: SWA Development is grades K to 6. SWA Intermediate is grades 7 to 12. SWA Advance is grades 7 to 12 and every wrestler needs coach approval.
- Server rules in `lib/program-approval.ts` are the source of truth. Sample workspace code must match them.
- Kindergarten is stored as the string `"K"`. Other grades are numbers or numeric strings.
- Email links use `appOrigin()` from `lib/account-auth.ts`. Never hard-code a hostname. Any new origin must also be added to the Supabase Auth redirect allowlist.
