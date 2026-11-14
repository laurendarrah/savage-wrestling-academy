# What the site does today

One line per feature, with where it lives and what still waits. Checked against the code on November 7, 2026 (#267). This page replaces both the November 5 handoff's feature matrix, which described the ChatGPT Sites version and its sample workspace (in [the archive](archive/handoff-2026-11-05/README.md)), and the feature table that used to be in the README.

**Built** means the code, tests and the walkthrough cover it. **Waits** names the decision or setting it still needs. Nothing on this page is sample data: the owner workspace has no sample screens (#147).

| Area | Status | Where | Waits on |
|---|---|---|---|
| **Public** | | | |
| Welcome page, team page and calendar | Built. The owner edits the welcome and team pages on `/website` (#196); the calendar shows practices, days off, holidays, events and named practices | `/welcome`, `/team`, `/calendar`, `lib/public-schedule.ts`, `lib/website.ts` | Custom domain (#43) |
| Programs on a new site | No programs are public until the owner publishes them from the launch checklist; the defaults in `hydratePrograms()` are not public until saved | `app/portal.html`, `lib/workspace/` | Owner set-up (#16) |
| Help pages | Built for families, coaches and the owner (#109) | `/help`, `/help/coach`, `/help/owner` | |
| **Accounts** | | | |
| Sign-up, sign-in, password reset | Built on Supabase Auth; email links use `APP_ORIGIN` | `/login`, `/auth/confirm`, `lib/account-auth.ts` | A custom email sender in Supabase before families join (GO_LIVE) |
| Authenticator (MFA) | Optional for everyone. Staff sign in with a password only (#306); `STAFF_MFA=on` makes it required for staff again | `/security`, `lib/mfa-policy.ts` | |
| Family profiles and wrestlers | Built, with contact, safety and medical details shown to staff on the roster (#188) | `/family`, `lib/family-records.ts` | |
| Family data requests | Download everything; ask to close the account; owner handles requests (#113) and can delete a test family (#259) | `/family`, `/data-requests`, `/accounts`, `lib/family-deletion.ts` | Data retention policy (draft) |
| **Programs and booking** | | | |
| Program rules and SWA Advance approvals | Built. Development K–6, Intermediate 7–12, Advance 7–12 with coach approval for every wrestler, with private chat. A decision follows the wrestler through grade changes within 7–12 (#271) | `lib/program-approval.ts`, `/approvals` | |
| Registration and booking review | Built; prices from `lib/quotes.ts`, including team codes, member pricing and scholarships | `/register`, `/booking` | |
| Online payment | Built: Stripe Checkout, signed webhook, refunds, card disputes, card fees, and a Payment attempts list with Stripe's last word on every checkout (#271). Each purchase type stays closed until `CHECKOUT_KINDS` lists it | `lib/checkout.ts`, `lib/stripe-webhook.ts`, `/payment-setup` | Stripe account and webhook (#26), refund policy (#3) |
| Monthly memberships | Built, month to month since Nov 13 (#2, #314): a Stripe subscription at the program's monthly price that renews every month until canceled. The renewal terms sit beside the consent box before payment and an acknowledgment email goes out once after sign-up (NY GBL §527-a). The family cancels from the membership on `/family` or `/register`, the owner from Payments: no more charges, access to the end of the paid month. A failed payment tells the family and the owner, lists the membership under Payment needs attention and keeps a 7-day grace on the roster; if Stripe gives up, the membership pauses and **Restart membership** signs up again from that day with no back pay (#313). A payment for another amount counts for what Stripe collected (#271). A year paid upfront is not offered (#210) | `lib/membership-term.ts`, `lib/membership-renewal.ts`, `lib/memberships.ts`, `/api/memberships`, `subscriptions`, `installment_payments` | Opening `monthly` in `CHECKOUT_KINDS` after a Stripe test-card run |
| Pay cash at the academy | Built for walk-ins, extra practices and camps, clinics and events; coaches or the owner tap **Cash received** (camps: the owner) (#248, #250, #273). An unpaid camp booking holds its seats | `/booking`, `/roster`, `lib/cash-bookings.ts` | |
| Tell the academy I want this | Built: while memberships or lessons are closed for online payment, the review sends the owner an inbox message with the wrestler, plan or lesson and date, once per item per day, and shows the academy's address and email (#273) | `/register`, `/lesson`, `lib/interest.ts` | |
| Offline payments | Owner records cash or check, voids mistakes, exports CSV | `/payments`, `lib/offline-payments.ts` | |
| Camps and events | Built, with per-day times and seat limits. A full event is full: waitlists were removed (#210) | `app/portal.html`, `lib/capacity.ts` | |
| Private lessons | One-on-one, partner and small-group, priced per wrestler; coaches post times; families book and invite (#70, #177, #239) | `/lesson`, `/coach-openings`, `lib/lessons.ts` | Lesson refund policy before online payment (#80, #3) |
| Program transfers | Owner moves a paid membership between programs (#74) | `/transfers` | Settling price differences (#41) |
| Scholarships | Offers, frozen terms, drawn signatures, signed copies, benefit history | `/scholarships`, `/scholarship`, `lib/scholarships.ts` | Attorney-reviewed agreement (#44) |
| **At the door** | | | |
| Roster and check-in | Built from paid orders and cash bookings, by hand or by scanning QR passes (#22, #71). For coaches a dark one-thumb mat screen with a session switcher and one row per wrestler; the owner sees the same rows inside the owner shell (#286) | `/roster`, `lib/roster.ts`, `/pass` | |
| USA Wrestling cards | Missing or expired cards block booking; only verified cards check in. Automatic lookup on USA Wrestling's verify page; owner reviews the rest and sees renewals 30 days ahead (#68, #131, #202, #210) | `/cards`, `lib/usaw.ts`, `lib/usaw-check.ts` | |
| Waivers, Parent Consent Form, coach contracts | Owner publishes; families or coaches sign with a drawn signature; unsigned wrestlers can't book once a document is published; the owner can ask for a signature again, or carry one over to a renamed wrestler (#69, #195, #239, #271) | `/waivers`, `/consent-forms`, `/contracts`, `lib/documents.ts` | Attorney review of the wording (#44) |
| Owner exceptions | Dated exceptions to the card, waiver and consent-form blocks (#89) | `/cards`, `/waivers`, `lib/exceptions.ts` | |
| Wrestler view | Entry pass, what is coming up, what blocks booking (#76) | `/wrestler` | |
| **Messages** | | | |
| Announcements and private messages | Built, in-app; emails that didn't send are listed with the reason, to send again (#72, #35) | `/messages`, `/inbox`, `lib/messages.ts` | Resend set up (#35) |
| Automatic notices | Card expiring or expired, waiver to sign, approval decision, payment recorded, lesson booked, transfer (#105). Daily reminders run on a schedule | `lib/notify.ts` | Email (#35) |
| Branded emails | Built: every email the site sends is in the Savage layout, with the plain text beside it (#320). The sign-in emails from Supabase have the same layout as templates | `lib/email.ts`, `lib/email-brand.ts`, `docs/email-templates/` | Lauren pastes the six templates into Supabase (README in that folder) |
| **Coaches** | | | |
| Coach accounts and profiles | Owner invites by link; coaches sign in with a password and keep a profile families see (#190) | `/staff`, `/coach-join`, `/coach-profile` | |
| Coach home and calendar | Tonight first, month calendar of practices and events, published practice plans (#133, #191) | `/coach`, `/practice-plans` | |
| Practice plans and curricula | Owner writes and publishes plans; reusable curricula | `/practice-plans`, `/curricula` | |
| Coach hours and time off | Clock in and out, corrections, owner approval, monthly file; time off tells same-program coaches (#193) | `/coach-time`, `/timesheets` | Coaches are contractors (#331): hours and amounts owed, no withholding |
| Coach pay from lessons | Totals per coach at the owner's share, CSV (#75) | `/coach-pay` | |
| Removed coaches | Records kept 3 years, then deleted or anonymized by the daily job (#212) | `lib/coach-retention.ts` | |
| **Running the academy** | | | |
| Owner dashboard and shell | Opens on today: four tiles, tonight's sessions, what needs the owner (the launch checklist's open items among them), what is coming up and this month's money; a four-group sidebar of about fourteen items keeps the same header on every tool page (#123, #261, #283) | `/`, `app/portal.html`, `lib/owner-nav.ts` | |
| Income and expenses | Card, monthly, refund and offline payments appear on their own; owner adds expenses (#194, #42) | `/financials`, `lib/financials.ts` | Checking against Stripe's totals (#42) |
| Backups and restore | Owner downloads an encrypted backup of every business record and restores from one; Deploy backs up before each publish; restore drill (#25, #221) | `/backups`, `lib/backup-records.ts`, `pnpm restore:drill` | First backup off the platform (#17), restore drill (#25) |
| Site health and alerts | Server errors, alerts to the owner (at most hourly), emails that didn't send, test alert (#107, #47, #263) | `/site-health`, `lib/owner-alerts.ts` | Uptime monitor on `/api/health` (#47) |
| Security log | Sensitive actions, 100 a page | `/security-log`, `lib/security-log.ts` | |

## Not built, on purpose or not yet

- **Custom domain and moving the old website** (#43): after launch. Only `APP_ORIGIN` and the Supabase redirect list change.
- **Paying coaches** stays outside the app; the books are a simple record, not an accounting system.
- **Photos** of coaches or wrestlers: not offered (#197, question 22).
- **No-show fees or blocking** for unpaid cash bookings: not decided.
- **A second owner login**: only one email can manage the academy (`OWNER_EMAIL` in `lib/account-auth.ts`).
