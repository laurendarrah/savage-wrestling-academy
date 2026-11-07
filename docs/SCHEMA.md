# Database schema and migrations

The application business database is Cloudflare D1, a SQLite-compatible database bound as DB. Supabase owns authentication users and factors in a separate service. No application Supabase business tables were identified.

The review applied all 13 original SQL migrations, in order, to an empty isolated SQLite database and exported the resulting 15-table schema. docs/schema.sql contains the actual resulting CREATE TABLE and index statements. docs/schema.json contains column and index metadata. Neither contains production records. This verifies migration replay on an empty SQLite database, not the applied migration version of the live D1 instance.

| Table | Purpose |
|---|---|
| academy_state | One revisioned JSON academy configuration and sample workspace state. |
| family_accounts | Real verified family profile JSON keyed by Supabase user ID. Separate from sample directory. |
| auth_attempts | Rate-limit counters keyed by identity/request bucket. |
| staff_access | Owner-managed coach access keyed by email, assigned programs stored in text. |
| coach_openings | Real coach availability windows. |
| security_events | Selected security/admin events, not comprehensive accounting audit. |
| recovery_snapshots | Limited legacy backup payloads in the same database. |
| restore_guard | Constraint-based restore validation support. |
| program_approvals | Per-family wrestler and program approval status. |
| approval_messages | Owner/parent thread messages for a program approval. |
| practice_plans | Per-program/date JSON practice plans, published flag and revision. |
| practice_curricula | Ordered lesson templates in curriculum groups, JSON payload and revision. |
| practice_curriculum_groups | Per-program named curriculum grouping. |
| integration_secrets | Encrypted restricted Stripe test credential, wrapping key outside DB. |
| scholarship_awards | Offer, recipient, frozen terms, status, acceptance and signature evidence. |

## Relationships and constraints

Supabase user IDs are stored as text in family_accounts, coach_openings, approvals and scholarship records. These references are application-managed across services. Wrestler IDs live inside family JSON and are referenced by approvals and awards. Sample kid IDs inside academy_state are a separate identity space.

Unique indexes enforce one approval per family/wrestler/program, one plan per program/date, distinct curriculum names within programs, distinct lesson names within a curriculum, unique invitation hashes, and one active scholarship per family/wrestler. CHECK constraints bound approval states, message roles, publication flags, scholarship states/readiness and restore validation. The schema does not provide a comprehensive foreign-key network or relational athlete/enrollment/payment model.

JSON payloads keep flexible UI state but move validation, relationship integrity, migration and concurrency responsibilities into application code. Several updates use optimistic revision matching. The single academy JSON document remains a contention and growth boundary.

No canonical paid memberships, Stripe event ledger, invoices, payment orders, durable capacity reservations, actual QR passes, real attendance ledger or waiver-evidence tables exist. These are dependencies for a production enrollment system.

## Migration lineage

- `0000_jazzy_silvermane.sql`
- `0001_harsh_ser_duncan.sql`
- `0002_funny_james_howlett.sql`
- `0003_lonely_valeria_richards.sql`
- `0004_fair_sentinels.sql`
- `0005_gigantic_blazing_skull.sql`
- `0006_brief_nomad.sql`
- `0007_spooky_reptil.sql`
- `0008_lumpy_nemesis.sql`
- `0009_faithful_bulldozer.sql`
- `0010_futuristic_vulcan.sql`
- `0011_nebulous_shinobi_shaw.sql`
- `0012_brainy_runaways.sql`

Drizzle's schema definitions live in db/schema.ts, with generated snapshots and journal in drizzle/meta. Inspect both the SQL history and current schema before generating a new migration. Do not overwrite past migrations or run the combined schema export on an existing populated database.
