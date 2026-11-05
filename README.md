# Savage Wrestling Academy platform

Registration, scheduling, scholarships and coaching tools for Savage Wrestling Academy.

- **Live site:** https://savage-registration-preview.justinaccordino546.chatgpt.site (hosted on ChatGPT Sites)
- **Launch plan:** [docs/LAUNCH_PLAN.md](docs/LAUNCH_PLAN.md)
- **Publishing checklist:** [docs/GO_LIVE.md](docs/GO_LIVE.md)
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
| Real roster and check-in | Built. Owner and coaches check wrestlers in on `/roster`, by hand or by scanning QR passes |
| USA Wrestling cards | Built. Missing or expired cards block booking; owner verifies on `/cards` |
| Waivers | Built. Owner publishes on `/waivers`; families sign on `/waiver`; unsigned wrestlers cannot book |
| Private lessons | Built. Families book coach openings on `/lesson`; online payment waits for the refund policy (#80) |
| Rosters, messages, transfers, waitlists and payouts in the owner workspace | Sample data only |

The owner workspace (`app/portal.html`) mixes real and sample records. Real family data lives in the `family_accounts`, `program_approvals` and `scholarship_awards` tables. The sample wrestlers in the workspace are not connected to them.

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
for f in drizzle/*.sql; do node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f"; done
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

## Where things are

| Path | Contents |
|---|---|
| `app/api/*/route.ts` | JSON API routes |
| `app/*/route.ts` and `screen.html` | Server-rendered pages |
| `app/portal.html` | Owner workspace, about 155 KB of HTML and inline JavaScript |
| `lib/` | Shared server logic: auth, pricing, approvals, scholarships, backups |
| `db/schema.ts`, `drizzle/` | Database schema and ordered migrations |
| `tests/` | Node test scripts using VM sandboxes and in-memory SQLite |
| `handoff/` | Justin's November 5 technical review, docs and evidence |
| `docs/` | Launch plan and other working documents |

## Rules that protect the live site

- Do not deploy from this repo. Publishing happens through the ChatGPT Sites project until hosting moves.
- `.openai/hosting.json` here has no Sites project ID on purpose.
- Never point local work at the production database or production Supabase project.
- Never commit secrets.

The full list is in [CLAUDE.md](CLAUDE.md), which Claude Code also follows.
