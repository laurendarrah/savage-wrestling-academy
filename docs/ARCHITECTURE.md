# Architecture

How the site is built and where things run, checked against the code on November 7, 2026 (#267). The November 5 handoff's version of this page described the ChatGPT Sites deployment and its sample workspace; it is in git history and in [the archive](archive/handoff-2026-11-05/README.md).

## Where it runs

The site is one Cloudflare Worker with one D1 database, on the academy's own Cloudflare account (#100, #119). The **Deploy** GitHub workflow publishes `main` there after the Checks workflow passes, and only while the repository variable `DEPLOY_ENABLED` is `true`. Each run backs up the live database (encrypted with `BACKUP_PASSPHRASE`, kept 30 days as a workflow artifact), applies new migrations, publishes, then checks `/api/health`. Nobody deploys from their own machine. Setup and cut-over steps are in [GO_LIVE.md](GO_LIVE.md); what to do when a run fails is in [RUNBOOK.md](RUNBOOK.md).

There is no ChatGPT Sites or ChatGPT code or tooling left in the repository.

## Stack

| Layer | What it is |
|---|---|
| Runtime | Cloudflare Workers, `nodejs_compat`. Entry point `build/worker.ts` |
| Framework | Vinext `1.0.0-beta.5` (Next.js App Router file conventions on Vite 8). Every route is a `route.ts` handler; there are no React pages |
| Pages | Server-rendered HTML with inline JavaScript: `app/<page>/screen.html` imported with `?raw` by `app/<page>/route.ts`, plus `app/portal.html` for the owner dashboard |
| Business data | Cloudflare D1 (SQLite), bound as `DB`, queried with prepared SQL. Drizzle is used only for the schema in `db/schema.ts` and to generate migrations in `drizzle/` |
| Sign-in | Supabase Auth (`@supabase/ssr`), sign-in only. No business data is stored in Supabase |
| Payments | Stripe (SDK 23, API `2026-09-30.endive`), test mode unless `STRIPE_MODE=live` |
| Email | Resend's batch API (`lib/email.ts`), off until `EMAIL_API_KEY` and `MAIL_FROM` are set |
| USA Wrestling cards | Server-side lookup on USA Wrestling's public verify page (`lib/usaw-lookup.ts`, `lib/usaw-check.ts`) |
| Package manager | pnpm `11.25.0` with a committed lockfile and a supply-chain policy in `pnpm-workspace.yaml` (minimum release age, allowed build scripts) |
| Node | 22.13 or newer locally; CI and Deploy use Node 24 |

Exact versions are in `package.json`.

## A request

1. The Worker (`build/worker.ts`) hands the request to Vinext, which dispatches it to the matching `app/**/route.ts`.
2. The route checks who is asking on the server (below), reads or writes D1, and returns HTML or JSON. Pages fetch their data from `/api/*` routes with same-origin JSON requests.
3. On the way out, `lib/page-chrome.ts` adds the shared look to every HTML page: `public/savage.css` (the design system: tokens, type, buttons and components, #280), the toast helper `public/toast.js`, the brand icons and the top bar (#129). The public pages (`/welcome`, `/team`, `/calendar`, `/login`, `/coach-join`, `/help`) open with the black header band; every signed-in page opens with a title row, with the rest of a long intro behind "How this works". A family's pages (`/family`, `/register`, `/booking`, `/lesson`, `/inbox`, `/pass`, `/wrestler`, `/waiver`, `/consent`, `/scholarship`) carry the family's links in the top bar and, on a phone, a five-item tab bar (Home, Calendar, Pass, Messages, Account; `familyTabs()`, #282). Owner pages a route has marked with `markOwnerShell()` also get the owner shell: the same sidebar and header everywhere (`lib/owner-shell.ts`, `lib/owner-nav.ts`, `public/owner-shell.css`, `public/owner-shell.js`, #261). Printable documents (signed agreements and waivers) stay undecorated.
4. Every API route is wrapped in `withApi()` (`lib/api.ts`): a failure answers `{error, requestId}` and is recorded in `error_log` with the request id, the path and the role (redacted); a Supabase outage is a 503, not a sign-out. Any other response of 500 or more is recorded by the Worker. Site health shows them, and the owner is emailed at most once an hour (`lib/site-health.ts`, `lib/owner-alerts.ts`). On the way out, signed-in pages without inline handlers get a per-response `script-src` nonce on every script (`lib/page-chrome.ts`).

A daily Cron Trigger (12:41 UTC, set in `vite.config.ts`) sends card and waiver reminders, cleans up coaches removed more than 3 years ago, reads Stripe card fees, clears abandoned restore uploads and purges stale USA Wrestling lookups (`build/worker.ts`). No page load runs the reminders; after 10 AM New York the Worker checks once per isolate per day, in the background, that the run happened, and otherwise records the miss and runs them (`lib/reminder-watch.ts`, #274).

## Who can do what

`lib/account-auth.ts` builds the Supabase server client and checks the session with one `getUser()` per request (memoised; the authenticator level comes from the session token, #274). `lib/access-control.ts` turns the signed-in user into a role:

| Role | Who | How |
|---|---|---|
| Owner | The one verified email `OWNER_EMAIL` in `lib/account-auth.ts` | Needs a verified authenticator code (AAL2) |
| Coach | An active row in `staff_access`, granted by an owner invite (`lib/coach-invites.ts`) | Needs AAL2. The owner can add himself as a coach |
| Family | Any other verified account | Optional authenticator; once set up it is always required |
| Anonymous | Signed out | Public pages only |

`STAFF_MFA=off` on the Worker temporarily lets staff without an authenticator sign in before launch (#204, `lib/mfa-policy.ts`); the owner's launch checklist shows it in red while it is off. `lib/protected-page.ts` holds the page guards (`ownerPage`, `coachPage`). Hidden links never grant access: every route checks again on the server. Mutations are same-origin JSON, rate-limited per feature (`lib/rate-limit.ts`), and sensitive actions are written to `security_events` (`/security-log`).

## The data

Everything the academy owns is in D1; [SCHEMA.md](SCHEMA.md) lists the tables. Three things to know:

- **Academy settings.** Programs, practice schedules, holidays, camps and events, and team codes are one revisioned JSON document in `academy_state`, edited on the owner dashboard and read by the welcome page, calendar and booking. Other owner settings (lesson prices, the public website, and the alert and daily-reminder markers) are one JSON document per key in `academy_settings`. Older settings documents can still hold sample `kids`, `bookings`, `messages`, `offers` and `staff` from the old workspace; nothing reads them.
- **Families.** Each family's profile and wrestlers are one JSON document per Supabase user in `family_accounts`. Wrestler ids inside it are what orders, approvals, cards, waivers, passes and attendance refer to.
- **Money.** An order is created before Stripe Checkout and becomes paid only in `lib/stripe-webhook.ts` after the signature is verified. Every Stripe event id is stored once in `stripe_events`. Prices come only from `lib/quotes.ts`, for the review screen and checkout alike. Offline payments (cash, check) are orders with `source='offline'`. Each purchase type stays closed until `CHECKOUT_KINDS` lists it (`lib/checkout-config.ts`).

Backups: the owner downloads a browser-encrypted file of every business record from **Backups** (sign-in accounts live in Supabase; coach access and invites, the encrypted Stripe key, and transient tables such as rate limits and the error log are left out on purpose, as listed at the top of that file) (`lib/backup-records.ts`, `public/security-backup.js`) and can restore one there; the Deploy workflow also exports the whole database before each publish. `pnpm restore:drill` proves a file restores into a local copy ([RESTORE_DRILL.md](RESTORE_DRILL.md)).

## The owner dashboard

`app/portal.html` (about 95 KB) is the owner's home at `/`. It opens on today (#283): the date and the day's facts in the title row, four tiles, "Tonight on the mat", "Needs you" (where the launch checklist's open items live, #123), "Coming up" and "This month", all read from the existing `/api/*` answers. It also holds the editors for programs, schedules, camps and events, and team codes, reached by the `/#programs`, `/#schedules`, `/#events` and `/#practice-calendar` deep links, and the practice calendar: a month grid of program-coloured bars with a day panel, or a week list on a phone. It has no sample screens (#147). Its program, grade, schedule, event and price rules are typed modules in `lib/workspace/`, which `scripts/workspace-script.mjs` bundles into `/portal-workspace.js` (a Vite plugin in `vite.config.ts` serves it in development and writes it into the build, #45). The page's own inline script only draws and saves.

Every other owner tool is its own page, listed once in `lib/owner-nav.ts`: four groups (Today, Families, Academy, Settings & records folded) of about fourteen items. Pages that merged into one item keep their addresses (`also`: the waiver, consent form and contract pages under Cards & documents; scholarships and transfers under Approvals & scholarships; lesson prices and coach hours under Coaches & lessons; coach pay under Money) and get a switch under their title row (`tabs`, drawn by the Worker in `lib/page-chrome.ts`); a dashboard section without its own item keeps its deep link `under` the item that shows it. `OWNER_SHELL_PAGES`, the set of pages inside the shell and its View Transitions, is unchanged by the fold. `public/owner-shell.js` fills the count badges beside Payments (failed monthly payments) and Cards & documents (cards waiting to be verified) from the same API answers the pages read, once a minute per tab.

## Domain rules that live in one place

| Rule | Source of truth |
|---|---|
| Program grades and SWA Advance approval | `lib/program-approval.ts` (workspace code must match it) |
| Prices, discounts, eligibility for every purchase | `lib/quotes.ts` |
| Which purchase types are open online | `CHECKOUT_KINDS`, read in `lib/checkout-config.ts` |
| Seat limits for camps and events | `lib/capacity.ts` (there are no waitlists, #210) |
| USA Wrestling card rules and the renewal window | `lib/usaw.ts` |
| Waivers, the Parent Consent Form and coach contracts | `lib/documents.ts` (`lib/waivers.ts` keeps the waiver's names) |
| Email links | `appOrigin()` in `lib/account-auth.ts`, from `APP_ORIGIN` |

## Tests

| Command | What it covers |
|---|---|
| `pnpm test` | About 100 Node scripts in `tests/`. Each loads the real route and `lib/` files through a TypeScript transpile in a VM, against an in-memory `node:sqlite` database built from every migration, with stand-ins for Supabase and Stripe. Page scripts run in a small fake DOM, because inline JavaScript in `.html` files is not typechecked |
| `pnpm typecheck` | `tsc` over the TypeScript. Says nothing about inline page JavaScript |
| `pnpm e2e` | The walkthrough: builds the Worker, runs it on a fresh local D1 with stand-ins for Supabase (`scripts/e2e/fake-supabase.mjs`) and USA Wrestling (`scripts/e2e/fake-usaw.mjs`), and walks the owner, a coach and two families through every feature in Chromium (`scripts/e2e/journey.mjs`), with an accessibility check on every page |
| `pnpm e2e:payments` | Online payment against Stripe's official `stripe-mock` (`scripts/e2e/payments.mjs`) |

CI (`.github/workflows/ci.yml`) runs the tests, typecheck, build and `pnpm audit --prod` in one job, and the walkthrough plus the payments rehearsal in a second, on every pull request.

## What stays outside the code

- Supabase email templates are pasted into the Supabase dashboard by hand ([email-templates](email-templates/README.md)).
- Worker settings and secrets live in Cloudflare; GitHub holds the Deploy secrets and variables. `.env.example` lists every setting the code reads.
- Policies (privacy, refunds, retention, membership terms, the Parent Consent Form) are drafts for the attorney in [policies](policies/README.md). Nothing is published until approved.
