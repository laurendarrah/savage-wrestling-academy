# Data retention (DRAFT)

How long the academy keeps each kind of record, and what happens when a family asks to close their account. The site never deletes anything automatically today. Closure requests appear on **Data requests**, where the owner records what was done.

[Attorney: confirm the periods below against tax law (IRS: generally 3 to 7 years for business records), insurance requirements, and the statute of limitations for injury claims involving minors in New York, which can run until a few years after the child turns 18. That last point affects how long signed waivers should be kept.]

| Record | What it is | Proposed keep period | Why |
|---|---|---|---|
| Payments and refunds | Orders, amounts, dates, method | [Decision: 7 years] | Tax and accounting |
| Signed waivers | Text version, signature drawing, signer, date | [Attorney: until the wrestler turns 18 plus the limitations period] | Liability defense |
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

## When a family asks to close their account

Proposed steps for the owner (to confirm):
1. Confirm the request with the family (email or phone).
2. Check for anything still active: a membership in its term, an unpaid installment, or an upcoming paid session. [Decision: what happens to those.]
3. Remove what isn't needed: [Decision: profile details, card numbers, messages, notices, entry passes, waitlist entries (no longer collected since #210)].
4. Keep what must be kept (payments, signed waivers, scholarship agreements) until its period above ends.
5. Record what was done on **Data requests**. The family sees it in their account.

Today steps 3 and 4 are done by the person who maintains the site, at the owner's request. Once the retention periods are decided, a one-click "close account" action can be built that removes exactly the agreed records and keeps the rest.
