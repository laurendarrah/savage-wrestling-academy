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
| Launch 3 | December | QR passes, private lesson booking with coaches, program transfers, reporting (waitlists dropped, #210) |

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
| 7 | ~~Hosting stays on ChatGPT Sites for launch week~~ **Changed Nov 6:** the academy leaves ChatGPT Sites and ChatGPT; hosting moves to its own Cloudflare account before launch (#100, #119). Steps in [GO_LIVE](GO_LIVE.md) | Owner and Justin | Now |
| 8 | Freeze direct edits in ChatGPT Sites. From now on every change goes through GitHub | Justin | Everything |

Recommendation for 6 and 7: launch on the current address and current hosting. Changing domain or hosting during launch week adds risk and no customer value.

## Access needed by Friday, November 6

| Item | From | Why |
|---|---|---|
| A way to publish GitHub changes to the live Site | Justin | Fixes and new features only reach families once published |
| A separate development Supabase project | Justin or owner | Test sign-up, email links and MFA without touching real accounts |
| Supabase production project | Lauren (done) | The old project can't be reached, so a new academy-owned project replaces it; Justin is invited as Owner (#139) |
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
- Stripe Checkout for one-time purchases: walk-in, camps, clinics, Friday Night Live. The upfront 12-month membership was removed (Justin's decision, #197 Q9, #210); memberships are 12 monthly payments.
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
- Sample-only pages in the owner workspace are labeled clearly, so staff do not rely on simulated data. Update, November 6 (#147): the sample screens, the family previews and `/admin-demo` are removed instead. Every workspace screen is real.
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
| QR check-in | **Built (#71).** Each wrestler has a QR pass at `/pass`; staff tap **Scan passes** on `/roster`. Manual check-in still works. Since #210 (Justin's Q11) a wrestler whose USA Wrestling card is missing, expired, not valid or not yet verified can't be checked in, by hand or by pass; the roster shows staff why. The owner's card exception (#89) covers check-in on its dates |
| Waivers | **Built (#69).** The owner publishes the approved waiver on `/waivers`; families sign per wrestler with a drawn signature on `/waiver`; unsigned wrestlers cannot book. Required only once a waiver is published. A parent or guardian signs, also for wrestlers 18 and older (#197, Q16). The owner can ask one family to sign again, with a reason the family sees; the earlier signature is kept, marked replaced, and the wrestler cannot book until a parent signs again (#239). The same works for the Parent Consent Form and, for one coach, the coach contract |
| Parent Consent Form | **Built, not published (#195).** Families sign two documents: the waiver and the Parent Consent Form (#197, Q15). It works exactly like the waiver: the owner publishes it on `/consent-forms`, a parent signs per wrestler on `/consent`, and unsigned wrestlers cannot book, with the same owner exceptions. Nothing changes for families until it is published. The wording waits for the attorney ([draft](policies/parent-consent-form-draft.md)); whether it can be required before that review is still open, so the launch checklist lists "Publish the Parent Consent Form (after attorney review)" |
| Coach contracts | **Built (#195).** The owner publishes the contract text on `/contracts` and sees who signed each version; each coach signs on `/contract` with a drawn signature and keeps the signed copy (#197, Q17). An unsigned contract shows a to-do on coach home and blocks nothing, because blocking coaching duties is not decided |
| USA Wrestling cards | **Built (#68).** Families enter the card number and choose its season, which expires August 31; a rare card with another date can still be entered (#131). A missing, expired or rejected card blocks every booking type, including offline payments. When a family adds or changes a card number, the site checks it on USA Wrestling's public verify page and verifies it automatically when the athlete membership is active and the name matches; no card photos (#192, #202). The owner verifies the rest on `/cards`, with "Check with USA Wrestling", a "Look up on USA Wrestling" button and an August count of cards not yet renewed (#131), and can allow a specific wrestler to book and be checked in anyway until a set date, with a reason (#89, #210). A card joins the renewal list (**Blocked or expiring soon**) and the family gets a reminder 30 days before it expires: `CARD_RENEWAL_DAYS` in `lib/usaw.ts` (Justin's Q13, #210). Rosters block check-in on card problems (#210) |
| Announcements and messages | **Built (#72).** The owner sends announcements (all families, a program, an event) and private messages on `/messages`; families read and reply at `/inbox`. Email turns on when the provider and sending address are decided (#87); until then `/messages` and `/site-health` say so. Emails that didn't send are listed on `/messages` with the reason and can be sent again (#35). The announcement opt-out still waits on #87 |
| Waitlists | **Removed (#210, Justin's Q10).** A full camp or event is simply full. The booking page, family account, owner dashboard and `/waitlists` no longer offer waitlists; rows already in `waitlist_entries` stay in the database, backups and family data downloads, and an old seat offer no longer holds a seat |
| Memberships paid upfront | **Removed (#210, Justin's Q9).** Families choose the monthly membership (12 payments that stop on their own) or a walk-in. Upfront orders made earlier stay valid and readable. The owner can no longer record a membership on `/payments`; recording monthly payments taken at the academy needs its own decision |
| Pay cash at the academy | **Built (#248, Lauren's decision Nov 7).** A family booking a walk-in, Friday Night Live or another extra practice chooses **Pay online** (only while that type is open in `CHECKOUT_KINDS`) or **Pay cash at the academy** (always offered). The usual booking checks and the price from `lib/quotes.ts` apply; the booking shows as "Pay at the academy: $40 due" on the family home and roster, and the family can cancel it until the session starts. Check-in is not blocked while it is unpaid. A coach (own programs, today) or the owner taps **Cash received**, which records an offline cash payment on `/payments` with who collected it, so it counts in Payments, the spreadsheet and Income and expenses once; the owner undoes a mistake by voiding that payment. `/payments` lists unpaid bookings to follow up, record or cancel (the family is told). Extra practices have no seat limit, so there is nothing to oversell. No no-show fees or blocking (not decided) |
| Private lessons | **Built (#70, #177).** One-on-one, partner (2) and small-group (3 to 6) lessons, priced per wrestler on `/lesson-settings`; every family books and pays for their own wrestler, with card and waiver checks for each. Coaches post open times or coach-hosted groups; a family can turn an open time into a private group and invite other families by link. Coach home shows each lesson's roster and spots left. The owner can add, change and remove any coach's openings from Coaches (**Lesson openings**, `/coach-openings`) with the same rules coaches have; the lessons and their pay stay with the coach, the coach gets an email and each change is in the security log. Families can see open times as a list or a month on `/lesson` (#239). Online payment opens after the refund policy (#80); until then the owner records lesson payments on `/payments`, choosing the group and wrestler |
| Program transfers | **Built (#74).** `/transfers` moves a paid membership to another program from a chosen date, with eligibility checks and history. Price differences are settled separately on `/payments` or in Stripe |
| Coach payouts and accounting | **Coach pay report built (#75):** `/coach-pay` totals each coach's paid lessons for a period at the share set on `/lesson-settings`, with CSV export; the lesson share defaults to 65% (#197 Q2). **Coach hours and time off built (#193):** coaches clock in and out from coach home, fix their own month and send it on or after its last day; the owner reviews, corrects with a reason, voids, approves and downloads the month's hours ($40 head, $30 assistant, scheduled practice time only) with lesson shares on `/timesheets`; approved time off tells same-program coaches and lists practices and lessons for cover. The file shows hours and amounts only until employee or contractor is decided (#197 Q6). **Books built (#194, decided in #197 Q8):** `/financials` shows income and expenses by month and year, with charts and CSV export. Card payments, monthly installments, refunds and offline payments appear on their own from the payment records; the owner adds expenses and other income. **Fees and partial refunds (#42):** Stripe card fees are read from Stripe by the daily job (or **Get fees from Stripe now**) and appear as the expense "Card processing fees"; partial refunds are money out on the day they were made, and /payments shows refunded so far, fee and net. The restricted Stripe key needs Balance (read) for fees. Left on #42: a monthly report checked against Stripe's own totals with a real test-card run. Paying coaches stays outside the app, and the books are a simple record, not an accounting system |
| Coach onboarding and profiles | **Built (#190).** On Coaches (`/staff`) the owner invites a coach by name, email and programs and copies a single-use link (7 days; emailed too once email is on). The coach creates their account, sets up an authenticator and lands on coach home. Coaches keep a profile (name, bio, specialties, phone) that families see beside lesson times, without the phone. The owner can add himself as a coach and use Coach view. Removing a coach keeps lessons, payments and pay history. A coach removed permanently has their records kept for 3 years, then the daily job deletes them, keeping what families and the books rely on as "Former coach"; Coaches shows "Records kept until" (#197 Q18, #212). Weekly repeating openings go up to 12 weeks until #197 (question 21) decides how far ahead. Photos follow in #192 |
| Coach month calendar | **Built (#191).** On `/practice-plans` a coach sees a month calendar of their programs' practices and every extra practice, camp, clinic and event, with holidays and today marked. A practice with a shared plan opens it. Only the owner writes and publishes plans: coaches do not draft them (#197, question 20) |
| Public marketing website | **Built (#196; decision #197, question 22).** The owner edits it on **Public website** (`/website`): the welcome page's headline, introduction and mission, which coaches the new team page (`/team`) shows and in what order (from their profiles, never email or phone), wrestler achievements and alumni by name only with no photos, and optional visit details. Saving publishes; a preview shows changes first. Empty lists are left off the page. Signed-out visitors still land on `/welcome`. Titles, descriptions and Open Graph tags come from the content, with absolute addresses from `APP_ORIGIN`, so moving to savagewrestling.com (#43) needs only that setting and the Supabase redirect list. No theme or color editor |

## Policies before launch

Drafts based on what the platform does are in [docs/policies](policies/README.md): privacy policy, refund policy for single purchases, data retention, a review checklist for the membership terms, and the Parent Consent Form (#195). Justin answers the marked decisions; the attorney reviews the wording. None is published until approved (#117).

## Risks to watch

- **Two copies of the code.** If anyone edits in ChatGPT Sites after GitHub becomes the source, changes get lost. Decision 8 prevents this.
- **Terms not final.** Charging a 12-month commitment without approved terms is a legal and refund risk. If decision 2 slips, launch with walk-ins only, and add monthly memberships when terms are approved. There is no upfront year to fall back on (#210).
- **No staging today.** The Wednesday test environment must exist before any live key is added.
- **One owner login.** Only one email can manage the academy, and there is no tested recovery if that login or its authenticator is lost. Set up a second authenticator before launch.
- **Sample data looks real.** Resolved November 6 (#147): the owner workspace has no sample screens left.
- **No programs on a new site.** Families see no programs until the owner chooses Publish the programs on the launch checklist. Check the practice days and times under Schedules before launch.

## Who does what

| Person | Role this week |
|---|---|
| Owner | Decisions 1 to 6, Stripe ownership, terms, soft-launch families |
| Justin | Cloudflare account, domain, Supabase and Stripe access, the live data export, decisions |
| Lauren | Coordination, review and merge of each change |
| Claude Code | Builds each day's work on a branch with tests, for review before merge |
