# Savage account security

## Access model

- Supabase verifies email/password sessions. The backend validates the user with `getUser()` before reading private records.
- The verified owner email is `savagewrestlingclub@gmail.com`. Owner APIs additionally require AAL2 and an active verified TOTP factor. ChatGPT identity is not an alternative path into owner data.
- Coach access comes from the owner-managed `staff_access` table, queried on every protected request. Coaches require AAL2 and can access only their own coach openings. Assigned programs do not grant access to family records or owner settings. On lesson and practice rosters a coach sees the parent's name and phone, never the family's sign-in email (#274).
- Families are scoped by the verified Supabase user ID, never an ID provided in a request body. Optional family TOTP is enforced on private family APIs after enrollment.
- Mutating endpoints validate same-origin JSON requests. Authentication and MFA attempts are limited by originating IP and target account, with separate counters for sign-in, sign-up, password reset and confirmation email (10 a minute per email, 30 a minute per address, 30 an hour per email for sign-in); sign-out and password changes are counted per signed-in account, never under a shared key (#274). Supabase also applies its own limits.
- Session cookies are HttpOnly, Secure, and SameSite=Lax. Private responses are no-store. Credentials and authenticator secrets are not written to application logs or profile tables.
- Who is asking is worked out once per request (`lib/account-auth.ts`): one `getUser()` call to Supabase, with the authenticator level read from the session token; every call to Supabase and to the email provider gives up after a few seconds. `SUPABASE_URL` must be https, like `APP_ORIGIN`, except a local stand-in on loopback. When Supabase cannot be reached, routes answer 503 ("Sign-in is temporarily unavailable") and pages say so; nobody is signed out and Site health shows the outage (#274).
- Signed-in pages carry `Content-Security-Policy` with `script-src 'nonce-…' 'strict-dynamic'`: only the scripts the Worker tagged for that response can run, so markup that reaches a page cannot run code. The nonce is fresh per response and never cached. Pages that still use inline event handlers are listed in `tests/csp-nonce.mjs` and the list may only shrink. A `Permissions-Policy` allows the camera (for the pass scanner) and nothing else. `tests/html-escaping.mjs` fails on any value written with `innerHTML` that is not escaped or a number, date, id or fixed word (#274).
- Every API route is wrapped in `withApi()` (`lib/api.ts`): a failure answers JSON with a request id, which the page shows as a reference, and is recorded in `error_log` with the id, the path (never the query string) and the role of whoever asked, with emails, quoted text, ids and long values redacted from the message (#274).

## Enrollment and recovery

Owners and coaches must complete `/security` after email/password sign-in. Add a backup authenticator before relying on the account. Password-reset email cannot substitute for an authenticator check on owner or coach data. Supabase dashboard and email-account MFA must be configured separately by the account holder.

## Backups

`/backups` is owner/AAL2-only. Exported files are encrypted in the browser using AES-256-GCM with a random 16-byte salt, 12-byte IV, and PBKDF2-SHA256 with 600,000 iterations. The backup passphrase is never sent to the server. No passwords, MFA secrets, sessions, or staff access grants are exported.

Since issue #221 the export is streamed from the Worker as lines of JSON, a batch at a time, and the browser gzip-compresses it before encrypting it (format `savage-encrypted-backup-v2`: one JSON line naming the format, salt and IV, then the ciphertext; that whole first line is the AES-GCM authenticated data). The key derivation and cipher are unchanged. Compression happens before encryption in the owner's own browser on the owner's own records, so no attacker-controlled data shares a compressed stream with secrets. Files in the earlier `savage-encrypted-backup-v1` format still restore.

Restores validate project identity and record shapes, check for concurrent changes, preserve current data in a recovery snapshot, and apply the restore in a single D1 batch transaction. A large file is uploaded in checked parts to the `restore_staging` table first (bound to the owner session that started it, removed when the restore ends, and by the daily job after a day); the final batch reads those parts inside D1, so it is still all or nothing. Matching records are replaced; records absent from a backup are retained. Prior revisions are incremented so stale browser saves are rejected. The last ten pre-restore snapshots are kept in D1. They are not independent disaster-recovery copies.

Downloads are manual. Separately, the Deploy workflow exports the whole live database and encrypts it with `BACKUP_PASSPHRASE` before each publish, kept 30 days as a workflow artifact. There is no scheduled off-site backup service. Store encrypted exports separately and retain the passphrase privately. Recovery is tested on isolated SQLite databases and, with `pnpm restore:drill`, on a local copy of the site ([docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md)); no production restore was performed.

## Retention

Nothing ages out automatically except what is transient: `auth_attempts` (rate-limit counters, by the minute), `error_log` (the last 500), unfinished restore uploads (after a day), the records of coaches removed more than 3 years ago (#212), and USA Wrestling lookups that found someone else's card or no card, which hold a stranger's name and are removed after their one-day cache window (#274). The rest waits on the retention policy ([docs/policies](docs/policies/README.md)).

## Tests

- `node tests/security-hardening.mjs`: owner and family MFA enforcement, no ChatGPT bypass, coach assignment/revocation and isolation, backup encryption/tamper checks, recovery snapshot, transactional restore and concurrent-change rollback.
- `node tests/rate-limit-keys.mjs`, `tests/api-errors.mjs`, `tests/csp-nonce.mjs`, `tests/html-escaping.mjs`, `tests/reminder-watch.mjs`, `tests/query-plans.mjs`: the #274 hardening: per-account rate-limit keys, the API error wrapper and Supabase-outage handling, the nonce script policy on every signed-in page, escaping of every `innerHTML` write, the watched morning reminders, and the query plans of the indexed pages.
- `node tests/owner-workspace.mjs`: settings and scheduling validation, durable saving, stale-write rejection and save queues.
- `pnpm audit --prod --json`: installed production dependency advisories; this is not a penetration test. It does not see vinext, `@vitejs/plugin-rsc` or `react-server-dom-webpack`, which are dev dependencies but partly bundled into the Worker. The full audit, what was fixed and what remains are in `docs/DEPENDENCY_ADVISORIES.md`.
- `pnpm typecheck` and `pnpm build`.

## Remaining launch work

Updated November 7, 2026 (#267). Open launch work is on the [Launch board (#246)](https://github.com/laurendarrah/savage-wrestling-academy/issues/246): switching the staff authenticator back on (#27), the restore drill (#25), the launch test pass (#24), live Stripe (#26) and the attorney review (#44). Sign-in email delivery needs a custom email sender, and leaked-password protection is a setting on the academy's Supabase project ([docs/GO_LIVE.md](docs/GO_LIVE.md) section 6). The data retention policy is a draft ([docs/policies](docs/policies/README.md)). There has been no independent penetration test. The November 5 review's findings and where each went are in [docs/ISSUES.md](docs/ISSUES.md).


## Competition program approvals and conversations

Every SWA Advance wrestler (grades 7–12) requires an owner approval decision before monthly or walk-in registration review. Approval records use the verified parent account, wrestler ID, name, and grade; edited identity fields require renewed approval. Owner decisions require MFA and reject stale requests. Approval alone never grants a paid membership. Registration review and Stripe checkout both price and check eligibility through `lib/quotes.ts`, which reuses the server approval check.

Each approval conversation is accessible only to its verified parent account and the owner with MFA. Server-side sender roles, text-only rendering, bounded messages, CSRF checks, and rate limits protect the thread. Conversations are stored in D1; email notifications follow the family notices (#105) once email is on (#35). Backups include approval decisions and chat messages (#78); approval grants must not be restored through family-controlled backup content.


## Practice plans

Practice plans are owner-authored, revision-checked D1 records keyed to a scheduled date and program. Owner and coach access requires MFA. Only the owner may write or share a plan; active coaches may read only published plans in their currently assigned programs that still have a scheduled practice. Family accounts have no access. Deleted schedules and days off hide a plan from coaches while preserving the owner record. Plan content is rendered as text. Past plans remain available by month. Encrypted backups include practice plans (#78); individual plans can also be printed or saved as PDF from the owner or assigned coach view.


Reusable curricula are owner-only revision-checked D1 records. Applying one copies its ordered sections into a daily draft; later curriculum edits never modify existing daily plans or publish content automatically. Curriculum records, like practice plans, are included in the encrypted backup (#78).


Program curricula now group owner-only lessons under a fixed program. Lesson names are unique within a curriculum; curriculum names are unique within a program. Program changes do not move existing curricula or lessons. Daily selection filters by the scheduled practice's program, then copies the lesson into the daily draft for explicit save/share. Earlier unfiled plans remain intact and can be explicitly copied into a selected curriculum. The curriculum builder does not require a scheduled practice.
