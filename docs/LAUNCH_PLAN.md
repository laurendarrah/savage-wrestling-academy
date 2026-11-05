# Launch plan: week of November 9, 2026

Prepared November 5, 2026. Goal: Savage Wrestling Academy runs registration, payment, and rosters on this platform before December practices begin on December 1.

## The short version

Going live next week is realistic for a defined first release. Going live with everything the admin demo shows is not, and trying would put real families' payments at risk.

The demo shows rosters, QR check-in, waivers, messaging, waitlists, lesson booking and coach payouts. Most of that runs on sample data and has no backend yet. Payments do not exist at all. Building and safely testing all of it takes 6 to 10 weeks.

The recommendation is a three-part launch:

| Release | When | What families and staff get |
|---|---|---|
| Launch 1 | Week of Nov 9, soft launch Fri Nov 13 | Accounts, family profiles, calendar, approvals, scholarships, **online payment** for memberships, walk-ins, camps and Friday Night Live, and a real roster of who paid |
| Launch 2 | Weeks of Nov 16 to Nov 30 | Check-in and attendance at the door, waiver collection, email receipts and announcements, camp capacity limits |
| Launch 3 | December | QR passes, private lesson booking with coaches, waitlist offers, program transfers, reporting |

Everything not in Launch 1 has a manual stand-in for a few weeks, listed at the end.

## Decisions needed by Friday, November 6

Nothing in Launch 1 can be finished without these. Each one blocks a specific day below.

| # | Decision | Who decides | Blocks |
|---|---|---|---|
| 1 | Approve the Launch 1 scope in this document | Owner | Everything |
| 2 | Membership terms: what happens after the 12th payment, early cancellation, missed payments, refunds | Owner, ideally with an attorney | Checkout (Mon) |
| 3 | Camp, clinic and Friday Night Live refund policy | Owner | Checkout (Mon) |
| 4 | Who owns the live Stripe account, and who can see payouts | Owner | Going live (Thu) |
| 5 | Waiver approach for the first weeks: paper, or an external waiver service link | Owner | Soft launch (Fri) |
| 6 | Stay on the current web address, or move to a custom domain now | Owner | Thu |
| 7 | Hosting stays on ChatGPT Sites for launch week. Moving hosting is a separate project after launch | Owner and Justin | Thu |
| 8 | Freeze direct edits in ChatGPT Sites. From now on every change goes through GitHub | Justin | Everything |

Recommendation for 6 and 7: launch on the current address and current hosting. Changing domain or hosting during launch week adds risk and no customer value.

## Access needed by Friday, November 6

| Item | From | Why |
|---|---|---|
| A way to publish GitHub changes to the live Site | Justin | Fixes and new features only reach families once published |
| A separate development Supabase project | Justin or owner | Test sign-up, email links and MFA without touching real accounts |
| Supabase production settings access | Justin | Fix email redirect addresses, turn on leaked-password protection |
| Stripe test-mode team access | Owner | Build and test checkout |
| Read access to the live database, or an export | Justin | Know how many real families and scholarships exist before changing anything |
| The four files dropped from the Drive upload | Justin | `.gitignore`, `.npmrc`, `.openai/hosting.json`, `.env.example` |

## Status as of Thursday, November 5, evening

Most of next week's code is already built and waiting for review. Each item is on its own branch with tests. Merge in this order (also on issue #15):

| Order | Branch | What it does | Issue |
|---|---|---|---|
| 1 | `chore/patch-dependency-advisories` | Fixes all 8 production security advisories | SEC-01 |
| 2 | `chore/30-collaboration-setup` | Templates, automatic checks, README, contributing guide | #30 |
| 3 | `fix/sample-workspace-bugs` | Camp review crash, drop-in grade rules, Kindergarten | DEMO-01, DEMO-02 |
| 4 | `fix/auth-callback-origin` | Sign-up and reset emails link to the live site | AUTH-01 |
| 5 | `fix/complete-backup-coverage` | Backups include every business record | DATA-02 |
| 6 | `docs/launch-plan` | This plan | |
| 7 | `feat/18-stripe-checkout` | Online payment and the signed Stripe webhook, off until switched on | #18, #19 |
| 8 | `feat/21-family-purchases` | Real memberships and purchase history on the family page | #21 |
| 9 | `feat/22-real-roster` | Roster and check-in from paid orders | #22 |
| 10 | `fix/23-label-sample-screens` | Sample-data notices in the owner workspace | #23 |
| 11 | `feat/26-live-stripe-mode` | Live Stripe mode behind a deliberate switch | #26 |
| 12 | `feat/20-monthly-memberships` | 12-month memberships paid monthly, ending after the 12th payment. Off until terms are approved | #20 |
| 13 | `feat/36-event-capacity` | Camps and events cannot be oversold online | #36 |

All thirteen merge together with no conflicts. Branches 7 to 13 form one line, each built on the one before. On the combined code, all 29 test scripts, the typecheck and the build pass, and the production security audit is clean. The payment webhook was also run in the real Cloudflare runtime against signed, forged, replayed, late and refund events.

**What is left for Launch 1 is mostly not code:** the decisions (#1 to #8), access (#9 to #14), the test pass with Stripe test cards (#24), the restore drill (#25), and the live switch (#26). Monthly memberships are built and open once the terms are approved (#20).

## Day-by-day plan

### Friday, November 6: decide, unblock, merge

- Owner makes decisions 1 to 8.
- Justin grants the access above and stops editing in Sites.
- Review and merge the four branches above.
- Justin publishes the merged code to the live Site.
- In Supabase production: confirm the live address is in the allowed redirect list, and turn on leaked-password protection.
- Run a full backup export from the owner page and store the encrypted file somewhere outside the platform.
- Clean up live settings: remove the "Neutral Camp" test event, and confirm that November having no practices is intentional.

Done when: a test family can sign up, receive the confirmation email, click the link, and land on the live site.

### Monday, November 9: one-time payments in test mode (built, needs test-card pass)

- New tables: orders and payments, keyed to the real family account and wrestler.
- Stripe Checkout for one-time purchases: walk-in, upfront 12-month membership, camps, clinics, Friday Night Live.
- Prices are recalculated on the server from saved settings, including team codes, member pricing and scholarships. The browser never sets a price.
- Signed Stripe webhook handler that records payments idempotently, so a repeated or late event cannot double-charge or double-enroll.
- Paid access is granted only by the webhook, never by the browser's success page.

Done when: test-card purchases of every one-time type create exactly one order each, and a replayed webhook changes nothing.

### Tuesday, November 10: monthly memberships (built, off until terms are approved)

- 12-month membership paid monthly, ending automatically after the 12th payment, per decision 2.
- A memberships table becomes the single record of who is paid, through what date, for which program.
- The family page's "My memberships" and "Purchase history" show real records instead of examples.
- Failed payment, cancellation and refund events update the membership status.

Done when: Stripe test clocks show 12 charges then a stop, a failed card marks the membership past due, and a refund is reflected on the family page.

### Wednesday, November 11: the real roster (built)

- Owner roster page built from paid memberships and walk-ins for a given practice date. This replaces the sample roster for daily operations.
- Simple manual check-in on that roster, saved to a real attendance table.
- Sample-only pages in the owner workspace are labeled clearly, so staff do not rely on simulated data.
- Full test pass in a separate test environment: every purchase type, failures, cancellations, refunds, scholarship families, Advance approvals, team codes.

Done when: a test family's purchase appears on the correct practice roster and can be checked in.

### Thursday, November 12: switch to live

- Restore drill: restore yesterday's backup into the test environment and confirm every record comes back.
- Owner adds live Stripe keys through the owner page and registers the live webhook.
- One real low-value purchase by staff, then refund it. Confirm the money and the refund appear in Stripe.
- Publish to the live Site.

Done when: the real purchase and refund appear correctly in Stripe, the database and the family page.

### Friday, November 13: soft launch

- Invite 5 to 10 known families to register and pay.
- Watch every payment in Stripe and every order in the owner roster that day.
- Fix anything found before the full announcement.

### Monday, November 16: full announcement

- Open registration to all families for December practices.

## Manual stand-ins until Launch 2 and 3

| Not live yet | Stand-in |
|---|---|
| QR check-in | **Built (#71).** Each wrestler has a QR pass at `/pass`; staff tap **Scan passes** on `/roster`. Manual check-in still works |
| Waivers | **Built (#69).** The owner publishes the approved waiver on `/waivers`; families sign per wrestler with a drawn signature on `/waiver`; unsigned wrestlers cannot book. Required only once a waiver is published |
| USA Wrestling cards | **Built (#68).** Families enter the card number and expiration date; a missing, expired or rejected card blocks every booking type, including offline payments. The owner verifies cards on `/cards`. Rosters flag lapsed cards at the door |
| Announcements and messages | Owner's email |
| Waitlists | **Built (#73).** Families join a full camp or event from the booking page; the owner offers a freed seat on `/waitlists`, held for a set time and optionally passed on automatically. Families see offers in their account; the owner emails them until messaging (#72) is connected |
| Private lessons | **Built (#70).** Families pick a coach's open time on `/lesson` at owner prices set on `/lesson-settings`; a paid lesson takes the time and shows on the coach page. Online payment opens after the refund policy (#80); until then the owner records lesson payments on `/payments` |
| Program transfers | Owner refunds and re-registers in Stripe |
| Coach payouts and accounting | **Coach pay report built (#75):** `/coach-pay` totals each coach's paid lessons for a period at the share set on `/lesson-settings`, with CSV export. Paying coaches and bookkeeping stay outside the app |

## Risks to watch

- **Two copies of the code.** If anyone edits in ChatGPT Sites after GitHub becomes the source, changes get lost. Decision 8 prevents this.
- **Terms not final.** Charging a 12-month commitment without approved terms is a legal and refund risk. If decision 2 slips, launch with walk-ins and upfront payments only, and add monthly memberships when terms are approved.
- **No staging today.** The Wednesday test environment must exist before any live key is added.
- **One owner login.** Only one email can manage the academy, and there is no tested recovery if that login or its authenticator is lost. Set up a second authenticator before launch.
- **Sample data looks real.** The owner workspace mixes real and sample records. Staff need a short walkthrough of which screens are real.

## Who does what

| Person | Role this week |
|---|---|
| Owner | Decisions 1 to 6, Stripe ownership, terms, soft-launch families |
| Justin | Access, publishing to Sites, Supabase settings, decision 8 |
| Lauren | Coordination, review and merge of each change |
| Claude Code | Builds each day's work on a branch with tests, for review before merge |
