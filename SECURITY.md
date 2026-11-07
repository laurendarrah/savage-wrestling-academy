# Savage account security

## Access model

- Supabase verifies email/password sessions. The backend validates the user with `getUser()` before reading private records.
- The verified owner email is `savagewrestlingclub@gmail.com`. Owner APIs additionally require AAL2 and an active verified TOTP factor. ChatGPT identity is not an alternative path into owner data.
- Coach access comes from the owner-managed `staff_access` table, queried on every protected request. Coaches require AAL2 and can access only their own coach openings. Assigned programs do not grant access to family records or owner settings.
- Families are scoped by the verified Supabase user ID, never an ID provided in a request body. Optional family TOTP is enforced on private family APIs after enrollment.
- Mutating endpoints validate same-origin JSON requests. Authentication and MFA attempts are limited by originating IP and target account. Supabase also applies its own limits.
- Session cookies are HttpOnly, Secure, and SameSite=Lax. Private responses are no-store. Credentials and authenticator secrets are not written to application logs or profile tables.

## Enrollment and recovery

Owners and coaches must complete `/security` after email/password sign-in. Add a backup authenticator before relying on the account. Password-reset email cannot substitute for an authenticator check on owner or coach data. Supabase dashboard and email-account MFA must be configured separately by the account holder.

## Backups

`/backups` is owner/AAL2-only. Exported files are encrypted in the browser using AES-256-GCM with a random 16-byte salt, 12-byte IV, and PBKDF2-SHA256 with 600,000 iterations. The backup passphrase is never sent to the server. No passwords, MFA secrets, sessions, or staff access grants are exported.

Since issue #221 the export is streamed from the Worker as lines of JSON, a batch at a time, and the browser gzip-compresses it before encrypting it (format `savage-encrypted-backup-v2`: one JSON line naming the format, salt and IV, then the ciphertext; that whole first line is the AES-GCM authenticated data). The key derivation and cipher are unchanged. Compression happens before encryption in the owner's own browser on the owner's own records, so no attacker-controlled data shares a compressed stream with secrets. Files in the earlier `savage-encrypted-backup-v1` format still restore.

Restores validate project identity and record shapes, check for concurrent changes, preserve current data in a recovery snapshot, and apply the restore in a single D1 batch transaction. A large file is uploaded in checked parts to the `restore_staging` table first (bound to the owner session that started it, removed when the restore ends, and by the daily job after a day); the final batch reads those parts inside D1, so it is still all or nothing. Matching records are replaced; records absent from a backup are retained. Prior revisions are incremented so stale browser saves are rejected. The last ten pre-restore snapshots are kept in D1. They are not independent disaster-recovery copies.

Downloads are manual. There is no scheduled off-site backup service yet. Store encrypted exports separately and retain the passphrase privately. Recovery has been tested using an isolated SQLite database; no production restore was performed.

## Tests

- `node tests/security-hardening.mjs`: owner and family MFA enforcement, no ChatGPT bypass, coach assignment/revocation and isolation, backup encryption/tamper checks, recovery snapshot, transactional restore and concurrent-change rollback.
- `node tests/owner-workspace.mjs`: settings and scheduling validation, durable saving, stale-write rejection and save queues.
- `pnpm audit --prod --json`: installed production dependency advisories; this is not a penetration test. It does not see vinext, `@vitejs/plugin-rsc` or `react-server-dom-webpack`, which are dev dependencies but partly bundled into the Worker. The full audit, what was fixed and what remains are in `docs/DEPENDENCY_ADVISORIES.md`.
- `tsc --noEmit` and the Sites production build.

## Remaining launch work

Production authentication email delivery and the end-to-end reset flow still need verification. Supabase's leaked-password protection is not enabled on the Free project. Coach availability is not yet synchronized into paid customer booking. Payments, entry QR verification, message delivery, and customer-facing enrollment remain unfinished. An independent review, operational monitoring, data-retention policy, and off-site recovery process remain needed before handling sensitive customer information at production scale.


## Competition program approvals and conversations

Every SWA Advance wrestler (grades 7–12) requires an owner approval decision before monthly or walk-in registration review. Approval records use the verified parent account, wrestler ID, name, and grade; edited identity fields require renewed approval. Owner decisions require MFA and reject stale requests. Approval alone never grants a paid membership. Future checkout and payment activation must reuse the server approval check; no checkout is active yet.

Each approval conversation is accessible only to its verified parent account and the owner with MFA. Server-side sender roles, text-only rendering, bounded messages, CSRF checks, and rate limits protect the thread. Conversations are stored in D1; email/SMS notifications are not connected. The current manual backup export/restore covers academy settings, family profiles, and coach openings only; it does not yet include approval decisions or chat messages. Approval grants must not be restored through family-controlled backup content.


## Practice plans

Practice plans are owner-authored, revision-checked D1 records keyed to a scheduled date and program. Owner and coach access requires MFA. Only the owner may write or share a plan; active coaches may read only published plans in their currently assigned programs that still have a scheduled practice. Family accounts have no access. Deleted schedules and days off hide a plan from coaches while preserving the owner record. Plan content is rendered as text. Past plans remain available by month. Current manual encrypted backups do not yet include practice plans; individual plans can be printed or saved as PDF from the owner or assigned coach view.


Reusable curricula are owner-only revision-checked D1 records. Applying one copies its ordered sections into a daily draft; later curriculum edits never modify existing daily plans or publish content automatically. Curriculum records, like practice plans, are not yet included in the manual encrypted backup tool.


Program curricula now group owner-only lessons under a fixed program. Lesson names are unique within a curriculum; curriculum names are unique within a program. Program changes do not move existing curricula or lessons. Daily selection filters by the scheduled practice's program, then copies the lesson into the daily draft for explicit save/share. Earlier unfiled plans remain intact and can be explicitly copied into a selected curriculum. The curriculum builder does not require a scheduled practice.
