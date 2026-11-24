# Data retention (DRAFT)

How long the academy keeps each kind of record, and what happens when a family asks to close their account or a coach is removed. The one automatic deletion today is a removed coach's records other than their pay records and signed contract, 3 years after their removal (below). Closure requests appear on **Data requests**, where the owner records what was done.

[Attorney: confirm the periods below against tax law (IRS: generally 3 to 7 years for business records), insurance requirements, and the statute of limitations for injury claims involving minors in New York, which can run until a few years after the child turns 18. That last point affects how long signed waivers should be kept.]

| Record | What it is | Proposed keep period | Why |
|---|---|---|---|
| Payments and refunds | Orders, amounts, dates, method | [Decision: 7 years] | Tax and accounting |
| Signed waivers | Text version, signature drawing, signer, date, and any request from the academy to sign again with its date and reason (the earlier signature is kept) | [Attorney: until the wrestler turns 18 plus the limitations period] | Liability defense |
| Scholarship agreements | Terms and signature | [Decision: 7 years after the scholarship ends] | Contract record |
| Attendance | Check-ins by date | [Decision: 3 years] | Safety and insurance questions |
| USA Wrestling card details and reviews | Number, expiration, academy review | [Decision: until the account is closed] | Needed only while training |
| USA Wrestling card checks (#202) | The latest check of each wrestler's card on USA Wrestling's public verify page: active or not, the name and state USA Wrestling shows, the date | Replaced by the next check; [Decision: removed when the account is closed] | Never their page. Not in backups: it is a one-day cache plus the latest result |
| Family profile | Parent name, phone, wrestlers, grades, home address, emergency contact | Until the account is closed | |
| Wrestler safety details | Birth date and allergies or medical notes | [Decision: until the account is closed, or sooner once the wrestler stops training] | Health information about a child: keep no longer than needed |
| Messages, approvals, notices | Conversations and notices | [Decision: 2 years, or until closed] | Customer service |
| Entry passes | Random QR codes | Until closed; replaced codes are kept revoked | Door security |
| Security log | Sign-ins and sensitive actions | [Decision: 2 years] | Security investigations |
| Error log | Failing page addresses | Last 500 entries (automatic) | Fixing problems |
| Encrypted backups | Full copies, kept off the site | [Decision: keep the last N, for example 12 weekly] | Disaster recovery |
| A coach's pay records and signed contract after they are removed permanently | Approved hours, lesson payments that name them, cash they collected, payments to them, W-9 status, pay share, signed contract | **Kept for good, under their name** (decided by Justin on #246, Nov 23, 2026; built in #401) | 1099s, audits, pay and contract questions after a coach leaves. See below |
| A coach's other records after they are removed permanently | Profile, invites, notices, time off, lesson times nobody booked, shifts never approved | **3 years from the removal date, then deleted automatically** (decided by Justin, #197 Q18; built in #212) | See below |

## When a family asks to close their account

Proposed steps for the owner (to confirm):
1. Confirm the request with the family (email or phone).
2. Check for anything still active: a membership in its term, an unpaid installment, or an upcoming paid session. [Decision: what happens to those.]
3. Remove what isn't needed: [Decision: profile details, card numbers, messages, notices, entry passes, waitlist entries (no longer collected since #210)].
4. Keep what must be kept (payments, signed waivers, scholarship agreements) until its period above ends.
5. Record what was done on **Data requests**. The family sees it in their account.

Steps 3 and 4 are done with **Delete this family account** on **Family accounts** (#259). The owner types the family's name to confirm, and it refuses while anything is still active (step 2). It removes the profile (parent, wrestlers, address and safety details), bookings, USA Wrestling card details and checks, entry passes, waitlist entries, booking exceptions, messages, notices and data requests. Payments and refunds are kept for the books, with the family's name, email and account replaced by "Deleted family". Signed waivers and Parent Consent Forms, scholarship agreements, check-ins and SWA Advanced approvals are kept unchanged, unless the owner ticks "This is a test account". The Security activity entry has counts only. The family's sign-in stays with Supabase until the owner deletes it there. [Decision: once the periods above are decided, change it to remove exactly the agreed records.]

## When a coach is removed permanently

Decided by Justin: a removed coach's pay records and signed contract are an archive, kept under their real name for good, never anonymized or deleted (on #246, Nov 23, 2026, #401). Their other records are kept for 3 years, then deleted (#197, question 18). [Attorney: confirm keeping contractor pay records and the signed contract indefinitely, and what the privacy policy should say about it.]

- **Removing access** on **Coaches** stops the coach signing in. Nothing is deleted, and the 3 years do not start.
- **Removing permanently** (only after access is removed and no booked lessons are still to come) deletes their profile, unbooked future lesson times and unused invites at once, and records the date. **Coaches** then lists them under "Removed permanently" with the date their other records go (that date plus 3 years), and **Pay records and contract**, which opens their archive: W-9 status, approved practice pay, lesson share, cash collected, payments to them, totals by year, and their signed contract.
- **The day after that date**, the site's daily job deletes the rest, apart from the archive. A large cleanup carries on over the following days. Each run that changes anything adds one line to the security log with counts only, never a name or email.
- **A coach who comes back** (on Coaches again) is never cleaned. Removed permanently again, the 3 years start again from the new date.
- **Coaches removed permanently before this was built** (#207, November 2026) get their removal date from the security log entry of their removal, at the next daily run.

What the cleanup does with each kind of record. The pay archive is kept exactly as it is, so a family's payment history, the books and the pay totals for past months stay the same. Records others depend on that are not pay records are kept with the coach replaced by "former-coach-…":

| Record | Table | What happens |
|---|---|---|
| Coach profile (name, bio, specialties, phone) | `coach_profiles` | Deleted (already at permanent removal) |
| Invites | `coach_invites` | Deleted |
| Lesson times nobody booked | `coach_openings` | Deleted |
| Lessons a family booked | `coach_openings` | **Archive:** kept as it is, with the coach |
| Lesson payments | `orders` | **Archive:** kept exactly as paid, with the coach's name and email |
| Approved shifts (the pay record for that period) | `coach_time_entries` | **Archive:** kept as they are, with the coach |
| Shifts never approved, or voided | `coach_time_entries` | Deleted |
| Payments the academy made to them (#370) | `coach_payments` | **Archive:** kept as they are, with the coach and the note |
| Whether the academy had their W-9 (#400) | `coach_w9` | **Archive:** kept. Only the day it came in is ever stored, never a tax ID |
| Time off | `coach_time_off` | Deleted, with the notices about it to the coach and to the coaches covering |
| Signed contract | `waiver_signatures` (coach contract), and `signature_reissues` for any request to sign it again | **Archive:** kept, with any request to sign it again |
| Notices to the coach | `notifications` | Deleted |
| Their lesson pay share | `academy_settings` (`lessons`) | **Archive:** kept under their email, so pay for past months adds up the same |
| Team page listing | `academy_settings` (`website`) | Removed from the list of coaches shown |
| Cash they collected at the door (pay at the academy, #248, #250) | `orders` | **Archive:** kept exactly as paid, with who collected it |
| Check-ins they made | `attendance` | The check-in stays (the family's attendance); "checked in by" becomes "former-coach-…" |
| Practice plans they edited | `practice_plans` | The plan stays; "last edited by" becomes "former-coach-…" |
| Security log entries naming them | `security_events` | Kept; their email and, on coach actions, their account become "former-coach-…" |
| Recovery snapshots (the copy of lesson times the site keeps before each restore, last 10) | `recovery_snapshots` | Their email becomes "former-coach-…" |
| The removal record itself | `removed_coaches` | Kept with the email, name and removal date: it indexes the archive. A one-way hash of the email also stays (see Backups) |

Not changed by the cleanup: family notices and announcements that mention a coach by name (they follow the messages and notices period above), the coach's own sign-in account with Supabase (the owner deletes it there if wanted), and copies outside the site such as Stripe receipts and emails already sent.

### Backups

A backup restored later must not quietly bring a cleaned coach back.

- **Restoring a file on Backups** puts back rows that are missing. Straight after a restore, the site runs the cleanup again, so a cleaned coach's deleted rows are deleted again at once; the archive is left as it is. It finds them through the email, or the hash of the email, kept in `removed_coaches`. Coaches cleaned before #401 have only the hash.
- **Backup files and the Deploy backup include `removed_coaches`**, with each coach's removal date. A database rebuilt from a backup alone keeps every coach's 3-year clock, and the next daily run cleans whatever is due.
- **A file made before a coach was removed permanently** has no removal record for them. Restored into a new, empty database, it brings that coach back as they were then, with no clock. Check **Coaches → Removed permanently** after such a restore and remove them permanently again. Deploy backups are kept 30 days, so this only matters for files the owner keeps longer.
