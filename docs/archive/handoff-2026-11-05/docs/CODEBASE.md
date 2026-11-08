# Codebase overview

## Main source areas

| Path | Role |
|---|---|
| `app/route.ts` | Owner/MFA gate for the main workspace |
| `app/portal.html` | Owner administration and sample parent/wrestler views, local UI state, save queue, scheduling, sample attendance/commerce/messages, transfer history |
| `app/*/route.ts` and `screen.html` | Standalone server-rendered raw HTML pages for real account and workflow services |
| `app/api/*/route.ts` | Auth, settings, profiles, scheduling projections, registration reviews, approvals/chat, plans/curricula, staff, scholarships and backups |
| `lib/account-auth.ts`, `access-control.ts`, `protected-page.ts` | Session validation, owner identity, role lookups, private page guards |
| `lib/registration-catalog.ts`, `public-schedule.ts`, `friday-live.ts`, `program-names.ts` | Public projections, prices, program naming, dated offerings and semester schedule generation |
| `lib/program-approval.ts`, `academy-validation.ts` | Grade/approval rules, team discounts and validation of the settings document |
| `lib/scholarships.ts`, `scholarship-signatures.ts`, `scholarship-agreement.ts` | Invitation/award data, value calculation, draft terms, signature validation and signed-copy rendering |
| `lib/practice-plans.ts`, `backup-records.ts`, `stripe-test.ts`, `rate-limit.ts`, `security-events.ts` | Shared backend constraints and security/integration utilities |
| `db/schema.ts`, `drizzle/` | 15 D1 tables, Drizzle metadata, and 13 ordered schema migrations |
| `public/` | Approval chat, camera scanner, backup crypto, QR encoder/decoder and shared CSS |
| `config/stripe-test-catalog.json` | Test product/price IDs and intended term metadata; no credentials |
| `components/`, `hooks/`, `app/globals.css` | Largely starter React/shadcn scaffolding, not the main raw-HTML UI architecture |
| `build/`, `vendor/`, `lib/connector-*` | Tracked Sites/Vinext Worker integration and connector transport scaffolding |
| `scripts/`, `vite.config.ts`, `next.config.ts` | Execution profiles, install/build wrappers and local Cloudflare bindings |
| `.openai/hosting.json` | Existing Sites project identity and `DB` D1 binding; R2 is null |
| `tests/` | Node assertion/VM/SQLite tests; no package-level test script or verified CI pipeline |

## Important state representations

`academy_state` uses one key, academy, with a JSON payload and revision. The payload holds program metadata, semester schedules, named paid practices, events, and team codes. It also holds preview-only kids, bookings, attendance, family directory entries, announcements, direct messages, sample access grants, availability and payout information. One stale global revision rejects the whole save; unsaved UI changes remain local until a reload or successful retry.

`family_accounts` stores a separate JSON profile per verified Supabase user. Each wrestler has an opaque stable ID, name and grade. This is the real family namespace used by registration review, approvals and scholarships. It is not linked to the owner sample kid array by a normalized athlete table.

`scholarship_awards` is a real entitlement record. Its accepted terms and signature snapshot are retained when the owner ends an award. An active scholarship can block duplicate paid registration review and can qualify a wrestler for member review pricing. No corresponding paid-membership table exists yet.

## Code-reading order

Read `lib/account-auth.ts`, `lib/access-control.ts`, `app/api/academy/route.ts`, `lib/registration-catalog.ts`, `app/api/registration/route.ts`, then `app/api/scholarship/route.ts`. Follow those into `db/schema.ts`. Finally inspect the owner workspace, because its user-visible breadth is much larger than its operational backend coverage.

Inline JavaScript in HTML is not typechecked by the normal TypeScript run. The confirmed finishEvent error demonstrates why passing the build and TypeScript check is insufficient for the sample admin flows.

The small `app/accounts/route.ts` page is a real owner-only read of family_accounts, capped at 500 profiles. It is separate from the sample family directory in portal.html.
