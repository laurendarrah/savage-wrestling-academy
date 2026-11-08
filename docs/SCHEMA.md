# Database schema and migrations

The academy's business data is in Cloudflare D1 (SQLite), bound to the Worker as `DB`. Supabase holds only sign-in accounts and authenticators. Checked against `db/schema.ts` and `drizzle/` on November 8, 2026 (#275, #271): 45 migrations, 48 tables. The November 5 handoff's version of this page (13 migrations, 15 tables, with `schema.sql` and `schema.json` exports) is in [the archive](archive/handoff-2026-11-05/README.md).

## Where the schema lives

- `db/schema.ts` is the Drizzle definition of every table, with a comment above each saying what it is for and which issue added it. Read it first.
- `drizzle/NNNN_*.sql` are the migrations, applied in order. `drizzle/meta/` holds Drizzle's snapshots and journal.
- The Deploy workflow applies new migrations to the live database before publishing. The walkthrough, the restore drill and most tests build their database from every migration.

To change the schema, edit `db/schema.ts`, then run `pnpm db:generate` to add a new migration. **Never edit, rename or reorder an existing file in `drizzle/`**, and never run a migration or query against the production database from your own machine (CLAUDE.md).

## Tables

| Table | What it holds |
|---|---|
| **Settings** | |
| `academy_state` | The academy settings document: programs, schedules, holidays, camps and events, team codes. One revisioned JSON row edited on the owner dashboard. Older documents can still hold unused sample data from the old workspace |
| `academy_settings` | Other owner settings, one JSON row per key: lesson prices and coach shares (`lessons`), the public website (`website`), owner-alert and daily-reminder markers |
| `integration_secrets` | The restricted Stripe key, encrypted with `STRIPE_CONFIG_ENCRYPTION_KEY` |
| **Families** | |
| `family_accounts` | Each family's profile and wrestlers, one JSON row per Supabase user |
| `program_approvals`, `approval_messages` | SWA Advance approval requests per wrestler, and the private chat about each |
| `usaw_reviews` | The owner's (or the automatic lookup's) verdict on a wrestler's USA Wrestling card |
| `usaw_lookups` | The latest check on USA Wrestling's verify page, also the one-day cache |
| `wrestler_passes` | QR entry passes, one active per wrestler |
| `waiver_versions`, `waiver_signatures` | Every signed document: waivers, the Parent Consent Form and coach contracts (`kind`), each published version and each signature |
| `signature_reissues` | Signatures the owner asked to be signed again, with the reason |
| `signature_carryovers` | Signatures the owner carried over to a wrestler's new name after a rename, with the reason (#271) |
| `booking_exceptions` | The owner's dated exceptions to the card, waiver and consent-form booking blocks |
| `data_requests` | Families' account-closure requests and how the owner handled them |
| `scholarship_awards` | Scholarship offers, frozen terms, acceptance and drawn signatures |
| **Money** | |
| `orders` | Every purchase: online (Stripe) and offline (cash, check), with the server-calculated price, status, and for memberships the paid-through term |
| `subscriptions` | Monthly memberships: one row per monthly order, ending after 12 payments |
| `installment_payments` | Monthly payments 2 to 12 as Stripe reported them: the amount collected and the price at the time, one row per counted invoice event (#271) |
| `stripe_events` | Every Stripe event id, stored once, so a repeated delivery changes nothing |
| `payment_refunds` | Stripe's cumulative refunded amount per card payment, from `charge.refunded` events |
| `payment_disputes` | Card disputes (chargebacks), one row per `charge.dispute.*` event: created, funds withdrawn, funds reinstated, closed |
| `stripe_fees` | Stripe's card fee per payment, read by the daily job |
| `cash_bookings` | Walk-ins, extra practices and camps, clinics or events booked to pay cash at the academy, linked to the offline order once paid. `dates` lists every day the booking covers (a full camp has several); `session_date` is the first |
| `membership_transfers` | The program a membership was in before each transfer, so earlier rosters stay right |
| `financial_entries` | Expenses and other income the owner types in for the books |
| **Sessions and coaches** | |
| `attendance` | Check-ins, one row per wrestler per session |
| `staff_access` | Coaches: email, name, programs, active |
| `coach_invites` | Single-use coach invitations (only a hash of the token) |
| `coach_profiles` | Coaches' public name, bio and specialties, and their phone for the academy |
| `coach_openings` | Lesson times coaches post, including partner and small-group lessons |
| `coach_time_entries`, `coach_time_off` | Coach hours (clock in and out, corrections, approval) and time off |
| `removed_coaches` | Coaches removed for good, whose records are deleted or anonymized after 3 years |
| `practice_plans`, `practice_curricula`, `practice_curriculum_groups` | Practice plans per program and date, and reusable curricula |
| **Messages** | |
| `announcements`, `announcement_recipients` | Owner announcements and who each one went to, with email status |
| `family_messages` | Private threads between the academy and a family |
| `notifications` | Automatic notices (card expiring, waiver to sign, payment recorded…), each sent once |
| **Running the site** | |
| `security_events` | The security log shown on `/security-log` |
| `error_log` | Recent server errors for Site health (last 500), with the request id and the role of whoever asked (#274) |
| `auth_attempts` | Rate-limit counters, one row per counter per minute (or hour) |

Indexes added in #274 for the pages that read these tables most: `orders(status,kind,program,term_start)`, `orders(status,kind,item_id)` and `orders(status,paid_at)` for rosters, payments and the books; `stripe_events(order_id,outcome)` for refund dates and installments; `security_events(created_at,id)` and `family_accounts(updated_at,user_id)` for the security log's and the family list's paging. `tests/query-plans.mjs` checks the plans.
| `recovery_snapshots`, `restore_guard`, `restore_staging` | Restore bookkeeping: snapshots taken before a restore, the guard that keeps a restore all-or-nothing, and uploaded parts of a large restore |
| `waitlist_entries` | **No longer used.** Waitlists were removed (#210); the table and its rows stay for backups, the family data download and the security log |

## Relationships

There are few foreign keys; the links are kept by the code:

- Supabase user ids (text) tie `family_accounts`, `orders`, approvals, scholarships, messages and openings to a person.
- Wrestler ids live inside the `family_accounts` JSON. Orders, approvals, card reviews, signatures, passes and attendance refer to them.
- Coaches are keyed by their `staff_access` email.
- Several tables use a `revision` or `updated_at` check so two people saving at once cannot overwrite each other.

Unique indexes and CHECK constraints guard the rules that matter most: one approval per wrestler and program, one active scholarship per wrestler, one check-in per wrestler per session, one signature per document version per wrestler and round, and one row per Stripe event.
