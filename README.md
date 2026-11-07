# Savage Wrestling Academy platform

Registration, scheduling, scholarships and coaching tools for Savage Wrestling Academy.

- **Live site:** on the academy's Cloudflare account, published by the Deploy workflow; see [docs/GO_LIVE.md](docs/GO_LIVE.md) (#100)
- **Launch plan:** [docs/LAUNCH_PLAN.md](docs/LAUNCH_PLAN.md)
- **Publishing checklist:** [docs/GO_LIVE.md](docs/GO_LIVE.md)
- **When something goes wrong:** [docs/RUNBOOK.md](docs/RUNBOOK.md)
- **Policy drafts for attorney review:** [docs/policies/](docs/policies/README.md)
- **Work tracking:** [Issues](../../issues) grouped by [milestone](../../milestones)
- **How we work together:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Original technical review from Justin:** [handoff/](handoff/README.md)

## What works today

| Area | Status |
|---|---|
| Public calendar and program cards | Live |
| Family accounts, sign-in, MFA | Live |
| Family profiles and wrestlers | Live |
| SWA Advance approvals with private chat | Live |
| Scholarship offers, drawn signatures, signed copies | Live |
| Coach access, openings, practice plans, curricula | Live |
| Registration and booking review with server pricing | Live, stops before payment |
| Online payment, memberships, orders | Built, closed until `CHECKOUT_KINDS` opens each type. Offline payments recorded on `/payments` |
| Real roster and check-in | Built. Owner and coaches check wrestlers in on `/roster`, by hand or by scanning QR passes. A wrestler without a verified, current USA Wrestling card can't be checked in unless the owner allowed an exception (#210) |
| USA Wrestling cards | Built. Missing or expired cards block booking, and only verified cards check in; owner verifies on `/cards`, where a card joins the renewal list 30 days before it expires (#210) |
| Waivers | Built. Owner publishes on `/waivers`; families sign on `/waiver`; unsigned wrestlers cannot book |
| Private lessons | Built. Families book coach openings on `/lesson`; online payment waits for the refund policy (#80) |
| Waitlists | Removed (#210). A full camp or event is full. Old waitlist records stay in the database and backups |
| Program transfers | Built. Owner moves a paid membership between programs on `/transfers` |
| Wrestler view | Built. `/wrestler?id=` shows the entry pass, what is coming up and anything blocking new bookings |
| Messages | Built. Announcements and private threads on `/messages` and `/inbox`; email after #87. Emails that didn't send are listed on `/messages` with the reason, to send again |
| Automatic notices | Built. Card expiring or expired, waiver to sign, SWA Advance decision, payment recorded, lesson booked (also to the coach), transfer. In the family inbox now; by email after #87 |
| Owner workspace | Opens on the launch checklist, today's real numbers and every real tool. Its editors (programs, schedules, camps and events, team codes) publish to the welcome page and calendar. No sample screens |

The owner workspace (`app/portal.html`) runs on real records only. Real family data lives in the `family_accounts`, `program_approvals` and `scholarship_awards` tables. On a new site the owner publishes the programs from the launch checklist.

## Stack

Cloudflare Worker built with [Vinext](https://github.com/cloudflare/vinext) and Vite. Cloudflare D1 (SQLite) holds business data. Supabase is used for sign-in only. Stripe is in test mode. Most pages are server-rendered HTML with inline JavaScript.

## Getting started

Requires Node 22.13 or newer (Node 24 recommended) and Corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local   # then fill in a DEVELOPMENT Supabase project, never production
pnpm test
pnpm dev                     # http://127.0.0.1:5173
```

To run the built Worker against a local database:

```bash
pnpm build
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/state
pnpm start
```

Without Supabase settings, public pages work and every signed-in page refuses requests.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Runs every script in `tests/` |
| `pnpm typecheck` | TypeScript check. It does not cover inline JavaScript in `.html` files |
| `pnpm build` | Builds the Worker into `dist/` |
| `pnpm dev` | Local dev server on port 5173 |
| `pnpm start` | Runs the built Worker locally on port 8787 |
| `pnpm audit --prod` | Security audit of production dependencies |
| `pnpm e2e [screenshot-folder]` | Builds the site, runs it on a fresh local database with a stand-in for Supabase sign-in, and walks the owner, a coach and two families through every feature in Chromium. Then runs an accessibility check (axe-core) on every page. Fails on any page, console or server error or serious accessibility issue. A failed step names the walkthrough line it stopped on and saves a screenshot of every open page to `e2e-failures/`; in CI, a failed walkthrough's log and those screenshots are kept for 7 days as the `walkthrough-failure` artifact. Runs on every pull request; locally it needs Chromium (`pnpm exec playwright install chromium`). Never uses real accounts |
| `pnpm e2e:payments` | Rehearses online payment in Stripe test mode against Stripe's official `stripe-mock` (checks every Stripe request against Stripe's API): key setup, walk-in checkout, payment and refund webhooks, a monthly membership with its 12-payment end date, a later installment and a failed one. Needs `go install github.com/stripe/stripe-mock@v0.197.0`. Runs on every pull request |

## Where things are

| Path | Contents |
|---|---|
| `app/api/*/route.ts` | JSON API routes |
| `app/*/route.ts` and `screen.html` | Server-rendered pages |
| `app/portal.html` | Owner dashboard and settings editors, about 84 KB of HTML and inline JavaScript that draws the pages and saves |
| `lib/workspace/` | The owner workspace's typed program, grade, schedule, event and price rules, bundled to `/portal-workspace.js` at build time (issue #45) |
| `lib/` | Shared server logic: auth, pricing, approvals, scholarships, backups |
| `db/schema.ts`, `drizzle/` | Database schema and ordered migrations |
| `tests/` | Node test scripts using VM sandboxes and in-memory SQLite |
| `handoff/` | Justin's November 5 technical review, docs and evidence |
| `docs/` | Launch plan and other working documents |

## Rules that protect the live site

- Production is published only by the **Deploy** GitHub workflow from `main` after every check passes. It backs up the live database first. Never deploy from your own machine.
- The academy has left ChatGPT Sites; there is no Sites or ChatGPT code in this repo.
- Never point local work at the production database or production Supabase project.
- Never commit secrets.

The full list is in [CLAUDE.md](CLAUDE.md), which Claude Code also follows.
