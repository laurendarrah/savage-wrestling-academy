# Architecture

## Deployment and application shape

The live origin is `https://savage-registration-preview.justinaccordino546.chatgpt.site`. Despite the word preview in the hostname, it is the current published Sites deployment. No separate staging environment was verified.

ChatGPT Sites publishes a Cloudflare Worker built with Vinext and Vite. The project uses Next.js App Router-compatible route files, but its main product screens are raw HTML/CSS/JavaScript returned from route handlers. `app/portal.html` is an approximately 155 KB monolithic owner workspace. Standalone account, registration, schedule, scholarship, and planning pages live in route-specific `screen.html` files. React and shadcn-style components are installed, while much of that component tree is starter scaffolding.

## Stack verified from package and lock files

| Layer | Implementation |
|---|---|
| Language | TypeScript backend; inline JavaScript in HTML; JavaScript tooling |
| Framework | Vinext `1.0.0-beta.5`; Next.js dependency `16.3.8`; React/React DOM `19.2.6` |
| Build | Vite `8.0.13`; Cloudflare Vite plugin `1.37.1`; Wrangler `4.92.0` |
| Data access | Cloudflare D1 with raw prepared SQL; Drizzle ORM `0.45.2` and Drizzle Kit `0.31.10` for schema/migration definitions |
| Identity | Supabase Auth through `@supabase/ssr` `0.12.7` and `@supabase/supabase-js` `2.117.3` |
| Payments | Stripe SDK `23.0.0`, API version `2026-09-30.endive`; test account only |
| QR | Bundled jsQR `1.4.0`, camera/image scanning, local sample-pass generation |
| Runtime | Cloudflare Workers; local Node observed at `24.22.1`; package minimum `22.13.0` |
| Package manager | pnpm `11.25.0`, committed lockfile and supply-chain policy |
| Styling | Hand-authored CSS for core pages; responsive shared stylesheet; Tailwind/shadcn dependencies also present |
| Tests | 18 Node scripts using assertions, VM-transpiled TypeScript, and isolated `node:sqlite` databases |

## Request and data flow

Browser requests reach a Sites-managed Worker. Vinext dispatches them to the route handlers under `app/`. Public calendar endpoints project only approved public fields from the owner settings blob. Private handlers validate the Supabase session, derive the role and account ID on the server, and then query D1. The principal account role is owner, coach, family, or anonymous.

Supabase Postgres is used by the connected service for authentication. The application does not store academy business tables in Supabase Postgres and does not use Supabase `.from()` or RPC calls in its business code. The academy data belongs to Cloudflare D1. No R2 bucket is bound in the hosting manifest.

The Worker can contact Stripe to verify the expected test account when saving a restricted test key. The code has no Checkout creation route or signed payment-webhook handler. A disabled Stripe webhook endpoint exists externally, targeting a route that is absent from this source snapshot.

## Three data surfaces

| Surface | Storage and trust boundary | Consequence |
|---|---|---|
| Owner workspace | One revisioned `academy_state.payload` JSON document plus server-managed planning tables | Programs and schedules are published from here; sample kids, purchases, rosters, direct messages, attendance, and payouts also live in this blob |
| Real family and staff services | Per-user `family_accounts`, coach openings, approvals/chat, curricula/plans, scholarship tables | Authenticated ownership checks govern these records; they are not automatically synchronized into the sample admin directory |
| Public demonstrations | Fictional data in the browser tab; network-blocking CSP on demos | Useful for interaction review, but not an operational roster or financial ledger |

## Authentication and authorization

`lib/account-auth.ts` creates the Supabase SSR client and validates each session with `getUser()`. Cookies are HttpOnly, Secure, and SameSite=Lax. Private responses use no-store headers. Mutations generally require same-origin JSON requests.

Owner authorization is hard-coded to the verified email `savagewrestlingclub@gmail.com` and requires AAL2 with a verified TOTP factor. Coaches are granted through `staff_access` and also require AAL2. Families use their verified Supabase user ID, and optional family MFA is enforced after a factor is enrolled. General admin and reviewer roles are not implemented. The sample Admin role shown in the workspace is not equivalent to a backend permission grant.

ChatGPT sign-in helpers and connector infrastructure remain in the starter. They are not a bypass into the owner workspace. Core account data uses Supabase authentication rather than trusting a browser-supplied user ID or ChatGPT display identity.

## Service observations

Sites reports version 70 deployed successfully with the same source commit as this package. Runtime environment revision 3 lists `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `STRIPE_CONFIG_ENCRYPTION_KEY`, and `STRIPE_TEST_WEBHOOK_SECRET`. Secret values were not retrieved or included.

The connected Supabase project is Savage Wrestling Academy LLC, ref `mdxyylvdgntkjfuiovxi`, region `us-east-1`, status `ACTIVE_HEALTHY`, with a Postgres 17 service. This is a control-plane health observation, not verification of email delivery, recovery, RLS configuration, or business data stored in D1.

Stripe exposes Savage Wrestling Academy LLC in test mode. The nine active test prices match three program products, each with $200 monthly, $40 walk-in, and $2,400 upfront prices. The monthly Price objects themselves do not enforce a 12-payment stop. Subscription scheduling and paid entitlements remain to be built.

## AI development versus AI product features

The current development workflow used ChatGPT Work/Codex, Sites, terminal tools, connected Supabase and Stripe tools, and browser-based QA. The repository contains no implemented LLM client, model prompt pipeline, AI assistant feature, RAG index, or vector-search business workflow. Exact AI model versions and the full provenance of earlier generated code cannot be reconstructed from the Git commit messages.

The Sites source/deployment helpers and connector runtime live outside this repository as platform tooling. The application source, migration SQL, bundled QR libraries, build integration, and lockfile are included.
