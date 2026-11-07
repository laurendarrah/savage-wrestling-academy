# Data retention (DRAFT)

How long the academy keeps each kind of record, and what happens when a family asks to close their account or a coach is removed. The one automatic deletion today is a removed coach's records, 3 years after their removal (below). Closure requests appear on **Data requests**, where the owner records what was done.

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
| A coach's records after they are removed permanently | Their lessons, pay records, timesheets and time off, signed contract, profile, notices and invites | **3 years from the removal date, then deleted automatically** (decided by Justin, #197 Q18; built in #212) | Pay and contract questions after a coach leaves. See below |

## When a family asks to close their account

Proposed steps for the owner (to confirm):
1. Confirm the request with the family (email or phone).
2. Check for anything still active: a membership in its term, an unpaid installment, or an upcoming paid session. [Decision: what happens to those.]
3. Remove what isn't needed: [Decision: profile details, card numbers, messages, notices, entry passes, waitlist entries (no longer collected since #210)].
4. Keep what must be kept (payments, signed waivers, scholarship agreements) until its period above ends.
5. Record what was done on **Data requests**. The family sees it in their account.

Today steps 3 and 4 are done by the person who maintains the site, at the owner's request. Once the retention periods are decided, a one-click "close account" action can be built that removes exactly the agreed records and keeps the rest.

## When a coach is removed permanently

Decided by Justin (#197, question 18): keep all of a removed coach's records for 3 years, then delete them. [Attorney: confirm 3 years is long enough for payroll and contractor records (the IRS generally asks for employment tax records for at least 4 years) and for contract claims.]

- **Removing access** on **Coaches** stops the coach signing in. Nothing is deleted, and the 3 years do not start.
- **Removing permanently** (only after access is removed and no booked lessons are still to come) deletes their profile, unbooked future lesson times and unused invites at once, and records the date. **Coaches** then lists them under "Removed permanently" with **Records kept until** that date plus 3 years.
- **The day after that date**, the site's daily job deletes or anonymizes the rest. A large cleanup carries on over the following days. Each run that changes anything adds one line to the security log with counts only, never a name or email.
- **A coach who comes back** (on Coaches again) is never cleaned. Removed permanently again, the 3 years start again from the new date.
- **Coaches removed permanently before this was built** (#207, November 2026) get their removal date from the security log entry of their removal, at the next daily run.

What the cleanup does with each kind of record. Anything a family or the academy's books also depend on is kept, with the coach replaced by "Former coach", so a family's payment history, the books and the pay totals for past months stay exactly the same:

| Record | Table | What happens |
|---|---|---|
| Coach profile (name, bio, specialties, phone) | `coach_profiles` | Deleted (already at permanent removal) |
| Invites | `coach_invites` | Deleted |
| Lesson times nobody booked | `coach_openings` | Deleted |
| Lessons a family booked | `coach_openings` | Kept for the family's booking; the coach's email and account become "former-coach-…" |
| Lesson payments | `orders` | Kept exactly as paid (amount, status, dates). The coach's name and email in the price record and the item's name become "Former coach" |
| Approved shifts (the pay record for that month) | `coach_time_entries` | Kept with the date, minutes, role, rate and amount; the coach, their notes and the change history are removed |
| Shifts never approved, or voided | `coach_time_entries` | Deleted |
| Time off | `coach_time_off` | Deleted, with the notices about it to the coach and to the coaches covering |
| Signed contract | `waiver_signatures` (coach contract), and `signature_reissues` for any request to sign it again | Deleted. The contract text stays, because other coaches signed it |
| Notices to the coach | `notifications` | Deleted |
| Their lesson pay share | `academy_settings` (`lessons`) | Moved to the "former-coach-…" key, so pay for past months adds up the same |
| Team page listing | `academy_settings` (`website`) | Removed from the list of coaches shown |
| Cash they collected at the door (pay at the academy, #248, #250) | `orders` | Kept exactly as paid; "collected by" becomes "Former coach" and their account "former-coach-…", so Payments, its spreadsheet and Income and expenses show "Former coach" |
| Check-ins they made | `attendance` | The check-in stays (the family's attendance); "checked in by" becomes "former-coach-…" |
| Practice plans they edited | `practice_plans` | The plan stays; "last edited by" becomes "former-coach-…" |
| Security log entries naming them | `security_events` | Kept; their email and, on coach actions, their account become "former-coach-…" |
| Recovery snapshots (the copy of lesson times the site keeps before each restore, last 10) | `recovery_snapshots` | Their email becomes "former-coach-…" |
| The removal record itself | `removed_coaches` | Email and name cleared; the removal date and a one-way hash of the email stay (see Backups) |

Not changed by the cleanup: family notices and announcements that mention a coach by name (they follow the messages and notices period above), the coach's own sign-in account with Supabase (the owner deletes it there if wanted), and copies outside the site such as Stripe receipts and emails already sent.

### Backups

A backup restored later must not quietly bring a cleaned coach back.

- **Restoring a file on Backups** puts back rows that are missing. Straight after a restore, the site runs the cleanup again, so a cleaned coach's rows are deleted or anonymized again at once. It finds them through the hash of their email kept in `removed_coaches`. Restoring never puts a cleared email or name back into `removed_coaches`.
- **Backup files and the Deploy backup include `removed_coaches`**, with each coach's removal date. A database rebuilt from a backup alone keeps every coach's 3-year clock, and the next daily run cleans whatever is due.
- **A file made before a coach was removed permanently** has no removal record for them. Restored into a new, empty database, it brings that coach back as they were then, with no clock. Check **Coaches → Removed permanently** after such a restore and remove them permanently again. Deploy backups are kept 30 days, so this only matters for files the owner keeps longer.
