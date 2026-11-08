# Savage Wrestling Academy platform

Registration, scheduling, payments, check-in, scholarships and coaching tools for Savage Wrestling Academy. Families sign up, book and pay; coaches run practices, lessons and check-in; the owner runs the academy from one dashboard. What each feature does today: [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md).

## Where it lives

- **Live site:** a Cloudflare Worker on the academy's own Cloudflare account, published from `main` by the **Deploy** GitHub workflow after every check passes. Its address is the `APP_ORIGIN` repository variable: the Cloudflare `workers.dev` address until the move to the academy's own domain ([docs/GO_LIVE.md](docs/GO_LIVE.md), #43).
- **Docs:** [docs/README.md](docs/README.md) lists every document. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md).
- **Work:** GitHub [issues](../../issues), and who is doing what on the [Launch board (#246)](../../issues/246), in the single [Launch milestone](../../milestones).
- **When something goes wrong:** [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Who does what

Every issue carries a `who:` label:

| Label | Meaning |
|---|---|
| `who: justin` | Only Justin can do or decide it: the academy's accounts (Cloudflare, Stripe, Resend), business decisions |
| `who: lauren` | Lauren does it: settings, accounts, email, reviewing and merging |
| `who: claude` | Code work a Claude Code session can do, reviewed like anyone's |

The full label list is in [CONTRIBUTING.md](CONTRIBUTING.md#labels).

## Run it locally

Needs Node 22.13 or newer (CI uses Node 24) and Corepack, which supplies the pinned pnpm.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local   # fill in a DEVELOPMENT Supabase project, never production
pnpm test
pnpm dev                     # http://127.0.0.1:5173
```

Without Supabase settings, public pages work and every signed-in page refuses requests. To run the built Worker on a local database:

```bash
pnpm build
node --import ./scripts/local-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/state
pnpm start                   # http://127.0.0.1:8787
```

| Command | What it does |
|---|---|
| `pnpm test` | Every script in `tests/`. Run it before every commit |
| `pnpm typecheck` | TypeScript check. It does not cover inline JavaScript in `.html` files, so changed page scripts need a test |
| `pnpm build` | Builds the Worker into `dist/` |
| `pnpm dev` / `pnpm start` | Dev server on port 5173 / the built Worker on port 8787 |
| `pnpm e2e [screenshot-folder]` | The browser walkthrough: the owner, a coach and two families through every feature in Chromium on a fresh local database, with stand-ins for Supabase and USA Wrestling, and an accessibility check on every page. Needs `pnpm exec playwright install chromium`. Ports: `E2E_PORT`, `E2E_AUTH_PORT`, `E2E_USAW_PORT`. Failed steps save screenshots to `e2e-failures/` |
| `pnpm e2e:payments` | Online payment rehearsal in Stripe test mode against `stripe-mock` (`go install github.com/stripe/stripe-mock@v0.197.0`). Ports: `E2E_PORT`, `E2E_AUTH_PORT`, `E2E_STRIPE_PORT` |
| `pnpm restore:drill` | Restores a downloaded backup into a local copy and compares every table ([docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md)) |
| `pnpm db:generate` | Adds a migration after a change to `db/schema.ts` |
| `pnpm audit --prod` | Production dependency audit, as CI runs it |

The walkthrough and the payment rehearsal never use real accounts. CI runs the tests, typecheck, build, audit, walkthrough and payment rehearsal on every pull request.

## Where things are

| Path | Contents |
|---|---|
| `app/*/route.ts`, `app/*/screen.html` | Server-rendered pages: the route checks access and serves the HTML next to it |
| `app/api/*/route.ts` | JSON API routes |
| `app/portal.html` | The owner dashboard and its settings editors |
| `lib/` | Shared server logic: sign-in, pricing (`quotes.ts`), payments, program rules, cards, documents, backups |
| `lib/workspace/` | The owner dashboard's typed rules, bundled to `/portal-workspace.js` |
| `db/schema.ts`, `drizzle/` | Database schema and ordered migrations |
| `build/worker.ts` | The Worker entry point and the daily scheduled job |
| `public/` | Shared styles, page scripts, fonts and brand images |
| `tests/`, `scripts/e2e/` | Node test scripts; the browser walkthrough and payment rehearsal |
| `docs/` | Everything else to read, indexed in [docs/README.md](docs/README.md) |

## Rules that protect the live site

- Production is published only by the Deploy workflow, from `main`, after every check passes, and it backs up the live database first. Never deploy, run remote database commands or set secrets from your own machine.
- Never point local work at the production database or production Supabase project.
- Never commit secrets. The repository is public.
- The academy has left ChatGPT Sites and ChatGPT; nothing here depends on them.

The full list is in [CLAUDE.md](CLAUDE.md), which Claude Code also follows.
